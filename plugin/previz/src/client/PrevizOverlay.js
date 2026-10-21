import * as react from 'react'
import { exitPreviz, setUi } from './store.js'
import { useActiveModeId, useUiState, useWorkbenchPresent } from './usePreviz.js'
import { PrevizPanel } from './PrevizPanel.js'

const h = react.createElement

export function PrevizOverlay() {
  const ui = useUiState()
  const wb = useWorkbenchPresent()
  const active = useActiveModeId()
  const activePreviz = wb && active === 'previz'
  const show = activePreviz || (!wb && ui.open)
  if (!show) return null
  const close = () => {
    if (activePreviz) void exitPreviz()
    else setUi({ open: false })
  }
  return h(
    'div',
    {
      style: {
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--dsw-alias-bg-base)',
      },
      'data-previz-overlay': '',
    },
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--dsw-alias-border-l1)',
        },
      },
      h('strong', { style: { fontSize: 14 } }, '预演'),
      h('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 } }, 'P0 demo'),
      h('span', { style: { flex: 1 } }),
      h(
        'button',
        {
          type: 'button',
          onClick: close,
          style: {
            padding: '2px 9px',
            border: '1px solid var(--dsw-alias-border-l2)',
            borderRadius: 7,
            background: 'transparent',
            color: 'var(--dsw-alias-label-primary)',
            cursor: 'pointer',
          },
        },
        wb && active === 'previz' ? '退出预演' : '关闭',      ),
    ),
    h('div', { style: { flex: 1, minHeight: 0 } }, h(PrevizPanel, { compact: false })),
  )
}
