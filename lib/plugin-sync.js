'use strict'

/**
 * 内置插件「清单驱动」同步（纯 Node，零 Electron 依赖，可单测）。
 *
 * 为什么不再全量递归覆盖（方案写作模式 P1-②）：
 *   1. 逐文件哈希比对，才能回答「profile 里的 client.js 真是这一版吗」；
 *   2. 发布集合由插件自带的 runtime-manifest.json 明确列出——test/、src/ 源码
 *      不进 profile（旧行为会把测试脚本一起种到用户机器上）；
 *   3. 清理只动「上一版本外壳写过、这一版不再发布」的文件，且必须仍与上次写入的
 *      哈希一致（用户改过的一律保留并上报）——受管清单之外的任何文件都不碰。
 *
 * 没有清单的插件（dialog-optimize / shell-settings）退回按扩展名递归的老行为，
 * 行为不变，只是同样获得哈希比对与受管记录。
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { writeFileAtomic } = require('./atomic-file')

const RECORD_NAME = '.dsh-managed.json'
const FALLBACK_EXT = /\.(js|mjs|cjs|json|md|yml)$/

const toPosix = (p) => p.split(path.sep).join('/')

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/** 递归收集相对路径（跳过 node_modules / 点文件），按扩展名过滤——无清单时的发布集合。 */
function walkFallback(srcDir, rel = '') {
  let ents
  try {
    ents = fs.readdirSync(path.join(srcDir, rel), { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const ent of ents) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules') continue
    const child = rel ? path.join(rel, ent.name) : ent.name
    if (ent.isDirectory()) out.push(...walkFallback(srcDir, child))
    else if (ent.isFile() && FALLBACK_EXT.test(ent.name)) out.push(child)
  }
  return out
}

/**
 * 读插件自带的发布清单，返回相对插件根的文件列表（posix）。
 * 清单里的路径以 root 字段为基准（如 "plugin/writing-mode"），未给 root 时返回 null。
 */
function manifestPaths(srcDir) {
  const file = path.join(srcDir, 'runtime-manifest.json')
  if (!fs.existsSync(file)) return null
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
  const root = typeof manifest.root === 'string' ? manifest.root.replace(/\/+$/, '') : ''
  if (!root) return null
  const lists = [manifest.entry, manifest.files, manifest.docs].filter(Array.isArray)
  if (!lists.length) return null
  const out = []
  for (const list of lists) {
    for (const p of list) {
      if (typeof p !== 'string' || !p.startsWith(root + '/')) continue
      out.push(toPosix(path.relative(root, p)))
    }
  }
  // 清单本身也随包发布：安装侧才能独立自证「我是哪一版、该有哪些文件」
  out.push('runtime-manifest.json')
  return [...new Set(out)].sort()
}

/** 发布集合：有清单用清单，否则按扩展名递归。返回 { source, files }。 */
function publishSet(srcDir) {
  const listed = manifestPaths(srcDir)
  if (listed && listed.includes('package.json')) return { source: 'manifest', files: listed }
  return { source: 'fallback', files: walkFallback(srcDir).map(toPosix).sort() }
}

function readRecord(destDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(destDir, RECORD_NAME), 'utf8'))
    return parsed && typeof parsed.files === 'object' && parsed.files ? parsed : null
  } catch {
    return null
  }
}

