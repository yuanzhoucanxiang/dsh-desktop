'use strict'

/**
 * profile 内核包链接迁移（内核升级的配套步骤）。
 *
 * 背景：内核（app-boot / dsh-client-modules）按约定经 profiles 层级下的 node_modules 解析
 * @deepseek-ai/* —— 这些条目是指向「某个运行时」的链接（或历史遗留的真目录副本）。
 * 内核升级后若它们仍指向旧运行时，新内核会解析到旧代码，启动即
 * "2 required plugins did not activate / parameter codec is not backed by a zod v4 schema"
 * （2026-09-26 实测）。这就是契约探针 shell.profile-kernel-packages 描述的
 * 「升级内核前必须刷新插件树」——本模块把这一步产品化：每次拉内核前把 profile 的
 * 内核包条目对齐到「本轮运行时」，幂等。
 *
 * 规则（只碰 @deepseek-ai 作用域，插件链接如 @dsh-local/* 一律不动）：
 *   · 链接 → 目标已在本轮运行时树内：保留（这就是我们要指向的地方——否则框架包
 *     （cordis/cosmokit/schemastery/cordis-plugin-* …）每次启动都会被误判重指：
 *     它们的版本号自成体系（4.0.4 / 1.8.5 …），永远对不上内核版本族）；
 *   · 链接 → 目标在本轮运行时树外、且本轮运行时提供同名包：**一律重指到本轮运行时，
 *     不看版本**。「树外同版本/同族 = 等价副本，保留」这条旧规则已废——内核按两锚点解析
 *     （profile 层与 installation 层各有一套 @deepseek-ai 包），两棵树并存时同一个内核进程
 *     会同时加载两份同名包，模块身份（Service 类、内部 Symbol）随之分裂：实机症状是会话在
 *     第一个工具调用处整轮中断——dsh-agent-loop 取不到 `ctx.tools[TOOL_RUNTIME_SCHEDULER]`，
 *     抛 `Cannot read properties of undefined (reading 'prepare')`，用户看到"回答没说完就停"
 *     （2026-10-11 事故 4 次、2026-10-12 双副本实测，见 logs/2026-10-12.md）；
 *   · 链接 → 悬空，且本轮运行时提供该包：重指到本轮运行时；
 *   · 链接 → 本轮运行时已不存在的包：摘除（内核自愈只补它自己有的包）；目标可读且与内核
 *     同族时保留（本轮没有可指向的目标，它不构成"第二份"）。
 *   · 真目录 → 本轮运行时提供同名包：**让位**（.stale- 前缀，node 不会把它当包名解析，可手工
 *     找回）并换成指向本轮运行时的链接——真目录副本同样是第二个模块实例，与"异树链接"同罪；
 *   · 真目录 → 本轮内核没有这个包：可读的完整副本留着（可能有插件引用）；连 package.json
 *     都读不出（坏影子宫）的改名让位。
 */

const fs = require('node:fs')
const path = require('node:path')

/** 版本族：只取数字三元组，忽略 -rc.N / -alpha.N（与契约探针同口径）。 */
function versionFamily(version) {
  return String(version || '').replace(/^v/, '').split('-')[0]
}

function readVersion(pkgDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version || ''
  } catch {
    return ''
  }
}

function isInside(child, parent) {
  const c = path.resolve(child)
  const p = path.resolve(parent)
  return c === p || c.startsWith(p + path.sep)
}

function realOrNull(p) {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

/** 摘除一个链接（junction/symlink）：只删链接本身，绝不触碰目标内容。
 *  为什么不能 rmSync recursive：2026-09-26 实测，在 Electron 内置 Node 上
 *  rmSync(recursive) 顺着 junction 把目标目录内容删掉了（系统 node v26 复现不出，
 *  Electron 43 的 Node 行为不同）——事故把已安装运行时和全局 dsh 清了包。
 *  unlinkSync 只摘链接本身，语义上不可能碰到目标。 */
function removeLink(link) {
  try {
    fs.unlinkSync(link)
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      fs.rmSync(link, { force: true }) // 兜底：同样不带 recursive
      return
    }
    throw err
  }
}

