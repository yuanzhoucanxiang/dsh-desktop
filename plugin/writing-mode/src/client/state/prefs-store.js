/**
 * 写作模式客户端模块（P1 从 entry.js 搬迁；行为不变）。
 */
import { api } from '../services/writing-api.js'

export function versionOf(name) {
  const m = String(name || '').match(/-v(\d+)(\.[^.]+)?$/i)
  return m ? Number(m[1]) : null
}

export const DEFAULT_PREFS = {
  fontSize: 17,
  lineHeight: 1.95,
  autoSaveMs: 800,
  autoGate: true,
  aiMode: 'harness',
  aiProvider: 'deepseek-official',
  aiModel: 'deepseek-v4-flash',
  aiApiKey: '',
}
export let prefsCache = { ...DEFAULT_PREFS }
export const prefsListeners = new Set()
export function getPrefs() {
  return prefsCache
}
export function subscribePrefs(fn) {
  prefsListeners.add(fn)
  return () => prefsListeners.delete(fn)
}
export function notifyPrefs() {
  for (const fn of prefsListeners) {
    try {
      fn()
    } catch {}
  }
}
export function applyPrefsCss(p) {
  try {
    const el = document.documentElement
    el.style.setProperty('--dsh-wm-font-size', String(p.fontSize) + 'px')
    el.style.setProperty('--dsh-wm-line-height', String(p.lineHeight))
  } catch {}
}
export async function loadPrefs() {
  try {
    const data = await api('config')
    if (data.ok && data.prefs) {
      prefsCache = { ...DEFAULT_PREFS, ...data.prefs }
      applyPrefsCss(prefsCache)
      notifyPrefs()
    }
  } catch {}
  return prefsCache
}
export async function savePrefs(patch) {
  prefsCache = { ...prefsCache, ...patch }
  applyPrefsCss(prefsCache)
  notifyPrefs()
  try {
    await api('prefs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
  } catch {}
  return prefsCache
}
// 启动时预取一次
if (typeof window !== 'undefined') {
  void loadPrefs()
}
