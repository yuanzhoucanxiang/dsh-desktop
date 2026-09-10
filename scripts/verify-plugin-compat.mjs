#!/usr/bin/env node
'use strict'

/**
 * 插件 × 内核兼容实测（为"内核升级前逐个实测插件"而做）。
 *
 *   node scripts/verify-plugin-compat.mjs --runtime <候选运行时> [--plugins <stage 树的 packages 目录>] [--json <out>]
 *
 * 做法：搭一个 Hermetic home（独立 DSH_HOME），把插件树 junction 进 profile，用指定内核
 * 起真实例，然后逐插件检查三件事：
 *   ① 宿主侧是否加载成功（stdout 无对应报错；boot 未失败）
 *   ② 客户端产物是否被内核服务（探测 client bundle 路由，200 即通）
 *   ③ UI 是否真挂上（headless Chrome 按 token 地址加载后查 DOM 标记）
 *
 * 注意：**不要把 @deepseek-ai 一起 junction 进 profile**——要让内核的 healProfilesModuleFallback
 * 把 profiles/node_modules 的 @deepseek-ai 指向"本轮实际使用的运行时"，否则会踩
 * "链接指向另一个运行时" 的错配（见 logs/2026-09-10.md 〔108〕）。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const opt = {
  runtime: args.includes('--runtime') ? args[args.indexOf('--runtime') + 1] : '',
  plugins: args.includes('--plugins')
    ? args[args.indexOf('--plugins') + 1]
    : path.join(os.tmpdir(), 'dsh-builtin-plugins', 'packages'),
  json: args.includes('--json') ? args[args.indexOf('--json') + 1] : '',
  keep: args.includes('--keep'),
  timeout: args.includes('--timeout') ? Number(args[args.indexOf('--timeout') + 1]) : 150,
}

/** 已知的 UI 标记（没有的走通用发现：属性/类名里含插件短名）。 */
const MARKERS = {
  'dsh-better-sidebar': '[data-dsh-better-sidebar]',
  '@dsh-local/palis-theme-panel': '.palis-globe, .palis-sonar',
}
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(
  (c) => !c.includes('/') || fs.existsSync(c)
)

const results = []
const record = (id, status, detail) => results.push({ id, status, detail: detail || '' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer()
  s.once('error', rej)
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
})

function resolveRuntime() {
  for (const dir of [opt.runtime, path.join(ROOT, 'runtime'), path.join(process.env.LOCALAPPDATA || '', 'DeepSeek Harness Desktop', 'runtime')].filter(Boolean)) {
    const node = process.platform === 'win32' ? path.join(dir, 'node.exe') : path.join(dir, 'bin', 'node')
    const bin = path.join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (fs.existsSync(node) && fs.existsSync(bin)) return { dir, node, bin }
  }
  return null
}

/** stage 树里要 junction 进 profile 的顶层条目（跳过 @deepseek-ai）。 */
function pluginEntries() {
  const out = []
  for (const e of fs.readdirSync(opt.plugins)) {
    if (e.startsWith('.') || e === '@deepseek-ai') continue
    const p = path.join(opt.plugins, e)
    if (!fs.statSync(p).isDirectory()) continue
    if (e.startsWith('@')) {
      for (const sub of fs.readdirSync(p)) {
        if (sub.startsWith('.')) continue
        out.push({ name: `${e}/${sub}`, src: path.join(p, sub) })
      }
    } else {
      out.push({ name: e, src: p })
    }
  }
  return out
}

