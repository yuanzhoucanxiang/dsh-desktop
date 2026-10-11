/**
 * 工具台模式注册表（纯函数面：不碰 DOM / React / 网络，可在 node 里直接单测）。
 *
 * 契约见 docs/plans/workbench-layer-v1.md §3：
 *   - 模式向工具台注册描述（id/label/order/mount + 可选生命周期、上下文、健康）
 *   - 工具台持有**唯一** activeModeId（互斥），切换先过当前模式的关闭守卫
 *   - 模式在 `workbench` 服务缺席时自持入口（降级），所以本模块不假设自己是唯一入口
 *
 * 这里刻意不渲染任何东西：模式自己的全屏浮层由模式自己注册（shell.overlay），
 * 工具台只决定"谁是当前模式"，并把这件事广播出去（subscribe）。
 */

const MOUNTS = new Set(['overlay', 'panel'])

function normalizeLabel(label) {
  if (typeof label === 'function') {
    try {
      return String(label() ?? '')
    } catch {
      return ''
    }
  }
  return String(label ?? '')
}

function normalizeMode(descriptor, id) {
  const order = Number.isFinite(descriptor.order) ? Number(descriptor.order) : 100
  const mount = MOUNTS.has(descriptor.mount) ? descriptor.mount : 'overlay'
  return {
    id,
    order,
    mount,
    rawLabel: descriptor.label,
    canDeactivate: typeof descriptor.canDeactivate === 'function' ? descriptor.canDeactivate : null,
    onActivate: typeof descriptor.onActivate === 'function' ? descriptor.onActivate : null,
    onDeactivate: typeof descriptor.onDeactivate === 'function' ? descriptor.onDeactivate : null,
    context: descriptor.context && typeof descriptor.context === 'object' ? descriptor.context : null,
    health: descriptor.health && typeof descriptor.health === 'object' ? descriptor.health : null,
    refs: descriptor.refs && typeof descriptor.refs === 'object' ? descriptor.refs : null,
  }
}

/** 对外视图：只给 UI 用的字段（内部钩子不出表）。 */
function publicView(mode, activeId) {
  return {
    id: mode.id,
    label: normalizeLabel(mode.rawLabel) || mode.id,
    order: mode.order,
    mount: mode.mount,
    active: mode.id === activeId,
    hasContext: mode.context !== null,
  }
}

function sortModes(modes) {
  return [...modes].sort((a, b) => (a.order === b.order ? a.id.localeCompare(b.id, 'en') : a.order - b.order))
}

export function createRegistry(options = {}) {
  const onPersist = typeof options.onPersist === 'function' ? options.onPersist : null
  const modes = new Map()
  const listeners = new Set()
  let activeId = null

  function notify() {
    for (const fn of [...listeners]) {
      try {
        fn()
      } catch (err) {
        console.warn('[workbench] registry listener failed:', err)
      }
    }
  }

  function resolveLabel(id) {
    const mode = modes.get(id)
    return mode ? normalizeLabel(mode.rawLabel) || mode.id : id
  }

  /** 注册一个模式；返回 disposer（随调用方的 effect 拆除）。重复 id 直接抛错（配置事故要响）。 */
  function registerMode(descriptor) {
    const id = String(descriptor?.id ?? '').trim()
    if (!id) throw new Error('workbench.registerMode: id 必填')
    if (modes.has(id)) throw new Error(`workbench.registerMode: 重复的模式 id "${id}"`)
    const mode = normalizeMode(descriptor || {}, id)
    modes.set(id, mode)
    notify()
    return function unregister() {
      if (modes.get(id) !== mode) return
      modes.delete(id)
      if (activeId === id) {
        activeId = null
        try {
          mode.onDeactivate?.({ to: null, reason: 'unregistered' })
        } catch (err) {
          console.warn('[workbench] onDeactivate failed:', err)
        }
        if (onPersist) persist()
      }
      notify()
    }
  }

  function list() {
    return sortModes(modes.values()).map((mode) => publicView(mode, activeId))
  }

  function getActive() {
    return activeId
  }

  function has(id) {
    return modes.has(String(id ?? '').trim())
  }

  function size() {
    return modes.size
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {}
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  function persist() {
    if (!onPersist) return
    try {
      onPersist({ activeModeId: activeId })
    } catch (err) {
      console.warn('[workbench] persist failed:', err)
    }
  }

  /**
   * 切换当前模式。`null` = 退出到"没有模式"（回到内核界面）。
   * 返回 `{ok, changed, active, error?}`；被关闭守卫拦下时 `error='deactivate-refused'`。
   */
  async function setActive(id, reason = 'switch') {
    const next = id === null || id === undefined ? null : String(id).trim()
    if (next !== null && !modes.has(next)) return { ok: false, changed: false, active: activeId, error: 'unknown-mode' }
    if (next === activeId) return { ok: true, changed: false, active: activeId }

    const current = activeId === null ? null : modes.get(activeId) || null
    if (current && current.canDeactivate) {
      let allowed = false
      try {
        allowed = (await current.canDeactivate({ to: next, reason })) === true
      } catch (err) {
        console.warn('[workbench] canDeactivate failed (按拒绝处理):', err)
        allowed = false
      }
      if (!allowed) return { ok: false, changed: false, active: activeId, error: 'deactivate-refused' }
    }

    const from = activeId
    activeId = next
    const fromLabel = from ? resolveLabel(from) : ''
    if (current?.onDeactivate) {
      try {
        current.onDeactivate({ to: next, reason, from })
      } catch (err) {
        console.warn('[workbench] onDeactivate failed:', err)
      }
    }
    const target = next === null ? null : modes.get(next)
    if (target?.onActivate) {
      try {
        target.onActivate({ from, reason, fromLabel })
      } catch (err) {
        console.warn('[workbench] onActivate failed:', err)
      }
    }
    notify()
    persist()
    return { ok: true, changed: true, active: activeId }
  }

  /**
   * 从 host 状态恢复（启动时用）：**不**过关闭守卫（此刻还没有"正在编辑"这回事），
   * 也不写回 host（避免自激）。目标模式不存在时保持 null。
   */
  function adopt(id) {
    const next = id === null || id === undefined ? null : String(id).trim()
    if (next !== null && !modes.has(next)) return { ok: false, changed: false, active: activeId, error: 'unknown-mode' }
    if (next === activeId) return { ok: true, changed: false, active: activeId }
    activeId = next
    const target = next === null ? null : modes.get(next)
    if (target?.onActivate) {
      try {
        target.onActivate({ from: null, reason: 'restore' })
      } catch (err) {
        console.warn('[workbench] onActivate(restore) failed:', err)
      }
    }
    notify()
    return { ok: true, changed: true, active: activeId }
  }

  return { registerMode, list, setActive, adopt, getActive, has, size, subscribe, resolveLabel }
}
