/**
 * 长条窗几何量测（2026-10-12，为 plan §12-8 的"窗口形态"这一刀取设计数据）。
 *
 * 要回答的是两件**此前只能标"未实测"**的事：
 *  ① 真外壳 + 真内核页面被压到很窄时，什么时候开始破版（横向溢出 / 元素被挤没 / 外壳注入的
 *     审阅侧栏与皮肤元素表现如何）——这决定长条的宽度下限能不能低于内核 minWidth 980。
 *  ② 内核对**窗口尺寸变化**有没有响应（重排是否真的发生、有没有元素不跟尺寸）。
 *
 * 做法：按 `verify:ui-smoke` 的隔离姿势真起一个外壳实例（独立 DSH_DESKTOP_USER_DATA，
 * 不碰用户正在用的正式版），用 `--remote-debugging-port` 连 CDP，
 * `Browser.setWindowBounds` 逐级改**真实 OS 窗口**宽度（低于 Electron 的 minWidth 时会被钳制，
 * 钳制值本身就是一个答案），再用 `Emulation.setDeviceMetricsOverride` 补足更窄的视口。
 * 收尾**只按本轮 spawn 出来的 PID** 收进程（lib/pid-cleanup.js），绝不按镜像名杀。
 *
 * 用法（在 dsh-desktop/ 下）：
 *   node scripts/measure-strip-layout.mjs                # 默认阶梯 1360→360
 *   node scripts/measure-strip-layout.mjs --widths 1360,980,760,420 --height 860
 *   产物：%TEMP%\dsh-strip-measure\report.json 与 shots\w<宽>.png
 *
 * 注意：这是**量测工具**，不进任何门禁链（不改代码、不改行为，只读一个跑起来的实例）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { killTree, pidAlive } = require(path.join(ROOT, 'lib', 'pid-cleanup.js'))

const argv = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt
}
const widths = String(flag('--widths', '1360,1100,980,820,640,480,420,360'))
  .split(',')
  .map((n) => parseInt(n.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0)
const height = parseInt(flag('--height', '900'), 10)
const shotAt = new Set(String(flag('--shots', '1360,980,640,420')).split(',').map((n) => parseInt(n, 10)))
const outDir = path.join(os.tmpdir(), 'dsh-strip-measure')
const shotsDir = path.join(outDir, 'shots')
fs.mkdirSync(shotsDir, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port
      srv.close(() => resolve(p))
    })
  })

// —— 页面里跑的取样函数：不依赖猜的选择器，只按"溢出与尺寸"这类客观几何说话 ——
const SAMPLE_JS = `(() => {
  const de = document.documentElement;
  const cw = de.clientWidth, ch = de.clientHeight;
  const rectOf = (el) => el.getBoundingClientRect();
  const label = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase()) +
    (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/)[0] : '');
  let over = [], biggest = null, count = 0;
  for (const el of document.querySelectorAll('body *')) {
    const r = rectOf(el);
    if (r.width < 2 || r.height < 2) continue;
    count++;
    if (r.right > cw + 2 || r.left < -2) over.push({ el: label(el), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) });
    if (!biggest || r.width > biggest.w) biggest = { el: label(el), w: Math.round(r.width) };
  }
  const review = [...document.querySelectorAll('[id^="dsh-review"]')].map((el) => ({ id: el.id, w: Math.round(rectOf(el).width), visible: rectOf(el).width > 0 && getComputedStyle(el).display !== 'none' }));
  const editable = [...document.querySelectorAll('[contenteditable="true"]')].map((el) => ({ cls: label(el), w: Math.round(rectOf(el).width) }));
  const scrollers = [...document.querySelectorAll('body *')].filter((el) => {
    const s = getComputedStyle(el);
    return (s.overflowX === 'auto' || s.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0;
  }).map((el) => ({ el: label(el), scrollW: el.scrollWidth, clientW: el.clientWidth }));
  return {
    viewport: { cw, ch, dpr: window.devicePixelRatio, url: location.href.slice(0, 60) },
    docScrollWidth: de.scrollWidth,
    horizontalOverflow: de.scrollWidth - cw,
    elementsMeasured: count,
    overflowingCount: over.length,
    overflowSample: over.slice(0, 6),
    widestElement: biggest,
    reviewInjected: review,
    editables: editable.slice(0, 4),
    innerScrollers: scrollers.slice(0, 5),
    title: document.title,
  };
})()`

async function main() {
  const cdpPort = await freePort()
  // 每次跑用**独立** userData：外壳的单实例锁按 userData 分桶，蹭 %TEMP%\dsh-preview 那种共享目录
  // 会和"已经有一个实例在跑"的情况撞车（第二个进程直接把活儿交给第一个然后自己退，量测就扑空）。
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-strip-userdata-'))
  const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1', DSH_DESKTOP_USER_DATA: userData }
  delete env.ELECTRON_RUN_AS_NODE // 带着它 electron 会退化成 node，app 为 undefined（踩坑速查 #1）
  const cli = path.join(ROOT, 'node_modules', 'electron', 'cli.js')

  console.log(`启动隔离实例（userData=${userData}，CDP=${cdpPort}）…`)
  const child = spawn(process.execPath, [cli, '.', `--remote-debugging-port=${cdpPort}`], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const stderrTail = []
  let childExit = null
  child.on('exit', (code, signal) => {
    childExit = { code, signal }
  })
  child.stderr.on('data', (b) => {
    stderrTail.push(String(b))
    if (stderrTail.length > 40) stderrTail.shift()
  })
  try {
    // 1) 等 CDP 出来，并等到**内核页面**（启动画面也在同一个窗口里，先 file:// 再跳内核页）
    let page = null
    for (let i = 0; i < 240 && !page; i++) {
      await sleep(500)
      if (childExit) break // 实例已经退了（多半是抢不到内核端口/单实例锁），别再空等两分钟
      try {
        const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
        page = list.find((t) => t.type === 'page' && !/^file:/.test(t.url || '') && !/splash/i.test(t.url || ''))
      } catch {}
    }
    if (!page) {
      throw new Error(
        `等不到内核页面。实例退出=${JSON.stringify(childExit)}；stderr 尾部：\n${stderrTail.join('').slice(-1200)}`,
      )
    }
    console.log('页面 target:', page.url.slice(0, 70))

    const mk = async (url) => {
      const ws = new WebSocket(url)
      await new Promise((r, j) => {
        ws.onopen = r
        ws.onerror = () => j(new Error('ws 失败 ' + url))
      })
      let id = 0
      const pending = new Map()
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.id && pending.has(msg.id)) {
          pending.get(msg.id)(msg)
          pending.delete(msg.id)
        }
      }
      const send = (method, params = {}) =>
        new Promise((resolve) => {
          const mid = ++id
          pending.set(mid, resolve)
          ws.send(JSON.stringify({ id: mid, method, params }))
        })
      return { ws, send }
    }
    const version = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()
    const browser = await mk(version.webSocketDebuggerUrl)
    const view = await mk(page.webSocketDebuggerUrl)
    await view.send('Runtime.enable')
    await view.send('Page.enable')
    const evalJs = async (expr) => {
      const r = await view.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
      return r.result?.result?.value
    }

    // OS 窗口句柄：拿到了就用**真实窗口尺寸**量（能同时暴露 Electron minWidth 的钳制）；
    // 拿不到就退回视口仿真（布局层照样能答"这个宽度会不会破版"，但不等于真窗口 resize）。
    const wgt = await browser.send('Browser.getWindowForTarget', { targetId: page.id })
    const windowId = wgt.result?.windowId ?? null
    if (!windowId) console.log('（CDP 拿不到 OS 窗口 id，全程改用视口仿真；Browser.getWindowForTarget 返回 =', JSON.stringify(wgt.error || wgt.result), '）')
    let realWidth = null
    const rows = []
    const ladder = [...widths].sort((a, b) => b - a)
    for (const want of ladder) {
      // 2) 真实 OS 窗口尺寸（低于 Electron 的 minWidth/minHeight 会被钳制——钳制值本身就是答案）
      let got = null
      if (windowId) {
        await browser.send('Browser.setWindowBounds', { windowId, bounds: { width: want, height, windowState: 'normal' } })
        await sleep(900)
        got = (await browser.send('Browser.getWindowBounds', { windowId })).result?.bounds
        realWidth = got?.width ?? realWidth
      }
      const clampedByShell = !!got && got.width > want + 1
      const needEmulation = !windowId || clampedByShell
      if (needEmulation) {
        await view.send('Emulation.setDeviceMetricsOverride', { width: want, height, deviceScaleFactor: 1, mobile: false })
        await sleep(700)
      }
      const sample = await evalJs(SAMPLE_JS)
      const row = {
        askedWidth: want,
        windowBounds: got ? { width: got.width, height: got.height, left: got.left, top: got.top } : null,
        clampedByMinimumSize: clampedByShell,
        measuredVia: needEmulation ? '视口仿真 Emulation.setDeviceMetricsOverride' : '真实 OS 窗口 Browser.setWindowBounds',
        sample,
      }
      if (shotAt.has(want)) {
        const shot = await view.send('Page.captureScreenshot', { format: 'png' })
        const file = path.join(shotsDir, `w${want}.png`)
        fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
        row.screenshot = file
      }
      // 截图要在**窄视口还挂着**的时候拍，拍完才清掉仿真（先清后拍 = 截回来的是宽布局）
      if (needEmulation) await view.send('Emulation.clearDeviceMetricsOverride')
      const s = sample
      console.log(
        `宽 ${String(want).padStart(4)} → 实际窗 ${row.windowBounds?.width ?? '?'}×${row.windowBounds?.height ?? '?'}` +
          `${row.clampedByMinimumSize ? '（被 minWidth 钳制，改用视口仿真）' : ''}｜` +
          `横向溢出 ${s?.horizontalOverflow}｜溢出元素 ${s?.overflowingCount}/${s?.elementsMeasured}｜` +
          `最宽元素 ${s?.widestElement?.el}=${s?.widestElement?.w}｜注入侧栏 ${JSON.stringify(s?.reviewInjected)}` +
          `｜量法=${row.measuredVia.includes('真实') ? '真窗口' : '视口仿真'}` +
          `${row.screenshot ? '｜' + row.screenshot : ''}`,
      )
      rows.push(row)
    }

    const report = {
      at: new Date().toISOString(),
      pageUrl: page.url,
      windowHeight: height,
      electronMinSizeHint: '见 plan §6.4.1（main.js:2195-2196 minWidth 980 / minHeight 640）',
      rows,
    }
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
    console.log('REPORT →', path.join(outDir, 'report.json'))

    // 还原一个体面的尺寸再收摊
    await browser.send('Browser.setWindowBounds', { windowId, bounds: { width: 1360, height: 900 } })
    browser.ws.close()
    view.ws.close()
  } finally {
    console.log('收掉本轮 spawn 的实例 PID', child.pid)
    killTree(child.pid)
  }
}

main().catch((err) => {
  console.error('MEASURE_FAIL', err?.stack || String(err))
  process.exitCode = 1
})
