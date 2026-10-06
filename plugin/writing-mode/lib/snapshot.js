/**
 * 作品定时快照（安全网）：save/version 成功后按「每作品每天一份」把项目文本文件
 * 打包到 ~/.dsh/writing-backups/（跟随 DSH_HOME），保留最近 keep 份，更旧的自动清掉。
 *
 * 设计红线：
 * - 只读项目、只写备份目录——备份路径永远在项目外，绝不动原稿一个字节；
 * - 备份失败只 console.warn，绝不影响保存主链路（安全网不能反过来变成故障源）；
 * - zip 用 store（不压缩）纯 JS 生成，零依赖；文件名 UTF-8（general purpose bit 11）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listProjectFiles } from './store.js'

const MAX_ENTRIES = 500
const MAX_TOTAL_BYTES = 32 * 1024 * 1024

/** crc32（IEEE 802.3，zip 标准）。 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

export function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** 备份根目录（与 store.configFile 同一 DSH_HOME 口径，隔离测试可整体重定向）。 */
export function backupRoot() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'writing-backups')
}

const dosDateTime = (d) => ({
  time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
  date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
})

/** 纯 JS zip（store 不压缩）：entries = [{ name（zip 内相对路径，/ 分隔）, data:Buffer }]。 */
export function buildZip(entries, now = new Date()) {
  const { time, date } = dosDateTime(now)
  const chunks = []
  const central = []
  let offset = 0
  const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff); return b }
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b }
  for (const e of entries) {
    const name = Buffer.from(String(e.name), 'utf8')
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data)
    const crc = crc32(data)
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),
      name, data,
    ])
    chunks.push(local)
    central.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(crc), u32(data.length), u32(data.length), u16(name.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]))
    offset += local.length
  }
  const cdOffset = offset
  const cd = Buffer.concat(central)
  chunks.push(cd)
  chunks.push(Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(cd.length), u32(cdOffset), u16(0),
  ]))
  return Buffer.concat(chunks)
}

const dayKey = (now) => {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

const safeBase = (name) => String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'project'

/**
 * 给项目拍一份当日快照（已存在则跳过 → 天然「每天一份」）；随后按保留数清理旧档。
 * 返回 { ok, file, skipped, pruned } 或 { ok:false, reason }；所有失败都不抛出（备份不挡主链路）。
 */
export async function snapshotProject(projectDir, { now = new Date(), keep = 14, backupDir = backupRoot() } = {}) {
  try {
    if (!projectDir || !fs.existsSync(projectDir)) return { ok: false, reason: 'project-missing' }
    const files = listProjectFiles(projectDir).slice(0, MAX_ENTRIES)
    const base = safeBase(path.basename(projectDir))
    const file = path.join(backupDir, `${base}-${dayKey(now)}.zip`)
    if (fs.existsSync(file)) return { ok: true, file, skipped: true, pruned: 0 }
    const entries = []
    let total = 0
    for (const f of files) {
      try {
        const data = await fs.promises.readFile(f.abs)
        total += data.length
        if (total > MAX_TOTAL_BYTES) break
        entries.push({ name: f.rel.split(path.sep).join('/'), data })
      } catch {}
    }
    if (!entries.length) return { ok: false, reason: 'no-files' }
    const zip = buildZip(entries, now)
    fs.mkdirSync(backupDir, { recursive: true })
    const tmp = `${file}.${randomTail()}.tmp`
    await fs.promises.writeFile(tmp, zip)
    await fs.promises.rename(tmp, file)
    // 保留策略：同前缀按日期倒序，keep 之外的旧档清掉
    let pruned = 0
    const prefix = `${base}-`
    const zips = fs.readdirSync(backupDir)
      .filter((n) => n.startsWith(prefix) && n.endsWith('.zip') && /^\d{8}\.zip$/.test(n.slice(prefix.length)))
      .sort((a, b) => (a < b ? 1 : -1))
    for (const old of zips.slice(keep)) {
      try { await fs.promises.unlink(path.join(backupDir, old)); pruned += 1 } catch {}
    }
    return { ok: true, file, skipped: false, pruned }
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) }
  }
}

const randomTail = () => Math.random().toString(36).slice(2, 10)

/** 进程内去重：同一作品同一天只排一次快照任务。 */
const scheduledToday = new Map()

/** save/version 成功后的 fire-and-forget 入口：绝不抛出、绝不阻塞响应。 */
export function scheduleDailySnapshot(projectDir, now = new Date()) {
  try {
    if (!projectDir) return
    const key = `${path.resolve(String(projectDir)).toLowerCase()}|${dayKey(now)}`
    if (scheduledToday.get(key)) return
    scheduledToday.set(key, true)
    Promise.resolve(snapshotProject(projectDir, { now })).then((r) => {
      if (r && r.ok === false && r.reason !== 'project-missing') {
        console.warn(`[writing-mode] 每日快照未完成（不影响保存）：${r.reason}`)
      }
    }).catch((err) => console.warn(`[writing-mode] 每日快照失败（不影响保存）：${err?.message || err}`))
  } catch (err) {
    console.warn(`[writing-mode] 每日快照调度失败（不影响保存）：${err?.message || err}`)
  }
}
