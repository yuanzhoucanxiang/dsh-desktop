#!/usr/bin/env node
'use strict'

/**
 * 渲染不变量验收（契约 theme.render-invariants 的探针实现）。
 *
 *   node scripts/verify-render-invariants.mjs [--json <out>] [--keep] [--dpr 2.73]
 *
 * 为什么单独一个脚本：其余契约探针是协议/文件级的、秒级、无浏览器；这一条必须
 * 真起浏览器 + 真渲染 + 逐帧采样，才能看见「静态截图看不出来」的那类破坏——
 * 0.1.2 内核那次球体/月面/声纳变形就是这一类（DOM 契约全中、截图逐像素是正圆，
 * 只有实时合成路径可见）。
 *
 * 四项不变量（对应契约 detail）：
 *   ① 装饰层宿主的包含块 = 视口
 *   ② 宿主到 body 之间没有元素建立包含块（transform/filter/will-change/contain/perspective）
 *      —— 这条是根因检查：一旦内核给某个包裹层加了这些，我们的 absolute 层会改按新
 *      包含块解析、fixed 层会被捕获在那个祖先里，几何随之漂移/拉伸
 *   ③ 圆形动效不得走合成层缩放（合成层位图逐帧缩放 = 分数 DPR 下读作"不圆"）
 *   ④ 分数 DPR（本机实测 2.73）下不得出现几何变形
 *
 * Hermetic：独立 DSH_HOME（临时目录，junction 挂入主题插件）+ 随机端口 + 临时
 * Chrome profile，绝不碰用户实例。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PALIS = process.env.DSH_PALIS_DIR || path.resolve(ROOT, '..', 'dsh-palis-theme-panel')
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'google-chrome',
]

const args = process.argv.slice(2)
const opt = {
  json: args.includes('--json') ? args[args.indexOf('--json') + 1] : '',
  keep: args.includes('--keep'),
  dpr: args.includes('--dpr') ? Number(args[args.indexOf('--dpr') + 1]) : 2.73,
  shot: args.includes('--shot') ? args[args.indexOf('--shot') + 1] : '',
  runtime: args.includes('--runtime') ? args[args.indexOf('--runtime') + 1] : '',
  timeout: args.includes('--timeout') ? Number(args[args.indexOf('--timeout') + 1]) : 150,
}

const results = []
const record = (id, status, detail) => results.push({ id, status, detail: detail || '' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* 主题注入的装饰层（类名取自 palis-theme-panel 的 client 注入代码） */
const CIRCULAR = ['.palis-globe-sphere', '.palis-globe-canvas', '.palis-sonar i', '.palis-sonar s', '.fm-disc', '.fm-ring']
const ANCHORED = ['.palis-crt-sweep', '.palis-frame', '.palis-globe', '.palis-sonar', '.palis-statusbar', '.palis-starfield', '.palis-glyphs', '.palis-sonar b', '.palis-globe-sat']

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer()
  srv.once('error', reject)
  srv.listen(0, '127.0.0.1', () => {
    const p = srv.address().port
    srv.close(() => resolve(p))
  })
})

function resolveRuntime() {
  // --runtime：在候选内核上验收（见 scripts/prepare-candidate-runtime.mjs）
  for (const dir of [opt.runtime, path.join(ROOT, 'runtime'), path.join(process.env.LOCALAPPDATA || '', 'DeepSeek Harness Desktop', 'runtime')].filter(Boolean)) {
    if (!dir) continue
    const node = process.platform === 'win32' ? path.join(dir, 'node.exe') : path.join(dir, 'bin', 'node')
    const bin = path.join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (fs.existsSync(node) && fs.existsSync(bin)) return { dir, node, bin }
  }
  return null
}

function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    if (c.includes('/') && !fs.existsSync(c)) continue
    return c
  }
  return null
}

/* ── 浏览器内取样的表达式 ─────────────────────────────────────────────── */

