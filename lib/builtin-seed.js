'use strict'

/**
 * 内置插件种子（纯 Node，零 Electron 依赖，可单测）：
 * 安装包内置插件（resources/builtin-plugins，见 scripts/prepare-builtin-plugins.mjs）
 * 首启时种入 profile（~/.dsh/profiles/web）——复制缺失包 + 对 profile 清单做
 * 「只增补、绝不重建」的合并。内核先跑一次（profile 由内核 loadProfile 自动初始化）
 * 再由外壳调用本模块，最后重启内核让插件生效。
 *
 * 安全分寸：
 *   1. 只复制 profile 里「不存在」的包——已装（用户自己装的、版本不同的）绝不覆盖；
 *   2. manifest 的 dependencies / dsh.profile.bundles 只追加缺失条目，原有条目
 *      及顺序原样保留（历史教训：重建 bundles 数组丢过条目，见 logs/2026-08-22.md）；
 *   3. 加入 bundles 前逐个过 bundleBootable（与启动前体检同一闸门），体检不过的
 *      插件只复制不启用，绝不把内核炸掉；
 *   4. stamp（userData/builtin-plugins-seeded.json）一次性：成功种子后永不再执行，
 *      用户在设置里卸载/禁用内置插件不会被下次启动顶回来。
 */

const fs = require('node:fs')
const path = require('node:path')
const { writeFileAtomic, readJsonSafe } = require('./atomic-file')
const { bundleBootable } = require('./profile-inspect')

/** 枚举 stage 树顶层可种植的包（@{scope}/<pkg> 两层，其余一层；跳过点开头杂项）。 */
function topPackages(nodeModulesDir) {
  const out = []
  if (!fs.existsSync(nodeModulesDir)) return out
  for (const e of fs.readdirSync(nodeModulesDir)) {
    if (e.startsWith('.')) continue
    const p = path.join(nodeModulesDir, e)
    if (!fs.statSync(p).isDirectory()) continue
    if (e.startsWith('@')) {
      for (const sub of fs.readdirSync(p)) {
        if (sub.startsWith('.')) continue
        const sp = path.join(p, sub)
        if (fs.statSync(sp).isDirectory()) out.push({ name: `${e}/${sub}`, src: sp })
      }
    } else {
      out.push({ name: e, src: p })
    }
  }
  return out
}

/** 种子条件：内置树 + 清单存在、stamp 未写、profile 清单已由内核初始化。 */
function needsSeed(opts) {
  const o = opts || {}
  const manifest = path.join(o.seedDir || '', 'manifest.json')
  const profilePkg = path.join(o.profileDir || '', 'package.json')
  if (!fs.existsSync(manifest)) return false
  if (o.stampPath && fs.existsSync(o.stampPath)) return false
  return fs.existsSync(profilePkg)
}

/**
 * 执行种子。返回 { ok, changed, addedPlugins, error }；任何异常都不会写 stamp
 * （失败下次启动可重试），也不会破坏既有 profile 内容（写回走原子写，失败即放弃）。
 */
function runSeed(opts) {
  const o = opts || {}
  const seedDir = o.seedDir
  const profileDir = o.profileDir
  const stampPath = o.stampPath
  if (!seedDir || !profileDir) return { ok: false, error: '缺少 seedDir/profileDir' }

  const manifest = readJsonSafe(path.join(seedDir, 'manifest.json'))
  const profilePkgPath = path.join(profileDir, 'package.json')
  const profile = readJsonSafe(profilePkgPath)
  if (!manifest || !Array.isArray(manifest.plugins)) return { ok: false, error: '内置插件清单缺失' }
  if (!profile) return { ok: false, error: 'profile 清单缺失（内核尚未初始化？）' }

  const profileNm = path.join(profileDir, 'node_modules')
  const changed = { copied: false, manifest: false }
  const addedPlugins = []

  // 1. 复制缺失包（存在即跳过——用户的版本优先，绝不覆盖）
  for (const pkg of topPackages(path.join(seedDir, 'packages'))) {
    if (fs.existsSync(path.join(profileNm, pkg.name))) continue
    fs.mkdirSync(path.dirname(path.join(profileNm, pkg.name)), { recursive: true })
    fs.cpSync(pkg.src, path.join(profileNm, pkg.name), { recursive: true })
    changed.copied = true
  }

  // 2. 清单只增补：dependencies 与 dsh.profile.bundles 各自追加缺失条目
  const bundled = new Set((profile.dsh?.profile?.bundles || []))
  const deps = { ...(profile.dependencies || {}) }
  for (const plugin of manifest.plugins) {
    if (!plugin || typeof plugin.name !== 'string') continue
    if (!Object.prototype.hasOwnProperty.call(deps, plugin.name)) {
      deps[plugin.name] = plugin.version
      changed.manifest = true
    }
    if (!bundled.has(plugin.name)) {
      const bootable = bundleBootable(plugin.name, { manifestPath: profilePkgPath })
      if (bootable.ok) {
        bundled.add(plugin.name)
        changed.manifest = true
        addedPlugins.push(plugin.name)
      }
    } else {
      addedPlugins.push(plugin.name) // 已启用（含老 profile）也算就位
    }
  }

  if (changed.manifest) {
    const next = {
      ...profile,
      dependencies: deps,
      dsh: { ...(profile.dsh || {}), profile: { ...(profile.dsh?.profile || {}), bundles: [...bundled] } },
    }
    writeFileAtomic(profilePkgPath, JSON.stringify(next, null, 2))
  }

  // 3. stamp：只要流程跑完就落（含零改动——第一次运行后永久封嘴）
  if (stampPath) {
    try {
      writeFileAtomic(stampPath, JSON.stringify({ seededAt: new Date().toISOString(), plugins: manifest.plugins.map((p) => p.name) }, null, 2))
    } catch {}
  }

  return { ok: true, changed: changed.copied || changed.manifest, addedPlugins }
}

module.exports = { needsSeed, runSeed, topPackages }
