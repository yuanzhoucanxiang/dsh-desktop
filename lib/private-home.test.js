'use strict'

/* 私有 DSH_HOME 与首次迁移（lib/private-home.js）单测。
 * 跑法：node lib/private-home.test.js（纯 node，零 Electron 依赖）。
 * 重点覆盖：home 解析优先级、迁移只读源目录、链接按链接重建 + 重指、
 * 幂等续跑、skip 项、失败不写 marker（下次重试）。 */

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  resolveHome, migrationNeeded, markerPath, isSkipped, retargetLink, migrateHome,
  PRIVATE_HOME_DIRNAME, DEFAULT_SKIP,
} = require('./private-home')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'))
const HOME = path.join(root, 'user')
const tests = []
let passed = 0
function t(name, fn) { tests.push([name, fn]) }

/** 递归快照（路径 + 大小 + mtimeMs + 文件内容哈希），用于证明源目录零改动。 */
function snapshot(dir) {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name)
      const st = fs.lstatSync(p)
      out.push(`${path.relative(dir, p)}|${st.isSymbolicLink() ? 'link:' + fs.readlinkSync(p) : st.isDirectory() ? 'dir' : 'file:' + fs.readFileSync(p, 'utf8')}`)
      if (st.isDirectory()) walk(p)
    }
  }
  walk(dir)
  return out
}

function mkJunction(target, linkPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true })
  fs.symlinkSync(target, linkPath, 'junction')
}

// ── home 解析 ────────────────────────────────────────────────────────────────

t('默认：私有 ~/.dsh-desktop，源 = ~/.dsh，允许迁移', () => {
  const plan = resolveHome({ env: {}, homedir: HOME })
  assert.strictEqual(plan.home, path.join(HOME, PRIVATE_HOME_DIRNAME))
  assert.strictEqual(plan.mode, 'private')
  assert.strictEqual(plan.sharedHome, path.join(HOME, '.dsh'))
  assert.strictEqual(plan.migrate, true)
  assert.strictEqual(plan.marker, markerPath(plan.home))
})

t('DSH_DESKTOP_HOME=shared：回到共用 home，不迁移', () => {
  const plan = resolveHome({ env: { DSH_DESKTOP_HOME: 'shared' }, homedir: HOME })
  assert.strictEqual(plan.home, path.join(HOME, '.dsh'))
  assert.strictEqual(plan.mode, 'shared')
  assert.strictEqual(plan.migrate, false)
})

t('DSH_DESKTOP_HOME=SHARED：哨兵大小写不敏感', () => {
  assert.strictEqual(resolveHome({ env: { DSH_DESKTOP_HOME: 'SHARED' }, homedir: HOME }).mode, 'shared')
})

t('DSH_DESKTOP_HOME=<路径>：自定义目录，默认不迁移', () => {
  const plan = resolveHome({ env: { DSH_DESKTOP_HOME: path.join(root, 'iso') }, homedir: HOME })
  assert.strictEqual(plan.home, path.join(root, 'iso'))
  assert.strictEqual(plan.mode, 'custom')
  assert.strictEqual(plan.migrate, false)
})

t('DSH_DESKTOP_HOME=<路径> + DSH_DESKTOP_MIGRATE=1：强制迁移', () => {
  const plan = resolveHome({ env: { DSH_DESKTOP_HOME: path.join(root, 'iso'), DSH_DESKTOP_MIGRATE: '1' }, homedir: HOME })
  assert.strictEqual(plan.migrate, true)
})

t('DSH_DESKTOP_HOME 支持 ~ 展开', () => {
  const plan = resolveHome({ env: { DSH_DESKTOP_HOME: '~/custom-dsh' }, homedir: HOME })
  assert.strictEqual(plan.home, path.join(HOME, 'custom-dsh'))
})

t('DSH_HOME=<路径>：只定义「共用」指向哪，不改变默认隔离', () => {
  const plan = resolveHome({ env: { DSH_HOME: path.join(root, 'clihome') }, homedir: HOME })
  assert.strictEqual(plan.home, path.join(HOME, PRIVATE_HOME_DIRNAME))
  assert.strictEqual(plan.mode, 'private')
  assert.strictEqual(plan.sharedHome, path.join(root, 'clihome'))
  assert.strictEqual(plan.migrate, true)
})

