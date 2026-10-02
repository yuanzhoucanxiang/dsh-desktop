/**
 * 大纲视图（只读投影，对照 docs/plans/writing-outline-card-view-research.md §2.1）：
 * 每章当前版一行 = 文件名 + 字数 + 门禁摘要 + 章末钩子；外加 outline/structure.md 的标题行。
 * 数据走 GET outline（host 批量口径），纯展示——不新增存储、不改版本协议。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { api } from '../../services/writing-api.js'

export function OutlineSection({ proj, onOpen }) {
  const [state, setState] = react.useState({ loading: true, error: '', outline: null })
  react.useEffect(() => {
    let alive = true
    setState({ loading: true, error: '', outline: null })
    api('outline', undefined, { project: proj.path })
      .then((d) => {
        if (!alive) return
        if (d.ok) setState({ loading: false, error: '', outline: d.outline })
        else setState({ loading: false, error: d.error || 'outline-failed', outline: null })
      })
      .catch((err) => { if (alive) setState({ loading: false, error: String(err?.message || err), outline: null }) })
    return () => { alive = false }
  }, [proj.path])

  const outline = state.outline
  return jsx.jsxs('div', { className: 'dshWmOutlineProj', children: [
    jsx.jsx('div', { className: 'dshWmOutlineTitle', children: proj.name }, 't'),
    state.loading
      ? jsx.jsx('div', { className: 'dshWmAiHint', children: '读取大纲…' }, 'l')
      : null,
    state.error
      ? jsx.jsxs('div', { className: 'dshWmAiHint', 'data-wm-outline-error': '1', children: [
          '大纲读取失败（' + state.error + '）',
          jsx.jsx('button', { type: 'button', className: 'dshWmQuiet', onClick: () => setState(s => ({ ...s, loading: true, error: '' })), children: '重试' }),
        ] }, 'e')
      : null,
    outline && outline.structure && outline.structure.length
      ? jsx.jsxs('details', { className: 'dshWmOutlineStructure', children: [
          jsx.jsx('summary', { children: '结构（outline/structure.md）' }),
          ...outline.structure.map((l, i) => jsx.jsx('div', { className: 'dshWmOutlineStructLine', children: l.replace(/^#+\s*/, '') }, 's' + i)),
        ] }, 'struct')
      : null,
    outline && outline.rows.length
      ? outline.rows.map((row) => jsx.jsxs('div', { className: 'dshWmOutlineRow', 'data-wm-outline-row': row.name, children: [
          jsx.jsx('button', {
            type: 'button',
            className: 'dshWmOutlineName',
            title: '打开当前版（' + row.name + '）',
            onClick: () => onOpen(row.abs),
            children: row.name,
          }, 'n'),
          jsx.jsx('span', { className: 'dshWmOutlineChars', children: row.chars + ' 字' }, 'c'),
          row.gate
            ? jsx.jsx('span', {
                className: 'dshWmOutlineGate' + (row.gate.pass ? ' is-pass' : ' is-fail'),
                'data-wm-outline-gate': row.name,
                title: row.gate.pass ? '门禁全部通过' : row.gate.fail + ' 项未达标（在「检查」页看明细）',
                children: row.gate.pass ? '门禁 ✓' : '门禁 ' + row.gate.fail,
              }, 'g')
            : null,
          row.hook
            ? jsx.jsx('div', { className: 'dshWmOutlineHook', children: row.hook }, 'h')
            : null,
        ] }, row.abs))
      : outline
        ? jsx.jsx('div', { className: 'dshWmAiHint', children: 'draft/ 下还没有文稿。' }, 'nr')
        : null,
  ] }, proj.path)
}

export function OutlineView({ projects, onOpen }) {
  return jsx.jsx('div', {
    className: 'dshWmOutline',
    'data-wm-outline': '1',
    children: projects.length
      ? projects.map((p) => jsx.jsx(OutlineSection, { proj: p, onOpen }, p.path))
      : jsx.jsx('div', { className: 'dshWmAiHint', children: '该库下没有项目。' }, 'none'),
  })
}
