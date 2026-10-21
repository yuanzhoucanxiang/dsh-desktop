import { api } from './api.js'
import { getLast, setUi, subscribeJobs, subscribeRuntime, refresh } from './store.js'
import { PrevizPanel, PrevizTile } from './PrevizPanel.js'

/** 把预演注册成工作台的一个模式（外部工具型：runtime / jobs / artifacts 三面都提供）。 */
export function registerPrevizMode(workbench) {
  if (!workbench || typeof workbench.registerMode !== 'function') return null
  return workbench.registerMode({
    id: 'previz',
    label: () => '预演',
    order: 40,
    mount: 'overlay',
    canDeactivate: async () => true,
    onActivate: () => {
      void refresh()
    },
    context: {
      get: () => {
        const snap = getLast()
        const running = snap?.job?.state === 'running'
        return {
          kind: 'previz',
          title: '预演 · 小店',
          project: 'boutique',
          doc: running ? '渲染中' : snap?.job?.state === 'done' ? 'animatic 已就绪' : null,
        }
      },
    },
    runtime: {
      probe: async () => {
        const result = await api('probe')
        if (result?.runtime) return result.runtime
        return { state: 'error', detail: result?.detail || result?.error || 'probe failed', version: null }
      },
      start: () => api('open-blender', {}),
      subscribe: (fn) => subscribeRuntime(fn),
    },
    jobs: {
      list: () => {
        const job = getLast()?.job
        return job ? [job] : []
      },
      cancel: () => api('cancel', {}),
      subscribe: (fn) => subscribeJobs(fn),
    },
    artifacts: {
      list: () => getLast()?.artifacts || [],
      open: (ref) => {
        const path = typeof ref === 'string' ? ref : ref?.path || ref?.id || null
        setUi({ selected: path })
        return true
      },
    },
    splice: { label: '预演', view: PrevizPanel, width: 960 },
    tile: { label: '预演', view: PrevizTile, order: 40 },
  })
}
