// Harness adapter 协调与异常恢复的 fixture 验收（方案 P2 §3.4 的 H01–H07）。
//
// 关键设计：fixture 里的 `api('coordination', …)` **直接调用真实的 host 协调模块**
// （lib/coordination.js，独立 DSH_HOME），而不是再造一个内存假货——这样 H01/H04/H05/H06
// 验证的是真协议（含锁、token 语义、阶段机），只有"内核服务"是假的。
//
// 用法：node plugin/writing-mode/test/adapter-coordination.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-adapter-'))
process.env.DSH_HOME = path.join(temp, 'home')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const host = await import(pathToFileURL(path.join(HERE, '../lib/coordination.js')).href)
const { createHarnessAdapter } = await import(pathToFileURL(path.join(HERE, '../src/client/adapters/harness/adapter.js')).href)

let pass = 0
const ok = async (name, fn) => {
  try {
    await fn()
    pass++
    console.log('PASS', name)
  } catch (err) {
    console.error('FAIL', name, '\n  ', err.message)
    process.exitCode = 1
  }
}

const LIB_ROOT = path.join(temp, 'library') // 作品根（host 会解析成规范身份）
const PROJECT_A = path.join(LIB_ROOT, '作品A')
const PROJECT_B = path.join(LIB_ROOT, '作品B')
// 协调记录是**持久**的（按作品身份分桶、跨进程共享）：每个用例必须用没被用过的作品路径，
// 否则上一个用例留下的 bound/uncertain 记录会正确地影响下一个用例 —— 那是产品行为，不是测试噪声。
let projectSeq = 0
const freshProject = (label) => path.join(LIB_ROOT, label + '-' + String(++projectSeq))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 假内核：只实现 adapter 依赖的那几个服务；会话是"活"的（有 chat 图、能 prompt）。
 *   options.createDelay —— sessions.create 的耗时（测 A 创建中切 B）
 *   options.failCreate —— sessions.create 抛错（H04：workspace 已建但 session 结果丢失）
 *   options.failPrompt —— prompt 抛错；afterDispatch=true 表示"已经发出去了"（H07）
 *   options.deleteAfter — 绑定后立刻让这个会话从列表消失（H06）
 */
