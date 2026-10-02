/**
 * 检查面板（C 整合）：右栏第三区「检查」，承载门禁与台账两个默认收起的区块。
 * 原先它们混在「文字工具」tab 里（生成动作与质量检查两种语义挤一处）；
 * 抽出后：伙伴=交流、工具=生成动作、检查=门禁/台账。
 * 纯展示组件：状态与动作全部由 WritingModeApp 经 props 传入。
 */
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
}) {
  return jsx.jsxs('div', {
    className: 'dshWmAiBody',
    children: [
      /* ── 门禁：默认收起，只露一行摘要 ── */
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
      /* ── 台账：默认收起 ── */
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
