/**
 * 拼接面板的**内容**（2026-10-13，用户拍板 A：拼接要的是模式的完整界面）。
 *
 * 三种来源，按优先级：
 *  ① `splice.mount(container)` —— **单实例模式**（写作台这种：自己的 React 根 + 编辑会话 + 草稿恢复）
 *     把自己的界面渲染进我们给的容器里，返回 dispose。再挂一份组件会打架，所以这条路是给它准备的。
 *  ② `splice.view` —— 可自由重挂的模式直接给个组件引用。
 *  ③ 退回 `dock.view`（旧的"轻视图"路径，模式还没交完整界面时的降级，如实呈现，不假装）。
 *
 * 契约细节：`mount` 只在**这一块存在期间**调用一次（面板收起/换模式时调 dispose）；
 * 我们保证传进去的是一个**已经在文档里的空容器**，模式可以 appendChild 或 createPortal。
 */
import * as react from 'react'

export function SplicePanelBody({ view }) {
  const hostRef = react.useRef(null)
  const mount = view && typeof view.mount === 'function' ? view.mount : null
  const viewId = view ? view.id : null

  react.useEffect(() => {
    if (!mount || !hostRef.current) return undefined
    let dispose = null
    try {
      // 容器已在文档里（effect 跑在挂载之后），模式可以放心 portal / appendChild
      dispose = mount(hostRef.current)
    } catch (err) {
      console.warn('[workbench] splice mount failed:', err)
    }
    return () => {
      try {
        if (typeof dispose === 'function') dispose()
      } catch (err) {
        console.warn('[workbench] splice dispose failed:', err)
      }
    }
  }, [viewId, mount])

  if (!view) return null
  if (view.view && !mount) return react.createElement(view.view)
  return react.createElement('div', {
    className: 'dshWbSpliceHost',
    'data-wb-splice-host': viewId,
    'data-wb-splice-source': mount ? 'mount' : view.view ? 'view' : 'dock-view',
    ref: hostRef,
  })
}
