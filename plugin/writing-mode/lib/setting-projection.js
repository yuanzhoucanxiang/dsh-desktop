/**
 * 世界观设定可读稿投影（方案 §5）。
 * 目标固定：bible/世界观整理.md —— 不接管作者手写的 bible/world.md 等。
 * 不调用模型；只做确定性 Markdown 生成与 hash/冲突判定。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { settingInjectText } from './world-setting.js'

export const PROJECTION_REL = 'bible/世界观整理.md'
export const PROJECTION_NOTE = '由已确认设定生成 · 请勿在本文件手写后期待自动合并'

export function projectionError(code, status = 400) {
  return Object.assign(new Error(code), { status, code })
}

export function hashText(text) {
  return createHash('sha256').update(Buffer.from(String(text), 'utf8')).digest('hex')
}

export function projectDirOf(libraryProjectDir) {
  return path.join(libraryProjectDir, PROJECTION_REL)
}

/** 从已确认 world 设定生成 Markdown（确定性顺序：确认时间/标题/id）。 */
export function renderSettingProjection(items, meta = {}) {
  const list = (items || [])
    .filter((it) => it && it.kind === 'fact' && it.status === 'confirmed' && it.setting && it.setting.type === 'world')
    .slice()
    .sort((a, b) => {
      const ta = a.confirmedAt || a.updatedAt || ''
      const tb = b.confirmedAt || b.updatedAt || ''
      if (ta !== tb) return ta < tb ? -1 : 1
      const ha = String(a.setting?.title || '')
      const hb = String(b.setting?.title || '')
      if (ha !== hb) return ha < hb ? -1 : 1
      return String(a.id) < String(b.id) ? -1 : 1
    })

  const lines = []
  lines.push('# 世界观整理')
  lines.push('')
  lines.push(`> ${PROJECTION_NOTE}`)
  lines.push(`> 来源 revision：${meta.sourceRevision ?? '—'} · 生成时间：${meta.generatedAt ?? ''}`)
  if (meta.projectKey) lines.push(`> 项目：${meta.projectKey}`)
  lines.push('')
  if (!list.length) {
    lines.push('（暂无已确认的世界观设定。）')
    lines.push('')
  }
  for (const it of list) {
    const s = it.setting
    lines.push(`## ${s.title || '（未命名）'}`)
    lines.push('')
    lines.push(`- **ID**：\`${it.id}\`${it.itemRevision != null ? ` · 修订 ${it.itemRevision}` : ''}`)
    lines.push('')
    lines.push('### 结论')
    lines.push('')
    lines.push(s.conclusion || '')
    lines.push('')
    if (s.explanation && String(s.explanation).trim()) {
      lines.push('### 说明')
      lines.push('')
      lines.push(String(s.explanation).trim())
      lines.push('')
    }
    if (s.boundaries && String(s.boundaries).trim()) {
      lines.push('### 边界 / 例外')
      lines.push('')
      lines.push(String(s.boundaries).trim())
      lines.push('')
    }
    if (Array.isArray(s.tags) && s.tags.length) {
      lines.push(`标签：${s.tags.join('、')}`)
      lines.push('')
    }
  }
  // 注入摘要校验块（便于人工核对 AI 默认会看到什么）
  lines.push('---')
  lines.push('')
  lines.push('## 注入摘要（结论 + 边界）')
  lines.push('')
  for (const it of list) {
    const inject = settingInjectText(it.setting)
    lines.push(`- **${it.setting.title || it.id}**：${inject.replace(/\n/g, ' ')}`)
  }
  lines.push('')
  return lines.join('\n')
}

/** Check every existing ancestor before mkdir/read/write. Never follow a file link. */
export function safeProjectPath(projectDir, relative) {
  const root = fs.realpathSync(projectDir)
  const abs = path.resolve(root, relative)
  const rel = path.relative(root, abs)
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw projectionError('projection-path-escape', 403)
  let cursor = root
  const parts = rel.split(path.sep)
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i])
    let stat
    try { stat = fs.lstatSync(cursor) } catch (err) { if (err.code === 'ENOENT') continue; throw err }
    const actual = fs.realpathSync(cursor)
    const nested = path.relative(root, actual)
    if (nested === '..' || nested.startsWith('..' + path.sep) || path.isAbsolute(nested)) throw projectionError('projection-path-escape', 403)
    if (stat.isSymbolicLink() && !fs.statSync(cursor).isDirectory()) throw projectionError('projection-file-link', 403)
  }
  return abs
}

export function readSettingProjection(projectDir) {
  const file = safeProjectPath(projectDir, PROJECTION_REL)
  try { const content = fs.readFileSync(file, 'utf8'); return { exists: true, content, hash: hashText(content), path: file } }
  catch (err) { if (err.code === 'ENOENT') return { exists: false, content: '', hash: null, path: file }; throw err }
}

/** Called under the memory lock. Recovery requires a durable intent hash. */
export function writeSettingProjection(projectDir, content, opts = {}) {
  const abs = safeProjectPath(projectDir, PROJECTION_REL)
  const previous = readSettingProjection(projectDir)
  const nextHash = hashText(content)
  if (previous.exists && previous.hash === nextHash && (opts.managedHash || opts.recoveryHash === nextHash)) {
    return { path: abs, hash: nextHash, content, unchanged: true }
  }
  const preserving = opts.preserve === true && opts.expectedFileHash && opts.expectedFileHash === previous.hash
  if (previous.exists && !preserving && (!opts.managedHash || previous.hash !== opts.managedHash)) throw projectionError('projection-conflict', 409)
  if (opts.preserve && !preserving) throw projectionError('projection-conflict', 409)
  fs.mkdirSync(safeProjectPath(projectDir, 'bible'), { recursive: true })
  let preservedPath = null
  if (previous.exists) {
    const dir = safeProjectPath(projectDir, 'state/projection-backups')
    fs.mkdirSync(dir, { recursive: true })
    const relative = opts.preserve ? `bible/世界观整理-手稿-${randomUUID()}.md` : `state/projection-backups/${randomUUID()}.bak`
    const backup = safeProjectPath(projectDir, relative)
    fs.writeFileSync(backup, previous.content, { encoding: 'utf8', flag: 'wx' })
    if (opts.preserve) preservedPath = backup
  }
  const tmp = safeProjectPath(projectDir, `bible/.${randomUUID()}.tmp`)
  try {
    fs.writeFileSync(tmp, content, { encoding: 'utf8', flag: 'wx' })
    // Check again after preparing a recoverable copy. External editors do not take our lock.
    const latest = readSettingProjection(projectDir)
    if (latest.exists !== previous.exists || latest.hash !== previous.hash) throw projectionError('projection-conflict', 409)
    safeProjectPath(projectDir, PROJECTION_REL)
    if (previous.exists) fs.renameSync(tmp, abs)
    else { fs.linkSync(tmp, abs); fs.unlinkSync(tmp) } // exclusive creation, never adopt a competing hand-written file
    if (hashText(fs.readFileSync(abs, 'utf8')) !== nextHash) throw projectionError('projection-conflict', 409)
    return { path: abs, hash: nextHash, content, sourceRevision: opts.sourceRevision, preservedPath, unchanged: false }
  } finally {
    try { fs.unlinkSync(tmp) } catch (err) { if (err.code !== 'ENOENT') throw err }
  }
}
