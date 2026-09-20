/**
 * 项目备忘 UI（方案 P3 §4.1）：作者可完成的最小完整操作集。
 *
 * 原则（照方案）：
 *   - 作者手工写下的 = 明确作者操作，来源 author，直接 confirmed；
 *   - 从助手消息"记为候选" = proposed，来源 assistant，保留真实 messageId/sessionId（节点键）与文本快照，
 *     **不编造 ID**、也绝不把助手文本自动升级成事实；
 *   - 编辑候选仍为 proposed（改文字不等于确认）；确认候选才是作者操作，审计记 actor=author 并保留原始来源；
 *   - 编辑已确认条目 → 新 revision + before/after（host 侧记录），作者修改轨迹完整保留；
 *   - 撤回/问题已解决 → 保留条目与历史，只是不再自动注入；
 *   - 查看历史并恢复某版 → 产生**新 revision**，版本号不回退。
 *   - 冲突（etag/revision）时保留编辑框内容并给出刷新，绝不把"自动刷新"当保存成功。
 *   - 坏 JSON / 未知 schema：保留原件，只给诊断与安全恢复说明，不覆盖、不"清空重建"。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { api } from '../../services/writing-api.js'

const KIND_LABEL = { fact: '设定', preference: '偏好', 'open-question': '待定' }
const STATUS_LABEL = { proposed: '候选', confirmed: '已确认', retracted: '已撤回', resolved: '已解决' }
const SOURCE_LABEL = { author: '作者', assistant: '助手建议', host: '内核' }

export async function loadProjectMemory(path) {
  try {
    return await api('memory', undefined, { path })
  } catch (err) {
    return { ok: false, error: String(err?.message || 'memory-load-failed'), memory: { items: [] }, injectable: [] }
  }
}

/**
 * 单条条目的历史（从 memory.changes 还原）：
 * 返回按时间正序的 [{ at, actor, op, before, after }]，只含与该 id 相关的变更。
 */
export function memoryHistory(memory, id) {
  const changes = Array.isArray(memory?.changes) ? memory.changes : []
  return changes
    .filter((c) => c && String(c.id) === String(id))
    .map((c) => ({
      at: c.at || null,
      actor: c.actor || 'host',
      op: c.op || 'update',
      before: c.before || null,
      after: c.after || null,
      status: c.status || null,
    }))
}

/** 一条历史可以恢复到哪个文本：优先 after.text（该次变更之后的样子）。 */
export function restorableText(entry) {
  return (entry?.after && entry.after.text) || (entry?.before && entry.before.text) || ''
}

