/**
 * 工具台状态文件：`$DSH_HOME/workbench.json`。
 *
 * 只存**跨模式共享的**东西：当前激活模式、最近打开、schema 版本、单调 revision。
 * 模式自己的配置一律不在这里（写作模式有 `writing-mode.json`，GIR 走内核 settings 命名空间 `gir`）。
 *
 * 损坏语义照本项目既定纪律（plugin/writing-mode/CONTRACT.md §"配置文件损坏 ≠ 不存在"）：
 *   - 只有 ENOENT 才当"空状态"；
 *   - 解析失败时**保留损坏原件字节**（`.damaged-<ts>` 副本）、如实报错，并拒绝任何回写——
 *     否则一次"切个模式"就会把 activeModeId/最近项静默清零。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const STATE_NAME = 'workbench.json'
export const SCHEMA_VERSION = 1
/** 最近打开最多记这么多条（超出丢最旧）。 */
export const MAX_RECENT = 12

export function dshHome() {
  return process.env.DSH_DESKTOP_HOME || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

export function stateFile() {
  return path.join(dshHome(), STATE_NAME)
}

export function defaultState() {
  return { version: SCHEMA_VERSION, revision: 0, activeModeId: null, recent: [] }
}

function asModeId(value) {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

function normalizeRecent(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const modeId = asModeId(item.modeId)
    const id = item.id === null || item.id === undefined ? null : String(item.id)
    if (!modeId || !id) continue
    out.push({
      modeId,
      id,
      title: item.title === null || item.title === undefined ? '' : String(item.title),
      path: item.path === null || item.path === undefined ? null : String(item.path),
      at: Number.isFinite(item.at) ? Number(item.at) : 0,
    })
    if (out.length >= MAX_RECENT) break
  }
  return out
}

function normalize(parsed) {
  const revision = Number.isFinite(parsed.revision) && parsed.revision >= 0 ? Math.floor(parsed.revision) : 0
  return {
    version: SCHEMA_VERSION,
    revision,
    activeModeId: asModeId(parsed.activeModeId),
    recent: normalizeRecent(parsed.recent),
  }
}

/** 损坏原件另存一份（绝不覆盖已有副本），返回副本路径。 */
function backupDamaged(file, raw) {
  try {
    const backup = `${file}.damaged-${Date.now()}`
    fs.writeFileSync(backup, raw, 'utf8')
    return backup
  } catch {
    return null
  }
}

function damaged(raw, file, error) {
  return {
    ...defaultState(),
    __damaged: true,
    configError: error,
    configBackup: raw === null ? null : backupDamaged(file, raw),
  }
}

/**
 * 读状态。返回值总是**可用**的（损坏时回默认值 + `__damaged` 标记），
 * 调用方据此决定能不能写。
 */
export function readState() {
  const file = stateFile()
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ...defaultState(), __missing: true }
    return { ...defaultState(), __damaged: true, configError: 'config-read-failed', configDetail: String(err?.message || err), configBackup: null }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return damaged(raw, file, 'corrupt-config')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return damaged(raw, file, 'corrupt-config')
  return normalize(parsed)
}

/** 原子替换（同目录 tmp + rename）：内核/另一实例读到的永远是完整文件。 */
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, text, 'utf8')
  try {
    fs.renameSync(tmp, file)
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }) } catch {}
    throw err
  }
}

/**
 * 读-改-写（单进程内同步完成）。patch 支持的键：`activeModeId`、`recent`。
 * - 损坏状态：抛 `config-damaged-refused`（不覆盖原件）
 * - 期望 revision 不匹配：抛 `revision-conflict`（带上当前 revision）
 */
export function updateState(patch = {}) {
  const current = readState()
  if (current.__damaged) {
    const err = new Error('状态文件已损坏，原件已保留且未被覆盖；恢复 workbench.json 后才能再改')
    err.code = current.configError === 'config-read-failed' ? 'config-read-failed' : 'config-damaged-refused'
    err.backup = current.configBackup || null
    throw err
  }
  if (patch.baseRevision !== undefined && patch.baseRevision !== null && Number(patch.baseRevision) !== current.revision) {
    const err = new Error('状态已被其它窗口改写')
    err.code = 'revision-conflict'
    err.revision = current.revision
    throw err
  }
  const next = {
    version: SCHEMA_VERSION,
    revision: current.revision + 1,
    activeModeId: 'activeModeId' in patch ? asModeId(patch.activeModeId) : current.activeModeId,
    recent: 'recent' in patch ? normalizeRecent(patch.recent) : current.recent,
  }
  writeAtomic(stateFile(), `${JSON.stringify(next, null, 2)}\n`)
  return next
}

/** 最近项去重上浮（同一 modeId+id 只留最新一次）。 */
export function mergeRecent(recent, entry) {
  const list = normalizeRecent(recent).filter((it) => !(it.modeId === entry.modeId && it.id === entry.id))
  list.unshift({ modeId: entry.modeId, id: entry.id, title: entry.title ?? '', path: entry.path ?? null, at: entry.at ?? Date.now() })
  return list.slice(0, MAX_RECENT)
}
