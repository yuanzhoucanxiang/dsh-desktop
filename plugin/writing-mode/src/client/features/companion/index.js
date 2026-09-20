/**
 * 写作模式客户端模块（P1 从 entry.js 搬迁；行为不变）。
 */
import { loadProjectMemory, CompanionMemoryPanel } from '../memory/index.js'
import { memoryHint, isInjectable, isPinnable, selectMemory, DEFAULT_MEMORY_BUDGET } from '../../../shared/context-builder.js'
import { referenceStatus, sameReference, normalizeReference } from '../../../shared/reference.js'
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { api } from '../../services/writing-api.js'
import { companionDrafts, loadCompanionDraft, listDraftCandidates, stashDraftForRecovery, applyDraftSnapshot, companionRecoveryState, companionDraftDirty, companionDraftConflict, companionDraftStatus, setDraftStatus, getDraftStatus, subscribeDraftStatus, resolveDraftConflict, retryDraftConflictRemote, persistCompanionDraft } from '../../state/companion-drafts.js'
import { harnessSessions } from '../../adapters/harness/runtime.js'
import { harnessAdapter } from '../../adapters/harness/runtime.js'
import { newOperationToken } from '../../adapters/harness/adapter.js'
import { buildPreparedTurn } from '../../../shared/context-builder.js'
import { CompanionMessage } from './CompanionMessage.js'

export const emptyCompanionSnapshot = Object.freeze({})
export const noSubscribe = () => () => {}
export const emptySnapshot = () => emptyCompanionSnapshot
export function useCompanionStore(store) {
  const subscribe = react.useCallback(fn => store ? store.subscribe(fn) : noSubscribe(), [store])
  const snapshot = react.useCallback(() => store ? store.getSnapshot() : emptySnapshot(), [store])
  return react.useSyncExternalStore(subscribe, snapshot)
}
/**
 * 消息行：**由 adapter 投影好**（方案 P2 §3.1：UI 不读 chat.nodes/order）。
 * 这里只做兜底，不再自己解析原生 chat 图。
 */
export function companionRows(snapshot) {
  return Array.isArray(snapshot?.messages) ? snapshot.messages : []
}


