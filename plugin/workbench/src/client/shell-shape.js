/**
 * 壳的「窗口形态」能力探测（2026-10-12 刀 2 接线）。
 *
 * 门面归插件、能力归壳：主窗收成"微信长条"是**外壳**的活（`main.js` 的
 * `shell:set-workbench-shape`，只收 `normal`/`strip`/`mini` 档位枚举，几何由主进程按显示器算，
 * 见 docs/plans/workbench-layer-v1.md §6.4.2）。这里只做两件事：
 *  ① **能力探测**——官方壳 / 老安装包 / 探针环境没有这些方法，缺席时返回 null，
 *     门面自动退回全屏主屏（§3.3 降级硬约束：不许把模式绑死在自研壳上）；
 *  ② 调用**永不抛**——形态请求失败不影响门面本身能用（把错误如实带回给调用方显示）。
 */

/** 桥在位则返回它，否则 null（`window.dshShell` 可能整个不存在）。 */
export function getShapeBridge(globalThisRef = typeof window === 'undefined' ? null : window) {
  const bridge = globalThisRef && globalThisRef.dshShell
  if (!bridge || typeof bridge.setWorkbenchShape !== 'function' || typeof bridge.getWorkbenchShape !== 'function') return null
  return bridge
}

/** 申请档位。桥缺席 → `{ok:false, error:'no-shell-bridge'}`；IPC 抛错 → 错误文本原样带回。 */
export async function requestShape(shape) {
  const bridge = getShapeBridge()
  if (!bridge) return { ok: false, error: 'no-shell-bridge' }
  try {
    const result = await bridge.setWorkbenchShape(shape)
    return result && typeof result === 'object' ? result : { ok: false, error: 'bad-response' }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) }
  }
}

/**
 * 申请**拼接宽度**（2026-10-13）：模式界面拼在长条旁边时窗口要跟着变宽。
 * 只说"要拼多宽"——`0` = 收起，或 280–760（越界由主进程夹住）；x/y/高度永远由壳算。
 * 桥上没有这个方法（老壳）→ 返回 `no-splice-bridge`，门面据此**不显示拼接区**（不许把界面画到窗口外）。
 */
export async function requestSplice(width) {
  const bridge = getShapeBridge()
  if (!bridge || typeof bridge.setWorkbenchSplice !== 'function') return { ok: false, error: 'no-splice-bridge' }
  try {
    const result = await bridge.setWorkbenchSplice(Number(width))
    return result && typeof result === 'object' ? result : { ok: false, error: 'bad-response' }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) }
  }
}

/** 壳支不支持拼接（老壳没有这个方法 → 拼接入口整个不出现）。 */
export function hasSpliceBridge(globalThisRef = typeof window === 'undefined' ? null : window) {
  const bridge = globalThisRef && globalThisRef.dshShell
  return Boolean(bridge && typeof bridge.setWorkbenchSplice === 'function')
}

/**
 * 读壳当前形态（用于**挂载时对账**：页面重载/插件重挂后主屏是关的，而壳可能还停在条状）。
 * 读不到就返回 null——对账失败不该影响门面能用。
 */
export async function readShape() {
  const bridge = getShapeBridge()
  if (!bridge) return null
  try {
    const state = await bridge.getWorkbenchShape()
    return state && typeof state === 'object' ? state : null
  } catch {
    return null
  }
}

/**
 * 顶栏 `⚙`：打开外壳的设置窗口（`shell:open-settings` 早就在 preload 上，工具台只是接上它）。
 * 能力探测：官方壳/老包没有这个方法就什么都不做（门面不因此崩）。
 */
export async function openSettings(globalThisRef = typeof window === 'undefined' ? null : window) {
  const bridge = globalThisRef && globalThisRef.dshShell
  if (!bridge || typeof bridge.openSettings !== 'function') return { ok: false, error: 'no-shell-bridge' }
  try {
    const result = await bridge.openSettings()
    return result && typeof result === 'object' ? result : { ok: true }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) }
  }
}

/**
 * `✕` 这一钮：只说"用户按了关闭"，**语义由壳里既有的关窗逻辑定**（`closeToTray` 开着就进托盘，
 * 关掉就是真关）。门面刻意不请求 quit/hide——那两条会把"关窗"变成"退出应用"，与拍板不符。
 */
export async function requestWindowClose(globalThisRef = typeof window === 'undefined' ? null : window) {
  const bridge = globalThisRef && globalThisRef.dshShell
  if (!bridge || typeof bridge.closeWorkbenchWindow !== 'function') return { ok: false, error: 'no-shell-bridge' }
  try {
    const result = await bridge.closeWorkbenchWindow()
    return result && typeof result === 'object' ? result : { ok: false, error: 'bad-response' }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) }
  }
}
