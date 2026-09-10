'use strict'
// 构建期准备「内置插件」stage 树（跨平台纯 Node，零额外依赖）：
//   node scripts/prepare-builtin-plugins.mjs
//
// 产物（默认 dist/builtin-plugins/，可用 DSH_BUILTIN_OUT 指到工作区外——本地开发时
// ZCode 工作区监视器会锁住工作区内新建的大树），由 extraResources 打进安装包：
//   node_modules/   内置插件 + 其全部扁平依赖（与 profile pnpm hoisted 布局同构）
//   manifest.json   顶层插件清单（{ plugins: [{name, version}] }，种子逻辑按它判定缺包）
//
// 插件来源（见 builtin-plugins.json）：
//   npm          —— npm install <name>@<version>（扁平树，含依赖）
//   gh-release   —— 从源仓库 GitHub Release 下载构建产物包（自研插件 lib/ 不入 git，
//                    随 tag 发布 tarball，见 palis v0.4.3 先例）
//
// 每次构建全新重建；任何一步失败即退出非零（构建必须可见地挂掉）。
// 注意：多个 npm 包必须在一次 install 里装完——同一目录多次 npm install 会
// 相互清空 node_modules（实测第二次 install "removed 316 packages"）。

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'builtin-plugins.json'), 'utf8'))
const OUT = process.env.DSH_BUILTIN_OUT || path.join(ROOT, 'dist', 'builtin-plugins')
// 树目录不叫 node_modules：electron-builder 的 extraResources 复制时默认跳过
// 名为 node_modules 的子目录（实测 builtin-plugins 里只进了 manifest.json），
// 用 packages/ 规避；种子逻辑按同一名字读取。
const NODE_MODULES = path.join(OUT, 'packages') // 最终布局
const NM_INSTALL = path.join(OUT, 'node_modules') // pnpm 安装产物（安装后 rename）

