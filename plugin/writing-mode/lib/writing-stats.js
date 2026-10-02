/**
 * 码字统计：按作品记录「每日净增 CJK 字数」，供状态条今日字数、检查页码字区块与日更目标展示。
 *
 * 存储：{{project}}/state/writing-stats.json（跟随项目目录，可随作品整体迁移）。
 *   { version: 1, days: { "YYYY-MM-DD": 净增 }, files: { "<项目内相对路径>": 上次记录 CJK } }
 *
 * 记账语义（防虚增）：
 * - 首见的一篇稿（files 里没有条目）只播种基线、不计增量——老项目第一次在写作台保存
 *   不能把整章存量算成「今天写的」；新篇通常先经 GET 打开（打开即播种，彼时还是 0 字或草稿），
 *   之后的保存照常计增量。
 * - 增量 = 本次 CJK − 该篇上次记录值，负数记 0（大删减不倒扣，也不产生负的日计数）。
 * - 记账点在 save / version 路由成功之后（host 侧权威）；compile 导出的成书不算码字。
 */
import fs from 'node:fs'
import path from 'node:path'
import { findProjectRoot, atomicWrite, storeError } from './store.js'

export const STATS_FILE = path.join('state', 'writing-stats.json')
const STATS_VERSION = 1
const MAX_DAYS = 400

export function cjkCount(text) {
  return (String(text || '').match(/[一-鿿]/g) ?? []).length
}

export function todayKey(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 相对项目根的稳定键（跨盘符大小写差异用小写；Windows 路径分隔统一成 /）。 */
function relKey(projectDir, absPath) {
  const rel = path.relative(projectDir, absPath).split(path.sep).join('/')
  return (process.platform === 'win32' ? rel.toLowerCase() : rel)
}

export function statsPath(projectDir) {
  return path.join(projectDir, STATS_FILE)
}

/** 容错读取：坏 JSON / 缺字段一律按空账本起步，绝不抛错挡保存。 */
export function readStats(projectDir) {
  let raw = null
  try {
    raw = fs.readFileSync(statsPath(projectDir), 'utf8')
  } catch {
    raw = null
  }
  if (!raw) return { version: STATS_VERSION, days: {}, files: {} }
  try {
    const parsed = JSON.parse(raw)
    return {
      version: STATS_VERSION,
      days: parsed?.days && typeof parsed.days === 'object' ? parsed.days : {},
      files: parsed?.files && typeof parsed.files === 'object' ? parsed.files : {},
    }
  } catch {
    return { version: STATS_VERSION, days: {}, files: {}, corrupt: true }
  }
}

function writeStats(projectDir, stats) {
  const file = statsPath(projectDir)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  atomicWrite(file, JSON.stringify(stats, null, 2))
}

/** 打开稿件时调用：首见只播种基线（0 增量），已见不动账。 */
export function seedBaseline(projectDir, absPath, content, now = new Date()) {
  const stats = readStats(projectDir)
  const key = relKey(projectDir, absPath)
  if (Object.prototype.hasOwnProperty.call(stats.files, key)) return false
  stats.files[key] = cjkCount(content)
  writeStats(projectDir, stats)
  return true
}

/** 保存成功后调用：净增记账。返回 { day, delta, today }。 */
export function recordSave(projectDir, absPath, content, now = new Date()) {
  const stats = readStats(projectDir)
  const key = relKey(projectDir, absPath)
  const cjk = cjkCount(content)
  const seen = Object.prototype.hasOwnProperty.call(stats.files, key)
  const delta = seen ? Math.max(0, cjk - stats.files[key]) : 0
  stats.files[key] = cjk
  const day = todayKey(now)
  if (delta > 0) stats.days[day] = (stats.days[day] ?? 0) + delta
  const keys = Object.keys(stats.days).sort()
  if (keys.length > MAX_DAYS) {
    for (const k of keys.slice(0, keys.length - MAX_DAYS)) delete stats.days[k]
  }
  writeStats(projectDir, stats)
  return { day, delta, today: stats.days[day] ?? 0 }
}

/**
 * 汇总给前端：今日净增、连续天数、最近 `spanDays` 天（含空日）。
 * 连续口径：从今天往回数 >0 的日；今天还没写不清零——从昨天往回数（保留进行中的连击）。
 */
export function statsSummary(projectDir, { spanDays = 14, now = new Date() } = {}) {
  const stats = readStats(projectDir)
  const days = []
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  cursor.setDate(cursor.getDate() - (spanDays - 1))
  for (let i = 0; i < spanDays; i += 1) {
    const key = todayKey(cursor)
    days.push({ day: key, total: stats.days[key] ?? 0 })
    cursor.setDate(cursor.getDate() + 1)
  }
  let streak = 0
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const yesterday = startOf(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const walker = startOf((stats.days[todayKey(now)] ?? 0) > 0 ? now : yesterday)
  for (let i = 0; i < MAX_DAYS; i += 1) {
    const total = stats.days[todayKey(walker)] ?? 0
    if (total <= 0) break
    streak += 1
    walker.setDate(walker.getDate() - 1)
  }
  return { today: stats.days[todayKey(now)] ?? 0, streak, days, corrupt: Boolean(stats.corrupt) }
}

/** 路由辅助：从任意库内稿件路径解析作品根；解析不出返回 null（散稿不记账）。 */
export function projectStatsFor(absPath, { spanDays, now } = {}) {
  const projectDir = findProjectRoot(String(absPath || ''))
  if (!projectDir) return null
  return { projectDir, summary: statsSummary(projectDir, { spanDays, now }) }
}

export function statsError(code, status = 400) {
  return storeError(code, status)
}
