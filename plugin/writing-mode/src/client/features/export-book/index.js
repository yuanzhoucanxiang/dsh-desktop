/**
 * 导出成书面板：把项目各章当前版按文档树顺序拼成一份完整书稿。
 * 覆盖在中央编辑区之上（编辑器保持挂载，关掉面板写作现场原样还在）。
 * 候选口径与 host lib/compile.js 一致：-vN 系列只留最新版；rel 中文+数字自然序。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { api } from '../../services/writing-api.js'
import { versionOf } from '../../state/prefs-store.js'
import { groupKeyOf, maxVersionInGroup } from '../library/grouping.js'

const ERR_TEXT = {
  'no-drafts': '这个项目还没有 draft/ 正文可导出',
  'empty-include': '请先勾选要纳入的文稿',
  'bad-include': '清单里有不安全的路径',
  'unknown-include': '清单里有文稿已不在项目中（可能被移动或删除），请刷新后重试',
  'mixed-formats': '所选文稿格式不一致（.md 与 .fountain 不能混排成一本）',
  'invalid-title': '书名含有非法字符或为空',
  'path-outside-roots': '项目路径不在文库根内',
  'no-project': '没能识别这个项目',
  'source-changed': '导出期间有文稿被改动，已放弃，请重试',
}

/** 与 host lib/compile.js 的 chapterTitle 同口径。 */
function chapterTitle(name) {
  return String(name || '').replace(/\.[^.]+$/, '').replace(/-v\d+$/i, '')
}