async function main() {
  const rt = resolveRuntime()
  if (!rt) return report('未找到可用运行时')
  if (!fs.existsSync(opt.plugins)) return report(`插件树不存在：${opt.plugins}（先 node scripts/prepare-builtin-plugins.mjs）`)

  const kernelVersion = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(rt.dir, 'runtime.json'), 'utf8')).dsh } catch { return '?' }
  })()
  const entries = pluginEntries()
  const plugins = entries.filter((e) => {
    try { return !!JSON.parse(fs.readFileSync(path.join(e.src, 'package.json'), 'utf8')).dsh } catch { return false }
  })
  console.log(`内核 ${kernelVersion}（${rt.dir}） × ${plugins.length} 个插件\n`)

  /* Hermetic home */
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-compat-'))
  const home = path.join(sandbox, 'home')
  const profileDir = path.join(home, 'profiles', 'web')
  const nm = path.join(profileDir, 'node_modules')
  fs.mkdirSync(nm, { recursive: true })

  // 与生产同构：内核运行时已提供的包不再复制进 profile（由内核的
  // healProfilesModuleFallback 链接到"正在运行的运行时"）——避免用旧副本遮蔽运行时，
  // 也避免把内核包（npm 上只有 0.0.1-rc.1）当成插件依赖去装。
  const runtimeProvides = new Set(fs.readdirSync(path.join(rt.dir, 'node_modules')).filter((e) => !e.startsWith('.')))
  const deps = {}
  for (const e of entries) {
    const scope = e.name.split('/')[0]
    if (runtimeProvides.has(scope) && !scope.startsWith('@dsh-')) continue
    if (runtimeProvides.has(e.name) && !e.name.startsWith('@dsh-')) continue
    const link = path.join(nm, e.name)
    fs.mkdirSync(path.dirname(link), { recursive: true })
    fs.cpSync(e.src, link, { recursive: true })
    deps[e.name] = `link:${e.src}`
  }
  const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...plugins.map((p) => p.name)]
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web', private: true, dependencies: deps,
    dsh: { profile: { bundles } },
  }, null, 2))

  /* 起内核 */
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const child = spawn(rt.node, [rt.bin, '--profile', 'web', '--port', String(port), '--no-open'], {
    cwd: home, env: { ...process.env, DSH_HOME: home }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  let launchUrl = ''
  let carry = ''
  const wire = (b) => {
    const text = b.toString('utf8')
    out += text
    const lines = (carry + text).split(/\r?\n/)
    carry = lines.pop() || ''
    for (const l of lines) {
      const m = /dsh web: (https?:\/\/\S+)/.exec(l.replace(/\x1b\[[0-9;]*m/g, ''))
      if (m && !launchUrl) launchUrl = m[1].trim()
    }
  }
  child.stdout.on('data', wire)
  child.stderr.on('data', wire)

  const teardown = async (chrome) => {
    try { chrome?.kill() } catch {}
    try { child.kill() } catch {}
    await sleep(500)
    for (const c of [chrome, child]) {
      if (c && c.exitCode === null && process.platform === 'win32') {
        try { spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch {}
      }
    }
    if (!opt.keep) { try { fs.rmSync(sandbox, { recursive: true, force: true }) } catch {} }
  }

  const ACCEPT = new Set([200, 401, 303])
  const dl = Date.now() + opt.timeout * 1000
  let ready = false
  let last = 0
  while (Date.now() < dl) {
    if (child.exitCode !== null) break
    try {
      const r = await fetch(base, { redirect: 'manual', signal: AbortSignal.timeout(2500) })
      last = r.status
      if (ACCEPT.has(r.status)) { ready = true; break }
    } catch {}
    await sleep(500)
  }
  if (!ready) {
    // 取更完整的报错：AggregateError 会在后续行列出每个失败条目
    const errLines = out.split('\n').filter((l) => /failed to import loader entry|not defined by "exports"|Cannot find (module|package)|Error:/.test(l))
    const detail = [errLines[0], ...errLines.slice(1, 4)].filter(Boolean).map((l) => l.trim().slice(0, 200)).join('\n      ↳ ')
    record('boot', 'fail', `内核未就绪（exit=${child.exitCode}，最后 ${last || '无应答'}）\n      ↳ ${detail}`)
    await teardown(null)
    return report()
  }
  for (let i = 0; i < 20 && !launchUrl; i++) await sleep(500)
  record('boot', 'pass', `内核 ${kernelVersion} 就绪（GET / → ${last}），${plugins.length} 个插件在 bundles 里`)

  /* ① 宿主侧：stdout 里有没有与插件相关的报错 */
  const errLines = out.split('\n').filter((l) => /failed to import loader entry|failed to apply|declare no dsh\.bundle|Cannot find (module|package)/i.test(l))
  for (const p of plugins) {
    const hit = errLines.find((l) => l.includes(p.name))
    record(`host:${p.name}`, hit ? 'fail' : 'pass', hit ? hit.trim().slice(0, 160) : '无加载报错')
  }

  /* ② 客户端产物路由实测（先探哪个前缀在服务） */
  const routes = (name) => [`/plugins/${name}/client.js`, `/${name}/client.js`, `/api/plugins/${name}/client.js`, `/plugin/${name}/client.js`]
  const clientOf = (p) => {
    try { return !!JSON.parse(fs.readFileSync(path.join(p.src, 'package.json'), 'utf8')).dsh.client } catch { return false }
  }
  for (const p of plugins) {
    if (!clientOf(p)) { record(`client:${p.name}`, 'skip', '该插件无客户端部分'); continue }
    let hit = ''
    for (const r of routes(p.name)) {
      try {
        const res = await fetch(`${base}${r}`, { redirect: 'manual', signal: AbortSignal.timeout(4000) })
        if (res.status === 200) { hit = r; break }
      } catch {}
    }
    record(`client:${p.name}`, hit ? 'pass' : 'warn', hit ? `客户端产物可服务：${hit}` : '未探到 200 的客户端产物路由（路由名可能不同）')
  }

  /* ③ UI 挂载：headless Chrome 按 token 地址加载后查 DOM 标记 */
  if (CHROME) {
    const cdpPort = await freePort()
    const chromeProfile = path.join(sandbox, 'chrome')
    fs.mkdirSync(chromeProfile, { recursive: true })
    const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${chromeProfile}`,
      '--no-first-run', '--disable-gpu', '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' })
    try {
      let target = null
      for (let i = 0; i < 60 && !target; i++) {
        try { const l = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json(); target = l.find((t) => t.type === 'page') } catch {}
        if (!target) await sleep(250)
      }
      const ws = new WebSocket(target.webSocketDebuggerUrl)
      await new Promise((r) => (ws.onopen = r))
      let id = 0
      const pending = new Map()
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
      const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
      const evalJs = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value

      await send('Page.enable'); await send('Runtime.enable')
      await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
      await send('Page.navigate', { url: launchUrl || `${base}/` })
      await sleep(7000) // 等应用 + 插件客户端装入
      for (const p of plugins) {
        if (!clientOf(p)) continue
        const marker = MARKERS[p.name] || null
        const expr = marker
          ? `!!document.querySelector(${JSON.stringify(marker)})`
          : `(() => { const short = ${JSON.stringify(p.name.split('/').pop())}; return [...document.querySelectorAll('*')].some((el) => [...el.attributes].some((a) => a.name.includes(short) || String(a.value).includes(short))) })()`
        const ok = (await evalJs(expr)) === true
        record(`ui:${p.name}`, ok ? 'pass' : 'warn',
          ok ? `已挂载（判据：${marker || '属性含插件名'}）` : `未检出挂载标记（判据：${marker || '属性含插件名'}）——可能本就没常驻 UI，需目检确认`)
      }
    } catch (err) {
      record('ui', 'warn', `DOM 检查异常：${err.message}`)
    }
    await teardown(chrome)
  } else {
    record('ui', 'skip', '未找到 Chrome')
  }
  return report()
}

function report(fatal) {
  if (fatal) record('env', 'fail', fatal)
  const width = Math.max(...results.map((r) => r.id.length), 8)
  console.log(results.map((r) => `  [${r.status.toUpperCase()}] ${r.id.padEnd(width)}  ${r.detail}`).join('\n'))
  const fails = results.filter((r) => r.status === 'fail')
  if (opt.json) {
    fs.mkdirSync(path.dirname(path.resolve(opt.json)), { recursive: true })
    fs.writeFileSync(opt.json, JSON.stringify({ at: new Date().toISOString(), results, fails: fails.map((r) => r.id) }, null, 2))
  }
  console.log(fails.length === 0 ? '\nPLUGIN_COMPAT_OK' : `\nPLUGIN_COMPAT_FAIL ${fails.map((r) => r.id).join(' ')}`)
  process.exit(fails.length === 0 ? 0 : 1)
}

main().catch((err) => report(err && err.stack ? err.stack.split('\n')[0] : String(err)))
