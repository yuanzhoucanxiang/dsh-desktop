/**
 * 写作模式客户端入口（ESM 源码；构建经 esbuild 打包为 client.js 的 ModuleLoader 工厂体）。
 * - react / react/jsx-runtime 由 factory 的 require 提供（external，不打入第二份）
 * - 共享控制器与纯函数来自 ../shared/*（P1 起为真模块导入，不再由构建脚本正则拼装）
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { createEditorSession } from '../shared/editor-session.js'
import { buildPreparedTurn, memoryHint } from '../shared/context-builder.js'
import { T } from './copy.js'
import { ensureWritingCss } from './styles/writing-css.js'
import { api } from './services/writing-api.js'
import {
  companionDrafts,
  companionWindowId,
  loadCompanionDraft,
  draftSaveQueue,
  companionRecoveryState,
  companionDraftDirty,
  companionDraftConflict,
  companionDraftStatus,
  draftStatusListeners,
  setDraftStatus,
  getDraftStatus,
  notifyDraftStatus,
  subscribeDraftStatus,
  isDraftConflict,
  draftErrorText,
  applyDraftSnapshot,
  resolveDraftConflict,
  retryDraftConflictRemote,
  persistCompanionDraft,
} from './state/companion-drafts.js'

const __wmAlreadyLoaded = window.__dshWritingModeLoaded === true
window.__dshWritingModeLoaded = true

export const name = 'writing-mode'

const LS_KEY = 'dsh-writing-mode-active'
const LS_FILE = 'dsh-writing-mode-file'
let sessionRuntime = null
let nativeApi = null
let workspaceRuntime = null

function appendCompanionDraft(sessions, id, text) {
  const info = sessions.provideInfo(id)
  if (!info?.props?.inputActions?.setDraft || !info?.hooks?.input) throw new Error('原生输入框尚未就绪，请稍后重试')
  const draft = info.hooks.input.getSnapshot().draft || ''
  info.props.inputActions.setDraft(draft ? draft + '\n\n' + text : text)
}


async function ensureCompanionSession(sessions, path, isCurrent = () => true, connection = nativeApi, workspaces = workspaceRuntime) {
  if (!sessions) throw new Error('Harness 会话服务尚未就绪')
  const binding = await api('companion', undefined, { path })
  if (!binding.ok) throw new Error(binding.error)
  await sessions.refresh()
  if (!isCurrent()) return null
  let id = binding.sessionId
  if (!id || !sessions.list.getSnapshot().byId[id]) {
    const prepared = await api('companion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, prepare: true }) })
    if (!prepared.ok) throw new Error(prepared.error)
    if (!connection?.agentPresets?.select || !workspaces) throw new Error('Harness 未提供原生角色或工作区服务，请检查内核版本')
    if (!isCurrent()) return null
    const workspace = await workspaces.create({ path: binding.project })
    if (!isCurrent()) return null
    id = await sessions.create({ workspaceId: workspace.workspaceId })
    const selected = await connection.agentPresets.select({ sessionId: id, agentPreset: prepared.preset })
    if (!selected.result.ok) throw new Error(selected.result.error.message)
    sessions.noteAgentPreset(id, selected.result.value.agentPreset)
    const data = await api('companion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, sessionId: id }) })
    if (!data.ok) throw new Error('会话已创建，但项目关联未保存：' + data.error)
  }
  if (!isCurrent()) return null
  sessions.open(id)
  // Reload the native role picker after the confirmed session becomes current.
  await api('companion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, prepare: true }) })
  if (!isCurrent()) return null
  return { ...binding, sessionId: id }
}


// Conversation history stays in Harness. Unsent text lives in host checkpoints.








async function loadProjectMemory(path) {
  try {
    const data = await api('memory', undefined, { path })
    return data
  } catch (err) {
    return { ok: false, error: String(err?.message || 'memory-load-failed'), memory: { items: [] }, injectable: [] }
  }
}

function CompanionMemoryPanel({ path }) {
  const [state, setState] = react.useState({ loading: true, items: [], etag: '', revision: 0, error: '' })
  const [draftText, setDraftText] = react.useState('')
  const [busy, setBusy] = react.useState(false)
  const refresh = react.useCallback(async () => {
    if (!path) { setState({ loading: false, items: [], etag: '', revision: 0, error: '' }); return }
    const data = await loadProjectMemory(path)
    if (data.ok) {
      setState({ loading: false, items: data.memory.items || [], etag: data.etag, revision: data.memory.revision, error: '' })
    } else {
      setState({ loading: false, items: [], etag: '', revision: 0, error: '备忘不可用' })
    }
  }, [path])
  react.useEffect(() => { void refresh() }, [refresh])
  async function post(op, body) {
    const data = await api('memory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path,
        op,
        baseEtag: state.etag,
        baseRevision: state.revision,
        ...body,
      }),
    })
    if (data.ok) {
      setState({ loading: false, items: data.memory.items || [], etag: data.etag, revision: data.memory.revision, error: '' })
      setDraftText('')
    } else if (data.error === 'etag-conflict' || data.error === 'revision-conflict') {
      await refresh()
      setState(s => ({ ...s, error: '备忘已在别处修改，已刷新，请重试' }))
    } else {
      setState(s => ({ ...s, error: String(data.error || 'failed') }))
    }
  }
  return jsx.jsxs('div', { className: 'dshWmMemory', children: [
    jsx.jsx('div', { className: 'dshWmCompanionEmpty', style: { padding: '8px 10px', textAlign: 'left', lineHeight: 1.5 }, children: '作者确认后的设定/偏好才会被自动带入对话。AI 建议默认是候选，不会当成事实。' }),
    jsx.jsxs('div', { className: 'dshWmAiActions', style: { padding: '0 10px 6px' }, children: [
      jsx.jsx('input', {
        className: 'dshWmSearch',
        style: { margin: 0, flex: 1 },
        placeholder: '写下一条设定或偏好…',
        value: draftText,
        onChange: e => setDraftText(e.target.value),
        onKeyDown: e => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          if (e.key === 'Enter' && !e.shiftKey && draftText.trim()) {
            e.preventDefault()
            void post('add', { item: { kind: 'fact', status: 'confirmed', text: draftText, source: { kind: 'author' } } })
          }
        },
      }),
      jsx.jsx('button', {
        className: 'dshWmBtn is-primary',
        disabled: !draftText.trim() || state.loading || busy || !state.etag,
        onClick: () => void post('add', { item: { kind: 'fact', status: 'confirmed', text: draftText, source: { kind: 'author' } } }),
        children: '记下',
      }),
    ] }),
    state.error ? jsx.jsx('div', { className: 'dshWmCompanionError', style: { margin: '0 10px' }, children: state.error }) : null,
    jsx.jsx('div', { className: 'dshWmMemoryList', children: state.items.slice().reverse().map(it => jsx.jsxs('div', {
      className: 'dshWmMemoryItem is-' + it.status,
      children: [
        jsx.jsxs('div', { className: 'dshWmMemoryMeta', children: [
          jsx.jsx('span', { className: 'dshWmMemoryKind', children: it.kind === 'preference' ? '偏好' : it.kind === 'open-question' ? '待定' : '设定' }),
          jsx.jsx('span', { className: 'dshWmMemoryStatus', children: it.status }),
        ] }),
        jsx.jsx('div', { className: 'dshWmMemoryText', children: it.text }),
        jsx.jsxs('div', { className: 'dshWmMemoryActions', children: [
          it.status !== 'confirmed' && it.status !== 'retracted' && it.status !== 'resolved'
            ? jsx.jsx('button', { className: 'dshWmQuiet', onClick: () => void post('update', { id: it.id, item: { status: 'confirmed', text: it.text } }), children: '确认' })
            : null,
          it.status === 'confirmed' || it.status === 'proposed'
            ? jsx.jsx('button', { className: 'dshWmQuiet', onClick: () => void post('retract', { id: it.id }), children: '撤回' })
            : null,
          it.kind === 'open-question' && it.status === 'confirmed'
            ? jsx.jsx('button', { className: 'dshWmQuiet', onClick: () => void post('resolve', { id: it.id }), children: '已解决' })
            : null,
        ] }),
      ],
    }, it.id)),
    }),
  ] })
}

const emptyCompanionSnapshot = Object.freeze({})
const noSubscribe = () => () => {}
const emptySnapshot = () => emptyCompanionSnapshot
function useCompanionStore(store) {
  const subscribe = react.useCallback(fn => store ? store.subscribe(fn) : noSubscribe(), [store])
  const snapshot = react.useCallback(() => store ? store.getSnapshot() : emptySnapshot(), [store])
  return react.useSyncExternalStore(subscribe, snapshot)
}
function companionRows(snapshot) {
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


function CompanionTranscript({ snapshot, onFull }) {
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
function CompanionChat({ initialBinding, path, contextText, onExit }) {
  const sessions = sessionRuntime
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
function WritingCompanion({ path, contextText, onExit }) {
  const [result, setResult] = react.useState(null)
  const [retry, setRetry] = react.useState(0)
  react.useEffect(() => {
    let active = true
    if (path) void api('companion', undefined, { path }).then(async data => {
      if (data.ok && data.sessionId && sessionRuntime) {
        await sessionRuntime.refresh()
        if (!sessionRuntime.list.getSnapshot().byId[data.sessionId]) data.sessionId = null
      }
      if (active) setResult({ path, ...data })
    }).catch(err => { if (active) setResult({ path, error: err.message }) })
    return () => { active = false }
  }, [path, retry])
  if (!path || result?.path !== path) return jsx.jsx('div', { className: 'dshWmCompanionEmpty', children: path ? '正在打开对话…' : '打开一份稿件，从这里聊起。' })
  if (!result.ok) return jsx.jsxs('div', { className: 'dshWmCompanionError', role: 'alert', children: [result.error, jsx.jsx('button', { className: 'dshWmQuiet', onClick: () => setRetry(n => n + 1), children: '重试' })] })
  return jsx.jsx(CompanionChat, { initialBinding: result, path, contextText, onExit }, result.project)
}


ensureWritingCss()




function applyBodyAttr(active) {
  try {
    if (active) document.documentElement.setAttribute('data-writing-mode', 'on')
    else {
      document.documentElement.removeAttribute('data-writing-mode')
      document.body.removeAttribute('data-writing-focus')
      document.body.removeAttribute('data-writing-lib')
    }
  } catch {}
}

/* ── 模块级开关（overlay 与侧栏入口共用）── */
function readActiveLS() {
  try {
    return localStorage.getItem(LS_KEY) === '1'
  } catch {
    return false
  }
}
let modeActive = readActiveLS()
let closeGuard = null
const modeListeners = new Set()
function setModeActive(next) {
  if (!next && modeActive && closeGuard) { void closeGuard(); return }
  commitModeActive(next)
}
function commitModeActive(next) {
  if (modeActive === next) return
  modeActive = next
  try {
    localStorage.setItem(LS_KEY, next ? '1' : '0')
  } catch {}
  applyBodyAttr(next)
  for (const fn of modeListeners) {
    try {
      fn()
    } catch {}
  }
}
function subscribeMode(fn) {
  modeListeners.add(fn)
  return () => modeListeners.delete(fn)
}
function getModeActive() {
  return modeActive
}

