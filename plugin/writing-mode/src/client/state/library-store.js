/**
 * 作品库 store：把分散在 App / 会话列表 / 设置面板里的 api('config') 取数收编成一份缓存 + 失效广播。
 *
 * 约定（与 mode-store / prefs-store 同构，不依赖 React）：
 * - 只有刷新成功（data.ok）才替换缓存并广播；失败保留旧缓存，调用方拿到 false。
 *   取数失败的静默语义因此由 store 承担：已经显示的文件树/会话列表不会闪回空态。
 * - 同一时刻只允许一次在途请求：多处同时挂载时复用同一个 Promise，不打三发。
 * - activeRoot 解析顺序与旧 refreshTree 逐字一致（config.activeRoot → 默认且存在的 root → 第一个 root → null）。
 * - 缓存只在成功时整体替换（新对象），订阅方可以直接 setState / useSyncExternalStore。
 */
import { api } from '../services/writing-api.js'

const EMPTY = { roots: [], tree: [], activeRoot: null, companions: null, loadedAt: 0 }
let cache = { ...EMPTY }
let lastError = ''
let inflight = null
const listeners = new Set()

export function getLibrary() {
  return cache
}

export function subscribeLibrary(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 上一次刷新失败的原因（成功即清空）。只读、不参与缓存——失败时缓存必须原样保留。 */
export function getLibraryError() {
  return lastError
}

export function refreshLibrary() {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const data = await api('config')
      if (!data || !data.ok) {
        lastError = String((data && data.error) || 'unknown')
        return false
      }
      const roots = data.roots || []
      cache = {
        roots,
        tree: data.tree || [],
        activeRoot:
          (data.config && data.config.activeRoot) ||
          roots.find((r) => r.default && !r.missing)?.path ||
          roots[0]?.path ||
          null,
        companions: (data.config && data.config.companions) || {},
        loadedAt: Date.now(),
      }
      lastError = ''
      for (const fn of listeners) {
        try {
          fn()
        } catch {}
      }
      return true
    } catch (err) {
      lastError = String((err && err.message) || err)
      return false
    } finally {
      inflight = null
    }
  })()
  return inflight
}