function migrateLevel(levelDir, runtimeNm, kernelFamily, runtimeReal, report) {
  const scope = path.join(levelDir, '@deepseek-ai')
  if (!fs.existsSync(scope)) return
  let entries = []
  try {
    entries = fs.readdirSync(scope)
  } catch {
    return
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue
    const link = path.join(scope, name)
    let st
    try {
      st = fs.lstatSync(link)
    } catch {
      continue
    }
    const desired = path.join(runtimeNm, '@deepseek-ai', name)
    const desiredOk = fs.existsSync(path.join(desired, 'package.json'))

    if (st.isSymbolicLink()) {
      let targetReal = ''
      try {
        targetReal = fs.realpathSync(link)
      } catch { /* 悬空 */ }
      if (targetReal && fs.existsSync(path.join(targetReal, 'package.json'))) {
        // 已指向本轮运行时树内：这就是我们要改成的目标，再"重指"就是每次启动白做的
        // unlink+link 噪声（框架包版本号自成体系，版本族判定对它们永远不成立）。
        if (runtimeReal && isInside(targetReal, runtimeReal)) {
          report.kept += 1
          continue
        }
        // 树外条目：本轮运行时提供同名包时一律重指，**不看版本**——"版本相同"不等于
        // "同一个模块实例"，两棵树并存会让内核同时加载两份（Symbol/Service 身份分裂，
        // 见文件头 2026-10-11 事故）。只有本轮没有这个包时，树外的同族副本才是唯一来源，
        // 保留它不构成第二份。
        if (!desiredOk && versionFamily(readVersion(targetReal)) === kernelFamily) {
          report.kept += 1
          continue
        }
      }
      if (!desiredOk) {
        try {
          removeLink(link)
          report.removed.push(`${name} (链接目标缺失/异族且本轮内核无此包)`)
        } catch (err) {
          report.errors.push(`${name}: ${err.message}`)
        }
        continue
      }
      try {
        removeLink(link)
        fs.symlinkSync(desired, link, 'junction')
        report.repointed.push(name)
      } catch (err) {
        report.errors.push(`${name}: ${err.message}`)
      }
      continue
    }

    if (st.isDirectory()) {
      // 真目录：插件 pnpm 装依赖时可能带进内核包副本。本轮运行时提供同名包时，副本同样是
      // 第二个模块实例（见文件头 2026-10-11 事故）→ 让位给指向本轮运行时的链接；
      // 本轮没有这个包时没有可指向的目标：完整副本留着（可能有插件引用），
      // 连 package.json 都读不出的坏影子宫改名让位。
      const version = readVersion(link)
      if (desiredOk) {
        let slot = 0
        let stalePath = path.join(scope, `.stale-${name}`)
        while (fs.existsSync(stalePath)) stalePath = path.join(scope, `.stale-${name}-${++slot}`)
        try {
          fs.renameSync(link, stalePath)
          fs.symlinkSync(desired, link, 'junction')
          report.renamed.push(version ? `${name}@${version} (真目录副本让位)` : `${name} (真目录副本让位)`)
          report.repointed.push(name)
        } catch (err) {
          report.errors.push(`${name}: ${err.message}`)
        }
        continue
      }
      if (version && versionFamily(version) === kernelFamily) {
        // 本轮内核没有这个包、但它是同族的唯一副本：保留（不构成与运行时的第二份）。
        report.kept += 1
        continue
      }
      if (version) {
        // 本轮内核没有这个包、它自己又是完整副本：留着（可能有插件引用）
        report.foreignReal.push(`${name}@${version}`)
        continue
      }
      let slot = 0
      let stalePath = path.join(scope, `.stale-${name}`)
      while (fs.existsSync(stalePath)) stalePath = path.join(scope, `.stale-${name}-${++slot}`)
      try {
        fs.renameSync(link, stalePath)
        report.renamed.push(`${name} (无 package.json)`)
      } catch (err) {
        report.errors.push(`${name}: ${err.message}`)
      }
    }
  }
}

/**
 * 迁移一个 profile 的内核包条目。levels 传从远到近的 node_modules 目录
 * （如 profiles/node_modules 与 profiles/web/node_modules）。
 * 返回报告；任何单条失败都收进 errors，绝不抛出（迁移失败不应阻止启动）。
 */
function migrateProfileKernelLinks({ levels, runtimeNodeModules }) {
  const report = { repointed: [], removed: [], renamed: [], foreignReal: [], errors: [], kept: 0 }
  const kernelFamily = versionFamily(readVersion(path.join(runtimeNodeModules, '@deepseek-ai', 'dsh')))
  if (!kernelFamily) {
    report.errors.push('本轮运行时缺少 @deepseek-ai/dsh，跳过迁移')
    return report
  }
  const runtimeReal = realOrNull(runtimeNodeModules)
  for (const level of levels || []) {
    try {
      migrateLevel(level, runtimeNodeModules, kernelFamily, runtimeReal, report)
    } catch (err) {
      report.errors.push(`${level}: ${err.message}`)
    }
  }
  return report
}

module.exports = { migrateProfileKernelLinks, versionFamily }
