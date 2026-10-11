/**
 * 组件共用的订阅 hook：把「注册表快照 + 当前上下文 + 最近交接 + 工具台 UI 状态」合成一个快照。
 * 两个挂载点（侧栏入口 / 帧级浮层）是各自独立的 React 根，靠模块级订阅对齐。
 */
import * as react from 'react'
import { getDockModeId, getDockWidth, getNotice, isDockOpen, isOpen, subscribe as subscribeUi } from './ui-store.js'
import { getRegistry } from './runtime.js'

export function useWorkbench() {
  const registry = getRegistry()
  const snapshot = react.useCallback(
    () => ({
      modes: registry.list(),
      active: registry.getActive(),
      // 上下文只在需要时问（模式的 context.get 可能读文件/状态，不该每次渲染都全量拉）
      context: registry.contextOf(registry.getActive()),
      lastHandoff: registry.lastHandoff(),
      open: isOpen(),
      notice: getNotice(),
      // 辅助坞（L2）：开合/宽度/显示哪个模式
      dockOpen: isDockOpen(),
      dockWidth: getDockWidth(),
      dockModeId: getDockModeId(),
    }),
    [registry],
  )
  const [state, setState] = react.useState(snapshot)
  react.useEffect(() => {
    const sync = () => setState(snapshot())
    const offRegistry = registry.subscribe(sync)
    const offUi = subscribeUi(sync)
    sync()
    return () => {
      offRegistry()
      offUi()
    }
  }, [registry, snapshot])
  return { ...state, registry }
}
