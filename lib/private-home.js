'use strict'

/**
 * 私有 DSH_HOME（默认 ~/.dsh-desktop）与首次迁移。
 *
 * 为什么需要：内核把所有用户数据放在「单一根」$DSH_HOME 下——会话正文是
 * `$DSH_HOME/sessions/<工作目录 slug>/<会话 id>/session.v4.jsonl.zstd`（root 由
 * @deepseek-ai/dsh-base 的 session-persistence-jsonl 写死为 dshHomePath('sessions')），
 * 账号、插件 profile、技能、preset 同样在 home 下。官方桌面版把 home 解析为 ~/.dsh，
 * 本外壳此前也默认 ~/.dsh —— 于是两个应用的会话记录、登录态、插件天然共用一份。
 * 本模块把本外壳的默认 home 挪到私有目录，并在首次启动时把原 home **只读复制**一份过来。
 *
 * 安全分寸（这里是契约，改动前先读）：
 *   1. **源目录只读**：迁移只读共享 home，一个字节都不写——官方版正在用它。
 *   2. 目标已存在的条目一律保留（私有库优先），只补缺失 → 幂等、可中断续跑。
 *   3. 单文件「临时名 → rename」落盘，内核永远读不到半截文件。
 *   4. 链接（junction/symlink）按链接重建，绝不 deref（否则会把整棵运行时树搬进来）；
 *      目标落在旧 home 内部时重指到新 home 的同名路径（如 profile 里指向
 *      ~/.dsh/plugins/... 的插件链接）。
 *   5. 跳过派生缓存与官方版专属 profile：dsh-runtimes / cache / logs / profiles/desktop。
 *   6. 跑完写 marker（<home>/.migrated-from-dsh.json），此后永不再跑。
 *
 * 零 Electron 依赖，纯 Node 可单测（见 lib/private-home.test.js）。
 */

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { writeJsonAtomic, readJsonSafe } = require('./atomic-file')

/** `DSH_DESKTOP_HOME=shared` 哨兵：显式回到与官方版/CLI 共用的 home。 */
const SHARED_HOME_SENTINEL = 'shared'
/** 私有 home 目录名（放在用户主目录下，与 ~/.dsh 并列、一眼可辨）。 */
const PRIVATE_HOME_DIRNAME = '.dsh-desktop'
const MARKER_FILENAME = '.migrated-from-dsh.json'
const MIGRATION_SCHEMA = 1
/**
 * 不迁移的条目（相对 home 根、正斜杠分隔）：
 *   · dsh-runtimes —— 官方桌面版解压主运行时的缓存（数百 MB），本外壳有自己的 runtime；
 *   · cache        —— 图片/请求缓存，可重建；
 *   · logs         —— 内核启动诊断日志；
 *   · profiles/desktop —— 官方版专属 profile（本外壳只用 profiles/web）。
 */
const DEFAULT_SKIP = ['dsh-runtimes', 'cache', 'logs', 'profiles/desktop']

/** 展开 `~` / `~/` / `~\` 前缀（内核 dsh-home-paths 同口径）。 */
function expandHomePath(value, homedir) {
  const v = String(value || '')
  if (v === '~') return homedir
  if (v.startsWith('~/') || v.startsWith('~\\')) return path.join(homedir, v.slice(2))
  return v
}

/** Windows 路径大小写不敏感；比较前统一归一化。 */
function samePath(a, b) {
  const na = path.resolve(String(a || ''))
  const nb = path.resolve(String(b || ''))
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb
}

/** child 是否在 parent 内部（同 samePath 的归一化口径）。 */
function isInside(child, parent) {
  const c = path.resolve(String(child || ''))
  const p = path.resolve(String(parent || ''))
  const [nc, np] = process.platform === 'win32' ? [c.toLowerCase(), p.toLowerCase()] : [c, p]
  return nc === np || nc.startsWith(np + path.sep)
}

/** 去掉 Windows 长路径前缀（junction 的 readlink 可能带 `\\?\`）。 */
function stripLongPathPrefix(target) {
  return String(target || '').replace(/^\\\\\?\\/, '')
}

function markerPath(home) {
  return path.join(home, MARKER_FILENAME)
}

