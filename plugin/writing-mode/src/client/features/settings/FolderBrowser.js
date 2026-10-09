/**
 * 内置文件夹浏览器（2026-10-09）。
 *
 * 设置面板「工作区（库根）」的「浏览…」在没有原生桥时打开它：只用 host 的只读
 * `route=dirs` 列举子目录，点着进入、一路向上，选中后由调用方写进库根。
 * 只读——不创建、不删除、不改名任何东西。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { listDirs } from '../../services/folder-picker.js'

const ERROR_TEXT = {
  'not-found': '路径不存在',
  'not-a-directory': '这不是一个文件夹',
  'permission-denied': '没有访问权限（可以退到上一级换一个）',
  'invalid-response': '后端没有返回可用的目录列表',
}

function describeError(code, requested) {
  const known = ERROR_TEXT[code]
  if (known) return requested ? `${known}：${requested}` : known
  return `读取失败：${code}`
}

export function FolderBrowser({ open, initialPath, onCancel, onPick }) {
  const [dir, setDir] = react.useState('')
  const [data, setData] = react.useState(null)
  const [loading, setLoading] = react.useState(false)
  const [busy, setBusy] = react.useState(false)
  const [error, setError] = react.useState('')
  const [manual, setManual] = react.useState('')

  // 每次打开都从调用方给的起点重来（不保留上次浏览位置，避免"打开在别处"的困惑）
  react.useEffect(() => {
    if (!open) return
    setDir(String(initialPath || ''))
    setData(null)
    setError('')
    setManual('')
  }, [open, initialPath])

  react.useEffect(() => {
    if (!open) return undefined
    let alive = true
    setLoading(true)
    listDirs(dir).then(
      (out) => {
        if (!alive) return
        setLoading(false)
        if (!out.ok) {
          setData(null)
          setError(describeError(out.error, dir))
          return
        }
        setData(out)
        setError(out.error ? describeError(out.error, out.requested || dir) : '')
      },
      (err) => {
        if (!alive) return
        setLoading(false)
        setData(null)
        setError(String((err && err.message) || err || 'unknown'))
      }
    )
    return () => { alive = false }
  }, [open, dir])

  // Esc 关闭（capture 阶段，避免被官方设置弹层的键盘处理吞掉）
  react.useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onCancel])

  if (!open) return null

  const entries = (data && data.entries) || []
  const drives = (data && data.drives) || []
  const places = (data && data.places) || []
  const roots = (data && data.roots) || []
  const current = data && data.path ? String(data.path) : ''
  const parent = data && data.parent ? String(data.parent) : ''
  const rootKeys = new Set(roots.map((r) => String(r.path || '').replace(/\\/g, '/').toLowerCase()))
  const isKnownRoot = (p) => rootKeys.has(String(p || '').replace(/\\/g, '/').toLowerCase())

  async function chooseCurrent() {
    const target = current || String(dir || '').trim()
    if (target === '' || busy) return
    setBusy(true)
    try {
      await onPick(target)
    } finally {
      setBusy(false)
    }
  }

  function goManual() {
    const text = String(manual || '').trim()
    if (text === '') return
    setDir(text)
    setManual('')
  }

  const chip = (key, label, target, extraClass) =>
    jsx.jsx(
      'button',
      {
        type: 'button',
        className: `dshWmPickChip${extraClass ? ` ${extraClass}` : ''}`,
        title: target,
        onClick: () => setDir(target),
        children: label,
      },
      key
    )

  return jsx.jsx('div', {
    className: 'dshWmPickMask',
    onMouseDown: (e) => { if (e.target === e.currentTarget) onCancel() },
    children: jsx.jsxs('div', {
      className: 'dshWmPickBox',
      role: 'dialog',
      'aria-label': '选择工作区文件夹',
      children: [
        jsx.jsxs('div', {
          className: 'dshWmPickHead',
          children: [
            jsx.jsx('span', { className: 'dshWmPickTitle', children: '选择工作区文件夹' }),
            jsx.jsx('span', { className: 'dshWmPickHint', children: '只选文件夹；选好后会成为写作模式的库根' }),
            jsx.jsx('button', {
              type: 'button',
              className: 'dshWmBtn is-ghost dshWmPickClose',
              title: '关闭',
              onClick: onCancel,
              children: '×',
            }),
          ],
        }),
        jsx.jsx('div', {
          className: 'dshWmPickPath',
          title: current || '此电脑',
          children: current || '此电脑（选择一个磁盘开始）',
        }),
        places.length || drives.length
          ? jsx.jsx('div', {
              className: 'dshWmPickQuick',
              children: [
                ...places.map((p) => chip(`p:${p.path}`, p.name, p.path)),
                ...drives.map((d) => chip(`d:${d.path}`, d.name, d.path)),
              ],
            })
          : null,
        error ? jsx.jsx('div', { className: 'dshWmPickError', children: error }) : null,
        jsx.jsxs('div', {
          className: 'dshWmPickList',
          children: [
            parent
              ? jsx.jsx('button', {
                  type: 'button',
                  className: 'dshWmPickRow is-up',
                  title: parent,
                  onClick: () => setDir(parent),
                  children: '.. 上一级',
                })
              : null,
            ...entries.map((entry) =>
              jsx.jsxs(
                'button',
                {
                  type: 'button',
                  className: 'dshWmPickRow',
                  title: entry.path,
                  onClick: () => setDir(entry.path),
                  children: [
                    jsx.jsx('span', { className: 'dshWmPickRowName', children: entry.name }),
                    isKnownRoot(entry.path)
                      ? jsx.jsx('span', { className: 'dshWmTag is-on', children: '已在库中' })
                      : null,
                  ],
                },
                entry.path
              )
            ),
            loading
              ? jsx.jsx('div', { className: 'dshWmPickEmpty', children: '读取中…' })
              : entries.length === 0
                ? jsx.jsx('div', {
                    className: 'dshWmPickEmpty',
                    children: current ? '这里没有子文件夹（可以直接选它）' : '没有可进入的文件夹',
                  })
                : null,
            data && data.truncated
              ? jsx.jsx('div', { className: 'dshWmPickEmpty', children: `子文件夹太多，只显示前 ${entries.length} 个（共 ${data.total}）` })
              : null,
          ],
        }),
        jsx.jsxs('div', {
          className: 'dshWmPickFoot',
          children: [
            jsx.jsx('input', {
              className: 'dshWmField is-grow',
              placeholder: '也可以直接粘贴路径，如 E:\\剧本',
              value: manual,
              onChange: (e) => setManual(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') goManual() },
            }),
            jsx.jsx('button', {
              type: 'button',
              className: 'dshWmBtn',
              disabled: String(manual || '').trim() === '',
              onClick: goManual,
              children: '前往',
            }),
            jsx.jsx('button', {
              type: 'button',
              className: 'dshWmBtn',
              onClick: onCancel,
              children: '取消',
            }),
            jsx.jsx('button', {
              type: 'button',
              className: 'dshWmBtn is-primary',
              disabled: current === '' || busy,
              title: current ? `选择 ${current}` : '先进入一个文件夹',
              onClick: () => void chooseCurrent(),
              children: busy ? '处理中…' : '选择此文件夹',
            }),
          ],
        }),
      ],
    }),
  })
}
