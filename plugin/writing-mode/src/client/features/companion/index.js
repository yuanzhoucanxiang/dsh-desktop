/**
 * 写作模式客户端模块（P1 从 entry.js 搬迁；行为不变）。
 */
import { loadProjectMemory, CompanionMemoryPanel } from '../memory/index.js'
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { api } from '../../services/writing-api.js'
import { companionDrafts, loadCompanionDraft, companionRecoveryState, companionDraftDirty, companionDraftConflict, companionDraftStatus, setDraftStatus, getDraftStatus, subscribeDraftStatus, resolveDraftConflict, retryDraftConflictRemote, persistCompanionDraft } from '../../state/companion-drafts.js'
import { harnessSessions } from '../../adapters/harness/runtime.js'
import { appendCompanionDraft, ensureCompanionSession } from '../../adapters/harness/sessions.js'
import { buildPreparedTurn } from '../../../shared/context-builder.js'

export const emptyCompanionSnapshot = Object.freeze({})
export const noSubscribe = () => () => {}
export const emptySnapshot = () => emptyCompanionSnapshot
export function useCompanionStore(store) {
  const subscribe = react.useCallback(fn => store ? store.subscribe(fn) : noSubscribe(), [store])
  const snapshot = react.useCallback(() => store ? store.getSnapshot() : emptySnapshot(), [store])
  return react.useSyncExternalStore(subscribe, snapshot)
}
export function companionRows(snapshot) {
  const chat = snapshot.chat
  if (!chat) return []
  return chat.order.flatMap(key => {
    const node = chat.nodes.get(key)
    if (!node || node.visibility === 'hidden') return []
    const data = node.data || {}
    const textOf = parts => (parts || []).filter(p => p.kind === 'text' || p.type === 'text').map(p => p.text || '').join('')
    if (node.kind === 'user' || node.kind === 'steering') {
      const [text, reference] = textOf(data.content).split('\n\n--- 供本次讨论参考的稿件快照（可能尚未保存） ---\n')
      return [{ key, kind: 'user', text: text || '附件消息（在完整会话中查看）', reference }]
    }
    if (node.kind === 'assistant-step') {
      const text = textOf(data.blocks)
      return text ? [{ key, kind: 'assistant', text }] : []
    }
    if (node.kind === 'turn-tail') return [] // footer of the same assistant step
    if (node.kind === 'tool-call') return [{ key, kind: 'detail', text: '工具活动', detail: data }]
    if (node.kind === 'turn-error') return [{ key, kind: 'error', text: data.failure?.message || '这次回复未能完成，请查看完整会话。' }]
    return [{ key, kind: 'detail', text: node.kind === 'context' ? '补充上下文' : '会话活动', detail: data }]
  })
}


