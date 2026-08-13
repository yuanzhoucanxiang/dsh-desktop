'use strict'
// 从 build/icon.png 生成标准多尺寸 ICO（DIB 位图编码，16→256，Explorer 全兼容）
// 运行：node make-ico.js（需要 NODE_PATH 指向含 sharp 的 node_modules）
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

const build = path.join(__dirname, 'build')
const sizes = [16, 24, 32, 48, 64, 128, 256]

// 单张 DIB 图标图块：BITMAPINFOHEADER + XOR(32bpp BGRA 自下而上) + AND(1bpp 全零)
function dibEntry(width, height, rgbaTopDown) {
  const xor = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4
    for (let x = 0; x < width; x++) {
      const s = src + x * 4
      const d = y * width * 4 + x * 4
      xor[d] = rgbaTopDown[s + 2]     // B
      xor[d + 1] = rgbaTopDown[s + 1] // G
      xor[d + 2] = rgbaTopDown[s]     // R
      xor[d + 3] = rgbaTopDown[s + 3] // A
    }
  }
  const stride = Math.ceil(width / 32) * 4
  const and = Buffer.alloc(stride * height) // 全 0 = 由 XOR 的 alpha 决定透明

  const bih = Buffer.alloc(40)
  bih.writeUInt32LE(40, 0)
  bih.writeInt32LE(width, 4)
  bih.writeInt32LE(height * 2, 8) // XOR 与 AND 上下叠放
  bih.writeUInt16LE(1, 12)  // planes
  bih.writeUInt16LE(32, 14) // bpp
  bih.writeUInt32LE(0, 16)  // BI_RGB
  bih.writeUInt32LE(xor.length + and.length, 20) // sizeImage
  return Buffer.concat([bih, xor, and])
}

function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // icon
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + images.length * 16
  const entries = []
  for (const img of images) {
    const e = Buffer.alloc(16)
    e.writeUInt8(img.size === 256 ? 0 : img.size, 0)
    e.writeUInt8(img.size === 256 ? 0 : img.size, 1)
    e.writeUInt8(0, 2)
    e.writeUInt8(0, 3)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(img.buf.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    offset += img.buf.length
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.buf)])
}

;(async () => {
  const images = []
  for (const size of sizes) {
    const { data } = await sharp(path.join(build, 'icon.png'))
      .resize(size, size)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    images.push({ size, buf: dibEntry(size, size, data) })
  }
  const ico = buildIco(images)
  fs.writeFileSync(path.join(build, 'icon.ico'), ico)
  console.log(`ICO_OK sizes=${sizes.join(',')} bytes=${ico.length}`)
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
