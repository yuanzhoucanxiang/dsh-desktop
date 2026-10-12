/**
 * 侧栏底部入口（`sidebar.footer.action`）。
 *
 * 硬约束（文档 §3.3 / 验收 W5）：**没有模式注册时渲染 null**——宁可没有按钮，
 * 也不留一个点开是空列表的死按钮。
 *
 * 文件名刻意不叫 Entry.js：Windows 文件系统大小写不敏感，`Entry.js` 会与入口 `entry.js`
 * 解析成同一个文件（esbuild 直接报 No matching export）。
 */
import * as react from 'react'
import { T } from './copy.js'
import { toggleOpen } from './ui-store.js'
import { useWorkbench } from './use-workbench.js'

export function WorkbenchEntry() {
  const { modes, active, context, open } = useWorkbench()
  if (modes.length === 0) return null

  const activeLabel = (modes.find((m) => m.id === active) || {}).label || ''
  // 有上下文就显示"正在做什么"（L1：切模式不丢上下文，入口上也看得见）
  const contextLabel = context ? context.title || context.project || context.path || '' : ''

  const onClick = () => {
    // 工具台主屏（2026-10-11 起）：点入口 = 进入/退出主屏，不再为单模式直进——
    // 主屏本身就是目的地（左对话 + 右瓷砖），不是"只有一个选项的列表"。
    toggleOpen()
  }

  return react.createElement(
    'button',
    {
      type: 'button',
      className: `dshWbEntry${open ? ' is-open' : ''}`,
      onClick,
      title: [T.entry, activeLabel, contextLabel].filter(Boolean).join(' · '),
      'aria-label': T.entry,
      'data-wb-entry': '',
      'data-wb-count': String(modes.length),
    },
    react.createElement('span', { className: 'dshWbEntryGlyph', 'aria-hidden': 'true' }, '◧'),
    react.createElement('span', { className: 'dshWbEntryLabel' }, T.entry),
    activeLabel
      ? react.createElement('span', { className: 'dshWbEntryMode', 'data-wb-active-label': '' }, contextLabel ? `${activeLabel} · ${contextLabel}` : activeLabel)
      : null,
  )
}