// npm 官方 CLI（走 node 直跑，避免 .cmd shell 需要的 shell:true 及其弃用告警）
const NPM_CLI = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status})`)
}

function log(msg) {
  console.error(`[builtin-plugins] ${msg}`)
}

/** 解析可无 shell 直跑的 pnpm 启动器：[bin, 前缀参数]。 */
function resolvePnpm() {
  if (process.platform === 'win32') {
    const out = spawnSync(process.execPath, [NPM_CLI, 'root', '-g'], { encoding: 'utf8' })
    if (out.status === 0) {
      const cjs = path.join(String(out.stdout).trim(), 'pnpm', 'bin', 'pnpm.cjs')
      if (fs.existsSync(cjs)) return [process.execPath, [cjs]]
    }
    return null
  }
  if (spawnSync('pnpm', ['--version'], { stdio: 'ignore' }).status === 0) return ['pnpm', []]
  spawnSync('corepack', ['enable', 'pnpm'], { stdio: 'ignore' })
  return spawnSync('pnpm', ['--version'], { stdio: 'ignore' }).status === 0 ? ['pnpm', []] : null
}

/**
 * 与 dsh 官方安装姿势（`dsh plugin add` = pnpm + node-linker=hoisted）同构地装出
 * 扁平树。为什么不用 npm：插件 peer 指向 @deepseek-ai/*，npm 11 会把 peer 藏进
 * 嵌套 node_modules 甚至拒绝解析（eresolve 实测多次）；pnpm hoisted 下顶层
 * 目录与用户 profile node_modules 同构，种子复制后插件的 require 解析链一致。
 *
 * 版本钉死：插件 peer 的 @deepseek-ai/* 只写范围（如 ^0.1.0-rc.8），pnpm 自动
 * 解析会选到 registry 上当前最高的满足者（实测选到 0.1.0 稳定版）——而内核运行时
 * 是 0.1.1-rc.1，两份同 service 不同版本同时进内核进程会乱。所以 stage 的
 * package.json 里把这些 peer 按「运行时实际版本」精确声明，与用户 profile 树
 * （当年解析恰好也是 rc.1）保持同一基线。
 */
/**
 * 与 dsh 官方安装姿势同构地装出扁平树，但**不装 @deepseek-ai\/* 的 peer**：
 * 那些子包在 npm 上只到 0.0.1-rc.1（0.1.x 只随内核运行时分发，见 logs/2026-09-10.md 〔109〕），
 * 让 pnpm 去装必然 ERR_PNPM_NO_MATCHING_VERSION。关掉 auto-install-peers 后，
 * 插件运行时的 @deepseek-ai\/* 由 profile 的 healProfilesModuleFallback 链接指向
 * "正在运行的那个内核"提供——既省事又天然版本一致（也避免种子把运行时链接遮蔽成旧副本）。
 */
function installPnpm(plugins) {
  const launcher = resolvePnpm()
  if (launcher === null) throw new Error('pnpm 不可用（corepack enable 也没成功），请先安装 pnpm')
  const registry = process.env.DSH_BUILTIN_REGISTRY || 'https://registry.npmjs.org'
  const regArgs = registry === 'https://registry.npmjs.org' ? [] : ['--registry', registry]
  const pnpmArgs = ['--config.node-linker=hoisted', '--config.auto-install-peers=false', 'install', '--ignore-scripts', ...regArgs]

  const deps = {}
  for (const p of plugins) deps[p.name] = p.spec
  fs.rmSync(path.join(OUT, 'pnpm-lock.yaml'), { force: true })
  fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify({ name: 'dsh-builtin-plugins', private: true, dependencies: deps }, null, 2))
  fs.writeFileSync(path.join(OUT, '.npmrc'), 'node-linker=hoisted\nstrict-peer-dependencies=false\nauto-install-peers=false\n')
  log(`pnpm install ${Object.keys(deps).join(' ')} ...`)
  run(launcher[0], [...launcher[1], ...pnpmArgs], { cwd: OUT })

  return plugins.map((p) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(NM_INSTALL, p.name, 'package.json'), 'utf8'))
    if (pkg.version !== p.spec) {
      throw new Error(`${p.name}: 期望版本 ${p.spec}，实际装到了 ${pkg.version}`)
    }
    return { name: p.name, version: pkg.version, source: 'npm' }
  })
}

/** 从 GitHub Release 下载构建产物 tarball；解压到 OUT 内再 rename（同卷）。 */
async function installGhRelease(plugin) {
  const url = `https://github.com/${plugin.repo}/releases/download/${plugin.ref}/${encodeURIComponent(plugin.asset)}`
  log(`download ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${plugin.asset}: HTTP ${res.status}`)
  const tgz = path.join(os.tmpdir(), `builtin-${Date.now()}-${plugin.asset}`)
  fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()))
  try {
    const tar = process.platform === 'win32' && process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32', 'tar.exe')
      : 'tar'
    const extract = path.join(OUT, '.builtin-extract')
    fs.rmSync(extract, { recursive: true, force: true })
    fs.mkdirSync(extract, { recursive: true })
    run(tar, ['-xzf', tgz, '-C', extract])
    const entries = fs.readdirSync(extract)
    const dir = entries.find((e) => {
      try {
        return fs.statSync(path.join(extract, e)).isDirectory()
      } catch {
        return false
      }
    })
    if (!dir) throw new Error(`${plugin.asset}: tarball 内未找到包目录`)
    const target = path.join(NODE_MODULES, plugin.name)
    fs.rmSync(target, { recursive: true, force: true })
    fs.cpSync(path.join(extract, dir), target, { recursive: true })
    fs.rmSync(extract, { recursive: true, force: true })
    const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'))
    if (pkg.version !== plugin.version) {
      throw new Error(`${plugin.name}: 期望版本 ${plugin.version}，实际 ${pkg.version}`)
    }
    return { name: plugin.name, version: pkg.version, source: 'gh-release' }
  } finally {
    fs.rmSync(tgz, { force: true })
  }
}

function cleanHiddenNodes(plugin) {
  const dir = path.join(NODE_MODULES, plugin.name)
  fs.rmSync(path.join(dir, '.git'), { recursive: true, force: true })
  fs.rmSync(path.join(dir, '.DS_Store'), { force: true })
}

const readPkg = (dir) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) } catch { return null }
}