/** 侧栏底部入口：点击切换写作模式。 */
function WritingModeFooterEntry() {
  const [on, setOn] = react.useState(getModeActive)
  react.useEffect(() => subscribeMode(() => setOn(getModeActive())), [])
  return jsx.jsx('button', {
    type: 'button',
    className: on ? 'dshWmBtn is-primary' : 'dshWmBtn',
    title: on ? T.exit : T.toggle,
    style: { width: '100%', justifyContent: 'center' },
    onClick: () => setModeActive(!on),
    children: on ? T.exit : T.toggle,
  })
}

/** 会话顶栏工具区入口（次要，槽位缺失时静默）。 */
function WritingModeHeaderEntry() {
  const [on, setOn] = react.useState(getModeActive)
  react.useEffect(() => subscribeMode(() => setOn(getModeActive())), [])
  return jsx.jsx('button', {
    type: 'button',
    className: 'dshWmBtn',
    title: on ? T.exit : T.toggle,
    onClick: () => setModeActive(!on),
    children: on ? T.exit : T.toggle,
  })
}

/** 从文件名提取 -vN。模块级，供组件内 useMemo 使用。 */
function versionOf(name) {
  const m = String(name || '').match(/-v(\d+)(\.[^.]+)?$/i)
  return m ? Number(m[1]) : null
}

