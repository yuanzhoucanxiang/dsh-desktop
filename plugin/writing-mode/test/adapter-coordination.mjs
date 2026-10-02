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
        const r = host.forgetCoordination({
          projectKey: key,
          operationToken: body.operationToken ?? null,
          expectedVersion: Number.isInteger(body.expectedVersion) ? body.expectedVersion : null,
          force: body.force === true,
        })
        return { ok: Boolean(r.ok), error: r.error, record: safeRead(key) }
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

await ok('N04 明确拒绝 + 期间别处出现新消息 → rejected（文本证据不得翻案）', async () => {
  const p = freshProject('作品G')
  const kernel = createFakeKernel()
  const win = makeAdapter(kernel)
  const a = await win.connect(p, 'tok-G')
  const session = kernel.state.sessions.get(a.getSnapshot().sessionId)
  // 原生明确拒绝，同时"别处"往同一个会话里塞了另一条消息（其他窗口/排队转历史）
  session.prompt = async () => {
    kernel.state.prompts.push({ sessionId: session.id, body: '继续' })
    const key = 'other-window-turn'
    session.chat.nodes.set(key, { kind: 'user', data: { content: [{ type: 'text', text: '不要继续旧方案，我们重新讨论人物动机。' }] } })
    session.chat.order.push(key)
    return { ok: false, error: { code: 'busy', message: 'This request was rejected' } }
  }
  const r = await a.send({ message: '继续', body: '继续' })
  assert.equal(r.result, 'rejected', `明确拒绝不得被文本包含翻案（实得 ${r.result}）`)
  assert.equal(kernel.state.prompts.length, 1, '不得自动重发')
})

await ok('N04 抛异常但无可证明标识 → uncertain 且保留正文（宁可不确定也不误判受理）', async () => {
  const p = freshProject('作品G2')
  const kernel = createFakeKernel({ failPrompt: true, afterDispatch: true })
  const win = makeAdapter(kernel)
  const a = await win.connect(p, 'tok-G2')
  const r = await a.send({ body: '发出了但报网络错' })
  assert.equal(r.result, 'uncertain', `文本证据不足以证明受理（实得 ${r.result}）`)
  assert.equal(r.retainedBody, '发出了但报网络错')
  assert.equal(kernel.state.prompts.length, 1, '不得自动重发')
})