export function ExportBookPanel({ proj, onClose, onDone }) {
  const candidates = react.useMemo(() => {
    const files = proj.files || []
    const max = maxVersionInGroup(files)
    return files
      .filter((f) => {
        const v = versionOf(f.name)
        return v === null || v === max.get(groupKeyOf(f.abs))
      })
      .sort((a, b) => String(a.rel).localeCompare(String(b.rel), 'zh', { numeric: true }))
  }, [proj])
  const skippedCount = (proj.files || []).length - candidates.length
  const [checked, setChecked] = react.useState(
    () => new Set(candidates.filter((f) => String(f.rel).startsWith('draft/')).map((f) => f.abs))
  )
  const [title, setTitle] = react.useState(String(proj.name || ''))
  const [withTitles, setWithTitles] = react.useState(true)
  const [busy, setBusy] = react.useState(false)
  const [err, setErr] = react.useState('')
  const selected = candidates.filter((f) => checked.has(f.abs))
  const exts = [...new Set(selected.map((f) => String(f.ext).toLowerCase()))]
  const mixed = exts.length > 1
  const totalChars = selected.reduce((n, f) => n + (f.chars || 0), 0)
  const canExport = !busy && selected.length > 0 && !mixed && title.trim() !== ''

  function toggle(abs) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(abs)) next.delete(abs)
      else next.add(abs)
      return next
    })
  }

  async function doExport() {
    setBusy(true)
    setErr('')
    try {
      const data = await api('compile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: proj.path,
          include: selected.map((f) => f.rel),
          title: title.trim(),
          titles: withTitles,
        }),
      })
      if (!data.ok) {
        setErr(ERR_TEXT[data.error] || `导出失败（${data.error || '未知错误'}）`)
        return
      }
      onDone(data)
    } catch (e) {
      setErr('导出失败：' + (e && e.message ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  return jsx.jsx('div', {
    className: 'dshWmExport',
    role: 'dialog',
    'aria-label': '导出成书',
    children: jsx.jsx('div', {
      className: 'dshWmExportScroll',
      children: jsx.jsxs('div', {
        className: 'dshWmExportInner',
        children: [
          jsx.jsxs(
            'div',
            {
              className: 'dshWmExportHead',
              children: [
                jsx.jsx('span', { className: 'dshWmExportTitle', children: `导出成书 · ${proj.name}` }, 't'),
                jsx.jsx('span', { style: { flex: 1 } }, 'sp'),
                jsx.jsx(
                  'button',
                  { type: 'button', className: 'dshWmBtn is-ghost', onClick: onClose, children: '返回写作（Esc）' },
                  'x'
                ),
              ],
            },
            'head'
          ),
          jsx.jsx(
            'div',
            {
              className: 'dshWmAiHint',
              children: '把勾选的文稿按下面的顺序拼成一份完整书稿，作为新文件写进项目根目录（书名-vN），原稿一个字不动。',
            },
            'hint'
          ),
          jsx.jsxs(
            'div',
            {
              className: 'dshWmExportField',
              children: [
                jsx.jsx('label', { className: 'dshWmExportLabel', htmlFor: 'dshWmExportName', children: '书名' }, 'l'),
                jsx.jsx('input', {
                  id: 'dshWmExportName',
                  className: 'dshWmSearch',
                  style: { margin: 0 },
                  value: title,
                  onChange: (e) => setTitle(e.target.value),
                }, 'i'),
              ],
            },
            'f-title'
          ),
          jsx.jsxs(
            'label',
            {
              className: 'dshWmExportCheck',
              children: [
                jsx.jsx('input', {
                  type: 'checkbox',
                  checked: withTitles,
                  onChange: (e) => setWithTitles(e.target.checked),
                }, 'c'),
                jsx.jsx('span', { children: '每章前补一个标题（正文自带标题的章节不重复加；.fountain 稿用分页符，不加标题）' }, 't'),
              ],
            },
            'f-titles'
          ),
          jsx.jsx(
            'div',
            {
              className: 'dshWmExportLabel',
              children:
                `纳入的文稿（${selected.length}/${candidates.length}）` +
                (skippedCount > 0 ? ` · 已略过 ${skippedCount} 个历史版本，每章只取最新版` : ''),
            },
            'l-list'
          ),
          jsx.jsx('div', {
            className: 'dshWmExportList',
            children: candidates.map((f) =>
              jsx.jsxs(
                'label',
                {
                  className: 'dshWmExportRow' + (checked.has(f.abs) ? '' : ' is-off'),
                  children: [
                    jsx.jsx('input', { type: 'checkbox', checked: checked.has(f.abs), onChange: () => toggle(f.abs) }, 'c'),
                    jsx.jsx('span', { className: 'dshWmExportRowName', title: f.rel, children: chapterTitle(f.name) }, 'n'),
                    jsx.jsx('span', {
                      className: 'dshWmExportRowMeta',
                      children: (versionOf(f.name) != null ? 'v' + versionOf(f.name) + ' · ' : '') + (f.chars || 0) + ' 字',
                    }, 'm'),
                  ],
                },
                f.abs
              )
            ),
          }, 'list'),
          mixed
            ? jsx.jsx('div', {
                className: 'dshWmAiHint',
                role: 'alert',
                children: `勾选的文稿格式不一致（${exts.join(' / ')}），请分开导出。`,
              }, 'mixed')
            : null,
          err ? jsx.jsx('div', { className: 'dshWmAiHint', role: 'alert', children: err }, 'err') : null,
          jsx.jsxs(
            'div',
            {
              className: 'dshWmExportFoot',
              children: [
                jsx.jsx('span', { children: `共 ${totalChars} 字` }, 'n'),
                jsx.jsx('span', { style: { flex: 1 } }, 'sp'),
                jsx.jsx('button', { type: 'button', className: 'dshWmBtn', onClick: onClose, disabled: busy, children: '取消' }, 'cancel'),
                jsx.jsx('button', {
                  type: 'button',
                  className: 'dshWmBtn is-primary',
                  disabled: !canExport,
                  onClick: () => void doExport(),
                  children: busy ? '导出中…' : '导出成书',
                }, 'go'),
              ],
            },
            'foot'
          ),
        ],
      }),
    }, 'scroll'),
  })
}
