/**
 * 状态条（P1-② 从 app/WritingModeApp.js 抽出；DOM、类名与 data-* 逐字不变）。
 * 纯 props 渲染：保存态/字数/今日码字/检查摘要全部由 WritingModeApp 传入。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { T } from '../copy.js'

/** 悬浮说明：最多列三条提示（带原文片段），并说明写作伙伴也看得到同一份体检。 */
function healthTitle(health) {
  if (!health) return ''
  if (!health.issues.length) return T.health + '：' + (health.brief || '') + '（' + T.healthCompanion + '）'
  const top = health.issues.slice(0, 3).map((it) => `· ${it.hint}（「${it.excerpt}…」）`)
  const more = health.issues.length > 3 ? `\n…另有 ${health.issues.length - 3} 处` : ''
  return `${T.health}：${health.brief}\n${top.join('\n')}${more}\n${T.healthCompanion}`
}

export const StatusBar = react.memo(function StatusBar({
  saveState,
  dirty,
  saveLabel,
  content,
  filePath,
  stats,
  dailyGoal,
  gate,
  health,
  onJumpToIssue,
}) {
  // 体检芯片可点开（2026-10-11）：列出每条提示，点一条把光标跳到正文里那一处。
  const [healthOpen, setHealthOpen] = react.useState(false)
  react.useEffect(() => { if (!health) setHealthOpen(false) }, [health])
  return jsx.jsx(
    'div',
    {
      className: 'dshWmStatus',
      children: [
        jsx.jsx('span', {
          className: 'dot ' + (saveState === 'error' ? 'is-error' : dirty ? 'is-dirty' : saveState === 'saved' ? 'is-saved' : ''),
          'data-wm-save-dot': saveState,
        }),
        jsx.jsx('span', {
          className: saveState === 'error' ? 'dshWmStatusError' : '',
          'data-wm-save-label': '1',
          children: saveLabel,
        }),
        jsx.jsx('span', { className: 'dshWmStatusSep', children: '·' }),
        jsx.jsx('span', {
          className: 'dshWmStatusMeta',
          children: `${content.replace(/\s+/g, '').length} ${T.chars}`,
        }),
        jsx.jsx('span', {
          className: 'dshWmStatusSep',
          children: '·',
        }),
        jsx.jsx('span', {
          className: 'dshWmStatusMeta',
          children: (filePath || '').toLowerCase().endsWith('.fountain')
            ? 'Fountain'
            : 'Markdown',
        }),
        stats
          ? jsx.jsx('span', { className: 'dshWmStatusSep', children: '·' }, 'sts')
          : null,
        stats
          ? jsx.jsx('span', {
              'data-wm-stats-today': String(stats.today),
              title: T.statsToday + '（' + T.stats + '）',
              children:
                T.statsToday + ' +' + stats.today +
                (dailyGoal > 0 ? ' / ' + dailyGoal + T.statsGoalUnit : '') +
                (stats.streak > 1 ? ' · ' + T.statsStreak + stats.streak + T.statsStreakUnit : ''),
            }, 'stv')
          : null,
        /* 分组只靠 · 分隔符：顶栏那条 20px 竖线在 32px 状态条里是双重分隔（竖线+中点并存） */
        gate
          ? jsx.jsx('span', {
              className: 'dshWmStatusSep',
              children: '·',
            })
          : null,
        gate
          ? jsx.jsx('span', {
              className: 'dshWmGateState ' + (gate.pass ? 'is-pass' : 'is-fail'),
              children: gate.pass
                ? T.gateShort + ' ✓'
                : T.gateShort + ' ' + gate.fail,
            })
          : null,
        /* 实时体检（2026-10-11）：本地毫秒级算出来的提示数，鼠标停上去看具体是哪几处；
           同一份结果也会随消息发给写作伙伴（所以它不用你复述问题）。 */
        health
          ? jsx.jsx('span', { className: 'dshWmStatusSep', children: '·' }, 'hs')
          : null,
        health
          ? jsx.jsx('button', {
              type: 'button',
              className: 'dshWmHealthChip' + (health.issues.length ? ' is-warn' : '') + (healthOpen ? ' is-open' : ''),
              'data-wm-health': String(health.issues.length),
              title: healthTitle(health),
              'aria-expanded': healthOpen ? 'true' : 'false',
              onClick: () => setHealthOpen((v) => !v),
              children: health.issues.length ? T.health + ' ' + health.issues.length : T.health + ' ✓',
            }, 'hv')
          : null,
        healthOpen && health
          ? jsx.jsxs('div', {
              className: 'dshWmHealthPop',
              'data-wm-health-pop': '1',
              children: [
                jsx.jsx('div', { className: 'dshWmHealthPopHead', children: health.brief || T.health }),
                health.issues.length
                  ? jsx.jsx('div', {
                      className: 'dshWmHealthPopList',
                      children: health.issues.map((it, i) =>
                        jsx.jsxs('button', {
                          type: 'button',
                          className: 'dshWmHealthRow',
                          'data-wm-health-row': it.kind,
                          title: T.healthJump,
                          onClick: () => {
                            if (onJumpToIssue) onJumpToIssue(it)
                            setHealthOpen(false)
                          },
                          children: [
                            jsx.jsx('span', { className: 'dshWmHealthRowHint', children: it.hint }),
                            jsx.jsx('span', { className: 'dshWmHealthRowEx', children: '「' + it.excerpt + '…」' }),
                          ],
                        }, it.kind + ':' + i)
                      ),
                    })
                  : jsx.jsx('div', { className: 'dshWmHealthRowEx', children: T.healthClean }),
                jsx.jsx('div', { className: 'dshWmHealthPopFoot', children: T.healthCompanion }),
              ],
            }, 'hp')
          : null,
      ],
    },
    'st'
  )
})
