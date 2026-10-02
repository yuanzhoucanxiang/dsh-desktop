/**
 * 大纲视图（只读投影 + 卡片拖拽重排，见 docs/plans/writing-outline-card-view-research.md）：
 * - 列表态：每章当前版一行 = 文件名 + 字数 + 门禁摘要 + 章末钩子。
 * - 卡片态：同数据的网格卡片；拖拽卡片 = 重排序，host 以 **重命名事务** 落实
 *   （POST reorder → lib/reorder.js：项目锁 + 两阶段改名 + 回滚 + 绝不覆盖）。
 * 数据走 GET outline；纯展示层，重排语义全部在 host。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { api } from '../../services/writing-api.js'

async function loadOutline(proj) {
  const d = await api('outline', undefined, { project: proj.path })
  if (d && d.ok) return { loading: false, error: '', outline: d.outline }
  return { loading: false, error: (d && d.error) || 'outline-failed', outline: null }
}

export function OutlineSection({ proj, onOpen, onReorderDone, onFlash }) {
  const [state, setState] = react.useState({ loading: true, error: '', outline: null })
  const [busy, setBusy] = react.useState(false)
  const dragFrom = react.useRef(-1)

  const refresh = react.useCallback(() => {
    setState({ loading: true, error: '', outline: null })
    loadOutline(proj).then((s) => { if (s) setState(s) }).catch((err) => setState({ loading: false, error: String(err?.message || err), outline: null }))
  }, [proj.path])

  react.useEffect(() => { refresh() }, [refresh])

  const doReorder = async (rowsInOrder) => {
    if (busy) return
    setBusy(true)
    try {
      const d = await api('reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project: proj.path, order: rowsInOrder.map((r) => r.abs) }),
      })
      if (d && d.ok) {
        if (onReorderDone) onReorderDone(d.renames || [])
        if (onFlash) onFlash('章节顺序已更新')
      } else {
        if (onFlash) onFlash('重排失败：' + ((d && d.error) || 'unknown'))
      }
    } catch (err) {
      if (onFlash) onFlash('重排失败：' + String(err?.message || err))
    } finally {
      setBusy(false)
      // 无论成败都回到权威状态（成功=拿到改名后的新 abs；失败=回到原顺序）
      refresh()
    }
  }

  const outline = state.outline
  const rows = (outline && outline.rows) || []

  const cardProps = (idx) => ({
    draggable: true,
    onDragStart: (e) => {
      dragFrom.current = idx
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)) } catch {}
    },
    onDragOver: (e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move' } catch {} },
    onDrop: (e) => {
      e.preventDefault()
      let from = dragFrom.current
      if (from === -1) { try { from = Number(e.dataTransfer.getData('text/plain')) } catch {} }
      dragFrom.current = -1
      if (!Number.isInteger(from) || from < 0 || from >= rows.length || from === idx) return
      const next = [...rows]
      const moved = next.splice(from, 1)[0]
      next.splice(idx, 0, moved)
      void doReorder(next)
    },
    onDragEnd: () => { dragFrom.current = -1 },
  })

  const gateBadge = (row) => row.gate
    ? jsx.jsx('span', {
        className: 'dshWmOutlineGate' + (row.gate.pass ? ' is-pass' : ' is-fail'),
        'data-wm-outline-gate': row.name,
        title: row.gate.pass ? '门禁全部通过' : row.gate.fail + ' 项未达标（在「检查」页看明细）',
        children: row.gate.pass ? '门禁 ✓' : '门禁 ' + row.gate.fail,
      })
    : null

  return jsx.jsxs('div', { className: 'dshWmOutlineProj', children: [
    jsx.jsx('div', { className: 'dshWmOutlineTitle', children: proj.name }, 't'),
    state.loading
      ? jsx.jsx('div', { className: 'dshWmAiHint', children: '读取大纲…' }, 'l')
      : null,
    state.error
      ? jsx.jsxs('div', { className: 'dshWmAiHint', 'data-wm-outline-error': '1', children: [
          '大纲读取失败（' + state.error + '）',
          jsx.jsx('button', { type: 'button', className: 'dshWmQuiet', onClick: refresh, children: '重试' }),
        ] }, 'e')
      : null,
    outline && outline.structure && outline.structure.length
      ? jsx.jsxs('details', { className: 'dshWmOutlineStructure', children: [
          jsx.jsx('summary', { children: '结构（outline/structure.md）' }),
          ...outline.structure.map((l, i) => jsx.jsx('div', { className: 'dshWmOutlineStructLine', children: l.replace(/^#+\s*/, '') }, 's' + i)),
        ] }, 'struct')
      : null,
    outline && rows.length
      ? jsx.jsxs(jsx.Fragment, { children: [
          jsx.jsxs('div', { className: 'dshWmOutlineHint', children: [
            busy ? '正在按新顺序改名（原稿内容不动）…' : '拖拽卡片可调整章节顺序（重命名文件实现，历史版本一起跟着走）',
          ] }, 'hint'),
          jsx.jsx('div', {
            className: 'dshWmCards',
            'data-wm-cards': '1',
            children: rows.map((row, idx) => jsx.jsxs('div', {
              className: 'dshWmCard',
              'data-wm-outline-row': row.name,
              ...cardProps(idx),
              children: [
                jsx.jsx('button', {
                  type: 'button',
                  className: 'dshWmCardName dshWmOutlineName',
                  title: '打开当前版（' + row.name + '）',
                  onClick: () => onOpen(row.abs),
                  children: row.name,
                }, 'n'),
                jsx.jsx('span', { className: 'dshWmCardDrag', title: '拖拽调整顺序', children: '⋮⋮' }, 'd'),
                jsx.jsx('span', { className: 'dshWmOutlineChars', children: row.chars + ' 字' }, 'c'),
                gateBadge(row),
                row.hook
                  ? jsx.jsx('div', { className: 'dshWmOutlineHook', children: row.hook }, 'h')
                  : null,
              ],
            }, row.abs)),
          }, 'cards'),
        ] }, 'cards-wrap')
      : outline
        ? jsx.jsx('div', { className: 'dshWmAiHint', children: 'draft/ 下还没有文稿。' }, 'nr')
        : null,
  ] }, proj.path)
}

export function OutlineView({ projects, onOpen, onReorderDone, onFlash }) {
  return jsx.jsx('div', {
    className: 'dshWmOutline',
    'data-wm-outline': '1',
    children: projects.length
      ? projects.map((p) => jsx.jsx(OutlineSection, { proj: p, onOpen, onReorderDone, onFlash }, p.path))
      : jsx.jsx('div', { className: 'dshWmAiHint', children: '该库下没有项目。' }, 'none'),
  })
}