/** 沿祖先链找"建立包含块"的元素（不变量① ②的根因检查）。 */
const EVAL_ANCESTORS = `(${(sels) => {
  const report = {}
  for (const sel of sels) {
    const el = document.querySelector(sel)
    if (!el) { report[sel] = { missing: true }; continue }
    const style = getComputedStyle(el)
    const bad = []
    let node = el.parentElement
    while (node && node !== document.documentElement) {
      const cs = getComputedStyle(node)
      const hit = (prop, value) => bad.push({ prop, value, node: node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') })
      if (cs.transform !== 'none') hit('transform', cs.transform)
      if (cs.filter !== 'none') hit('filter', cs.filter)
      if (cs.backdropFilter && cs.backdropFilter !== 'none') hit('backdrop-filter', cs.backdropFilter)
      if (cs.perspective !== 'none') hit('perspective', cs.perspective)
      if (/transform|filter|perspective/.test(cs.willChange || '')) hit('will-change', cs.willChange)
      if (/layout|paint|strict|content/.test(cs.contain || '')) hit('contain', cs.contain)
      node = node.parentElement
    }
    report[sel] = { position: style.position, bad }
  }
  return report
}})(${JSON.stringify(ANCHORED)})`

/** 视口锚定检查：fixed 层应与视口严丝合缝（被捕获时会明显不符）。 */
const EVAL_VIEWPORT = `(${(sels) => {
  const report = {}
  for (const sel of sels) {
    const el = document.querySelector(sel)
    if (!el) { report[sel] = { missing: true }; continue }
    const cs = getComputedStyle(el)
    if (cs.position !== 'fixed') { report[sel] = { skip: cs.position }; continue }
    const r = el.getBoundingClientRect()
    report[sel] = {
      left: +r.left.toFixed(1), top: +r.top.toFixed(1),
      w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      iw: innerWidth, ih: innerHeight,
    }
  }
  return report
}})(${JSON.stringify(ANCHORED)})`

/** 逐帧几何采样（不变量③ ④）：动画进行中宽高是否恒等、是否漂移。 */
const EVAL_FRAMES = `(${(async (sels, frames) => {
  const snap = () => {
    const out = {}
    for (const sel of sels) {
      const el = document.querySelector(sel)
      if (!el) { out[sel] = null; continue }
      const r = el.getBoundingClientRect()
      out[sel] = { w: +r.width.toFixed(2), h: +r.height.toFixed(2), l: +r.left.toFixed(2), t: +r.top.toFixed(2) }
    }
    return out
  }
  const series = []
  for (let i = 0; i < frames; i++) {
    await new Promise((r) => requestAnimationFrame(() => r()))
    series.push(snap())
  }
  return { dpr: devicePixelRatio, series }
})})(${JSON.stringify(CIRCULAR)}, 40)`