/**
 * 解析本外壳该用的 DSH_HOME。
 *
 * 优先级（高 → 低）：
 *   1. `DSH_DESKTOP_HOME=shared`   → 与官方版/CLI 共用（逃生门；"共用"的目标由 `DSH_HOME` 定义）
 *   2. `DSH_DESKTOP_HOME=<路径>`   → 指定目录（开发/隔离测试）
 *   3. 都没有                      → 私有 `~/.dsh-desktop`（默认，首启迁移）
 *
 * 为什么**不**直接跟随 `DSH_HOME`：`DSH_HOME` 是内核/CLI 的约定，会被任何从 DSH 会话里
 * 拉起的子进程继承（本仓库的预览实例、agent 起的测试实例都是这么来的）。若让它参与判定，
 * 从终端/预览里启动本应用就会静默回到共用 home，"隔离"看起来像没生效。所以桌面端的
 * home 只认桌面专属开关；`DSH_HOME` 仅用来定义"共用"指向哪个目录。
 *
 * `DSH_DESKTOP_MIGRATE=1` 强制迁移到「非共享」的任意 home；`=0` 关掉自动迁移。
 * @param {{env?: Record<string,string>, homedir?: string}} [options]
 * @returns {{home: string, mode: 'private'|'shared'|'custom', sharedHome: string, migrate: boolean, marker: string}}
 */
function resolveHome(options = {}) {
  const env = options.env || process.env
  const homedir = options.homedir || os.homedir()
  const envHome = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  const sharedHome = path.resolve(expandHomePath(envHome || path.join(homedir, '.dsh'), homedir))
  const desktopHome = typeof env.DSH_DESKTOP_HOME === 'string' ? env.DSH_DESKTOP_HOME.trim() : ''
  const forceMigrate = env.DSH_DESKTOP_MIGRATE === '1'
  const noMigrate = env.DSH_DESKTOP_MIGRATE === '0'

  let home
  let mode
  if (desktopHome && desktopHome.toLowerCase() === SHARED_HOME_SENTINEL) {
    home = sharedHome
    mode = 'shared'
  } else if (desktopHome) {
    home = path.resolve(expandHomePath(desktopHome, homedir))
    mode = 'custom'
  } else {
    home = path.join(homedir, PRIVATE_HOME_DIRNAME)
    mode = 'private'
  }

  const migrate = !noMigrate && (mode === 'private' || forceMigrate)
  return { home, mode, sharedHome, migrate, force: forceMigrate, marker: markerPath(home) }
}

/**
 * 迁移是否该跑：开关允许 + 目标非共享 + 未迁移过 + 源目录存在。
 * `DSH_DESKTOP_MIGRATE=1` 时忽略 marker——这是**重新补一次**的开关（只补缺失、
 * 绝不覆盖私有库里已有的条目），用于把旧实例/官方版后来产生的会话再合并进来。
 */
function migrationNeeded(plan) {
  if (!plan || !plan.migrate) return false
  if (samePath(plan.home, plan.sharedHome)) return false
  if (!fs.existsSync(plan.sharedHome)) return false
  if (plan.force) return true
  if (fs.existsSync(plan.marker)) return false
  return true
}

/** 读迁移标记（无标记返回 null）。 */
function readMarker(home) {
  return readJsonSafe(markerPath(home))
}

/** 跳过判定：rel 用正斜杠，等于 skip 项或在其子树内都跳过。 */
function isSkipped(rel, skip) {
  const r = String(rel).replace(/\\/g, '/')
  return (skip || []).some((s) => r === s || r.startsWith(s + '/'))
}

/** 旧 home 内部的链接目标 → 新 home 的同名路径；其余原样返回。 */
function retargetLink(target, srcHome, destHome) {
  const clean = stripLongPathPrefix(target)
  if (!path.isAbsolute(clean)) return { target: clean, retargeted: false }
  if (!isInside(clean, srcHome)) return { target: clean, retargeted: false }
  return { target: path.join(destHome, path.relative(srcHome, clean)), retargeted: true }
}

/** 单文件原子复制：目标已存在则跳过（私有库优先）。 */
async function copyFileOnce(src, dest, report) {
  try {
    await fsp.lstat(dest)
    report.kept += 1
    return
  } catch { /* 目标不存在：继续复制 */ }
  const tmp = `${dest}.dshpart-${process.pid}-${(report.copied + report.linked + 1).toString(36)}`
  try {
    await fsp.copyFile(src, tmp)
    await fsp.rename(tmp, dest)
    report.copied += 1
    report.bytes += (await fsp.stat(dest)).size
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {})
    report.errors.push(`${dest}: ${err.message}`)
  }
}

