/**
 * 写作模式客户端模块（P1 从 entry.js 搬迁；行为不变）。
 */
import { getModeActive, subscribeMode, setModeActive } from '../../state/mode-store.js'
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { T } from '../../copy.js'

export function WritingModeFooterEntry() {
  const [on, setOn] = react.useState(getModeActive)
  react.useEffect(() => subscribeMode(() => setOn(getModeActive())), [])
  return jsx.jsx('button', {
    type: 'button',
    className: on ? 'dshWmBtn is-primary' : 'dshWmBtn',
    title: on ? T.exit : T.toggle,
    style: { width: '100%', justifyContent: 'center' },
    onClick: () => setModeActive(!on),
    children: on ? T.exit : T.toggle,
  })
}

/** 会话顶栏工具区入口（次要，槽位缺失时静默）。 */
export function WritingModeHeaderEntry() {
  const [on, setOn] = react.useState(getModeActive)
  react.useEffect(() => subscribeMode(() => setOn(getModeActive())), [])
  return jsx.jsx('button', {
    type: 'button',
    className: 'dshWmBtn',
    title: on ? T.exit : T.toggle,
    onClick: () => setModeActive(!on),
    children: on ? T.exit : T.toggle,
  })
}