t('DSH_HOME + DSH_DESKTOP_HOME=shared：共用目标取 DSH_HOME', () => {
  const plan = resolveHome({ env: { DSH_HOME: path.join(root, 'clihome'), DSH_DESKTOP_HOME: 'shared' }, homedir: HOME })
  assert.strictEqual(plan.home, path.join(root, 'clihome'))
  assert.strictEqual(plan.mode, 'shared')
  assert.strictEqual(plan.migrate, false)
})

t('DSH_DESKTOP_MIGRATE=0：默认私有 home 也不迁移', () => {
  const plan = resolveHome({ env: { DSH_DESKTOP_MIGRATE: '0' }, homedir: HOME })
  assert.strictEqual(plan.mode, 'private')
  assert.strictEqual(plan.migrate, false)
})

t('空白 DSH_DESKTOP_HOME / DSH_HOME 视为未设置', () => {
  const plan = resolveHome({ env: { DSH_DESKTOP_HOME: '   ', DSH_HOME: '  ' }, homedir: HOME })
  assert.strictEqual(plan.mode, 'private')
})

// ── 纯函数 ──────────────────────────────────────────────────────────────────

t('isSkipped：命中项与其子树，相似名不误伤', () => {
  assert.strictEqual(isSkipped('cache', DEFAULT_SKIP), true)
  assert.strictEqual(isSkipped('cache\\attachments\\a.png', DEFAULT_SKIP), true)
  assert.strictEqual(isSkipped('profiles\\desktop\\package.json', DEFAULT_SKIP), true)
  assert.strictEqual(isSkipped('cache2', DEFAULT_SKIP), false)
  assert.strictEqual(isSkipped('profiles\\web\\package.json', DEFAULT_SKIP), false)
})

t('retargetLink：旧 home 内部重指、外部原样、相对原样、剥 \\\\?\\ 前缀', () => {
  const src = path.join(root, 'old')
  const dest = path.join(root, 'new')
  assert.deepStrictEqual(retargetLink(path.join(src, 'plugins', 'x'), src, dest), { target: path.join(dest, 'plugins', 'x'), retargeted: true })
  assert.deepStrictEqual(retargetLink('E:\\other\\pkg', src, dest), { target: 'E:\\other\\pkg', retargeted: false })
  assert.deepStrictEqual(retargetLink('.pnpm\\a\\node_modules\\a', src, dest), { target: '.pnpm\\a\\node_modules\\a', retargeted: false })
  assert.deepStrictEqual(retargetLink('\\\\?\\' + path.join(src, 'a'), src, dest), { target: path.join(dest, 'a'), retargeted: true })
})

// ── 迁移 ────────────────────────────────────────────────────────────────────