export function CompanionMemoryPanel({ path, candidate, onCandidateConsumed, onChanged }) {
  const [state, setState] = react.useState({ loading: true, items: [], etag: '', revision: 0, error: '', raw: null })
  const [text, setText] = react.useState('')
  const [kind, setKind] = react.useState('fact')
  const [asCandidate, setAsCandidate] = react.useState(false)
  // The parent consumes its one-shot candidate immediately. Keep provenance
  // with the editable text until this compose draft is cleared or replaced.
  const [candidateSource, setCandidateSource] = react.useState(null)
  const [editing, setEditing] = react.useState(null) // { id, text }
  const [history, setHistory] = react.useState(null) // { id, entries }
  const [notice, setNotice] = react.useState('')
  const [busy, setBusy] = react.useState(false)

  const refresh = react.useCallback(async () => {
    if (!path) {
      setState({ loading: false, items: [], etag: '', revision: 0, error: '', raw: null })
      return
    }
    const data = await loadProjectMemory(path)
    if (data.ok) {
      setState({ loading: false, items: data.memory.items || [], etag: data.etag, revision: data.memory.revision, error: '', raw: data.memory })
    } else {
      // 坏 JSON / 未知 schema：不覆盖、不重建，只诊断
      setState({ loading: false, items: [], etag: '', revision: 0, error: String(data.error || 'unavailable'), raw: null })
    }
  }, [path])
  react.useEffect(() => { void refresh() }, [refresh])

  // 助手消息 → "记为候选"：预填编辑框（作者可删掉不要的部分），来源保留真实 messageId/sessionId
  react.useEffect(() => {
    if (!candidate) return
    setText(candidate.text || '')
    setKind(candidate.kind || 'fact')
    setAsCandidate(true)
    setCandidateSource(candidate.source ? { ...candidate.source } : { kind: 'assistant' })
    setNotice('正在从助手消息记为候选：可以删改后保存（保存后仍是候选，不会自动当成事实）')
    onCandidateConsumed?.()
  }, [candidate, onCandidateConsumed])

  async function post(op, body, { keepText = false } = {}) {
    if (busy) return
    setBusy(true)
    try {
      const data = await api('memory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, op, baseEtag: state.etag, baseRevision: state.revision, actor: 'author', ...body }),
      })
      if (data.ok) {
        setState({ loading: false, items: data.memory.items || [], etag: data.etag, revision: data.memory.revision, error: '', raw: data.memory })
        if (!keepText) {
          setText('')
          setAsCandidate(false)
          setCandidateSource(null)
        }
        setNotice(op === 'add' ? (body?.item?.status === 'proposed' ? '已存为候选（未确认前不会自动带入对话）' : '已记下') : '已更新')
        onChanged?.(data)
        return true
      }
      if (data.error === 'etag-conflict' || data.error === 'revision-conflict') {
        // 冲突：保留编辑框内容（keepText=true 的效果），刷新后让作者比较
        await refresh()
        setNotice('备忘已在别处修改，已刷新。你写的内容还在编辑框里，请比对后重试。')
        return false
      }
      setNotice('操作失败：' + String(data.error || 'unknown'))
      return false
    } catch (err) {
      setNotice('操作失败：' + String(err?.message || err))
      return false
    } finally {
      setBusy(false)
    }
  }

  function saveNew() {
    const body = String(text || '').trim()
    if (!body) return
    const source = asCandidate ? (candidateSource || { kind: 'assistant' }) : { kind: 'author' }
    void post('add', { item: { kind, text: body, status: asCandidate ? 'proposed' : 'confirmed', source } }, { keepText: true })
  }

  const items = state.items.slice().reverse()

  return jsx.jsxs('div', { className: 'dshWmMemory', children: [
    jsx.jsx('div', {
      className: 'dshWmCompanionEmpty',
      style: { padding: '8px 10px', textAlign: 'left', lineHeight: 1.5 },
      children: '只有作者确认过的设定/偏好会被自动带入对话。助手建议默认是候选，不会当成事实；待定问题即便确认也仍是问题，不混进默认事实。',
    }),

    // ── 新增 / 候选编辑 ───────────────────────────────────────────
    jsx.jsxs('div', { className: 'dshWmMemoryCompose', children: [
      jsx.jsxs('div', { className: 'dshWmAiActions', style: { padding: '0 10px 6px' }, children: [
        jsx.jsx('select', {
          className: 'dshWmMemoryKind',
          value: kind,
          onChange: (e) => setKind(e.target.value),
          disabled: busy,
          children: ['fact', 'preference', 'open-question'].map((k) =>
            jsx.jsx('option', { value: k, children: KIND_LABEL[k] }, k)
          ),
        }),
        jsx.jsx('textarea', {
          className: 'dshWmSearch',
          rows: 3,
          'aria-label': '项目备忘内容',
          style: { margin: 0, flex: 1, minWidth: 0, resize: 'vertical', maxHeight: 140, font: 'inherit' },
          placeholder: asCandidate ? '候选内容（可删改）…' : '写下一条设定、偏好或待定问题…',
          value: text,
          disabled: busy,
          onChange: (e) => setText(e.target.value),
          onKeyDown: (e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              saveNew()
            }
          },
        }),
        jsx.jsx('button', {
          className: 'dshWmBtn is-primary',
          disabled: !text.trim() || state.loading || busy || !state.etag,
          'data-wm-memory-save': asCandidate ? 'candidate' : 'author',
          onClick: saveNew,
          children: asCandidate ? '存为候选' : '保存为项目备忘',
        }),
      ] }),
      asCandidate ? jsx.jsx('div', { className: 'dshWmMemoryNote', children: '来源：助手消息（保存后仍是候选，需你确认才生效）' }) : null,
    ] }),

    notice ? jsx.jsx('div', { className: 'dshWmMemoryNote', role: 'status', children: notice }) : null,
    state.error
      ? jsx.jsxs('div', { className: 'dshWmCompanionError', role: 'alert', children: [
          state.error === 'corrupt-memory' || state.error === 'unknown-schema'
            ? `备忘文件格式异常（${state.error}）。原件已原样保留、没有被覆盖：可以让我在完整会话里先诊断再安全恢复。`
            : `备忘暂不可用：${state.error}`,
          jsx.jsx('button', { className: 'dshWmQuiet', onClick: () => void refresh(), children: '重试' }),
        ] })
      : null,

    // ── 条目列表 ─────────────────────────────────────────────────
    jsx.jsx('div', { className: 'dshWmMemoryList', children: items.map((it) => jsx.jsxs('div', {
      className: 'dshWmMemoryItem is-' + it.status,
      'data-wm-memory-id': it.id,
      children: [
        jsx.jsxs('div', { className: 'dshWmMemoryMeta', children: [
          jsx.jsx('span', { className: 'dshWmMemoryKind', children: KIND_LABEL[it.kind] || it.kind }),
          jsx.jsx('span', { className: 'dshWmMemoryStatus', 'data-status': it.status, children: STATUS_LABEL[it.status] || it.status }),
          jsx.jsx('span', { className: 'dshWmMemorySource', children: SOURCE_LABEL[it.source?.kind] || it.source?.kind || '作者' }),
        ] }),
        editing && editing.id === it.id
          ? jsx.jsxs('div', { className: 'dshWmMemoryEdit', children: [
              jsx.jsx('textarea', {
                className: 'dshWmSearch',
                rows: 3,
                'aria-label': '编辑项目备忘',
                value: editing.text,
                autoFocus: true,
                onChange: (e) => setEditing({ id: it.id, text: e.target.value }),
              }),
              jsx.jsx('button', {
                className: 'dshWmQuiet',
                disabled: busy,
                onClick: async () => {
                  const ok = await post('update', { id: it.id, item: { text: editing.text } })
                  if (ok) setEditing(null)
                },
                children: '保存',
              }),
              jsx.jsx('button', { className: 'dshWmQuiet', onClick: () => setEditing(null), children: '取消' }),
              it.status === 'proposed'
                ? jsx.jsx('span', { className: 'dshWmMemoryNote', children: '改动后仍是候选' })
                : jsx.jsx('span', { className: 'dshWmMemoryNote', children: '保存会记入历史（前后可对照）' }),
            ] })
          : jsx.jsx('div', { className: 'dshWmMemoryText', children: it.text }),
        jsx.jsxs('div', { className: 'dshWmMemoryActions', children: [
          it.status === 'proposed'
            ? jsx.jsx('button', {
                className: 'dshWmQuiet',
                disabled: busy,
                onClick: () => void post('update', { id: it.id, item: { status: 'confirmed', text: it.text } }),
                children: '确认',
              })
            : null,
          it.status !== 'retracted' && it.status !== 'resolved'
            ? jsx.jsx('button', { className: 'dshWmQuiet', onClick: () => setEditing({ id: it.id, text: it.text }), children: '编辑' })
            : null,
          it.kind === 'open-question' && it.status === 'confirmed'
            ? jsx.jsx('button', { className: 'dshWmQuiet', disabled: busy, onClick: () => void post('resolve', { id: it.id }), children: '已解决' })
            : null,
          it.status === 'confirmed' || it.status === 'proposed'
            ? jsx.jsx('button', { className: 'dshWmQuiet', disabled: busy, onClick: () => void post('retract', { id: it.id }), children: '撤回' })
            : null,
          jsx.jsx('button', {
            className: 'dshWmQuiet',
            onClick: () => setHistory(history && history.id === it.id ? null : { id: it.id, entries: memoryHistory(state.raw, it.id) }),
            children: '历史',
          }),
        ] }),
        history && history.id === it.id
          ? jsx.jsxs('div', { className: 'dshWmMemoryHistory', children: [
              history.entries.length
                ? history.entries.slice().reverse().map((entry, i) => jsx.jsxs('div', { className: 'dshWmMemoryHistoryRow', children: [
                    jsx.jsxs('div', { className: 'dshWmMemoryMeta', children: [
                      jsx.jsx('span', { children: (entry.at || '').replace('T', ' ').slice(0, 16) }),
                      jsx.jsx('span', { children: entry.actor === 'author' ? '作者操作' : '内核操作' }),
                      jsx.jsx('span', { children: entry.op }),
                    ] }),
                    entry.before && entry.after && entry.before.text !== entry.after.text
                      ? jsx.jsxs('div', { className: 'dshWmMemoryDiff', children: [
                          jsx.jsx('div', { className: 'is-del', children: '− ' + entry.before.text }),
                          jsx.jsx('div', { className: 'is-add', children: '+ ' + entry.after.text }),
                        ] })
                      : jsx.jsx('div', { className: 'dshWmMemoryText', children: entry.after?.text || entry.before?.text || '' }),
                    entry.op !== 'add'
                      ? jsx.jsx('button', {
                          className: 'dshWmQuiet',
                          disabled: busy,
                          onClick: async () => {
                            const ok = await post('restore', {
                              id: it.id,
                              item: { text: restorableText(entry) || it.text, status: entry.status || entry.after?.status || it.status },
                            })
                            if (ok) setHistory(null)
                          },
                          children: '恢复这一版',
                        })
                      : null,
                  ] }, String(i)))
                : jsx.jsx('div', { className: 'dshWmMemoryNote', children: '还没有历史记录' }),
              jsx.jsx('div', { className: 'dshWmMemoryNote', children: '恢复会生成新的 revision，版本号不会回退。' }),
            ] })
          : null,
      ],
    }, it.id)) }),
  ] })
}
