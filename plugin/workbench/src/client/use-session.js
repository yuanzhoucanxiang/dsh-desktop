/**
 * 会话快照 / 遥测 / 状态条（2026-10-13 抽出来）——**长条与小条共用同一份数据**。
 *
 * 为什么抽：原型里小条（`.mini`）不是"少画点东西"，而是"**同一份状态数据**换个尺寸显示"；
 * 长条的状态条本来写在 `ConversationTile` 里，小条没渲染那个组件就自然没有状态数据。
 * 现在读取逻辑（快照、句柄投影订阅、格式化）在这里各一份，两处只负责摆位置。
 */
import * as react from 'react'
import { getSessions } from './runtime.js'
import { formatTelemetry, telemetryOf, watchSessionProjections } from './session-telemetry.js'

/** 读会话列表快照（防御：快照 Store 形状不符就返回 null，调用方如实显示）。 */
export function readSessionSnapshot(sessions) {
  try {
    const store = sessions?.list
    if (!store || typeof store.getSnapshot !== 'function') return null
    const snap = store.getSnapshot()
    if (!snap || !Array.isArray(snap.ids) || typeof snap.byId !== 'object' || !snap.byId) return null
    return snap
  } catch {
    return null
  }
}

/** 会话列表快照 + 第一条会话（内核按最近排序，第一条就是当前那条）。 */
export function useSessionSnapshot(sessions = getSessions()) {
  const [snap, setSnap] = react.useState(() => readSessionSnapshot(sessions))
  react.useEffect(() => {
    const store = sessions?.list
    if (!store || typeof store.subscribe !== 'function') return undefined
    const sync = () => setSnap(readSessionSnapshot(sessions))
    try {
      return store.subscribe(sync)
    } catch {
      return undefined
    }
  }, [sessions])
  const first = snap && snap.ids.length > 0 ? snap.byId[snap.ids[0]] : null
  const sessionId = snap && snap.ids.length > 0 ? snap.ids[0] : null
  return { sessions, snap, first, sessionId, running: Boolean(first?.running) }
}

/**
 * 状态条三指标：投影要**从会话句柄上读**（列表行那条 RPC 不带这三个键，见 session-telemetry.js 的注释）。
 * 环境没有 retain 能力（老内核 / 探针假宿主）→ 退回读列表行；两个都没有就是"还没数据"，不编造。
 */
export function useSessionTelemetry(sessions, sessionId) {
  const [values, setValues] = react.useState(null)
  const [source, setSource] = react.useState('no-session')
  react.useEffect(() => {
    const watch = watchSessionProjections(sessions, sessionId, setValues)
    setSource(watch.source)
    return watch.dispose
  }, [sessionId, sessions])
  return { metrics: formatTelemetry(telemetryOf(values)), source, values }
}

/**
 * 状态条（原型 `.meter`）：三指标 + 上下文进度条 + 模型名。长条与小条共用；
 * `compact` 只去掉进度条（小条 300×168 里塞不下），指标文案一个不改——**同一份数据**。
 */
export function TelemetryMeter({ metrics, source, values, compact = false }) {
  if (!metrics) return null
  return react.createElement(
    'div',
    {
      className: `dshWbMeter${compact ? ' is-compact' : ''}`,
      'data-wb-strip': '',
      'data-wb-meter': compact ? 'compact' : '',
      'data-wb-telemetry': source,
      // 自查用：句柄投影里**到底有哪些键**（真内核上一眼能分清"还没送到"与"根本没这个键"）
      'data-wb-telemetry-keys': Object.keys(values || {}).sort().join(','),
    },
    react.createElement('span', { className: 'dshWbMeterItem', title: metrics.speed.title, 'data-wb-metric': 'speed' }, metrics.speed.text),
    react.createElement('span', { className: 'dshWbMeterItem', title: metrics.cache.title, 'data-wb-metric': 'cache' }, metrics.cache.text),
    react.createElement('span', { className: 'dshWbMeterItem', title: metrics.context.title, 'data-wb-metric': 'context' }, metrics.context.text),
    compact
      ? null
      : react.createElement(
          'span',
          { className: 'dshWbMeterBar', 'data-wb-meter-bar': '', title: metrics.context.title, 'aria-hidden': 'true' },
          react.createElement('i', {
            style: { width: `${Math.round((metrics.context.ratio || 0) * 100)}%` },
            'data-wb-meter-fill': String(Math.round((metrics.context.ratio || 0) * 100)),
          }),
        ),
    metrics.model
      ? react.createElement('span', { className: 'dshWbMeterModel', title: metrics.model.title, 'data-wb-metric': 'model' }, metrics.model.text)
      : null,
  )
}
