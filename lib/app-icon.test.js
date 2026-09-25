'use strict'

/**
 * lib/app-icon.js 单测：ICO 容器结构、预设表、快捷方式脚本构建（含参数注入面）。
 * 运行：node lib/app-icon.test.js
 */

const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { PRESETS, ICO_SIZES, isValidSetting, icoFromPngFrames, buildUpdateShortcutsScript, presetPaths } = require('./app-icon')

let pass = 0
const ok = (name, fn) => {
  try {
    fn()
    pass++
    console.log('PASS', name)
  } catch (err) {
    console.error('FAIL', name, '\n  ', err.message)
    process.exitCode = 1
  }
}

console.log('--- ICO 容器')

ok('目录项/偏移/尺寸编码正确（256 编码为 0）', () => {
  const frames = ICO_SIZES.map((size) => ({ size, png: Buffer.alloc(size % 7 + 10, size) }))
  const ico = icoFromPngFrames(frames)
  assert.equal(ico.readUInt16LE(0), 0) // reserved
  assert.equal(ico.readUInt16LE(2), 1) // type icon
  assert.equal(ico.readUInt16LE(4), ICO_SIZES.length)
  let offset = 6 + 16 * ICO_SIZES.length
  ICO_SIZES.forEach((size, i) => {
    const base = 6 + i * 16
    assert.equal(ico[base], size === 256 ? 0 : size, `width@${size}`)
    assert.equal(ico[base + 1], size === 256 ? 0 : size, `height@${size}`)
    assert.equal(ico.readUInt16LE(base + 4), 1) // planes
    assert.equal(ico.readUInt16LE(base + 6), 32) // bpp
    const frame = frames[i]
    assert.equal(ico.readUInt32LE(base + 8), frame.png.length, `bytes@${size}`)
    assert.equal(ico.readUInt32LE(base + 12), offset, `offset@${size}`)
    offset += frame.png.length
  })
  assert.equal(ico.length, offset, '总长度 = 头 + 目录 + 全部帧')
  // 帧内容原样落在偏移处（帧数据以 size 值填充）
  assert.equal(ico.readUInt8(6 + 16 * ICO_SIZES.length), frames[0].png[0])
})

ok('非法帧被过滤：空数组/超界尺寸/非 Buffer 抛错或降级', () => {
  assert.throws(() => icoFromPngFrames([]), /no valid frames/)
  assert.throws(() => icoFromPngFrames([{ size: 300, png: Buffer.alloc(4) }]), /no valid frames/)
  assert.throws(() => icoFromPngFrames([{ size: 32, png: 'nope' }]), /no valid frames/)
  const ico = icoFromPngFrames([{ size: 32, png: Buffer.alloc(8) }, { size: 999, png: Buffer.alloc(8) }])
  assert.equal(ico.readUInt16LE(4), 1, '超界尺寸的帧被剔除')
})

console.log('--- 预设表')

ok('预设 key 唯一、含 default；文件在仓库里真实存在（防止预设指向悬空资源）', () => {
  const root = path.resolve(__dirname, '..')
  const keys = new Set(PRESETS.map((p) => p.key))
  assert.equal(keys.size, PRESETS.length)
  assert.ok(keys.has('default'))
  for (const p of PRESETS) {
    const { png } = presetPaths(p, root)
    assert.ok(fs.existsSync(png), `png 存在：${p.png}`)
  }
})

ok('isValidSetting：预设 key / custom 为真，其他为假', () => {
  for (const p of PRESETS) assert.equal(isValidSetting(p.key), true)
  assert.equal(isValidSetting('custom'), true)
  assert.equal(isValidSetting('default'), true)
  for (const bad of [null, undefined, 42, '', 'Default', 'CUSTOM', '../etc', 'default;rm']) assert.equal(isValidSetting(bad), false)
})

console.log('--- 快捷方式脚本')

ok('脚本参数走 base64 内嵌：路径里的引号/特殊字符不破坏结构', () => {
  const tricky = `E:\\Deep's "Harness" $(calc) ; rm  \\目录\\app.exe`
  const s = buildUpdateShortcutsScript(tricky, 'C:\\ic\\o-n.ico')
  // base64 段里不可能出现引号或 $()
  const m = s.match(/FromBase64String\('([A-Za-z0-9+/=]*)'\)/g)
  assert.equal(m.length, 2, '恰好两处 base64 参数')
  for (const seg of m) assert.ok(!/['"$(;]/.test(seg.replace(/FromBase64String\('/, '').replace(/'\)/, '')))
  // 还原语义：解码后与原文一致
  const b64 = s.match(/FromBase64String\('([A-Za-z0-9+/=]*)'\)/)[1]
  assert.equal(Buffer.from(b64, 'base64').toString('utf8'), tricky)
  assert.ok(s.includes("Write-Output ('CHANGED=' + $changed)"))
})

ok('reset 模式把 IconLocation 指回 exe 自身', () => {
  const s = buildUpdateShortcutsScript('E:\\app\\DeepSeek Harness Desktop.exe', '-reset')
  assert.ok(s.includes("if($ico -eq '-reset'){ $lnk.IconLocation=\"$exe,0\" }"))
})

ok('扫描范围含桌面/开始菜单/任务栏固定区', () => {
  const s = buildUpdateShortcutsScript('E:\\a.exe', 'C:\\x.ico')
  assert.ok(s.includes("GetFolderPath('Desktop')"))
  assert.ok(s.includes("GetFolderPath('CommonDesktopDirectory')"))
  assert.ok(s.includes("Join-Path [Environment]::GetFolderPath('StartMenu') 'Programs'"))
  assert.ok(s.includes('User Pinned\\TaskBar'))
})

console.log(`\napp-icon: ${pass} 项通过`)
