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
import { projectChat, turnEvidence, createSnapshotCache } from './projection.js'
import { httpCoordination } from './coordination-client.js'

/** 等待对方窗口完成绑定的轮询参数（只用于发现，不授权抢占，见方案 §3.2 末段）。 */
export const PEER_WAIT = { attempts: 40, intervalMs: 250 }

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
    api = null,
    coordination = api ? httpCoordination(api) : null,
    now = () => Date.now(),
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = () => {},
  } = deps

  /** 进程内：canonical key → 正在进行的绑定 Promise（同键不重复创建）。 */
  const inflight = new Map()

  function capabilities() {
    const flags = {
      sessions: Boolean(sessions),
      'sessions.refresh': has(sessions, 'refresh'),
      'sessions.create': has(sessions, 'create'),
      'sessions.open': has(sessions, 'open'),
      'sessions.binding': has(sessions, 'binding'),
      'sessions.provideInfo': has(sessions, 'provideInfo'),
      'workspaces.create': has(workspaces, 'create'),
      'agentPresets.select': has(connection?.agentPresets, 'select'),
      coordination: Boolean(coordination && coordination.claim),
      api: typeof api === 'function',
    }
    // 硬门槛只列**创建会话**真正需要的能力；读写草稿/打开会话所需的是软缺口（degraded），
    // 不该阻断"已有会话"的正常使用（2026-09-14 实测：把 sessions.binding 当硬门槛会让
    // 只有 provideInfo 的内核连"采用已有会话"都做不了）。
    const required = ['sessions', 'sessions.refresh', 'sessions.create', 'workspaces.create', 'agentPresets.select', 'coordination', 'api']
    const soft = ['sessions.binding', 'sessions.provideInfo', 'sessions.open', 'sessions.noteAgentPreset']
    const missing = required.filter((k) => !flags[k])
    const degraded = soft.filter((k) => !flags[k])
    return {
      flags,
      missing,
      degraded,
      canCreate: missing.length === 0,
      // 已有会话时能干活的条件（不需要创建能力）：能拿到 store 与输入面
      canSend: Boolean(flags.sessions && flags['sessions.binding'] && flags.api),
    }
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
    // claimed：本次拿到创建权
    void rec
    return createNow({ path, operationId, key, binding })
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
      if (workspaceId) {
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
    let disposed = false

    const currentSession = () => sessionStoreOf(state.sessionId)
    const currentInfo = () => {
      if (!state.sessionId || !has(sessions, 'provideInfo')) return null
      try {
        return sessions.provideInfo(state.sessionId)
      } catch {
        return null
      }
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

    function ensureAttached() {
      if (attachedSessionId === state.sessionId) return
      attachedSessionId = state.sessionId
      if (!state.sessionId) return
      attach(currentSession())
      attach(currentInfo()?.hooks?.input)
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
      const info = currentInfo()
      const chatSnap = session?.getSnapshot?.() || null
      const inputSnap = info?.hooks?.input?.getSnapshot?.() || null
      const caps = capabilities()
      const statusKey = `${state.status}|${state.record?.phase || ''}|${state.record?.version ?? ''}|${state.sessionId || ''}|${state.error || ''}`
      // 指纹用**稳定对象身份**（chat 图）+ 关键标量 + 结构性签名：
      // 该换引用时换（内容变了），不该换时不换（没变）。结构性签名是防止"会话对象原地增长"
      // （节点追加进同一个 chat 对象）被引用相等掩盖掉——2026-09-14 fixture 实测到这一点。
      const queueSig = (chatSnap?.queue || []).map((row) => row?.id ?? '').join('|')
      const pendingSig = (chatSnap?.pending || []).map((wait) => wait?.key ?? '').join('|')
      const order = chatSnap?.chat?.order || []
      const orderSig = `${order.length}:${order.length ? order[order.length - 1] : ''}:${chatSnap?.chat?.nodes?.size ?? ''}`
      return snapshotCache.get(
        [chatSnap?.chat, orderSig, statusKey, key, chatSnap?.running, queueSig, pendingSig, chatSnap?.hasMore, inputSnap?.draft, inputSnap?.claim, (inputSnap?.imageIds || []).join(','), caps.missing.join(','), caps.degraded.join(',')],
        () => {
        const { messages, hasUnknown } = projectChat(chatSnap?.chat)
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
      return currentInfo()?.hooks?.input?.getSnapshot?.().draft ?? ''
    }

    function setDraft(text) {
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
      const evidence = turnEvidence(freshSession, body)
      if (res?.ok) return { result: 'accepted', evidence: evidence.evidence, queued: evidence.queued, projectKey: key, operationId, sessionId: state.sessionId }
      if (evidence.accepted) return { result: 'accepted', evidence: evidence.evidence, queued: evidence.queued, projectKey: key, operationId, sessionId: state.sessionId }
      const message = thrown?.message || res?.error?.message || res?.error || '发送失败'
      const code = thrown?.code || res?.error?.code || 'send-failed'
      if (thrown) return { result: 'uncertain', code, error: String(message), retainedBody: body, projectKey: key, operationId, sessionId: state.sessionId }
      // 原生给了明确的不受理（没抛异常、没证据、明确 ok:false）
      return { result: 'rejected', code, error: String(message), projectKey: key, operationId, sessionId: state.sessionId }
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
      if (!state.sessionId || !has(sessions, 'open')) throw adapterError('open-unavailable', '没有可打开的会话')
      sessions.open(state.sessionId)
      return { ok: true, sessionId: state.sessionId }
    }

    /** 释放订阅（不取消模型任务、不删会话、不动协调记录）。 */
    function dispose() {
      disposed = true
      for (const off of nativeUnsubs.splice(0)) {
        try {
          off()
        } catch {}
      }
      listeners.clear()
    }

    /** 作者明确要求的恢复：会话确认已被删/上一次创建不可确认时，清记录后重新建立关联。 */
    async function recover(reason = 'author-requested') {
      if (state.status !== 'missing' && state.status !== 'uncertain' && state.status !== 'waiting') {
        throw adapterError('recover-not-allowed', '当前状态不需要恢复（' + state.status + '）')
      }
      if (coordination?.forget) await coordination.forget({ path })
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
