/**
 * 写作模式的入口控件（P1 从 entry.js 搬迁；2026-10-09 收敛为单一图标入口）。
 *
 * 设计（用户反馈「左下角一个很大很突出、右下角一个有些杂余，收敛成一个图标放左侧」）：
 * - 侧栏 footer 的 `sidebar.footer.action` 槽位在官方外壳里就是 **一行动作按钮**
 *   （`div.footerActions`，`display:flex; justify-content:center`），本就该放图标；
 * - 因此入口统一成 32×32 的图标钮：常态安静（label-secondary）、hover 提亮、
 *   激活（写作台已开）用品牌色淡底，**不再用整宽 + 品牌实底的 `.dshWmBtn is-primary`**；
 * - 右下角 DOM 浮钮改为默认隐藏（见 app/dom-float.js 与 styles/writing-css.js 的 `.dshWmFloat`），
 *   元素与 id 保留：既有验证脚本用 `.click()` 程序化进入，仍然可用。
 */
import { getModeActive, subscribeMode, setModeActive } from '../../state/mode-store.js'
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { T } from '../../copy.js'

/** 入口图标（笔）：与官方侧栏图标的描边风格一致，随 currentColor 取色。 */
export function WritingModeIcon({ size = 16 }) {
  return jsx.jsxs('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': 'true', focusable: 'false',
    children: [
      jsx.jsx('path', { d: 'M12 20h9' }, 'l'),
      jsx.jsx('path', { d: 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z' }, 'p'),
    ],
  })
}

/** 图标入口钮（侧栏 footer 与会话顶栏共用；`wide` 时只影响外层留白，不改按钮尺寸）。 */
function WritingModeIconButton({ on, onToggle, extraClass }) {
  const label = on ? T.exit : T.toggle
  return jsx.jsx('button', {
    type: 'button',
    className: 'dshWmIconBtn' + (on ? ' is-on' : '') + (extraClass ? ' ' + extraClass : ''),
    title: label,
    'aria-label': label,
    'aria-pressed': on ? 'true' : 'false',
    onClick: onToggle,
    children: jsx.jsx(WritingModeIcon, {}, 'i'),
  })
}

/** 侧栏底部入口（官方槽位；官方会传 `wide` 表示侧栏展开态）。 */
export function WritingModeFooterEntry({ wide } = {}) {
  const [on, setOn] = react.useState(getModeActive)
  react.useEffect(() => subscribeMode(() => setOn(getModeActive())), [])
  return jsx.jsx(WritingModeIconButton, {
    on,
    onToggle: () => setModeActive(!on),
    extraClass: wide ? 'is-wide' : 'is-rail',
  })
}

/** 会话顶栏工具区入口（次要，槽位缺失时静默）。 */
export function WritingModeHeaderEntry() {
  const [on, setOn] = react.useState(getModeActive)
  react.useEffect(() => subscribeMode(() => setOn(getModeActive())), [])
  return jsx.jsx(WritingModeIconButton, { on, onToggle: () => setModeActive(!on) })
}