/** 造一棵「共享 home」样本树：普通文件、嵌套目录、外部链接、内部链接、悬空链接、skip 项。 */
function buildSampleHome(srcHome) {
  const slash = (p) => p.replace(/\\/g, '/')
  fs.mkdirSync(path.join(srcHome, 'sessions', 'ws', 's1'), { recursive: true })
  fs.writeFileSync(path.join(srcHome, 'sessions', 'ws', 's1', 'session.v4.jsonl.zstd'), 'SESSION-BYTES')
  fs.writeFileSync(path.join(srcHome, '.credentials.yaml'), 'token: abc\n')
  fs.mkdirSync(path.join(srcHome, 'profiles', 'web'), { recursive: true })
  fs.writeFileSync(path.join(srcHome, 'profiles', 'web', 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    dependencies: {
      '@dsh-external/dsh-super-injector': 'link:' + slash(path.join(srcHome, 'plugins', 'super')),
      '@dsh-local/palis-theme-panel': 'link:E:/somewhere/palis',
    },
  }, null, 2) + '\n')
  fs.writeFileSync(path.join(srcHome, 'profiles', 'web', 'pnpm-lock.yaml'),
    `lockfileVersion: '9.0'\n\nimporters:\n  .:\n    dependencies:\n      '@dsh-external/dsh-super-injector':\n        specifier: link:${slash(srcHome)}/plugins/super\n`)
  fs.mkdirSync(path.join(srcHome, 'profiles', 'desktop'), { recursive: true })
  fs.writeFileSync(path.join(srcHome, 'profiles', 'desktop', 'package.json'), '{"name":"desktop"}\n')
  fs.mkdirSync(path.join(srcHome, 'cache'), { recursive: true })
  fs.writeFileSync(path.join(srcHome, 'cache', 'img.bin'), 'CACHE')
  fs.mkdirSync(path.join(srcHome, 'dsh-runtimes', 'primary'), { recursive: true })
  fs.writeFileSync(path.join(srcHome, 'dsh-runtimes', 'primary', 'big.bin'), 'RUNTIME')
  fs.mkdirSync(path.join(srcHome, 'plugins', 'super'), { recursive: true })
  fs.writeFileSync(path.join(srcHome, 'plugins', 'super', 'index.js'), 'module.exports=1\n')
  // 外部链接（运行时树）：原样保留
  const external = path.join(root, 'external-runtime')
  fs.mkdirSync(external, { recursive: true })
  mkJunction(external, path.join(srcHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh'))
  // 内部链接（指向共享 home 自己的 plugins）：应重指到私有 home
  mkJunction(path.join(srcHome, 'plugins', 'super'), path.join(srcHome, 'profiles', 'web', 'node_modules', '@dsh-external', 'super'))
  // 悬空链接：目标不存在也要按链接重建
  mkJunction(path.join(root, 'gone', 'pkg'), path.join(srcHome, 'profiles', 'node_modules', '@aws-crypto', 'util'))
}

t('migrateHome：复制内容、跳过 skip 项、重建链接并重指、写 marker', async () => {
  const src = path.join(root, 'shared-home')
  const dest = path.join(root, 'private-home')
  buildSampleHome(src)
  const before = snapshot(src)

  const r = await migrateHome({ src, dest })
  assert.deepStrictEqual(r.errors, [])
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.copied, 5) // 会话/凭据/web 清单/pnpm 锁/插件源码；desktop+cache+dsh-runtimes 被 skip
  assert.strictEqual(r.linked, 3) // 外部链接 + 内部链接（重指）+ 悬空链接
  assert.strictEqual(r.retargeted, 1)
  assert.strictEqual(r.manifestRetargeted, 1) // package.json 里指向旧 home 的 link:
  assert.strictEqual(r.lockRetargeted, 1) // pnpm-lock.yaml 里的同一路径

  // 内容一致
  assert.strictEqual(fs.readFileSync(path.join(dest, 'sessions', 'ws', 's1', 'session.v4.jsonl.zstd'), 'utf8'), 'SESSION-BYTES')
  assert.strictEqual(fs.readFileSync(path.join(dest, '.credentials.yaml'), 'utf8'), 'token: abc\n')
  // profile 清单：旧 home 的 link 重指到新 home，外部 link 原样
  const manifest = JSON.parse(fs.readFileSync(path.join(dest, 'profiles', 'web', 'package.json'), 'utf8'))
  assert.strictEqual(manifest.dependencies['@dsh-external/dsh-super-injector'],
    'link:' + path.join(dest, 'plugins', 'super').replace(/\\/g, '/'))
  assert.strictEqual(manifest.dependencies['@dsh-local/palis-theme-panel'], 'link:E:/somewhere/palis')
  // pnpm 锁：同一路径前缀也换掉，不留旧 home
  const lock = fs.readFileSync(path.join(dest, 'profiles', 'web', 'pnpm-lock.yaml'), 'utf8')
  assert.ok(lock.includes(`link:${dest.replace(/\\/g, '/')}/plugins/super`), lock)
  assert.ok(!lock.includes(src.replace(/\\/g, '/')), lock)
  // skip 项
  assert.strictEqual(fs.existsSync(path.join(dest, 'cache')), false)
  assert.strictEqual(fs.existsSync(path.join(dest, 'dsh-runtimes')), false)
  assert.strictEqual(fs.existsSync(path.join(dest, 'profiles', 'desktop')), false)
  // 外部链接原样
  assert.strictEqual(fs.lstatSync(path.join(dest, 'profiles', 'node_modules', '@deepseek-ai', 'dsh')).isSymbolicLink(), true)
  assert.strictEqual(path.resolve(fs.readlinkSync(path.join(dest, 'profiles', 'node_modules', '@deepseek-ai', 'dsh'))), path.resolve(path.join(root, 'external-runtime')))
  // 内部链接重指到私有 home
  assert.strictEqual(
    path.resolve(fs.readlinkSync(path.join(dest, 'profiles', 'web', 'node_modules', '@dsh-external', 'super'))),
    path.resolve(path.join(dest, 'plugins', 'super')),
  )
  // 悬空链接照样建出来
  assert.strictEqual(fs.lstatSync(path.join(dest, 'profiles', 'node_modules', '@aws-crypto', 'util')).isSymbolicLink(), true)
  // marker
  const marker = JSON.parse(fs.readFileSync(markerPath(dest), 'utf8'))
  assert.strictEqual(marker.migratedFrom, src)
  assert.strictEqual(marker.copied, r.copied)
  // 源目录零改动
  assert.deepStrictEqual(snapshot(src), before)
})