const DEFAULT_PREFS = {
  fontSize: 17,
  lineHeight: 1.95,
  autoSaveMs: 800,
  autoGate: true,
  aiMode: 'harness',
  aiProvider: 'deepseek-official',
  aiModel: 'deepseek-v4-flash',
  aiApiKey: '',
}
let prefsCache = { ...DEFAULT_PREFS }
const prefsListeners = new Set()
function getPrefs() {
  return prefsCache
}
function subscribePrefs(fn) {
  prefsListeners.add(fn)
  return () => prefsListeners.delete(fn)
}
function notifyPrefs() {
  for (const fn of prefsListeners) {
    try {
      fn()
    } catch {}
  }
}
function applyPrefsCss(p) {
  try {
    const el = document.documentElement
    el.style.setProperty('--dsh-wm-font-size', String(p.fontSize) + 'px')
    el.style.setProperty('--dsh-wm-line-height', String(p.lineHeight))
  } catch {}
}
async function loadPrefs() {
  try {
    const data = await api('config')
    if (data.ok && data.prefs) {
      prefsCache = { ...DEFAULT_PREFS, ...data.prefs }
      applyPrefsCss(prefsCache)
      notifyPrefs()
    }
  } catch {}
  return prefsCache
}
async function savePrefs(patch) {
  prefsCache = { ...prefsCache, ...patch }
  applyPrefsCss(prefsCache)
  notifyPrefs()
  try {
    await api('prefs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
  } catch {}
  return prefsCache
}
// 启动时预取一次
if (typeof window !== 'undefined') {
  void loadPrefs()
}

function WritingModeApp() {
  const [active, setActive] = react.useState(getModeActive)
  react.useEffect(() => subscribeMode(() => setActive(getModeActive())), [])
  const open = () => setModeActive(true)
  const close = () => setModeActive(false)
  const [roots, setRoots] = react.useState([])
  const [tree, setTree] = react.useState([])
  const [activeRoot, setActiveRoot] = react.useState(null)
  const editorRef = react.useRef(null)
  if (!editorRef.current) {
    let recovered = null
    let recoveryKey = 'dsh-writing-recovery'
    try {
      let id = sessionStorage.getItem('dsh-writing-window')
      if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('dsh-writing-window', id) }
      recoveryKey += ':' + id
      recovered = JSON.parse(localStorage.getItem(recoveryKey) || 'null')
      if (!recovered) {
        const last = localStorage.getItem(LS_FILE)
        const drafts = Object.keys(localStorage).filter(k => k.startsWith('dsh-writing-recovery:'))
          .map(k => { try { return JSON.parse(localStorage.getItem(k)) } catch { return null } })
          .filter(d => d?.path === last).sort((a, b) => b.updatedAt - a.updatedAt)
        recovered = drafts[0] || null
      }
    } catch {}
    const post = (route, body) => api(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    editorRef.current = createEditorSession({
      read: path => api('get', undefined, { path }),
      save: body => post('save', body),
      version: body => post('version', body),
      backup: draft => {
        if (draft) localStorage.setItem(recoveryKey, JSON.stringify({ ...draft, updatedAt: Date.now() }))
        else localStorage.removeItem(recoveryKey)
      },
    }, recovered)
  }
  const editor = editorRef.current
  const [documentState, setDocumentState] = react.useState(editor.get)
  react.useEffect(() => editor.subscribe(setDocumentState), [editor])
  const { path: filePath, content, dirty, status: saveState } = documentState
  const setContent = value => editor.change(value)
  const setFilePath = path => { void editor.open(path) }
  const [aiOpen, setAiOpen] = react.useState(true)
  const [aiTab, setAiTab] = react.useState('companion')
  const [aiOut, setAiOut] = react.useState('')
  const [aiBusy, setAiBusy] = react.useState(false)
  const [aiErr, setAiErr] = react.useState('')
  const [gate, setGate] = react.useState(null)
  const [gateBusy, setGateBusy] = react.useState(false)
  const [gateErr, setGateErr] = react.useState('')
  const [focus, setFocus] = react.useState(false)
  const [libOpen, setLibOpen] = react.useState(true)
  const [libQuery, setLibQuery] = react.useState('')
  const [collapsed, setCollapsed] = react.useState(() => new Set())
  const [copied, setCopied] = react.useState(false)
  const [diffLines, setDiffLines] = react.useState(null)
  const [diffLabel, setDiffLabel] = react.useState('')
  const [ledger, setLedger] = react.useState(null)
  const [gateOpen, setGateOpen] = react.useState(false)
  const [ledgerOpen, setLedgerOpen] = react.useState(false)
  const [newDocMode, setNewDocMode] = react.useState(false)
  const [newDocName, setNewDocName] = react.useState('')
  const [projMode, setProjMode] = react.useState(false)
  const [projTitle, setProjTitle] = react.useState('')
  const [projPremise, setProjPremise] = react.useState('')
  const [projTemplate, setProjTemplate] = react.useState('novel')
  const [templates, setTemplates] = react.useState([])
  const [addRootMode, setAddRootMode] = react.useState(false)
  const [addRootPath, setAddRootPath] = react.useState('')
  const [flash, setFlash] = react.useState('')
  const [prefs, setPrefs] = react.useState(getPrefs)
  react.useEffect(() => subscribePrefs(() => setPrefs({ ...getPrefs() })), [])
  react.useEffect(() => {
    void loadPrefs()
  }, [active])
  const taRef = react.useRef(null)
  const aiTarget = react.useRef(null)
  const saveTimer = react.useRef(0)
  const fileInputRef = react.useRef(null)
  const runGateRef = react.useRef(() => {})

  const docBasename = filePath
    ? String(filePath).split(/[\\/]/).filter(Boolean).pop()
    : ''
  const docFolder = filePath
    ? (() => {
        const parts = String(filePath).split(/[\\/]/).filter(Boolean)
        if (parts.length < 2) return ''
        return parts[parts.length - 2]
      })()
    : ''

  /** 同章版本系列（必须在任何 early-return 之前，遵守 Hooks 规则）。 */
  const versionSeries = react.useMemo(() => {
    if (!filePath) return []
    const curVer = versionOf(docBasename)
    if (curVer == null) return []
    const base = docBasename.replace(/-v\d+(\.[^.]+)?$/i, '')
    const ext = (docBasename.match(/\.[^.]+$/) || [''])[0]
    const out = []
    for (const root of tree) {
      for (const proj of root.projects || []) {
        for (const f of proj.files || []) {
          if (f.abs.replace(/[\\/][^\\/]+$/, '').toLowerCase() !== filePath.replace(/[\\/][^\\/]+$/, '').toLowerCase()) continue
          const n = f.name
          if (n.replace(/-v\d+(\.[^.]+)?$/i, '').toLowerCase() !== base.toLowerCase() || !n.toLowerCase().endsWith(ext.toLowerCase())) continue
          const v = versionOf(n)
          if (v == null) continue
          out.push({ v, abs: f.abs, name: n })
        }
      }
    }
    out.sort((a, b) => a.v - b.v)
    return out
  }, [filePath, docBasename, tree])

  const curVerNum = versionOf(docBasename)
  const latestVer =
    versionSeries.length > 0 ? versionSeries[versionSeries.length - 1] : null
  const isHistoryDoc =
    curVerNum != null && latestVer != null && curVerNum < latestVer.v

  react.useEffect(() => {
    applyBodyAttr(active)
  }, [active])

  react.useEffect(() => {
    try {
      if (focus) document.body.setAttribute('data-writing-focus', '1')
      else document.body.removeAttribute('data-writing-focus')
    } catch {}
  }, [focus])

  react.useEffect(() => {
    try {
      document.body.setAttribute('data-writing-lib', libOpen ? '1' : '0')
    } catch {}
  }, [libOpen])

  const refreshTree = react.useCallback(async () => {
    const data = await api('config')
    if (!data.ok) return
    setRoots(data.roots || [])
    setTree(data.tree || [])
    const active =
      (data.config && data.config.activeRoot) ||
      (data.roots || []).find((r) => r.default && !r.missing)?.path ||
      (data.roots || [])[0]?.path ||
      null
    setActiveRoot(active)
  }, [])

  react.useEffect(() => {
    if (!active) return
    void refreshTree()
  }, [active, refreshTree])

  react.useEffect(() => {
    if (!active || !sessionRuntime) return
    let running = new Set()
    const update = () => {
      const snapshot = sessionRuntime.list.getSnapshot()
      const next = new Set(Object.values(snapshot.byId).filter(s => s.running).map(s => s.id))
      if (Array.from(running).some(id => !next.has(id))) {
        void refreshTree().catch(() => {})
        void editor.refresh()
      }
      running = next
    }
    update()
    return sessionRuntime.list.subscribe(update)
  }, [active, editor, refreshTree])

  const persist = react.useCallback(() => editor.flush(), [editor])
  const saveAsNewVersion = () => editor.version()

  react.useEffect(() => {
    if (!active) return
    let reading = false
    const refresh = async () => {
      if (reading) return
      reading = true
      try { await editor.refresh() } finally { reading = false }
    }
    const timer = window.setInterval(refresh, 2000)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [active, editor])

  react.useEffect(() => {
    if (!active || editor.get().path) return
    try { const p = localStorage.getItem(LS_FILE); if (p) void editor.open(p) } catch {}
  }, [active, editor])

  react.useEffect(() => {
    closeGuard = async () => { if (await editor.close()) commitModeActive(false) }
    const protect = e => {
      if (!editor.get().dirty && editor.get().status !== 'saving') return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', protect)
    return () => { closeGuard = null; window.removeEventListener('beforeunload', protect) }
  }, [editor])

  react.useEffect(() => {
    if (!filePath) return
    let cancelled = false
    setGate(null); setGateErr(''); setLedger(null); setDiffLines(null)
    try { localStorage.setItem(LS_FILE, filePath) } catch {}
    void refreshTree().catch(err => flashMsg(err.message))
    void api('ledger', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    }).then(d => { if (!cancelled && d.ok) setLedger(d.ledger) }).catch(() => {})
    return () => { cancelled = true }
  }, [filePath, documentState.revision, refreshTree])

  react.useEffect(() => {
    if (!active || !dirty || !filePath || documentState.loading || documentState.status === 'error') return
    saveTimer.current = window.setTimeout(() => { void persist() }, prefs.autoSaveMs || 800)
    return () => window.clearTimeout(saveTimer.current)
  }, [active, dirty, filePath, content, documentState.loading, documentState.status, persist, prefs.autoSaveMs])

  react.useEffect(() => {
    if (!active) return
    const onKey = e => {
      if (e.key === 'Escape') {
        if (newDocMode || addRootMode) return
        close()
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (e.shiftKey) void editor.version()
        else void persist()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, newDocMode, addRootMode, editor, persist])

  function flashMsg(msg) {
    setFlash(String(msg || ''))
    window.setTimeout(() => setFlash(''), 3200)
  }

  async function addRootFromPrompt() {
    // Electron 下 window.prompt 常无反馈，改内联输入
    setAddRootMode(true)
    setAddRootPath('')
  }

  async function commitAddRoot() {
    const p = String(addRootPath || '').trim()
    if (!p) return
    const data = await api('roots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'add', path: p, active: true }),
    })
    setAddRootMode(false)
    setAddRootPath('')
    if (!data.ok) flashMsg('添加库失败：' + (data.error || 'unknown'))
    void refreshTree()
  }

  async function activateRoot(p) {
    setActiveRoot(p)
    await api('roots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'activate', path: p }),
    })
    void refreshTree()
  }

  function pickNativeFolder() {
    // webkitdirectory 在 Electron 不可靠：直接走内联路径输入
    setAddRootMode(true)
    setAddRootPath('')
  }

  function createDocInRoot() {
    const root =
      roots.find((r) => r.path === activeRoot && !r.missing) ||
      roots.find((r) => !r.missing)
    if (!root) {
      setAddRootMode(true)
      flashMsg('先添加一个库文件夹')
      return
    }
    setNewDocMode(true)
    setNewDocName(T.untitled)
  }

  function openProjectMode() {
    setProjMode(true)
    setProjTitle('')
    setProjPremise('')
    void api('templates')
      .then((d) => {
        if (d.ok) setTemplates(d.templates || [])
      })
      .catch(() => {})
  }

  async function commitProject() {
    const data = await api('create-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: projTitle,
        premise: projPremise,
        templateId: projTemplate,
      }),
    })
    setProjMode(false)
    if (!data.ok) {
      flashMsg(data.error === 'project-exists' ? '同名项目已存在' : '创建失败：' + (data.error || ''))
      return
    }
    flashMsg(T.created + '：' + (data.project?.name || ''))
    void refreshTree()
  }

  async function commitNewDoc() {
    const root = roots.find(r => r.path === activeRoot && !r.missing) || roots.find(r => !r.missing)
    if (!root) return
    const name = (newDocName || T.untitled).trim() || T.untitled
    if (await editor.create(root.path, name)) {
      setNewDocMode(false); setNewDocName('')
      taRef.current?.focus()
    }
  }

  function selectionText() {
    const ta = taRef.current
    if (!ta) return content.slice(0, 4000)
    const s = ta.selectionStart
    const e = ta.selectionEnd
    if (typeof s === 'number' && typeof e === 'number' && e > s) {
      return content.slice(s, e)
    }
    return content.slice(Math.max(0, (s || 0) - 400), (s || 0) + 1600) || content.slice(0, 2000)
  }

  async function runAssist(action) {
    const snapshot = editor.get()
    const selection = taRef.current ? { start: taRef.current.selectionStart, end: taRef.current.selectionEnd } : { start: 0, end: 0 }
    const isRec = action === 'research' || action === 'spark'
    const text = selectionText()
    if (!isRec && !text.trim()) {
      setAiErr(T.noText)
      flashMsg(T.noText)
      return
    }
    setAiBusy(true)
    setAiErr('')
    setAiOut('')
    try {
      const data = await api('assist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          text: text || content.slice(0, 4000),
          path: filePath,
          style: action === 'spark' ? 'spark' : 'research',
        }),
      })
      if (data.ok) {
        if (editor.get().path !== snapshot.path || editor.get().edit !== snapshot.edit) {
          flashMsg('文稿已切换或修改，本次 AI 结果未应用。')
          return
        }
        aiTarget.current = { path: snapshot.path, edit: snapshot.edit, ...selection }
        setAiOut(data.result || '')
        return
      }
      if (data.error === 'llm-unavailable') {
        // 内核未挂 llm：给出可发送会话的提示，避免「点了没反应」
        const tip =
          T.aiUnavailable +
          '\n\n【可直接发送到会话】\n请作为写作助手，对下列文本做「' +
          (T[action] || action) +
          '」：\n\n' +
          (text || content).slice(0, 2000)
        setAiOut(tip)
        setAiErr(T.aiUnavailable)
        flashMsg(T.aiUnavailable)
        return
      }
      setAiErr(String(data.error || 'failed'))
      flashMsg(String(data.error || 'failed'))
    } catch (err) {
      const m = String(err && err.message ? err.message : err)
      setAiErr(m)
      flashMsg(m)
    } finally {
      setAiBusy(false)
    }
  }

  const runGate = react.useCallback(async () => {
    setGateBusy(true)
    setGateErr('')
    try {
      const data = await api('gate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: filePath, content }),
      })
      if (data.ok && data.gate) {
        setGate(data.gate)
        if (data.gate.kind === 'none') setGateErr(T.gatesNone)
      } else {
        setGateErr(String(data.error || 'failed'))
      }
    } catch (err) {
      setGateErr(String(err && err.message ? err.message : err))
    } finally {
      setGateBusy(false)
    }
  }, [filePath, content])
  runGateRef.current = runGate

  // 打开文件后自动跑一次门禁
  react.useEffect(() => {
    if (!active || !filePath || !prefs.autoGate) return
    const ext = String(filePath).toLowerCase().split('.').pop()
    if (ext !== 'md' && ext !== 'markdown' && ext !== 'fountain') return
    void runGate()
  }, [active, filePath, documentState.revision, prefs.autoGate])

  function applyInsert() {
    if (!aiOut) return
    if (isHistoryDoc || !aiTarget.current || aiTarget.current.path !== filePath || aiTarget.current.edit !== editor.get().edit) {
      flashMsg('文稿已变化或为历史稿，请重新生成；历史稿请先另存新版。')
      return
    }
    setContent((c) => (c.endsWith('\n') ? c : c + '\n') + '\n' + aiOut + '\n')
  }

  function applyReplace() {
    if (!aiOut) return
    const target = aiTarget.current
    if (isHistoryDoc || !target || target.path !== filePath || target.edit !== editor.get().edit) {
      flashMsg('文稿已变化，请重新选择并生成。')
      return
    }
    const s = target.start
    const e = target.end
    if (typeof s === 'number' && typeof e === 'number' && e > s) {
      setContent(content.slice(0, s) + aiOut + content.slice(e))
    } else {
      flashMsg('生成前没有选区，请使用“插入文末”。')
    }
  }

  async function copyPath() {
    if (!filePath) return
    try {
      await navigator.clipboard.writeText(filePath)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {}
  }

  if (!active) {
    // 浮动入口由 ensureDomFloat 常驻注入；overlay 空闲时不重复渲染
    // 注意：此 return 必须位于**全部 hooks 之后**
    return null
  }

  const activeTree = tree.find((r) => {
    if (!activeRoot) return false
    return String(r.path).toLowerCase() === String(activeRoot).toLowerCase()
  }) || tree.find((r) => r.active) || tree[0]

  const projects = activeTree ? activeTree.projects || [] : []

  /** 把 rel 路径按顶层目录分组；q 非空时按文件名/路径过滤。 */
  function groupFiles(files, q) {
    const query = String(q || '').trim().toLowerCase()
    const map = new Map()
    for (const f of files || []) {
      if (query) {
        const hay = (f.name + ' ' + f.rel).toLowerCase()
        if (!hay.includes(query)) continue
      }
      const top = String(f.rel || '').includes('/')
        ? String(f.rel).split('/')[0]
        : '·'
      if (!map.has(top)) map.set(top, [])
      map.get(top).push(f)
    }
    const order = ['draft', 'bible', 'outline', 'state', 'reviews', '·']
    const keys = [...map.keys()].sort((a, b) => {
      const ia = order.indexOf(a)
      const ib = order.indexOf(b)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, 'zh')
    })
    return keys.map((k) => ({ key: k, files: map.get(k) }))
  }

  function maxVersionInGroup(files) {
    const max = new Map()
    for (const f of files || []) {
      const v = versionOf(f.name)
      const key = f.abs.replace(/-v\d+(\.[^.]+)$/i, '$1').toLowerCase()
      if (v != null) max.set(key, Math.max(max.get(key) || 0, v))
    }
    return max
  }

  function toggleProj(key) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // 文件行（带版本徽标）
  function fileButton(f, maxVer) {
    const ver = versionOf(f.name)
    const latest = maxVer instanceof Map ? maxVer.get(f.abs.replace(/-v\d+(\.[^.]+)$/i, '$1').toLowerCase()) : 0
    const isHist = ver != null && ver < latest
    return jsx.jsx(
      'button',
      {
        type: 'button',
        className: 'dshWmItem' + (filePath && f.abs === filePath ? ' is-on' : ''),
        onClick: () => setFilePath(f.abs),
        title: f.rel,
        children: [
          jsx.jsx(
            'div',
            {
              className: 'dshWmItemRow',
              children: [
                jsx.jsx(
                  'span',
                  {
                    className: 'dshWmItemTitle',
                    style: { flex: 1, minWidth: 0 },
                    children: f.name.replace(/-v\d+(\.[^.]+)?$/i, '$1'),
                  },
                  't'
                ),
                ver != null
                  ? jsx.jsx(
                      'span',
                      {
                        className: 'dshWmVer' + (isHist ? ' is-hist' : ''),
                        children: 'v' + ver,
                      },
                      'v'
                    )
                  : null,
              ],
            },
            'row'
          ),
          jsx.jsx(
            'span',
            { className: 'dshWmItemMeta', children: f.chars + T.chars },
            'm'
          ),
        ],
      },
      f.abs
    )
  }

  /** 极简行 diff：前后缀对齐，中间段整段 del/add（章稿对比够用）。 */
  function lineDiff(oldText, newText) {
    const a = String(oldText || '').split(/\r?\n/)
    const b = String(newText || '').split(/\r?\n/)
    let p = 0
    while (p < a.length && p < b.length && a[p] === b[p]) p++
    let s = 0
    while (
      s < a.length - p &&
      s < b.length - p &&
      a[a.length - 1 - s] === b[b.length - 1 - s]
    ) {
      s++
    }
    const out = []
    const ctx = 2
    for (const line of a.slice(Math.max(0, p - ctx), p)) out.push({ t: 'ctx', line })
    for (const line of a.slice(p, a.length - s)) out.push({ t: 'del', line })
    for (const line of b.slice(p, b.length - s)) out.push({ t: 'add', line })
    for (const line of a.slice(a.length - s, a.length - s + Math.min(s, ctx))) {
      out.push({ t: 'ctx', line })
    }
    return out
  }

  async function comparePrev() {
    if (curVerNum == null || versionSeries.length < 2) return
    const idx = versionSeries.findIndex((s) => s.abs === filePath)
    const prev = versionSeries[idx - 1]
    if (!prev) return
    const a = await api('get', undefined, { path: prev.abs })
    const b = await api('get', undefined, { path: filePath })
    if (!a.ok || !b.ok) return
    setDiffLines(lineDiff(a.doc.content, b.doc.content))
    setDiffLabel(`v${prev.v} → v${curVerNum}`)
  }

  const isReviewFile = /(^|[\\/])reviews[\\/]/i.test(String(filePath || ''))

  async function fillComposer(prompt) {
    const source = editor.get().path
    try {
      const next = await ensureCompanionSession(sessionRuntime, source || activeRoot, () => editor.get().path === source && getModeActive())
      if (!next) return false
      appendCompanionDraft(sessionRuntime, next.sessionId, prompt)
      setAiOpen(true); setAiTab('companion'); setFocus(false)
      flashMsg('已追加到写作伙伴输入框，补充想法后发送')
      return true
    } catch (err) { flashMsg(err.message); setAiErr(err.message); return false }
  }
  async function sendToChat() {
    const payload = aiOut || selectionText()
    const prompt = payload
      ? `请作为写作助手处理下面的文稿：\n\n${payload}`
      : `请作为写作助手，帮我完善当前文稿。`
    await fillComposer(prompt)
  }

  async function sendReviewToChat() {
    const prompt =
      '请作为写作主理，严格按下列评审报告修订对应文稿（只改 draft/bible/outline/state，报告本身不要改）。\n' +
      '先读报告与 draft 当前版本，再输出修改计划并执行；完成后把新版本号写入 project.md。\n\n' +
      '=== 评审报告 ===\n' +
      content +
      '\n\n=== 报告路径 ===\n' +
      filePath +
      '\n'
    await fillComposer(prompt)
  }

  const notice = documentState.error || flash
  return jsx.jsx('div', {
    className: 'dshWmRoot',
    role: 'dialog',
    'aria-label': T.toggle,
    children: [
      notice
        ? jsx.jsx('div', { className: 'dshWmFlash', role: 'alert', children: notice }, 'flash')
        : null,
      jsx.jsx(
        'div',
        {
          className: 'dshWmBar',
          children: [
            jsx.jsx('span', { className: 'dshWmBrand', children: '写作台' }),
            roots.length > 0
              ? jsx.jsx(
                  'select',
                  {
                    className: 'dshWmSelect',
                    value: activeRoot || '',
                    onChange: (e) => void activateRoot(e.target.value),
                    title: T.switchRoot,
                    children: roots.map((r) =>
                      jsx.jsx(
                        'option',
                        {
                          value: r.path,
                          children: (r.missing ? '⚠ ' : '') + (r.label || r.path),
                        },
                        r.path
                      )
                    ),
                  },
                  'roots'
                )
              : null,
            jsx.jsx('button', {
              type: 'button',
              className: 'dshWmBtn is-ghost',
              onClick: () => setAddRootMode(true),
              title: T.addRoot,
              children: '+',
            }),
            jsx.jsx('button', {
              type: 'button',
              className: 'dshWmBtn is-ghost',
              onClick: () => setAddRootMode(true),
              children: '…',
              title: T.addRoot,
            }),
            addRootMode
              ? jsx.jsx(
                  'span',
                  {
                    className: 'dshWmBarGroup',
                    children: [
                      jsx.jsx('input', {
                        className: 'dshWmSearch',
                        style: { width: 180, margin: 0 },
                        value: addRootPath,
                        placeholder: 'E:\\剧本',
                        autoFocus: true,
                        onChange: (e) => setAddRootPath(e.target.value),
                        onKeyDown: (e) => {
                          if (e.key === 'Enter') void commitAddRoot()
                          if (e.key === 'Escape') setAddRootMode(false)
                        },
                      }),
                      jsx.jsx('button', {
                        type: 'button',
                        className: 'dshWmBtn is-primary',
                        onClick: () => void commitAddRoot(),
                        children: 'OK',
                      }),
                    ],
                  },
                  'add-root'
                )
              : null,
            jsx.jsx('span', { className: 'dshWmBarSpacer' }),
            jsx.jsx(
              'div',
              {
                className: 'dshWmBarGroup',
                children: [
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn is-ghost',
                    onClick: () => setLibOpen((v) => !v),
                    title: libOpen ? T.hideLib : T.showLib,
                    children: libOpen ? '⟨' : '⟩',
                  }),
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn' + (focus ? ' is-on' : ''),
                    onClick: () => setFocus((v) => !v),
                    children: T.focus,
                  }),
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn' + (aiOpen ? ' is-on' : ''),
                    onClick: () => setAiOpen((v) => !v),
                    children: aiOpen ? T.closeAi : T.openAi,
                  }),
                ],
              },
              'views'
            ),
            jsx.jsx('span', { className: 'dshWmBarGroup', children: [
              jsx.jsx('button', {
                type: 'button',
                className: 'dshWmBtn',
                disabled: !filePath,
                onClick: () => void persist(),
                children: saveState === 'saving' ? T.saving : saveState === 'saved' ? T.saved : T.save,
              }),
              jsx.jsx('button', {
                type: 'button',
                className: 'dshWmBtn',
                disabled: !filePath,
                title: T.bumpHint || T.saveAsNew,
                onClick: () => void saveAsNewVersion(),
                children: 'v+1',
              }),
            ]}, 'file-ops'),
            jsx.jsx('button', {
              type: 'button',
              className: 'dshWmBtn is-primary',
              onClick: close,
              children: T.exit,
            }),
          ],
        },
        'bar'
      ),
      jsx.jsx(
        'div',
        {
          className: 'dshWmBody',
          children: [
            jsx.jsx(
              'aside',
              {
                className: 'dshWmSide',
                children: [
                  jsx.jsx(
                    'div',
                    {
                      className: 'dshWmSideHead',
                      children: [
                        jsx.jsx('span', { children: T.docs }),
                        jsx.jsx('span', { style: { flex: 1 } }),
                        jsx.jsx('button', {
                          type: 'button',
                          className: 'dshWmBtn',
                          onClick: openProjectMode,
                          children: T.newProject,
                        }),
                        jsx.jsx('button', {
                          type: 'button',
                          className: 'dshWmBtn',
                          onClick: createDocInRoot,
                          children: T.newDoc,
                        }),
                      ],
                    },
                    'dh'
                  ),
                  projMode
                    ? jsx.jsx(
                        'div',
                        {
                          style: {
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                            padding: '0 10px 10px',
                          },
                          children: [
                            jsx.jsx('input', {
                              className: 'dshWmSearch',
                              style: { margin: 0 },
                              value: projTitle,
                              autoFocus: true,
                              placeholder: T.projTitle,
                              onChange: (e) => setProjTitle(e.target.value),
                            }),
                            jsx.jsx('input', {
                              className: 'dshWmSearch',
                              style: { margin: 0 },
                              value: projPremise,
                              placeholder: T.projPremise,
                              onChange: (e) => setProjPremise(e.target.value),
                            }),
                            jsx.jsx(
                              'select',
                              {
                                className: 'dshWmSearch',
                                style: { margin: 0 },
                                value: projTemplate,
                                onChange: (e) => setProjTemplate(e.target.value),
                                children: (templates.length
                                  ? templates
                                  : [
                                      { id: 'novel', name: '小说 · 长篇连载' },
                                      { id: 'shortdrama', name: '短剧 · 竖屏' },
                                      { id: 'screenplay', name: '电影 / 剧集' },
                                    ]
                                ).map((t) =>
                                  jsx.jsx(
                                    'option',
                                    { value: t.id, children: t.name },
                                    t.id
                                  )
                                ),
                              },
                              'tmpl'
                            ),
                            jsx.jsx(
                              'div',
                              {
                                style: { display: 'flex', gap: 6 },
                                children: [
                                  jsx.jsx('button', {
                                    type: 'button',
                                    className: 'dshWmBtn is-primary',
                                    onClick: () => void commitProject(),
                                    children: T.create,
                                  }),
                                  jsx.jsx('button', {
                                    type: 'button',
                                    className: 'dshWmBtn',
                                    onClick: () => setProjMode(false),
                                    children: T.cancel,
                                  }),
                                ],
                              },
                              'pb'
                            ),
                          ],
                        },
                        'proj'
                      )
                    : null,
                  newDocMode
                    ? jsx.jsx(
                        'div',
                        {
                          style: { display: 'flex', gap: 6, padding: '0 10px 8px' },
                          children: [
                            jsx.jsx('input', {
                              className: 'dshWmSearch',
                              style: { margin: 0, flex: 1 },
                              value: newDocName,
                              autoFocus: true,
                              placeholder: T.untitled,
                              onChange: (e) => setNewDocName(e.target.value),
                              onKeyDown: (e) => {
                                if (e.key === 'Enter') commitNewDoc()
                                if (e.key === 'Escape') setNewDocMode(false)
                              },
                            }),
                            jsx.jsx('button', {
                              type: 'button',
                              className: 'dshWmBtn is-primary',
                              onClick: commitNewDoc,
                              children: 'OK',
                            }),
                          ],
                        },
                        'new-doc'
                      )
                    : null,
                  roots.length > 0
                    ? jsx.jsx(
                        'div',
                        {
                          style: { padding: '8px 8px 0' },
                          children: jsx.jsx('input', {
                            className: 'dshWmSearch',
                            value: libQuery,
                            placeholder: T.search,
                            onChange: (e) => setLibQuery(e.target.value),
                          }),
                        },
                        'sq'
                      )
                    : null,
                  jsx.jsx(
                    'div',
                    {
                      className: 'dshWmList',
                      children:
                        roots.length === 0
                          ? jsx.jsx(
                              'div',
                              {
                                className: 'dshWmWelcome',
                                children: [
                                  jsx.jsx(
                                    'div',
                                    { className: 'dshWmWelcomeTitle', children: T.toggle },
                                    'wt'
                                  ),
                                  jsx.jsx(
                                    'div',
                                    { className: 'dshWmWelcomeBody', children: T.empty },
                                    'wb'
                                  ),
                                  jsx.jsx(
                                    'button',
                                    {
                                      type: 'button',
                                      className: 'dshWmBtn is-primary',
                                      onClick: () => {
                                        setAddRootMode(true)
                                        setAddRootPath('E:\\剧本')
                                      },
                                      children: T.emptyCta,
                                    },
                                    'wc'
                                  ),
                                  jsx.jsx(
                                    'div',
                                    {
                                      className: 'dshWmAiHint',
                                      children: 'Esc · Ctrl+S · Ctrl+Shift+S',
                                    },
                                    'wk'
                                  ),
                                ],
                              },
                              'wel'
                            )
                          : projects.length === 0
                            ? jsx.jsx('div', {
                                className: 'dshWmEmpty',
                                children: (activeTree && activeTree.missing ? T.missing + '\n' : '') + T.noProjects,
                              })
                            : projects.map((proj) => {
                                const groups = groupFiles(proj.files, libQuery)
                                const openP = !collapsed.has(proj.path)
                                const maxDraft = maxVersionInGroup(
                                  (proj.files || []).filter((f) => String(f.rel).startsWith('draft/'))
                                )
                                if (libQuery && groups.length === 0) return null
                                return jsx.jsx(
                                  'div',
                                  {
                                    className: 'dshWmProj',
                                    children: [
                                      jsx.jsx(
                                        'button',
                                        {
                                          type: 'button',
                                          className: 'dshWmProjToggle',
                                          onClick: () => toggleProj(proj.path),
                                          children: [
                                            jsx.jsx(
                                              'span',
                                              {
                                                className:
                                                  'dshWmProjChev' + (openP ? ' is-open' : ''),
                                                children: '▸',
                                              },
                                              'c'
                                            ),
                                            jsx.jsx('span', { children: proj.name }, 'n'),
                                          ],
                                        },
                                        'pt'
                                      ),
                                      openP
                                        ? groups.map((g) =>
                                            jsx.jsx(
                                              react.Fragment,
                                              {
                                                children: [
                                                  jsx.jsx(
                                                    'div',
                                                    {
                                                      className: 'dshWmFolder',
                                                      children: g.key === '·' ? 'ROOT' : g.key,
                                                    },
                                                    'fh'
                                                  ),
                                                  ...g.files.map((f) =>
                                                    fileButton(
                                                      f,
                                                      g.key === 'draft' || String(f.rel).includes('/draft/')
                                                        ? maxDraft
                                                        : 0
                                                    )
                                                  ),
                                                ],
                                              },
                                              'g-' + g.key
                                            )
                                          )
                                        : null,
                                    ],
                                  },
                                  proj.path
                                )
                              }),
                    },
                    'dl'
                  ),
                ],
              },
              'docs'
            ),
            jsx.jsx(
              'main',
              {
                className: 'dshWmMain',
                children: [
                  jsx.jsx(
                    'div',
                    {
                      className: 'dshWmDocChrome',
                      children: [
                        jsx.jsx(
                          'div',
                          {
                            className: 'dshWmPathRow',
                            children: [
                              jsx.jsx('span', {
                                className: 'dshWmPathText',
                                children: filePath ? (docFolder ? docFolder + ' / ' : '') + docBasename : '—',
                              }),
                              filePath
                                ? jsx.jsx('button', {
                                    type: 'button',
                                    className: 'dshWmBtn is-ghost',
                                    onClick: () => void copyPath(),
                                    children: copied ? T.copied : T.copyPath,
                                  })
                                : null,
                              isReviewFile
                                ? jsx.jsx('button', {
                                    type: 'button',
                                    className: 'dshWmBtn',
                                    onClick: sendReviewToChat,
                                    children: T.reviewFix,
                                  })
                                : null,
                            ],
                          },
                          'pr'
                        ),
                        jsx.jsx(
                          'div',
                          {
                            className: 'dshWmDocName',
                            children:
                              (docBasename || T.untitled).replace(/-v\d+(\.[^.]+)?$/i, '$1') +
                              (curVerNum != null ? '  v' + curVerNum : ''),
                          },
                          'dn'
                        ),
                        isHistoryDoc && latestVer
                          ? jsx.jsx(
                              'div',
                              {
                                className: 'dshWmHistBanner',
                                children: [
                                  jsx.jsx('span', {
                                    children: T.isHistory + ' · ' + T.isLatest + ' v' + latestVer.v,
                                  }, 'h'),
                                  jsx.jsx('span', { style: { flex: 1 } }),
                                  jsx.jsx('button', {
                                    type: 'button',
                                    className: 'dshWmBtn',
                                    onClick: () => setFilePath(latestVer.abs),
                                    children: T.openLatest,
                                  }),
                                ],
                              },
                              'hb'
                            )
                          : null,
                        versionSeries.length > 1
                          ? jsx.jsx(
                              'div',
                              {
                                className: 'dshWmVerBar',
                                children: [
                                  jsx.jsx(
                                    'span',
                                    { className: 'dshWmVerBarLabel', children: T.versions },
                                    'vl'
                                  ),
                                  ...versionSeries.map((s) =>
                                    jsx.jsx(
                                      'button',
                                      {
                                        type: 'button',
                                        className:
                                          'dshWmVerChip' +
                                          (s.abs === filePath ? ' is-on' : ''),
                                        onClick: () => setFilePath(s.abs),
                                        children: 'v' + s.v,
                                      },
                                      'v' + s.v
                                    )
                                  ),
                                  jsx.jsx(
                                    'button',
                                    {
                                      type: 'button',
                                      className: 'dshWmBtn is-ghost',
                                      disabled: curVerNum == null || versionSeries.length < 2,
                                      onClick: () => void comparePrev(),
                                      children: T.comparePrev,
                                    },
                                    'cmp'
                                  ),
                                ],
                              },
                              'vb'
                            )
                          : null,
                        jsx.jsx('div', { className: 'dshWmDocRule' }, 'dr'),
                      ],
                    },
                    'chrome'
                  ),
                  jsx.jsx(
                    'div',
                    {
                      className: 'dshWmEditorWrap',
                      children: jsx.jsx('textarea', {
                        ref: taRef,
                        className: 'dshWmEditor',
                        value: content,
                        spellCheck: false,
                        readOnly: documentState.loading || isHistoryDoc,
                        placeholder: filePath ? '开始写…' : '# …',
                        onChange: (e) => {
                          setContent(e.target.value)
                        },
                      }),
                    },
                    'ew'
                  ),
                  diffLines
                    ? jsx.jsx(
                        'div',
                        {
                          className: 'dshWmDiff',
                          children: [
                            jsx.jsx(
                              'div',
                              {
                                className: 'dshWmDiffHead',
                                children: [
                                  jsx.jsx('span', {
                                    children: T.diffTitle + ' ' + diffLabel,
                                  }),
                                  jsx.jsx('span', { style: { flex: 1 } }),
                                  jsx.jsx('button', {
                                    type: 'button',
                                    className: 'dshWmBtn is-ghost',
                                    onClick: () => setDiffLines(null),
                                    children: T.closeDiff,
                                  }),
                                ],
                              },
                              'dh'
                            ),
                            ...diffLines.map((d, i) =>
                              jsx.jsx(
                                'div',
                                {
                                  className: 'dshWmDiffLine ' + d.t,
                                  children: (d.t === 'add' ? '+ ' : d.t === 'del' ? '- ' : '  ') + d.line,
                                },
                                'L' + i
                              )
                            ),
                          ],
                        },
                        'diff'
                      )
                    : null,
                  jsx.jsx(
                    'div',
                    {
                      className: 'dshWmStatus',
                      children: [
                        jsx.jsx('span', {
                          className:
                            'dot ' + (dirty ? 'is-dirty' : saveState === 'saved' ? 'is-saved' : ''),
                        }),
                        jsx.jsx('span', {
                          children: dirty ? T.unsaved : saveState === 'saved' ? T.saved : '—',
                        }),
                        jsx.jsx('span', { className: 'dshWmStatusSep', children: '·' }),
                        jsx.jsx('span', {
                          children: `${content.replace(/\s+/g, '').length} ${T.chars}`,
                        }),
                        jsx.jsx('span', {
                          className: 'dshWmStatusSep',
                          children: '·',
                        }),
                        jsx.jsx('span', {
                          children: (filePath || '').toLowerCase().endsWith('.fountain')
                            ? 'Fountain'
                            : 'Markdown',
                        }),
                        gate
                          ? jsx.jsx('span', {
                              className: 'dshWmStatusSep',
                              children: '·',
                            })
                          : null,
                        gate
                          ? jsx.jsx('span', {
                              style: {
                                color: gate.pass
                                  ? 'var(--dsw-alias-state-success-primary)'
                                  : 'var(--dsw-alias-state-error-primary)',
                                fontWeight: 600,
                              },
                              children: gate.pass
                                ? T.gateShort + ' ✓'
                                : T.gateShort + ' ' + gate.fail,
                            })
                          : null,
                      ],
                    },
                    'st'
                  ),
                ],
              },
              'main'
            ),
            aiOpen
              ? jsx.jsx(
                  'aside',
                  {
                    className: 'dshWmSide is-ai',
                    children: [
                      jsx.jsxs('div', { className: 'dshWmSideHead', children: [
                        jsx.jsx('button', { className: 'dshWmTab' + (aiTab === 'companion' ? ' is-on' : ''), onClick: () => setAiTab('companion'), children: T.ai }),
                        jsx.jsx('button', { className: 'dshWmTab' + (aiTab === 'tools' ? ' is-on' : ''), onClick: () => setAiTab('tools'), children: '文字工具' }),
                      ] }, 'ah'),
                      aiTab === 'companion' && !focus ? jsx.jsx(WritingCompanion, {
                        path: filePath || activeRoot,
                        contextText: () => {
                          const selected = taRef.current && taRef.current.selectionEnd > taRef.current.selectionStart
                          const text = selected ? content.slice(taRef.current.selectionStart, taRef.current.selectionEnd) : content
                          return { label: (selected ? '选区 · ' : '稿件 · ') + (filePath || '未命名').split(/[\\/]/).pop() + ' · ' + text.length + ' 字', text: '当前文件：' + (filePath || '未命名') + '\n以下是' + (selected ? '选中的片段' : '编辑器中的稿件快照') + '（可能尚未保存），请以我随后补充的想法为准：\n\n' + text }
                        },
                        onExit: close,
                      }, 'companion') : null,
                      aiTab === 'tools' ? jsx.jsx(
                        'div',
                        {
                          className: 'dshWmAiBody',
                          children: [
                            jsx.jsx(
                              'div',
                              { className: 'dshWmAiSection', children: [
                                jsx.jsx('div', { className: 'dshWmAiSectionTitle', children: 'AI' }, 'at'),
                                jsx.jsx(
                                  'div',
                                  {
                                    className: 'dshWmAiActions',
                                    children: ['polish', 'continue', 'outline', 'compress', 'expand', 'research', 'spark'].map((a) =>
                                      jsx.jsx(
                                        'button',
                                        {
                                          type: 'button',
                                          className:
                                            'dshWmBtn' +
                                            (a === 'research' || a === 'spark' ? ' is-on' : ''),
                                          disabled: aiBusy,
                                          onClick: () => void runAssist(a),
                                          children: T[a] || a,
                                        },
                                        a
                                      )
                                    ),
                                  },
                                  'acts'
                                ),
                              ]},
                              'sec-ai'
                            ),
                            aiBusy
                              ? jsx.jsx('div', { className: 'dshWmAiHint', children: T.applying })
                              : null,
                            aiErr
                              ? jsx.jsx('div', { className: 'dshWmAiHint', children: aiErr })
                              : null,
                            jsx.jsx(
                              'div',
                              { className: 'dshWmAiMain', children: [
                                jsx.jsx('div', { className: 'dshWmAiOut', children: aiOut || ' ' }, 'out'),
                              ]},
                              'aim'
                            ),
                            jsx.jsx(
                              'div',
                              {
                                className: 'dshWmAiActions',
                                children: [
                                  jsx.jsx('button', {
                                    type: 'button',
                                    className: 'dshWmBtn',
                                    disabled: !aiOut,
                                    onClick: applyInsert,
                                    children: T.insert,
                                  }),
                                  jsx.jsx('button', {
                                    type: 'button',
                                    className: 'dshWmBtn',
                                    disabled: !aiOut,
                                    onClick: applyReplace,
                                    children: T.replaceSel,
                                  }),
                                  jsx.jsx('button', {
                                    type: 'button',
                                    className: 'dshWmBtn is-primary',
                                    onClick: sendToChat,
                                    children: T.sendChat,
                                  }),
                                ],
                              },
                              'apply'
                            ),
                            /* ── 门禁：默认收起，只露一行摘要 ── */
                            jsx.jsx(
                              'div',
                              {
                                className: 'dshWmSec',
                                children: [
                                  jsx.jsx(
                                    'button',
                                    {
                                      type: 'button',
                                      className: 'dshWmSecToggle',
                                      onClick: () => setGateOpen((v) => !v),
                                      children: [
                                        jsx.jsx('span', {
                                          children: (gateOpen ? '▾ ' : '▸ ') + T.gates,
                                        }, 't'),
                                        jsx.jsx('span', {
                                          className:
                                            'dshWmSecBadge' +
                                            (gate
                                              ? gate.pass
                                                ? ' is-pass'
                                                : ' is-fail'
                                              : ''),
                                          children: gateBusy
                                            ? T.applying
                                            : gate
                                              ? gate.pass
                                                ? T.gatesPass
                                                : T.gatesFail.replace('{n}', String(gate.fail))
                                              : '—',
                                        }, 'b'),
                                      ],
                                    },
                                    'gt'
                                  ),
                                  gateOpen
                                    ? jsx.jsx(
                                        'div',
                                        {
                                          className: 'dshWmSec',
                                          children: [
                                            jsx.jsx(
                                              'div',
                                              {
                                                className: 'dshWmAiActions',
                                                children: [
                                                  jsx.jsx('button', {
                                                    type: 'button',
                                                    className: 'dshWmBtn',
                                                    disabled: gateBusy || !filePath,
                                                    onClick: () => void runGate(),
                                                    children: gateBusy ? T.applying : T.runGates,
                                                  }),
                                                ],
                                              },
                                              'gb'
                                            ),
                                            gateErr
                                              ? jsx.jsx('div', {
                                                  className: 'dshWmAiHint',
                                                  children: gateErr,
                                                }, 'ge')
                                              : null,
                                            !gate && !gateErr
                                              ? jsx.jsx('div', {
                                                  className: 'dshWmAiHint',
                                                  children: T.gatesIdle,
                                                }, 'gi')
                                              : null,
                                            gate && gate.rows
                                              ? jsx.jsx(
                                                  'div',
                                                  {
                                                    className: 'dshWmGateList',
                                                    children: gate.rows.map((r, i) =>
                                                      jsx.jsx(
                                                        'div',
                                                        {
                                                          className: 'dshWmGateRow',
                                                          children: [
                                                            jsx.jsx('span', {
                                                              className: r.ok ? 'ok' : 'bad',
                                                              children: r.ok ? 'PASS' : 'FAIL',
                                                            }),
                                                            jsx.jsx('span', {
                                                              className: 'dshWmGateLabel',
                                                              children: r.label,
                                                            }),
                                                            jsx.jsx('span', {
                                                              className: 'dshWmGateDetail',
                                                              children: r.detail,
                                                            }),
                                                          ],
                                                        },
                                                        'r' + i
                                                      )
                                                    ),
                                                  },
                                                  'gl'
                                                )
                                              : null,
                                          ],
                                        },
                                        'gb2'
                                      )
                                    : null,
                                ],
                              },
                              'gh'
                            ),
                            /* ── 台账：默认收起 ── */
                            jsx.jsx(
                              'div',
                              {
                                className: 'dshWmSec',
                                children: [
                                  jsx.jsx(
                                    'button',
                                    {
                                      type: 'button',
                                      className: 'dshWmSecToggle',
                                      onClick: () => setLedgerOpen((v) => !v),
                                      children: [
                                        jsx.jsx('span', {
                                          children: (ledgerOpen ? '▾ ' : '▸ ') + T.ledger,
                                        }, 't'),
                                        jsx.jsx('span', {
                                          className: 'dshWmSecBadge',
                                          children: ledger
                                            ? (ledger.foreshadowOpen != null
                                                ? ledger.foreshadowOpen + ' · '
                                                : '') + (ledger.latestReview || '—').slice(0, 18)
                                            : '—',
                                        }, 'b'),
                                      ],
                                    },
                                    'lt'
                                  ),
                                  ledgerOpen
                                    ? ledger
                                      ? jsx.jsx(
                                          'div',
                                          {
                                            className: 'dshWmLedger',
                                            children: [
                                              jsx.jsx(
                                                'div',
                                                {
                                                  className: 'dshWmLedgerRow',
                                                  children: [
                                                    jsx.jsx('span', {
                                                      className: 'dshWmLedgerK',
                                                      children: T.ledgerHook,
                                                    }),
                                                    jsx.jsx('span', {
                                                      className: 'dshWmLedgerV',
                                                      children: ledger.hook || '—',
                                                    }),
                                                  ],
                                                },
                                                'lh'
                                              ),
                                              jsx.jsx(
                                                'div',
                                                {
                                                  className: 'dshWmLedgerRow',
                                                  children: [
                                                    jsx.jsx('span', {
                                                      className: 'dshWmLedgerK',
                                                      children: T.ledgerFores,
                                                    }),
                                                    jsx.jsx('span', {
                                                      className: 'dshWmLedgerV',
                                                      children:
                                                        ledger.foreshadowOpen == null
                                                          ? '—'
                                                          : String(ledger.foreshadowOpen),
                                                    }),
                                                  ],
                                                },
                                                'lf'
                                              ),
                                              jsx.jsx(
                                                'div',
                                                {
                                                  className: 'dshWmLedgerRow',
                                                  children: [
                                                    jsx.jsx('span', {
                                                      className: 'dshWmLedgerK',
                                                      children: T.ledgerReview,
                                                    }),
                                                    jsx.jsx('span', {
                                                      className: 'dshWmLedgerV',
                                                      children: ledger.latestReview || '—',
                                                    }),
                                                  ],
                                                },
                                                'lr'
                                              ),
                                              ledger.timeline && ledger.timeline.length
                                                ? jsx.jsx(
                                                    'div',
                                                    {
                                                      className: 'dshWmLedgerRow',
                                                      children: [
                                                        jsx.jsx('span', {
                                                          className: 'dshWmLedgerK',
                                                          children: T.ledgerTimeline,
                                                        }),
                                                        jsx.jsx('span', {
                                                          className: 'dshWmLedgerV',
                                                          children:
                                                            ledger.timeline[
                                                              ledger.timeline.length - 1
                                                            ],
                                                        }),
                                                      ],
                                                    },
                                                    'lts'
                                                  )
                                                : null,
                                            ],
                                          },
                                          'lb'
                                        )
                                      : jsx.jsx(
                                          'div',
                                          {
                                            className: 'dshWmAiHint',
                                            children: T.ledgerNone,
                                          },
                                          'ln'
                                        )
                                    : null,
                                ],
                              },
                              'lsec'
                            ),
                            jsx.jsx(
                              'div',
                              { className: 'dshWmAiHint', children: 'Esc · Ctrl+S · Ctrl+Shift+W' },
                              'kbd'
                            ),
                          ],
                        },
                        'ab'
                      ) : null,
                    ],
                  },
                  'ai'
                )
              : null,
          ],
        },
        'body'
      ),
    ],
  })
}

