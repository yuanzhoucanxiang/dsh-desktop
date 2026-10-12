/**
 * 会话遥测读数（2026-10-12）：把主屏那条窄条从"演示用的假数字"换成内核真投影。
 *
 * 数据源全部**已核实**（内核 0.2.0-rc.2，只读调查，见 logs/2026-10-12.md）：
 *  - `sessionStats`：`decodeMs` / `decodeTokens` → tok/s，官方 Web 聊天统计条同一算法
 *    （`dsh-client-ui-chat/lib/client.js:7004`：`decodeTokens / (decodeMs / 1e3)`）；
 *  - `tokenUsage.totals`：`uncachedInputTokens` / `cacheReadTokens` / `cacheWriteTokens` → 缓存命中率，
 *    分母取 prompt 侧输入之和（等价于官方的 `totalTokens - outputTokens` 口径，`formatCacheHitPercent`）；
 *  - `contextPressure`：`pressureTokens` / `contextWindow` → 上下文占用（官方环表 `ContextMeter` 同源）。
 * **入口是会话句柄，不是列表行**（2026-10-12 刀 3b 实证：`session.projections` 那条 RPC 的响应
 * schema 里根本没有这三个键，所以"读列表行 + 主动刷一次"这条路在真机上永远算不出）——
 * 真路径见下面 `watchSessionProjections()`；只有环境没有 retain/binding 时才退回读列表行的
 * `projectionValues`（老内核、探针假宿主）。
 *
 * 纪律：投影字段**全是可选**——算不出来就返回 null 并如实说明，**绝不拿 0 冒充"没有"、绝不编造**。
 */

/** 投影值是不是一个能读的对象（形状不符就当没有）。 */
function asObject(value) {
  return value && typeof value === 'object' ? value : null
}

/**
 * `tokenUsage` 的**客户端形状是扁平的**（2026-10-12 真内核实测：
 * `{uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens}`），
 * 而 host 侧的 durable state 才是 `{totals, last}`。两种都认，读不到再算没有——
 * 只按其中一种写会静默算不出命中率（就是这么被抓到的）。
 */
