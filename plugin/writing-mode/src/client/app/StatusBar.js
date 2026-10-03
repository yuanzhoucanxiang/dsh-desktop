/**
 * 状态条（P1-② 从 app/WritingModeApp.js 抽出；DOM、类名与 data-* 逐字不变）。
 * 纯 props 渲染：保存态/字数/今日码字/门禁摘要全部由 WritingModeApp 传入。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { T } from '../copy.js'

export const StatusBar = react.memo(function StatusBar({
  saveState,
  dirty,
  saveLabel,
  content,
  filePath,
  stats,
  dailyGoal,
  gate,
}) {
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
      ],
    },
    'st'
  )
})
