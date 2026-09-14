'use strict'

/**
 * lib/plugin-sync.js 单测：发布集合（清单/退避）、哈希比对、受管清理的安全边界。
 * 运行：node lib/plugin-sync.test.js
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { syncPluginDir, compareTrees, publishSet, RECORD_NAME } = require('./plugin-sync')

let pass = 0
const ok = (name, fn) => {
  try {
    fn()
    pass++
    console.log('PASS', name)
  } catch (err) {
    console.error('FAIL', name, '\n ', err.message)
    process.exitCode = 1
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-sync-'))
const tmp = (name) => {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
const write = (dir, rel, text) => {
  const abs = path.join(dir, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, text)
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8')
const has = (dir, rel) => fs.existsSync(path.join(dir, rel))

/** 造一个带清单的插件源：entry + lib + docs + 一个被 exclude 的测试文件 + src 源码。 */
function makeManifestSource(name, { version = '1.0.0' } = {}) {
  const src = tmp(`src-${name}`)
  write(src, 'package.json', JSON.stringify({ name: `@dsh-local/${name}`, version }))
  write(src, 'index.js', 'module.exports = {}\n')
  write(src, 'client.js', '// built\n')
  write(src, 'lib/store.js', 'exports.store = 1\n')
  write(src, 'lib/companion.cordis.yml', 'plugins: []\n')
  write(src, 'lib/editor-session.js', '// 测试专用 re-export\n')
  write(src, 'src/shared/editor-session.js', 'export const createEditorSession = () => {}\n')
  write(src, 'test/p1-regression.mjs', '// 测试\n')
  write(src, 'CONTRACT.md', '# 契约\n')
  write(src, 'runtime-manifest.json', JSON.stringify({
    root: `plugin/${name}`,
    entry: [`plugin/${name}/package.json`, `plugin/${name}/index.js`, `plugin/${name}/client.js`],
    files: [`plugin/${name}/lib/store.js`, `plugin/${name}/lib/companion.cordis.yml`],
    docs: [`plugin/${name}/CONTRACT.md`],
    exclude: [`plugin/${name}/lib/editor-session.js`],
  }, null, 2))
  return src
}

/** 无清单插件（dialog-optimize / shell-settings 形状）。 */
function makePlainSource(name, { version = '1.0.0' } = {}) {
  const src = tmp(`plain-${name}`)
  write(src, 'package.json', JSON.stringify({ name: `@dsh-local/${name}`, version }))
  write(src, 'index.js', 'module.exports = {}\n')
  write(src, 'client.js', '// built\n')
  write(src, 'lib/a.js', 'exports.a = 1\n')
  write(src, 'notes.txt', '不该被复制（扩展名不在退避集合里）\n')
  return src
}

console.log('--- 发布集合')

ok('R1 有清单时只发布 entry/files/docs + 清单自身', () => {
  const src = makeManifestSource('wm')
  const { source, files } = publishSet(src)
  assert.equal(source, 'manifest')
  assert.deepEqual(files, [
    'CONTRACT.md', 'client.js', 'index.js', 'lib/companion.cordis.yml', 'lib/store.js',
    'package.json', 'runtime-manifest.json',
  ])
  assert.ok(!files.some((f) => f.startsWith('test/')), '测试文件不该进发布集合')
  assert.ok(!files.some((f) => f.startsWith('src/')), '源码不该进发布集合')
  assert.ok(!files.includes('lib/editor-session.js'), 'exclude 的文件不进发布集合')
})

ok('R2 无清单时退回按扩展名递归（老行为）', () => {
  const src = makePlainSource('dialog-optimize')
  const { source, files } = publishSet(src)
  assert.equal(source, 'fallback')
  assert.deepEqual(files, ['client.js', 'index.js', 'lib/a.js', 'package.json'])
})

console.log('--- 同步：复制 / 更新 / 幂等')

ok('R3 首次同步复制发布集合，并落在受管清单里', () => {
  const src = makeManifestSource('wm')
  const dest = tmp('dest-first')
  const r = syncPluginDir({ srcDir: src, destDir: dest })
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.equal(r.source, 'manifest')
  assert.deepEqual(r.copied.sort(), ['CONTRACT.md', 'client.js', 'index.js', 'lib/companion.cordis.yml', 'lib/store.js', 'package.json', 'runtime-manifest.json'])
  assert.equal(has(dest, 'test/p1-regression.mjs'), false)
  assert.equal(has(dest, 'lib/editor-session.js'), false)
  const record = JSON.parse(read(dest, RECORD_NAME))
  assert.equal(record.version, '1.0.0')
  assert.equal(Object.keys(record.files).length, 7)
  assert.match(record.files['client.js'], /^[0-9a-f]{64}$/)
})

ok('R4 重复同步零改动（幂等），源改动后只更新那一个文件', () => {
  const src = makeManifestSource('wm')
  const dest = tmp('dest-idem')
  syncPluginDir({ srcDir: src, destDir: dest })
  const again = syncPluginDir({ srcDir: src, destDir: dest })
  assert.deepEqual([again.copied, again.updated, again.removed], [[], [], []])
  assert.equal(again.unchanged, 7)
  write(src, 'lib/store.js', 'exports.store = 2\n')
  const third = syncPluginDir({ srcDir: src, destDir: dest })
  assert.deepEqual(third.updated, ['lib/store.js'])
  assert.equal(read(dest, 'lib/store.js'), 'exports.store = 2\n')
})

