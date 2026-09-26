'use strict'
/* profile 内核包链接迁移的单测：临时目录里摆假运行时与假 profile，逐条验证规则。 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { migrateProfileKernelLinks, versionFamily } = require('./profile-kernel-links')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkl-test-'))
let passed = 0
const check = (name, cond) => {
  assert.ok(cond, name)
  passed += 1
  console.log(`  ok ${name}`)
}

const mkPkg = (dir, version) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: path.basename(dir), version }))
}
const mkLink = (link, target) => {
  fs.mkdirSync(path.dirname(link), { recursive: true })
  fs.symlinkSync(target, link, 'junction')
}

/* 假运行时：@deepseek-ai/{dsh@0.1.7-rc.2, dsh-session@0.1.7-rc.2, dsh-kept@0.1.7-rc.2, dsh-stale@0.1.7-rc.2} */
const runtimeNm = path.join(tmp, 'runtime', 'node_modules')
mkPkg(path.join(runtimeNm, '@deepseek-ai', 'dsh'), '0.1.7-rc.2')
mkPkg(path.join(runtimeNm, '@deepseek-ai', 'dsh-session'), '0.1.7-rc.2')
mkPkg(path.join(runtimeNm, '@deepseek-ai', 'dsh-kept'), '0.1.7-rc.2')
mkPkg(path.join(runtimeNm, '@deepseek-ai', 'dsh-stale'), '0.1.7-rc.2')

/* 假旧运行时：dsh@0.1.1-rc.1、dsh-gone@0.1.1-rc.1（新内核已无此包）、dsh-same@0.1.7-rc.1（同族异份） */
const oldNm = path.join(tmp, 'old-runtime', 'node_modules')
mkPkg(path.join(oldNm, '@deepseek-ai', 'dsh'), '0.1.1-rc.1')
mkPkg(path.join(oldNm, '@deepseek-ai', 'dsh-gone'), '0.1.1-rc.1')
mkPkg(path.join(oldNm, '@deepseek-ai', 'dsh-same'), '0.1.7-rc.1')
/* 目标存活哨兵：链接被摘/重指时，目标目录内容必须分毫不动
 * （2026-09-26 事故：rmSync recursive 在 Electron 的 Node 上顺 junction 删了目标）。 */
const sentinel = path.join(oldNm, '@deepseek-ai', 'dsh', 'lib', 'sentinel.js')
fs.mkdirSync(path.dirname(sentinel), { recursive: true })
fs.writeFileSync(sentinel, '// must survive')
const goneSentinel = path.join(oldNm, '@deepseek-ai', 'dsh-gone', 'lib', 'sentinel.js')
fs.mkdirSync(path.dirname(goneSentinel), { recursive: true })
fs.writeFileSync(goneSentinel, '// must survive')

const scope = path.join(tmp, 'profiles', 'node_modules', '@deepseek-ai')
fs.mkdirSync(scope, { recursive: true })
/* 1 异族链接 → 重指 */
mkLink(path.join(scope, 'dsh'), path.join(oldNm, '@deepseek-ai', 'dsh'))
/* 2 悬空链接 → 重指 */
mkLink(path.join(scope, 'dsh-session'), path.join(oldNm, '@deepseek-ai', 'dsh-session'))
/* 3 同族异份链接 → 保留 */
mkLink(path.join(scope, 'dsh-same'), path.join(oldNm, '@deepseek-ai', 'dsh-same'))
/* 4 内核已无此包的链接 → 摘除 */
mkLink(path.join(scope, 'dsh-gone'), path.join(oldNm, '@deepseek-ai', 'dsh-gone'))
/* 5 同族真目录 → 保留 */
mkPkg(path.join(scope, 'dsh-kept'), '0.1.7-rc.2')
/* 6 异族真目录且本轮内核提供同名包（真遮蔽）→ 改名让位 */
mkPkg(path.join(scope, 'dsh-stale'), '0.1.1-rc.1')
/* 6b 异族真目录但本轮内核没有这个包 → 保留（不构成遮蔽，可能有插件引用） */
mkPkg(path.join(scope, 'dsh-old'), '0.1.1-rc.1')
/* 7 坏真目录（无 package.json）→ 改名让位 */
fs.mkdirSync(path.join(scope, 'dsh-broken'), { recursive: true })
fs.writeFileSync(path.join(scope, 'dsh-broken', 'index.js'), 'console.log(1)')
/* 8 作用域外的插件链接 → 绝不动 */
fs.mkdirSync(path.join(tmp, 'checkout'), { recursive: true })
const pluginScope = path.join(tmp, 'profiles', 'node_modules', '@dsh-local')
mkLink(path.join(pluginScope, 'palis-theme-panel'), path.join(tmp, 'checkout'))
const pluginTargetBefore = fs.realpathSync(path.join(pluginScope, 'palis-theme-panel'))

const r = migrateProfileKernelLinks({ levels: [path.join(tmp, 'profiles', 'node_modules')], runtimeNodeModules: runtimeNm })

check('异族链接被重指到本轮运行时', r.repointed.includes('dsh') && versionFamily(require(path.join(scope, 'dsh', 'package.json')).version) === '0.1.7')
check('悬空链接被重指', r.repointed.includes('dsh-session'))
check('同族异份链接保留（不做无谓翻转）', r.kept >= 1 && fs.realpathSync(path.join(scope, 'dsh-same')) === fs.realpathSync(path.join(oldNm, '@deepseek-ai', 'dsh-same')))
check('内核已无此包的链接被摘除', r.removed.some((s) => s.startsWith('dsh-gone')) && !fs.existsSync(path.join(scope, 'dsh-gone')))
check('同族真目录保留', fs.existsSync(path.join(scope, 'dsh-kept', 'package.json')))
check('异族真目录（真遮蔽）改名让位', !fs.existsSync(path.join(scope, 'dsh-stale')) && fs.existsSync(path.join(scope, '.stale-dsh-stale', 'package.json')))
check('异族真目录（内核无此包）保留', fs.existsSync(path.join(scope, 'dsh-old', 'package.json')) && r.foreignReal.some((s) => s.startsWith('dsh-old@')))
check('坏真目录改名让位', !fs.existsSync(path.join(scope, 'dsh-broken')) && fs.existsSync(path.join(scope, '.stale-dsh-broken')))
check('作用域外的插件链接原样不动', fs.realpathSync(path.join(pluginScope, 'palis-theme-panel')) === pluginTargetBefore)
check('重指后旧目标内容分毫不动（哨兵 1）', fs.readFileSync(sentinel, 'utf8').includes('must survive'))
check('摘除链接后旧目标内容分毫不动（哨兵 2）', fs.readFileSync(goneSentinel, 'utf8').includes('must survive'))
check('幂等：再跑一遍零改动', (() => {
  const r2 = migrateProfileKernelLinks({ levels: [path.join(tmp, 'profiles', 'node_modules')], runtimeNodeModules: runtimeNm })
  return r2.repointed.length === 0 && r2.removed.length === 0 && r2.renamed.length === 0
})())

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\nPROFILE_KERNEL_LINKS_TEST_OK (${passed} 项)`)
