'use strict'

/* bundleBootable 单测：覆盖外壳踩过的"会炸内核"的静态事故形态。
 * 跑法：node lib/profile-inspect.test.js（纯 node，零 Electron 依赖）。 */

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { bundleBootable } = require('./profile-inspect')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-inspect-'))
const profileDir = path.join(root, 'web')
const nm = path.join(profileDir, 'node_modules')
fs.mkdirSync(nm, { recursive: true })

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8')
}

let passed = 0
function t(name, fn) {
  fn()
  passed++
  console.log(`PASS ${name}`)
}

// 基线：健康 manifest（link 依赖指向真实目标）
const linkTarget = path.join(root, 'plugins', 'dsh-ok')
fs.mkdirSync(linkTarget, { recursive: true })
writeJson(path.join(linkTarget, 'package.json'), { name: 'dsh-ok', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } })
const manifestPath = path.join(profileDir, 'package.json')
writeJson(manifestPath, {
  name: 'web-profile',
  dependencies: {
    'dsh-ok': `link:${linkTarget}`,
    'dsh-no-bundle': '^1.0.0',
    'dsh-missing': '^1.0.0',
    'dsh-dangling': `link:${path.join(root, 'gone')}`,
    'dsh-unreadable': '^1.0.0',
    'dsh-broken-link': `link:${path.join(root, 'not-exist')}`,
  },
  dsh: { profile: { bundles: ['dsh-ok', 'dsh-no-bundle', 'dsh-missing', 'dsh-dangling', 'dsh-unreadable', 'dsh-broken-link'] } },
})

// 健康插件：目录 + dsh.bundle.patch
writeJson(path.join(nm, 'dsh-ok', 'package.json'), { name: 'dsh-ok', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } })

// 缺 dsh.bundle 声明：有目录、有 package.json，但没有 dsh.bundle.patch
writeJson(path.join(nm, 'dsh-no-bundle', 'package.json'), { name: 'dsh-no-bundle', version: '1.0.0' })

// 缺条目：node_modules 里根本没有
// (dsh-missing 不建目录)

// 悬空链接：junction 指向不存在的目标（junction 无需管理员权限）
try {
  fs.symlinkSync(path.join(root, 'gone'), path.join(nm, 'dsh-dangling'), 'junction')
} catch {
  // 环境不支持 junction 时退化为"缺条目"，一样该判不可加载
  console.log('SKIP junction creation (fallback to missing-entry semantics)')
}

// 不可读：node_modules 条目是普通文件，读 package.json 失败
fs.writeFileSync(path.join(nm, 'dsh-unreadable'), 'not a dir', 'utf8')

// link 目标缺失：目录与声明都在，但 link: 指向的目录不存在
writeJson(path.join(nm, 'dsh-broken-link', 'package.json'), { name: 'dsh-broken-link', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } })

const opts = { manifestPath, nodeModulesDir: nm }

t('健康插件：可加载', () => {
  assert.deepStrictEqual(bundleBootable('dsh-ok', opts), { ok: true })
})

t('缺 dsh.bundle 声明：不可加载', () => {
  const r = bundleBootable('dsh-no-bundle', opts)
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /dsh\.bundle/)
})

t('node_modules 缺条目：不可加载', () => {
  const r = bundleBootable('dsh-missing', opts)
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /缺失|悬空/)
})

t('链接悬空（目标不存在）：不可加载', () => {
  const r = bundleBootable('dsh-dangling', opts)
  assert.strictEqual(r.ok, false)
})

t('package.json 不可读：不可加载', () => {
  const r = bundleBootable('dsh-unreadable', opts)
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /不可读/)
})

t('link 声明目标不存在：不可加载（即使目录本身健康）', () => {
  const r = bundleBootable('dsh-broken-link', opts)
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /link 目标不存在/)
})

t('缺 manifestPath：报错而非崩溃', () => {
  const r = bundleBootable('dsh-ok', {})
  assert.strictEqual(r.ok, false)
})

// 清理
fs.rmSync(root, { recursive: true, force: true })
console.log(`PROFILE_INSPECT_OK ${passed} assertions passed`)
