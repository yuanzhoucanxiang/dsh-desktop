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
const HEALTH_STATES = new Set(['ready', 'starting', 'down', 'error'])
const HEALTH_TIMEOUT_MS = 3000
const HEALTH_CACHE_MS = 2000

/** 助手模块窗口（`splice.assistant`）的默认宽度与下限；壳侧仍会按屏幕夹一次（2026-10-13）。 */
const MODULE_ASSISTANT_DEFAULT = 360
const MODULE_ASSISTANT_MIN = 260

/**
 * 外部工具型模式的三个可选面（宪法第十六～二十条）：
 * - runtime.probe 必须有界、绝不抛；start/subscribe 可选
 * - jobs.list 必须有；cancel 可选（不能取消就别实现）
 * - artifacts.list 必须有；open 可选
 * 这里只做**结构归一**，不替模式探测/轮询。
 */
function normalizeRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object' || typeof runtime.probe !== 'function') return null
  return {
    probe: runtime.probe,
    start: typeof runtime.start === 'function' ? runtime.start : null,
    subscribe: typeof runtime.subscribe === 'function' ? runtime.subscribe : null,
  }
}

function normalizeJobs(jobs) {
  if (!jobs || typeof jobs !== 'object' || typeof jobs.list !== 'function') return null
  return {
    list: jobs.list,
    cancel: typeof jobs.cancel === 'function' ? jobs.cancel : null,
    subscribe: typeof jobs.subscribe === 'function' ? jobs.subscribe : null,
  }
}

function normalizeArtifacts(artifacts) {
  if (!artifacts || typeof artifacts !== 'object' || typeof artifacts.list !== 'function') return null
  return {
    list: artifacts.list,
    open: typeof artifacts.open === 'function' ? artifacts.open : null,
  }
}

function normalizeHealth(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const state = HEALTH_STATES.has(value.state) ? value.state : 'error'
  return {
    state,
    detail: value.detail === undefined || value.detail === null ? '' : String(value.detail),
    version: value.version === undefined || value.version === null ? null : String(value.version),
  }
}

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
    // 辅助坞视图（L2，可选）：别的模式当主视图时，工具台可以在右缘把这份"轻视图"显示出来。
    // 组件引用是**运行时传过来的值**（不是 import 别的插件），所以不违反内核的 bundle 纯净门禁。
    dock:
      descriptor.dock && typeof descriptor.dock === 'object' && descriptor.dock.view
        ? {
            label: descriptor.dock.label,
            view: descriptor.dock.view,
            order: Number.isFinite(descriptor.dock.order) ? Number(descriptor.dock.order) : 100,
          }
        : null,
    // 主屏瓷砖视图（L2 主屏，可选）：进入工具台主屏时，右侧瓷砖格里渲染这份「主要内容窗口」。
    // 与 dock 并立：dock 是别人当主视图时的右缘轻视图，tile 是主屏里的内容窗口；同为运行时组件引用。
    tile:
      descriptor.tile && typeof descriptor.tile === 'object' && descriptor.tile.view
        ? {
            label: descriptor.tile.label,
            view: descriptor.tile.view,
            order: Number.isFinite(descriptor.tile.order) ? Number(descriptor.tile.order) : 100,
          }
        : null,
    // **拼接视图**（2026-10-13，用户拍板 A）：比 dock 重——拼到长条右侧时要的是模式的**完整界面**，
    // 不是"顺眼看一下"的轻视图。两种给法，二选一：
    //   · `mount(container)`：模式把自己的界面渲染进工具台给的容器（portal / 挂 DOM 都行），
    //     返回 dispose（收起拼接时调用）。**单实例模式（如写作台）走这条**——它有自己的 React 根
    //     与编辑会话，再挂一份会打架（坞视图注释里就写着这条教训）。
    //   · `view`：直接给运行时组件引用（可自由重挂的模式走这条）。
    // `assistant`（可选，2026-10-13 用户："左边是写作模式的 agent 对话窗口——我说的是「写作助手」"）：
    // 声明"这个模式还需要一块**助手对话窗口**"（壳会把它排在长条**左侧**，`kind=assistant`）。
    // 模式自己在那个窗口里按 URL 片段渲染助手界面，所以这里只需要一个宽度。
    splice:
      descriptor.splice &&
      typeof descriptor.splice === 'object' &&
      (typeof descriptor.splice.mount === 'function' || descriptor.splice.view)
        ? {
            label: descriptor.splice.label,
            mount: typeof descriptor.splice.mount === 'function' ? descriptor.splice.mount : null,
            view: descriptor.splice.view || null,
            // **模式自己说要多宽**（可选）：写作台那种按宽窗设计的界面在 420px 里会被裁，
            // 所以让它自己声明期望宽度；壳侧仍会按屏幕夹到合法区间（2026-10-13 实机看上裁剪后加）。
            width: Number.isFinite(descriptor.splice.width)
              ? Math.max(280, Math.min(1200, Math.round(descriptor.splice.width)))
              : null,
            // 助手窗口（可选）：真值即"这个模式要一块助手对话窗口"，宽度可声明（默认 360）
            assistant:
              descriptor.splice.assistant && typeof descriptor.splice.assistant === 'object'
                ? {
                    width: Number.isFinite(descriptor.splice.assistant.width)
                      ? Math.max(MODULE_ASSISTANT_MIN, Math.min(1200, Math.round(descriptor.splice.assistant.width)))
                      : MODULE_ASSISTANT_DEFAULT,
                  }
                : descriptor.splice.assistant === true
                  ? { width: MODULE_ASSISTANT_DEFAULT }
                  : null,
            order: Number.isFinite(descriptor.splice.order) ? descriptor.splice.order : 100,
          }
        : null,
    // 交接接收端（可选）：别的模式把一份不透明载荷交给它时调用。没有这个钩子的模式收到交接
    // 会被如实标成 delivered:false（工具台不替它假装收到了）。
    onHandoff: typeof descriptor.onHandoff === 'function' ? descriptor.onHandoff : null,
    // 外部工具型模式的三面（Blender / ComfyUI 这类）：只登记，不代管进程（宪法第十八条）。
    runtime: normalizeRuntime(descriptor.runtime),
    jobs: normalizeJobs(descriptor.jobs),
    artifacts: normalizeArtifacts(descriptor.artifacts),
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
    hasDock: mode.dock !== null,
    hasTile: mode.tile !== null,
    // 能不能拼（2026-10-13）：给 splice 视图的模式优先，退而求其次用坞视图（旧的"轻视图"路径）。
    hasSplice: mode.splice !== null,
    // 外部工具型：有没有后端/任务/产物面（具体状态要异步 probe / 读 list，不在这里编）
    hasRuntime: mode.runtime !== null,
    hasJobs: mode.jobs !== null,
    hasArtifacts: mode.artifacts !== null,
  }
}

