#!/usr/bin/env node
'use strict'

/**
 * 内核接触面契约验收（Hermetic：独立 DSH_HOME + 随机端口，绝不碰用户正在用的实例）。
 *
 *   node scripts/verify-kernel-contract.mjs [--json <out.json>] [--keep] [--timeout <sec>]
 *   → 拉起一份内核，按 contracts/kernel-surface.json 逐条探针，打印 绿/黄/红 报告。
 *   → 任一 critical 行失败则退出码 1（CI 兼容门的判定依据）。
 *
 * 为什么存在：内核升级的适配成本几乎全在「发现晚 + 归属慢」。本套件把契约变成可执行
 * 探针，让一次运行直接指出哪条依赖坏了（见 contracts/kernel-surface.json 的维护约定）。
 *
 * 设计要点：
 *   · stdout 按行装配（跨 chunk 的半行先攒着）——外壳那边的 token 抓取就是栽在
 *     直接对分片跑正则上，这里必须做对，才能真实复现「启动行能否解析」。
 *   · pending 行显式报「未接入」，绝不当通过。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { bundleBootable, CORE_BUNDLES } = require('../lib/profile-inspect')
const ROOT = path.resolve(__dirname, '..')
const CONTRACT = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts', 'kernel-surface.json'), 'utf8'))

const args = process.argv.slice(2)
const opt = {
  json: args.includes('--json') ? args[args.indexOf('--json') + 1] : '',
  keep: args.includes('--keep'),
  timeout: args.includes('--timeout') ? Number(args[args.indexOf('--timeout') + 1]) : 150,
}

const results = []
const record = (id, status, detail) => results.push({ id, status, detail: detail || '' })

/* ── 运行时定位 ─────────────────────────────────────────────────────────── */

function resolveRuntime() {
  const candidates = [
    path.join(ROOT, 'runtime'), // 开发树
    path.join(process.env.LOCALAPPDATA || '', 'DeepSeek Harness Desktop', 'runtime'), // 已安装实例
  ]
  for (const dir of candidates) {
    if (!dir) continue
    const node = process.platform === 'win32' ? path.join(dir, 'node.exe') : path.join(dir, 'bin', 'node')
    const bin = path.join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (fs.existsSync(node) && fs.existsSync(bin)) return { dir, node, bin }
  }
  return null
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port
      srv.close(() => resolve(p))
    })
  })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ── 静态扫描（前端产物里的锚点/令牌/加载器） ────────────────────────────── */

/** 展开扫描组：形如 "dsh-client-ui-<star>/lib/<star>.js" 的通配，返回文件路径数组。 */
function expandScan(patterns) {
  const nm = path.join(rt.dir, 'node_modules', '@deepseek-ai')
  const out = []
  for (const pattern of patterns) {
    const star = pattern.indexOf('*')
    if (star === -1) continue
    const dirPattern = pattern.slice(0, pattern.lastIndexOf('/', star))
    const fileGlob = pattern.slice(pattern.lastIndexOf('/') + 1)
    const ext = fileGlob.slice(fileGlob.indexOf('.')) // *.js / *.css
    const baseDirs = []
    if (dirPattern.includes('*')) {
      const prefix = dirPattern.slice(0, dirPattern.indexOf('*'))
      if (fs.existsSync(nm)) {
        for (const e of fs.readdirSync(nm)) if (e.startsWith(prefix)) baseDirs.push(path.join(nm, e, 'lib'))
      }
    } else {
      baseDirs.push(path.join(nm, dirPattern))
    }
    for (const d of baseDirs) {
      if (!fs.existsSync(d)) continue
      for (const f of fs.readdirSync(d)) if (f.endsWith(ext)) out.push(path.join(d, f))
    }
  }
  return out
}

/** 在扫描集里找缺失的名字（改名检测）。 */
function scanForMissing(patterns, items) {
  const names = items || []
  if (names.length === 0) return { files: 0, missing: [], empty: true }
  const files = expandScan(patterns)
  const texts = files.map((f) => {
    try { return fs.readFileSync(f, 'utf8') } catch { return '' }
  })
  const missing = names.filter((name) => !texts.some((t) => t.includes(name)))
  return { files: files.length, missing, empty: false }
}

