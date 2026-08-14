'use strict'
// 生成 Windows NSIS 更新清单 latest.yml（与 electron-builder 官方格式一致：
// sha512 为 base64，files 含 url/sha512/size，顶层带 path/sha512/releaseDate）。
// 用法：node gen-update-manifest.js <安装包.exe> [releaseDate]
const fs = require('fs')
const crypto = require('crypto')
const path = require('path')

const exe = process.argv[2]
if (!exe || !fs.existsSync(exe)) {
  console.error('usage: node gen-update-manifest.js <installer.exe>')
  process.exit(1)
}
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'))
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
console.log(`latest.yml -> ${out} (${buf.length} bytes)`)
