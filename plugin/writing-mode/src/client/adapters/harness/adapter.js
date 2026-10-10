/**
 * Harness adapter（方案 P2 §3.1–§3.3）：客户端**唯一**的 native 接触面。
 *
 * 职责边界：
 *   - 会话查找/创建/绑定走这里；UI 不再直接调 workspaces.create / sessions.create /
 *     connection.agentPresets.select，也不直接读 chat.nodes/order（改读 handle 的快照）。
 *   - 创建协调：进程内按 host 规范项目身份共用创建中的 Promise；跨窗口由 host 的
 *     协调记录（reserved → creating → bound / uncertain）仲裁，见 coordination-client.js。
 *   - 迟到结果归位：每个 handle 绑定自己的 projectKey/sessionId/operationToken，
 *     异步返回后先核对身份再交付，绝不让 A 的结果落到 B。
 *   - 受理不确定：send 返回 accepted|rejected|uncertain；uncertain 保留正文、先核对原生
 *     回合/队列，**禁止自动重发**（重发是作者的决定）。
 *
 * 本模块不 import React/DOM/组件，可在 node 里用 fixture 直接测（见 test/adapter-*.mjs）。
 */
import { canonicalProjectKey, projectIdentityOf } from './identity.js'
import { projectChat, turnBaseline, turnEvidence, createSnapshotCache } from './projection.js'
import { httpCoordination } from './coordination-client.js'

/** 等待对方窗口完成绑定的轮询参数（只用于发现，不授权抢占，见方案 §3.2 末段）。 */
export const PEER_WAIT = { attempts: 40, intervalMs: 250 }

/** uiWorkspace.replaceMain 需要的 signal：聚焦从不取消，给一个永不 abort 的。 */
const FOCUS_SIGNAL = new AbortController().signal

export function adapterError(code, message, extra = {}) {
  const err = new Error(message || code)
  err.code = code
  Object.assign(err, extra)
  return err
}

export function newOperationToken() {
  const rand = Math.random().toString(36).slice(2, 10)
  return `op-${Date.now().toString(36)}-${rand}`
}

const has = (obj, name) => Boolean(obj && typeof obj[name] === 'function')