/** 递归列出目标目录里已存在的文件（相对路径，posix；跳过 node_modules / 点文件名）。 */
function walkExisting(destDir, rel = '') {
  let ents
  try {
    ents = fs.readdirSync(path.join(destDir, rel), { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const ent of ents) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules') continue
    const child = rel ? path.join(rel, ent.name) : ent.name
    if (ent.isDirectory()) out.push(...walkExisting(destDir, child))
    else if (ent.isFile()) out.push(toPosix(child))
  }
  return out
}

/**
 * 同步一个内置插件目录。
 *   srcDir / destDir —— 源（仓库 plugin/<name> 或安装包 resources/plugin/<name>）与 profile 目标
 * 返回 { ok, source, copied, updated, removed, keptEdited, removedFailed, foreign, unchanged, errors }；
 * 单个文件失败只记录不抛出（一个坏文件不该让整个插件失去同步）。
 */
function syncPluginDir(opts) {
  const o = opts || {}
  const srcDir = o.srcDir
  const destDir = o.destDir
  const result = {
    ok: false, source: 'none', version: null,
    copied: [], updated: [], removed: [], keptEdited: [], foreign: [],
    unchanged: 0, errors: [],
  }
  if (!srcDir || !destDir) {
    result.errors.push('缺少 srcDir/destDir')
    return result
  }
  const pkgPath = path.join(srcDir, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    result.errors.push(`源缺少 package.json：${srcDir}`)
    return result
  }
  try {
    result.version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || null
  } catch {}

  const { source, files } = publishSet(srcDir)
  result.source = source

  // 上一版受管清单（本外壳写过的文件 + 当时哈希）；没有就当首次同步，不清理任何东西
  const prev = readRecord(destDir)
  const wanted = new Set(files)

  for (const rel of files) {
    const s = path.join(srcDir, rel)
    const d = path.join(destDir, rel)
    try {
      if (!fs.existsSync(s)) {
        result.errors.push(`清单列出的文件在源里不存在：${rel}`)
        continue
      }
      const nextHash = sha256(s)
      if (fs.existsSync(d)) {
        if (sha256(d) === nextHash) {
          result.unchanged++
          continue
        }
        fs.copyFileSync(s, d)
        result.updated.push(rel)
      } else {
        fs.mkdirSync(path.dirname(d), { recursive: true })
        fs.copyFileSync(s, d)
        result.copied.push(rel)
      }
    } catch (err) {
      result.errors.push(`${rel}: ${err.message}`)
    }
  }

  // 清理：上一版受管、这一版不发布、且磁盘内容仍与上次写入一致（用户改过的保留）
  if (prev) {
    for (const [rel, hash] of Object.entries(prev.files)) {
      if (wanted.has(rel)) continue
      const d = path.join(destDir, rel)
      if (!fs.existsSync(d)) continue
      try {
        if (sha256(d) !== hash) {
          result.keptEdited.push(rel)
          continue
        }
        fs.rmSync(d, { force: true })
        result.removed.push(rel)
      } catch (err) {
        result.removedFailed.push(rel)
        result.errors.push(`remove ${rel}: ${err.message}`)
      }
    }
  }

  // 目标里的其它文件：既不在发布集合、也不在上一版受管清单 → 用户/别的来源，只上报
  const managed = new Set([...(prev ? Object.keys(prev.files) : []), ...files])
  for (const rel of walkExisting(destDir)) {
    if (rel === RECORD_NAME || managed.has(rel)) continue
    result.foreign.push(rel)
  }

  // 写受管清单：记录本次写入的每个文件哈希（下次清理的判据）
  const recordFiles = {}
  for (const rel of files) {
    const d = path.join(destDir, rel)
    try {
      if (fs.existsSync(d)) recordFiles[rel] = sha256(d)
    } catch {}
  }
  try {
    writeFileAtomic(path.join(destDir, RECORD_NAME), JSON.stringify({
      plugin: path.basename(srcDir),
      version: result.version,
      source,
      syncedAt: new Date().toISOString(),
      files: recordFiles,
    }, null, 2))
  } catch (err) {
    result.errors.push(`写受管清单失败：${err.message}`)
  }

  result.ok = result.errors.length === 0
  return result
}

/**
 * 逐文件比对两棵树（repo → 安装包 → profile 用）：返回
 * { ok, source, version, same, missing, drift, extra }，条目为 { rel, ... }。
 * 用作验收脚本的判据，不做任何写入。
 */
function compareTrees(srcDir, destDir) {
  const out = { ok: false, source: 'none', version: null, same: [], missing: [], drift: [], extra: [] }
  if (!fs.existsSync(path.join(srcDir, 'package.json')) || !fs.existsSync(destDir)) return out
  try {
    out.version = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf8')).version || null
  } catch {}
  const { source, files } = publishSet(srcDir)
  out.source = source
  for (const rel of files) {
    const s = path.join(srcDir, rel)
    const d = path.join(destDir, rel)
    if (!fs.existsSync(s)) { out.drift.push({ rel, reason: '源缺失' }); continue }
    if (!fs.existsSync(d)) { out.missing.push({ rel }); continue }
    const sh = sha256(s)
    const dh = sha256(d)
    if (sh === dh) out.same.push({ rel })
    else out.drift.push({ rel, srcHash: sh.slice(0, 12), destHash: dh.slice(0, 12) })
  }
  const wanted = new Set(files)
  for (const rel of walkExisting(destDir)) {
    if (rel === RECORD_NAME && !wanted.has(RECORD_NAME)) { out.extra.push({ rel }); continue }
    if (!wanted.has(rel)) out.extra.push({ rel })
  }
  out.ok = out.missing.length === 0 && out.drift.length === 0
  return out
}

module.exports = { syncPluginDir, compareTrees, publishSet, manifestPaths, walkFallback, sha256, RECORD_NAME }
