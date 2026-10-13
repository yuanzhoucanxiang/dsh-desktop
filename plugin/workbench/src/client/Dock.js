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
import { setDockModeId, setDockOpen, setDockWidth } from './ui-store.js'
import { getShapeBridge, readShape } from './shell-shape.js'
import { useWorkbench } from './use-workbench.js'

/**
 * 壳当前形态（坞据此决定显不显示）。桥缺席 → 空串（官方壳：没有长条这回事，坞照常）。
 * 订阅一次 + 先读一次，别在回调里重建订阅（踩坑 #24）。
 */
function useShellShape() {
  const [shape, setShape] = react.useState('')
  react.useEffect(() => {
    const bridge = getShapeBridge()
    if (!bridge) return undefined
    let cancelled = false
    void (async () => {
      const now = await readShape()
      if (!cancelled && now && now.shape) setShape(now.shape)
    })()
    const off =
      typeof bridge.onWorkbenchShape === 'function'
        ? bridge.onWorkbenchShape((state) => {
            if (state && state.shape) setShape(state.shape)
          })
        : null
    return () => {
      cancelled = true
      if (typeof off === 'function') off()
    }
  }, [])
  return shape
}

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

  // **长条形态下不显示辅助坞**（2026-10-13 实机定位）：坞的 rail 本来挂在右缘，和长条的**接缝**
  // 挤在同一块地方——项目所有者点了 rail 上的"写作"，以为点的是扇形，结果"直接跳进了写作模式"。
  // 语义上也该分开：接缝是长条的**拼接**入口（用户拍板 A），坞是**宽窗主屏**的"同屏共存"附属面。
  const shape = useShellShape()
  const inStrip = shape === 'strip' || shape === 'mini'

  // 候选：提供了坞视图、且不是当前主视图的模式
  const candidates = modes
    .filter((m) => m.hasDock && m.id !== active)
    .map((m) => registry.dockViewOf(m.id))
    .filter(Boolean)
    .sort((a, b) => (a.order === b.order ? a.id.localeCompare(b.id, 'en') : a.order - b.order))

  useDockInset(!inStrip && dockOpen && candidates.length > 0, dockWidth)

  if (inStrip || candidates.length === 0) return null
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

  // 左缘拖拽调宽（2026-10-11 前端轮）：宽度 clamp(240–720) 与 localStorage 持久化都在 ui-store；
  // 拖拽过程经 useDockInset 实时写进 --dsh-wb-dock-width，主视图（如写作台）跟着让位。
  const onGripDown = (event) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = dockWidth
    const onMove = (moveEvent) => setDockWidth(startWidth + (startX - moveEvent.clientX))
    const onUp = () => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('mouseup', onUp, true)
    }
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('mouseup', onUp, true)
  }

  return react.createElement(
    'aside',
    {
      className: 'dshWbDock',
      style: { width: `${dockWidth}px` },
      'data-wb-dock': chosen.id,
      'aria-label': T.dockTitle(chosen.label),
    },
    react.createElement('div', {
      className: 'dshWbDockGrip',
      onMouseDown: onGripDown,
      title: T.dockResize,
      'aria-hidden': 'true',
      'data-wb-dock-resize': '',
    }),
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
