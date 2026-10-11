/**
 * 写作模式 ↔ 工具台（可选服务 `workbench`）的适配层。
 *
 * 工具台是**可选**的：没装（或跑在官方壳上）时本模块什么都不做，写作模式照旧自持入口
 * （`sidebar.footer.action` 图标钮 + 会话顶栏钮 + 隐藏浮钮 + Ctrl+Shift+W）——这就是降级路径。
 *
 * 装了工具台时（2026-10-11 P1 接入）：
 *   ① 把"写作"注册成工具台的一个模式（id `writing`，挂载形态 overlay）；
 *   ② 两个自持入口让位（`features/settings/entries.js` 订阅 `hasWorkbench()` 后渲染 null），
 *      于是侧栏底部只剩**一个**工具台入口（验收 W1）；
 *   ③ 激活/失活与工具台同步：工具台切换时调 onActivate/onDeactivate 落模式状态；
 *      模式自己开的（设置页「进入写作模式」/Ctrl+Shift+W/浮钮）也回灌给工具台，避免两套状态分叉；
 *   ④ 关闭守卫交给工具台的 `canDeactivate`（问一次 `askCloseGuard()`，被拒就不切）。
 *
 * 契约见 dsh-desktop/docs/plans/workbench-layer-v1.md §3；本文件不 import React / 不碰 DOM，
 * 可以在 node 里直接单测（test/workbench-bridge.mjs）。
 */
import { askCloseGuard, commitModeActive, getModeActive, subscribeMode } from '../state/mode-store.js'
import { T } from '../copy.js'

const MODE_ID = 'writing'

/** 活着的工具台服务（null = 未装工具台 / 官方壳）。 */
let service = null
const listeners = new Set()

function emit() {
  for (const fn of [...listeners]) {
    try {
      fn()
    } catch (err) {
      console.warn('[writing-mode] workbench listener failed:', err)
    }
  }
}

export function hasWorkbench() {
  return service !== null
}

/** 入口控件订阅它：工具台出现/消失时重新决定要不要让位。 */
export function subscribeWorkbench(fn) {
  if (typeof fn !== 'function') return () => {}
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * 绑定工具台服务。`ctx.inject` 是可选注入：服务缺席时回调不会触发，
 * 写作模式的行为与接入前逐字一致（既有门禁即回归网）。
 * 返回 cordis effect 的清理函数（工具台被卸载/禁用时自动让位还原）。
 */
export function bindWorkbench(ctx) {
  if (!ctx || typeof ctx.inject !== 'function') return undefined
  return ctx.inject(['workbench'], (scope) => {
    const wb = scope && scope.workbench
    if (!wb || typeof wb.registerMode !== 'function') return undefined
    service = wb

    const disposeMode = wb.registerMode({
      id: MODE_ID,
      label: () => T.toggle,
      order: 20,
      mount: 'overlay',
      // 被问一次就够：允许时由 onDeactivate 落状态（见 mode-store.askCloseGuard 的注释）
      canDeactivate: () => askCloseGuard(),
      onActivate: () => commitModeActive(true),
      onDeactivate: () => commitModeActive(false),
    })

    // 模式自己开的/关的（设置页、热键、浮钮）也要让工具台知道，避免两套状态分叉。
    const offMode = subscribeMode(() => {
      const local = getModeActive()
      const remote = typeof wb.getActive === 'function' && wb.getActive() === MODE_ID
      if (local && !remote) {
        if (typeof wb.setActive === 'function') void wb.setActive(MODE_ID, 'mode-local')
      } else if (!local && remote) {
        if (typeof wb.setActive === 'function') void wb.setActive(null, 'mode-local')
      }
    })

    emit()
    console.info('[writing-mode] 已接入工具台：两个自持入口让位，切换与守卫交给工具台')

    return () => {
      offMode()
      if (typeof disposeMode === 'function') disposeMode()
      if (service === wb) service = null
      emit()
    }
  })
}

/** 测试钩子：拿到当前工具台服务（无则 null）。 */
export function __workbenchService() {
  return service
}
