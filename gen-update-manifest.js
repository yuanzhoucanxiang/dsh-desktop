'use strict'
// 生成 Windows NSIS 更新清单 latest.yml（与 electron-builder 官方格式一致：
// sha512 为 base64，files 含 url/sha512/size，顶层带 path/sha512/releaseDate）。
// 用法：node gen-update-manifest.js <安装包.exe> [releaseDate]
const fs = require('fs')
const crypto = require('crypto')
const path = require('path')

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'))
// 无参调用时按 package.json 版本自动推导安装包路径（避免 PowerShell 5.1 变量/编码差异）
const exe = process.argv[2] || path.join(__dirname, 'dist', `dsh-desktop-${pkg.version}-setup.exe`)
if (!fs.existsSync(exe)) {
  console.error('installer not found: ' + exe)
  process.exit(1)
}
const buf = fs.readFileSync(exe)
const sha512 = crypto.createHash('sha512').update(buf).digest('base64')
const fileName = path.basename(exe)
const releaseDate = process.argv[3] || new Date().toISOString()
const yml = [
  `version: ${pkg.version}`,
  'files:',
  `  - url: ${fileName}`,
  `    sha512: ${sha512}`,
  `    size: ${buf.length}`,
  `path: ${fileName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  '',
].join('\n')
const out = path.join(path.dirname(exe), 'latest.yml')
fs.writeFileSync(out, yml)
// 进度日志必须走 stderr：本脚本曾被 `node … > latest.yml` 重定向，stdout 日志行
// 覆盖了刚写好的文件，污染的 YAML 让应用更新检查直接解析失败（2026-08-25 实故）。
// stdout 只允许承载"文件内容本身"，日志一律 stderr——重定向怎么写都不会再自伤。
console.error(`latest.yml -> ${out} (${buf.length} bytes)`)
