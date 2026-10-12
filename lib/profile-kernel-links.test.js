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

/* 假运行时：@deepseek-ai/{dsh@0.1.7-rc.2, dsh-session@0.1.7-rc.2, dsh-kept@0.1.7-rc.2, dsh-stale@0.1.7-rc.2,
 *   dsh-tools@0.2.0-rc.2, cordis@4.0.4（框架包：自身版本自成体系，不跟内核版本族）} */
const runtimeNm = path.join(tmp, 'runtime', 'node_modules')
mkPkg(path.join(runtimeNm, '@deepseek-ai', 'dsh'), '0.1.7-rc.2')
mkPkg(path.join(runtimeNm, '@deepseek-ai', 'dsh-session'), '0.1.7-rc.2')
mkPkg(path.join(runtimeNm, '@deepseek-ai', 'dsh-kept'), '0.1.7-rc.2')
mkPkg(path.join(runtimeNm, '@deepseek-ai', 'dsh-stale'), '0.1.7-rc.2')
mkPkg(path.join(runtimeNm, '@deepseek-ai', 'dsh-tools'), '0.2.0-rc.2')
mkPkg(path.join(runtimeNm, '@deepseek-ai', 'cordis'), '4.0.4')
mkPkg(path.join(runtimeNm, '@deepseek-ai', 'schemastery'), '3.18.4')
mkPkg(path.join(runtimeNm, '@deepseek-ai', 'cosmokit'), '1.8.5')

/* 假旧运行时（= 另一棵运行时树）：dsh@0.1.1-rc.1、dsh-gone@0.1.1-rc.1（新内核已无此包）、
 *   dsh-same@0.1.7-rc.1（同族异份）、dsh-tools@0.2.0-rc.2（**与本轮逐位同版**，2026-10-11 事故形状）、
 *   cordis@4.0.4（框架包的同版本副本）、schemastery@3.18.4（框架包的同版本副本）、cosmokit@1.8.0（旧版本） */
const oldNm = path.join(tmp, 'old-runtime', 'node_modules')
mkPkg(path.join(oldNm, '@deepseek-ai', 'dsh'), '0.1.1-rc.1')
mkPkg(path.join(oldNm, '@deepseek-ai', 'dsh-gone'), '0.1.1-rc.1')
mkPkg(path.join(oldNm, '@deepseek-ai', 'dsh-same'), '0.1.7-rc.1')
mkPkg(path.join(oldNm, '@deepseek-ai', 'dsh-tools'), '0.2.0-rc.2')
mkPkg(path.join(oldNm, '@deepseek-ai', 'cordis'), '4.0.4')
mkPkg(path.join(oldNm, '@deepseek-ai', 'schemastery'), '3.18.4')
mkPkg(path.join(oldNm, '@deepseek-ai', 'cosmokit'), '1.8.0')
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
/* 3 同族异份链接（本轮运行时没有这个包）→ 保留：没有可指向的目标，不构成第二份 */
mkLink(path.join(scope, 'dsh-same'), path.join(oldNm, '@deepseek-ai', 'dsh-same'))
/* 4 内核已无此包的链接 → 摘除 */
mkLink(path.join(scope, 'dsh-gone'), path.join(oldNm, '@deepseek-ai', 'dsh-gone'))
/* 5 真目录副本（同版本，本轮内核提供同名包）→ 让位并重指到本轮运行时 */
mkPkg(path.join(scope, 'dsh-kept'), '0.1.7-rc.2')
/* 6 异族真目录且本轮内核提供同名包（真遮蔽）→ 让位并重指 */
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
/* 9 框架包已指向本轮运行时（自身版本 4.0.4，永远对不上内核族）→ 保留，不重指。
 *   这是 2026-10-08 实测到的噪声源：每次启动都把这批链接 unlink+link 一遍。 */
mkLink(path.join(scope, 'cordis'), path.join(runtimeNm, '@deepseek-ai', 'cordis'))
/* 10 框架包指向旧运行时的**同版本**副本（schemastery 3.18.4）→ 重指（树外副本=第二个模块实例） */
mkLink(path.join(scope, 'schemastery'), path.join(oldNm, '@deepseek-ai', 'schemastery'))
/* 11 框架包指向旧运行时的旧版本副本（cosmokit 1.8.0 < 本轮 1.8.5）→ 重指到本轮 */
mkLink(path.join(scope, 'cosmokit'), path.join(oldNm, '@deepseek-ai', 'cosmokit'))
/* 12 与本轮逐位同版的树外副本（dsh-tools 0.2.0-rc.2，2026-10-11 事故形状）→ 重指。
 *    旧规则"同版本→保留"正是那次事故的入口：两棵树各一份 → 内核同时加载两份 →
 *    dsh-agent-loop 取不到 ctx.tools[TOOL_RUNTIME_SCHEDULER] → 会话在第一个工具调用处打断。 */