function createFakeKernel(options = {}) {
  const state = {
    sessions: new Map(), // id → { id, store, chat }
    byPath: new Map(),
    creates: 0,
    workspaces: 0,
    prompts: [], // { sessionId, body }
    opens: [],
    selects: 0,
    refreshes: 0,
  }
  let seq = 0

  function makeChat() {
    const chat = { nodes: new Map(), order: [] }
    return chat
  }
  function makeSession(id) {
    const chat = makeChat()
    const listeners = new Set()
    const live = {
      id,
      sessionId: id,
      chat,
      running: false,
      queue: [],
      pending: [],
      hasMore: false,
      prompted: 0,
      async prompt(parts, mode) {
        state.prompts.push({ sessionId: id, body: parts?.[0]?.text || '', mode })
        live.prompted++
        const body = parts?.[0]?.text || ''
        if (options.failPrompt) {
          if (options.afterDispatch) {
            // 已经落到会话里了，再报网络错——正是 H07 的场景
            const key = `n${live.prompted}`
            chat.nodes.set(key, { kind: 'user', data: { content: [{ type: 'text', text: body }] } })
            chat.order.push(key)
            for (const fn of listeners) fn()
            throw Object.assign(new Error('network down'), { code: 'ECONNRESET' })
          }
          throw Object.assign(new Error('native refused'), { code: 'refused' })
        }
        const key = `n${live.prompted}`
        chat.nodes.set(key, { kind: 'user', data: { content: [{ type: 'text', text: body }] } })
        chat.order.push(key)
        for (const fn of listeners) fn()
        return { ok: true }
      },
      async cancel() {
        live.cancelled = true
        return { ok: true }
      },
      subscribe(fn) {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
      getSnapshot: () => ({ chat, running: live.running, queue: live.queue, pending: live.pending, hasMore: live.hasMore }),
    }
    state.sessions.set(id, live)
    return live
  }

  const sessions = {
    async refresh() {
      state.refreshes++
      if (options.deleteAfter && state.byPath.get(options.deleteAfter)) {
        state.sessions.delete(state.byPath.get(options.deleteAfter))
      }
    },
    list: { getSnapshot: () => ({ byId: Object.fromEntries([...state.sessions.keys()].map((k) => [k, true])) }) },
    binding: (id) => (state.sessions.has(id) ? { session: state.sessions.get(id) } : null),
    provideInfo: (id) =>
      state.sessions.has(id)
        ? {
            props: { inputActions: { setDraft: (t) => { state.sessions.get(id).draft = t } } },
            hooks: { input: { getSnapshot: () => ({ draft: state.sessions.get(id).draft || '' }) } },
          }
        : null,
    async create() {
      state.creates++
      if (options.createDelay) await sleep(options.createDelay)
      if (options.failCreate) throw Object.assign(new Error('session create lost'), { code: 'ECONNRESET' })
      const id = `sess-${++seq}`
      makeSession(id)
      return id
    },
    open(id) {
      state.opens.push(id)
    },
    noteAgentPreset() {},
  }

  const workspaces = {
    async create() {
      state.workspaces++
      return { workspaceId: `ws-${state.workspaces}` }
    },
  }

  const connection = { agentPresets: { async select() { state.selects++; return { result: { ok: true, value: { agentPreset: 'writing-companion' } } } } } }

  /** 真 host 协调模块的直连（绕 HTTP，但协议/锁/阶段机全是真的）。 */
  const coordCalls = []
  const api = async (route, opts, query) => {
    if (route === 'companion') {
      const body = opts?.body ? JSON.parse(opts.body) : null
      if (body?.sessionId) {
        state.byPath.set(body.path, body.sessionId)
        return { ok: true }
      }
      const sessionId = state.byPath.get(query?.path || body?.path) || null
      const project = sessionId ? (query?.path || body?.path) : (query?.path || body?.path)
      return { ok: true, project, sessionId, preset: 'writing-companion' }
    }
    if (route === 'coordination') {
      const body = opts?.body ? JSON.parse(opts.body) : null
      if (query?.path) {
        const key = normKey(query.path)
        return { ok: true, record: safeRead(key) }
      }
      const key = normKey(body.path)
      coordCalls.push({ op: body.op, key, token: body.operationToken })
      if (options.breakConfirm && body.op === 'confirm') return { ok: true, outcome: 'stale-token', record: safeRead(key) }
      const fns = {
        claim: host.claimCoordination,
        creating: host.markCreatingCoordination,
        confirm: host.confirmCoordination,
        uncertain: host.markUncertainCoordination,
        release: host.releaseCoordination,
      }
      if (body.op === 'forget') {
        host.forgetCoordination({ projectKey: key })
        return { ok: true }
      }
      const fn = fns[body.op]
      if (!fn) return { ok: false, error: 'unknown-op' }
      const r = fn({ projectKey: key, operationToken: body.operationToken, sessionId: body.sessionId, workspaceId: body.workspaceId, owner: body.owner, bindingVersion: body.bindingVersion, reason: body.reason })
      const { _outcome, stale, ...record } = r
      return { ok: true, outcome: _outcome, record }
    }
    throw new Error('unexpected route ' + route)
  }

  return { sessions, workspaces, connection, api, state, coordCalls, normKey }
}

/** 把作品路径映射成 host 侧会用的规范身份（真实实现里由 resolveProjectDir 完成）。 */
function normKey(p) {
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}
function safeRead(key) {
  try {
    const { _outcome, ...rec } = host.readCoordination(key)
    return rec
  } catch {
    return null
  }
}

const makeAdapter = (kernel) => createHarnessAdapter({ sessions: kernel.sessions, workspaces: kernel.workspaces, connection: kernel.connection, api: kernel.api, wait: sleep, log: () => {} })

console.log('--- H01 两个窗口同时首次关联')

await ok('H01 只创建一个会话：后到窗口拿 in-progress 并采用先到窗口的绑定', async () => {
  const kernel = createFakeKernel({ createDelay: 120 })
  const winA = makeAdapter(kernel)
  const winB = makeAdapter(kernel) // 另一个渲染进程 = 另一个 adapter 实例，inflight 不共享
  const [a, b] = await Promise.all([winA.connect(PROJECT_A, 'tok-A'), winB.connect(PROJECT_A, 'tok-B')])
  assert.equal(kernel.state.creates, 1, `必须只创建一个会话（实测 ${kernel.state.creates}）`)
  assert.equal(a.getSnapshot().sessionId, b.getSnapshot().sessionId, '两个窗口必须绑定同一会话')
  assert.equal(a.getSnapshot().status, 'ready')
  assert.equal(b.getSnapshot().status, 'ready')
  assert.equal(b.getSnapshot().shared || false, false, 'B 不是进程内共用，而是采用了对端绑定')
})

await ok('H02 同窗口连点：进程内共用创建 Promise，只创建一个会话', async () => {
  const kernel = createFakeKernel({ createDelay: 80 })
  const win = makeAdapter(kernel)
  const [x, y] = await Promise.all([win.connect(PROJECT_B, 'tok-same'), win.connect(PROJECT_B, 'tok-same')])
  assert.equal(kernel.state.creates, 1)
  assert.equal(x.getSnapshot().sessionId, y.getSnapshot().sessionId)
  assert.ok(x.getSnapshot().shared || y.getSnapshot().shared, '其中一个应是进程内共用结果')
})

console.log('--- H03 A 创建中切 B / 迟到结果归位')

await ok('H03 A 创建中切到 B：B 不被 A 拖住，A 的结果只回到 A', async () => {
  const kernel = createFakeKernel({ createDelay: 150 })
  const win = makeAdapter(kernel)
  const projA = freshProject('作品A-切B')
  const projB = freshProject('作品B-切B')
  const aPromise = win.connect(projA, 'tok-A2')
  await sleep(20)
  const b = await win.connect(projB, 'tok-B2') // A 还在创建中
  const a = await aPromise
  const sa = a.getSnapshot().sessionId
  const sb = b.getSnapshot().sessionId
  assert.notEqual(sa, sb, 'A、B 必须是各自的会话')
  const ra = await a.send({ body: '给 A 的文字' })
  assert.equal(ra.result, 'accepted')
  assert.equal(kernel.state.prompts.at(-1).sessionId, sa, 'A 的消息只能进 A 的会话')
  const rb = await b.send({ body: '给 B 的文字' })
  assert.equal(rb.result, 'accepted')
  assert.equal(kernel.state.prompts.at(-1).sessionId, sb, 'B 的消息只能进 B 的会话')
  assert.equal(kernel.state.prompts.filter((p) => p.body === '给 A 的文字').length, 1)
})

await ok('H03 绑定后会话消失于列表：send 拒绝，不静默新建', async () => {
  const kernel = createFakeKernel()
  const win = makeAdapter(kernel)
  const a = await win.connect(freshProject('作品C'), 'tok-C')
  assert.equal(a.getSnapshot().status, 'ready')
  kernel.state.sessions.clear() // 会话被别处删掉
  const sent = await a.send({ body: '还在吗' })
  assert.equal(sent.result, 'rejected')
  assert.equal(sent.code, 'session-missing')
  assert.equal(a.getSnapshot().status, 'missing', '状态要降级为 missing，恢复入口才会出现')
  assert.equal(kernel.state.creates, 1, '不得因为会话消失就自动新建')
})

console.log('--- H04/H05 创建结果与确认失败')

await ok('H04 workspace 已建但 session 创建结果丢失 → uncertain，保留 workspaceId', async () => {
  const p = freshProject('作品D')
  const kernel = createFakeKernel({ failCreate: true })
  const win = makeAdapter(kernel)
  const a = await win.connect(p, 'tok-D')
  const snap = a.getSnapshot()
  assert.equal(snap.status, 'uncertain', `期望 uncertain，实得 ${snap.status}`)
  assert.equal(snap.sessionId, null)
  assert.equal(snap.record.workspaceId, 'ws-1', '已建的工作区必须记下来（不能当作没发生）')
  assert.equal(snap.record.phase, 'uncertain')
  // 另一个窗口后来关联：看到 uncertain，不会另建
  const win2 = makeAdapter(kernel)
  const b = await win2.connect(p, 'tok-D2')
  assert.equal(b.getSnapshot().status, 'uncertain')
  assert.equal(kernel.state.creates, 1)
})

await ok('H05 绑定确认失败（会话已建）→ uncertain 且保住 sessionId，不重建', async () => {
  const p = freshProject('作品E')
  const kernel = createFakeKernel({ breakConfirm: true })
  const win = makeAdapter(kernel)
  const a = await win.connect(p, 'tok-E')
  const snap = a.getSnapshot()
  assert.equal(snap.status, 'uncertain')
  assert.ok(snap.sessionId, '会话确实建好了，必须保住它以便继续关联')
  assert.equal(kernel.state.creates, 1)
  assert.equal(snap.wrongness, 'confirm-stale-token')
})

console.log('--- H06 会话删除')

await ok('H06 记录仍有绑定但会话已消失 → missing + 恢复入口；作者明确恢复才新建', async () => {
  const p = freshProject('作品F')
  const kernel = createFakeKernel()
  const win = makeAdapter(kernel)
  const a = await win.connect(p, 'tok-F')
  assert.equal(a.getSnapshot().status, 'ready')
  kernel.state.sessions.clear() // 会话被删
  const b = await makeAdapter(kernel).connect(p, 'tok-F2')
  const snap = b.getSnapshot()
  assert.equal(snap.status, 'missing', `期望 missing，实得 ${snap.status}`)
  assert.equal(kernel.state.creates, 1, '不得静默建新空会话')
  const recovered = await b.recover()
  assert.equal(recovered.status, 'ready')
  assert.equal(kernel.state.creates, 2, '作者明确恢复后应新建一个会话')
  assert.notEqual(recovered.sessionId, snap.sessionId)
})

console.log('--- H07 受理与网络')

await ok('H07 已受理但网络断开 → accepted（有原生证据，不算 uncertain）', async () => {
  const p = freshProject('作品G')
  const kernel = createFakeKernel({ failPrompt: true, afterDispatch: true })
  const win = makeAdapter(kernel)
  const a = await win.connect(p, 'tok-G')
  const r = await a.send({ body: '发出了但报网络错' })
  assert.equal(r.result, 'accepted', `有 user 节点证据就该算受理（实得 ${r.result}）`)
  assert.equal(r.evidence, 'user-node')
  assert.equal(kernel.state.prompts.length, 1, '不得自动重发')
})

await ok('H07 交出去但无任何证据 → uncertain 且保留正文，绝不自动重发', async () => {
  const p = freshProject('作品H')
  const kernel = createFakeKernel()
  const win = makeAdapter(kernel)
  const a = await win.connect(p, 'tok-H')
  // 让 prompt 抛错且不落任何节点
  const session = kernel.state.sessions.get(a.getSnapshot().sessionId)
  session.prompt = async () => {
    kernel.state.prompts.push({ sessionId: session.id, body: 'x' })
    throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
  }
  const r = await a.send({ body: '不确定的一轮，正文要留住' })
  assert.equal(r.result, 'uncertain')
  assert.equal(r.retainedBody, '不确定的一轮，正文要留住')
  assert.equal(kernel.state.prompts.length, 1, 'uncertain 不等于可以重发')
})

await ok('H07 原生明确拒绝 → rejected（可以改完再发）', async () => {
  const p = freshProject('作品I')
  const kernel = createFakeKernel()
  const win = makeAdapter(kernel)
  const a = await win.connect(p, 'tok-I')
  const session = kernel.state.sessions.get(a.getSnapshot().sessionId)
  session.prompt = async () => ({ ok: false, error: { code: 'busy', message: '当前无法受理' } })
  const r = await a.send({ body: '会被拒的一轮' })
  assert.equal(r.result, 'rejected')
  assert.equal(r.code, 'busy')
})

console.log('--- 能力缺失与订阅')

await ok('缺少 workspaces.create：connect 明确报能力缺失并释放预留（不留悬空记录）', async () => {
  const p = freshProject('作品J')
  const kernel = createFakeKernel()
  const win = createHarnessAdapter({ sessions: kernel.sessions, connection: kernel.connection, api: kernel.api, wait: sleep })
  await assert.rejects(() => win.connect(p, 'tok-J'), (err) => err.code === 'capabilities-missing' && /workspaces\.create/.test(err.message))
  assert.equal(host.readCoordination(normKey(p)).phase, null, '能力缺失时不得留下预留记录')
  assert.equal(kernel.state.creates, 0)
})

await ok('dispose 只释放订阅：不取消模型任务、不删会话、不动记录', async () => {
  const p = freshProject('作品K')
  const kernel = createFakeKernel()
  const win = makeAdapter(kernel)
  const a = await win.connect(p, 'tok-K')
  const sessionId = a.getSnapshot().sessionId
  let notified = 0
  const off = a.subscribe(() => notified++)
  await a.send({ body: '第一轮' })
  assert.ok(notified > 0, '会话有变化就该通知订阅者（这里应至少通知一次）')
  off()
  const afterOff = notified
  await a.send({ body: '第二轮' })
  assert.equal(notified, afterOff, 'off() 之后不得再收到通知')
  a.dispose()
  assert.equal(kernel.state.sessions.has(sessionId), true, '会话必须还在')
  assert.equal(host.readCoordination(normKey(p)).phase, 'bound', '记录必须还在')
  assert.equal(kernel.state.sessions.get(sessionId).cancelled, undefined, 'dispose 不得取消任务')
})

await ok('快照引用稳定：无变化时同引用，有变化时换引用', async () => {
  const p = freshProject('作品L')
  const kernel = createFakeKernel()
  const win = makeAdapter(kernel)
  const a = await win.connect(p, 'tok-L')
  const s1 = a.getSnapshot()
  const s2 = a.getSnapshot()
  assert.equal(s1, s2, '无变化必须是同一个对象（React 依赖它判断是否重渲染）')
  await a.send({ body: '新的一轮' })
  const s3 = a.getSnapshot()
  assert.notEqual(s1, s3, '会话内容变化后必须换新对象')
  assert.equal(s3.messages.at(-1).kind, 'user')
})

console.log(`\nadapter 协调验收: ${pass} 项通过`)
fs.rmSync(temp, { recursive: true, force: true })
