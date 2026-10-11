/**
 * 写作模式客户端模块（P1 从 entry.js 搬迁；行为不变）。
 */

/** 开关持久化的 localStorage 键（原先在 entry 里；随本模块一起搬来，必须在 readActiveLS 调用之前声明）。 */
const LS_KEY = 'dsh-writing-mode-active'

export function applyBodyAttr(active) {
  try {
    if (active) document.documentElement.setAttribute('data-writing-mode', 'on')
    else {
      document.documentElement.removeAttribute('data-writing-mode')
      document.body.removeAttribute('data-writing-focus')
      document.body.removeAttribute('data-writing-lib')
    }
  } catch {}
}

/* ── 模块级开关（overlay 与侧栏入口共用）── */
export function readActiveLS() {
  try {
    return localStorage.getItem(LS_KEY) === '1'
  } catch {
    return false
  }
}
export let modeActive = readActiveLS()
let closeGuard = null

/** 关闭守卫由写作台自己注册（`WritingModeApp`）：正在编辑时切走要先过它。 */
export function setCloseGuard(fn) { closeGuard = fn }

/**
 * 问一次守卫"能不能走"——**纯判定，不改状态**；守卫抛错按拒绝处理（绝不"因为守卫坏了就放行"）。
 *
 * 工具台接入（2026-10-11）后用它做模式的 `canDeactivate`：这样"要不要拦"与"谁改状态"分开，
 * 守卫对一次切换只会被问**一次**（工具台问 → 允许则调 onDeactivate → 用 commitModeActive 落状态）。
 */
export async function askCloseGuard() {
  if (!closeGuard) return true
  try {
    return (await closeGuard()) !== false
  } catch {
    return false
  }
}

export const modeListeners = new Set()
export function setModeActive(next) {
  if (!next && modeActive && closeGuard) {
    void askCloseGuard().then((ok) => { if (ok) commitModeActive(false) })
    return
  }
  commitModeActive(next)
}
export function commitModeActive(next) {
  if (modeActive === next) return
  modeActive = next
  try {
    localStorage.setItem(LS_KEY, next ? '1' : '0')
  } catch {}
  applyBodyAttr(next)
  for (const fn of modeListeners) {
    try {
      fn()
    } catch {}
  }
}
export function subscribeMode(fn) {
  modeListeners.add(fn)
  return () => modeListeners.delete(fn)
}
export function getModeActive() {
  return modeActive
}
