'use strict'

/**
 * 原子化文件写入与健壮读取（零 Electron 依赖，纯 node 可测）。
 *
 * 背景（logs/2026-08-22.md ㉒㉓）：外壳历史上多次因为"直接 writeFileSync 覆盖"
 * 或"带 BOM / 半截文件"踩坑：
 *   · 重写 profile 的 package.json（隔离/恢复）时进程崩溃或被杀 → 文件半截 →
 *     内核 JSON.parse 直接崩、应用整体不可用
 *   · PowerShell 5.1 `Set-Content -Encoding UTF8` 写出的 BOM → JSON.parse 失败
 *   · 外壳自身 settings.json 写一半崩 → 回落默认、丢掉用户设置
 * 本模块统一为：先写临时文件再 rename 原子替换（同卷 rename 不会产生半截文件），
 * 读取剥 BOM、解析失败返回 null 而不是抛。
 */

const fs = require('node:fs')
const path = require('node:path')

/** 原子写文本/缓冲：先写同目录临时文件再 rename 覆盖。
 *  rename 在同一卷内是原子的——读方永远看到完整旧文件或完整新文件，看不到半截。
 *  Windows 下 rename 覆盖已存在文件偶发 EPERM（目标被短暂占用）时，才退回
 *  "删除后改名"（会引入极小的半截窗口，仅作为最后手段）。 */
function writeFileAtomic(file, content) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`)
  fs.writeFileSync(tmp, content)
  try {
    fs.renameSync(tmp, file)
  } catch (err) {
    try {
      fs.rmSync(file, { force: true })
      fs.renameSync(tmp, file)
    } catch (err2) {
      fs.rmSync(tmp, { force: true })
      throw err2
    }
  }
  return file
}

/** 原子写 JSON（追加换行便于人读）。 */
function writeJsonAtomic(file, data) {
  return writeFileAtomic(file, JSON.stringify(data, null, 2) + '\n')
}

/** 读 JSON 文件：剥 BOM、解析失败（半截/非 JSON）返回 null 而不抛。 */
function readJsonSafe(file) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

/** 备份一份（若存在）到 file.bak——RMW 前的低成本保险，便于人工回滚。 */
function backupFile(file) {
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak')
    return true
  } catch {
    return false
  }
}

module.exports = { writeFileAtomic, writeJsonAtomic, readJsonSafe, backupFile }