mkLink(path.join(scope, 'dsh-tools'), path.join(oldNm, '@deepseek-ai', 'dsh-tools'))

const r = migrateProfileKernelLinks({ levels: [path.join(tmp, 'profiles', 'node_modules')], runtimeNodeModules: runtimeNm })

check('异族链接被重指到本轮运行时', r.repointed.includes('dsh') && versionFamily(require(path.join(scope, 'dsh', 'package.json')).version) === '0.1.7')
check('悬空链接被重指', r.repointed.includes('dsh-session'))
check('同族异份链接（本轮运行时无此包）保留：没有可指向的目标，不构成第二份', !r.repointed.includes('dsh-same') && fs.realpathSync(path.join(scope, 'dsh-same')) === fs.realpathSync(path.join(oldNm, '@deepseek-ai', 'dsh-same')))
check('逐位同版的树外副本也重指（2026-10-11 事故形状：同版本≠同一模块实例）', r.repointed.includes('dsh-tools') && fs.realpathSync(path.join(scope, 'dsh-tools')) === fs.realpathSync(path.join(runtimeNm, '@deepseek-ai', 'dsh-tools')))
check('内核已无此包的链接被摘除', r.removed.some((s) => s.startsWith('dsh-gone')) && !fs.existsSync(path.join(scope, 'dsh-gone')))
check('真目录副本（同版本）让位并重指到本轮运行时', fs.lstatSync(path.join(scope, 'dsh-kept')).isSymbolicLink() && fs.realpathSync(path.join(scope, 'dsh-kept')) === fs.realpathSync(path.join(runtimeNm, '@deepseek-ai', 'dsh-kept')) && fs.existsSync(path.join(scope, '.stale-dsh-kept', 'package.json')) && r.renamed.some((s) => s.startsWith('dsh-kept@')))
check('异族真目录（真遮蔽）让位并重指', fs.lstatSync(path.join(scope, 'dsh-stale')).isSymbolicLink() && fs.realpathSync(path.join(scope, 'dsh-stale')) === fs.realpathSync(path.join(runtimeNm, '@deepseek-ai', 'dsh-stale')) && fs.existsSync(path.join(scope, '.stale-dsh-stale', 'package.json')))
check('异族真目录（内核无此包）保留', fs.existsSync(path.join(scope, 'dsh-old', 'package.json')) && r.foreignReal.some((s) => s.startsWith('dsh-old@')))
check('坏真目录改名让位', !fs.existsSync(path.join(scope, 'dsh-broken')) && fs.existsSync(path.join(scope, '.stale-dsh-broken')))
check('作用域外的插件链接原样不动', fs.realpathSync(path.join(pluginScope, 'palis-theme-panel')) === pluginTargetBefore)
/* 2026-10-08 修复：框架包（自身版本自成体系）不再每次启动被误判重指 */
check('框架包已指向本轮运行时 → 保留不重指（噪声修复）', !r.repointed.includes('cordis') && fs.realpathSync(path.join(scope, 'cordis')) === fs.realpathSync(path.join(runtimeNm, '@deepseek-ai', 'cordis')))
/* 2026-10-12 修复：树外副本一律重指（旧"同版本等价副本保留"是双副本事故入口） */
check('框架包指向同版本树外副本 → 重指', r.repointed.includes('schemastery') && fs.realpathSync(path.join(scope, 'schemastery')) === fs.realpathSync(path.join(runtimeNm, '@deepseek-ai', 'schemastery')))
check('框架包指向旧版本副本 → 重指到本轮', r.repointed.includes('cosmokit') && fs.realpathSync(path.join(scope, 'cosmokit')) === fs.realpathSync(path.join(runtimeNm, '@deepseek-ai', 'cosmokit')))
check('重指后旧目标内容分毫不动（哨兵 1）', fs.readFileSync(sentinel, 'utf8').includes('must survive'))
check('摘除链接后旧目标内容分毫不动（哨兵 2）', fs.readFileSync(goneSentinel, 'utf8').includes('must survive'))
check('幂等：再跑一遍零改动', (() => {
  const r2 = migrateProfileKernelLinks({ levels: [path.join(tmp, 'profiles', 'node_modules')], runtimeNodeModules: runtimeNm })
  return r2.repointed.length === 0 && r2.removed.length === 0 && r2.renamed.length === 0
})())

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\nPROFILE_KERNEL_LINKS_TEST_OK (${passed} 项)`)