console.log('--- 清理的安全边界')

ok('R5 上一版受管、这一版不发布 → 删除（test/ 从 profile 移除的迁移路径）', () => {
  const src = makePlainSource('wm2')
  const dest = tmp('dest-prune')
  write(dest, 'test/old.mjs', '// 上一版被种进来的测试脚本\n')
  write(dest, 'lib/a.js', 'exports.a = 1\n')
  write(dest, 'index.js', 'module.exports = {}\n')
  write(dest, 'client.js', '// built\n')
  write(dest, 'package.json', JSON.stringify({ name: '@dsh-local/wm2', version: '0.9.0' }))
  // 模拟上一版受管清单：含 test/old.mjs
  const { sha256 } = require('./plugin-sync')
  write(dest, RECORD_NAME, JSON.stringify({
    version: '0.9.0',
    files: {
      'test/old.mjs': sha256(path.join(dest, 'test/old.mjs')),
      'index.js': sha256(path.join(dest, 'index.js')),
      'lib/a.js': sha256(path.join(dest, 'lib/a.js')),
    },
  }))
  const r = syncPluginDir({ srcDir: src, destDir: dest })
  assert.deepEqual(r.removed, ['test/old.mjs'])
  assert.equal(has(dest, 'test/old.mjs'), false)
})

ok('R6 非受管文件一律保留并上报（绝不删用户文件）', () => {
  const src = makeManifestSource('wm')
  const dest = tmp('dest-foreign')
  syncPluginDir({ srcDir: src, destDir: dest })
  write(dest, 'lib/user-notes.md', '我自己加的备注\n')
  write(dest, 'user-patch.yml', 'x: 1\n')
  const r = syncPluginDir({ srcDir: src, destDir: dest })
  assert.deepEqual(r.foreign.sort(), ['lib/user-notes.md', 'user-patch.yml'])
  assert.deepEqual(r.removed, [])
  assert.equal(read(dest, 'lib/user-notes.md'), '我自己加的备注\n')
})

ok('R7 受管但已被用户改过的旧文件 → 保留并计入 keptEdited', () => {
  const src = makeManifestSource('wm')
  const dest = tmp('dest-edited')
  syncPluginDir({ srcDir: src, destDir: dest })
  // 模拟「上一版发布过 lib/legacy.js，用户改过它」
  write(dest, 'lib/legacy.js', '用户改过的内容\n')
  const record = JSON.parse(read(dest, RECORD_NAME))
  record.files['lib/legacy.js'] = 'a'.repeat(64) // 与磁盘内容不符 → 视为用户改动
  fs.writeFileSync(path.join(dest, RECORD_NAME), JSON.stringify(record))
  const r = syncPluginDir({ srcDir: src, destDir: dest })
  assert.deepEqual(r.keptEdited, ['lib/legacy.js'])
  assert.equal(has(dest, 'lib/legacy.js'), true)
})

ok('R8 首次同步（无受管清单）不删除任何既有文件', () => {
  const src = makeManifestSource('wm')
  const dest = tmp('dest-norecord')
  write(dest, 'lib/legacy.js', '历史遗留\n')
  const r = syncPluginDir({ srcDir: src, destDir: dest })
  assert.deepEqual(r.removed, [])
  assert.deepEqual(r.foreign, ['lib/legacy.js'])
  assert.equal(has(dest, 'lib/legacy.js'), true)
})

console.log('--- 比对（验收脚本判据）')

ok('R9 一致时 ok，改动/缺失/多余各自上报', () => {
  const src = makeManifestSource('wm')
  const dest = tmp('dest-cmp')
  syncPluginDir({ srcDir: src, destDir: dest })
  let c = compareTrees(src, dest)
  assert.equal(c.ok, true)
  assert.equal(c.same.length, 7)
  assert.deepEqual([c.missing, c.drift, c.extra], [[], [], []])
  write(dest, 'client.js', '// 旧的\n')
  fs.rmSync(path.join(dest, 'lib/store.js'))
  write(dest, 'lib/stray.js', 'x\n')
  c = compareTrees(src, dest)
  assert.equal(c.ok, false)
  assert.deepEqual(c.drift.map((d) => d.rel), ['client.js'])
  assert.deepEqual(c.missing.map((d) => d.rel), ['lib/store.js'])
  assert.deepEqual(c.extra.map((d) => d.rel), ['lib/stray.js'])
})

ok('R10 源缺 package.json 时比对判失败，不抛异常', () => {
  const c = compareTrees(tmp('empty-src'), tmp('dest-cmp'))
  assert.equal(c.ok, false)
  assert.equal(c.same.length, 0)
})

console.log(`\nplugin-sync: ${pass} 项通过`)
fs.rmSync(root, { recursive: true, force: true })
