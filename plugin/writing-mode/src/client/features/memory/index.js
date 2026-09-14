/**
 * 写作模式客户端模块（P1 从 entry.js 搬迁；行为不变）。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { api } from '../../services/writing-api.js'

export async function loadProjectMemory(path) {
  try {
    const data = await api('memory', undefined, { path })
    return data
  } catch (err) {
    return { ok: false, error: String(err?.message || 'memory-load-failed'), memory: { items: [] }, injectable: [] }
  }
}

export function CompanionMemoryPanel({ path }) {
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
