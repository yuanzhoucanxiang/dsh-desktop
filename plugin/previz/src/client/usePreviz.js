import * as react from 'react'
import { getActiveModeId, getLast, getUi, isWorkbenchPresent, subscribeActive, subscribeState, subscribeUi, subscribeWorkbench } from './store.js'

export function useSnapshot() {
  const [snap, setSnap] = react.useState(getLast())
  react.useEffect(() => subscribeState(() => setSnap(getLast())), [])
  return snap
}

export function useUiState() {
  const [ui, setUi] = react.useState(getUi())
  react.useEffect(() => subscribeUi(() => setUi(getUi())), [])
  return ui
}

export function useWorkbenchPresent() {
  const [present, setPresent] = react.useState(isWorkbenchPresent())
  react.useEffect(() => subscribeWorkbench(() => setPresent(isWorkbenchPresent())), [])
  return present
}

export function useActiveModeId() {
  const [active, setActive] = react.useState(getActiveModeId())
  react.useEffect(() => subscribeActive(() => setActive(getActiveModeId())), [])
  return active
}
