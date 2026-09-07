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
const NODE_MODULES = path.join(OUT, 'node_modules')

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
function installPnpm(plugins) {
  const launcher = resolvePnpm()
  if (launcher === null) throw new Error('pnpm 不可用（corepack enable 也没成功），请先安装 pnpm')
  const registry = process.env.DSH_BUILTIN_REGISTRY || 'https://registry.npmjs.org'
  const regArgs = registry === 'https://registry.npmjs.org' ? [] : ['--registry', registry]
  const pnpmArgs = ['--config.node-linker=hoisted', 'install', '--ignore-scripts', ...regArgs]

  // 第一遍：只装插件 → 读它们的 peerDependencies（@deepseek-ai/* 名）
  const deps = {}
  for (const p of plugins) deps[p.name] = p.spec
  fs.rmSync(path.join(OUT, 'pnpm-lock.yaml'), { force: true })
  fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify({ name: 'dsh-builtin-plugins', private: true, dependencies: deps }, null, 2))
  fs.writeFileSync(path.join(OUT, '.npmrc'), 'node-linker=hoisted\nstrict-peer-dependencies=false\n')
  log(`pass 1: pnpm install ${Object.keys(deps).join(' ')} ...`)
  run(launcher[0], [...launcher[1], ...pnpmArgs], { cwd: OUT })

  // 第二遍：peer @deepseek-ai/* 按运行时实际版本钉死（见函数头注释）后重建
  const runtimeNm = path.join(ROOT, 'runtime', 'node_modules')
  let pinned = 0
  for (const name of collectDeepseekPeers(plugins)) {
    const pkgFile = path.join(runtimeNm, name, 'package.json')
    if (fs.existsSync(pkgFile)) {
      const ver = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version
      deps[name] = ver
      pinned++
    }
  }
  if (pinned > 0) {
    log(`pass 2: 钉死 ${pinned} 个 @deepseek-ai/* 到运行时版本，重装 ...`)
    fs.rmSync(path.join(OUT, 'pnpm-lock.yaml'), { force: true })
    fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify({ name: 'dsh-builtin-plugins', private: true, dependencies: deps }, null, 2))
    run(launcher[0], [...launcher[1], ...pnpmArgs], { cwd: OUT })
  }

  return plugins.map((p) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(NODE_MODULES, p.name, 'package.json'), 'utf8'))
    if (pkg.version !== p.spec) {
      throw new Error(`${p.name}: 期望版本 ${p.spec}，实际装到了 ${pkg.version}`)
    }
    return { name: p.name, version: pkg.version, source: 'npm' }
  })
}

/** 从各插件 package.json 收集 @deepseek-ai/* 开头的 peer 名（去重）。 */
function collectDeepseekPeers(plugins) {
  const names = new Set()
  for (const p of plugins) {
    const pkg = JSON.parse(fs.readFileSync(path.join(NODE_MODULES, p.name, 'package.json'), 'utf8'))
    for (const name of Object.keys(pkg.peerDependencies || {})) {
      if (name.startsWith('@deepseek-ai/')) names.add(name)
    }
  }
  return names
}

/**
 * pnpm 11 hoisted 布局下 peer 依赖（@deepseek-ai/*）不会出现在顶层 node_modules，
 * 只待在 .pnpm 虚拟店——而插件 require 的解析链从插件目录向上只走顶层。
 * 把虚拟店里 @deepseek-ai+* 条目下的真实包目录提平到顶层（与用户 profile 树同构）。
 */
function promoteDeepseekPeers() {
  const pnpmDir = path.join(NODE_MODULES, '.pnpm')
  const top = path.join(NODE_MODULES, '@deepseek-ai')
  if (!fs.existsSync(pnpmDir)) return
  fs.mkdirSync(top, { recursive: true })
  let n = 0
  for (const entry of fs.readdirSync(pnpmDir)) {
    if (!entry.startsWith('@deepseek-ai+')) continue
    const real = path.join(pnpmDir, entry, 'node_modules', '@deepseek-ai')
    if (!fs.existsSync(real)) continue
    for (const pkg of fs.readdirSync(real)) {
      const target = path.join(top, pkg)
      if (!fs.existsSync(target)) {
        fs.cpSync(path.join(real, pkg), target, { recursive: true })
        n++
      }
    }
  }
  log(`promoted ${n} @deepseek-ai/* peers to top level`)
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

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(NODE_MODULES, { recursive: true })

  const npmPlugins = CONFIG.plugins.filter((p) => p.source === 'npm')
  const ghPlugins = CONFIG.plugins.filter((p) => p.source === 'gh-release')
  const entries = [...installPnpm(npmPlugins)]
  for (const plugin of ghPlugins) entries.push(await installGhRelease(plugin))
  for (const plugin of CONFIG.plugins) cleanHiddenNodes(plugin)
  promoteDeepseekPeers()

  // 裁剪：npm 会把全量 dependencies 装成扁平树（0.15 版 better-sidebar 装出 410MB，
  // 大头是 react-icons/mermaid/node-pty/@codemirror 等 client-only 或构建期依赖）。
  // 依据：① client 侧产物 lib/client.js 是 rolldown 单文件 bundle（无外部 import，
  // 29 处命中均为内联实现）；② 服务端 import 闭包只有 schemastery + ws + @deepseek-ai/*。
  // 只保留：插件本体 + 服务端闭包 + @deepseek-ai 族（运行时同版本 peer 解析副本）。
  // 若未来插件升级新增服务端裸依赖，须同步加进白名单（构建冒烟会炸给你看）。
  const keepTops = new Set([
    ...new Set(CONFIG.plugins.map((p) => p.name.split('/')[0])), // 插件及其 scope 目录
    'schemastery',
    'ws',
    '@deepseek-ai', // promoteDeepseekPeers 提平出的插件 peer 副本
  ])
  let pruned = 0
  for (const entry of fs.readdirSync(NODE_MODULES)) {
    if (keepTops.has(entry)) continue
    fs.rmSync(path.join(NODE_MODULES, entry), { recursive: true, force: true })
    pruned++
  }
  log(`pruned ${pruned} client-only/build 包（保留 ${keepTops.size} 顶层结点）`)

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