async function main() {
  const rt = resolveRuntime()
  if (!rt) { record('render.env', 'fail', '未找到可用运行时'); return report() }
  if (!fs.existsSync(path.join(PALIS, 'lib', 'client.js'))) {
    record('render.env', 'fail', `主题插件构建产物缺失：${path.join(PALIS, 'lib', 'client.js')}（先 npm run build）`)
    return report()
  }
  const chrome = findChrome()
  if (!chrome) { record('render.env', 'skip', '未找到 Chrome，渲染探针跳过'); return report() }

  /* Hermetic 沙箱：空 home + 主题插件（junction 与真实 profile 同构） */
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-render-'))
  const home = path.join(sandbox, 'home')
  const profileDir = path.join(home, 'profiles', 'web')
  const nm = path.join(profileDir, 'node_modules', '@dsh-local')
  fs.mkdirSync(nm, { recursive: true })
  fs.symlinkSync(PALIS, path.join(nm, 'palis-theme-panel'), 'junction')
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dependencies: { '@dsh-local/palis-theme-panel': `link:${PALIS}` },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dsh-local/palis-theme-panel'] } },
  }, null, 2))

  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const kernel = spawn(rt.node, [rt.bin, '--profile', 'web', '--port', String(port), '--no-open'], {
    cwd: home,
    env: { ...process.env, DSH_HOME: home },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let kernelOut = ''
  let launchUrl = ''
  let carry = ''
  const wire = (buf) => {
    const text = buf.toString('utf8')
    kernelOut += text
    const lines = (carry + text).split(/\r?\n/)
    carry = lines.pop() || ''
    for (const line of lines) {
      const m = /dsh web: (https?:\/\/\S+)/.exec(line.replace(/\x1b\[[0-9;]*m/g, ''))
      if (m && !launchUrl) launchUrl = m[1].trim()
    }
  }
  kernel.stdout.on('data', wire)
  kernel.stderr.on('data', wire)

  const teardown = async (cs) => {
    try { cs?.kill() } catch {}
    await sleep(500)
    for (const c of [cs, kernel]) {
      if (c && c.exitCode === null && process.platform === 'win32') {
        try { spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch {}
      }
    }
    if (!opt.keep) { try { fs.rmSync(sandbox, { recursive: true, force: true }) } catch {} }
  }

  // 就绪：只有 200/401/303 才算（与外壳 probeReady 同语义；0.1.5 端口会先答 404）
  const ACCEPT = new Set([200, 401, 303])
  const dl = Date.now() + opt.timeout * 1000
  let ready = false
  let last = 0
  while (Date.now() < dl) {
    if (kernel.exitCode !== null) break
    try {
      const res = await fetch(base, { redirect: 'manual', signal: AbortSignal.timeout(2500) })
      last = res.status
      if (ACCEPT.has(res.status)) { ready = true; break }
    } catch {}
    await sleep(500)
  }
  if (!ready) {
    record('render.env', 'fail', `内核未就绪（exit=${kernel.exitCode}，最后状态 ${last || '无应答'}）${/error/i.test(kernelOut) ? '：' + kernelOut.split('\n').filter((l) => /error/i.test(l)).slice(0, 2).join(' | ') : ''}`)
    await teardown(null)
    return report()
  }
  // 启动行可能晚于端口就绪（0.1.5 实测约 1s）
  for (let i = 0; i < 20 && !launchUrl; i++) await sleep(500)
  // 页面地址：有 token 就用带 token 的（内核 0.1.2+ 的入口；浏览器凭它换 cookie），
  // 否则退回裸 origin（老内核）。拿裸 URL 导航会在 0.1.2+ 上停在 401 页 → 无内核 UI。
  const pageUrl = launchUrl || `${base}/`
  record('render.auth', launchUrl ? 'pass' : 'warn',
    launchUrl ? '启动行含一次性 token，页面按带 token 地址加载' : '启动行无 token，按裸地址加载（老内核）')

  // 打开主题（插件的 /api/palis-theme 契约：POST {theme:'palis'} → enabled=true）
  try {
    const r = await fetch(`${base}/api/palis-theme`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme: 'palis' }),
      signal: AbortSignal.timeout(8000),
    })
    record('render.env', r.ok ? 'pass' : 'fail', `主题启用接口 POST /api/palis-theme → ${r.status}`)
  } catch (err) {
    record('render.env', 'fail', `主题启用失败：${err.message}`)
  }

  /* Chrome + CDP */
  const cdpPort = await freePort()
  const profile = path.join(sandbox, 'chrome')
  fs.mkdirSync(profile, { recursive: true })
  const cs = spawn(chrome, [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1600,900', 'about:blank',
  ], { stdio: 'ignore' })

  let ws
  try {
    let target = null
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
        target = list.find((t) => t.type === 'page')
      } catch {}
      if (!target) await sleep(250)
    }
    if (!target) throw new Error('CDP 未就绪')

    ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws 连接失败')) })
    let id = 0
    const pending = new Map()
    const layers = []
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
      if (msg.method === 'LayerTree.layerTreeDidChange' || msg.method === 'LayerTree.layerPainted') {
        for (const layer of msg.params?.layers || []) layers.push(layer)
      }
    }
    const send = (method, params = {}) => new Promise((resolve) => {
      const mid = ++id
      pending.set(mid, resolve)
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
      return r.result?.result?.value
    }

    await send('Page.enable')
    await send('Runtime.enable')
    await send('DOM.enable')
    await send('LayerTree.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: opt.dpr, mobile: false })
    await send('Page.navigate', { url: pageUrl })

    // 等装饰层出现（主题客户端按 revision 轮询，启用后 1-3s 注入）
    let mounted = false
    for (let i = 0; i < 40 && !mounted; i++) {
      await sleep(500)
      mounted = (await evalJs(`!!document.querySelector('.palis-globe, .palis-sonar')`)) === true
    }
    if (!mounted) {
      record('render.invariants', 'fail', '等不到装饰层挂载（主题是否启用？）')
      await teardown(cs)
      return report()
    }
    // 等开机自检覆盖层退场（主题 boot 默认开，约 3-4s 序列）再进入稳态
    await sleep(opt.shot ? 5000 : 1200)

    /* 输入区主题（双写验收）：0.1.1 是 [data-composer-seat] textarea，
       0.1.5 起是 [data-composer-input]（contenteditable[role=textbox]）。
       两代任一存在，都必须带上 PALIS 的写作区样式（底色 #0a0a0a）——
       这条同时验证"主题对两代内核都生效"，是双写选择器的回归闸。 */
    const composer = await evalJs(`(() => {
      const cands = ['[data-composer-input]', '[data-composer-seat] textarea']
      for (const sel of cands) {
        const el = document.querySelector(sel)
        if (!el) continue
        const cs = getComputedStyle(el)
        const fg = getComputedStyle(document.documentElement).getPropertyValue('--palis-fg').trim()
        return { sel, bg: cs.backgroundColor, fill: cs.webkitTextFillColor, fgVar: fg || '(未取到)', font: cs.fontFamily.split(',')[0] }
      }
      return { missing: true }
    })()`)
    if (composer && !composer.missing) {
      const ok = composer.bg === 'rgb(10, 10, 10)'
      record('render.composer-theme', ok ? 'pass' : 'fail',
        ok
          ? `${composer.sel} 已带 PALIS 写作区底色（bg=${composer.bg}，字体 ${composer.font}）`
          : `${composer.sel} 未套上主题底色（bg=${composer.bg}，期望 rgb(10,10,10)）——双写选择器可能没命中`)
    } else {
      record('render.composer-theme', 'warn', '未找到写作区元素（两代选择器都没命中）')
    }

    /* 目检留证：整屏截图（--shot），供人工看主题观感（探针只判不变量，判不了"好不好看"） */
    if (opt.shot) {
      try {
        const r = await send('Page.captureScreenshot', { format: 'png' })
        if (r.result?.data) {
          fs.mkdirSync(path.dirname(path.resolve(opt.shot)), { recursive: true })
          fs.writeFileSync(opt.shot, Buffer.from(r.result.data, 'base64'))
          record('render.shot', 'pass', `截图已存 ${opt.shot}`)
        } else {
          record('render.shot', 'warn', '截图失败（captureScreenshot 无数据）')
        }
      } catch (err) {
        record('render.shot', 'warn', `截图异常：${err.message}`)
      }
    }

    /* 不变量① ②：包含块 */
    const anc = await evalJs(EVAL_ANCESTORS)
    const violations = []
    for (const [sel, info] of Object.entries(anc || {})) {
      if (!info || info.missing) continue
      for (const b of info.bad || []) violations.push(`${sel} ← ${b.node} {${b.prop}: ${String(b.value).slice(0, 40)}}`)
    }
    record('render.containing-block', violations.length === 0 ? 'pass' : 'fail',
      violations.length === 0
        ? `装饰层祖先链干净（${Object.values(anc || {}).filter((v) => v && !v.missing).length} 个元素受检）`
        : `祖先建立包含块：${violations.slice(0, 3).join('；')}${violations.length > 3 ? ` …共 ${violations.length} 处` : ''}`)

    /* 不变量①：fixed 层与视口对位
       判据：横向通栏（left≈0 且 width≈视口宽）+ 垂直贴顶或贴底。
       为什么这样判：fixed 层被祖先"捕获"时，它会改按那个祖先的盒子解析，
       典型表现就是不再通栏、或不再贴边——而不是非要满屏才算对。 */
    const vp = await evalJs(EVAL_VIEWPORT)
    const mis = []
    for (const [sel, info] of Object.entries(vp || {})) {
      if (!info || info.missing || info.skip) continue
      const flushLeft = Math.abs(info.left) <= 2 && Math.abs(info.w - info.iw) <= 2
      const flushEdge = Math.abs(info.top) <= 2 || Math.abs(info.top + info.h - info.ih) <= 2
      if (!flushLeft || !flushEdge) {
        mis.push(`${sel} 实际 ${info.w}×${info.h}@(${info.left},${info.top})，视口 ${info.iw}×${info.ih}`)
      }
    }
    record('render.viewport-anchor', mis.length === 0 ? 'pass' : 'fail',
      mis.length === 0 ? '所有 fixed 装饰层与视口严丝合缝' : mis.slice(0, 2).join('；'))

    /* 不变量③ ④：逐帧几何（40 帧） */
    const frames = await evalJs(EVAL_FRAMES)
    const dprOk = Math.abs((frames?.dpr || 0) - opt.dpr) < 0.01
    const bad = []
    const unstable = []
    for (const [sel, vals] of Object.entries((frames?.series || []).length ? transpose(frames.series) : {})) {
      const present = vals.filter(Boolean)
      if (!present.length) continue
      const worst = Math.max(...present.map((v) => Math.abs(v.w - v.h)))
      const wRange = Math.max(...present.map((v) => v.w)) - Math.min(...present.map((v) => v.w))
      if (worst > 1.5) bad.push(`${sel} 宽高差最大 ${worst.toFixed(2)}px`)
      if (wRange > present[0].w * 0.5) unstable.push(`${sel} 宽度抖动 ${wRange.toFixed(1)}px`)
    }
    record('render.circle-aspect', bad.length === 0 ? 'pass' : 'fail',
      bad.length === 0
        ? `40 帧内圆形元素宽高恒等（DPR ${frames?.dpr}）`
        : `宽高不等（=拉伸）：${bad.join('；')}`)
    record('render.dpr', dprOk ? 'pass' : 'warn',
      dprOk ? `DPR 仿真生效：devicePixelRatio=${frames?.dpr}` : `DPR 未按 ${opt.dpr} 生效（实测 ${frames?.dpr}）`)

    /* 不变量③：合成层 */
    const transformLayers = layers.filter((l) => l.transform && !/^\[?1, ?0, ?0, ?1, ?0, ?0\]?$/.test(String(l.transform)))
    record('render.compositing', layers.length === 0 ? 'warn' : (transformLayers.length === 0 ? 'pass' : 'warn'),
      layers.length === 0
        ? 'LayerTree 未上报层（无头模式下合成信息可能不可用）'
        : `合成层 ${layers.length} 个，其中带非恒等 transform ${transformLayers.length} 个`)

    await teardown(cs)
  } catch (err) {
    record('render.invariants', 'fail', `探针异常：${err && err.message ? err.message : String(err)}`)
    await teardown(cs)
  }
  return report()
}

