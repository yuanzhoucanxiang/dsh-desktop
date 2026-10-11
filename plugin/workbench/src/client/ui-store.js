/**
 * 工具台 UI 状态（模块级，入口与浮层两个独立挂载点共用）。
 *
 * 入口在 `sidebar.footer.action`、切换器在 `shell.overlay`，是**两个不同的 React 根**，
 * 所以开关状态不能放组件里——沿用写作模式 state/mode-store.js 的做法：模块级 + 订阅广播。
 */

let open = false
let notice = null
/** 辅助坞（L2）：开合、宽度、显示哪个模式的视图。都是**临时 UI 状态**，按文档 §7.1 落 localStorage。 */
let dockOpen = false
let dockWidth = 340
let dockModeId = null
const listeners = new Set()

const LS_DOCK = 'dsh-workbench-dock'

function readDockLS() {
  try {
    const raw = localStorage.getItem(LS_DOCK)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (typeof parsed?.open === 'boolean') dockOpen = parsed.open
    if (Number.isFinite(parsed?.width)) dockWidth = Math.min(720, Math.max(240, Number(parsed.width)))
    if (typeof parsed?.modeId === 'string' || parsed?.modeId === null) dockModeId = parsed.modeId
  } catch {
    /* 读不到就用默认（坞是纯 UI 状态，不值得为它报错） */
  }
}
readDockLS()

function persistDock() {
  try {
    localStorage.setItem(LS_DOCK, JSON.stringify({ open: dockOpen, width: dockWidth, modeId: dockModeId }))
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

function emit() {
  for (const fn of [...listeners]) {
    try {
      fn()
    } catch (err) {
      console.warn('[workbench] ui listener failed:', err)
    }
  }
}

export function isOpen() {
  return open
}

export function setOpen(next) {
  const value = next === true
  if (open === value) return
  open = value
  emit()
}

export function toggleOpen() {
  setOpen(!open)
}

/** 通知出口（P0 只有切换器自己用；模式接入后统一走这里，见文档 §5.1）。 */
export function getNotice() {
  return notice
}

export function setNotice(next) {
  const value = next && next.text ? { kind: next.kind === 'warn' ? 'warn' : 'info', text: String(next.text) } : null
  notice = value
  emit()
}

export function subscribe(fn) {
  if (typeof fn !== 'function') return () => {}
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ── 辅助坞（L2）─────────────────────────────────────────────────────────

export function isDockOpen() {
  return dockOpen
}

export function setDockOpen(next) {
  const value = next === true
  if (dockOpen === value) return
  dockOpen = value
  persistDock()
  emit()
}

export function toggleDock() {
  setDockOpen(!dockOpen)
}

export function getDockWidth() {
  return dockWidth
}

export function setDockWidth(next) {
  const value = Math.min(720, Math.max(240, Number(next) || dockWidth))
  if (dockWidth === value) return
  dockWidth = value
  persistDock()
  emit()
}

export function getDockModeId() {
  return dockModeId
}

export function setDockModeId(next) {
  const value = next === null || next === undefined || next === '' ? null : String(next)
  if (dockModeId === value) return
  dockModeId = value
  persistDock()
  emit()
}
