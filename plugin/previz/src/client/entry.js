/**
 * `@dsh-local/previz` 客户端入口：独立入口（没工作台时）+ 工作台模式（有工作台时）。
 *
 * 硬约束：
 * - 装了工作台就让出侧栏入口，只留工作台接缝；
 * - 没工作台时自己的入口 + 全屏 overlay 必须可用；
 * - 轮询是模式自己的（工作台不替模式轮询），面板只是读快照。
 */
import { PrevizEntry } from './PrevizEntry.js'
import { PrevizOverlay } from './PrevizOverlay.js'
import { registerPrevizMode } from './mode.js'
import { setWorkbenchPresent, setWorkbenchService, startPolling } from './store.js'

const already = window.__dshPrevizLoaded === true
window.__dshPrevizLoaded = true

export const name = 'previz'
export const inject = already ? [] : ['slots']

export function apply(ctx) {
  if (already) return
  ctx.effect(() => startPolling(), 'previz: polling')

  const register = (slot, options, Component, tag) => {
    try {
      ctx.effect(() => ctx.slots.inject(slot, () => ctx.slots.register(options, Component)), tag)
    } catch (err) {
      console.warn('[previz] slot register failed:', slot, err)
    }
  }

  register('sidebar.footer.action', { name: 'sidebar.footer.action', id: 'previz', order: 11, label: () => '预演' }, PrevizEntry, 'previz: standalone entry')
  register('shell.overlay', { name: 'shell.overlay', id: 'previz', order: 9, label: () => '预演' }, PrevizOverlay, 'previz: standalone overlay')

  try {
    ctx.inject(['workbench'], (scope) => {
      setWorkbenchPresent(true)
      setWorkbenchService(scope?.workbench)
      try {
        registerPrevizMode(scope?.workbench)
      } catch (err) {
        console.warn('[previz] registerMode failed:', err)
      }
    })
  } catch (err) {
    console.warn('[previz] workbench inject failed:', err)
  }

  console.info('[previz] client ready · standalone entry + workbench mode')
}
