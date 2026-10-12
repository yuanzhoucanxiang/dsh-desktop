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