function usageOf(values) {
  return asObject(values?.tokenUsage?.totals) || asObject(values?.tokenUsage)
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 从会话服务列表快照里取某条会话的投影值；读不到 → null。 */
export function projectionValuesOf(sessions, sessionId) {
  if (!sessions || !sessionId) return null
  try {
    const snap = sessions.list?.getSnapshot?.()
    const record = snap?.byId?.[sessionId]
    return asObject(record?.projectionValues)
  } catch {
    return null
  }
}

/** 三个指标各算各的；任何一项算不出来就是 null（不是 0）。 */
export function telemetryOf(values) {
  const v = asObject(values)
  const stats = asObject(v?.sessionStats)
  const usage = usageOf(v)
  const pressure = asObject(v?.contextPressure)

  const decodeMs = num(stats?.decodeMs)
  const decodeTokens = num(stats?.decodeTokens)
  const tokensPerSecond = decodeMs && decodeMs > 0 && decodeTokens !== null ? decodeTokens / (decodeMs / 1000) : null

  const cacheRead = num(usage?.cacheReadTokens) ?? 0
  const promptInput = (num(usage?.uncachedInputTokens) ?? 0) + cacheRead + (num(usage?.cacheWriteTokens) ?? 0)
  const cacheHitPercent = usage && promptInput > 0 ? (cacheRead / promptInput) * 100 : null

  const pressureTokens = num(pressure?.pressureTokens)
  const contextWindow = num(pressure?.contextWindow)
  const contextPercent =
    pressureTokens !== null && contextWindow && contextWindow > 0 ? (pressureTokens / contextWindow) * 100 : null

  return { tokensPerSecond, cacheHitPercent, contextPercent, pressureTokens, contextWindow }
}

/**
 * 订阅一条会话的投影。**真路径是会话句柄**：`sessions.retain(id, {source})` →
 * `sessions.binding(id).session.projections`（照 mode-kit 的既有写法）。
 * 为什么不能只读列表行：`session.projections` 那条 RPC 的响应 schema 里**没有**
 * `tokenUsage` / `sessionStats` / `contextPressure`（2026-10-12 实证：
 * `dsh-api-session-controller/lib/typert.remote-client.js` 的 projections 响应只带
 * title/inbox/sessionListMetadata/subagentCatalog 这类键），所以列表行永远拿不到这三个数。
 *
 * 返回 `{ source, dispose }`，`source` 用来说清走到哪一步（UI 挂成 `data-wb-telemetry`，
 * 实机一眼能看出是"没会话/没 retain 能力/句柄没投影/真的读到了"）：
 *   `retained`   走会话句柄（真内核的正常路径）
 *   `list-row`   环境没有 retain/binding（老内核、探针假宿主）→ 退回读列表行
 *   `no-store`   retain 成功但句柄上没有 projections → 已 release，不泄漏引用
 *   `no-session` 压根没有会话可看
 */
export function watchSessionProjections(sessions, sessionId, onChange) {
  const noop = () => {}
  if (!sessions || !sessionId) return { source: 'no-session', dispose: noop }
  if (typeof sessions.retain !== 'function' || typeof sessions.binding !== 'function') {
    onChange(projectionValuesOf(sessions, sessionId))
    return { source: 'list-row', dispose: noop }
  }
  let ref = null
  try {
    ref = sessions.retain(sessionId, { source: 'mainView' })
  } catch {
    onChange(projectionValuesOf(sessions, sessionId))
    return { source: 'list-row', dispose: noop }
  }
  const store = sessions.binding?.(sessionId)?.session?.projections
  if (!store || typeof store.values !== 'function') {
    try {
      ref?.release?.()
    } catch {}
    return { source: 'no-store', dispose: noop }
  }
  const sync = () => {
    try {
      onChange(store.values())
    } catch {
      /* 投影 Store 抛错就当没读到 */
    }
  }
  sync()
  let off = null
  try {
    off = typeof store.subscribeAny === 'function' ? store.subscribeAny(sync) : null
  } catch {
    off = null
  }
  return {
    source: 'retained',
    dispose() {
      try {
        if (typeof off === 'function') off()
      } catch {}
      try {
        ref?.release?.()
      } catch {}
    },
  }
}

function round(value, digits = 0) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * 三条文案：算得出来给数字 + 单位；算不出来给"还没有"+**原因**（guide §5：状态要有具体原因，
 * 不能只靠颜色，也不能留一句没有出路的空话）。
 */
export function formatTelemetry(t) {
  const speed =
    t?.tokensPerSecond !== null && t?.tokensPerSecond !== undefined
      ? { text: `⚡ ${round(t.tokensPerSecond)} tok/s`, title: '解码速度：输出 token ÷ 解码墙钟时间（内核 sessionStats 投影）' }
      : { text: '⚡ 还没数据', title: '这条会话还没有流式输出过，所以算不出解码速度' }
  const cache =
    t?.cacheHitPercent !== null && t?.cacheHitPercent !== undefined
      ? { text: `缓存 ${round(t.cacheHitPercent)}%`, title: '缓存命中率：命中的输入 token ÷ 全部输入 token（内核 tokenUsage 投影）' }
      : { text: '缓存 还没数据', title: '这条会话还没有带用量的请求，所以算不出命中率' }
  const context =
    t?.contextPercent !== null && t?.contextPercent !== undefined
      ? {
          text: `上下文 ${round(t.contextPercent)}%`,
          title: `占用 ${t.pressureTokens} / 窗口 ${t.contextWindow} token（内核 contextPressure 投影）`,
        }
      : { text: '上下文 未上报', title: '内核还没给出这条会话的上下文占用或窗口大小，所以不显示百分比' }
  return { speed, cache, context }
}
