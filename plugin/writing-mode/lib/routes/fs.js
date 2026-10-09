/**
 * 文件系统浏览路由（2026-10-09）：`route=dirs`。
 *
 * 为什么需要它：设置里的「工作区（库根）」原先只能手打路径（"只能手打盘符，不够方便"）。
 * 桌面版（Electron 外壳）里我们用 preload 暴露的 `__DSH_DIRECTORY_PICKER__` 打开
 * 系统原生文件夹对话框；但那座桥只在官方桌面外壳里存在（自研壳、纯浏览器、远程浏览器
 * 都没有），所以这里补一个**只读的目录列举**能力，给内置文件夹浏览器兜底。
 *
 * 语义（只读，绝不创建/删除/写入）：
 *   GET ?route=dirs&path=<绝对路径>  → 列出该目录下的**子目录**（文件不列，选择器只选目录）
 *   GET ?route=dirs                  → Windows 列盘符；其它平台从 home 起
 * 失败不抛给调用方：not-a-directory / permission-denied 都如实回给 UI（作者要看到为什么）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { effectiveRoots } from '../store.js'
import { writeJson } from '../http.js'

/** 一次最多列这么多子目录（超大目录不拖垮面板；截断如实上报）。 */
const MAX_ENTRIES = 500

/** Windows 盘符探测（无依赖，不调用 wmic/PowerShell）。 */
function listDrives() {
  if (process.platform !== 'win32') return []
  const out = []
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c)
    const root = `${letter}:\\`
    try {
      if (fs.existsSync(root)) out.push({ name: root, path: root })
    } catch { /* 不可探测的盘符跳过 */ }
  }
  return out
}

/**
 * 常见落脚点（首页 / 桌面 / 文档）：一次点击就能到达，省掉逐级点进去。
 * 只回真实存在的目录。
 */
function quickPlaces() {
  const home = os.homedir()
  const candidates = [
    { name: '主目录', path: home },
    { name: '桌面', path: path.join(home, 'Desktop') },
    { name: '文档', path: path.join(home, 'Documents') },
  ]
  return candidates.filter((p) => {
    try { return p.path !== '' && fs.statSync(p.path).isDirectory() } catch { return false }
  })
}

/** `E:` / `E` 这类"只有盘符"的输入补上分隔符，避免 path.resolve 把它解释成该盘当前目录。 */
function normalizeInputPath(raw) {
  const text = String(raw || '').trim()
  if (text === '') return ''
  if (process.platform === 'win32' && /^[a-zA-Z]:$/.test(text)) return `${text}\\`
  if (process.platform === 'win32' && /^[a-zA-Z]$/.test(text)) return `${text}:\\`
  return path.resolve(text)
}

/** 列目录：只回子目录；符号链接/junction 指向目录的也算目录。 */
function listChildDirectories(dir) {
  const all = fs.readdirSync(dir, { withFileTypes: true })
  const dirs = []
  for (const entry of all) {
    const name = String(entry.name || '')
    // 系统噪音：回收站 / 卷影信息，选工作区时永远用不到
    if (name === '' || name.startsWith('$') || name === 'System Volume Information') continue
    let isDir = entry.isDirectory()
    if (!isDir && entry.isSymbolicLink()) {
      try { isDir = fs.statSync(path.join(dir, name)).isDirectory() } catch { isDir = false }
    }
    if (!isDir) continue
    dirs.push({ name, path: path.join(dir, name) })
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  const truncated = dirs.length > MAX_ENTRIES
  return { entries: truncated ? dirs.slice(0, MAX_ENTRIES) : dirs, total: dirs.length, truncated }
}

/** GET dirs：目录列举（内置文件夹浏览器的数据源）。 */
export async function getDirs({ res, url, cfg }) {
  const raw = url.searchParams.get('path') || ''
  const requested = normalizeInputPath(raw)
  const drives = listDrives()
  const places = quickPlaces()
  const roots = effectiveRoots(cfg).map((r) => ({ path: r.path, label: r.label, missing: Boolean(r.missing) }))
  const base = { ok: true, requested, drives, places, roots }

  // 空路径 = 起点：Windows 列盘符，其它平台直接进 home
  if (requested === '') {
    const home = os.homedir()
    if (process.platform !== 'win32') {
      try {
        const listed = listChildDirectories(home)
        writeJson(res, 200, { ...base, path: home, parent: path.dirname(home) === home ? null : path.dirname(home), ...listed })
      } catch (err) {
        writeJson(res, 200, { ...base, path: null, parent: null, entries: [], total: 0, truncated: false, error: String(err?.code || err?.message || err) })
      }
      return
    }
    writeJson(res, 200, { ...base, path: '', parent: null, entries: drives, total: drives.length, truncated: false })
    return
  }

  let stat = null
  try { stat = fs.statSync(requested) } catch { stat = null }
  if (stat === null || !stat.isDirectory()) {
    // 路径不存在：如实报，并把父目录回给 UI（作者可以往上退一级）
    const parent = path.dirname(requested)
    writeJson(res, 200, {
      ...base,
      path: null,
      parent: parent === requested ? null : parent,
      entries: [],
      total: 0,
      truncated: false,
      error: stat === null ? 'not-found' : 'not-a-directory',
    })
    return
  }

  try {
    const listed = listChildDirectories(requested)
    const parent = path.dirname(requested)
    writeJson(res, 200, {
      ...base,
      path: requested,
      parent: parent === requested ? null : parent,
      ...listed,
    })
  } catch (err) {
    const code = String(err?.code || err?.message || err)
    const parent = path.dirname(requested)
    writeJson(res, 200, {
      ...base,
      path: null,
      parent: parent === requested ? null : parent,
      entries: [],
      total: 0,
      truncated: false,
      error: code === 'EACCES' || code === 'EPERM' ? 'permission-denied' : code,
    })
  }
}