/* ── 主流程 ─────────────────────────────────────────────────────────────── */

let rt = null
let child = null
let sandbox = ''
let base = ''
let launchLine = ''
let stdoutAll = ''

async function main() {
  rt = resolveRuntime()
  if (!rt) {
    record('shell.runtime-layout', 'fail', '未找到可用运行时（runtime/ 与已安装实例都没有）')
    return report()
  }
  record('shell.runtime-layout', 'pass', `${rt.dir}`)

  // runtime marker 契约
  const marker = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(rt.dir, 'runtime.json'), 'utf8')) } catch { return null }
  })()
  const markerOk = marker && typeof marker.dsh === 'string' && /^v?\d/.test(String(marker.node)) && String(marker.builtAt).length > 8
  record('shell.runtime-marker', markerOk ? 'pass' : 'warn', marker ? `dsh=${marker.dsh} node=${marker.node}` : 'runtime.json 缺失/不可解析')

  // Hermetic 沙箱
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-contract-'))
  const home = path.join(sandbox, 'home')
  const out = path.join(sandbox, 'out')
  fs.mkdirSync(path.join(home, 'profiles', 'web'), { recursive: true })
  fs.mkdirSync(out, { recursive: true })

  // 补丁文件：用外壳真实的 - insert: 形状 + review-bridge 插件（验证补丁格式与插件挂载）
  const reviewBridge = path.join(ROOT, 'plugin', 'review-bridge.js')
  const streamFile = path.join(out, 'review-events.ndjson').replace(/\\/g, '/')
  const patchFile = path.join(sandbox, 'kernel.patch.yml')
  fs.writeFileSync(patchFile, [
    '# generated by verify-kernel-contract',
    '- insert:',
    '    - id: review-bridge',
    `      name: '${pathToFileURL(reviewBridge).href}'`,
    '      config:',
    `        out: '${streamFile}'`,
    '',
  ].join('\n'))

  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  child = spawn(rt.node, [rt.bin, '--profile', 'web', '--patch', patchFile, '--port', String(port), '--no-open'], {
    cwd: home,
    env: { ...process.env, DSH_HOME: home },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // stdout 按行装配（跨 chunk 半行先攒着）
  let carry = ''
  const onData = (buf) => {
    const text = buf.toString('utf8')
    stdoutAll += text
    const lines = (carry + text).split(/\r?\n/)
    carry = lines.pop() || ''
    for (const line of lines) {
      const m = /dsh web: (https?:\/\/\S+)/.exec(line.replace(/\x1b\[[0-9;]*m/g, ''))
      if (m && !launchLine) launchLine = m[1].trim()
    }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', (b) => { stdoutAll += b.toString('utf8') })

  // 就绪等待：任何应答即视为服务已起（就绪语义见 shell.http-root 契约）
  const deadline = Date.now() + opt.timeout * 1000
  let ready = false
  let readyStatus = 0
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break
    try {
      const res = await fetch(`${base}/`, { redirect: 'manual', signal: AbortSignal.timeout(2500) })
      readyStatus = res.status
      ready = true
      break
    } catch { await sleep(500) }
  }

  if (!ready) {
    record('shell.http-root', 'fail', child.exitCode !== null ? `内核提前退出 code=${child.exitCode}` : `超时未应答（${opt.timeout}s）`)
    await finish()
    return report()
  }

  /* 探针：启动行 */
  record('shell.launch-line',
    launchLine ? 'pass' : 'fail',
    launchLine ? `${launchLine.replace(/token=[^&]+/, 'token=<redacted>')}${/token=/.test(launchLine) ? ' [含 token]' : ' [无 token：老内核]'}` : 'stdout 未见可解析的 dsh web 行（外壳的 token 抓取会静默失效）')

  /* 探针：补丁与插件挂载 */
  const mounted = /\[review-bridge\] loaded/.test(stdoutAll)
  record('shell.cli-and-patch-boot', mounted ? 'pass' : 'fail',
    mounted ? '--profile/--patch/--port/--no-open 被接受，补丁内 file:// 插件行已加载' : '补丁未被接受或插件未加载（stdout 无 [review-bridge] loaded）')

  /* 探针：就绪码集合 */
  const rootOk = [200, 401, 303].includes(readyStatus)
  record('shell.http-root', rootOk ? 'pass' : 'warn', `GET / → ${readyStatus}`)

  /* 探针：/api 的鉴权链 */
  try {
    const probePath = '/api/__contract_probe__'
    const r1 = await fetch(`${base}${probePath}`, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
    if (r1.status === 401) {
      if (!/token=/.test(launchLine)) {
        record('shell.http-api-auth', 'fail', '/api 要求鉴权但启动行没给出 token——外壳无从换 cookie')
      } else {
        const rc = await fetch(launchLine, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
        const cookie = (rc.headers.get('set-cookie') || '').split(';')[0]
        if (!cookie) {
          record('shell.http-api-auth', 'fail', `token 换 cookie 失败：GET token URL → ${rc.status}，set-cookie 为空`)
        } else {
          const r2 = await fetch(`${base}${probePath}`, {
            redirect: 'manual',
            headers: { cookie },
            signal: AbortSignal.timeout(5000),
          })
          record('shell.http-api-auth', r2.status !== 401 ? 'pass' : 'fail',
            `无 cookie 401 → 换得 cookie → 重试 ${r2.status}`)
        }
      }
    } else {
      record('shell.http-api-auth', 'pass', `未启用鉴权（/api 无 cookie → ${r1.status}）`)
    }
  } catch (err) {
    record('shell.http-api-auth', 'fail', `探针异常：${err.message}`)
  }

  /* 探针：插件自注册裸路由 */
  if (mounted) {
    try {
      const r = await fetch(`${base}/api/review-bridge/revert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: '__probe__', callId: '__probe__' }),
        signal: AbortSignal.timeout(5000),
      })
      record('shell.plugin-route', r.status === 404 ? 'warn' : 'pass', `POST /api/review-bridge/revert → ${r.status}`)
    } catch (err) {
      record('shell.plugin-route', 'fail', `探针异常：${err.message}`)
    }
  } else {
    record('shell.plugin-route', 'skip', '插件未挂载，跳过')
  }

  /* 探针：profile 清单 + bundle 声明 */
  const manifestPath = path.join(home, 'profiles', 'web', 'package.json')
  const manifest = (() => {
    try { return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) } catch { return null }
  })()
  const bundles = manifest && manifest.dsh && manifest.dsh.profile && Array.isArray(manifest.dsh.profile.bundles)
    ? manifest.dsh.profile.bundles
    : null
  record('shell.profile-manifest', bundles ? 'pass' : 'fail',
    bundles ? `内核在空 home 自动初始化：bundles=[${bundles.join(', ')}]` : '未生成可解析的 {dependencies, dsh.profile.bundles}')

  if (bundles) {
    // 与外壳同规则：内核自带 bundle（CORE_BUNDLES）与 cordis:* 条目不检——
    // 它们由内核从运行时目录解析，不在 profile 的 node_modules 里
    const checked = bundles.filter((b) => !b.includes(':') && !CORE_BUNDLES.has(b))
    const bad = checked.filter((b) => !bundleBootable(b, { manifestPath }).ok)
    const skipped = bundles.length - checked.length
    record('shell.plugin-bundle-decl', bad.length === 0 ? 'pass' : 'fail',
      bad.length === 0
        ? `${checked.length} 个插件 bundle 均可加载${skipped ? `（跳过 ${skipped} 个内核自带）` : ''}`
        : `不可加载：${bad.join(', ')}`)
  } else {
    record('shell.plugin-bundle-decl', 'skip', '清单不可用，跳过')
  }

  /* 探针：静态扫描（令牌 / 模块加载器 / DOM 锚点） */
  const byId = Object.fromEntries(CONTRACT.surfaces.map((s) => [s.id, s]))
  for (const id of ['theme.design-tokens', 'theme.module-loader', 'theme.dom-anchors']) {
    const row = byId[id]
    if (!row || !row.detail || !row.detail.scan) { record(id, 'warn', '契约行缺少 detail.scan，无法扫描'); continue }
    const { files, missing, empty } = scanForMissing(row.detail.scan, row.detail.items)
    if (empty) record(id, 'warn', '契约行未列 items，探针无对象')
    else if (files === 0) record(id, 'warn', '扫描集为空（前端产物路径可能变了）')
    else if (missing.length === 0) record(id, 'pass', `${row.detail.items.length} 项全部命中（扫 ${files} 个文件）`)
    else record(id, 'fail', `缺失/改名：${missing.join(', ')}（扫 ${files} 个文件）`)
  }

  /* 探针：真实已装 profile 的插件（只读，不碰用户实例）——空 home 的检查是空转的，
     真正会在内核升级时坏掉的是这些已装插件，所以单独报一行。 */
  const realHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const realManifest = path.join(realHome, 'profiles', 'web', 'package.json')
  if (fs.existsSync(realManifest)) {
    const rm = (() => {
      try { return JSON.parse(fs.readFileSync(realManifest, 'utf8')) } catch { return null }
    })()
    const rb = rm && rm.dsh && rm.dsh.profile && Array.isArray(rm.dsh.profile.bundles) ? rm.dsh.profile.bundles : []
    const plugins = rb.filter((b) => !b.includes(':') && !CORE_BUNDLES.has(b))
    const bad = plugins.filter((b) => !bundleBootable(b, { manifestPath: realManifest }).ok)
    record('env.installed-plugins', bad.length === 0 ? 'pass' : 'warn',
      plugins.length === 0
        ? `${realHome} 未装插件`
        : `${plugins.length} 个已装插件${bad.length ? `，不可加载：${bad.join(', ')}` : '均可加载'}（${plugins.join(', ')}）`)
  } else {
    record('env.installed-plugins', 'skip', `未找到 ${realManifest}`)
  }

  await finish()
  return report()
}

async function finish() {
  if (child && child.exitCode === null) {
    try { child.kill() } catch {}
    await sleep(600)
    if (child.exitCode === null && process.platform === 'win32') {
      try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch {}
    }
  }
  if (sandbox && !opt.keep) {
    try { fs.rmSync(sandbox, { recursive: true, force: true }) } catch {}
  }
}

function report() {
  const pending = CONTRACT.surfaces.filter((s) => s.probe === 'pending')
  const icon = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', skip: 'SKIP' }
  const width = Math.max(...results.map((r) => r.id.length))
  console.log(`\n内核接触面契约验收（${CONTRACT.surfaces.length} 条，其中 ${pending.length} 条探针未接入）\n`)
  for (const r of results) {
    console.log(`  [${icon[r.status] || r.status}] ${r.id.padEnd(width)}  ${r.detail}`)
  }
  const sev = Object.fromEntries(CONTRACT.surfaces.map((s) => [s.id, s.severity]))
  const criticalFails = results.filter((r) => r.status === 'fail' && sev[r.id] === 'critical')
  if (pending.length) {
    console.log(`\n  未接入探针：${pending.map((s) => s.id).join(', ')}`)
  }
  const counts = results.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {})
  console.log(`\n  合计 ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}` +
    `　critical 失败 ${criticalFails.length} 条`)
  if (opt.json) {
    fs.mkdirSync(path.dirname(path.resolve(opt.json)), { recursive: true })
    fs.writeFileSync(opt.json, JSON.stringify({
      at: new Date().toISOString(),
      kernel: (() => { try { return JSON.parse(fs.readFileSync(path.join(rt.dir, 'runtime.json'), 'utf8')).dsh } catch { return '' } })(),
      results, pending: pending.map((s) => s.id), criticalFails: criticalFails.map((r) => r.id),
    }, null, 2))
    console.log(`  报告已写入 ${opt.json}`)
  }
  console.log(criticalFails.length === 0 ? '\nKERNEL_CONTRACT_OK' : `\nKERNEL_CONTRACT_FAIL ${criticalFails.map((r) => r.id).join(' ')}`)
  process.exit(criticalFails.length === 0 ? 0 : 1)
}

main().catch(async (err) => {
  record('harness', 'fail', err && err.stack ? err.stack.split('\n')[0] : String(err))
  await finish()
  report()
})