export function createHarnessAdapter(deps = {}) {
  const {
    sessions = null,
    workspaces = null,
    connection = null,
    remoteSession = () => null,
    uiWorkspace = () => null,
    uiConversation = () => null,
    conversation = () => null,
    api = null,
    coordination = api ? httpCoordination(api) : null,
    now = () => Date.now(),
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = () => {},
  } = deps

  /** 进程内：canonical key → 正在进行的绑定 Promise（同键不重复创建）。 */
  const inflight = new Map()

  function capabilities() {
    const remote = typeof remoteSession === 'function' ? remoteSession() : null
    const conv = typeof conversation === 'function' ? conversation() : null
    const modernCreate = has(remote, 'create') && has(workspaces, 'create')
    const legacyCreate = has(sessions, 'create') && has(workspaces, 'create') && has(connection?.agentPresets, 'select')
    const flags = {
      sessions: Boolean(sessions),
      'sessions.refresh': has(sessions, 'refresh'),
      'sessions.create': has(sessions, 'create'),
      'sessions.open': has(sessions, 'open'),
      'sessions.retain': has(sessions, 'retain'),
      'sessions.binding': has(sessions, 'binding'),
      'sessions.provideInfo': has(sessions, 'provideInfo'),
      'sessions.noteAgentPreset': has(sessions, 'noteAgentPreset'),
      'workspaces.create': has(workspaces, 'create'),
      'agentPresets.select': has(connection?.agentPresets, 'select'),
      'remote.session.create': modernCreate,
      'conversation.input.shell': has(conv?.input, 'shell'),
      coordination: Boolean(coordination && coordination.claim),
      api: typeof api === 'function',
    }
    // 双栈创建：0.1.7 起 workspaces.create（按规范路径幂等）拿到作品目录的工作区，
    // 再 remote.session.create({workspaceId, agentPreset}) 一把建并绑 preset——必须走 workspaceId，
    // 用 cwd 建的会话不挂任何工作区，主视图 hero 的输入框会停在 inert（"选择工作区"，0.1.7-rc.2 实测）；
    // 旧内核走 workspaces.create + sessions.create + agentPresets.select 三步。任一路通即可创建。
    const createMode = modernCreate ? 'modern' : legacyCreate ? 'legacy' : null
    // 硬门槛只列**创建会话**真正需要的基础能力；读写草稿/打开会话所需的是软缺口（degraded），
    // 不该阻断"已有会话"的正常使用（2026-09-14 实测：把 sessions.binding 当硬门槛会让
    // 只有 provideInfo 的内核连"采用已有会话"都做不了）。
    const required = ['sessions', 'sessions.refresh', 'coordination', 'api']
    const missing = required.filter((k) => !flags[k])
    if (!createMode) {
      // 两条栈的缺口合成一条说清，报错才不会只提旧栈而误导（0.1.7 曾误报 agentPresets.select）
      missing.push('create:remote.session.create+workspaces.create|sessions.create+workspaces.create+agentPresets.select')
    }
    // 输入面（读写草稿/订阅输入态）在 0.1.7 是 conversation.input.shell，旧内核是 sessions.provideInfo；
    // 任一存在即可，两个都没才报软缺口。
    const soft = ['sessions.binding', 'sessions.noteAgentPreset']
    const degraded = soft.filter((k) => !flags[k])
    if (!flags['sessions.provideInfo'] && !flags['conversation.input.shell']) degraded.push('input:sessions.provideInfo|conversation.input.shell')
    if (!flags['sessions.open'] && !flags['sessions.retain']) degraded.push('sessions.open|retain')
    return {
      flags,
      missing,
      degraded,
      createMode,
      canCreate: missing.length === 0,
      // 已有会话时能干活的条件（不需要创建能力）：能拿到 store 与输入面
      canSend: Boolean(flags.sessions && flags['sessions.binding'] && flags.api),
    }
  }

  /**
   * 聚焦会话（0.1.7 删了 sessions.open）。优先级：
   *   1. uiWorkspace.openSession —— 公开入口（= replaceMain(id, 内部 signal, 'reveal')）：
   *      释放旧 mainReference（publishMain 有粘性规则，直接 retain 抢不过它）、
   *      清掉覆盖主区域的全局面板（'选择工作区' hero）。侧栏点击会话走的就是它；
   *   2. uiWorkspace.replaceMain(id, signal, 'reveal') —— 旧版没有 openSession 时的等价物。
   *      注意必须传 'reveal'：'preserve' 不会 layout.selectPanel(null)，全局面板会盖住会话
   *      （0.1.7 实测主视图停在"选择工作区" hero）；
   *   3. sessions.retain(id, {source:'mainView'}) —— 没有 uiWorkspace 时的尽力而为，
   *      由 holder 持有，切换/dispose 时释放（有旧 mainView 持有者时切不动视图，仅保证 scope 活着）；
   *   4. 旧内核 sessions.open。
   */
  function focusSession(id, holder) {
    if (!id) return false
    const uiw = typeof uiWorkspace === 'function' ? uiWorkspace() : null
    if (has(uiw, 'openSession')) {
      try {
        uiw.openSession(id)
        return true
      } catch { /* 落到 replaceMain/retain/open */ }
    }
    if (has(uiw, 'replaceMain')) {
      try {
        uiw.replaceMain(id, FOCUS_SIGNAL, 'reveal')
        return true
      } catch { /* 落到 retain/open */ }
    }
    if (has(sessions, 'retain')) {
      const ref = sessions.retain(id, { source: 'mainView' })
      if (holder) {
        holder.ref?.release?.()
        holder.ref = ref
      }
      return true
    }
    if (has(sessions, 'open')) {
      sessions.open(id)
      return true
    }
    return false
  }

  function sessionStoreOf(id) {
    if (!id || !has(sessions, 'binding')) return null
    try {
      return sessions.binding(id)?.session || null
    } catch {
      return null
    }
  }

  function liveSessionIds() {
    try {
      const snap = sessions?.list?.getSnapshot?.()
      return new Set(Object.keys(snap?.byId || {}))
    } catch {
      return new Set()
    }
  }

  /** 读 host 权威身份 + 已有绑定。UI 侧不再自己解析项目路径。 */
  async function resolveBinding(path) {
    if (typeof api !== 'function') throw adapterError('api-missing', '写作模式 HTTP 服务不可用')
    const res = await api('companion', undefined, { path })
    if (!res?.ok) throw adapterError(res?.error || 'binding-unavailable', '无法解析作品身份：' + (res?.error || 'unknown'))
    const identity = projectIdentityOf(res, path)
    if (!identity.authoritative) throw adapterError('identity-unverified', 'host 未返回规范作品身份，暂不建立关联')
    return { binding: res, identity }
  }

  /** 创建阶段的残留状态判定：只读 host 记录，不在锁内做任何内核调用。 */
  async function readRecord(path) {
    if (!coordination?.read) return null
    try {
      const r = await coordination.read({ path })
      return r?.ok ? r.record : null
    } catch {
      return null
    }
  }

  async function openBinding({ path, operationId, preset }) {
    const { binding, identity } = await resolveBinding(path)
    const key = identity.key
    const rec = await readRecord(path)
    const claim = await coordination.claim({ path, operationToken: operationId, owner: String(preset?.owner || 'window') })
    if (!claim.ok) throw adapterError(claim.error || 'coordination-unavailable', '协调服务不可用')

    log(`adapter claim ${key} → ${claim.outcome}`)

    if (claim.outcome === 'bound') {
      const found = verifyRecord(claim.record, binding)
      if (found.status === 'ready' || found.status === 'missing') return { ...found, key, path, binding }
      return { ...found, key, path, binding }
    }
    if (claim.outcome === 'in-progress') {
      const peer = await waitForPeer({ path, binding, key })
      return { ...peer, key, path, binding }
    }
    if (claim.outcome === 'uncertain') {
      return { status: 'uncertain', sessionId: claim.record?.sessionId || null, workspaceId: claim.record?.workspaceId || null, record: claim.record, wrongness: 'previous-attempt-unconfirmed', key, path, binding }
    }
    // claimed：本次拿到创建权。结果必须**带上身份**——否则新建成功后的 handle 缺 projectKey/path，
    // 之后既无法定位原项目，也无法判断"是不是同一个项目"（2026-09-14 复核 B03 实测）。
    void rec
    const created = await createNow({ path, operationId, key, binding })
    return { key, path, binding, ...created }
  }

  /** 已有绑定：核对原生会话是否还在（被删要呈现状态与恢复操作，不静默新建）。 */
  function verifyRecord(record, binding) {
    const sessionId = record?.sessionId || binding?.sessionId || null
    if (!sessionId) return { status: 'error', error: 'record-without-session', record }
    if (!liveSessionIds().has(sessionId)) return { status: 'missing', sessionId, workspaceId: record?.workspaceId || null, record }
    return { status: 'ready', sessionId, workspaceId: record?.workspaceId || null, record, outcome: 'existing' }
  }

  /** 另一个窗口正在创建：等它 confirm；超时就把决定权交回作者（保留记录，不新建）。 */
  async function waitForPeer({ path, binding, key }) {
    for (let i = 0; i < PEER_WAIT.attempts; i++) {
      await wait(PEER_WAIT.intervalMs)
      const rec = await readRecord(path)
      if (!rec) return { status: 'error', error: 'record-vanished' }
      if (rec.phase === 'bound' && rec.sessionId) return { ...verifyRecord(rec, binding), outcome: 'adopted-peer' }
      if (rec.phase === 'uncertain') return { status: 'uncertain', sessionId: rec.sessionId || null, workspaceId: rec.workspaceId || null, record: rec, wrongness: 'peer-unconfirmed' }
      if (rec.phase === null) return { status: 'error', error: 'record-cleared-while-waiting' }
    }
    const rec = await readRecord(path)
    return { status: 'waiting', sessionId: null, workspaceId: rec?.workspaceId || null, record: rec, wrongness: 'peer-still-creating' }
  }

  /** 真正创建：workspace → preset → session → 关联 → host 确认。每一步失败都有明确落点。 */
  async function createNow({ path, operationId, key, binding }) {
    const caps = capabilities()
    if (!caps.canCreate) {
      await coordination.release({ path, operationToken: operationId })
      throw adapterError('capabilities-missing', '内核未提供创建会话所需能力：' + caps.missing.join(', '), { missing: caps.missing })
    }
    await coordination.creating({ path, operationToken: operationId })
    let workspaceId = null
    let sessionId = null
    try {
      const prepared = await api('companion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, prepare: true }) })
      if (!prepared?.ok) throw adapterError(prepared?.error || 'preset-unavailable', '写作伙伴预设不可用：' + (prepared?.error || 'unknown'))
      if (caps.createMode === 'modern') {
        // 0.1.7：workspaces.create 按规范路径幂等（同路径复用已有工作区，不改标题），
        // remote.session.create({workspaceId, agentPreset}) 创建即绑 preset（免 select、
        // 免 agent-preset/locked 竞态），host 同时把 cwd 定在工作区路径并 attach。
        const workspace = await workspaces.create({ path: binding.project })
        workspaceId = workspace?.workspaceId || null
        if (!workspaceId) throw adapterError('workspace-create-empty', '工作区创建未返回标识')
        const remote = remoteSession()
        const created = await remote.create({ workspaceId, agentPreset: prepared.preset })
        if (!created?.ok) {
          // 信封式明确拒绝（如 agent-preset/not-found）：会话确定没建成——不像抛错那样
          // "结果未知"，不进 uncertain；走确定失败（外层释放协调，作者可重试）。
          throw adapterError(created?.error?.code || 'session-create-refused', created?.error?.message || '内核拒绝创建会话', { definiteRefusal: true })
        }
        sessionId = created.value?.sessionId || null
        if (!sessionId) throw adapterError('session-create-empty', '会话创建未返回标识')
        const saved = await api('companion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, sessionId }) })
        if (!saved?.ok) throw adapterError(saved?.error || 'binding-save-failed', '会话已创建，但作品关联未保存：' + (saved?.error || 'unknown'))
        if (has(sessions, 'refresh')) await sessions.refresh()
        const confirmed = await coordination.confirm({ path, operationToken: operationId, sessionId, workspaceId })
        if (confirmed.outcome !== 'bound') {
          // 会话确实建好了，只有协调记录没写上：进 uncertain（可继续关联），**不重建**
          return { status: 'uncertain', sessionId, workspaceId, record: confirmed.record, wrongness: 'confirm-' + confirmed.outcome, outcome: 'created-unconfirmed' }
        }
        const focusHolder = { ref: null }
        focusSession(sessionId, focusHolder)
        return { status: 'ready', sessionId, workspaceId, record: confirmed.record, outcome: 'created', focusRef: focusHolder.ref }
      }
      const workspace = await workspaces.create({ path: binding.project })
      workspaceId = workspace?.workspaceId || null
      if (!workspaceId) throw adapterError('workspace-create-empty', '工作区创建未返回标识')
      sessionId = await sessions.create({ workspaceId })
      if (!sessionId) throw adapterError('session-create-empty', '会话创建未返回标识')
      const selected = await connection.agentPresets.select({ sessionId, agentPreset: prepared.preset })
      if (!selected?.result?.ok) throw adapterError(selected?.result?.error?.code || 'preset-select-failed', selected?.result?.error?.message || '角色预设应用失败')
      if (has(sessions, 'noteAgentPreset')) sessions.noteAgentPreset(sessionId, selected.result.value?.agentPreset)
      const saved = await api('companion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, sessionId }) })
      if (!saved?.ok) throw adapterError(saved?.error || 'binding-save-failed', '会话已创建，但作品关联未保存：' + (saved?.error || 'unknown'))
      await sessions.refresh()
      const confirmed = await coordination.confirm({ path, operationToken: operationId, sessionId, workspaceId })
      if (confirmed.outcome !== 'bound') {
        // 会话确实建好了，只有协调记录没写上：进 uncertain（可继续关联），**不重建**
        return { status: 'uncertain', sessionId, workspaceId, record: confirmed.record, wrongness: 'confirm-' + confirmed.outcome, outcome: 'created-unconfirmed' }
      }
      await sessions.open(sessionId)
      return { status: 'ready', sessionId, workspaceId, record: confirmed.record, outcome: 'created' }
    } catch (err) {
      const code = err?.code || 'create-failed'
      if (sessionId) {
        await coordination.uncertain({ path, operationToken: operationId, sessionId, workspaceId, reason: code })
        return { status: 'uncertain', sessionId, workspaceId, record: await readRecord(path), wrongness: code, error: err.message, outcome: 'created-partially' }
      }
      if (workspaceId && !err?.definiteRefusal) {
        // workspace 已建、session 结果不明（H04）：部分绑定 + uncertain，不假装 bound
        await coordination.confirm({ path, operationToken: operationId, workspaceId })
        await coordination.uncertain({ path, operationToken: operationId, workspaceId, reason: code })
        return { status: 'uncertain', sessionId: null, workspaceId, record: await readRecord(path), wrongness: code, error: err.message, outcome: 'workspace-only' }
      }
      await coordination.release({ path, operationToken: operationId })
      return { status: 'error', error: err.message, code, record: await readRecord(path) }
    }
  }

  /**
   * 建立连接并返回 handle。in-process 共用：同 canonical key 只跑一次创建。
   * operationToken 由调用方给出（同一逻辑操作重复调用要传同一个 token，避免连点建两个会话）。
   */
  async function connect(projectIdentity, operationToken, options = {}) {
    const operationId = operationToken || newOperationToken()
    const localKey = canonicalProjectKey(projectIdentity)
    if (!localKey) throw adapterError('project-identity-required', '缺少作品身份')
    const existing = inflight.get(localKey) || (options.canonicalKey ? inflight.get(options.canonicalKey) : null)
    if (existing) {
      const shared = await existing
      log(`adapter in-process share ${localKey}`)
      return makeHandle({ ...shared, operationId, shared: true, requestedPath: projectIdentity })
    }
    const promise = openBinding({ path: projectIdentity, operationId, preset: options })
    inflight.set(localKey, promise)
    try {
      const resolved = await promise
      // host 给的规范身份可能与本地键不同，补一条 so 后续同键调用也能共用
      if (resolved.key && resolved.key !== localKey && !inflight.has(resolved.key)) inflight.set(resolved.key, Promise.resolve(resolved))
      return makeHandle({ ...resolved, operationId, requestedPath: projectIdentity })
    } finally {
      inflight.delete(localKey)
    }
  }

  /** 每个 handle 都是独立订阅者，但绑定身份一致；dispose 只释放订阅。 */
  function makeHandle(bound) {
    const { key, path, binding } = bound
    const operationId = bound.operationId || newOperationToken()
    let state = {
      status: bound.status,
      sessionId: bound.sessionId || null,
      workspaceId: bound.workspaceId || null,
      record: bound.record || null,
      error: bound.error || null,
      wrongness: bound.wrongness || null,
    }
    const snapshotCache = createSnapshotCache()
    const listeners = new Set()
    const nativeUnsubs = []
    let attachedSessionId = null
    let attachedInputId = null
    let disposed = false
    // retain 退路下持有的 mainView 留存（uiWorkspace 路径由 UI 自己持有，不在此列）
    const focusHolder = { ref: bound.focusRef || null }

    const currentSession = () => sessionStoreOf(state.sessionId)
    const currentInfo = () => {
      if (!state.sessionId || !has(sessions, 'provideInfo')) return null
      try {
        return sessions.provideInfo(state.sessionId)
      } catch {
        return null
      }
    }
    /**
     * 0.1.7 输入面：conversation.input.shell(sessionId)。shell(id) 要求该会话已有 retained
     * binding（没有会抛 "resolved no binding"），所以先查 sessions.binding；
     * binding 出现前（创建后尚未聚焦）返回 null，调用方按"输入面未就绪"处理。
     */
    const inputShell = () => {
      if (!state.sessionId || !has(sessions, 'binding')) return null
      const conv = typeof conversation === 'function' ? conversation() : null
      if (!has(conv?.input, 'shell')) return null
      try {
        if (!sessions.binding(state.sessionId)) return null
        return conv.input.shell(state.sessionId) || null
      } catch {
        return null
      }
    }
    /**
     * 统一的输入态快照：0.1.7 走 input shell（draft/claim/attachmentIds），
     * 旧内核走 provideInfo 的 hooks.input（draft/claim/imageIds）。缺通道时返回 null。
     */
    const currentInputSnap = () => {
      const shell = inputShell()
      if (shell) {
        const snap = shell.state?.getSnapshot?.() || null
        return snap ? { draft: snap.draft ?? '', claim: snap.claim ?? null, imageIds: snap.attachmentIds || [] } : null
      }
      return currentInfo()?.hooks?.input?.getSnapshot?.() || null
    }

    function notify() {
      if (disposed) return
      for (const fn of [...listeners]) {
        try {
          fn()
        } catch (err) {
          log('adapter listener failed: ' + (err?.message || err))
        }
      }
    }

    function attach(store) {
      if (!store || !has(store, 'subscribe')) return
      const off = store.subscribe(() => notify())
      if (typeof off === 'function') nativeUnsubs.push(off)
    }

    /**
     * 0.2.0 会话图（2026-10-10 修复"面板读不到历史与回复"）。
     *
     * 0.1.7 的 chat 图挂在 `Session.getSnapshot().chat` 上；0.2.0 把消息图搬到了
     * **客户端 UI 组装层**：`ctx.uiConversation.binding(binding).target('chat')`
     * —— 官方 ChatView 用的就是这张图（`dsh-client-ui-chat` 的 chatSource），
     * 形状 `{ order, nodes }` 与 `projectChat` 期望的一致，所以投影不用改。
     *
     * 三个必须踩准的点（2026-10-10 只读调研 + 实测）：
     *   1. 必须先 `sessions.retain(id, { source: 'mainView' })`：只 `binding(id)` 是"借"，
     *      没有 retain 时 binding 是 undefined（官方主视图同款源键）。
     *   2. 必须先 `subscribe()`：target 在**首次订阅**时才 activate 并构建快照，
     *      之前 `getSnapshot()` 是 undefined（官方 `BoundConversation.subscribe` 里 activate）。
     *   3. `openState === 'loading'` 只表示"历史首帧还没到"，**不是**读消息的前提：
     *      `prompt()` 根本不看 openState（这解释了"发送通、历史空"）。
     */
    const chatBinding = { sessionId: null, target: null, off: null, ref: null, error: null }

    function disposeChatBinding() {
      try { chatBinding.off?.() } catch { /* 已释放 */ }
      try { chatBinding.ref?.release?.() } catch { /* 旧内核没有 release */ }
      chatBinding.off = null
      chatBinding.ref = null
      chatBinding.target = null
      chatBinding.sessionId = null
    }

    function chatTarget() {
      const id = state.sessionId
      const uiConv = typeof uiConversation === 'function' ? uiConversation() : null
      if (!id || !uiConv || !has(sessions, 'binding')) return null
      if (chatBinding.sessionId === id) return chatBinding.target
      disposeChatBinding()
      chatBinding.sessionId = id
      try {
        if (has(sessions, 'retain')) chatBinding.ref = sessions.retain(id, { source: 'mainView' })
        const binding = sessions.binding(id)
        if (!binding) return null
        const target = uiConv.binding?.(binding)?.target?.('chat') || null
        if (!target) return null
        // 先订阅（激活），再交给调用方读快照
        chatBinding.off = target.subscribe(() => notify())
        chatBinding.target = target
      } catch (err) {
        chatBinding.error = String(err?.message || err)
        chatBinding.target = null
      }
      return chatBinding.target
    }

    /** 会话消息图：0.1.7 直接给 `chat`；0.2.0 走 uiConversation 的 chat target。 */
    function chatGraphOf(chatSnap) {
      if (chatSnap && chatSnap.chat) return chatSnap.chat
      const target = chatTarget()
      if (!target) return null
      try { return target.getSnapshot() || null } catch { return null }
    }

    function ensureAttached() {
      if (attachedSessionId !== state.sessionId) {
        attachedSessionId = state.sessionId
        attachedInputId = null
        if (state.sessionId) attach(currentSession())
      }
      if (!state.sessionId) return
      // 输入面可能晚于会话 store 出现（shell 以 retained binding 为前提，binding 要聚焦后才建立），
      // 所以每次 getSnapshot/subscribe 都补挂一次，而不是只在换会话那一刻挂。
      if (attachedInputId !== state.sessionId) {
        const inputStore = inputShell()?.state || currentInfo()?.hooks?.input || null
        if (inputStore) {
          attach(inputStore)
          attachedInputId = state.sessionId
        }
      }
      void reattachUnboundSession()
    }

    /**
     * 悬空绑定自愈（2026-10-09）：记录是 bound、会话也在内核列表里，但**内核没给它 store**
     * （`sessions.binding(id)` 为空）——这时伙伴面板只能显示空态，作者看到的就是"读不到历史"。
     * 成因实测：记录里的 workspaceId 在 `storages/workspace.json` 里已经不存在（跨应用/并发
     * 写同一份 storages 会让它被覆盖），而会话转录仍在磁盘上（实测 28KB）。
     *
     * 处理（用户拍板：先重挂、失败才重建）：
     *   ① 按作品路径确保工作区存在（workspaces.create 按规范路径幂等）；
     *   ② 用创建路径同一个入口 focusSession 让内核把这条**已有**会话挂回来；
     *   ③ 挂上就把新 workspaceId 补确认进台账（保留原 history，不删记录）。
     * 挂不上：什么都不改，交回既有恢复路径（missing/uncertain 的呈现与手动入口）。
     * 每个 handle 只自动试一次；失败后允许下一次交互再试（内核可能稍后才就绪）。
     */
    let reattachTried = false
    let loadingSince = 0
    async function reattachUnboundSession() {
      if (disposed || reattachTried) return
      if (state.status !== 'ready' || !state.sessionId) return
      // 触发条件（2026-10-09 实测口径）：会话**没有 store**，或者有 store 但 openState 一直卡在
      // 'loading' 且没有 chat 图——后者就是"点开会话读不到历史"的真实现场（实测 26s 不动、无 openError）。
      // 正常的快速加载不触发：loading 持续 3s 以上才认定卡住。
      const session = currentSession()
      const snap = session?.getSnapshot?.() || null
      // 2026-10-10：判据从 `!snap.chat`（0.1.7 的形状，0.2.0 上恒为真 → 会一直误触发重挂）
      // 改成"没有任何消息图"——0.2.0 的图在 uiConversation 的 chat target 上。
      const stuckLoading = Boolean(snap && snap.openState === 'loading' && !chatGraphOf(snap))
      if (session && !stuckLoading) {
        loadingSince = 0
        return
      }
      if (stuckLoading) {
        // 关键：本函数只从 getSnapshot/subscribe 进来，而 store 卡住时**不会再通知**，
        // 于是"第一次记时间戳、等下一次进来再动手"永远不会发生（2026-07-09 实测：一次都没触发）。
        // 改成自己排一个定时器再进来。
        if (!loadingSince) {
          loadingSince = Date.now()
          setTimeout(() => { void reattachUnboundSession() }, 3000)
          return
        }
        if (Date.now() - loadingSince < 3000) return
      }
      reattachTried = true
      const trace = (step, extra) => {
        if (typeof window !== 'undefined' && window.__wmDebugCompanion) {
          console.info('companion-reattach ' + JSON.stringify({ step, sessionId: state.sessionId, workspaceId: state.workspaceId, ...(extra || {}) }))
        }
      }
      trace('start', { hasWorkspacesCreate: has(workspaces, 'create') })
      try {
        let workspaceId = state.workspaceId || null
        if (has(workspaces, 'create')) {
          try {
            const ws = await workspaces.create({ path: binding.project })
            workspaceId = ws?.workspaceId || workspaceId
            trace('workspace-ok', { newWorkspaceId: workspaceId })
          } catch (err) {
            trace('workspace-failed', { error: String(err?.message || err).slice(0, 200) })
            log('reattach: workspace ensure failed: ' + (err?.message || err))
          }
        }
        try {
          focusSession(state.sessionId, focusHolder)
          trace('focus-called')
        } catch (err) {
          trace('focus-failed', { error: String(err?.message || err).slice(0, 200) })
          log('reattach: focus failed: ' + (err?.message || err))
        }
        // 0.2.0：会话 store 有明确的开合生命周期（cold → open / error，见
        // @deepseek-ai/dsh-api-session-controller 的 Session.open()）。只 focus 不够——
        // openState 停在 cold/loading 时 chat 图永远不会到达，面板就是"发了没反应"的空态。
        // 这里显式调 open() 并限时等待（README：仅在 open() 拒绝/取消时以 openState:'error' 表示）。
        try {
          const sess = currentSession()
          const before = sess?.getSnapshot?.()?.openState ?? null
          if (sess && typeof sess.open === 'function' && before !== 'open') {
            await Promise.race([Promise.resolve(sess.open()).catch((err) => { trace('open-rejected', { error: String(err?.message || err).slice(0, 160) }) }), wait(8000)])
            trace('open-called', { before, after: currentSession()?.getSnapshot?.()?.openState ?? null, hasChat: Boolean(currentSession()?.getSnapshot?.()?.chat) })
          } else {
            trace('open-skipped', { before, hasOpen: typeof sess?.open === 'function' })
          }
        } catch (err) {
          trace('open-failed', { error: String(err?.message || err).slice(0, 160) })
        }
        for (let i = 0; i < 12; i++) {
          await wait(200)
          if (disposed) return
          if (!currentSession()) continue
          state = { ...state, workspaceId }
          if (workspaceId && state.record) {
            try {
              const conf = await coordination.confirm({
                path,
                operationToken: state.record.operationToken || operationId,
                sessionId: state.sessionId,
                workspaceId,
              })
              if (conf?.record) state = { ...state, record: conf.record }
            } catch (err) {
              log('reattach: confirm failed: ' + (err?.message || err))
            }
          }
          notify()
          trace('attached', { workspaceId })
          return
        }
        trace('store-never-appeared')
        reattachTried = false
      } catch (err) {
        reattachTried = false
        log('reattach failed: ' + (err?.message || err))
      }
    }

    function refreshStatus() {
      if (state.status === 'ready') return
      // 只有"等待对端"这一种状态可以因为会话出现而自动转 ready，且必须记录已 bound。
      // uncertain / missing 是**要呈现给作者的结论**，不能因为"会话恰好存在"就被抹平成正常
      // （2026-09-14 fixture 实测：确认失败的 uncertain 被自动升成 ready，恢复入口随之消失）。
      if (state.status === 'waiting' && state.sessionId && liveSessionIds().has(state.sessionId) && state.record?.phase === 'bound') {
        state.status = 'ready'
      }
    }

    function getSnapshot() {
      if (disposed) throw adapterError('disposed', 'handle 已释放')
      ensureAttached()
      refreshStatus()
      const session = currentSession()
      const chatSnap = session?.getSnapshot?.() || null
      const inputSnap = currentInputSnap()
      const caps = capabilities()
      const statusKey = `${state.status}|${state.record?.phase || ''}|${state.record?.version ?? ''}|${state.sessionId || ''}|${state.error || ''}`
      // 指纹用**稳定对象身份**（chat 图）+ 关键标量 + 结构性签名：
      // 该换引用时换（内容变了），不该换时不换（没变）。结构性签名是防止"会话对象原地增长"
      // （节点追加进同一个 chat 对象）被引用相等掩盖掉——2026-09-14 fixture 实测到这一点。
      const queueSig = (chatSnap?.queue || []).map((row) => row?.id ?? '').join('|')
      const pendingSig = (chatSnap?.pending || []).map((wait) => wait?.key ?? '').join('|')
      // 消息图：0.1.7 = 会话快照上的 chat；0.2.0 = uiConversation 的 "chat" target（见 chatGraphOf）
      const chatGraph = chatGraphOf(chatSnap)
      const order = chatGraph?.order || []
      const orderSig = `${order.length}:${order.length ? order[order.length - 1] : ''}:${chatGraph?.nodes?.size ?? ''}`
      return snapshotCache.get(
        [chatGraph, orderSig, statusKey, key, chatSnap?.running, queueSig, pendingSig, chatSnap?.hasMore, inputSnap?.draft, inputSnap?.claim, (inputSnap?.imageIds || []).join(','), caps.missing.join(','), caps.degraded.join(',')],
        () => {
        const { messages, hasUnknown } = projectChat(chatGraph)
        // 临时诊断（2026-10-09 排查"绑定会话读不到历史"）：window.__wmDebugCompanion = true 时打印一次实况
        if (typeof window !== 'undefined' && window.__wmDebugCompanion) {
          const dbg = {
            status: state.status,
            sessionId: state.sessionId,
            hasStore: Boolean(session),
            chatType: Object.prototype.toString.call(chatGraph),
            chatKeys: chatGraph && typeof chatGraph === 'object' ? Object.keys(chatGraph) : null,
            orderLen: (chatGraph?.order || []).length,
            nodesSize: chatGraph?.nodes?.size ?? null,
            // 图是从哪儿来的：session（0.1.7）/ uiConversation（0.2.0）/ none
            chatSource: chatSnap?.chat ? 'session' : (chatBinding.target ? 'uiConversation' : 'none'),
            chatBindingError: chatBinding.error,
            chatTargetReady: Boolean(chatBinding.target),
            snapKeys: chatSnap && typeof chatSnap === 'object' ? Object.keys(chatSnap) : null,
            msgs: messages.length,
            hasMore: chatSnap?.hasMore ?? null,
            running: chatSnap?.running ?? null,
            hasInputShell: Boolean(inputSnap),
            openState: chatSnap?.openState ?? null,
            openError: chatSnap?.openError ? String(chatSnap.openError).slice(0, 200) : null,
            snapKeysFull: chatSnap && typeof chatSnap === 'object' ? Object.keys(chatSnap) : null,
            // 0.2.0 的会话 store 快照里没有 chat：找它到底挂在哪
            sessionOwnKeys: session ? Object.keys(session) : null,
            sessionProtoKeys: session ? Object.getOwnPropertyNames(Object.getPrototypeOf(session) || {}) : null,
            sessionHasChatProp: session ? ('chat' in session) : null,
            conversationSvcKeys: (() => { try { const c = typeof conversation === 'function' ? conversation() : null; return c ? Object.keys(c) : null } catch (e) { return 'err:' + (e && e.message ? e.message : e) } })(),
          }
          // 控制台消息会被截断（实测 ~180 字符），挂到 window 上让探针用 evaluate 直接读
          window.__wmDebugLast = dbg
          console.info('companion-debug ' + JSON.stringify(dbg))
        }
        return Object.freeze({
          projectKey: key,
          projectPath: path,
          operationToken: operationId,
          shared: Boolean(bound.shared),
          status: state.status,
          wrongness: state.wrongness,
          error: state.error,
          sessionId: state.sessionId,
          messages,
          hasUnknown,
          running: Boolean(chatSnap?.running),
          queue: (chatSnap?.queue || []).map((row) => ({ id: row?.id, text: row?.text, preview: row?.preview })),
          pending: (chatSnap?.pending || []).map((wait) => ({ key: wait?.key, kind: wait?.kind })),
          hasMore: Boolean(chatSnap?.hasMore),
          draft: inputSnap?.draft ?? '',
          claim: inputSnap?.claim ?? null,
          imageIds: inputSnap?.imageIds || [],
          record: state.record
            ? Object.freeze({
                phase: state.record.phase,
                sessionId: state.record.sessionId || null,
                workspaceId: state.record.workspaceId || null,
                operationToken: state.record.operationToken || null,
                version: state.record.version ?? null,
                reason: state.record.reason || null,
                stale: Boolean(state.record.stale),
              })
            : null,
          missing: caps.missing,
          degraded: caps.degraded,
        })
      })
    }

    function subscribe(fn) {
      listeners.add(fn)
      ensureAttached()
      return () => listeners.delete(fn)
    }

    function getDraft() {
      return currentInputSnap()?.draft ?? ''
    }

    function setDraft(text) {
      const shell = inputShell()
      if (shell && has(shell.actions, 'setDraft')) {
        shell.actions.setDraft(String(text ?? ''))
        return true
      }
      const info = currentInfo()
      const actions = info?.props?.inputActions
      if (!actions?.setDraft) throw adapterError('input-not-ready', '原生输入框尚未就绪')
      actions.setDraft(String(text ?? ''))
      return true
    }

    /**
     * 发送。返回 { result: 'accepted'|'rejected'|'uncertain', ... }：
     *   rejected —— 原生明确拒绝（没受理），可以改完再发；
     *   accepted —— 原生已受理（本轮已在会话里或已排队）；
     *   uncertain —— 交出去过但结果不可核，**保留正文、不自动重发**，由作者看完整会话决定。
     */
    async function send(preparedTurn) {
      const body = String(preparedTurn?.body || '')
      const at = { key, sessionId: state.sessionId, operationId }
      if (!body.trim()) return { result: 'rejected', code: 'empty-body', projectKey: key, operationId }
      if (state.status !== 'ready' || !at.sessionId) {
        return { result: 'rejected', code: 'not-ready', status: state.status, projectKey: key, operationId }
      }
      const session = currentSession()
      // B02：先记基线。没有基线就无法区分"本轮新回合"与历史里的旧消息
      // （旧消息含同一段备忘前缀时会被误判成本轮已受理 → 明确拒绝也清稿）。
      const baseline = session ? turnBaseline(session) : null
      const queueBefore = baseline ? new Set(baseline.queueIds) : new Set()
      if (!session || !has(session, 'prompt')) {
        // 绑定的会话在原生侧已不存在（被别处删掉）：状态降级为 missing，让作者看到恢复入口，
        // 而不是把消息发进虚空或悄悄新建（2026-09-14 fixture 实测到这一点）。
        const gone = Boolean(at.sessionId) && !liveSessionIds().has(at.sessionId)
        if (gone) {
          state.status = 'missing'
          notify()
          return { result: 'rejected', code: 'session-missing', projectKey: key, operationId, sessionId: at.sessionId }
        }
        return { result: 'rejected', code: 'session-unavailable', projectKey: key, operationId }
      }
      let res = null
      let thrown = null
      try {
        res = await session.prompt([{ type: 'text', text: body }], 'queue')
      } catch (err) {
        thrown = err
      }
      // 迟到/串台防护：异步返回后先核对身份，绝不让 A 的结果落到 B
      if (state.sessionId !== at.sessionId || key !== at.key) {
        return { result: 'rejected', code: 'session-changed', projectKey: at.key, operationId: at.operationId }
      }
      const freshSession = currentSession() || session
      // 诊断用（不参与判定）：本轮之后是否出现了新回合。文本包含关系**不能**证明受理归属——
      // 另一个窗口的新消息、或排队回合转入历史都可能命中（复核 N04 实测）。
      const evidence = turnEvidence(freshSession, body, baseline, preparedTurn?.message)
      if (res?.ok) return { result: 'accepted', evidence: evidence.evidence, queued: evidence.queued, projectKey: key, operationId, sessionId: state.sessionId }
      const message = thrown?.message || res?.error?.message || res?.error || '发送失败'
      const code = thrown?.code || res?.error?.code || 'send-failed'
      // 原生明确拒绝（ok:false）：**不接受任何文本证据翻案**，一律 rejected —— 正文与引用留在作者手里。
      if (!thrown) return { result: 'rejected', code, error: String(message), projectKey: key, operationId, sessionId: state.sessionId }
      // 抛异常（交出去过但结果不可核）：只有拿到**内核可证明的本轮标识**才算受理，否则保持 uncertain。
      // 可证明关联：回包或**抛出的错误**上都可能带内核标识（网络错误常带 requestId）
      const correlation = correlateDispatch(thrown || res, freshSession, queueBefore)
      if (correlation.accepted) {
        return { result: 'accepted', evidence: correlation.evidence, queued: correlation.queued, projectKey: key, operationId, sessionId: state.sessionId }
      }
      return { result: 'uncertain', code, error: String(message), retainedBody: body, evidence: evidence.evidence, projectKey: key, operationId, sessionId: state.sessionId }
    }

    /**
     * 受理归属的**可证明**判定（N04）：只接受内核给出的本轮标识——
     * prompt 回包里的 requestId/turnId/queueId，或该标识确实出现在本轮之后新增的队列里。
     * 文本相等/包含一律不作为受理依据：另一个窗口发同一句话时无法区分是哪一轮。
     */
    function correlateDispatch(result, session, queueBeforeIds) {
      const ids = [result?.requestId, result?.turnId, result?.queueId, result?.id].filter((x) => x != null).map(String)
      if (!ids.length) return { accepted: false, evidence: 'no-kernel-request-id' }
      const snap = session && typeof session.getSnapshot === 'function' ? session.getSnapshot() : null
      for (const row of snap?.queue || []) {
        const rid = row?.id != null ? String(row.id) : null
        if (rid && ids.includes(rid) && !queueBeforeIds.has(rid)) return { accepted: true, queued: true, evidence: 'kernel-queue-id' }
      }
      return { accepted: false, evidence: 'kernel-id-not-observed' }
    }

    /** 只取消本 handle 自己会话的当前回合；不碰别人的会话。 */
    async function cancel() {
      const session = currentSession()
      if (!session || !has(session, 'cancel')) throw adapterError('cancel-unavailable', '当前会话不支持取消')
      await session.cancel()
      return { ok: true, sessionId: state.sessionId }
    }

    /** 打开完整会话：只切焦点，不创建、不改绑定。 */
    function openFullSession() {
      if (!state.sessionId || !focusSession(state.sessionId, focusHolder)) throw adapterError('open-unavailable', '没有可打开的会话')
      return { ok: true, sessionId: state.sessionId }
    }

    /** 释放订阅（不取消模型任务、不删会话、不动协调记录）。 */
    function dispose() {
      disposed = true
      focusHolder.ref?.release?.()
      focusHolder.ref = null
      for (const off of nativeUnsubs.splice(0)) {
        try {
          off()
        } catch {}
      }
      listeners.clear()
    }

    /**
     * 作者明确要求的"继续关联"（B03 起语义收敛）：
     *   1. 会话还在 → 用**记录里的原 token** 走 claim→creating→confirm 把关联补上（不新建任何原生对象）；
     *   2. 另一个窗口还在创建中且我们没有已知会话 → 只等，不清记录、不新建；
     *   3. 只有"会话确实不在了/从未有过"才做条件受保护的 forget + 重建。
     * 关键：把"继续原关联"实现成"放弃并新建"是错的——那会留下一个孤立会话。
     */
    async function recover(reason = 'author-requested') {
      if (state.status !== 'missing' && state.status !== 'uncertain' && state.status !== 'waiting') {
        throw adapterError('recover-not-allowed', '当前状态不需要恢复（' + state.status + '）')
      }
      const rec = (await readRecord(path)) || null
      const knownToken = rec?.operationToken || state.record?.operationToken || null
      const knownSession = state.sessionId || rec?.sessionId || null
      const sessionAlive = Boolean(knownSession) && liveSessionIds().has(knownSession)

      /** 用已知标识补确认（不新建任何原生对象）。 */
      const reconfirm = async (sessionId, workspaceId) => {
        if (!knownToken) return null
        await coordination.claim({ path, operationToken: knownToken, owner: 'recover' })
        if (coordination.creating) await coordination.creating({ path, operationToken: knownToken })
        return coordination.confirm({ path, operationToken: knownToken, sessionId, workspaceId: workspaceId || null })
      }

      // N02：记录里有 workspace/会话标识、或状态是 uncertain，说明**外部创建可能已经发生**。
      // 这时先按"内核保存的项目关联 → 已知 workspace 对应的原生会话"去找；找不到就保持 uncertain，
      // 绝不 forget+新建（复核实测：sessions.create 在原生侧建好 s1 后回包丢失，旧逻辑会再建 w2/s2）。
      const mayHaveCreated = Boolean(rec && (rec.workspaceId || rec.sessionId)) || state.status === 'uncertain'
      if (!knownSession && mayHaveCreated) {
        let found = null
        let foundWorkspace = rec?.workspaceId || state.workspaceId || null
        try {
          const binding = typeof api === 'function' ? await api('companion', undefined, { path }) : null
          if (binding?.ok && binding.sessionId && liveSessionIds().has(binding.sessionId)) found = binding.sessionId
        } catch {}
        if (!found && foundWorkspace) {
          for (const id of liveSessionIds()) {
            const store = sessionStoreOf(id)
            const snap = store && typeof store.getSnapshot === 'function' ? store.getSnapshot() : null
            const wsId = snap?.workspaceId ?? store?.workspaceId ?? null
            if (wsId && String(wsId) === String(foundWorkspace)) {
              found = id
              break
            }
          }
        }
        if (found) {
          const conf = await reconfirm(found, foundWorkspace)
          const phase = conf?.outcome === 'bound' ? 'bound' : conf?.record?.phase
          if (phase === 'bound') {
            state = { ...state, status: 'ready', sessionId: found, workspaceId: foundWorkspace, record: conf.record || rec, error: null, wrongness: null }
          } else {
            state = { ...state, status: 'uncertain', sessionId: found, workspaceId: foundWorkspace, record: conf?.record || rec, wrongness: 'reconfirm-' + (conf?.outcome || 'failed') }
          }
          notify()
          return getSnapshot()
        }
        // 查不到：保留不确定与已知标识，给作者"查看完整会话 / 选择关联"的入口，不做破坏性动作
        state = {
          ...state,
          status: 'uncertain',
          workspaceId: foundWorkspace,
          record: rec || state.record,
          wrongness: 'external-result-unknown',
          error: null,
        }
        notify()
        return getSnapshot()
      }

      if (sessionAlive && knownToken) {
        try {
          const conf = await reconfirm(knownSession, rec?.workspaceId || state.workspaceId || null)
          const phase = conf?.outcome === 'bound' ? 'bound' : conf?.record?.phase
          if (phase === 'bound') {
            state = { ...state, status: 'ready', sessionId: knownSession, workspaceId: rec?.workspaceId || state.workspaceId, record: conf.record || rec, error: null, wrongness: null }
            notify()
            return getSnapshot()
          }
          state = { ...state, status: 'uncertain', sessionId: knownSession, record: conf?.record || rec, wrongness: 'reconfirm-' + (conf?.outcome || 'failed') }
          notify()
          return getSnapshot()
        } catch (err) {
          state = { ...state, status: 'uncertain', sessionId: knownSession, error: err.message || String(err) }
          notify()
          return getSnapshot()
        }
      }

      if (rec?.phase === 'creating' && knownToken && knownToken !== operationId) {
        // 对端还在创建：等它，不抢、不清
        await refresh()
        state = { ...state, status: 'waiting', record: rec, wrongness: 'peer-still-creating' }
        notify()
        return getSnapshot()
      }

      // 会话确实不在了：条件受保护的 forget（版本/token 不符就拒绝，见 host forgetCoordination）
      if (coordination?.forget) {
        const forgotten = await coordination.forget({ path, operationToken: knownToken, expectedVersion: rec?.version ?? null })
        if (forgotten && forgotten.ok === false && forgotten.error && forgotten.error !== 'stale-token') {
          // 记录被别人推进过：不按旧认知删，交回状态让作者重查
          await refresh()
          state = { ...state, wrongness: 'forget-refused:' + forgotten.error }
          notify()
          return getSnapshot()
        }
      }
      const next = await connect(path, newOperationToken(), { canonicalKey: key })
      const snap = next.getSnapshot()
      state = { status: snap.status, sessionId: snap.sessionId, workspaceId: snap.workspaceId || null, record: snap.record ? { ...snap.record } : null, error: snap.error, wrongness: reason }
      notify()
      return snap
    }

    /** 重查 host 记录与原生会话（发现型，不写任何东西）。 */
    async function refresh() {
      const rec = await readRecord(path)
      if (rec) {
        state.record = rec
        if (rec.sessionId) state.sessionId = rec.sessionId
        if (rec.workspaceId) state.workspaceId = rec.workspaceId
      }
      refreshStatus()
      if (state.status === 'waiting' && state.sessionId) state.status = liveSessionIds().has(state.sessionId) ? 'ready' : state.status
      notify()
      return getSnapshot()
    }

    const handle = {
      projectKey: key,
      projectPath: path,
      operationToken: operationId,
      binding,
      getSnapshot,
      subscribe,
      getDraft,
      setDraft,
      send,
      cancel,
      openFullSession,
      dispose,
      recover,
      refresh,
      record: () => state.record,
      sessionId: () => state.sessionId,
      status: () => state.status,
    }
    return handle
  }

  /**
   * 采用一个**已知存在的会话**（不claim、不创建、不写协调记录）。
   * 用于"应用已经给出了绑定"的路径：老版本建的会话可能没有协调记录，
   * 这时绝不能因为记录缺失就重新创建一个新会话（那会悄悄换掉作者的会话）。
   */
  function attach(projectIdentity, sessionId, options = {}) {
    const key = canonicalProjectKey(projectIdentity)
    if (!key || !sessionId) throw adapterError('attach-arguments', '需要作品身份与会话标识')
    const live = liveSessionIds().has(sessionId)
    return makeHandle({
      key,
      path: projectIdentity,
      binding: options.binding || null,
      status: live ? 'ready' : 'missing',
      sessionId,
      workspaceId: options.workspaceId || null,
      record: options.record || null,
      requestedPath: projectIdentity,
      operationId: options.operationToken || newOperationToken(),
    })
  }

  return {
    capabilities,
    connect,
    attach,
    /** 诊断用：当前进行中的绑定键（UI 不读）。 */
    inflightKeys: () => [...inflight.keys()],
    _sessionStoreOf: sessionStoreOf,
  }
}
