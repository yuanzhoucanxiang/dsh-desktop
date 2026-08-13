'use strict'
// 一次性脚本：用 sharp（librsvg）把官方鲸鱼 SVG 渲染成各版本 PNG
// 运行：node render-whale.js（需要 NODE_PATH 指向含 sharp 的 node_modules）
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

const BUILD = path.join(__dirname, 'build')
const src = fs.readFileSync(path.join(BUILD, 'whale-source.svg'), 'utf8')
const d = src.match(/<path[^>]*d="([^"]+)"/s)[1]

function svgDoc(fill, bg) {
  const whale = `<path d="${d}" fill="${fill}"/>`
  if (bg === 'transparent') {
    return `<svg width="256" height="256" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">${whale}</svg>`
  }
  return `<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <rect width="256" height="256" rx="58" fill="${bg}"/>
  <g transform="translate(128,129) scale(3.79) translate(-25,-25)">${whale}</g>
</svg>`
}

async function render(name, fill, bg) {
  const svg = svgDoc(fill, bg)
  await sharp(Buffer.from(svg), { density: 96 }).png().toFile(path.join(BUILD, name))
  console.log(`rendered ${name}`)
}

;(async () => {
  await render('icon-whale-official.png', '#000000', 'transparent') // 黑鲸 · 透明底
  await render('icon-whale-white.png', '#ffffff', 'transparent')    // 白鲸 · 透明底
  await render('icon-whale-tile-white.png', '#000000', '#ffffff')   // 黑鲸 · 白色圆角底
  await render('icon-whale-tile-dark.png', '#ffffff', '#0e1428')    // 白鲸 · 深色圆角底
  console.log('RENDER_OK')
})().catch((err) => {
  console.error('RENDER_FAIL', err)
  process.exit(1)
})