await ok('N04 内核给出可证明标识（requestId 出现在新队列项）→ accepted', async () => {
  const p = freshProject('作品G3')
  const kernel = createFakeKernel()
  const win = makeAdapter(kernel)
  const a = await win.connect(p, 'tok-G3')
  const session = kernel.state.sessions.get(a.getSnapshot().sessionId)
  session.prompt = async () => {
    const id = 'q-42'
    session.queue.push({ id, text: '' })
    kernel.state.prompts.push({ sessionId: session.id, body: '这一轮交给内核了' })
    throw Object.assign(new Error('response lost'), { code: 'ECONNRESET', requestId: 'q-42' })
  }
  const r = await a.send({ body: '这一轮交给内核了' })
  assert.equal(r.result, 'accepted', `有内核队列标识即可证明受理（实得 ${r.result}）`)
  assert.equal(r.evidence, 'kernel-queue-id')
  assert.equal(kernel.state.prompts.length, 1)
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

console.log('--- 0.1.7 双栈：modern 创建（remote.session.create）')

/**
 * 0.1.7 形状的假内核：sessions 只剩 binding/refresh/retain/list（无 create/open/noteAgentPreset/
 * provideInfo），没有 connection.agentPresets.select；建会话走 workspaces.create（幂等）+
 * remote.session.create({workspaceId, agentPreset}) 信封。
 *   options.refuseCreate —— create 返回 {ok:false, error}（如 agent-preset/not-found）
 *   options.withUiWorkspace / options.uiOpenSession —— uiWorkspace 形态
 */
function createModernKernel(options = {}) {
  const state = {
    sessions: new Map(),
    byPath: new Map(),
    remoteCreates: [], // { workspaceId, agentPreset }
    workspaceCreates: [], // { path }（modern 栈：先幂等建/复用作品目录的工作区）
    retains: [], // { id, source }
    releases: 0,
    openSessions: [], // uiWorkspace.openSession（0.1.7 公开聚焦入口，首选路径）
    replaceMains: [], // { id, panel } —— uiWorkspace.replaceMain 退路
    refreshes: 0,
    legacyCalls: 0, // workspaces.create / sessions.create / select 任一被调都 +1（modern 下必须保持 0）
    drafts: new Map(), // conversation.input.shell 的每会话草稿（id → { draft, listeners }）
  }
  let seq = 0

  function makeSession(id) {
    const chat = { nodes: new Map(), order: [] }
    const listeners = new Set()
    const live = {
      id,
      async prompt(parts) {
        const body = parts?.[0]?.text || ''
        const key = `n${chat.order.length + 1}`
        chat.nodes.set(key, { kind: 'user', data: { content: [{ type: 'text', text: body }] } })
        chat.order.push(key)
        for (const fn of listeners) fn()
        return { ok: true }
      },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
      getSnapshot: () => ({ chat, running: false, queue: [], pending: [], hasMore: false }),
    }
    state.sessions.set(id, live)
    return live
  }

  const sessions = {
    async refresh() { state.refreshes++ },
    list: { getSnapshot: () => ({ byId: Object.fromEntries([...state.sessions.keys()].map((k) => [k, true])) }) },
    binding: (id) => (state.sessions.has(id) ? { session: state.sessions.get(id) } : null),
    retain(id, opts) {
      state.retains.push({ id, source: opts?.source })
      return { sessionId: id, release: () => { state.releases++ } }
    },
  }

  const remoteSession = () => ({
    async create(payload) {
      state.remoteCreates.push(payload)
      if (options.refuseCreate) return { ok: false, error: { code: 'agent-preset/not-found', message: 'preset missing' } }
      const id = `sess-m${++seq}`
      makeSession(id)
      return { ok: true, value: { sessionId: id, agentPreset: payload.agentPreset } }
    },
  })

  const workspaces = {
    async create(input) {
      // 与真内核一致：按规范路径幂等复用（同 path 返回同一 workspaceId）
      state.workspaceCreates.push(input)
      return { workspaceId: 'ws-m1', path: input.path, title: '', sessionIds: [] }
    },
  }
  const connection = { agentPresets: { select: async () => { state.legacyCalls++; throw new Error('modern 下不应调 select') } } }
  const uiWorkspace = options.withUiWorkspace
    ? () => ({
        // 0.1.7 的公开聚焦入口；options.uiOpenSession === false 模拟只有内部方法的老形态
        ...(options.uiOpenSession === false ? {} : { openSession: (id) => { state.openSessions.push(id) } }),
        replaceMain: (id, signal, panel) => { state.replaceMains.push({ id, panel }) },
      })
    : () => null

  // 0.1.7 的 conversation.input.shell：binding 缺失时抛错（与真内核一致）；
  // shell = { state: {getSnapshot/subscribe}, actions.setDraft }，草稿存 state.drafts。
  const conversation = () => ({
    input: {
      shell(id) {
        if (!state.sessions.has(id)) throw new Error(`conversation.input: session "${id}" resolved no binding`)
        if (!state.drafts.has(id)) state.drafts.set(id, { draft: '', listeners: new Set() })
        const rec = state.drafts.get(id)
        return {
          state: {
            getSnapshot: () => ({ draft: rec.draft, attachmentIds: [], phase: 'idle' }),
            subscribe: (fn) => { rec.listeners.add(fn); return () => rec.listeners.delete(fn) },
          },
          actions: {
            setDraft: (text) => { rec.draft = String(text); for (const fn of [...rec.listeners]) fn() },
          },
        }
      },
    },
  })

  const api = async (route, opts, query) => {
    if (route === 'companion') {
      const body = opts?.body ? JSON.parse(opts.body) : null
      if (body?.sessionId) { state.byPath.set(body.path, body.sessionId); return { ok: true } }
      if (body?.prepare) return { ok: true, preset: 'writing-companion', registered: true }
      const p = query?.path || body?.path
      return { ok: true, project: p, sessionId: state.byPath.get(p) || null }
    }
    if (route === 'coordination') {
      const body = opts?.body ? JSON.parse(opts.body) : null
      if (query?.path) return { ok: true, record: safeRead(normKey(query.path)) }
      const key = normKey(body.path)
      const fns = {
        claim: host.claimCoordination,
        creating: host.markCreatingCoordination,
        confirm: host.confirmCoordination,
        uncertain: host.markUncertainCoordination,
        release: host.releaseCoordination,
      }
      const fn = fns[body.op]
      if (!fn) return { ok: false, error: 'unknown-op' }
      const r = fn({ projectKey: key, operationToken: body.operationToken, sessionId: body.sessionId, workspaceId: body.workspaceId, owner: body.owner })
      const { _outcome, stale, ...record } = r
      return { ok: true, outcome: _outcome, record }
    }
    throw new Error('unexpected route ' + route)
  }

  return { sessions, workspaces, connection, api, state, remoteSession, uiWorkspace, conversation }
}

const makeModernAdapter = (kernel) => createHarnessAdapter({
  sessions: kernel.sessions,
  workspaces: kernel.workspaces,
  connection: kernel.connection,
  remoteSession: kernel.remoteSession,
  uiWorkspace: kernel.uiWorkspace,
  conversation: kernel.conversation,
  api: kernel.api,
  wait: sleep,
  log: () => {},
})

await ok('M01 modern：createMode=modern，workspaces.create 幂等取工作区 + remote.create 一把建并绑 preset，不碰旧栈', async () => {
  const kernel = createModernKernel()
  const adapter = makeModernAdapter(kernel)
  assert.equal(adapter.capabilities().createMode, 'modern')
  assert.equal(adapter.capabilities().canCreate, true)
  const project = freshProject('M01-作品')
  const handle = await adapter.connect(project, 'op-m01')
  const snap = handle.getSnapshot()
  assert.equal(snap.status, 'ready')
  assert.equal(kernel.state.workspaceCreates.length, 1)
  assert.equal(kernel.state.workspaceCreates[0].path, project, '工作区按作品目录幂等建/复用')
  assert.equal(kernel.state.remoteCreates.length, 1)
  assert.equal(kernel.state.remoteCreates[0].agentPreset, 'writing-companion')
  assert.equal(kernel.state.remoteCreates[0].workspaceId, 'ws-m1', '必须用 workspaceId 建会话（cwd 建的会话不挂工作区，hero 输入框 inert）')
  assert.equal(kernel.state.legacyCalls, 0, 'modern 路径不得触碰 sessions.create/select')
  handle.dispose()
})

await ok('M02 modern：create 被拒（agent-preset/not-found）→ error，记录停在 creating（与 legacy 同语义）', async () => {
  const kernel = createModernKernel({ refuseCreate: true })
  const adapter = makeModernAdapter(kernel)
  const project = freshProject('M02-作品')
  const handle = await adapter.connect(project, 'op-m02')
  const snap = handle.getSnapshot()
  assert.equal(snap.status, 'error')
  assert.match(String(snap.error), /preset missing/)
  // releaseCoordination 只在 reserved 阶段真删记录；已进入 creating 的失败按设计留在记录里
  // （删除无法与并发对端仲裁），与 legacy 栈的 create-failed 路径行为一致。
  const rec = safeRead(normKey(project))
  assert.equal(rec?.phase, 'creating')
  assert.equal(rec?.sessionId ?? null, null)
  handle.dispose()
})

await ok('M03 modern：无 uiWorkspace 时聚焦走 retain(mainView)，切换/dispose 释放', async () => {
  const kernel = createModernKernel()
  const adapter = makeModernAdapter(kernel)
  const project = freshProject('M03-作品')
  const handle = await adapter.connect(project, 'op-m03')
  const id = handle.getSnapshot().sessionId
  // 创建即聚焦：retain(mainView) 调过一次，由 handle 持有
  assert.deepEqual(kernel.state.retains, [{ id, source: 'mainView' }])
  // 打开完整会话：同会话再聚焦 → 释放上一个再 retain
  handle.openFullSession()
  assert.equal(kernel.state.retains.length, 2)
  assert.equal(kernel.state.releases, 1, '换留存前必须先释放旧的')
  handle.dispose()
  assert.equal(kernel.state.releases, 2, 'dispose 必须释放持有的 mainView 留存')
})

await ok('M04 modern：有 uiWorkspace 时聚焦走 openSession（公开、reveal），adapter 不自己 retain', async () => {
  const kernel = createModernKernel({ withUiWorkspace: true })
  const adapter = makeModernAdapter(kernel)
  const project = freshProject('M04-作品')
  const handle = await adapter.connect(project, 'op-m04')
  const id = handle.getSnapshot().sessionId
  assert.deepEqual(kernel.state.openSessions, [id])
  assert.equal(kernel.state.replaceMains.length, 0, '有 openSession 时不得走内部 replaceMain')
  assert.equal(kernel.state.retains.length, 0, 'uiWorkspace 可用时不得自行 retain（避免第二 mainView 留存）')
  handle.openFullSession()
  assert.deepEqual(kernel.state.openSessions, [id, id])
  handle.dispose()
  assert.equal(kernel.state.releases, 0)
})

await ok('M04b modern：uiWorkspace 只有 replaceMain 时退到它，且必须 reveal（preserve 会让全局面板盖住会话）', async () => {
  const kernel = createModernKernel({ withUiWorkspace: true, uiOpenSession: false })
  const adapter = makeModernAdapter(kernel)
  const project = freshProject('M04b-作品')
  const handle = await adapter.connect(project, 'op-m04b')
  const id = handle.getSnapshot().sessionId
  assert.equal(kernel.state.openSessions.length, 0)
  assert.deepEqual(kernel.state.replaceMains, [{ id, panel: 'reveal' }])
  assert.equal(kernel.state.retains.length, 0)
  handle.dispose()
})

await ok('M05 能力报告：0.1.7 面缺 create 时 missing 提双栈而非只骂 select', async () => {
  const kernel = createModernKernel()
  const adapter = makeModernAdapter(kernel)
  const caps = adapter.capabilities()
  assert.equal(caps.flags['remote.session.create'], true)
  assert.equal(caps.flags['sessions.open'], false)
  assert.equal(caps.flags['conversation.input.shell'], true, '0.1.7 输入面应识别 conversation.input.shell')
  assert.ok(!caps.degraded.some((d) => d.includes('provideInfo')), '有 shell 时 provideInfo 缺失不再是软缺口')
  assert.ok(!caps.missing.join(',').includes('agentPresets.select'), '0.1.7 不该再报 agentPresets.select 缺失')
  // 连 remote.create 也没有：报双栈缺口；没有 conversation：输入面报组合软缺口
  const bare = createHarnessAdapter({ sessions: kernel.sessions, api: kernel.api, wait: sleep, log: () => {} })
  const caps2 = bare.capabilities()
  assert.equal(caps2.createMode, null)
  assert.equal(caps2.canCreate, false)
  assert.ok(caps2.missing.some((m) => m.includes('remote.session.create') && m.includes('agentPresets.select')))
  assert.ok(caps2.degraded.includes('input:sessions.provideInfo|conversation.input.shell'), '两条输入通道都缺时才报输入面软缺口')
})

await ok('M06 modern：草稿走 conversation.input.shell（读/写/订阅），不再需要 provideInfo', async () => {
  const kernel = createModernKernel({ withUiWorkspace: true })
  const adapter = makeModernAdapter(kernel)
  const project = freshProject('M06-作品')
  const handle = await adapter.connect(project, 'op-m06')
  const id = handle.getSnapshot().sessionId
  assert.equal(handle.getDraft(), '')
  handle.setDraft('第一段')
  assert.equal(kernel.state.drafts.get(id)?.draft, '第一段', 'setDraft 必须落到 shell')
  // shell 快照驱动 adapter 快照（读通道 + 订阅通知）
  let notified = 0
  const off = handle.subscribe(() => { notified++ })
  assert.equal(handle.getSnapshot().draft, '第一段')
  // 原生侧编辑（经 shell.actions）→ adapter 订阅者必须收到通知
  kernel.conversation().input.shell(id).actions.setDraft('原生侧改过')
  assert.ok(notified >= 1, 'shell.state 变更必须通知 adapter 订阅者')
  assert.equal(handle.getDraft(), '原生侧改过')
  assert.equal(handle.getSnapshot().draft, '原生侧改过')
  off()
  handle.dispose()
})

await ok('M07 modern：binding 缺失时不碰 shell，setDraft 报 input-not-ready 而不是内核异常', async () => {
  const kernel = createModernKernel()
  const adapter = makeModernAdapter(kernel)
  const created = await kernel.remoteSession().create({ cwd: '/x', agentPreset: 'writing-companion' })
  const id = created.value.sessionId
  // 模拟"会话在列表里、但还没有任何 retained scope"：shell(id) 在真内核会抛 resolved no binding
  kernel.sessions.binding = () => null
  const handle = adapter.attach(freshProject('M07-作品'), id)
  assert.equal(handle.getSnapshot().status, 'ready')
  assert.equal(handle.getDraft(), '', 'binding 缺失时读草稿返回空而不是抛错')
  assert.throws(() => handle.setDraft('x'), /原生输入框尚未就绪/)
  assert.equal(kernel.state.drafts.size, 0, 'binding 缺失时不得创建 shell（真内核会抛 resolved no binding）')
  handle.dispose()
})

// ---- 能力缺口 → 作者语言（capability-notice，2026-10 补：缺口以前只在内存里算，界面上不吭声）----
const { companionCapability } = await import(pathToFileURL(path.join(HERE, '../src/client/features/companion/capability-notice.js')).href)

await ok('N01 会话服务未挂载 = blocked：说清原因与「想法不会丢」，不泄露内核能力名', async () => {
  const adapter = createHarnessAdapter({ sessions: null, api: async () => ({ ok: true }) })
  const c = companionCapability(adapter.capabilities())
  assert.equal(c.level, 'blocked')
  assert.equal(c.canSend, false)
  assert.match(c.reasons.join('；'), /内核会话服务未挂载/)
  assert.match(c.note, /本地草稿/)
  const authorText = c.headline + c.reasons.join('；') + c.note
  assert.ok(!/sessions\.binding|remote\.session|provideInfo|coordination|workspaces\.create/.test(authorText), '作者可见文案里不该出现内核能力名')
})

await ok('N02 有会话但缺创建通道 = limited（已有会话照常用，不该谎称连不上）', async () => {
  const c = companionCapability({
    flags: { sessions: true, 'sessions.refresh': true, 'sessions.binding': true, api: true, coordination: true },
    missing: ['create:remote.session.create+workspaces.create|sessions.create+workspaces.create+agentPresets.select'],
    degraded: [],
    canSend: true,
  })
  assert.equal(c.level, 'limited')
  assert.equal(c.canSend, true, '已有会话仍可发送，不该降级成 blocked')
  assert.match(c.reasons.join('；'), /没有创建写作伙伴会话的通道/)
  assert.match(c.reasons.join('；'), /已有会话仍可继续/)
  assert.ok(!/workspaces\.create|remote\.session/.test(c.reasons.join('；')), '能力名清单不该原样出现在作者文案里')
})

await ok('N03 软缺口只列作者受影响的那几条，切不到完整会话要说明', async () => {
  const c = companionCapability({
    flags: { sessions: true, 'sessions.binding': true, api: true, coordination: true },
    missing: [],
    degraded: ['sessions.noteAgentPreset', 'sessions.open|retain'],
    canSend: true,
  })
  assert.equal(c.level, 'limited')
  assert.match(c.reasons.join('；'), /无法把主视图切到完整会话/)
  assert.ok(!c.reasons.some((t) => /预设标注|noteAgentPreset/.test(t)), '对作者没有影响的能力位不该出现')
  assert.equal(c.reasons.length, 1)
})

await ok('N04 能力齐备 = ok：不渲染任何缺口条', async () => {
  const c = companionCapability({
    flags: { sessions: true, 'sessions.binding': true, api: true, coordination: true },
    missing: [], degraded: [], canSend: true,
  })
  assert.equal(c.level, 'ok')
  assert.deepEqual(c.reasons, [])
  assert.equal(c.headline, '')
  assert.equal(c.note, '')
})

console.log(`\nadapter 协调验收: ${pass} 项通过`)
fs.rmSync(temp, { recursive: true, force: true })