/** DOM 常驻浮动入口：不依赖 shell.overlay 是否在当前页挂载。 */
let domFloatEl = null
function ensureDomFloat() {
  if (typeof document === 'undefined') return
  if (domFloatEl && document.body.contains(domFloatEl)) return
  const existing = document.getElementById('dsh-writing-mode-float')
  if (existing) {
    domFloatEl = existing
    return
  }
  const btn = document.createElement('button')
  btn.id = 'dsh-writing-mode-float'
  btn.type = 'button'
  btn.className = 'dshWmFloat'
  btn.textContent = T.toggle
  btn.addEventListener('click', () => setModeActive(!getModeActive()))
  const sync = () => {
    const on = getModeActive()
    btn.classList.toggle('is-on', on)
    btn.textContent = on ? T.exit : T.toggle
    btn.title = on ? T.exit : T.toggle
    // 打开工作台时由 CSS 隐藏（html[data-writing-mode]），避免与顶栏退出钮叠在一起
    btn.style.display = ''
    btn.style.zIndex = '95'
  }
  modeListeners.add(sync)
  sync()
  document.body.appendChild(btn)
  domFloatEl = btn

  // 全局 Ctrl+Shift+W 切换写作模式（与编辑器内快捷键互不冲突时）
  if (!window.__dshWritingModeHotkey) {
    window.__dshWritingModeHotkey = true
    window.addEventListener(
      'keydown',
      (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'w') {
          e.preventDefault()
          setModeActive(!getModeActive())
        }
      },
      true
    )
  }
}

