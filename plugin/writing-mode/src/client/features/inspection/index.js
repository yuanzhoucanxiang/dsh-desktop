/**
 * 检查面板（C 整合）：右栏「检查」tab，承载成稿检查、伏笔线索与码字统计三个默认收起的区块。
 * 原先它们混在「文字工具」tab 里（生成动作与质量检查两种语义挤一处）；2026-10-09 右栏再整合：
 * 工具收进伙伴页抽屉，检查 tab 专职质量与进度（检查/伏笔线索/码字）。
 * 纯展示组件：状态与动作全部由 WritingModeApp 经 props 传入。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'

export function InspectionPanel({
  T,
  filePath,
  gate,
  gateErr,
  gateBusy,
  gateOpen,
  onToggleGate,
  onRunGate,
  ledger,
  ledgerOpen,
  onToggleLedger,
  stats,
  statsOpen,
  onToggleStats,
  dailyGoal,
  onSaveGoal,
}) {
  const [goalDraft, setGoalDraft] = react.useState(String(dailyGoal || ''))
  react.useEffect(() => { setGoalDraft(String(dailyGoal || '')) }, [dailyGoal])
  const statDays = stats && Array.isArray(stats.days) ? stats.days : []
  const statMax = Math.max(1, ...statDays.map(d => d.total))
  return jsx.jsxs('div', {
    className: 'dshWmAiBody',
    children: [
      /* ── 码字：今日净增 / 连击 / 近 14 天 / 日更目标 ── */
      jsx.jsxs(
        'div',
        {
          className: 'dshWmSec',
          children: [
            jsx.jsxs(
              'button',
              {
                type: 'button',
                className: 'dshWmSecToggle',
                onClick: onToggleStats,
                children: [
                  jsx.jsx('span', {
                    children: (statsOpen ? '▾ ' : '▸ ') + T.stats,
                  }, 't'),
                  jsx.jsx('span', {
                    className: 'dshWmSecBadge',
                    'data-wm-stats-badge': '1',
                    children: stats ? T.statsToday + ' +' + stats.today : '—',
                  }, 'b'),
                ],
              },
              'st'
            ),
            statsOpen
              ? stats
                ? jsx.jsxs(
                    'div',
                    {
                      className: 'dshWmStats',
                      children: [
                        jsx.jsxs('div', { className: 'dshWmStatsHead', children: [
                          jsx.jsxs('span', { className: 'dshWmStatsToday', 'data-wm-stats-today-big': '1', children: [
                            T.statsToday + ' ',
                            jsx.jsx('b', { children: '+' + stats.today }),
                            dailyGoal > 0
                              ? jsx.jsx('span', {
                                  className: stats.today >= dailyGoal ? 'is-hit' : '',
                                  children: ' / ' + dailyGoal + T.statsGoalUnit + (stats.today >= dailyGoal ? ' ✓' : ''),
                                })
                              : null,
                          ] }, 'td'),
                          stats.streak > 1
                            ? jsx.jsx('span', {
                                className: 'dshWmStatsStreak',
                                'data-wm-stats-streak': String(stats.streak),
                                children: T.statsStreak + ' ' + stats.streak + ' ' + T.statsStreakUnit,
                              }, 'sk')
                            : null,
                        ] }, 'hd'),
                        statDays.length
                          ? jsx.jsx('div', {
                              className: 'dshWmStatsBars',
                              'data-wm-stats-bars': '1',
                              children: statDays.map((d, i) =>
                                jsx.jsx('div', {
                                  className: 'dshWmStatsBarCol',
                                  title: d.day + ' · ' + d.total,
                                  children: jsx.jsx('div', {
                                    className: 'dshWmStatsBar' + (d.total > 0 ? ' is-on' : '') + (i === statDays.length - 1 ? ' is-today' : ''),
                                    style: { height: Math.max(d.total > 0 ? 3 : 1, Math.round((d.total / statMax) * 42)) + 'px' },
                                  }),
                                }, d.day)
                              ),
                            }, 'bars')
                          : jsx.jsx('div', { className: 'dshWmAiHint', children: T.statsNoData }, 'nd'),
                        jsx.jsxs('div', { className: 'dshWmGoalRow', children: [
                          jsx.jsx('span', { className: 'dshWmLedgerK', children: T.statsGoal }, 'gl'),
                          jsx.jsx('input', {
                            className: 'dshWmGoalInput',
                            'data-wm-goal-input': '1',
                            value: goalDraft,
                            inputMode: 'numeric',
                            placeholder: '0',
                            onChange: e => setGoalDraft(e.target.value.replace(/[^\d]/g, '')),
                          }, 'gi'),
                          jsx.jsx('span', { className: 'dshWmGoalUnit', children: T.statsGoalUnit }, 'gu'),
                          jsx.jsx('button', {
                            type: 'button',
                            className: 'dshWmBtn is-ghost',
                            'data-wm-goal-save': '1',
                            onClick: () => onSaveGoal(Number(goalDraft) || 0),
                            children: T.statsGoalSave,
                          }, 'gs'),
                        ] }, 'gr'),
                      ],
                    },
                    'st2'
                  )
                : jsx.jsx('div', { className: 'dshWmAiHint', 'data-wm-stats-none': '1', children: T.statsNone }, 'sn')
              : null,
          ],
        },
        'ssec'
      ),
      /* ── 成稿检查：默认收起，只露一行摘要 ── */
      jsx.jsxs(
        'div',
        {
          className: 'dshWmSec',
          children: [
            jsx.jsxs(
              'button',
              {
                type: 'button',
                className: 'dshWmSecToggle',
                onClick: onToggleGate,
                children: [
                  jsx.jsx('span', {
                    children: (gateOpen ? '▾ ' : '▸ ') + T.gates,
                  }, 't'),
                  jsx.jsx('span', {
                    className:
                      'dshWmSecBadge' +
                      (gate ? (gate.pass ? ' is-pass' : ' is-fail') : ''),
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
              ? jsx.jsxs(
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
                              onClick: () => void onRunGate(),
                              children: gateBusy ? T.applying : T.runGates,
                            }),
                          ],
                        },
                        'gb'
                      ),
                      gateErr
                        ? jsx.jsx('div', { className: 'dshWmAiHint', children: gateErr }, 'ge')
                        : null,
                      !gate && !gateErr
                        ? jsx.jsx('div', { className: 'dshWmAiHint', children: T.gatesIdle }, 'gi')
                        : null,
                      gate && gate.rows
                        ? jsx.jsx(
                            'div',
                            {
                              className: 'dshWmGateList',
                              children: gate.rows.map((r, i) =>
                                jsx.jsxs(
                                  'div',
                                  {
                                    className: 'dshWmGateRow',
                                    children: [
                                      jsx.jsx('span', {
                                        className: r.ok ? 'ok' : 'bad',
                                        children: r.ok ? 'PASS' : 'FAIL',
                                      }),
                                      jsx.jsx('span', { className: 'dshWmGateLabel', children: r.label }),
                                      jsx.jsx('span', { className: 'dshWmGateDetail', children: r.detail }),
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
      /* ── 伏笔与线索：默认收起 ── */
      jsx.jsxs(
        'div',
        {
          className: 'dshWmSec',
          children: [
            jsx.jsxs(
              'button',
              {
                type: 'button',
                className: 'dshWmSecToggle',
                onClick: onToggleLedger,
                children: [
                  jsx.jsx('span', {
                    children: (ledgerOpen ? '▾ ' : '▸ ') + T.ledger,
                  }, 't'),
                  jsx.jsx('span', {
                    className: 'dshWmSecBadge',
                    children: ledger
                      ? (ledger.foreshadowOpen != null ? ledger.foreshadowOpen + ' · ' : '') +
                        (ledger.latestReview || '—').slice(0, 18)
                      : '—',
                  }, 'b'),
                ],
              },
              'lt'
            ),
            ledgerOpen
              ? ledger
                ? jsx.jsxs(
                    'div',
                    {
                      className: 'dshWmLedger',
                      children: [
                        jsx.jsxs(
                          'div',
                          {
                            className: 'dshWmLedgerRow',
                            children: [
                              jsx.jsx('span', { className: 'dshWmLedgerK', children: T.ledgerHook }),
                              jsx.jsx('span', { className: 'dshWmLedgerV', children: ledger.hook || '—' }),
                            ],
                          },
                          'lh'
                        ),
                        jsx.jsxs(
                          'div',
                          {
                            className: 'dshWmLedgerRow',
                            children: [
                              jsx.jsx('span', { className: 'dshWmLedgerK', children: T.ledgerFores }),
                              jsx.jsx('span', {
                                className: 'dshWmLedgerV',
                                children: ledger.foreshadowOpen == null ? '—' : String(ledger.foreshadowOpen),
                              }),
                            ],
                          },
                          'lf'
                        ),
                        jsx.jsxs(
                          'div',
                          {
                            className: 'dshWmLedgerRow',
                            children: [
                              jsx.jsx('span', { className: 'dshWmLedgerK', children: T.ledgerReview }),
                              jsx.jsx('span', {
                                className: 'dshWmLedgerV',
                                children: ledger.latestReview || '—',
                              }),
                            ],
                          },
                          'lr'
                        ),
                        ledger.timeline && ledger.timeline.length
                          ? jsx.jsxs(
                              'div',
                              {
                                className: 'dshWmLedgerRow',
                                children: [
                                  jsx.jsx('span', { className: 'dshWmLedgerK', children: T.ledgerTimeline }),
                                  jsx.jsx('span', {
                                    className: 'dshWmLedgerV',
                                    children: ledger.timeline[ledger.timeline.length - 1],
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
                : jsx.jsx('div', { className: 'dshWmAiHint', children: T.ledgerNone }, 'ln')
              : null,
          ],
        },
        'lsec'
      ),
    ],
  })
}
