#!/usr/bin/env node
'use strict'

/**
 * 装一份「候选内核运行时」到工作区外，供契约验收在它上面跑（不动已安装实例）。
 *
 *   node scripts/prepare-candidate-runtime.mjs --version 0.1.5-rc.1 [--out <dir>] [--registry <url>]
 *   → 输出：<out>/node_modules/@deepseek-ai/dsh/**  + node 可执行文件 + runtime.json
 *   然后： node scripts/verify-kernel-contract.mjs --runtime <out> --render
 *
 * 与 prepare-runtime.ps1 / prepare-runtime-macos.sh 同一套布局（内核从 node_modules
 * 解析、node 二进制随树携带、runtime.json 记 {dsh,node,builtAt}），差别只在于
 * 目标是"候选版本"且产物落在工作区外（ZCode 会锁工作区内新建的大树）。
 *
 * 这就是「内核升级采纳流程」的第一步：候选 → 契约验收 → 过了才进 runtime/ 与发行版。
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const version = args.includes('--version') ? args[args.indexOf('--version') + 1] : ''
const registry = args.includes('--registry') ? args[args.indexOf('--registry') + 1] : ''
const out = args.includes('--out')
  ? path.resolve(args[args.indexOf('--out') + 1])
  : path.join(os.tmpdir(), `dsh-candidate-${version || 'latest'}`)

if (!version) {
  console.error('用法：node scripts/prepare-candidate-runtime.mjs --version <ver> [--out <dir>] [--registry <url>]')
  process.exit(2)
}

const log = (m) => console.error(`[candidate-runtime] ${m}`)
const run = (cmd, argv, opts = {}) => {
  const r = spawnSync(cmd, argv, { stdio: 'inherit', ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} 失败（exit ${r.status}）`)
}

function main() {
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ dependencies: { '@deepseek-ai/dsh': version } }, null, 2))

  log(`npm install @deepseek-ai/dsh@${version} -> ${out}`)
  const npmArgs = ['install', '--no-audit', '--no-fund']
  if (registry) npmArgs.push('--registry', registry)
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', npmArgs, { cwd: out, shell: process.platform === 'win32' })

  // node 二进制随树携带（与发行版运行时同构）
  const nodeBin = process.platform === 'win32'
    ? path.join(path.dirname(process.execPath), 'node.exe')
    : process.execPath
  if (process.platform === 'win32') {
    fs.copyFileSync(nodeBin, path.join(out, 'node.exe'))
  } else {
    fs.mkdirSync(path.join(out, 'bin'), { recursive: true })
    fs.copyFileSync(fs.realpathSync(nodeBin), path.join(out, 'bin', 'node'))
    fs.chmodSync(path.join(out, 'bin', 'node'), 0o755)
  }

  const installed = JSON.parse(fs.readFileSync(path.join(out, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'))
  fs.writeFileSync(path.join(out, 'runtime.json'), JSON.stringify({
    dsh: installed.version,
    node: process.version,
    builtAt: new Date().toISOString(),
  }, null, 2))

  log(`就绪：dsh=${installed.version} node=${process.version}`)
  console.log(out)
}

try {
  main()
} catch (err) {
  console.error(`[candidate-runtime] FAILED: ${err.message}`)
  process.exit(1)
}
