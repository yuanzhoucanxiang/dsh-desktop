/**
 * 选择电脑文件夹（2026-10-09）。
 *
 * 两条路，按可用性自动选：
 *   1. **原生**：官方桌面外壳（Electron）的 preload 在页面主世界暴露了
 *      `window.__DSH_DIRECTORY_PICKER__ = { pick() }`（`app.asar/lib/preload-app.cjs`），
 *      背后是主进程的 `dialog.showOpenDialog(win, { properties:['openDirectory','createDirectory'] })`
 *      —— 与官方「添加工作区」用的是同一个系统对话框；取消回 `null`。
 *   2. **内置**：自研壳 / 纯浏览器 / 远程浏览器没有那座桥，退回插件自己的只读目录列举
 *      （host `route=dirs`）+ 面板内的文件夹浏览器。作者照样"点着选"，不用手打盘符。
 */
import { api } from './writing-api.js'

/** 原生桥（没有则 null；不抛异常，contextBridge 对象读取失败也要安全）。 */
export function nativePicker() {
  try {
    const bridge = typeof globalThis === 'undefined' ? null : globalThis.__DSH_DIRECTORY_PICKER__
    return bridge && typeof bridge.pick === 'function' ? bridge : null
  } catch {
    return null
  }
}

export function hasNativePicker() {
  return nativePicker() !== null
}

/**
 * 打开系统原生文件夹对话框。
 * @returns {Promise<{ok: true, path: string|null} | {ok: false, reason: string}>}
 *   `path: null` = 作者取消（不是错误）。
 */
export async function pickFolderNative() {
  const bridge = nativePicker()
  if (bridge === null) return { ok: false, reason: 'no-native' }
  try {
    const picked = await bridge.pick()
    if (typeof picked !== 'string' || picked.trim() === '') return { ok: true, path: null }
    return { ok: true, path: picked }
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err || 'native-picker-failed') }
  }
}

/**
 * 内置浏览器的一次目录列举（只读，绝不写盘）。
 * @param {string} dirPath 空字符串 = 起点（Windows 列盘符，其它平台进 home）
 * @returns {Promise<{ok: boolean, error?: string, path?: string|null, parent?: string|null,
 *   entries?: Array<{name: string, path: string}>, drives?: Array<{name: string, path: string}>,
 *   places?: Array<{name: string, path: string}>, roots?: Array<{path: string, label: string}>,
 *   total?: number, truncated?: boolean}>}
 */
export async function listDirs(dirPath) {
  const query = dirPath ? { path: String(dirPath) } : undefined
  const out = await api('dirs', { method: 'GET', headers: { accept: 'application/json' } }, query)
  if (!out || out.ok !== true) {
    return { ok: false, error: String((out && out.error) || 'invalid-response') }
  }
  return out
}