export function CompanionTranscript({ snapshot, onFull }) {
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
      jsx.jsx('div', { className: 'dshWmMessageText', children: row.text }),
      row.reference ? jsx.jsxs('details', { className: 'dshWmActivity', children: [jsx.jsx('summary', { children: '引用的稿件' }), jsx.jsx('pre', { children: row.reference })] }) : null,
    ] }, row.key)),
    (snapshot.queue || []).map(row => jsx.jsx('div', { className: 'dshWmActivity', children: '等待回复后发送 · ' + (row.text || row.preview || '消息') }, row.id)),
    (snapshot.pending || []).map(wait => jsx.jsxs('div', { className: 'dshWmRequest', children: [
      jsx.jsx('strong', { children: wait.kind === 'approval' ? '有一项操作需要你授权' : '写作伙伴有个问题想确认' }),
      jsx.jsx('button', { className: 'dshWmQuiet', onClick: onFull, children: '查看并处理 ↗' }),
    ] }, wait.key)),
    snapshot.running ? jsx.jsx('div', { className: 'dshWmThinking', role: 'status', children: '正在回应…' }) : null,
  ] })
}
export function CompanionChat({ initialBinding, path, contextText, onExit }) {
  const sessions = harnessSessions()
  const [binding, setBinding] = react.useState(initialBinding)
  const project = binding.project
  const cached = companionDrafts.get(project) || { text: '', reference: null }
  const [localDraft, setLocalDraft] = react.useState(cached.text)
  const [reference, setReference] = react.useState(cached.reference)
  const [busy, setBusy] = react.useState(false)
  const [error, setError] = react.useState('')
  const [memOpen, setMemOpen] = react.useState(false)
  const alive = react.useRef(true)
  const sending = react.useRef(false)
  const id = binding.sessionId
  const session = id ? sessions?.binding(id)?.session : null
  const info = id ? sessions?.provideInfo(id) : null
  const snapshot = useCompanionStore(session)
  const input = useCompanionStore(info?.hooks?.input)
  const draft = info ? input.draft || '' : localDraft
  const needsFullComposer = Boolean(input.imageIds?.length || input.claim || draft.trimStart().startsWith('/'))
  react.useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  react.useEffect(() => { if (id) sessions?.open(id) }, [id, sessions])
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
        const nativeDraft = info?.hooks?.input?.getSnapshot?.().draft || ''
        const adoptText = nativeDraft || c.text || ''
        const adoptRef = c.reference || null
        companionDrafts.set(project, {
          text: adoptText,
          reference: adoptRef,
          rev: Number.isInteger(c.rev) ? c.rev : 0,
        })
        if (adoptRef) setReference((prev) => prev || adoptRef)
        if (!nativeDraft && c.text) {
          setLocalDraft(c.text)
          try {
            if (info?.props?.inputActions?.setDraft) info.props.inputActions.setDraft(c.text)
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
  function updateDraft(text) {
    recoveryGen.current++
    if (info) info.props.inputActions.setDraft(text)
    else setLocalDraft(text)
    const prev = companionDrafts.get(project) || { text: '', reference: null, rev: 0 }
    companionDrafts.set(project, { ...prev, text })
    companionDraftDirty.set(project, true)
    if (companionRecoveryState.get(project) === 'pending') return
    // X01: draft save errors live only in companionDraftStatus (subscribed UI)
    persistCompanionDraft(project)
  }
  function updateReference(value) {
    recoveryGen.current++
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
      const next = id ? binding : await ensureCompanionSession(sessions, path, () => alive.current)
      if (!next || !alive.current) return
      if (!id && draft) appendCompanionDraft(sessions, next.sessionId, draft)
      sessions.open(next.sessionId)
      setBinding(next)
      onExit()
    } catch (err) { if (alive.current) setError(err.message) }
    finally { sending.current = false; if (alive.current) setBusy(false) }
  }
  async function send() {
    if (sending.current || !draft.trim()) return
    if (needsFullComposer) { void fullConversation(); return }
    sending.current = true; setBusy(true); setError('')
    const sentDraft = draft, sentReference = reference
    try {
      const next = id ? binding : await ensureCompanionSession(sessions, path, () => alive.current)
      if (!next || !alive.current) return
      const target = sessions.binding(next.sessionId)?.session
      if (!target) throw new Error('会话尚未就绪，请重试')
      const targetInfo = sessions.provideInfo(next.sessionId)
      if (!id) {
        targetInfo.props.inputActions.setDraft(companionDrafts.get(project)?.text || sentDraft)
        setBinding(next)
      }
      const memData = await loadProjectMemory(project)
      const memoryItems = memData.ok ? memData.memory?.items || [] : []
      const memWarning = memData.ok ? '' : String(memData.error || 'memory-unavailable')
      const prepared = buildPreparedTurn({
        message: sentDraft,
        reference: sentReference
          ? { label: sentReference.label, text: sentReference.text, path: sentReference.path, revision: sentReference.revision }
          : null,
        memoryItems,
        projectKey: project,
        memoryRevision: memData.ok ? memData.memory?.revision : null,
      })
      if (memWarning && alive.current) setError('备忘读取失败，本次未带入已确认设定：' + memWarning)
      const result = await target.prompt([{ type: 'text', text: prepared.body }], 'queue')
      if (!result.ok) throw new Error(result.error?.message || '发送失败，请重试')
      // W03: one protected clear after send; tombstone advances rev
      const nowDraft = targetInfo.hooks.input.getSnapshot().draft
      const draftCleared = nowDraft === sentDraft || nowDraft === '' || nowDraft == null
      const nowRef = companionDrafts.get(project)?.reference || null
      const refCleared = !nowRef || (nowRef.text === sentReference?.text && nowRef.label === sentReference?.label)
      if (draftCleared) {
        targetInfo.props.inputActions.setDraft('')
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
    const failure = error || snapshot.openError?.message || snapshot.promptError?.error?.message
  return jsx.jsxs('div', { className: 'dshWmCompanion', children: [
    jsx.jsxs('div', { className: 'dshWmConversationHead', children: [
      jsx.jsx('span', { title: project, children: project.split(/[\\/]/).filter(Boolean).pop() }),
      jsx.jsx('button', { className: 'dshWmQuiet', onClick: () => setMemOpen(v => !v), children: memOpen ? '收起备忘' : '项目备忘' }),
      jsx.jsx('button', { className: 'dshWmQuiet', onClick: () => void fullConversation(), disabled: busy || !sessions, title: '打开完整会话，调整模型、工具或处理请求', children: '会话设置 ↗' }),
    ] }),
    memOpen ? jsx.jsx(CompanionMemoryPanel, { path: project }) : null,
    jsx.jsx(CompanionTranscript, { snapshot, onFull: () => void fullConversation() }),
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
                setNativeDraft: (t) => {
                  if (info?.props?.inputActions?.setDraft) info.props.inputActions.setDraft(t)
                },
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
                    setNativeDraft: (t) => {
                      if (info?.props?.inputActions?.setDraft) info.props.inputActions.setDraft(t)
                    },
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
    failure ? jsx.jsx('div', { className: 'dshWmCompanionError', role: 'alert', children: failure }) : null,
    needsFullComposer ? jsx.jsx('button', { className: 'dshWmQuiet', onClick: () => void fullConversation(), children: '在完整会话中发送附件或使用指令 ↗' }) : null,
    jsx.jsxs('div', { className: 'dshWmCompose', children: [
      reference ? jsx.jsxs('div', { className: 'dshWmReference', children: [
        jsx.jsxs('details', { children: [jsx.jsx('summary', { children: reference.label }), jsx.jsx('pre', { children: reference.text })] }),
        jsx.jsx('button', { className: 'dshWmQuiet', 'aria-label': '移除稿件引用', onClick: () => updateReference(null), children: '×' }),
      ] }) : null,
      jsx.jsx('textarea', { className: 'dshWmChatInput', 'aria-label': '和写作伙伴聊聊', placeholder: '说说你正在想的…', value: draft, disabled: !sessions, onChange: e => updateDraft(e.target.value), onKeyDown: e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void send() }
      } }),
      jsx.jsxs('div', { className: 'dshWmComposeFoot', children: [
        jsx.jsx('button', { className: 'dshWmQuiet', disabled: !sessions, onClick: () => { const value = contextText(); if (value?.text) updateReference(value) }, children: '＋ 引用稿件 / 选区' }),
        jsx.jsx('span', { className: 'dshWmInputHint', children: 'Shift + Enter 换行' }),
        snapshot.running ? jsx.jsx('button', { className: 'dshWmQuiet', 'aria-label': '停止回复', onClick: () => void session.cancel().catch(err => setError(err.message)), children: '停止' }) : null,
        jsx.jsx('button', { className: 'dshWmSend', disabled: !sessions || busy || !draft.trim(), onClick: () => void send(), 'aria-label': snapshot.running ? '排队发送' : '发送', title: snapshot.running ? '在本次回复后发送' : '发送', children: busy ? '…' : '↑' }),
      ] }),
    ] }),
  ] })
}
export function WritingCompanion({ path, contextText, onExit }) {
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
  return jsx.jsx(CompanionChat, { initialBinding: result, path, contextText, onExit }, result.project)
}