/** 内核设置 → 写作模式 */
function WritingModeSettings() {
  const [prefs, setPrefsLocal] = react.useState(getPrefs)
  const [roots, setRoots] = react.useState([])
  const [pathDraft, setPathDraft] = react.useState('')
  react.useEffect(() => subscribePrefs(() => setPrefsLocal({ ...getPrefs() })), [])
  react.useEffect(() => {
    void loadPrefs()
    void api('config')
      .then((d) => {
        if (d.ok) setRoots(d.roots || [])
      })
      .catch(() => {})
  }, [])

  const row = { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }
  const label = { width: 120, flex: 'none', color: 'var(--dsw-alias-label-secondary)', fontSize: 13 }
  const hint = { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', lineHeight: 1.5 }

  function numInput(key, min, max, step) {
    return jsx.jsx('input', {
      type: 'number',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(prefs[key]),
      style: {
        width: 90,
        padding: '6px 8px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: 13,
      },
      onChange: (e) => void savePrefs({ [key]: Number(e.target.value) }),
    })
  }

  async function addRoot() {
    const p = String(pathDraft || '').trim()
    if (!p) return
    await api('roots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'add', path: p, active: true }),
    })
    setPathDraft('')
    const d = await api('config')
    if (d.ok) setRoots(d.roots || [])
    void loadPrefs()
  }

  async function removeRoot(p) {
    await api('roots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'remove', path: p }),
    })
    const d = await api('config')
    if (d.ok) setRoots(d.roots || [])
  }

  return jsx.jsx(
    'div',
    {
      style: {
        width: '100%',
        maxWidth: 640,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        color: 'var(--dsw-alias-label-primary)',
      },
      children: [
        jsx.jsx(
          'div',
          {
            style: { fontSize: 13, color: 'var(--dsw-alias-label-tertiary)', marginBottom: 8 },
            children: '写作工作台（Ctrl+Shift+W 或右下角进入）。设置即时生效并写入 ~/.dsh/writing-mode.json。',
          },
          'intro'
        ),
        jsx.jsx(
          'div',
          {
            style: row,
            children: [
              jsx.jsx('span', { style: label, children: '库根目录' }),
              jsx.jsx(
                'div',
                {
                  style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 6 },
                  children: [
                    ...(roots || []).map((r) =>
                      jsx.jsx(
                        'div',
                        {
                          style: {
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 13,
                          },
                          children: [
                            jsx.jsx('span', {
                              style: {
                                flex: 1,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              },
                              children: (r.missing ? '⚠ ' : '') + r.path,
                            }),
                            jsx.jsx('button', {
                              type: 'button',
                              className: 'dshWmBtn',
                              onClick: () => void removeRoot(r.path),
                              children: '移除',
                            }),
                          ],
                        },
                        r.path
                      )
                    ),
                    jsx.jsx(
                      'div',
                      {
                        style: { display: 'flex', gap: 8 },
                        children: [
                          jsx.jsx('input', {
                            style: {
                              flex: 1,
                              padding: '6px 10px',
                              borderRadius: 8,
                              border: '1px solid var(--dsw-alias-border-l2)',
                              background: 'var(--dsw-alias-bg-layer-2)',
                              color: 'var(--dsw-alias-label-primary)',
                              font: 'inherit',
                              fontSize: 13,
                            },
                            placeholder: '例如 E:\\剧本',
                            value: pathDraft,
                            onChange: (e) => setPathDraft(e.target.value),
                            onKeyDown: (e) => {
                              if (e.key === 'Enter') void addRoot()
                            },
                          }),
                          jsx.jsx('button', {
                            type: 'button',
                            className: 'dshWmBtn is-primary',
                            onClick: () => void addRoot(),
                            children: '添加',
                          }),
                        ],
                      },
                      'add'
                    ),
                  ],
                }
              ),
            ],
          },
          'roots'
        ),
        jsx.jsx(
          'div',
          {
            style: row,
            children: [
              jsx.jsx('span', { style: label, children: '正文字号' }),
              numInput('fontSize', 12, 28, 1),
              jsx.jsx('span', { style: hint, children: 'px' }),
            ],
          },
          'fs'
        ),
        jsx.jsx(
          'div',
          {
            style: row,
            children: [
              jsx.jsx('span', { style: label, children: '行距' }),
              numInput('lineHeight', 1.4, 2.6, 0.05),
            ],
          },
          'lh'
        ),
        jsx.jsx(
          'div',
          {
            style: row,
            children: [
              jsx.jsx('span', { style: label, children: '自动保存' }),
              numInput('autoSaveMs', 200, 5000, 100),
              jsx.jsx('span', { style: hint, children: 'ms（防抖）' }),
            ],
          },
          'as'
        ),
        jsx.jsx(
          'div',
          {
            style: row,
            children: [
              jsx.jsx('span', { style: label, children: '保存后门禁' }),
              jsx.jsx('input', {
                type: 'checkbox',
                checked: Boolean(prefs.autoGate),
                onChange: (e) => void savePrefs({ autoGate: e.target.checked }),
              }),
              jsx.jsx('span', { style: hint, children: 'md / fountain 存盘后自动跑一次' }),
            ],
          },
          'ag'
        ),
        jsx.jsx(
          'div',
          {
            style: {
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid var(--dsw-alias-border-l2)',
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--dsw-alias-label-tertiary)',
              letterSpacing: '0.06em',
            },
            children: 'AI 模型',
          },
          'ai-head'
        ),
        jsx.jsx(
          'div',
          {
            style: row,
            children: [
              jsx.jsx('span', { style: label, children: '来源' }),
              jsx.jsx(
                'select',
                {
                  value: prefs.aiMode === 'custom' ? 'custom' : 'harness',
                  style: {
                    padding: '6px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--dsw-alias-border-l2)',
                    background: 'var(--dsw-alias-bg-layer-2)',
                    color: 'var(--dsw-alias-label-primary)',
                    font: 'inherit',
                    fontSize: 13,
                  },
                  onChange: (e) =>
                    void savePrefs({ aiMode: e.target.value === 'custom' ? 'custom' : 'harness' }),
                  children: [
                    jsx.jsx('option', { value: 'harness', children: 'Harness 全局默认（文字工具）' }, 'h'),
                    jsx.jsx('option', { value: 'custom', children: '自定义 Provider / Model' }, 'c'),
                  ],
                }
              ),
              jsx.jsx('span', {
                style: hint,
                children:
                  prefs.aiMode === 'custom'
                    ? '润色/续写/找资料走下面配置的模型'
                    : '文字工具使用 Harness 全局默认模型；写作伙伴使用其原生会话模型',
              }),
            ],
          },
          'ai-mode'
        ),
        prefs.aiMode === 'custom'
          ? jsx.jsx(
              'div',
              {
                style: { ...row, alignItems: 'flex-start' },
                children: [
                  jsx.jsx('span', { style: label, children: 'Provider' }),
                  jsx.jsx('input', {
                    style: {
                      flex: 1,
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--dsw-alias-border-l2)',
                      background: 'var(--dsw-alias-bg-layer-2)',
                      color: 'var(--dsw-alias-label-primary)',
                      font: 'inherit',
                      fontSize: 13,
                    },
                    value: prefs.aiProvider,
                    placeholder: 'deepseek-official',
                    onChange: (e) => void savePrefs({ aiProvider: e.target.value }),
                  }),
                ],
              },
              'ai-prov'
            )
          : null,
        prefs.aiMode === 'custom'
          ? jsx.jsx(
              'div',
              {
                style: { ...row, alignItems: 'flex-start' },
                children: [
                  jsx.jsx('span', { style: label, children: 'Model' }),
                  jsx.jsx('input', {
                    style: {
                      flex: 1,
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--dsw-alias-border-l2)',
                      background: 'var(--dsw-alias-bg-layer-2)',
                      color: 'var(--dsw-alias-label-primary)',
                      font: 'inherit',
                      fontSize: 13,
                    },
                    value: prefs.aiModel,
                    placeholder: 'deepseek-v4-flash',
                    onChange: (e) => void savePrefs({ aiModel: e.target.value }),
                  }),
                ],
              },
              'ai-model'
            )
          : null,
        prefs.aiMode === 'custom'
          ? jsx.jsx(
              'div',
              {
                style: { ...row, alignItems: 'flex-start' },
                children: [
                  jsx.jsx('span', { style: label, children: 'API Key' }),
                  jsx.jsx('input', {
                    type: 'password',
                    style: {
                      flex: 1,
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--dsw-alias-border-l2)',
                      background: 'var(--dsw-alias-bg-layer-2)',
                      color: 'var(--dsw-alias-label-primary)',
                      font: 'inherit',
                      fontSize: 13,
                    },
                    value: prefs.aiApiKey,
                    placeholder: '可选；仅本机配置文件',
                    onChange: (e) => void savePrefs({ aiApiKey: e.target.value }),
                  }),
                ],
              },
              'ai-key'
            )
          : null,
        jsx.jsx(
          'div',
          {
            style: row,
            children: [
              jsx.jsx('span', { style: label, children: '进入工作台' }),
              jsx.jsx('button', {
                type: 'button',
                className: 'dshWmBtn is-primary',
                onClick: () => setModeActive(true),
                children: '打开写作模式',
              }),
              jsx.jsx('span', { style: hint, children: '快捷键 Ctrl+Shift+W' }),
            ],
          },
          'open'
        ),
      ],
    }
  )
}