/** 帧序列 → 按选择器转置。 */
function transpose(series) {
  const out = {}
  for (const frame of series) {
    for (const [sel, val] of Object.entries(frame || {})) {
      if (!out[sel]) out[sel] = []
      out[sel].push(val)
    }
  }
  return out
}

function report() {
  const sevCritical = new Set(['render.containing-block', 'render.viewport-anchor', 'render.circle-aspect', 'render.invariants', 'render.env'])
  const width = Math.max(...results.map((r) => r.id.length))
  console.log(`\n渲染不变量验收（DPR 仿真 ${opt.dpr}，40 帧采样）\n`)
  for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id.padEnd(width)}  ${r.detail}`)
  const crit = results.filter((r) => r.status === 'fail' && sevCritical.has(r.id))
  if (opt.json) {
    fs.mkdirSync(path.dirname(path.resolve(opt.json)), { recursive: true })
    fs.writeFileSync(opt.json, JSON.stringify({ at: new Date().toISOString(), dpr: opt.dpr, results, criticalFails: crit.map((r) => r.id) }, null, 2))
    console.log(`\n  报告已写入 ${opt.json}`)
  }
  console.log(crit.length === 0 ? '\nRENDER_INVARIANTS_OK' : `\nRENDER_INVARIANTS_FAIL ${crit.map((r) => r.id).join(' ')}`)
  process.exit(crit.length === 0 ? 0 : 1)
}

main().catch(async (err) => {
  record('render.invariants', 'fail', err && err.stack ? err.stack.split('\n')[0] : String(err))
  report()
})