function sortModes(modes) {
  return [...modes].sort((a, b) => (a.order === b.order ? a.id.localeCompare(b.id, 'en') : a.order - b.order))
}

export function createRegistry(options = {}) {
  const onPersist = typeof options.onPersist === 'function' ? options.onPersist : null
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const modes = new Map()
  const listeners = new Set()
  const healthCache = new Map()
  let activeId = null
  let lastHandoffRecord = null
  let revision = 0

  function notify() {
    revision += 1
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
    // 上下文变化要让 UI 跟着动：模式提供 subscribe 就挂上（工具台只做汇总与展示，不解释内容）。
    if (mode.context && typeof mode.context.subscribe === 'function') {
      try {
        mode.offContext = mode.context.subscribe(() => notify())
      } catch (err) {
        console.warn('[workbench] context.subscribe failed:', err)
      }
    }
    // 外部工具型：模式说后端/任务变了，工具台只**重新问一次**（probe 有 3s 界、有缓存），不替它轮询。
    if (mode.runtime && typeof mode.runtime.subscribe === 'function') {
      try {
        mode.offRuntime = mode.runtime.subscribe(() => {
          healthCache.delete(id)
          notify()
        })
      } catch (err) {
        console.warn('[workbench] runtime.subscribe failed:', err)
      }
    }
    if (mode.jobs && typeof mode.jobs.subscribe === 'function') {
      try {
        mode.offJobs = mode.jobs.subscribe(() => notify())
      } catch (err) {
        console.warn('[workbench] jobs.subscribe failed:', err)
      }
    }
    notify()
    return function unregister() {
      if (modes.get(id) !== mode) return
      modes.delete(id)
      try {
        mode.offContext?.()
      } catch (err) {
        console.warn('[workbench] context unsubscribe failed:', err)
      }
      try {
        mode.offRuntime?.()
      } catch (err) {
        console.warn('[workbench] runtime unsubscribe failed:', err)
      }
      try {
        mode.offJobs?.()
      } catch (err) {
        console.warn('[workbench] jobs unsubscribe failed:', err)
      }
      healthCache.delete(id)
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

  /**
   * 某个模式提供的辅助坞视图（L2）：`{ id, label, order, view }`；没提供 → null。
   * 工具台只负责把它挂到右缘、给标题与收展，视图内容完全归模式。
   */
  function dockViewOf(id) {
    const key = id === null || id === undefined ? null : String(id).trim()
    const mode = key === null ? null : modes.get(key)
    if (!mode || !mode.dock) return null
    return { id: mode.id, label: normalizeLabel(mode.dock.label) || mode.id, order: mode.dock.order, view: mode.dock.view }
  }

  /**
   * 某个模式提供的主屏瓷砖视图（L2 主屏）：`{ id, label, order, view }`；没提供 → null。
   * 工具台只负责把它摆进主屏瓷砖格、给标题与「进入」，视图内容完全归模式。
   */
  function tileViewOf(id) {
    const key = id === null || id === undefined ? null : String(id).trim()
    const mode = key === null ? null : modes.get(key)
    if (!mode || !mode.tile) return null
    return { id: mode.id, label: normalizeLabel(mode.tile.label) || mode.id, order: mode.tile.order, view: mode.tile.view }
  }

  /**
   * 某个模式提供的**拼接视图**（2026-10-13，用户拍板 A）：`{ id, label, mount, view }`；没提供 → null。
   * 工具台负责给容器、给标题与收起钮；**界面内容完全归模式**——`mount(container)` 那条路是给
   * 单实例模式用的（它把已有的 React 界面 portal 进容器，收起时调 dispose 让回来）。
   */
  function spliceViewOf(id) {
    const key = id === null || id === undefined ? null : String(id).trim()
    const mode = key === null ? null : modes.get(key)
    if (!mode || !mode.splice) return null
    return {
      id: mode.id,
      label: normalizeLabel(mode.splice.label) || mode.id,
      order: mode.splice.order,
      mount: mode.splice.mount,
      view: mode.splice.view,
      width: mode.splice.width,
      // 声明了"splice.assistant"的模式：拼接时**同时**开一块助手窗口（壳把它排长条左侧）
      assistant: mode.splice.assistant,
    }
  }

  /**
   * 当前上下文（工具台只做**汇总与展示**，不解释内容）：模式自己报"现在在做什么"
   * （作品/场景/产物），工具台把它显示在入口与切换器上。模式没报或报错 → null（不编造）。
   */
  function contextOf(id) {
    const key = id === null || id === undefined ? null : String(id).trim()
    const mode = key === null ? null : modes.get(key)
    if (!mode || !mode.context || typeof mode.context.get !== 'function') return null
    try {
      const value = mode.context.get()
      if (!value || typeof value !== 'object') return null
      return { ...value, mode: mode.id }
    } catch (err) {
      console.warn('[workbench] context.get failed:', err)
      return null
    }
  }

  /**
   * 交接载荷：**不透明**——工具台只保证结构（谁给的、什么种类、标题、正文/路径、引用、时间），
   * 不解释含义。这样"产物链"将来怎么变都不用改通道（用户 2026-10-11：产物链暂不定）。
   */
  function normalizePayload(payload, fallbackFrom) {
    const p = payload && typeof payload === 'object' ? payload : {}
    const str = (v) => (v === null || v === undefined ? null : String(v))
    return {
      from: String(p.from || fallbackFrom || ''),
      kind: String(p.kind || 'text'),
      title: p.title === undefined ? '' : String(p.title),
      text: typeof p.text === 'string' ? p.text : null,
      path: str(p.path),
      refs: Array.isArray(p.refs) ? p.refs.slice(0, 20) : [],
      at: now(),
    }
  }

  /**
   * 一键交接：把载荷交给另一个模式——**先切过去**（会过当前模式的关闭守卫），再调目标的 `onHandoff`。
   * 目标没实现 `onHandoff` 时如实返回 `delivered:false`（不假装送到）。
   */
  async function handoff(to, payload) {
    const targetId = String(to ?? '').trim()
    const target = modes.get(targetId)
    if (!target) return { ok: false, error: 'unknown-mode', to: targetId, active: activeId }
    const envelope = normalizePayload(payload, activeId)
    const switched = await setActive(targetId, 'handoff')
    if (!switched.ok) return { ok: false, error: switched.error || 'switch-failed', to: targetId, active: activeId }
    let delivered = false
    if (target.onHandoff) {
      try {
        target.onHandoff(envelope)
        delivered = true
      } catch (err) {
        console.warn('[workbench] onHandoff failed:', err)
      }
    }
    lastHandoffRecord = { ...envelope, to: targetId, delivered }
    notify()
    return { ok: true, delivered, to: targetId, active: activeId, envelope: lastHandoffRecord }
  }

  function lastHandoff() {
    return lastHandoffRecord
  }

  function getRevision() {
    return revision
  }

  /**
   * 后端健康（外部工具型，宪法第十六条）：**3 秒内有界、绝不抛**。
   * 结果进 2 秒缓存，避免每次渲染都 spawn 一次探测；模式自己 subscribe 时清缓存再问。
   * 没有 runtime 面的模式返回 null（不编造"就绪"）。
   */
  function healthOf(id) {
    const key = String(id ?? '').trim()
    const mode = modes.get(key)
    if (!mode || !mode.runtime) return null
    const cached = healthCache.get(key)
    if (cached && now() - cached.at < HEALTH_CACHE_MS) return cached.value
    let timer = null
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ state: 'down', detail: `probe timeout > ${HEALTH_TIMEOUT_MS}ms` }), HEALTH_TIMEOUT_MS)
    })
    return Promise.race([Promise.resolve().then(() => mode.runtime.probe()), timeout])
      .then((raw) => {
        const value = normalizeHealth(raw)
        healthCache.set(key, { at: now(), value })
        return value
      })
      .catch((err) => {
        const value = { state: 'error', detail: String(err?.message || err), version: null }
        healthCache.set(key, { at: now(), value })
        return value
      })
      .finally(() => {
        if (timer) clearTimeout(timer)
      })
  }

  /** 让模式自己拉起后端（宪法第十八条：工具台只调用并如实回报，不 spawn/kill）。 */
  async function startRuntime(id) {
    const key = String(id ?? '').trim()
    const mode = modes.get(key)
    if (!mode || !mode.runtime) return { ok: false, error: 'no-runtime' }
    if (!mode.runtime.start) return { ok: false, error: 'no-start' }
    try {
      const result = await mode.runtime.start()
      healthCache.delete(key)
      notify()
      return result && typeof result === 'object' ? result : { ok: true }
    } catch (err) {
      return { ok: false, error: String(err?.message || err) }
    }
  }

  /** 当前任务列表；模式抛错时返回空数组（UI 不编造"没有任务"以外的状态）。 */
  function jobsOf(id) {
    const key = String(id ?? '').trim()
    const mode = modes.get(key)
    if (!mode || !mode.jobs) return []
    try {
      const list = mode.jobs.list()
      return Array.isArray(list) ? list : []
    } catch (err) {
      console.warn('[workbench] jobs.list failed:', err)
      return []
    }
  }

  /** 取消任务；不能取消的模式如实返回 no-cancel（UI 据此不显示取消钮）。 */
  async function cancelJob(id, jobId) {
    const key = String(id ?? '').trim()
    const mode = modes.get(key)
    if (!mode || !mode.jobs) return { ok: false, error: 'no-jobs' }
    if (!mode.jobs.cancel) return { ok: false, error: 'no-cancel' }
    try {
      const result = await mode.jobs.cancel(jobId)
      notify()
      return result && typeof result === 'object' ? result : { ok: true }
    } catch (err) {
      return { ok: false, error: String(err?.message || err) }
    }
  }

  /** 最近产物句柄；只读 list，不搬文件（宪法第二十条）。 */
  function artifactsOf(id) {
    const key = String(id ?? '').trim()
    const mode = modes.get(key)
    if (!mode || !mode.artifacts) return []
    try {
      const list = mode.artifacts.list()
      return Array.isArray(list) ? list : []
    } catch (err) {
      console.warn('[workbench] artifacts.list failed:', err)
      return []
    }
  }

  /** 点产物跳回模式；没 open 或模式抛错都如实 false。 */
  function openArtifact(id, ref) {
    const key = String(id ?? '').trim()
    const mode = modes.get(key)
    if (!mode || !mode.artifacts || !mode.artifacts.open) return false
    try {
      mode.artifacts.open(ref)
      return true
    } catch (err) {
      console.warn('[workbench] artifacts.open failed:', err)
      return false
    }
  }

  return {
    registerMode,
    list,
    setActive,
    adopt,
    getActive,
    has,
    size,
    subscribe,
    resolveLabel,
    contextOf,
    handoff,
    lastHandoff,
    dockViewOf,
    tileViewOf,
    spliceViewOf,
    getRevision,
    healthOf,
    startRuntime,
    jobsOf,
    cancelJob,
    artifactsOf,
    openArtifact,
  }
}