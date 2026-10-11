/**
 * 工具台 UI 状态（模块级，入口与浮层两个独立挂载点共用）。
 *
 * 入口在 `sidebar.footer.action`、切换器在 `shell.overlay`，是**两个不同的 React 根**，
 * 所以开关状态不能放组件里——沿用写作模式 state/mode-store.js 的做法：模块级 + 订阅广播。
 */

let open = false
let notice = null
const listeners = new Set()

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
