'use strict'
// 一次性脚本：生成 32px 托盘鲸鱼（黑/白两色，运行时按系统主题切换）
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

const build = path.join(__dirname, 'build')
const src = fs.readFileSync(path.join(build, 'whale-source.svg'), 'utf8')
const d = src.match(/<path[^>]*d="([^"]+)"/s)[1]

;(async () => {
  for (const [name, color] of [['tray-whale-white.png', '#ffffff'], ['tray-whale-black.png', '#000000']]) {
    const svg = `<svg width="64" height="64" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="${color}"/></svg>`
    await sharp(Buffer.from(svg), { density: 144 }).resize(32, 32).png().toFile(path.join(build, name))
    console.log(`rendered ${name}`)
  }
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
