import * as react from 'react'
import { setUi } from './store.js'
import { useUiState, useWorkbenchPresent } from './usePreviz.js'

const h = react.createElement

export function PrevizEntry() {
  const ui = useUiState()
  const wb = useWorkbenchPresent()
  if (wb) return null
  return h(
    'button',
    {
      type: 'button',
      onClick: () => setUi({ open: !ui.open }),
      title: '白模预演（P0 demo）',
      'aria-label': '预演',
      'data-previz-entry': '',
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 7,
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
        fontSize: 12,
      },
    },
    h('span', { 'aria-hidden': 'true' }, '◫'),
    h('span', null, '预演'),
  )
}
