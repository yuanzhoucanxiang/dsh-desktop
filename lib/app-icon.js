'use strict'

/**
 * 应用图标自定义（纯 Node 逻辑，零 Electron 依赖，可单测）。
 *
 * 能改什么 / 不能改什么（Windows）：
 *   · 窗口与任务栏图标 —— 运行时 `win.setIcon()` / 创建参数 `icon`，即时生效；
 *   · 桌面 / 开始菜单 / 任务栏固定快捷方式的图标 —— 改 .lnk 的 IconLocation 指到
 *     userData 里生成的 .ico（本模块负责生成 ICO 与构建改写脚本）；
 *   · **exe 内嵌图标改不了**（那是打包期资源编辑）——选「默认」时快捷方式指回 exe，
 *     用的就是打包进去的鲸鱼图标。
 * 托盘图标是有独立设计的「主题色鲸鱼」状态指示，不随此设置变化。
 *
 * ICO 采用 PNG 帧封装（Vista+ 支持）：Electron 的 nativeImage 负责缩放与 PNG 编码，
 * 本模块只负责把若干 PNG 帧装进 ICO 容器（目录项 + 数据块）。
 */

const path = require('node:path')

/** 内置预设。png 用于窗口/任务栏；ico 用于快捷方式（default 直接用打包好的 icon.ico）。 */
const PRESETS = [
  { key: 'default', label: '默认 · 鲸鱼', png: 'build/icon.png', ico: 'build/icon.ico' },
  { key: 'maiden', label: '看板娘', png: 'build/icons/maiden.png', ico: null }, // ico 由运行时生成到 userData
]

/** 合法取值：内置预设 key 或 'custom'。 */
function isValidSetting(v) {
  return typeof v === 'string' && (v === 'custom' || PRESETS.some((p) => p.key === v))
}

/** 自定义图标的来源文件扩展名（窗口图与快捷方式图都走同一管线）。 */
const CUSTOM_EXTS = new Set(['.png', '.ico'])

/**
 * 把若干 PNG 帧封装成 ICO（PNG 帧，Vista+）。
 * @param {Array<{size:number, png:Buffer}>} frames 尺寸升序；size=256 时目录项写 0
 * @returns {Buffer}
 */
function icoFromPngFrames(frames) {
  const list = Array.isArray(frames) ? frames.filter((f) => f && Buffer.isBuffer(f.png) && Number.isInteger(f.size) && f.size > 0 && f.size <= 256) : []
  if (!list.length) throw new Error('ico-from-png-frames: no valid frames')
  const count = list.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)
  const entries = Buffer.alloc(16 * count)
  const blobs = []
  let offset = header.length + entries.length
  list.forEach((f, i) => {
    const base = i * 16
    entries.writeUInt8(f.size >= 256 ? 0 : f.size, base + 0) // width（256 写 0）
    entries.writeUInt8(f.size >= 256 ? 0 : f.size, base + 1) // height
    entries.writeUInt8(0, base + 2) // palette
    entries.writeUInt8(0, base + 3) // reserved
    entries.writeUInt16LE(1, base + 4) // planes
    entries.writeUInt16LE(32, base + 6) // bpp
    entries.writeUInt32LE(f.png.length, base + 8)
    entries.writeUInt32LE(offset, base + 12)
    offset += f.png.length
    blobs.push(f.png)
  })
  return Buffer.concat([header, entries, ...blobs])
}

/** 运行时生成 ICO 的尺寸集（升序，256 封顶）。 */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/**
 * 构建改写快捷方式图标的 PowerShell 脚本（参数以 base64 内嵌，杜绝引号注入）。
 * @param {string} exePath 目标 exe（只改指向它的 .lnk）
 * @param {string} icoPath 新图标 .ico 的路径；传 '-reset' 表示指回 exe 自身图标
 * @returns {string} PowerShell 脚本正文（调用方以 -EncodedCommand 执行）
 */
function buildUpdateShortcutsScript(exePath, icoPath) {
  if (typeof exePath !== 'string' || !exePath) throw new Error('shortcuts-script: exePath required')
  if (typeof icoPath !== 'string' || !icoPath) throw new Error('shortcuts-script: icoPath required')
  const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64')
  return [
    "$ErrorActionPreference='SilentlyContinue'",
    `$exe=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(exePath)}'))`,
    `$ico=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(icoPath)}'))`,
    "$sh=New-Object -ComObject WScript.Shell",
    "$dirs=@(",
    " [Environment]::GetFolderPath('Desktop'),",
    " [Environment]::GetFolderPath('CommonDesktopDirectory'),",
    " (Join-Path [Environment]::GetFolderPath('StartMenu') 'Programs'),",
    " (Join-Path [Environment]::GetFolderPath('CommonStartMenu') 'Programs'),",
    " (Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar')",
    ")",
    "$changed=0",
    "foreach($d in $dirs){ if($d -and (Test-Path $d)){ Get-ChildItem -LiteralPath $d -Filter *.lnk -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {",
    "  try{ $lnk=$sh.CreateShortcut($_.FullName)",
    "    if($lnk.TargetPath -and ($lnk.TargetPath.Trim() -ieq $exe)){",
    "      if($ico -eq '-reset'){ $lnk.IconLocation=\"$exe,0\" } else { $lnk.IconLocation=\"$ico,0\" }",
    "      $lnk.Save(); $changed++",
    "    }",
    "  } catch {}",
    "}}}",
    "Write-Output ('CHANGED=' + $changed)",
  ].join('\r\n')
}

/** 相对资源路径 → 绝对（以应用根为基准；打包后 __dirname 即 app 根）。 */
function presetPaths(p, appRoot) {
  return {
    png: path.join(appRoot, p.png),
    ico: p.ico ? path.join(appRoot, p.ico) : null,
  }
}

module.exports = { PRESETS, ICO_SIZES, CUSTOM_EXTS, isValidSetting, icoFromPngFrames, buildUpdateShortcutsScript, presetPaths }
