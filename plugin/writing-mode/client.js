/**
 * GENERATED FILE — do not hand-edit.
 * Source: plugin/writing-mode/src/client/entry.js + src/shared/editor-session.js
 * Build:  node scripts/build-writing-client.mjs   (or npm run build:writing)
 * Bundle: window.__ModuleLoader__.load factory body
 */
window.__ModuleLoader__.load({
  id: "@dsh-local/writing-mode",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
/**
 * Source: ModuleLoader factory body (extracted).
 * Build wraps this in window.__ModuleLoader__.load({ factory }).
 * react / react/jsx-runtime come from factory require — not bundled.
 */
/* eslint-disable */

    if (window.__dshWritingModeLoaded === true) {
      exports.name = 'writing-mode'
      exports.apply = function () {}
      exports.inject = []
      return module.exports
    }
    window.__dshWritingModeLoaded = true

    const react = require('react')
    const jsx = require('react/jsx-runtime')
    const API = '/api/writing-mode'
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
    exports.appendCompanionDraft = appendCompanionDraft

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
    exports.ensureCompanionSession = ensureCompanionSession

    // Conversation history stays in Harness. Unsent text lives in host checkpoints.
    const companionDrafts = new Map() // in-memory cache of last known checkpoint
    let companionWindowId = null
    try {
      let id = sessionStorage.getItem('dsh-writing-window')
      if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('dsh-writing-window', id) }
      companionWindowId = id
    } catch { companionWindowId = 'default' }

    async function loadCompanionDraft(project) {
      // Do NOT mutate shared cache here — adopt only after generation check (T02).
      try {
        const data = await api('draft', undefined, { project, window: companionWindowId })
        if (data.ok && data.checkpoint) {
          return {
            text: data.checkpoint.text || '',
            reference: data.checkpoint.reference || null,
            rev: data.checkpoint.rev ?? 0,
          }
        }
        return { text: '', reference: null, rev: 0 }
      } catch {
        return { text: '', reference: null, rev: 0 }
      }
    }
    exports.loadCompanionDraft = loadCompanionDraft

    const draftSaveQueue = new Map() // project -> Promise chain

    function persistCompanionDraft(project, onStatus, baseRev) {
      const cached = companionDrafts.get(project) || { text: '', reference: null, rev: 0 }
      const payload = {
        project,
        windowId: companionWindowId,
        text: cached.text,
        reference: cached.reference,
        // T03: send the revision we believe we are editing
        baseRev: baseRev !== undefined ? baseRev : cached.rev ?? 0,
      }
      const prev = draftSaveQueue.get(project) || Promise.resolve()
      const next = prev.then(async () => {
        const data = await api('draft', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (data?.ok && data.checkpoint) {
          // Only accept if this is still the latest local content
          const now = companionDrafts.get(project)
          if (now && now.text === payload.text && (now.reference || null) === (payload.reference || null)) {
            now.rev = data.checkpoint.rev ?? now.rev ?? 0
          }
        }
        if (onStatus) onStatus(data?.ok ? 'saved' : `error:${data?.error || 'save-failed'}`)
        return data
      })
      draftSaveQueue.set(
        project,
        next.catch(() => {})
      )
      return next
    }

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
    exports.companionRows = companionRows

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
      react.useEffect(() => {
        let cancelled = false
        const started = recoveryGen.current
        void loadCompanionDraft(project).then((c) => {
          if (cancelled) return
          // T02: adopt atomically only if no user edit / project switch happened
          if (recoveryGen.current !== started) return
          const adopt = { text: c.text, reference: c.reference, rev: c.rev || 0 }
          companionDrafts.set(project, { ...(companionDrafts.get(project) || {}), ...adopt })
          if (c.reference) setReference((prev) => prev || c.reference)
          const nativeDraft = info?.hooks?.input?.getSnapshot?.().draft || ''
          if (!nativeDraft && c.text) {
            setLocalDraft(c.text)
            try {
              if (info?.props?.inputActions?.setDraft) info.props.inputActions.setDraft(c.text)
            } catch {}
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
        persistCompanionDraft(project, (st) => {
          if (st && String(st).startsWith('error:') && alive.current) {
            setError('草稿未能保存：' + String(st).slice(6) + '（刷新后可能丢失未发送内容）')
          }
        })
      }
      function updateReference(value) {
        recoveryGen.current++
        setReference(value)
        const prev = companionDrafts.get(project) || { text: '', reference: null, rev: 0 }
        companionDrafts.set(project, { ...prev, reference: value })
        persistCompanionDraft(project, (st) => {
          if (st && String(st).startsWith('error:') && alive.current) {
            setError('引用未能保存：' + String(st).slice(6))
          }
        })
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
          // Clear only the exact draft/reference that was submitted (T03).
          const nowDraft = targetInfo.hooks.input.getSnapshot().draft
          if (nowDraft === sentDraft || nowDraft === '' || nowDraft == null) {
            targetInfo.props.inputActions.setDraft('')
            const prev = companionDrafts.get(project) || { text: '', reference: null, rev: 0 }
            companionDrafts.set(project, { text: '', reference: prev.reference || null, rev: prev.rev ?? 0 })
            persistCompanionDraft(project, () => {}, prev.rev ?? 0)
            if (alive.current) setLocalDraft('')
          }
          const nowRef = companionDrafts.get(project)?.reference || null
          if (!nowRef || (nowRef.text === sentReference?.text && nowRef.label === sentReference?.label)) {
            const prev = companionDrafts.get(project) || { text: '', reference: null, rev: 0 }
            companionDrafts.set(project, {
              text: prev.text || '',
              reference: null,
              rev: prev.rev ?? 0,
            })
            persistCompanionDraft(project, () => {}, prev.rev ?? 0)
            if (alive.current) setReference(null)
          }
        } catch (err) { if (alive.current) setError(err.message || String(err)) }
        finally { sending.current = false; if (alive.current) setBusy(false) }
      }
      const failure = error || snapshot.openError?.message || snapshot.promptError?.error?.message
      return jsx.jsxs('div', { className: 'dshWmCompanion', children: [
        jsx.jsxs('div', { className: 'dshWmConversationHead', children: [
          jsx.jsx('span', { title: project, children: project.split(/[\\/]/).filter(Boolean).pop() }),
          jsx.jsx('button', { className: 'dshWmQuiet', onClick: () => setMemOpen(v => !v), children: memOpen ? '收起备忘' : '项目备忘' }),
          jsx.jsx('button', { className: 'dshWmQuiet', onClick: () => void fullConversation(), disabled: busy || !sessions, title: '打开完整会话，调整模型、工具或处理请求', children: '会话设置 ↗' }),
        ] }),
        memOpen ? jsx.jsx(CompanionMemoryPanel, { path: project }) : null,
        jsx.jsx(CompanionTranscript, { snapshot, onFull: () => void fullConversation() }),
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

    const zh = {
      toggle: '写作模式',
      exit: '退出写作',
      docs: '文档库',
      newDoc: '新建',
      newProject: '新建项目',
      projTitle: '项目名',
      projPremise: '一句话前提',
      projTemplate: '模板',
      create: '创建',
      cancel: '取消',
      created: '已创建项目',
      untitled: '未命名',
      save: '保存',
      saved: '已保存',
      saving: '保存中…',
      delete: '删除',
      confirmDelete: '删除这篇文档？',
      ai: '写作伙伴',
      polish: '润色',
      continue: '续写',
      outline: '大纲',
      compress: '压缩',
      expand: '扩写',
      research: '找资料',
      spark: '灵感',
      insert: '插入文末',
      replaceSel: '替换选区',
      sendChat: '发送到会话',
      applying: '处理中…',
      noText: '先选中或写点内容',
      aiUnavailable: '内核未提供 LLM 服务，可「发送到会话」由主对话完成。',
      empty: '还没有库根。点 + 选择写作文件夹（例如 E:\\剧本）。',
      emptyCta: '一键加入 E:\\剧本',
      noProjects: '该库下没有含 project.md 的项目。可打开任意 .md / .fountain。',
      focus: '专注',
      chars: '字',
      words: '字数',
      openAi: 'AI',
      closeAi: '收 AI',
      gates: '门禁',
      gateShort: '门禁',
      runGates: '跑门禁',
      gatesPass: '全部通过',
      gatesFail: '{n} 项未达标',
      gatesNone: '不支持该类型',
      gatesIdle: '打开 .md / .fountain 后可跑门禁',
      saveAsNew: '另存为新版',
      bumpHint: '按文件名生成 v(N+1)，保留旧稿',
      hideLib: '收起库',
      showLib: '展开库',
      search: '搜索文件…',
      openLatest: '打开最新版',
      isHistory: '历史稿',
      isLatest: '当前版',
      versions: '版本',
      comparePrev: '对比上一版',
      closeDiff: '关闭对比',
      diffTitle: '与上一版对比',
      reviewFix: '按此评审改稿',
      ledger: '台账速览',
      ledgerHook: '当前钩子',
      ledgerFores: '伏笔未兑现',
      ledgerReview: '最新评审',
      ledgerTimeline: '时间线尾条',
      ledgerNone: '打开项目内文件后显示',
      addRoot: '添加库…',
      switchRoot: '切换库',
      removeRoot: '移除',
      missing: '路径失效',
      unsaved: '未保存',
      pathLabel: '路径',
      suggestRoot: '建议加入库：',
      addSuggest: '加入库',
      copyPath: '复制路径',
      copied: '已复制',
    }
    const en = {
      toggle: 'Writing',
      exit: 'Exit writing',
      docs: 'Library',
      newDoc: 'New',
      newProject: 'New project',
      projTitle: 'Title',
      projPremise: 'Premise',
      projTemplate: 'Template',
      create: 'Create',
      cancel: 'Cancel',
      created: 'Project created',
      untitled: 'Untitled',
      save: 'Save',
      saved: 'Saved',
      saving: 'Saving…',
      delete: 'Delete',
      confirmDelete: 'Delete this document?',
      ai: 'Assistant',
      polish: 'Polish',
      continue: 'Continue',
      outline: 'Outline',
      compress: 'Compress',
      expand: 'Expand',
      research: 'Research',
      spark: 'Sparks',
      insert: 'Append',
      replaceSel: 'Replace selection',
      sendChat: 'Send to chat',
      applying: 'Working…',
      noText: 'Select or write something first',
      aiUnavailable: 'No LLM service; use Send to chat instead.',
      empty: 'No library root. Click + to pick a folder (e.g. E:\\剧本).',
      emptyCta: 'Add E:\\剧本',
      noProjects: 'No project.md under this root. You can still open any .md / .fountain.',
      focus: 'Focus',
      chars: 'chars',
      words: 'Words',
      openAi: 'AI',
      closeAi: 'Hide AI',
      gates: 'Gates',
      gateShort: 'Gate',
      runGates: 'Run gates',
      gatesPass: 'All pass',
      gatesFail: '{n} failed',
      gatesNone: 'Unsupported type',
      gatesIdle: 'Open .md / .fountain to run gates',
      saveAsNew: 'Save as v+1',
      bumpHint: 'Create -v(N+1) keeping the old draft',
      hideLib: 'Hide library',
      showLib: 'Show library',
      search: 'Search files…',
      openLatest: 'Open latest',
      isHistory: 'History',
      isLatest: 'Current',
      versions: 'Versions',
      comparePrev: 'Diff vs prev',
      closeDiff: 'Close diff',
      diffTitle: 'Diff vs previous',
      reviewFix: 'Fix from review',
      ledger: 'Ledger',
      ledgerHook: 'Chapter hook',
      ledgerFores: 'Open foreshadows',
      ledgerReview: 'Latest review',
      ledgerTimeline: 'Timeline tail',
      ledgerNone: 'Open a project file',
      addRoot: 'Add library…',
      switchRoot: 'Library',
      removeRoot: 'Remove',
      missing: 'Missing',
      unsaved: 'Unsaved',
      pathLabel: 'Path',
      suggestRoot: 'Suggested library:',
      addSuggest: 'Add',
      copyPath: 'Copy path',
      copied: 'Copied',
    }

    function pickLocale() {
      try {
        const lang = String(navigator.language || '').toLowerCase()
        return lang.startsWith('zh') ? zh : en
      } catch {
        return zh
      }
    }
    const T = pickLocale()

    const CSS = [
      /* 写作台打开：藏自有浮钮 + PALIS 浮钮/状态条，避免叠层 */
      'html[data-writing-mode="on"] #dsh-writing-mode-float{display:none !important;}',
      'html[data-writing-mode="on"] .ptp-float{display:none !important;}',
      'html[data-writing-mode="on"] #palis-theme-float,',
      'html[data-writing-mode="on"] #palis-float,',
      'html[data-writing-mode="on"] .palis-float,',
      'html[data-writing-mode="on"] .ptp-status,',
      'html[data-writing-mode="on"] #palis-status,',
      'html[data-writing-mode="on"] [data-palis-status],',
      'html[data-writing-mode="on"] .palis-statusbar{display:none !important;}',

      '.dshWmFloat{',
      '  position:fixed;right:18px;bottom:18px;z-index:95;',
      '  display:inline-flex;align-items:center;gap:6px;',
      '  height:34px;padding:0 14px;border-radius:999px;cursor:pointer;',
      '  border:1px solid var(--dsw-alias-border-l2);',
      '  background:var(--dsw-alias-bg-layer-3);',
      '  color:var(--dsw-alias-label-secondary);',
      '  font:inherit;font-size:12px;line-height:1;',
      '  box-shadow:0 4px 16px rgba(0,0,0,.16);',
      '}',
      '.dshWmFloat:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);}',

      /* 压住 PALIS 状态条 / 更高层 UI */
      '.dshWmRoot{',
      '  position:fixed;top:0;left:0;right:0;bottom:0;',
      '  z-index:2000 !important;',
      '  display:flex;flex-direction:column;',
      '  background:var(--dsw-alias-bg-base);',
      '  color:var(--dsw-alias-label-primary);',
      '  font-family:var(--dsw-font-sans,var(--ds-font-family-sans,system-ui,sans-serif));',
      '  overflow:hidden;',
      '}',

      /* 顶栏右侧让出系统窗口控件（Win 最小化/最大化/关闭约 120–140px） */
      '.dshWmBar{',
      '  display:flex;align-items:center;gap:8px;',
      '  height:52px;padding:0 148px 0 16px;flex:none;',
      '  border-bottom:1px solid var(--dsw-alias-border-l2);',
      '  background:var(--dsw-alias-bg-layer-1);',
      '  box-sizing:border-box;',
      '}',
      '.dshWmBrand{',
      '  font-size:13px;font-weight:650;color:var(--dsw-alias-label-primary);',
      '  padding-right:10px;margin-right:2px;',
      '  border-right:1px solid var(--dsw-alias-border-l2);',
      '  flex:none;',
      '}',
      '.dshWmBarGroup{display:flex;align-items:center;gap:6px;min-width:0;flex:none;}',
      '.dshWmBarSpacer{flex:1;min-width:16px;}',
      '.dshWmSelect{',
      '  font:inherit;font-size:12px;padding:6px 10px;border-radius:8px;',
      '  border:1px solid var(--dsw-alias-border-l2);',
      '  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);',
      '  max-width:160px;',
      '}',
      '.dshWmBtn{',
      '  font:inherit;font-size:12px;padding:6px 12px;border-radius:8px;cursor:pointer;',
      '  background:transparent;color:var(--dsw-alias-label-secondary);',
      '  border:1px solid var(--dsw-alias-border-l2);',
      '  white-space:nowrap;flex:none;',
      '}',
      '.dshWmBtn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);}',
      '.dshWmBtn:disabled{opacity:.4;cursor:default;}',
      '.dshWmBtn.is-primary{',
      '  background:var(--dsw-alias-button-primary-fill);',
      '  color:var(--dsw-alias-label-primary-foreground);border-color:transparent;',
      '}',
      '.dshWmBtn.is-ghost{border-color:transparent;padding-left:8px;padding-right:8px;}',
      '.dshWmBtn.is-danger{color:var(--dsw-alias-state-error-primary);}',
      '.dshWmBtn.is-on{',
      '  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);',
      '  border-color:var(--dsw-alias-brand-primary);',
      '  color:var(--dsw-alias-label-primary);',
      '}',

      '.dshWmBody{flex:1;display:flex;min-height:0;}',
      '.dshWmSide{',
      '  width:248px;flex:none;display:flex;flex-direction:column;min-height:0;',
      '  border-right:1px solid var(--dsw-alias-border-l2);',
      '  background:var(--dsw-alias-bg-layer-1);',
      '}',
      '.dshWmSide.is-ai{width:clamp(360px,34vw,560px);border-right:none;border-left:1px solid var(--dsw-alias-border-l2);}',
      '.dshWmCompanion{display:flex;flex-direction:column;flex:1;min-height:0;padding:0 16px 16px;gap:12px;}',
      '.dshWmConversationHead{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--dsw-alias-label-tertiary);}.dshWmConversationHead>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dshWmQuiet{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:5px 2px;cursor:pointer;white-space:nowrap;}.dshWmQuiet:hover{color:var(--dsw-alias-label-primary);}.dshWmQuiet:disabled{opacity:.4;cursor:default;}',
      '.dshWmConversation{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px 2px;scrollbar-width:thin;}',
      '.dshWmCompanionEmpty{padding:clamp(30px,12vh,130px) 16px 30px;color:var(--dsw-alias-label-secondary);line-height:1.9;white-space:pre-line;}.dshWmCompanionEmpty h3{font-size:21px;font-weight:500;margin:16px 0 8px;color:var(--dsw-alias-label-primary);}.dshWmCompanionEmpty p{font-size:13px;margin:0;}.dshWmCompanionMark{font-size:24px;opacity:.6;}',
      '.dshWmMessage{margin:0 0 26px;}.dshWmMessageWho{display:block;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-bottom:8px;}.dshWmMessageText{font-size:14px;line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;}.dshWmMessage.is-user{padding:12px 14px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);}.dshWmMessage.is-error{color:var(--dsw-alias-state-error-primary);}',
      '.dshWmActivity{font-size:12px;color:var(--dsw-alias-label-secondary);margin:8px 0;overflow-wrap:anywhere;}.dshWmActivity pre,.dshWmReference pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;font-family:inherit;font-size:12px;line-height:1.6;}.dshWmActivity summary,.dshWmReference summary{cursor:pointer;}',
      '.dshWmRequest{padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font-size:12px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;margin:12px 0;}.dshWmThinking{font-size:12px;color:var(--dsw-alias-label-secondary);padding:10px 0;}',
      '.dshWmCompanionError{padding:10px;font-size:12px;line-height:1.6;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;max-height:120px;overflow:auto;}',
      '.dshWmMemory{border-bottom:1px solid var(--dsw-alias-border-l2);max-height:220px;display:flex;flex-direction:column;}',
      '.dshWmMemoryList{overflow:auto;flex:1;padding:0 10px 8px;}',
      '.dshWmMemoryItem{padding:6px 8px;margin-bottom:6px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);font-size:12px;}',
      '.dshWmMemoryItem.is-retracted{opacity:.55;}',
      '.dshWmMemoryItem.is-resolved{opacity:.75;}',
      '.dshWmMemoryMeta{display:flex;gap:6px;margin-bottom:2px;font-size:10px;color:var(--dsw-alias-label-tertiary);}',
      '.dshWmMemoryKind{font-weight:700;color:var(--dsw-alias-label-secondary);}',
      '.dshWmMemoryText{line-height:1.45;color:var(--dsw-alias-label-primary);}',
      '.dshWmMemoryActions{display:flex;gap:6px;margin-top:4px;}',
      '.dshWmCompose{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:12px;}.dshWmCompose:focus-within{border-color:var(--dsw-alias-label-tertiary);}.dshWmChatInput{display:block;box-sizing:border-box;width:100%;min-height:88px;max-height:200px;resize:vertical;border:0;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:1.7;}.dshWmChatInput::placeholder{color:var(--dsw-alias-label-tertiary);}',
      '.dshWmComposeFoot{display:flex;align-items:center;gap:8px;margin-top:8px;}.dshWmInputHint{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-tertiary);}.dshWmSend{margin-left:auto;flex-shrink:0;width:30px;height:30px;border:0;border-radius:8px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);font-size:21px;cursor:pointer;}.dshWmSend:disabled{opacity:.25;cursor:default;}',
      '.dshWmReference{display:flex;align-items:start;gap:8px;border-bottom:1px solid var(--dsw-alias-border-l2);padding-bottom:10px;margin-bottom:10px;font-size:12px;color:var(--dsw-alias-label-secondary);}.dshWmReference details{flex:1;min-width:0;}',
      '.dshWmSide.is-ai>.dshWmSideHead{gap:22px;padding:14px 18px 10px;}.dshWmTab{font:inherit;font-size:13px;padding:4px 0 8px;background:none;border:0;border-bottom:2px solid transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;}.dshWmTab.is-on{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-label-primary);}',
      '@media(max-width:1250px){.dshWmInputHint{display:none;}}',

      '.dshWmSideHead{',
      '  display:flex;align-items:center;gap:6px;padding:12px 12px 8px;flex:none;',
      '  font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary);',
      '}',
      '.dshWmList{flex:1;overflow:auto;padding:4px 10px 20px;}',
      '.dshWmProj{margin-bottom:12px;}',
      '.dshWmProjToggle{',
      '  display:flex;align-items:center;gap:6px;width:100%;',
      '  padding:8px 8px 4px;border:none;background:transparent;cursor:pointer;',
      '  font:inherit;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);',
      '  text-align:left;',
      '}',
      '.dshWmProjToggle:hover{color:var(--dsw-alias-brand-primary);}',
      '.dshWmProjChev{font-size:10px;color:var(--dsw-alias-label-tertiary);transition:transform .12s;flex:none;}',
      '.dshWmProjChev.is-open{transform:rotate(90deg);}',
      '.dshWmFolder{',
      '  font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;',
      '  color:var(--dsw-alias-label-tertiary);padding:8px 8px 3px;',
      '}',
      '.dshWmSearch{',
      '  width:100%;margin:0 0 8px;padding:7px 10px;border-radius:8px;',
      '  border:1px solid var(--dsw-alias-border-l2);',
      '  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);',
      '  font:inherit;font-size:12px;outline:none;box-sizing:border-box;',
      '}',
      '.dshWmSearch:focus{border-color:var(--dsw-alias-brand-primary);}',
      '.dshWmItem{',
      '  display:block;width:100%;text-align:left;cursor:pointer;',
      '  padding:7px 8px;margin-bottom:2px;border-radius:8px;border:1px solid transparent;',
      '  background:transparent;color:var(--dsw-alias-label-primary);',
      '  font:inherit;font-size:12.5px;line-height:1.35;box-sizing:border-box;',
      '}',
      '.dshWmItem:hover{background:var(--dsw-alias-interactive-bg-hover);}',
      '.dshWmItem.is-on{',
      '  border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 50%,transparent);',
      '  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);',
      '}',
      '.dshWmItemRow{display:flex;align-items:baseline;gap:4px;}',
      '.dshWmItemTitle{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;}',
      '.dshWmItemMeta{display:block;font-size:10px;color:var(--dsw-alias-label-tertiary);margin-top:2px;}',
      '.dshWmVer{',
      '  display:inline-block;margin-left:6px;padding:0 5px;border-radius:4px;flex:none;',
      '  font-size:10px;font-weight:700;line-height:16px;',
      '  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);',
      '  color:var(--dsw-alias-brand-primary);',
      '}',
      '.dshWmVer.is-hist{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);}',

      '.dshWmMain{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;}',
      '.dshWmDocChrome{flex:none;padding:24px 32px 0;max-width:820px;margin:0 auto;width:100%;box-sizing:border-box;}',
      '.dshWmPathRow{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-tertiary);flex-wrap:wrap;}',
      '.dshWmPathText{flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dshWmDocName{margin:10px 0 4px;font-size:22px;font-weight:650;line-height:1.3;}',
      '.dshWmDocRule{height:1px;margin:12px 0 0;background:var(--dsw-alias-border-l2);}',
      '.dshWmHistBanner{',
      '  display:flex;align-items:center;gap:10px;margin-top:10px;padding:8px 12px;',
      '  border-radius:8px;border:1px solid var(--dsw-alias-border-l2);',
      '  background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#c9a227) 12%,transparent);',
      '  font-size:12px;',
      '}',
      '.dshWmVerBar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px;}',
      '.dshWmVerBarLabel{font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--dsw-alias-label-tertiary);}',
      '.dshWmVerChip{',
      '  font:inherit;font-size:11px;padding:3px 8px;border-radius:999px;cursor:pointer;',
      '  border:1px solid var(--dsw-alias-border-l2);background:transparent;',
      '  color:var(--dsw-alias-label-secondary);',
      '}',
      '.dshWmVerChip:hover{border-color:var(--dsw-alias-brand-primary);}',
      '.dshWmVerChip.is-on{',
      '  border-color:var(--dsw-alias-brand-primary);',
      '  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);',
      '  color:var(--dsw-alias-label-primary);font-weight:600;',
      '}',
      '.dshWmEditorWrap{flex:1;min-height:0;display:flex;justify-content:center;}',
      '.dshWmEditor{',
      '  flex:1;min-height:0;max-width:820px;width:100%;',
      '  resize:none;outline:none;border:none;box-sizing:border-box;',
      '  padding:20px 32px 48px;',
      '  font-family:"Source Han Serif SC","Noto Serif SC","Songti SC","SimSun",Georgia,serif;',
      '  font-size:var(--dsh-wm-font-size,17px);',
      '  line-height:var(--dsh-wm-line-height,1.95);letter-spacing:.02em;',
      '  color:var(--dsw-alias-label-primary);background:transparent;',
      '}',
      '.dshWmStatus{',
      '  flex:none;height:32px;display:flex;align-items:center;gap:10px;padding:0 16px;',
      '  border-top:1px solid var(--dsw-alias-border-l2);',
      '  background:var(--dsw-alias-bg-layer-1);',
      '  font-size:11px;color:var(--dsw-alias-label-tertiary);',
      '}',
      '.dshWmStatus .dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary);}',
      '.dshWmStatus .dot.is-dirty{background:var(--dsw-alias-state-warning-primary,#c9a227);}',
      '.dshWmStatus .dot.is-saved{background:var(--dsw-alias-state-success-primary);}',
      '.dshWmStatusSep{opacity:.35;}',

      '.dshWmAiBody{',
      '  flex:1;display:flex;flex-direction:column;min-height:0;',
      '  padding:8px 12px 20px;gap:8px;overflow:auto;',
      '}',
      '.dshWmAiSection{display:flex;flex-direction:column;gap:8px;}',
      '.dshWmAiSectionTitle{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);}',
      '.dshWmAiMain{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;}',
      '.dshWmAiActions{display:flex;flex-wrap:wrap;gap:6px;}',
      '.dshWmAiOut{',
      '  flex:1;min-height:140px;overflow:auto;padding:12px;border-radius:10px;',
      '  border:1px solid var(--dsw-alias-border-l2);',
      '  background:var(--dsw-alias-bg-layer-2);',
      '  font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:break-word;',
      '}',
      '.dshWmAiHint{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.5;}',
      '.dshWmSec{display:flex;flex-direction:column;gap:6px;}',
      '.dshWmSecToggle{',
      '  display:flex;align-items:center;gap:6px;width:100%;',
      '  padding:6px 0;border:none;background:transparent;cursor:pointer;',
      '  font:inherit;font-size:11px;font-weight:700;letter-spacing:.06em;',
      '  text-transform:uppercase;color:var(--dsw-alias-label-tertiary);text-align:left;',
      '}',
      '.dshWmSecToggle:hover{color:var(--dsw-alias-label-primary);}',
      '.dshWmSecBadge{',
      '  margin-left:auto;font-size:10px;font-weight:600;letter-spacing:0;text-transform:none;',
      '  padding:1px 6px;border-radius:999px;',
      '  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);',
      '}',
      '.dshWmSecBadge.is-pass{color:var(--dsw-alias-state-success-primary);}',
      '.dshWmSecBadge.is-fail{color:var(--dsw-alias-state-error-primary);}',
      '.dshWmGateList{display:flex;flex-direction:column;gap:3px;}',
      '.dshWmGateRow{',
      '  display:flex;gap:8px;align-items:baseline;font-size:12px;line-height:1.45;',
      '  padding:5px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);',
      '}',
      '.dshWmGateRow .ok{color:var(--dsw-alias-state-success-primary);font-weight:700;font-size:10px;flex:none;width:34px;}',
      '.dshWmGateRow .bad{color:var(--dsw-alias-state-error-primary);font-weight:700;font-size:10px;flex:none;width:34px;}',
      '.dshWmGateLabel{color:var(--dsw-alias-label-primary);flex:none;min-width:5em;}',
      '.dshWmGateDetail{color:var(--dsw-alias-label-tertiary);flex:1;word-break:break-word;font-size:11px;}',
      '.dshWmLedger{',
      '  display:flex;flex-direction:column;gap:6px;font-size:12px;line-height:1.55;',
      '  padding:8px 10px;border-radius:10px;',
      '  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);',
      '  color:var(--dsw-alias-label-secondary);',
      '}',
      '.dshWmLedgerRow{display:flex;gap:8px;}',
      '.dshWmLedgerK{flex:none;min-width:4.5em;color:var(--dsw-alias-label-tertiary);font-size:11px;}',
      '.dshWmLedgerV{flex:1;word-break:break-word;color:var(--dsw-alias-label-primary);}',
      '.dshWmDiff{',
      '  flex:none;max-height:36%;overflow:auto;',
      '  border-top:1px solid var(--dsw-alias-border-l2);',
      '  background:var(--dsw-alias-bg-layer-1);padding:8px 12px;',
      '}',
      '.dshWmDiffHead{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:11px;color:var(--dsw-alias-label-tertiary);}',
      '.dshWmDiffLine{',
      '  font-family:var(--ds-font-family-code,monospace);font-size:11px;line-height:1.55;',
      '  white-space:pre-wrap;word-break:break-word;padding:1px 6px;border-radius:3px;',
      '}',
      '.dshWmDiffLine.add{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);}',
      '.dshWmDiffLine.del{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);text-decoration:line-through;}',
      '.dshWmDiffLine.ctx{color:var(--dsw-alias-label-tertiary);}',
      '.dshWmWelcome{',
      '  flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;',
      '  gap:14px;padding:40px;text-align:center;color:var(--dsw-alias-label-secondary);',
      '}',
      '.dshWmWelcomeTitle{font-size:22px;font-weight:650;color:var(--dsw-alias-label-primary);}',
      '.dshWmWelcomeBody{font-size:13px;line-height:1.7;max-width:420px;}',
      '.dshWmEmpty{padding:16px;color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:1.6;}',
      '.dshWmFlash{',
      '  position:absolute;left:50%;transform:translateX(-50%);top:60px;z-index:20;',
      '  max-width:70%;padding:8px 14px;border-radius:8px;',
      '  background:color-mix(in srgb,var(--dsw-alias-bg-layer-3) 95%,transparent);',
      '  border:1px solid var(--dsw-alias-border-l2);',
      '  color:var(--dsw-alias-label-primary);font-size:12px;',
      '  box-shadow:0 4px 16px rgba(0,0,0,.2);',
      '}',

      'body[data-writing-focus="1"] .dshWmSide{display:none;}',
      'body[data-writing-focus="1"] .dshWmEditor{',
      '  font-size:calc(var(--dsh-wm-font-size,17px) + 1px);',
      '  line-height:calc(var(--dsh-wm-line-height,1.95) + 0.1);max-width:720px;',
      '}',
      'body[data-writing-focus="1"] .dshWmDocChrome{max-width:720px;}',
      'html[data-writing-mode] body[data-writing-lib="0"] .dshWmSide:not(.is-ai){display:none;}',
    ].join('\n')
    const TAG = 'dsh-writing-mode-css'
    if (typeof document !== 'undefined' && !document.getElementById(TAG)) {
      const tag = document.createElement('style')
      tag.id = TAG
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    async function api(route, opts, query) {
      const params = new URLSearchParams({ route, ...query })
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), route === 'assist' ? 90000 : 15000)
      try {
        const res = await fetch(`${API}?${params}`, { ...opts, signal: controller.signal })
        return await res.json().catch(() => ({ ok: false, error: 'invalid-response' }))
      } finally { clearTimeout(timer) }
    }

    function createEditorSession(io, recovered) {
  let state = { path: null, content: '', revision: null, edit: 0, dirty: false, status: 'idle', error: '', loading: false }
  let generation = 0
  let saving = null
  let creating = false
  const listeners = new Set()
  const notify = (patch) => {
    state = { ...state, ...patch }
    try { io.backup?.(state.dirty ? { path: state.path, content: state.content, revision: state.revision } : recovered || null) }
    catch { state = { ...state, error: '恢复草稿暂存失败，请保存后再退出。' } }
    for (const fn of listeners) fn(state)
  }
  const errorText = (err) => {
    const code = err?.message || String(err)
    return code === 'document-conflict' ? '文件已在别处修改。当前文字已保留，请另存新版后再比较。'
      : code === 'revision-required' ? '读写协议已更新，请刷新页面后重新打开文稿。'
      : code === 'historical-version' ? '这是历史稿，请另存新版。'
      : `操作失败，当前文字已保留：${code}`
  }
  async function result(promise) {
    const data = await promise
    if (!data?.ok || !data.doc) throw new Error(data?.error || 'invalid-response')
    return data.doc
  }
  const adopt = (doc) => notify({ path: doc.path, content: doc.content, revision: doc.revision, edit: state.edit + 1, dirty: false, status: 'idle', loading: false, error: '' })
  const session = {
    get: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    change(value) {
      if (state.loading || !state.path) return
      notify({ content: typeof value === 'function' ? value(state.content) : value, edit: state.edit + 1, dirty: true, status: 'idle', error: '' })
},
    async refresh() {
      if (!state.path || state.loading || saving || creating) return false
      const snapshot = state
      const token = generation
      try {
        const doc = await result(io.read(snapshot.path))
        if (token !== generation || state.revision !== snapshot.revision || state.edit !== snapshot.edit || saving || creating) return false
        if (doc.revision === state.revision) return true
        if (state.dirty) notify({ status: 'error', error: '文件已在别处修改。当前输入已保留，请另存新版后比较。' })
        else adopt(doc)
        return true
      } catch { return false }
    },
    async flush() {
      if (saving) { const ok = await saving; return ok ? session.flush() : false }
      if (!state.dirty || !state.path) return true
      const snapshot = state
      notify({ status: 'saving', error: '' })
      saving = (async () => {
        try {
          const doc = await result(io.save({ path: snapshot.path, content: snapshot.content, revision: snapshot.revision }))
          const dirty = state.edit !== snapshot.edit
          notify({ revision: doc.revision, dirty, status: dirty ? 'idle' : 'saved' })
          io.saved?.(doc)
          return true
        } catch (err) {
          notify({ status: 'error', error: errorText(err) })
          return false
        }
      })()
      const ok = await saving
      saving = null
      return ok && state.dirty ? session.flush() : ok
    },
    async open(target) {
      if (creating) return false
      if (!target || (state.path === target && !state.error)) return true
      const token = ++generation
      notify({ loading: true })
      if (!await session.flush()) { if (token === generation) notify({ loading: false }); return false }
      if (token !== generation) return false
      try {
        const doc = await result(io.read(target))
        if (token !== generation) return false
        adopt(doc)
        if (recovered?.path === doc.path) {
          const draft = recovered
          recovered = null
          if (draft.content !== doc.content) notify({ content: draft.content, revision: draft.revision, dirty: true, edit: state.edit + 1, status: 'error', error: '已恢复未保存文字。请保存；如原文件已变化，请另存新版。' })
        }
        return true
      } catch (err) {
        if (token === generation) {
          // A removed/moved original must not erase its recovered buffer.
          if (!state.path && recovered?.path === target) {
            notify({ path: target, content: recovered.content, revision: recovered.revision, dirty: true })
            recovered = null
          }
          notify({ loading: false, status: 'error', error: errorText(err) })
        }
        return false
      }
    },
    async create(root, title) {
      if (creating) return false
      const token = ++generation
      notify({ loading: true })
      if (!await session.flush()) { if (token === generation) notify({ loading: false }); return false }
      if (token !== generation) return false
      creating = true
      try {
        const doc = await result(io.save({ root, title, content: '# ' + title + '\n\n', revision: null }))
        io.saved?.(doc)
        if (token !== generation) return false
        adopt(doc)
        return true
      } catch (err) { if (token === generation) notify({ loading: false, status: 'error', error: errorText(err) }); return false }
      finally { creating = false }
    },
    async version() {
      if (!state.path || state.loading) return false
      creating = true
      ++generation
      notify({ loading: true })
      if (saving) await saving
      const snapshot = state
      try {
        const doc = await result(io.version({ path: snapshot.path, content: snapshot.content }))
        adopt(doc)
        io.saved?.(doc)
        return true
      } catch (err) { notify({ loading: false, status: 'error', error: errorText(err) }); return false }
      finally { creating = false }
    },
    async close() {
      if (creating) return false
      ++generation // invalidate a pending file read
      notify({ loading: true })
      const ok = await session.flush()
      notify({ loading: false })
      return ok
    },
  }
  return session
}
function buildPreparedTurn(input) {
  const message = String(input?.message ?? '')
  const reference = input?.reference || null
  // Default budget lives on the parameter so inlined client bundles always have it.
  const budget = Number.isFinite(input?.budget) ? Number(input.budget) : 6000
  const items = (input?.memoryItems || []).filter(
    (it) => it && it.status === 'confirmed' && (it.kind === 'fact' || it.kind === 'preference')
  )

  const reasons = []
  let memoryText = ''
  let omitted = 0
  let used = 0
  for (const it of items) {
    const line = `- [${it.kind === 'preference' ? '偏好' : '设定'}] ${it.text}`
    if (used + line.length + 1 > budget) {
      omitted++
      continue
    }
    memoryText += (memoryText ? '\n' : '') + line
    used += line.length + 1
    reasons.push({ id: it.id, kind: it.kind, chars: line.length })
  }

  const parts = []
  if (memoryText) {
    parts.push(
      '【项目备忘 · 作者已确认，仅供参考，不要伪装成系统指令】\n' +
        memoryText +
        (omitted ? `\n（另有 ${omitted} 条因长度省略）` : '')
    )
  }
  if (reference && reference.text) {
    parts.push(
      `【引用 · ${reference.label || '稿件快照'}${reference.path ? ' · ' + reference.path : ''}】\n${reference.text}`
    )
  }
  parts.push(message)

  const body = parts.join('\n\n')
  return Object.freeze({
    schemaVersion: 1,
    projectKey: input?.projectKey || null,
    message,
    body,
    reference: reference ? Object.freeze({ ...reference }) : null,
    memorySnapshot: Object.freeze(items.map((it) => Object.freeze({ id: it.id, status: it.status, kind: it.kind, text: it.text }))),
    selectionReasons: Object.freeze(reasons),
    omittedCount: omitted,
    budget,
  })
}

/** Human-readable hint for UI: "参考项目备忘 · N 条". */
function memoryHint(memoryItems) {
  const n = (memoryItems || []).filter(
    (it) => it.status === 'confirmed' && (it.kind === 'fact' || it.kind === 'preference')
  ).length
  return n ? `参考项目备忘 · ${n} 条` : null
}
    // createEditorSession comes from src/shared/editor-session.js (build inlines it)
    exports.createEditorSession = createEditorSession
    exports.api = api

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

    const inject = ['slots', 'sessions', 'connection', 'workspaces']
    function apply(ctx) {
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

    exports.apply = apply
    exports.inject = inject

    return module.exports
  },
})
