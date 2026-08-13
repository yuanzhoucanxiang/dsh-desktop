'use strict'
// 一次性脚本：为 macOS 构建生成 512x512 图标（electron-builder mac 图标要求 ≥512）
// 运行：node render-512.js（需要 NODE_PATH 指向含 sharp 的 node_modules）
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

const build = path.join(__dirname, 'build')
const src = fs.readFileSync(path.join(build, 'whale-source.svg'), 'utf8')
const d = src.match(/<path[^>]*d="([^"]+)"/s)[1]

// 黑鲸·白色圆角底（与默认 icon.png 同款，512px）
const svg = `<svg width="512" height="512" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
<rect width="256" height="256" rx="58" fill="#ffffff"/>
<g transform="translate(128,129) scale(3.79) translate(-25,-25)"><path d="${d}" fill="#000000"/></g>
</svg>`

;(async () => {
  await sharp(Buffer.from(svg), { density: 72 }).resize(512, 512).png().toFile(path.join(build, 'icon-512.png'))
  console.log('rendered build/icon-512.png')
})().catch((err) => { console.error(err); process.exit(1) })
