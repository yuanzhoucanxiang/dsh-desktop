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

/**
 * 种子条件：
 *   A. 初次 —— 内置树 + 清单存在、stamp 未写、profile 清单已由内核初始化；
 *   B. 修复 —— stamp 已写（正常路径早已跑过一次），但清单里某个插件**在 bundles 名单中**
 *      或**在自动隔离记录中**（隔离=外壳防砖机制自动摘除，不是用户意愿），而 profile
 *      node_modules 里的包缺失/悬空（package.json 读不到）。
 *      为什么要有 B：内核是"任一 bundle 失败即整体退出"， bundles 名单里的包文件缺失会把
 *      整个应用搞挂（历史事故：指向工作区的链接悬空 → 被隔离摘除 → 审阅功能消失）。
 *      用户已卸载（不在 bundles 也不在隔离记录）或禁用（补丁层 disabled:true，复制了
 *      也不会启用）的仍然不会被顶回来。
 */
function needsSeed(opts) {
  const o = opts || {}
  const manifest = path.join(o.seedDir || '', 'manifest.json')
  const profilePkg = path.join(o.profileDir || '', 'package.json')
  if (!fs.existsSync(manifest)) return false
  if (!o.stampPath || !fs.existsSync(o.stampPath)) return fs.existsSync(profilePkg)
  // B：stamp 已写后的修复判定
  try {
    const list = JSON.parse(fs.readFileSync(manifest, 'utf8'))
    const profile = JSON.parse(fs.readFileSync(profilePkg, 'utf8'))
    const bundles = profile?.dsh?.profile?.bundles
    if (!Array.isArray(list?.plugins) || !Array.isArray(bundles)) return false
    const quarantined = new Set(Array.isArray(o.quarantineNames) ? o.quarantineNames : [])
    const nm = path.join(o.profileDir || '', 'node_modules')
    return list.plugins.some((p) => {
      if (!p || typeof p.name !== 'string') return false
      const intended = bundles.includes(p.name) || quarantined.has(p.name)
      if (!intended) return false // 用户卸载的（不在 bundles、也不在隔离记录）绝不顶回
      return !fs.existsSync(path.join(nm, p.name, 'package.json'))
    })
  } catch {
    return false
  }
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

  // 1. 复制缺失包。"已存在"指 package.json 可读的完整包——目录在但包文件缺失（悬空链接/
  //    半截删除）视为缺失：先移除坏条目再复制（坏条目连包身份都解析不出，不存在用户内容）。
  //    已安装且完整的一律跳过——用户的版本优先，绝不覆盖。范围=stage 顶层（内置插件 + 其运行时依赖）。
  for (const pkg of topPackages(path.join(seedDir, 'packages'))) {
    const dest = path.join(profileNm, pkg.name)
    const marker = path.join(dest, 'package.json')
    if (fs.existsSync(dest)) {
      if (fs.existsSync(marker)) continue
      // 坏条目：悬空链接或目录缺 package.json。rm 后按完整包复制（destroying 一个读不出
      // package.json 的坏条目不会丢用户内容——里面的内容本来就解析不出包身份）。
      try { fs.rmSync(dest, { recursive: true, force: true }) } catch {}
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.cpSync(pkg.src, dest, { recursive: true })
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
