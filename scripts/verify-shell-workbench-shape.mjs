/**
 * 工作台窗口形态（长条）的实机验收 —— 验的是**外壳新增能力**，不是插件门面。
 *
 * 2026-10-12 项目所有者获准为工具台改外壳（plan §12-8 / §6.4.1）。这一刀交付的是
 * "形态档位"能力：`shell:set-workbench-shape`（normal / strip / mini）+ 动态最小尺寸 +
 * 置顶开关 + 形态期几何**不落进 windowBounds**。本脚本对着**真实跑起来的外壳**验这五条：
 *
 *   A 桥在位（页面主世界能拿到 dshShell.getWorkbenchShape / setWorkbenchShape）
 *   B 只收枚举：未知档位被拒（`unknown-shape`），窗口形状不变
 *   C strip 生效：主进程返回 shape=strip / alwaysOnTop=true，渲染侧布局视口真的窄下来
 *   D 形态期不污染 windowBounds：settings.json 里的 windowBounds 没被写成条状尺寸
 *   E 还原 normal：alwaysOnTop=false、宽度回弹，settings 里形态回到 normal
 *
 * 诚实边界（本脚本**不**声称验了的事）：
 *  - 置顶只能信主进程返回的 `alwaysOnTop`（页面读不到 OS 层 z-order）；
 *  - 「非内核页面被拒」这条走的是源码断言 + `lib/shell-hardening.test.js`（S9），
 *    真实例里没法凭空造出一个外来帧；
 *  - 无边框 / 自绘顶栏**这一刀没做**（Electron 43 的 frame 只能构造时设），故不验。
 *
 * 用法（dsh-desktop/ 下）：
 *   node scripts/verify-shell-workbench-shape.mjs
 * 隔离：独立 mkdtemp userData，**只按本轮 spawn 的 PID 收进程**（lib/pid-cleanup.js），
 * 绝不按镜像名杀——那会连用户正在用的正式桌面一起干掉（AGENTS.md §1）。
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
const { killTree } = require(path.join(ROOT, 'lib', 'pid-cleanup.js'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push(name)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined && detail !== '' ? `  [${detail}]` : ''}`)
}
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => resolve(p))
    })
  })

const cdpPort = await freePort()
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-shape-verify-'))
const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1', DSH_DESKTOP_USER_DATA: userData }
delete env.ELECTRON_RUN_AS_NODE // 带着它 electron 会以 node 模式启动（踩坑速查 #1）

const child = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'electron', 'cli.js'), '.', `--remote-debugging-port=${cdpPort}`], {
  cwd: ROOT,
  env,
  stdio: ['ignore', 'ignore', 'pipe'],
})
let childExit = null
child.on('exit', (code, signal) => {
  childExit = { code, signal }
})
const stderrTail = []
child.stderr.on('data', (b) => {
  stderrTail.push(String(b))
  if (stderrTail.length > 30) stderrTail.shift()
})

const mk = async (url) => {
  const ws = new WebSocket(url)
  await new Promise((r, j) => {
    ws.onopen = r
    ws.onerror = () => j(new Error('ws 失败'))
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
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

try {
  // 等真实内核页面（同一个窗口先 loadFile 启动画面，再跳内核页）
  let page = null
  for (let i = 0; i < 240 && !page; i++) {
    await sleep(500)
    if (childExit) break
    try {
      const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && !/^file:/.test(t.url || '') && !/splash/i.test(t.url || ''))
    } catch {}
  }
  if (!page) {
    let targets = '取不到'
    try {
      const l = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
      targets = JSON.stringify(l.map((t) => ({ type: t.type, url: String(t.url || '').slice(0, 90) })))
    } catch (err) {
      targets = `CDP 连不上：${err.message}`
    }
    throw new Error(
      `等不到内核页面；实例退出=${JSON.stringify(childExit)}；CDP 目标=${targets}；stderr=${stderrTail.join('').slice(-500)}`,
    )
  }
  const view = await mk(page.webSocketDebuggerUrl)
  await view.send('Runtime.enable')
  const ev = async (expression) => {
    const r = await view.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(`页面求值异常：${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`)
    return r.result?.result?.value
  }

  check('A 桥在位', await ev(`typeof (window.dshShell||{}).setWorkbenchShape === 'function' && typeof window.dshShell.getWorkbenchShape === 'function'`), page.url)

  const initial = await ev(`window.dshShell.getWorkbenchShape()`)
  check('A 初态是 normal 且读得到', initial?.ok === true && initial?.shape === 'normal', JSON.stringify({ ok: initial?.ok, shape: initial?.shape, minSize: initial?.minSize }))

  // 尺寸判据用**渲染侧布局视口**（clientWidth）：`window.outerWidth` 在程序化改窗后可能是滞后读数
  // （2026-10-12 实测：主进程 getBounds 已回 1363，页面 outerWidth 仍报 421）。
  // clientWidth 与主进程的 getBounds 是两个独立来源，两边一起看才算数。
  const sizeNow = async () => {
    const raw = await ev(
      `JSON.stringify({ ow: window.outerWidth, cw: document.documentElement.clientWidth, iw: window.innerWidth, vv: (window.visualViewport||{}).width, hidden: document.hidden, vis: document.visibilityState })`,
    )
    return JSON.parse(raw)
  }
  const wideBefore = (await sizeNow()).cw
  const bogus = await ev(`window.dshShell.setWorkbenchShape('bogus')`)
  await sleep(600)
  const wideAfter = (await sizeNow()).cw
  check('B 未知档位被拒', bogus?.ok === false && bogus?.error === 'unknown-shape' && Array.isArray(bogus?.allowed), JSON.stringify(bogus))
  check('B 被拒时窗口没动', Math.abs(wideAfter - wideBefore) < 8, `clientWidth ${wideBefore} → ${wideAfter}`)

  const strip = await ev(`window.dshShell.setWorkbenchShape('strip')`)
  await sleep(900)
  const stripOuter = (await sizeNow()).cw
  check('C strip 生效（主进程侧）', strip?.ok === true && strip?.shape === 'strip' && strip?.alwaysOnTop === true, JSON.stringify({ shape: strip?.shape, onTop: strip?.alwaysOnTop, bounds: strip?.bounds, minSize: strip?.minSize }))
  check('C strip 生效（渲染侧真的窄了）', stripOuter < wideBefore - 300, `clientWidth ${wideBefore} → ${stripOuter}`)
  check('C 动态最小尺寸放开到 320', Array.isArray(strip?.minSize) && strip.minSize[0] === 320, JSON.stringify(strip?.minSize))

  // D：形态期的几何**绝不能**写进 windowBounds（否则下次启动停在长条态）
  await sleep(1200) // 让 resize/move 的 500ms 防抖落盘真的跑过
  const settingsFile = path.join(userData, 'settings.json')
  const saved = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {}
  const wb = saved.windowBounds
  check('D windowBounds 没被写成条状', wb == null || (wb.width > 600 && wb.height > 400), JSON.stringify(wb))
  check('D 形态已持久化为 strip', saved.workbenchShape === 'strip', String(saved.workbenchShape))

  const back = await ev(`window.dshShell.setWorkbenchShape('normal')`)
  await sleep(900)
  const normalOuter = (await sizeNow()).cw
  const readback = await ev(`window.dshShell.getWorkbenchShape()`)
  check('E 还原 normal', back?.ok === true && back?.shape === 'normal' && back?.alwaysOnTop === false, JSON.stringify({ shape: back?.shape, onTop: back?.alwaysOnTop, bounds: back?.bounds }))
  check('E 宽度回弹（渲染侧与主进程侧两个独立来源一起判）',
    normalOuter > stripOuter + 300 && (readback?.bounds?.width || 0) > stripOuter + 300,
    `clientWidth ${stripOuter} → ${normalOuter}；getBounds=${JSON.stringify(readback?.bounds)} minSize=${JSON.stringify(readback?.minSize)}`)
  const saved2 = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
  check('E 持久化回到 normal', saved2.workbenchShape === 'normal', String(saved2.workbenchShape))

  // F：mini（最小化的"小长条"）也是真档位，不是枚举里的占位。
  // 渲染层重排**不在同一个 tick**（踩坑 #7）：固定 sleep 会抓到旧布局，所以要**轮询等落定**，
  // 并把耗时量出来——这个耗时就是门面做变形动画时真正可用的缓冲时间。
  const mini = await ev(`window.dshShell.setWorkbenchShape('mini')`)
  let miniSize = await sizeNow()
  const t0 = Date.now()
  while (miniSize.cw > 520 && Date.now() - t0 < 5000) {
    await sleep(200)
    miniSize = await sizeNow()
  }
  const miniReadback = await ev(`window.dshShell.getWorkbenchShape()`)
  const mc = miniReadback?.contentBounds || {}
  check('F mini 生效（主进程内容区是权威判据）',
    mini?.ok === true && mini?.shape === 'mini' && (mc.height || 9999) < 260 && (mc.width || 0) < 520,
    `getBounds=${JSON.stringify(mini?.bounds)} contentBounds=${JSON.stringify(mc)}`)
  // 渲染侧只在**文档可见**时判：窗口被别的窗口遮挡时 Chromium 会推迟布局（实测
  // document.hidden=true 时 clientWidth 停在旧值 5 秒不动），那是环境状态不是产品缺陷。
  if (miniSize.hidden === false) {
    check('F mini 渲染侧重排跟上（文档可见）', miniSize.cw < 520, `clientWidth → ${miniSize.cw}，耗时 ${Date.now() - t0}ms`)
  } else {
    console.log(`SKIP F mini 渲染侧判据（文档被遮挡 hidden=true，Chromium 推迟布局；改以内容区尺寸为准）`)
  }
  await ev(`window.dshShell.setWorkbenchShape('normal')`)
  await sleep(700)
  const saved3 = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
  check('F mini 也没污染 windowBounds', (saved3.windowBounds?.width || 0) > 600 && (saved3.windowBounds?.height || 0) > 400, JSON.stringify(saved3.windowBounds))

  // G：浮标辅助窗（扇形呼出 B 方案的最小切片）。验三件事：开得了、**开着的时候主窗焦点不受影响**、
  // 关得掉且不残留。至于"点它会不会抢键盘焦点"，那是独立实验（focusable:false + sendInputEvent）
  // 已经实测过的属性，见 logs/2026-10-12.md 的 B 方案评估表。
  await ev(`window.dshShell.setWorkbenchShape('strip')`)
  await sleep(700)
  const opened = await ev(`window.dshShell.openWorkbenchOverlay()`)
  await sleep(700)
  check('G 浮标能开（主进程侧可见）', opened?.ok === true && opened?.visible === true, JSON.stringify(opened?.bounds))
  const withOverlay = await ev(`window.dshShell.getWorkbenchShape()`)
  check('G 状态回读说浮标在位', withOverlay?.overlay === true, JSON.stringify({ overlay: withOverlay?.overlay }))
  check('G 浮标开着时主窗焦点没被抢（focusable:false）', withOverlay?.mainFocused === true, JSON.stringify({ mainFocused: withOverlay?.mainFocused }))
  const closedOv = await ev(`window.dshShell.closeWorkbenchOverlay()`)
  await sleep(400)
  const afterClose = await ev(`window.dshShell.getWorkbenchShape()`)
  check('G 浮标关得掉、不残留', closedOv?.ok === true && afterClose?.overlay === false, JSON.stringify({ closed: closedOv?.ok, overlay: afterClose?.overlay }))
  await ev(`window.dshShell.setWorkbenchShape('normal')`)
  await sleep(500)

  view.ws.close()
} catch (err) {
  check('脚本自身跑通', false, String(err?.message || err))
} finally {
  killTree(child.pid)
}

if (failures.length) {
  console.log(`SHELL_SHAPE_FAIL ${failures.length} 项未过：${failures.join(', ')}`)
  process.exitCode = 1
} else {
  console.log('SHELL_SHAPE_OK 形态能力实机验收通过（A 桥 / B 枚举纪律 / C strip / D 不污染 windowBounds / E 还原）')
}