/** 按链接重建（Windows 上 junction 无需提权，且允许悬空目标）。 */
async function copyLinkOnce(src, dest, srcHome, destHome, report) {
  let raw
  try {
    raw = await fsp.readlink(src)
  } catch (err) {
    report.errors.push(`${src}: readlink 失败 ${err.message}`)
    return
  }
  const { target, retargeted } = retargetLink(raw, srcHome, destHome)
  let isDir = true
  try {
    isDir = (await fsp.stat(src)).isDirectory()
  } catch { isDir = true /* 悬空链接：本 home 里全是包目录链接，按目录处理 */ }
  try {
    await fsp.lstat(dest)
    report.kept += 1
    return
  } catch { /* 目标不存在：继续建链 */ }
  const absolute = path.isAbsolute(target) ? target : path.resolve(path.dirname(dest), target)
  const attempts = isDir
    ? [['junction', absolute], ['dir', target]]
    : [['file', target], ['junction', absolute]]
  for (const [type, value] of attempts) {
    try {
      await fsp.symlink(value, dest, type)
      report.linked += 1
      if (retargeted) report.retargeted += 1
      return
    } catch (err) {
      report.lastLinkError = err.message
    }
  }
  // 建链全失败（Windows 未开开发者模式的文件链接等）：退化成复制内容，至少不丢数据。
  try {
    const st = await fsp.stat(src)
    if (st.isFile()) {
      await fsp.copyFile(src, dest)
      report.copied += 1
      report.degraded.push(dest)
      return
    }
  } catch { /* 悬空目标：无内容可复制 */ }
  report.errors.push(`${dest}: 建链失败（${report.lastLinkError}）`)
}

/**
 * 把文本里的旧 home 路径前缀换成新 home（`\` 与 `/` 两种写法都换）。
 * 只用于 pnpm 锁文件这类「同一路径的纯文本记账」。
 */
function replaceHomePrefix(text, srcHome, destHome) {
  let out = text
  for (const [from, to] of [
    [srcHome, destHome],
    [srcHome.replace(/\\/g, '/'), destHome.replace(/\\/g, '/')],
  ]) {
    if (from && from !== to) out = out.split(from).join(to)
  }
  return out
}

/**
 * profile 清单里的绝对路径也要跟着搬：`dependencies` 里的 `link:<旧 home>/...`
 * 是 pnpm 记账的绝对路径，光重建 node_modules 里的链接不够——下次 `pnpm install`
 * 会按清单把它重新指回旧 home（隔离就漏了）。只改 profile 的清单与 pnpm 锁文件，
 * 会话正文/投影缓存等用户数据一律不碰（它们只是"提到过"这个路径，不是配置）。
 */