export function CompanionTranscript({ snapshot, onFull, onCandidate }) {
  const rows = companionRows(snapshot)
  const scroll = react.useRef(null)
  const follow = react.useRef(true)
  react.useLayoutEffect(() => { if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight }, [snapshot])
  return jsx.jsxs('div', { className: 'dshWmConversation', ref: scroll, onScroll: e => {
    const el = e.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70
  }, children: [
    snapshot.hasMore ? jsx.jsx('button', { className: 'dshWmQuiet', onClick: onFull, children: '查看更早的对话 ↗' }) : null,
    !rows.length ? jsx.jsxs('div', { className: 'dshWmCompanionEmpty', children: [
      jsx.jsx('span', { className: 'dshWmCompanionMark', children: '✦' }),
      jsx.jsx('h3', { children: '故事，慢慢聊。' }),
      jsx.jsx('p', { children: '一个人物、一段卡住的情节，\n或一个还没成形的念头。' }),
    ] }) : rows.map(row => row.kind === 'detail' ? jsx.jsxs('details', { className: 'dshWmActivity', children: [
      jsx.jsx('summary', { children: row.text }), jsx.jsx('pre', { children: JSON.stringify(row.detail, null, 2) }),
    ] }, row.key) : jsx.jsxs('article', { className: 'dshWmMessage is-' + row.kind, children: [
      jsx.jsx('span', { className: 'dshWmMessageWho', children: row.kind === 'user' ? '你' : '写作伙伴' }),
      jsx.jsx(CompanionMessage, { text: row.text, kind: row.kind }),
      row.reference ? jsx.jsxs('details', { className: 'dshWmActivity', children: [jsx.jsx('summary', { children: '引用的稿件' }), jsx.jsx('pre', { children: row.reference })] }) : null,
      row.kind === 'assistant' && onCandidate
        ? jsx.jsx('button', {
            className: 'dshWmQuiet dshWmMessageAction',
            'data-wm-candidate': row.key,
            onClick: () => onCandidate({ text: row.text, messageId: row.key }),
            children: '记为候选',
          })
        : null,
    ] }, row.key)),
    (snapshot.queue || []).map(row => jsx.jsx('div', { className: 'dshWmActivity', children: '等待回复后发送 · ' + (row.text || row.preview || '消息') }, row.id)),
    (snapshot.pending || []).map(wait => jsx.jsxs('div', { className: 'dshWmRequest', children: [
      jsx.jsx('strong', { children: wait.kind === 'approval' ? '有一项操作需要你授权' : '写作伙伴有个问题想确认' }),
      jsx.jsx('button', { className: 'dshWmQuiet', onClick: onFull, children: '查看并处理 ↗' }),
    ] }, wait.key)),
    snapshot.running ? jsx.jsx('div', { className: 'dshWmThinking', role: 'status', children: '正在回应…' }) : null,
  ] })
}
export function CompanionChat({ initialBinding, path, contextText, sourceInfo, onExit }) {
  const sessions = harnessSessions()
  const adapter = harnessAdapter()
  const [binding, setBinding] = react.useState(initialBinding)
  const project = binding.project
  const cached = companionDrafts.get(project) || { text: '', reference: null }
  const [localDraft, setLocalDraft] = react.useState(cached.text)
  const [reference, setReference] = react.useState(cached.reference)
  const [busy, setBusy] = react.useState(false)
  const [error, setError] = react.useState('')
  const [memOpen, setMemOpen] = react.useState(false)
  const [candidate, setCandidate] = react.useState(null)
  const [draftCandidates, setDraftCandidates] = react.useState([])
  const [previewCandidate, setPreviewCandidate] = react.useState(null)
  const [contextOpen, setContextOpen] = react.useState(false)
  const [includeMemory, setIncludeMemory] = react.useState(true) // 默认开启本次参考
  const [pinned, setPinned] = react.useState([]) // 「固定优先」的条目 id（顺序即作者顺序）
  const [excluded, setExcluded] = react.useState([]) // 作者明确「不带」的条目 id（排除优先于固定/自动）
  const [memoryItems, setMemoryItems] = react.useState([])
  const [memoryMeta, setMemoryMeta] = react.useState({ revision: null, etag: null, ok: true, error: '' })
  // B04：开启参考但读不到备忘时，本轮**不发出**，等作者在「重试/不参考发送」之间选
  const [memoryBlock, setMemoryBlock] = react.useState(null)
  const [notice, setNotice] = react.useState('')
  const alive = react.useRef(true)
  const sending = react.useRef(false)
  const id = binding.sessionId
  // P2：会话事实来自 adapter；应用已经给出 sessionId 时用 attach（不 claim、不创建、不写记录），
  // 只有作者确实需要新建时才走 connect。这样"老绑定没有协调记录"不会被误判成"需要新建会话"。
  const [handle, setHandle] = react.useState(() => (id ? adapter.attach(project, id, { binding }) : null))
  const opRef = react.useRef(null)
  const operationIdRef = react.useRef(null) // 每次发送一个 operationId，冻结进 preparedTurn
  const snapshot = useCompanionStore(handle)
  const draft = handle ? snapshot.draft || '' : localDraft
  const needsFullComposer = Boolean((snapshot.imageIds && snapshot.imageIds.length) || snapshot.claim || draft.trimStart().startsWith('/'))
  const recovery = handle && snapshot.status !== 'ready' ? snapshot.status : null
  const setNativeDraft = react.useCallback((text) => {
    try {
      handle?.setDraft(text)
    } catch {}
  }, [handle])
  /** 需要会话时取得 handle：已有绑定用 attach，没有就 connect（可能创建，且同一作品只创建一次）。 */
  const ensureHandle = react.useCallback(async () => {
    if (handle && handle.status() !== 'missing' && handle.status() !== 'waiting') return handle
    if (!opRef.current) opRef.current = newOperationToken()
    const next = await adapter.connect(path, opRef.current)
    if (alive.current) {
      setHandle(next)
      setBinding((prev) => ({ ...prev, sessionId: next.sessionId() }))
    }
    return next
  }, [adapter, handle, path])
  const reloadMemory = react.useCallback(async () => {
    const data = await loadProjectMemory(project)
    setMemoryItems(data.ok ? data.memory?.items || [] : [])
    setMemoryMeta({
      revision: data.ok ? data.memory?.revision ?? null : null,
      etag: data.ok ? data.etag ?? null : null,
      ok: Boolean(data.ok),
      error: data.ok ? '' : String(data.error || 'memory-unavailable'),
    })
    return data
  }, [project])
  react.useEffect(() => { void reloadMemory() }, [reloadMemory])
  // 其他窗口的草稿候选：只列出（带窗口/时间），采用与否由作者决定；不自动合并、不自动替换
  const reloadCandidates = react.useCallback(async () => {
    const list = await listDraftCandidates(project)
    setDraftCandidates(list)
  }, [project])
  react.useEffect(() => { void reloadCandidates() }, [reloadCandidates])
  // 候选入口：点助手消息上的"记为候选"→ 打开备忘面板并预填（面板是唯一的备忘写入口）
  const startCandidate = react.useCallback((msg) => {
    setCandidate({ text: msg.text, source: { kind: 'assistant', sessionId: snapshot.sessionId || null, messageId: msg.messageId || null } })
    setMemOpen(true)
  }, [snapshot.sessionId])
  react.useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  react.useEffect(() => {
    if (!id) return
    const started = id ? adapter.attach(project, id, { binding }) : null
    setHandle(started)
    try {
      started?.openFullSession()
    } catch {}
  }, [adapter, id, project])
  react.useEffect(() => () => { handle?.dispose() }, [handle])
  // 下面的草稿恢复 effect 依赖是 [project]（一次性），用 ref 取"当前" handle 与写回函数，
  // 避免闭包里是 null 或过期 handle。
  const handleRef = react.useRef(null)
  const setNativeDraftRef = react.useRef(null)
  react.useEffect(() => { handleRef.current = handle ?? null }, [handle])
  react.useEffect(() => { setNativeDraftRef.current = setNativeDraft }, [setNativeDraft])
  const recoveryGen = react.useRef(0)
  const [draftUi, setDraftUi] = react.useState(() => ({
    conflict: null,
    dirty: false,
    status: { phase: 'idle', error: '', code: '' },
  }))
  react.useEffect(() => {
    const read = () =>
      setDraftUi({
        conflict: companionDraftConflict.get(project) || null,
        dirty: Boolean(companionDraftDirty.get(project)),
        status: getDraftStatus(project),
      })
    read()
    return subscribeDraftStatus(read)
  }, [project])
  react.useEffect(() => {
    let cancelled = false
    const started = recoveryGen.current
    companionRecoveryState.set(project, 'pending')
    void loadCompanionDraft(project).then((c) => {
      if (cancelled) return
      const typedDuring = recoveryGen.current !== started
      // R01: adopt full snapshot into cache (text + reference + rev) when no user edit
      if (!typedDuring) {
        let nativeDraft = ''
        try {
          nativeDraft = handleRef.current ? handleRef.current.getDraft() : ''
        } catch {
          nativeDraft = ''
        }
        const adoptText = nativeDraft || c.text || ''
        const adoptRef = normalizeReference(c.reference) || null
        companionDrafts.set(project, {
          text: adoptText,
          reference: adoptRef,
          rev: Number.isInteger(c.rev) ? c.rev : 0,
        })
        if (adoptRef) setReference((prev) => prev || adoptRef)
        if (!nativeDraft && c.text) {
          setLocalDraft(c.text)
          try {
            setNativeDraftRef.current?.(c.text)
          } catch {}
        }
      } else if (Number.isInteger(c.rev)) {
        // Still take server baseline; keep local text/reference from user edits
        const prev = companionDrafts.get(project) || { text: '', reference: null, rev: 0 }
        companionDrafts.set(project, { ...prev, rev: c.rev })
      }
      companionRecoveryState.set(project, 'done')
      // R02/V01: flush if dirty — do not clear dirty before successful persist
      if (companionDraftDirty.get(project)) {
        persistCompanionDraft(project)
      } else {
        setDraftStatus(project, { phase: 'saved', error: '', code: '' })
      }
    })
    return () => { cancelled = true }
  }, [project])
  // N03：编辑代数——采用候选这类异步操作必须绑定"点击那一刻"的代数，
      // 迟到返回时若有新编辑就取消采用，绝不覆盖作者刚写的东西。
  const editGen = react.useRef(0)
  const adopting = react.useRef(false)
  const bumpEdit = () => { editGen.current++ }
  function updateDraft(text) {
    recoveryGen.current++
    bumpEdit()
    // 有会话就写原生输入框，没有会话（还没建立关联）就存在组件里。
    // 注意 handle?.setDraft() 在 handle 为 null 时**不抛错**，所以必须显式判断有没有写入，
    // 否则本地草稿会既没进原生也没进 state（E2E 实测过这条：切到完整会话后输入框是空的）。
    let wroteNative = false
    if (handle) {
      try {
        handle.setDraft(text)
        wroteNative = true
      } catch {
        wroteNative = false
      }
    }
    if (!wroteNative) setLocalDraft(text)
    const prev = companionDrafts.get(project) || { text: '', reference: null, rev: 0 }
    companionDrafts.set(project, { ...prev, text })
    companionDraftDirty.set(project, true)
    if (companionRecoveryState.get(project) === 'pending') return
    // X01: draft save errors live only in companionDraftStatus (subscribed UI)
    persistCompanionDraft(project)
  }
  function updateReference(value) {
    recoveryGen.current++
    bumpEdit()
    setReference(value)
    const prev = companionDrafts.get(project) || { text: '', reference: null, rev: 0 }
    companionDrafts.set(project, { ...prev, reference: value })
    companionDraftDirty.set(project, true)
    if (companionRecoveryState.get(project) === 'pending') return
    persistCompanionDraft(project)
  }
  async function fullConversation() {
    if (sending.current) return
    sending.current = true; setBusy(true)
    try {
      const target = handle || (await ensureHandle())
      if (!target || !alive.current) return
      // 只有"本次才建立会话"时把草稿带进原生输入框；已有会话时原生输入框本来就是同一份草稿，
      // 再追加会变成两份（native E2E 断言过这条：切到完整会话后输入框内容必须与草稿一字不差）。
      if (!id && draft) {
        const already = target.getDraft()
        try {
          target.setDraft(already ? already + '\n\n' + draft : draft)
        } catch {}
      }
      target.openFullSession()
      onExit()
    } catch (err) { if (alive.current) setError(err.message) }
    finally { sending.current = false; if (alive.current) setBusy(false) }
  }
  async function send(options = {}) {
    if (sending.current || !draft.trim()) return
    if (needsFullComposer) { void fullConversation(); return }
    sending.current = true; setBusy(true); setError('')
    const sentDraft = draft, sentReference = reference
    operationIdRef.current = newOperationToken()
    try {
      const target = handle || (await ensureHandle())
      if (!target || !alive.current) return
      // 每次真正发送都重新读备忘：已撤回/改过的条目按最新有效状态来，绝不拿面板缓存当权威。
      // 作者已关闭参考时不必读（省一次请求，也不受备忘故障影响）。
      const wantMemory = includeMemory && !options.bypassMemory
      let freshItems = []
      let memoryRevision = null
      let memoryEtag = null
      if (wantMemory) {
        const memData = await loadProjectMemory(project)
        if (!memData.ok) {
          // B04：读不到就**不发出**——正文与引用留在作者手里，由作者选"重试"或"不参考发送"。
          // （旧行为是提示一句然后照发，并用"事实"清掉草稿，v2 §4.2 明确不允许。）
          if (alive.current) {
            setMemoryBlock({ error: String(memData.error || 'memory-unavailable') })
            setError('')
          }
          return
        }
        freshItems = memData.memory?.items || []
        memoryRevision = memData.memory?.revision ?? null
        memoryEtag = memData.etag ?? null
        if (alive.current) {
          setMemoryItems(freshItems)
          setMemoryMeta({ revision: memoryRevision, etag: memoryEtag, ok: true, error: '' })
        }
      }
      if (alive.current) setMemoryBlock(null)
      const prepared = buildPreparedTurn({
        message: sentDraft,
        reference: sentReference,
        memoryItems: freshItems,
        includeMemory: wantMemory,
        pinnedMemoryIds: pinned,
        excludedMemoryIds: excluded,
        projectKey: project,
        operationId: operationIdRef.current,
        memoryRevision,
        memoryEtag,
      })
      const result = await target.send(prepared)
      // 受理结果三分：rejected=没受理（改完再发）· uncertain=可能已受理（保留正文，绝不自动重发）
      if (result.result === 'rejected') {
        throw new Error(result.error || '发送失败，请重试')
      }
      if (result.result === 'uncertain') {
        if (alive.current) setError('这一轮是否已被受理无法确认，正文已保留。请先查看完整会话确认原生回合，再决定是否重发。')
        return
      }
      // W03: one protected clear after send; tombstone advances rev
      let nowDraft = null
      try {
        nowDraft = target.getDraft()
      } catch {
        nowDraft = null
      }
      const draftCleared = nowDraft === sentDraft || nowDraft === '' || nowDraft == null
      const nowRef = companionDrafts.get(project)?.reference || null
      const refCleared = !nowRef || sameReference(nowRef, sentReference)
      if (draftCleared) {
        try {
          target.setDraft('')
        } catch {}
        if (alive.current) setLocalDraft('')
      }
      if (refCleared && alive.current) setReference(null)
      if (draftCleared || refCleared) {
        const prev = companionDrafts.get(project) || { text: '', reference: null, rev: 0 }
        companionDrafts.set(project, {
          text: draftCleared ? '' : prev.text || '',
          reference: refCleared ? null : prev.reference || null,
          rev: prev.rev ?? 0,
        })
        // X01: clear failures surface via companionDraftStatus only
        persistCompanionDraft(project)
      }
    } catch (err) { if (alive.current) setError(err.message || String(err)) }
    finally { sending.current = false; if (alive.current) setBusy(false) }
  }
    // Business errors only (session send / memory). Draft save errors are in draftUi.status.
    const failure = error || snapshot.error
    // 真实异常才出现的恢复条：说明状态 + 给出恢复入口（方案 §3.3：不静默切到新空会话）
    const statusNote = !handle || snapshot.status === 'ready'
      ? ''
      : snapshot.status === 'waiting'
        ? '正在关联这个作品的写作伙伴…（另一个窗口可能正在创建，等它完成即可）'
        : snapshot.status === 'uncertain'
          ? '上一次关联没有确认完成。已知的会话/工作区标识都保留着，不会被当作没有发生过。'
          : snapshot.status === 'missing'
            ? '原本关联的会话已不存在（可能被删除了）。'
            : snapshot.status === 'error'
              ? `关联失败：${snapshot.error || '未知原因'}`
              : ''
    const recoverable = snapshot.status === 'missing' || snapshot.status === 'uncertain' || snapshot.status === 'waiting'
    // C02：面板显示**实际会采用什么**——用与发送完全相同的选择函数算一遍，作者能逐条核对来源与省略原因
    const injectables = memoryItems.filter(isPinnable)
    const memoryPreview = react.useMemo(
      () => selectMemory(memoryItems, pinned, DEFAULT_MEMORY_BUDGET, excluded),
      [memoryItems, pinned, excluded]
    )
    const budgetOmitted = memoryPreview.omissions.filter((o) => o.reason === 'budget').length
    const previewRows = injectables.map((it) => {
      const taken = memoryPreview.selected.find((x) => String(x.id) === String(it.id))
      const omitted = memoryPreview.omissions.find((x) => String(x.id) === String(it.id))
      return {
        id: it.id,
        kind: it.kind,
        text: it.text,
        source: it.source?.kind === 'assistant' ? '助手建议' : it.source?.kind === 'host' ? '内核' : '作者',
        state: taken ? (taken.pinned ? '固定带入' : '自动带入') : omitted?.reason === 'excluded-by-author' ? '你已排除' : omitted?.reason === 'budget' ? '超出预算省略' : omitted?.reason === 'not-injectable' ? '状态不适用' : '未采用',
      }
    })
    // 引用是否来自旧快照：只在"源稿当前状态可知且路径一致"时判断，其余一律 unknown
    let refStatus = 'empty'
    try {
      refStatus = referenceStatus(reference, sourceInfo ? sourceInfo() : null)
    } catch {
      refStatus = 'unknown'
    }
  return jsx.jsxs('div', { className: 'dshWmCompanion', children: [
    jsx.jsxs('div', { className: 'dshWmConversationHead', children: [
      jsx.jsx('span', { title: project, children: project.split(/[\\/]/).filter(Boolean).pop() }),
      jsx.jsx('button', { className: 'dshWmQuiet', onClick: () => setMemOpen(v => !v), children: memOpen ? '收起备忘' : '项目备忘' }),
      jsx.jsx('button', { className: 'dshWmQuiet', onClick: () => void fullConversation(), disabled: busy || !sessions, title: '打开完整会话，调整模型、工具或处理请求', children: '会话设置 ↗' }),
    ] }),
    memOpen ? jsx.jsx(CompanionMemoryPanel, {
      path: project,
      candidate,
      onCandidateConsumed: () => setCandidate(null),
      onChanged: () => void reloadMemory(),
    }) : null,
    statusNote
      ? jsx.jsxs('div', { className: 'dshWmCompanionError', role: 'alert', 'data-wm-status': snapshot.status, children: [
          statusNote,
          jsx.jsx('button', { className: 'dshWmQuiet', onClick: () => void handle?.refresh(), children: '重查状态' }),
          recoverable
            ? jsx.jsx('button', {
                className: 'dshWmQuiet',
                onClick: () => void handle?.recover().catch((err) => setError(err.message || String(err))),
                children: '继续关联',
              })
            : null,
          jsx.jsx('button', {
            className: 'dshWmQuiet',
            onClick: () => {
              try {
                handle?.openFullSession()
              } catch (err) {
                setError(err.message || String(err))
              }
            },
            children: '查看完整会话',
          }),
        ] })
      : null,
    jsx.jsx(CompanionTranscript, { snapshot, onFull: () => void fullConversation(), onCandidate: startCandidate }),
    draftUi.conflict
      ? jsx.jsxs('div', { className: 'dshWmCompanionError', role: 'alert', children: [
          draftUi.conflict.remoteStatus === 'valid'
            ? '草稿与另一处写入冲突，自动保存已暂停。'
            : draftUi.conflict.remoteStatus === 'failed'
              ? '冲突后无法读取远端草稿。'
              : '冲突处理中，正在读取远端草稿…',
          jsx.jsx('button', {
            className: 'dshWmQuiet',
            onClick: () =>
              void resolveDraftConflict(project, 'keep-local', {
                setLocalDraft,
                setReference,
                setNativeDraft,
              }),
            children: '保留本地并覆盖',
          }),
          draftUi.conflict.remoteStatus === 'valid'
            ? jsx.jsx('button', {
                className: 'dshWmQuiet',
                onClick: () => {
                  void resolveDraftConflict(project, 'keep-remote', {
                    setLocalDraft,
                    setReference,
                    setNativeDraft,
                  })
                },
                children: '采用远端',
              })
            : null,
          draftUi.conflict.remoteStatus === 'failed'
            ? jsx.jsx('button', {
                className: 'dshWmQuiet',
                onClick: () => void retryDraftConflictRemote(project),
                children: '重试读取远端',
              })
            : null,
        ] })
      : null,
    draftUi.status.phase === 'error' && !draftUi.conflict
      ? jsx.jsxs('div', { className: 'dshWmCompanionError', role: 'alert', children: [
          draftUi.status.error,
          jsx.jsx('button', {
            className: 'dshWmQuiet',
            onClick: () => void persistCompanionDraft(project),
            children: '重试保存',
          }),
        ] })
      : null,
    draftUi.status.phase === 'saving'
      ? jsx.jsx('div', { className: 'dshWmAiHint', role: 'status', children: '正在保存草稿…' })
      : null,
    notice
      ? jsx.jsxs('div', { className: 'dshWmCompanionError', role: 'status', 'data-wm-notice': '1', children: [
          notice,
          jsx.jsx('button', { className: 'dshWmQuiet', onClick: () => setNotice(''), children: '知道了' }),
        ] })
      : null,
    memoryBlock
      ? jsx.jsxs('div', { className: 'dshWmCompanionError', role: 'alert', 'data-wm-memory-block': '1', children: [
          `项目备忘读取失败（${memoryBlock.error}）：本轮还没有发出，正文与引用都保留着。请选择：`,
          jsx.jsx('button', {
            className: 'dshWmQuiet',
            'data-wm-memory-retry': '1',
            onClick: () => {
              setMemoryBlock(null)
              void send()
            },
            children: '重试读取',
          }),
          jsx.jsx('button', {
            className: 'dshWmQuiet',
            'data-wm-memory-bypass': '1',
            onClick: () => {
              setMemoryBlock(null)
              void send({ bypassMemory: true })
            },
            children: '不参考备忘发送',
          }),
        ] })
      : null,
    failure ? jsx.jsx('div', { className: 'dshWmCompanionError', role: 'alert', children: failure }) : null,
    needsFullComposer ? jsx.jsx('button', { className: 'dshWmQuiet', onClick: () => void fullConversation(), children: '在完整会话中发送附件或使用指令 ↗' }) : null,
    jsx.jsxs('div', { className: 'dshWmCompose', children: [
      draftCandidates.length
        ? jsx.jsxs('div', { className: 'dshWmDraftCandidates', 'data-wm-draft-candidates': String(draftCandidates.length), children: [
            jsx.jsx('span', { className: 'dshWmMemoryNote', children: '其他窗口还有未合并的草稿（不会自动覆盖你正在写的）：' }),
            ...draftCandidates.map((c) => jsx.jsxs('div', { className: 'dshWmDraftCandidate', children: [
              jsx.jsx('span', { className: 'dshWmMemoryKind', children: '窗口 ' + String(c.windowId).slice(0, 6) + (c.updatedAt ? ' · ' + String(c.updatedAt).replace('T', ' ').slice(5, 16) : '') }),
              jsx.jsx('button', { className: 'dshWmQuiet', onClick: () => setPreviewCandidate(previewCandidate && previewCandidate.windowId === c.windowId ? null : c), children: '预览' }),
              jsx.jsx('button', {
                className: 'dshWmQuiet',
                'data-wm-draft-adopt': c.windowId,
                onClick: () => {
                  // B06 + N03：先为**当前这份**存可恢复副本 → 迟到核对（项目/卸载/新编辑）→
                  // 才把候选的 text 与 reference **一次性**应用（候选引用为 null 时显式清空）。
                  if (adopting.current) return
                  adopting.current = true
                  const projectAtStart = project
                  const genAtStart = editGen.current
                  void (async () => {
                    try {
                      const current = companionDrafts.get(project) || { text: draft, reference }
                      const stash = await stashDraftForRecovery(project, { text: current.text, reference: current.reference })
                      if (!stash.ok) {
                        setError('没能为当前草稿留下可恢复副本，已取消采用（原稿与引用都还在）。' + (stash.error ? ' ' + stash.error : ''))
                        return
                      }
                      void reloadCandidates()
                      // 迟到核对：组件已卸载 / 换了项目 / 期间有新编辑 → 取消这次采用，新稿完整保留
                      const late = !alive.current || projectAtStart !== project || editGen.current !== genAtStart
                      if (late) {
                        setNotice('采用已取消：等待期间你又改了草稿。新稿完整保留，原稿副本也已存好可在候选里找到。')
                        return
                      }
                      const nextText = c.text
                      const nextRef = c.reference || null
                      // 采用 = **一次 store 操作**：缓存 + 本地态 + 原生输入一起换（N03），随后落一次盘
                      applyDraftSnapshot(project, { text: nextText, reference: nextRef }, {
                        setLocalDraft,
                        setReference,
                        setNativeDraft: (t) => handleRef.current?.setDraft(t),
                      })
                      bumpEdit()
                      persistCompanionDraft(project)
                      setPreviewCandidate(null)
                    } finally {
                      adopting.current = false
                    }
                  })()
                },
                children: '采用这一份',
              }),
            ] }, c.windowId)),
            previewCandidate
              ? jsx.jsxs('div', { className: 'dshWmDraftPreview', children: [
                  jsx.jsx('pre', { children: previewCandidate.text }),
                  jsx.jsx('span', { className: 'dshWmMemoryNote', children: '采用前会先把当前草稿另存为一份可恢复副本（随后出现在上面的候选列表里，可随时切回）；引用按这一份一起替换' }),
                ] })
              : null,
          ] })
        : null,
      reference ? jsx.jsxs('div', { className: 'dshWmReference', 'data-wm-reference-status': refStatus, children: [
        jsx.jsxs('details', { children: [
          jsx.jsx('summary', { children: reference.label }),
          jsx.jsxs('div', { className: 'dshWmMemoryNote', children: [
            reference.path ? '来源：' + reference.path : '来源：未记录（旧引用）',
            reference.revision != null ? ' · 版本 ' + String(reference.revision).slice(0, 10) : '',
            reference.selection ? ' · 选区 ' + reference.selection.start + '-' + reference.selection.end : '',
            refStatus === 'unsaved' ? ' · 取自未保存的编辑器内容' : '',
          ] }),
          jsx.jsx('pre', { children: reference.text }),
        ] }),
        refStatus === 'stale'
          ? jsx.jsx('button', {
              className: 'dshWmQuiet',
              'data-wm-reference-restale': '1',
              title: '源稿已经改过，重新取当前内容作为引用',
              onClick: () => {
                const value = contextText?.()
                if (value?.text) updateReference(value)
              },
              children: '引用来自旧快照 · 重新引用',
            })
          : null,
        jsx.jsx('button', { className: 'dshWmQuiet', 'aria-label': '移除稿件引用', onClick: () => updateReference(null), children: '×' }),
      ] }) : null,
      jsx.jsx('textarea', { className: 'dshWmChatInput', 'aria-label': '和写作伙伴聊聊', placeholder: '说说你正在想的…', value: draft, disabled: !sessions, onChange: e => updateDraft(e.target.value), onKeyDown: e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void send() }
      } }),
      jsx.jsxs('div', { className: 'dshWmContext', children: [
        jsx.jsx('button', {
          className: 'dshWmQuiet',
          'data-wm-context-toggle': '1',
          disabled: !sessions,
          onClick: () => setContextOpen((v) => !v),
          children: includeMemory ? (memoryHint(memoryItems) || '本次没有可参考的已确认条目') : '本次不参考项目备忘',
        }),
        jsx.jsxs('label', { className: 'dshWmContextSwitch', title: '这一轮是否参考项目备忘', children: [
          jsx.jsx('input', {
            type: 'checkbox',
            'data-wm-context-enabled': '1',
            checked: includeMemory,
            onChange: (e) => setIncludeMemory(e.target.checked),
          }),
          '参考',
        ] }),
        contextOpen
          ? jsx.jsxs('div', { className: 'dshWmContextPanel', children: [
              memoryMeta.ok ? null : jsx.jsx('div', { className: 'dshWmMemoryNote', children: '备忘读取失败（' + memoryMeta.error + '）：这一轮不会自动发出；发送时可以在"重试/不参考发送"之间选。' }),
              jsx.jsx('div', { className: 'dshWmMemoryNote', 'data-wm-context-summary': '1', children: includeMemory
                ? `本轮实际带入 ${memoryPreview.selected.length} 条${budgetOmitted ? `，另有 ${budgetOmitted} 条超出 ${DEFAULT_MEMORY_BUDGET} 字预算省略` : ''}（勾选=本轮参考，取消勾选=不带；待定问题要勾选才会带入；"优先"只是把它们排在最前面）`
                : '本轮不参考项目备忘（开关已关）' }),
              previewRows.length
                ? previewRows.map((row) => jsx.jsxs('div', { className: 'dshWmContextItem', 'data-wm-memory-row': row.id, children: [
                    jsx.jsx('input', {
                      type: 'checkbox',
                      'data-wm-memory-pin': row.id,
                      // 待定问题默认不带入（C02）：勾选 = 明确选择这一条；其他条目默认带入，取消 = 明确排除。
                      checked: row.kind === 'open-question' ? pinned.includes(row.id) : !excluded.includes(row.id),
                      title: row.kind === 'open-question' ? '勾选才把这个问题带进本轮' : '这一条是否参与本轮',
                      onChange: (e) => {
                        if (row.kind === 'open-question') {
                          setPinned((prev) => (e.target.checked ? [...prev, row.id] : prev.filter((x) => x !== row.id)))
                          return
                        }
                        setExcluded((prev) => (e.target.checked ? prev.filter((x) => x !== row.id) : [...prev, row.id]))
                      },
                    }),
                    jsx.jsx('span', { className: 'dshWmMemoryKind', children: row.kind === 'preference' ? '偏好' : row.kind === 'open-question' ? '待定' : '设定' }),
                    jsx.jsx('span', { className: 'dshWmContextText', children: row.text }),
                    row.kind === 'open-question'
                      ? null
                      : jsx.jsx('button', {
                          className: 'dshWmQuiet',
                          'data-wm-memory-fix': row.id,
                          title: '固定优先：本轮先于其他条目带入（不改变是否带入）',
                          onClick: () => setPinned((prev) => prev.includes(row.id) ? prev.filter((x) => x !== row.id) : [...prev, row.id]),
                          children: pinned.includes(row.id) ? '优先 ✓' : '优先',
                        }),
                    jsx.jsx('span', { className: 'dshWmContextState', 'data-wm-memory-state': row.state, children: `${row.state} · 来源：${row.source}` }),
                  ] }, row.id))
                : jsx.jsx('div', { className: 'dshWmMemoryNote', children: '还没有已确认的设定/偏好。在"项目备忘"里确认后才会出现在这里。' }),
              memoryPreview.omissions.some((o) => o.reason === 'not-injectable')
                ? jsx.jsx('div', { className: 'dshWmMemoryNote', children: '有条目处于候选/已撤回/已解决状态，本轮不会自动带入。' })
                : null,
              jsx.jsx('div', { className: 'dshWmMemoryNote', children: '自动部分有 ' + String(DEFAULT_MEMORY_BUDGET) + ' 字上限（Unicode 字符数，不是 token）。你的正文与显式引用的稿件不受这个上限影响。' }),
            ] })
          : null,
      ] }),
      jsx.jsxs('div', { className: 'dshWmComposeFoot', children: [
        jsx.jsx('button', { className: 'dshWmQuiet', disabled: !sessions, onClick: () => { const value = contextText(); if (value?.text) updateReference(value) }, children: '＋ 引用稿件 / 选区' }),
        jsx.jsx('span', { className: 'dshWmInputHint', children: 'Shift + Enter 换行' }),
        snapshot.running ? jsx.jsx('button', { className: 'dshWmQuiet', 'aria-label': '停止回复', onClick: () => void (handle ? handle.cancel().catch(err => setError(err.message)) : setError('会话尚未就绪')), children: '停止' }) : null,
        jsx.jsx('button', { className: 'dshWmSend', disabled: !sessions || busy || !draft.trim(), onClick: () => void send(), 'aria-label': snapshot.running ? '排队发送' : '发送', title: snapshot.running ? '在本次回复后发送' : '发送', children: busy ? '…' : '↑' }),
      ] }),
    ] }),
  ] })
}
export function WritingCompanion({ path, contextText, sourceInfo, onExit }) {
  const [result, setResult] = react.useState(null)
  const [retry, setRetry] = react.useState(0)
  react.useEffect(() => {
    let active = true
    if (path) void api('companion', undefined, { path }).then(async data => {
      if (data.ok && data.sessionId && harnessSessions()) {
        await harnessSessions().refresh()
        if (!harnessSessions().list.getSnapshot().byId[data.sessionId]) data.sessionId = null
      }
      if (active) setResult({ path, ...data })
    }).catch(err => { if (active) setResult({ path, error: err.message }) })
    return () => { active = false }
  }, [path, retry])
  if (!path || result?.path !== path) return jsx.jsx('div', { className: 'dshWmCompanionEmpty', children: path ? '正在打开对话…' : '打开一份稿件，从这里聊起。' })
  if (!result.ok) return jsx.jsxs('div', { className: 'dshWmCompanionError', role: 'alert', children: [result.error, jsx.jsx('button', { className: 'dshWmQuiet', onClick: () => setRetry(n => n + 1), children: '重试' })] })
  return jsx.jsx(CompanionChat, { initialBinding: result, path, contextText, sourceInfo, onExit }, result.project)
}
