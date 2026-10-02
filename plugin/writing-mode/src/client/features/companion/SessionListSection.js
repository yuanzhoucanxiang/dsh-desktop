/**
 * 写作会话列表（D 决策：伙伴 tab 顶部的折叠区）。
 *
 * 数据：host config.companions（作品 → sessionId 映射，写作会话的标记就在创建时的
 * agentPreset 上）× 内核 sessions 列表快照（活性/标题）。点击行 = 打开该作品的概览
 * 文档（project.md），伙伴会话随 WritingCompanion 的 path 解析自然切换。
 * sessions 未挂载或 companions 读取失败时显示一行原因（可重试），不再整区静默消失。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { api } from '../../services/writing-api.js'
import { harnessSessions } from '../../adapters/harness/runtime.js'

const basename = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || '')
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

export function SessionListSection({ currentPath, onOpenProject }) {
  const sessions = harnessSessions()
  const [companions, setCompanions] = react.useState(null)
  const [loadError, setLoadError] = react.useState('')
  const [retry, setRetry] = react.useState(0)
  const [open, setOpen] = react.useState(false)

  react.useEffect(() => {
    let live = true
    setLoadError('')
    api('config')
      .then((res) => {
        if (!live) return
        if (res?.ok) setCompanions(res.config?.companions || {})
        else setLoadError(String(res?.error || 'unknown'))
      })
      .catch((err) => { if (live) setLoadError(err.message || String(err)) })
    return () => { live = false }
  }, [retry])

  const subscribe = react.useCallback(
    (fn) => (sessions?.list?.subscribe?.(fn) || (() => {})),
    [sessions]
  )
  const getSnap = react.useCallback(() => sessions?.list?.getSnapshot?.() || null, [sessions])
  const listSnap = react.useSyncExternalStore(subscribe, getSnap)

  // 整区静默消失等于「功能不存在」，作者无从区分「这个作品没会话」和「列表挂了」——
  // 所以不可用/读取失败都要留一行字，并且失败时给重试。
  if (!sessions) {
    return jsx.jsx('div', {
      className: 'dshWmAiHint',
      role: 'status',
      'data-wm-session-list': 'unavailable',
      children: '写作会话列表暂不可用：内核会话服务未挂载。作品与稿件不受影响。',
    })
  }
  if (loadError) {
    return jsx.jsxs('div', {
      className: 'dshWmAiHint',
      role: 'status',
      'data-wm-session-list': 'error',
      children: [
        '写作会话列表读取失败：' + loadError,
        jsx.jsx('button', { className: 'dshWmQuiet', onClick: () => setRetry(n => n + 1), children: '重试' }),
      ],
    })
  }
  if (!companions) return null

  const cur = norm(currentPath)
  const rows = Object.entries(companions)
    .map(([project, sessionId]) => {
      const live = listSnap?.byId?.[sessionId] || null
      return {
        project,
        sessionId,
        live: Boolean(live),
        running: Boolean(live?.running),
        title: live?.title || live?.name || basename(project),
        isCurrent: Boolean(cur) && (cur === norm(project) || cur.startsWith(norm(project) + '/')),
      }
    })
    .sort((a, b) => (a.project < b.project ? -1 : 1))

  return jsx.jsxs('div', {
    className: 'dshWmSessList',
    'data-wm-session-list': '1',
    children: [
      jsx.jsxs('button', {
        type: 'button',
        className: 'dshWmSecToggle',
        onClick: () => setOpen((v) => !v),
        children: [
          jsx.jsx('span', { children: (open ? '▾ ' : '▸ ') + '写作会话' }, 't'),
          jsx.jsx('span', { className: 'dshWmSecBadge', children: String(rows.length) }, 'b'),
        ],
      }),
      open
        ? jsx.jsx('div', {
            className: 'dshWmSessRows',
            children: rows.length
              ? rows.map((row) =>
                  jsx.jsxs('button', {
                    type: 'button',
                    className: 'dshWmSessRow' + (row.isCurrent ? ' is-on' : ''),
                    'data-wm-session-row': row.sessionId,
                    title: row.project,
                    onClick: () => onOpenProject?.(row.project),
                    children: [
                      jsx.jsx('span', {
                        className: 'dshWmSessDot' + (row.live ? ' is-live' : ''),
                        children: row.running ? '●' : row.live ? '•' : '○',
                      }),
                      jsx.jsx('span', { className: 'dshWmSessName', children: row.title }),
                      jsx.jsx('span', {
                        className: 'dshWmSessMeta',
                        children: row.live ? (row.running ? '进行中' : '在线') : '已关闭',
                      }),
                    ],
                  }, row.sessionId)
                )
              : jsx.jsx('div', { className: 'dshWmAiHint', children: '还没有作品绑定过写作伙伴。' }),
          }, 'rows')
        : null,
    ],
  })
}