/** 扫插件产物里的裸 import 名（服务端 lib/**，跳过 node: 与相对路径）。 */
function bareImportsOf(pluginName) {
  const root = path.join(NODE_MODULES, pluginName, 'lib')
  const out = new Set()
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir)) {
      const p = path.join(dir, e)
      const st = fs.statSync(p)
      if (st.isDirectory()) { walk(p); continue }
      if (!e.endsWith('.js')) continue
      const text = fs.readFileSync(p, 'utf8')
      for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["']([a-z@][^"']*)["']/g)) {
        const name = m[1]
        if (name.startsWith('node:') || name.startsWith('.')) continue
        out.add(name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0])
      }
    }
  }
  walk(root)
  return out
}

/** 从种子（插件实测 import 的裸包）沿 dependencies/peerDependencies 求闭包。
 *  注意**不要**从插件名起步：插件 package.json 常声明构建期/客户端依赖
 *  （如 better-sidebar 声明的 mermaid，83MB），而服务端并不 import 它——只认实测 import。 */
function dependencyClosure(pluginNames) {
  const seeds = new Set()
  for (const name of pluginNames) for (const imp of bareImportsOf(name)) seeds.add(imp)
  const seen = new Set()
  const queue = [...seeds]
  while (queue.length) {
    const name = queue.shift()
    const dir = path.join(NODE_MODULES, name)
    if (!fs.existsSync(dir)) continue // 由内核运行时或 scope 目录提供的（如 @deepseek-ai/*、react）
    const pkg = readPkg(dir)
    if (pkg === null) continue
    seen.add(name)
    for (const dep of [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.peerDependencies || {})]) {
      if (!seen.has(dep)) queue.push(dep)
    }
  }
  return seen
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })

  const npmPlugins = CONFIG.plugins.filter((p) => p.source === 'npm')
  const ghPlugins = CONFIG.plugins.filter((p) => p.source === 'gh-release')
  const entries = [...installPnpm(npmPlugins)]
  // pnpm 只能在 node_modules 里产物；装完后整树改名到 packages（规避 electron-builder
  // 对名为 node_modules 的 extraResources 子目录的默认跳过）
  fs.renameSync(NM_INSTALL, NODE_MODULES)
  for (const plugin of ghPlugins) entries.push(await installGhRelease(plugin))
  for (const plugin of CONFIG.plugins) cleanHiddenNodes(plugin)


  // 裁剪：pnpm 会把全量 dependencies 装成扁平树（含 react-icons/mermaid/@codemirror 全家等
  // client-only 或构建期依赖，实测 410MB）。保留集**从插件实际 import 推导**，不写死名字
  // （写死的白名单会腐坏：palis 经 cordis 间接用到 cosmokit，漏掉就 Cannot find module）：
  //   ① 扫各插件 lib/**/*.js 的裸 import 名（剥掉 node: 与相对路径）
  //   ② 以「插件自身 + 这些裸名」为种子，沿每包的 dependencies/peerDependencies 求闭包
  //   ③ 保留闭包内顶层条目（含 scope 目录）
  // 依据：客户端产物是 rolldown 单文件 bundle（无外部 import），故服务端 import 闭包即依赖全貌。
  const closure = dependencyClosure(CONFIG.plugins.map((p) => p.name))
  const keepTops = new Set([...new Set(CONFIG.plugins.map((p) => p.name.split('/')[0]))])
  for (const name of closure) keepTops.add(name.split('/')[0])
  let pruned = 0
  for (const entry of fs.readdirSync(NODE_MODULES)) {
    if (keepTops.has(entry)) continue
    fs.rmSync(path.join(NODE_MODULES, entry), { recursive: true, force: true })
    pruned++
  }
  log(`pruned ${pruned} 个非依赖包（保留闭包 ${closure.size} 个 + scope 目录）`)

  // 只保留顶层插件及其扁平依赖；profile 种子不需要的杂项删掉
  for (const junk of ['.bin', '.package-lock.json', '.cache', '.modules.yaml']) {
    fs.rmSync(path.join(NODE_MODULES, junk), { recursive: true, force: true })
  }

  const manifest = { plugins: entries }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
  log(`done: ${fs.readdirSync(NODE_MODULES).length} 顶层包（${manifest.plugins.length} 个内置插件）`)
}

main().catch((err) => {
  console.error('[builtin-plugins] FAILED:', err.message)
  process.exit(1)
})
