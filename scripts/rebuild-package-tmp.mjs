// 真包重建（B07/B01 要求"用最终代码重新打包"）：输出放 %TEMP%（工作区规则），只做 dir 目标、不签名、不发布。
// 离线化：electron-builder 默认会去 GitHub 下 electron 的 zip；本环境到 GitHub 常超时（前几轮踩过），
// 这里直接指向 node_modules/electron/dist（同一版本，已装），并把签名/资源编辑关掉。
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'

const repo = 'E:/Deepseek harness/dsh-desktop'
const require = createRequire(path.join(repo, 'package.json'))
const pkg = require(path.join(repo, 'package.json'))
const builder = require('electron-builder')

const out = process.env.WM_OUT || path.join(process.env.TEMP, `wm-v2-rebuild-${pkg.version}`)
const electronDist = path.join(repo, 'node_modules', 'electron', 'dist')
if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) {
  console.error('[rebuild] 找不到本地 electron dist：' + electronDist)
  process.exit(1)
}
fs.mkdirSync(out, { recursive: true })
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
console.log('[rebuild] output =', out)
console.log('[rebuild] electronDist =', electronDist)

try {
  await builder.build({
    targets: builder.Platform.WINDOWS.createTarget(['dir'], builder.Arch.x64),
    publish: 'never',
    config: {
      directories: { output: out },
      electronDist,
      // signExecutable:false 只跳过签名；图标与版本信息照常写入 exe。
      // 千万不能用 signAndEditExecutable:false —— 它连图标/版本信息一起跳过，
      // 装出来的应用就是默认 Electron 图标（v0.1.39–v0.1.42 的 Windows 包栽在这里）。
      win: { signExecutable: false },
    },
  })
  fs.writeFileSync(path.join(process.env.TEMP, 'wm-v2-review-package-path.txt'), out)
  console.log('[rebuild] BUILD_OK', out)
} catch (err) {
  console.error('[rebuild] BUILD_FAIL', err?.message || err)
  process.exitCode = 1
}