t('migrateHome：幂等——再跑一次零复制、源仍零改动', async () => {
  const src = path.join(root, 'shared-home')
  const dest = path.join(root, 'private-home')
  const before = snapshot(src)
  const r2 = await migrateHome({ src, dest })
  assert.strictEqual(r2.ok, true)
  assert.strictEqual(r2.copied, 0)
  assert.ok(r2.kept > 0)
  assert.deepStrictEqual(snapshot(src), before)
})

t('migrateHome：目标已存在的文件优先（私有库不被旧内容覆盖）', async () => {
  const src = path.join(root, 'src2')
  const dest = path.join(root, 'dest2')
  fs.mkdirSync(src, { recursive: true })
  fs.writeFileSync(path.join(src, 'keep.txt'), 'FROM-SHARED')
  fs.mkdirSync(dest, { recursive: true })
  fs.writeFileSync(path.join(dest, 'keep.txt'), 'PRIVATE-WINS')
  const r = await migrateHome({ src, dest })
  assert.strictEqual(r.copied, 0)
  assert.strictEqual(r.kept, 1)
  assert.strictEqual(fs.readFileSync(path.join(dest, 'keep.txt'), 'utf8'), 'PRIVATE-WINS')
})

t('migrateHome：源不存在 → 报错且不写 marker（不谎报成功）', async () => {
  const src = path.join(root, 'missing-src')
  const dest = path.join(root, 'dest3')
  const r = await migrateHome({ src, dest })
  assert.strictEqual(r.ok, false)
  assert.ok(r.errors.length > 0)
  assert.strictEqual(fs.existsSync(markerPath(dest)), false)
})

t('migrationNeeded：源存在且未迁移才为真；marker/缺失源/同路径都为假', () => {
  const src = path.join(root, 'shared-home')
  const dest = path.join(root, 'fresh-home')
  const plan = { home: dest, sharedHome: src, migrate: true, force: false, marker: markerPath(dest) }
  assert.strictEqual(migrationNeeded(plan), true)
  fs.mkdirSync(dest, { recursive: true })
  fs.writeFileSync(markerPath(dest), '{}')
  assert.strictEqual(migrationNeeded(plan), false)
  assert.strictEqual(migrationNeeded({ ...plan, marker: markerPath(path.join(root, 'nowhere')) }), true)
  assert.strictEqual(migrationNeeded({ ...plan, sharedHome: path.join(root, 'no-such-home') }), false)
  assert.strictEqual(migrationNeeded({ home: src, sharedHome: src, migrate: true, marker: markerPath(src) }), false)
  assert.strictEqual(migrationNeeded({ ...plan, migrate: false }), false)
})

t('migrationNeeded：DSH_DESKTOP_MIGRATE=1（force）忽略 marker，用于补迁移', () => {
  const src = path.join(root, 'shared-home')
  const dest = path.join(root, 'fresh-home')
  const plan = { home: dest, sharedHome: src, migrate: true, force: true, marker: markerPath(dest) }
  assert.strictEqual(migrationNeeded(plan), true) // marker 已存在也照样跑（只补缺失）
})

;(async () => {
  try {
    for (const [name, fn] of tests) {
      await fn()
      passed++
      console.log(`PASS ${name}`)
    }
    fs.rmSync(root, { recursive: true, force: true })
    console.log(`PRIVATE_HOME_OK ${passed} assertions passed`)
  } catch (err) {
    console.error(`FAIL: ${err && err.stack ? err.stack : err}`)
    process.exit(1)
  }
})()