export const inject = __wmAlreadyLoaded ? [] : ['slots', 'sessions', 'connection', 'workspaces']
export function apply(ctx) {
  if (__wmAlreadyLoaded) return
  sessionRuntime = ctx.sessions || null
  nativeApi = ctx.connection?.api || null
  workspaceRuntime = ctx.workspaces || null
  try {
    ensureDomFloat()
  } catch (err) {
    console.warn('[writing-mode] float inject failed:', err)
  }
  // 1) 全屏工作台
  try {
    ctx.effect(
      () =>
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'writing-mode',
              order: 20,
              label: () => T.toggle,
            },
            WritingModeApp
          )
        ),
      'writing-mode: overlay'
    )
  } catch (err) {
    console.warn('[writing-mode] shell.overlay register failed:', err)
  }
  // 2) 主界面侧栏底部入口（官方槽位，比浮动钮好找）
  try {
    ctx.effect(
      () =>
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            {
              name: 'sidebar.footer.action',
              id: 'writing-mode',
              order: 30,
              label: () => T.toggle,
            },
            WritingModeFooterEntry
          )
        ),
      'writing-mode: sidebar-footer'
    )
  } catch (err) {
    console.warn('[writing-mode] sidebar.footer.action register failed:', err)
  }
  // 3) 会话顶栏工具区入口（可选；内核无此槽则静默）
  try {
    ctx.effect(
      () =>
        ctx.slots.inject('conversation.session.header.utilities', () =>
          ctx.slots.register(
            {
              name: 'conversation.session.header.utilities',
              id: 'writing-mode',
              order: 40,
              label: () => T.toggle,
            },
            WritingModeHeaderEntry
          )
        ),
      'writing-mode: header-util'
    )
  } catch (err) {
    console.warn('[writing-mode] header.utilities register failed:', err)
  }
  // 4) 内核设置 → 写作模式
  try {
    ctx.effect(
      () =>
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'writing-mode',
              order: 46,
              label: () => '写作模式',
            },
            WritingModeSettings
          )
        ),
      'writing-mode: settings'
    )
  } catch (err) {
    console.warn('[writing-mode] settings.section register failed:', err)
  }
  console.info('[writing-mode] client ready · float=DOM · overlay+sidebar+settings')
}

export { companionDraftConflict as __draftConflict }
export { appendCompanionDraft, ensureCompanionSession, loadCompanionDraft, resolveDraftConflict, retryDraftConflictRemote, subscribeDraftStatus, getDraftStatus, persistCompanionDraft, companionDraftDirty as __draftDirty, companionDraftStatus as __draftStatus, companionRows, createEditorSession, api }
