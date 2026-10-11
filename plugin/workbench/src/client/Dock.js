/**
 * 辅助坞（L2，2026-10-11）：**主视图之外的另一个模式**可以在右缘挂一份"轻视图"。
 *
 * 形态选择（用户 2026-10-11 选定 A 之后的第一步）：
 *   - 坞是**工具台自己的浮层条目**（`shell.overlay`，id `workbench-dock`），不是模式的浮层；
 *   - 视图内容由模式提供（运行时传进来的 React 组件引用，不是跨插件 import——不违反 bundle 纯净门禁）；
 *   - 坞**只显示"不是当前主视图"的模式**：主视图已经有了，再显示一遍没意义；
 *   - 收起时留一条右缘 rail（竖排小按钮），点一下展开；
 *   - 展开时把宽度写进 `--dsh-wb-dock-width`：模式可以选择给内容让位（写作台已经这么做）。
 *
 * 与"互斥"的关系：互斥仍然成立——同一时刻只有一个**主视图**；坞是主视图的附属面，
 * 不改变 activeModeId，也不参与 canDeactivate。
 */
import * as react from 'react'
import { T } from './copy.js'
import { setDockModeId, setDockOpen } from './ui-store.js'
import { useWorkbench } from './use-workbench.js'

/** 坞宽度同步到 CSS 变量：模式用 `padding-right: var(--dsh-wb-dock-width, 0px)` 让位。 */
function useDockInset(open, width) {
  react.useEffect(() => {
    try {
      document.documentElement.style.setProperty('--dsh-wb-dock-width', open ? `${width}px` : '0px')
    } catch {
      /* 无 document 的环境（单测）忽略 */
    }
    return () => {
      try {
        document.documentElement.style.setProperty('--dsh-wb-dock-width', '0px')
      } catch {
        /* 同上 */
      }
    }
  }, [open, width])
}

export function WorkbenchDock() {
  const { modes, active, dockOpen, dockWidth, dockModeId, registry } = useWorkbench()

  // 候选：提供了坞视图、且不是当前主视图的模式
  const candidates = modes
    .filter((m) => m.hasDock && m.id !== active)
    .map((m) => registry.dockViewOf(m.id))
    .filter(Boolean)
    .sort((a, b) => (a.order === b.order ? a.id.localeCompare(b.id, 'en') : a.order - b.order))

  useDockInset(dockOpen && candidates.length > 0, dockWidth)

  if (candidates.length === 0) return null
  const chosen = candidates.find((c) => c.id === dockModeId) || candidates[0]

  if (!dockOpen) {
    return react.createElement(
      'button',
      {
        type: 'button',
        className: 'dshWbDockRail',
        onClick: () => setDockOpen(true),
        title: T.dockOpen(chosen.label),
        'aria-label': T.dockOpen(chosen.label),
        'data-wb-dock-rail': '',
      },
      react.createElement('span', { className: 'dshWbDockRailText' }, chosen.label),
    )
  }

  const DockView = chosen.view
  return react.createElement(
    'aside',
    {
      className: 'dshWbDock',
      style: { width: `${dockWidth}px` },
      'data-wb-dock': chosen.id,
      'aria-label': T.dockTitle(chosen.label),
    },
    react.createElement(
      'div',
      { className: 'dshWbDockHead' },
      candidates.length > 1
        ? react.createElement(
            'select',
            {
              className: 'dshWbDockPick',
              value: chosen.id,
              onChange: (event) => setDockModeId(event.target.value),
              title: T.dockPick,
              'data-wb-dock-pick': '',
            },
            candidates.map((c) => react.createElement('option', { key: c.id, value: c.id }, c.label)),
          )
        : react.createElement('span', { className: 'dshWbDockTitle' }, chosen.label),
      react.createElement(
        'button',
        { type: 'button', className: 'dshWbDockClose', onClick: () => setDockOpen(false), title: T.dockCollapse, 'data-wb-dock-close': '' },
        '⟩',
      ),
    ),
    react.createElement('div', { className: 'dshWbDockBody', 'data-wb-dock-body': chosen.id }, react.createElement(DockView)),
  )
}
