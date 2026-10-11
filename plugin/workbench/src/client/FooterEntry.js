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
import { switchMode } from './actions.js'

export function WorkbenchEntry() {
  const { modes, active, context, open, registry } = useWorkbench()
  if (modes.length === 0) return null

  const activeLabel = (modes.find((m) => m.id === active) || {}).label || ''
  // 有上下文就显示"正在做什么"（L1：切模式不丢上下文，入口上也看得见）
  const contextLabel = context ? context.title || context.project || context.path || '' : ''
  const only = modes.length === 1 ? modes[0] : null

  const onClick = () => {
    // 只有一个模式且它还没激活：点一下就是"进去"，不再让人在只有一个选项的列表里点第二次。
    if (only && active !== only.id) {
      void switchMode(registry, only.id)
      return
    }
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