async function retargetProfileManifests(ctx) {
  const profilesDir = path.join(ctx.destHome, 'profiles')
  if (!fs.existsSync(profilesDir)) return
  let entries = []
  try {
    entries = await fsp.readdir(profilesDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const profileDir = path.join(profilesDir, entry.name)
    // 1. package.json：按 JSON 解析，只重写指向旧 home 的 link: 依赖
    const pkgPath = path.join(profileDir, 'package.json')
    const pkg = readJsonSafe(pkgPath)
    if (pkg && pkg.dependencies && typeof pkg.dependencies === 'object') {
      let changed = 0
      for (const [name, spec] of Object.entries(pkg.dependencies)) {
        if (typeof spec !== 'string') continue
        const m = /^link:(.+)$/.exec(spec.trim())
        if (!m) continue
        const target = path.resolve(m[1])
        if (!isInside(target, ctx.srcHome)) continue
        pkg.dependencies[name] = 'link:' + path.join(ctx.destHome, path.relative(ctx.srcHome, target)).replace(/\\/g, '/')
        changed += 1
      }
      if (changed) {
        writeJsonAtomic(pkgPath, pkg)
        ctx.report.manifestRetargeted += changed
      }
    }
    // 2. pnpm 锁文件：同一路径前缀的文本替换（pnpm 记账，重新解析也无害）
    for (const rel of [path.join('pnpm-lock.yaml'), path.join('node_modules', '.pnpm', 'lock.yaml')]) {
      const file = path.join(profileDir, rel)
      if (!fs.existsSync(file)) continue
      try {
        const before = await fsp.readFile(file, 'utf8')
        const after = replaceHomePrefix(before, ctx.srcHome, ctx.destHome)
        if (after !== before) {
          await fsp.writeFile(file, after)
          ctx.report.lockRetargeted += 1
        }
      } catch (err) {
        ctx.report.errors.push(`${file}: 锁文件重指失败 ${err.message}`)
      }
    }
  }
}

/** 递归复制一棵树：目录递归、文件原子复制、链接按链接重建。 */async function copyTree(srcDir, destDir, relPrefix, ctx) {
  let entries
  try {
    entries = await fsp.readdir(srcDir, { withFileTypes: true })
  } catch (err) {
    ctx.report.errors.push(`${srcDir}: 读取失败 ${err.message}`)
    return
  }
  for (const entry of entries) {
    const rel = relPrefix ? path.posix.join(relPrefix, entry.name) : entry.name
    if (isSkipped(rel, ctx.skip)) {
      ctx.report.skipped += 1
      continue
    }
    const src = path.join(srcDir, entry.name)
    const dest = path.join(destDir, entry.name)
    let st
    try {
      st = await fsp.lstat(src)
    } catch {
      continue
    }
    if (st.isSymbolicLink()) {
      await copyLinkOnce(src, dest, ctx.srcHome, ctx.destHome, ctx.report)
      continue
    }
    if (st.isDirectory()) {
      try {
        await fsp.mkdir(dest, { recursive: true })
      } catch (err) {
        ctx.report.errors.push(`${dest}: mkdir 失败 ${err.message}`)
        continue
      }
      ctx.report.dirs += 1
      await copyTree(src, dest, rel, ctx)
      continue
    }
    if (st.isFile()) await copyFileOnce(src, dest, ctx.report)
  }
}

/**
 * 把共享 home 整份（除 skip 项）复制到私有 home，跑完写 marker。
 *
 * @param {{src: string, dest: string, skip?: string[], onLog?: (msg: string) => void, onProgress?: (n: number) => void}} options
 * @returns {Promise<{ok: boolean, copied: number, kept: number, linked: number, retargeted: number, skipped: number, dirs: number, bytes: number, errors: string[], degraded: string[]}>}
 */
async function migrateHome(options) {
  const srcHome = path.resolve(options.src)
  const destHome = path.resolve(options.dest)
  const report = {
    ok: false, copied: 0, kept: 0, linked: 0, retargeted: 0, skipped: 0,
    dirs: 0, bytes: 0, manifestRetargeted: 0, lockRetargeted: 0,
    errors: [], degraded: [], lastLinkError: '',
  }
  if (samePath(srcHome, destHome)) {
    report.errors.push('源与目标相同，拒绝迁移')
    return report
  }
  if (!fs.existsSync(srcHome)) {
    report.errors.push(`源 home 不存在：${srcHome}`)
    return report
  }
  const skip = options.skip || DEFAULT_SKIP
  const onLog = options.onLog || (() => {})
  const t0 = Date.now()
  try {
    await fsp.mkdir(destHome, { recursive: true })
    await copyTree(srcHome, destHome, '', { srcHome, destHome, skip, report })
    // 链接重建后，profile 清单/锁文件里的绝对路径也要跟着搬（否则 pnpm 会把插件重指回旧 home）
    await retargetProfileManifests({ srcHome, destHome, skip, report })
  } catch (err) {
    report.errors.push(err.message)
  }
  const elapsedMs = Date.now() - t0
  // 有硬错误时不写 marker：下次启动重跑（只补缺失，不会重复搬）
  if (report.errors.length === 0) {
    try {
      writeJsonAtomic(markerPath(destHome), {
        schema: MIGRATION_SCHEMA,
        migratedFrom: srcHome,
        migratedAt: new Date().toISOString(),
        skipped: skip,
        copied: report.copied,
        kept: report.kept,
        linked: report.linked,
        retargeted: report.retargeted,
        bytes: report.bytes,
        elapsedMs,
      })
      report.ok = true
    } catch (err) {
      report.errors.push(`marker 写入失败：${err.message}`)
    }
  }
  onLog(`private home migration: copied=${report.copied} kept=${report.kept} linked=${report.linked} ` +
    `retargeted=${report.retargeted} manifest=${report.manifestRetargeted} locks=${report.lockRetargeted} ` +
    `skipped=${report.skipped} dirs=${report.dirs} ` +
    `${(report.bytes / 1048576).toFixed(1)}MB ${elapsedMs}ms errors=${report.errors.length}`)
  for (const e of report.errors.slice(0, 8)) onLog(`private home migration error: ${e}`)
  if (report.degraded.length) onLog(`private home migration: ${report.degraded.length} 个链接退化为复制`)
  return report
}

module.exports = {
  SHARED_HOME_SENTINEL,
  PRIVATE_HOME_DIRNAME,
  MARKER_FILENAME,
  MIGRATION_SCHEMA,
  DEFAULT_SKIP,
  expandHomePath,
  samePath,
  isInside,
  markerPath,
  resolveHome,
  migrationNeeded,
  readMarker,
  isSkipped,
  retargetLink,
  migrateHome,
}
