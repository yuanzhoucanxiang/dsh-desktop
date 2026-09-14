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

/**
 * 安全边界（B05）：清单与受管记录里的相对路径都可能不可信，**任何写/删之前**都要校验：
 *   1. 结构：必须是相对路径、不含 '..'、不是绝对路径、非空；
 *   2. 归属：解析后（realpath）仍必须落在目标目录内——profile 下若出现指向别处的
 *      junction/symlink（或目标本身是 reparse point），一律拒绝。
 * 记录文件只能提供"候选删除项"，永远不能单独作为删除依据（还要哈希一致 + 归属校验）。
 */
function isSafeRelPath(rel) {
  if (typeof rel !== 'string' || !rel) return false
  if (rel.includes('\u0000')) return false
  const norm = rel.split(path.sep).join('/')
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) return false
  const parts = norm.split('/')
  return parts.every((p) => p && p !== '.' && p !== '..')
}

/** 目标路径是否仍在 rootReal 之内（对"最深的已存在祖先"做 realpath，避免被 reparse point 带出去）。 */
function isInsideReal(rootReal, target) {
  let probe = target
  for (;;) {
    if (fs.existsSync(probe)) break
    const parent = path.dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  let realProbe
  try {
    realProbe = fs.realpathSync.native(probe)
  } catch {
    return false
  }
  const relToRoot = path.relative(rootReal, realProbe)
  if (relToRoot === '') return true
  return !relToRoot.startsWith('..') && !path.isAbsolute(relToRoot)
}

function realRoot(dir) {
  try {
    return fs.realpathSync.native(dir)
  } catch {
    return null
  }
}

/** 路径字面量 vs 解析后是否一致（不一致说明这一层是 reparse point / junction / 符号链接）。 */
function resolvedSame(dir) {
  const abs = path.resolve(dir)
  let real
  try {
    real = fs.realpathSync.native(abs)
  } catch {
    return null
  }
  return path.resolve(real).toLowerCase() === abs.toLowerCase()
}

/**
 * 可信边界校验（N05）。
 *
 * 为什么不能只查"目标之下"：如果把 destDir 的 realpath 直接当可信根，**destDir 本身就是 junction**
 * 时所有写在外部目录里的文件反而都"在根内"，越界就放行了。
 *
 * 规则：
 *   1. 目标根（或其最近的已存在祖先）不得是 reparse point —— 缺失根也要锚定，不能因"根不存在"跳过；
 *   2. 调用方给出 trustedRoot（外壳传的是它自己解析出来的 profile 根）时，目标根的解析结果必须落在
 *      trustedRoot 的解析结果之内。可信边界来自调用方，而不是来自被检查的目标本身。
 */
function checkTrustedBoundary(dir, trustedRoot) {
  const abs = path.resolve(dir)
  let anchor = abs
  for (;;) {
    if (fs.existsSync(anchor)) break
    const parent = path.dirname(anchor)
    if (parent === anchor) return { ok: false, reason: 'no-anchor' }
    anchor = parent
  }
  // 只对"从锚点往下到 dir 这一段里已存在的层级"做检查：任一已存在层级是 reparse point 就拒绝
  let cursor = anchor
  const rest = path.relative(anchor, abs)
  for (const seg of ['.', ...(rest ? rest.split(path.sep) : [])]) {
    const probePath = seg === '.' ? anchor : path.join(cursor, seg)
    if (fs.existsSync(probePath)) {
      const same = resolvedSame(probePath)
      if (same === false) return { ok: false, reason: 'reparse-point', at: probePath }
    }
    if (seg !== '.') cursor = probePath
  }
  if (trustedRoot) {
    // 可信根本身也允许"暂时不存在"（首启时 profiles/ 还没建）：锚定它最近的已存在祖先，
    // 并要求那条链同样没有 reparse point。**不能**因为"根不存在"就拒绝整轮同步，
    // 也不能反过来跳过校验（2026-09-15 实测：写死"根必须存在"会让首启同步被整体拒掉）。
    let trustedAnchor = path.resolve(trustedRoot)
    for (;;) {
      if (fs.existsSync(trustedAnchor)) break
      const parent = path.dirname(trustedAnchor)
      if (parent === trustedAnchor) return { ok: false, reason: 'trusted-root-no-anchor', trustedRoot }
      trustedAnchor = parent
    }
    const trustedSame = resolvedSame(trustedAnchor)
    if (trustedSame === false) return { ok: false, reason: 'trusted-root-reparse-point', at: trustedAnchor }
    const realTrusted = realRoot(trustedAnchor) || path.resolve(trustedAnchor)
    const realTarget = realRoot(anchor) || path.resolve(anchor)
    const rel = path.relative(realTrusted, realTarget)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, reason: 'outside-trusted-root', trustedRoot, realTarget }
    }
  }
  return { ok: true, anchor }
}

function readRecordRaw(destDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(destDir, RECORD_NAME), 'utf8'))
  } catch {
    return null
  }
}

