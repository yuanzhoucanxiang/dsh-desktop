'use strict'

/* 原子化持久层（atomic-file + settings-store）单测。
 * 跑法：node lib/atomic-file.test.js（纯 node，零 Electron 依赖）。
 * 覆盖事故史：BOM 崩内核、半截文件回落默认、重写 manifest 丢条目。 */

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { writeFileAtomic, writeJsonAtomic, readJsonSafe, backupFile } = require('./atomic-file')
const { createSettingsStore } = require('./settings-store')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-atomic-'))
let passed = 0
function t(name, fn) {
  fn()
  passed++
  console.log(`PASS ${name}`)
}

const p = (n) => path.join(root, n)

// ── atomic-file ─────────────────────────────────────────────────────────────

t('writeJsonAtomic 写出可读 JSON（带换行）', () => {
  const f = p('a.json')
  writeJsonAtomic(f, { x: 1, list: [1, 2, 3] })
  const raw = fs.readFileSync(f, 'utf8')
  assert.ok(raw.endsWith('\n'))
  assert.deepStrictEqual(readJsonSafe(f), { x: 1, list: [1, 2, 3] })
})

t('覆盖已有文件：新内容生效、不留 .tmp 残留', () => {
  const f = p('b.json')
  writeJsonAtomic(f, { v: 1 })
  writeJsonAtomic(f, { v: 2 })
  assert.deepStrictEqual(readJsonSafe(f), { v: 2 })
  const leftovers = fs.readdirSync(root).filter((x) => x.includes('.tmp'))
  assert.strictEqual(leftovers.length, 0, `tmp leftover: ${leftovers}`)
})

t('writeJsonAtomic 自动创建多级目录', () => {
  const f = p('deep/nested/c.json')
  writeJsonAtomic(f, { ok: true })
  assert.deepStrictEqual(readJsonSafe(f), { ok: true })
})

t('readJsonSafe 容忍 UTF-8 BOM（PS5.1 Set-Content 产物）', () => {
  const f = p('bom.json')
  fs.writeFileSync(f, '\uFEFF{"a":1}', 'utf8')
  assert.deepStrictEqual(readJsonSafe(f), { a: 1 })
})

t('readJsonSafe 对半截/非法 JSON 返回 null 而非抛', () => {
  const f = p('broken.json')
  fs.writeFileSync(f, '{"a":1,', 'utf8') // 半截
  assert.strictEqual(readJsonSafe(f), null)
  fs.writeFileSync(f, 'not json at all', 'utf8')
  assert.strictEqual(readJsonSafe(f), null)
})

t('readJsonSafe 对缺失文件返回 null', () => {
  assert.strictEqual(readJsonSafe(p('nope.json')), null)
})

t('writeFileAtomic 可写文本（内核补丁 yml 场景）', () => {
  const f = p('kernel.patch.yml')
  writeFileAtomic(f, '- insert:\n  - id: review-bridge\n')
  assert.strictEqual(fs.readFileSync(f, 'utf8'), '- insert:\n  - id: review-bridge\n')
})

t('backupFile 生成 .bak 副本（RMW 前保险）', () => {
  const f = p('bak.json')
  writeJsonAtomic(f, { keep: true })
  assert.ok(backupFile(f))
  assert.deepStrictEqual(readJsonSafe(f + '.bak'), { keep: true })
})

// ── settings-store ───────────────────────────────────────────────────────────

const defaults = { autoLaunch: false, theme: 'deep', globalHotkey: 'Control+Alt+D' }

t('settings-store：缺失文件 → 纯默认', () => {
  const s = createSettingsStore({ file: p('s1.json'), defaults })
  assert.deepStrictEqual(s.load(), defaults)
})

t('settings-store：磁盘文件与默认值合并（新默认项自动补全）', () => {
  const f = p('s2.json')
  writeJsonAtomic(f, { autoLaunch: true }) // 旧磁盘文件缺 theme/globalHotkey
  const s = createSettingsStore({ file: f, defaults })
  const loaded = s.load()
  assert.strictEqual(loaded.autoLaunch, true)
  assert.strictEqual(loaded.theme, 'deep')
  assert.strictEqual(loaded.globalHotkey, 'Control+Alt+D')
})

t('settings-store：BOM 磁盘文件也能读', () => {
  const f = p('s3.json')
  fs.writeFileSync(f, '\uFEFF{"theme":"seascape"}', 'utf8')
  const s = createSettingsStore({ file: f, defaults })
  assert.strictEqual(s.load().theme, 'seascape')
})

t('settings-store：损坏文件 → 纯默认（不丢进程）', () => {
  const f = p('s4.json')
  fs.writeFileSync(f, '{"theme":', 'utf8')
  const s = createSettingsStore({ file: f, defaults })
  assert.deepStrictEqual(s.load(), defaults)
})

t('settings-store：save 原子写后可读回', () => {
  const f = p('s5.json')
  const s = createSettingsStore({ file: f, defaults })
  s.save({ autoLaunch: true, theme: 'palis', globalHotkey: '' })
  assert.deepStrictEqual(readJsonSafe(f), { autoLaunch: true, theme: 'palis', globalHotkey: '' })
})

t('settings-store：migrate 钩子在合并默认前生效', () => {
  const f = p('s6.json')
  writeJsonAtomic(f, { oldKey: 1 })
  const s = createSettingsStore({
    file: f,
    defaults: { newKey: 'x' },
    migrate: (d) => ({ ...d, newKey: d.oldKey === 1 ? 'migrated' : d.newKey }),
  })
  assert.strictEqual(s.load().newKey, 'migrated')
})

fs.rmSync(root, { recursive: true, force: true })
console.log(`ATOMIC_OK ${passed} assertions passed`)