function readRecord(destDir) {
  const parsed = readRecordRaw(destDir)
  if (!parsed || typeof parsed.files !== 'object' || !parsed.files) return null
  // 旧记录可能被改写/异常：只接受结构合法的相对路径条目，其余丢弃（丢弃=保留文件，安全方向）
  const files = {}
  let dropped = 0
  for (const [rel, hash] of Object.entries(parsed.files)) {
    if (!isSafeRelPath(rel) || typeof hash !== 'string') {
      dropped++
      continue
    }
    files[rel] = hash
  }
  return { ...parsed, files, droppedEntries: dropped }
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
    copied: [], updated: [], removed: [], keptEdited: [], removedFailed: [], foreign: [],
    unchanged: 0, errors: [], refused: [],
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

  const rawSet = publishSet(srcDir)
  result.source = rawSet.source
  // 清单里的相对路径同样不可信：绝对路径 / .. / 空串一律剔除（剔除=不发布该文件，安全方向）
  const files = rawSet.files.filter((rel) => {
    if (isSafeRelPath(rel)) return true
    result.refused.push({ rel, reason: 'unsafe-path' })
    result.errors.push(`清单里的路径不安全，已拒绝：${rel}`)
    return false
  })
  const srcReal = realRoot(srcDir)
  const destReal = realRoot(destDir)

  // N05：进入同步前先核对根与祖先的归属/reparse 状态；任一不合规就整轮拒绝（不做任何写入）
  const destBoundary = checkTrustedBoundary(destDir, o.trustedRoot || null)
  if (!destBoundary.ok) {
    result.refused.push({ rel: '.', reason: destBoundary.reason, at: destBoundary.at || null })
    result.errors.push(`拒绝同步：目标插件根不可信（${destBoundary.reason}${destBoundary.at ? '：' + destBoundary.at : ''}）`)
    result.ok = false
    return result
  }
  const srcBoundary = o.trustedRoot ? checkTrustedBoundary(srcDir, null) : { ok: true }
  if (!srcBoundary.ok) {
    result.refused.push({ rel: '.', reason: 'src-' + srcBoundary.reason })
    result.errors.push(`拒绝同步：源插件根不可信（${srcBoundary.reason}）`)
    result.ok = false
    return result
  }

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
      // 归属校验：源必须在插件目录内；目标必须仍在 profile 目录内（junction/symlink 会被
      // realpath 拆穿）。任何越界都不写、不删，只拒绝并留证。
      if (srcReal && !isInsideReal(srcReal, s)) {
        result.refused.push({ rel, reason: 'src-outside-real-root' })
        result.errors.push(`拒绝：源路径越出插件目录（可能是 reparse point）：${rel}`)
        continue
      }
      if (destReal && !isInsideReal(destReal, d)) {
        result.refused.push({ rel, reason: 'dest-outside-real-root' })
        result.errors.push(`拒绝：目标路径越出 profile 目录（可能是 junction/symlink）：${rel}`)
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
    if (prev.droppedEntries) result.recordDropped = prev.droppedEntries
    for (const [rel, hash] of Object.entries(prev.files)) {
      if (wanted.has(rel)) continue
      // 记录文件只提供"候选删除项"：结构不合法、或解析后不在 profile 内 → 一律不删（保留并留证）
      if (!isSafeRelPath(rel)) {
        result.refused.push({ rel, reason: 'unsafe-record-path' })
        continue
      }
      const d = path.join(destDir, rel)
      if (destReal && !isInsideReal(destReal, d)) {
        result.refused.push({ rel, reason: 'record-target-outside-real-root' })
        result.errors.push(`拒绝：受管记录指向 profile 之外，未删除：${rel}`)
        continue
      }
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
    if (!isSafeRelPath(rel)) continue
    const d = path.join(destDir, rel)
    if (destReal && !isInsideReal(destReal, d)) continue
    try {
      if (fs.existsSync(d)) recordFiles[rel] = sha256(d)
    } catch {}
  }
  try {
    writeFileAtomic(path.join(destDir, RECORD_NAME), JSON.stringify({
      plugin: path.basename(srcDir),
      version: result.version,
      source: result.source,
      syncedAt: new Date().toISOString(),
      files: recordFiles,
    }, null, 2))
  } catch (err) {
    result.errors.push(`写受管清单失败：${err.message}`)
  }

  result.ok = result.errors.length === 0 && result.refused.length === 0
  return result
}

/**
 * 逐文件比对两棵树（repo → 安装包 → profile 用）：返回
 * { ok, source, version, same, missing, drift, extra }，条目为 { rel, ... }。
 * 用作验收脚本的判据，不做任何写入。
 */
function compareTrees(srcDir, destDir, opts = {}) {
  const out = { ok: false, source: 'none', version: null, same: [], missing: [], drift: [], extra: [], refused: [] }
  if (!fs.existsSync(path.join(srcDir, 'package.json')) || !fs.existsSync(destDir)) return out
  const boundary = checkTrustedBoundary(destDir, opts.trustedRoot || null)
  if (!boundary.ok) {
    out.refused.push({ rel: '.', reason: boundary.reason })
    return out
  }
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

module.exports = { syncPluginDir, compareTrees, publishSet, manifestPaths, walkFallback, sha256, RECORD_NAME, checkTrustedBoundary }
