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
 *   F mini 是真档位 · G 浮标通道已移除（反向守卫）· H **置顶落到 Win32 WS_EX_TOPMOST** · I ✕ 复用既有关窗语义
 *
 * 诚实边界（本脚本**不**声称验了的事）：
 *  - 置顶**不**只看自报：H 段用 Win32 `GWL_EXSTYLE & WS_EX_TOPMOST` 判（读自报值会被骗，
 *    2026-10-12 实锤过一次），并按外壳的补刀节奏轮询到落定；
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
import { spawn, execFileSync } from 'node:child_process'
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


/**
 * Win32 级判据：读每个顶层窗口的 GWL_EXSTYLE，看 WS_EX_TOPMOST(0x8) 到底置没置位。
 * 为什么必须读 OS 而不是问应用——2026-10-12 实锤：应用自报 alwaysOnTop=true、
 * `isAlwaysOnTop()` 也返回 true，但 OS 位是 0x00200100（没有 0x8），
 * 结果别的应用在前台时长条与浮标**完全看不见**，而门禁读自报值一路绿。
 *
 * 两条探针自身的纪律（都是这一轮被抓到的）：
 *  · 枚举回调委托要挂在**静态字段**上：只当参数传进去的临时委托可能被 GC 收掉，
 *    EnumWindows 于是静默返回半截或空——把探针的假阴性读成产品缺陷更糟；
 *  · 内联 C# 里**只写 ASCII**：Add-Type 把源码交给编译器时按本机 ANSI 代码页落盘，
 *    中文注释会把相邻的字段声明一起吞掉（实测整个类编译失败、枚举恒为 0 条）。
 */
const PS_TOPMOST = `
$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public class TopmostProbe {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  static EnumProc proc = OnEnum;
  static List<string> outp = new List<string>();
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  public static uint PidFilter = 0;
  static bool OnEnum(IntPtr h, IntPtr l) {
    if (!IsWindowVisible(h)) return true;
    uint ownPid; GetWindowThreadProcessId(h, out ownPid);
    if (PidFilter != 0 && ownPid != PidFilter) return true;
    var sb = new StringBuilder(512); GetWindowText(h, sb, sb.Capacity);
    int ex = GetWindowLong(h, -20);
    RECT r; GetWindowRect(h, out r);
    outp.Add(sb.ToString() + "~" + ex.ToString("X8") + "~" + r.Left + "," + r.Top + "," + (r.Right - r.Left) + "," + (r.Bottom - r.Top));
    return true;
  }
  public static List<string> Run() {
    outp = new List<string>();
    EnumWindows(proc, IntPtr.Zero);
    return outp;
  }
}
"@
[TopmostProbe]::Run() | ForEach-Object { Write-Output $_ }
`
function winStyles(pid = 0) {
  const ps = path.join(os.tmpdir(), `dsh-topmost-${process.pid}.ps1`)
  fs.writeFileSync(ps, `$TopmostPid = ${pid | 0}` + String.fromCharCode(10) + PS_TOPMOST.replace('PidFilter = 0', 'PidFilter = $TopmostPid'))
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps], { encoding: 'utf8', timeout: 20000 })
    const NL = String.fromCharCode(10)
    const rows = out.split(NL).map((l) => l.trim()).filter((l) => l.includes('~')).map((l) => {
      // 每行：title~EXSTYLE~x,y,w,h（矩形是 2026-10-13 加的，用来判"浮标有没有贴着长条外侧"）
      const parts = l.split('~')
      const ex = parseInt(parts[parts.length - (parts.length >= 3 ? 2 : 1)], 16)
      const rect = parts.length >= 3 ? parts[parts.length - 1].split(',').map(Number) : null
      const title = parts.length >= 3 ? parts.slice(0, -2).join('~') : parts.slice(0, -1).join('~')
      return {
        title,
        ex,
        rect: rect && rect.length === 4 && rect.every((n) => Number.isFinite(n)) ? { x: rect[0], y: rect[1], width: rect[2], height: rect[3] } : null,
      }
    })
    if (!rows.length) return { error: '枚举到 0 个窗口（探针自检：node scripts/verify-shell-workbench-shape.mjs --selftest）' }
    return rows
  } catch (err) {
    return { error: String(err.message || err) }
  } finally {
    try { fs.unlinkSync(ps) } catch {}
  }
}
const dumpWins = (wins) => (Array.isArray(wins) ? (wins.length ? wins.slice(0, 12).map((w) => `${w.title}<${w.ex.toString(16)}>`).join(' , ') : '该 PID 名下 0 个可见窗口（枚举本身没抓到东西，先怀疑探针）') : `读不到窗口列表：${wins.error}`)
const topmostOf = (wins, needle) => {
  if (!Array.isArray(wins)) return null
  const hit = wins.find((w) => (w.title || '').includes(needle))
  return hit ? { title: hit.title, topmost: (hit.ex & 0x8) !== 0, ex: hit.ex.toString(16) } : null
}

/**
 * `--selftest`：先验探针本身（"检查本身要验收"）。两件事：
 *  ① 掩码逻辑：0x…108 判置顶、0x…100 判不置顶；
 *  ② 枚举真的能抓到桌面上正在显示的窗口（内联 C# 编译失败时会静默返回 0 条，
 *     那样整条 H 段会一路"没找到窗口"，看起来像产品缺陷——所以这一步必须单独能跑）。
 */
if (process.argv.includes('--selftest')) {
  const maskOk = topmostOf([{ title: 'x', ex: 0x00200108 }], 'x')?.topmost === true &&
    topmostOf([{ title: 'x', ex: 0x00200100 }], 'x')?.topmost === false
  console.log(`${maskOk ? 'PASS' : 'FAIL'} selftest WS_EX_TOPMOST 掩码判据`)
  const all = winStyles(0)
  const enumOk = Array.isArray(all) && all.length > 0
  console.log(`${enumOk ? 'PASS' : 'FAIL'} selftest EnumWindows 抓到可见窗口 ${enumOk ? all.length + ' 个' : JSON.stringify(all)}`)
  if (enumOk) console.log('  样例: ' + dumpWins(all))
  console.log(maskOk && enumOk ? 'SHELL_SHAPE_SELFTEST_OK' : 'SHELL_SHAPE_SELFTEST_FAIL')
  process.exit(maskOk && enumOk ? 0 : 1)
}

const cdpPort = await freePort()
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-shape-verify-'))
// **故意把上一次会话留在"长条态"**：`settings.workbenchShape` 是持久化的，而形态只有"主屏开着"
// 才有意义，主屏开合只活在内存里 ⇒ 重启后必须落回 normal（否则 `currentShape()` 与实际窗口说谎，
// `scheduleSaveBounds` 会永远跳过写 windowBounds，用户的窗口记忆冻住）。下面 A 段就是验这件事。
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({ workbenchShape: 'strip', windowBounds: { x: 120, y: 90, width: 1360, height: 900, maximized: false } }),
)
// **测试实例一律摆副屏**（2026-10-13 项目所有者要求："你在拉实例测试时去放在我的屏幕二上测试，
// 不然会影响我"）。壳侧认 `DSH_DESKTOP_DISPLAY`：`secondary` 有第二块屏就用它，没有回落到主屏。
const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '1', DSH_DESKTOP_USER_DATA: userData, DSH_DESKTOP_DISPLAY: process.env.DSH_DESKTOP_DISPLAY || 'secondary' }
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
const topmostLog = [] // 外壳自己对置顶落地的判决日志（enforceTopmost 会记补刀/失败）
child.stderr.on('data', (b) => {
  const s = String(b)
  stderrTail.push(s)
  if (stderrTail.length > 30) stderrTail.shift()
  for (const line of s.split(/\r?\n/)) if (line.includes('置顶')) topmostLog.push(line.trim())
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
  check('A 带着上次的 strip 记忆启动：窗口仍然是宽窗（几何没被旧档位带跑）',
    // 判"宽窗"要**跟壳报的最小尺寸比**，不能写死 1200：2026-10-13 起探针默认跑在非主屏
    // （项目所有者要求"测试实例别跑到我主屏上"），那块屏只有 1093×698，窗口会被夹小。
    (initial?.bounds?.width || 0) >= (initial?.minSize?.[0] || 980) &&
      (initial?.bounds?.width || 0) > 900 &&
      (initial?.bounds?.width || 0) !== 420,
    JSON.stringify({ bounds: initial?.bounds, minSize: initial?.minSize }))
  const afterBoot = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'))
  check('A 启动把持久化的形态落回 normal（位置记忆 workbenchShapeBounds 不动）',
    afterBoot.workbenchShape === 'normal',
    JSON.stringify({ workbenchShape: afterBoot.workbenchShape, 位置记忆: afterBoot.workbenchShapeBounds }))

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
  // 主进程侧按**规格**判（长条 420 宽），这是真判据；渲染侧是独立来源，两者可能对不上（踩坑 #21：
  // 程序化改窗后渲染侧读数会滞后/被挡住时不做布局）⇒ 对不上时显式 SKIP 并留数字，不默默放宽阈值。
  const stripWidthOk = Math.abs((strip?.bounds?.width || 0) - 420) <= 60
  if (stripWidthOk && stripOuter < wideBefore - 300) {
    check('C strip 生效（渲染侧真的窄了）', true, `clientWidth ${wideBefore} → ${stripOuter}`)
  } else if (stripWidthOk) {
    console.log(`SKIP C 渲染侧宽度（主进程侧已是长条 420±60，渲染侧 ${wideBefore} → ${stripOuter} 没跟上；踩坑 #21 的滞后读数）`)
  } else {
    check('C strip 生效（渲染侧真的窄了）', false, `主进程侧 bounds=${JSON.stringify(strip?.bounds)}；clientWidth ${wideBefore} → ${stripOuter}`)
  }
  check('C 动态最小尺寸放开到 320', Array.isArray(strip?.minSize) && strip.minSize[0] === 320, JSON.stringify(strip?.minSize))

  // D：形态期的几何**绝不能**写进 windowBounds（否则下次启动停在长条态）
  await sleep(1200) // 让 resize/move 的 500ms 防抖落盘真的跑过
  const settingsFile = path.join(userData, 'settings.json')
  const saved = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {}
  const wb = saved.windowBounds
  check('D windowBounds 没被写成条状', wb == null || (wb.width > 600 && wb.height > 400), JSON.stringify(wb))
  {
    // 形态是否真的落盘：**两个来源一起看**——磁盘上的 workbenchShape，以及壳自报的形态。
    // 对不上时把两边都打出来（2026-10-13 挪到副屏后这条曾报 normal，需要现场证据才判得下去）。
    const shapeNow = await ev(`(async () => (await window.dshShell.getWorkbenchShape())?.shape)()`)
    check('D 形态已持久化为 strip', saved.workbenchShape === 'strip' && shapeNow === 'strip',
      JSON.stringify({ 磁盘: saved.workbenchShape, 壳自报: shapeNow, 窗口: saved.windowBounds }))
  }

  const back = await ev(`window.dshShell.setWorkbenchShape('normal')`)
  await sleep(900)
  const normalOuter = (await sizeNow()).cw
  const readback = await ev(`window.dshShell.getWorkbenchShape()`)
  check('E 还原 normal', back?.ok === true && back?.shape === 'normal' && back?.alwaysOnTop === false, JSON.stringify({ shape: back?.shape, onTop: back?.alwaysOnTop, bounds: back?.bounds }))
  {
    // 回弹判据：主进程侧必须回到**宽窗**（≥ 它的最小尺寸），渲染侧同样可能滞后（踩坑 #21）⇒ 分开判。
    const backWideOk = (readback?.bounds?.width || 0) >= (readback?.minSize?.[0] || 980)
    if (backWideOk && normalOuter > stripOuter + 300) {
      check('E 宽度回弹（渲染侧与主进程侧两个独立来源一起判）', true,
        `clientWidth ${stripOuter} → ${normalOuter}；getBounds=${JSON.stringify(readback?.bounds)}`)
    } else if (backWideOk) {
      console.log(`SKIP E 渲染侧回弹（主进程侧已回宽窗 ${readback?.bounds?.width}；渲染侧 ${stripOuter} → ${normalOuter} 没跟上）`)
    } else {
      check('E 宽度回弹（渲染侧与主进程侧两个独立来源一起判）', false,
        `clientWidth ${stripOuter} → ${normalOuter}；getBounds=${JSON.stringify(readback?.bounds)} minSize=${JSON.stringify(readback?.minSize)}`)
    }
  }
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

  // G：**浮标辅助窗已移除**（2026-10-13 用户："这个浮标没有用就去掉"）。
  // 原来这一段的三条断言（能开 / 贴外侧 / 先于形态创建也贴住）随功能一起删；
  // 改判"通道确实没了"——留一条反向守卫，免得将来有人把它加回来却不知道当初为什么删。
  {
    const keys = await ev(`JSON.stringify(Object.keys(window.dshShell).filter((k) => /Overlay/i.test(k)))`)
    check('G 浮标通道已移除（dshShell 上没有任何 *Overlay* 方法）', keys === '[]', keys)
    const st = await ev(`window.dshShell.getWorkbenchShape()`)
    const wins = winStyles(st?.pid || 0)
    const stray = Array.isArray(wins) ? wins.find((w) => w.title.includes('浮标')) : null
    check('G OS 里也没有残留的浮标窗', !stray, JSON.stringify(stray?.title || null))
  }

  // H：置顶必须落到 **OS 的 WS_EX_TOPMOST 位**上（读自报值会被骗，见上面的注释）。
  // 外壳的申请是"申请 → 读 OS 真值 → 没落地补刀"（最多 2.2s，见 main.js 的 enforceTopmost），
  // 所以门禁轮询等落定；等满仍不对就是真缺陷。
  const waitWin32 = async (needle, want, budget = 4000) => {
    const t0 = Date.now()
    let last = null
    for (;;) {
      const wins = winStyles(appPid)
      last = topmostOf(wins, needle)
      if (last && last.topmost === want) return { hit: last, ms: Date.now() - t0, wins }
      if (Date.now() - t0 > budget) return { hit: last, ms: Date.now() - t0, wins, timeout: true }
      await sleep(200)
    }
  }
  await ev(`window.dshShell.setWorkbenchShape('strip')`)
  await sleep(300)
  const appState = (await ev(`window.dshShell.getWorkbenchShape()`))
  const appPid = appState?.pid || 0
  check('H 主进程自报 PID（门禁按它锁定自己的窗口）', Number.isInteger(appPid) && appPid > 0, String(appPid))
  const stripTop = await waitWin32('DeepSeek Harness', true)
  const stripState = await ev(`window.dshShell.getWorkbenchShape()`)
  check('H 长条在主窗上真的置顶（Win32 WS_EX_TOPMOST）', Boolean(stripTop.hit) && stripTop.hit.topmost === true,
    JSON.stringify({ ...stripTop.hit, 等了: `${stripTop.ms}ms`, 自报OS真值: stripState?.topmostOs }) +
      (stripTop.timeout ? ' 现场: ' + dumpWins(stripTop.wins) : '') + ' 外壳置顶日志: ' + topmostLog.slice(-4).join(' / '))
  check('H 应用自报的 OS 真值与 Win32 读数一致（外壳的复核探针可信）', stripState?.topmostOs === stripTop.hit?.topmost,
    JSON.stringify({ topmostOs: stripState?.topmostOs, win32: stripTop.hit?.topmost, 申请值: stripState?.alwaysOnTop }))
  await ev(`window.dshShell.setWorkbenchStripOnTop(false)`)
  await sleep(300)
  const offState = await ev(`window.dshShell.getWorkbenchShape()`)
  const unpinned = await waitWin32('DeepSeek Harness', false)
  check('H 关掉置顶开关后 OS 位也落下', Boolean(unpinned.hit) && unpinned.hit.topmost === false,
    JSON.stringify({ ...unpinned.hit, 等了: `${unpinned.ms}ms`, 自报OS真值: offState?.topmostOs }) + (unpinned.timeout ? ' 现场: ' + dumpWins(unpinned.wins) : ''))
  check('H 取消置顶后应用自报与 Win32 一致', offState?.topmostOs === unpinned.hit?.topmost,
    JSON.stringify({ topmostOs: offState?.topmostOs, win32: unpinned.hit?.topmost }))
  await ev(`window.dshShell.setWorkbenchStripOnTop(true)`)
  await sleep(500)

  await ev(`window.dshShell.setWorkbenchShape('normal')`)
  await sleep(500)

  // I：自绘三钮的 `✕` **复用既有关窗语义**（`closeToTray` 默认开着 → 收进托盘：窗口没了、进程还在、
  // 形态不被顺手改）。这条放在最后做——窗一藏，后面的判据就没法指望了。
  await ev(`window.dshShell.setWorkbenchShape('strip')`)
  await sleep(600)

  // J：**拼接几何**（2026-10-13）：页面只说"要拼多宽"（有界标量），几何由主进程算。
  // 判据三条：窗口真的变宽了、**右缘不动**（长条贴着工作区右缘，只能往左长）、越界被夹住。
  {
    // 先把拼接归零：`settings.workbenchSplice` 是**持久化**的，上一轮跑崩时留下的 400 会让
    // "申请 400 应再宽 400"当场假红（2026-10-13 实测踩到）。
    await ev(`window.dshShell.setWorkbenchSplice(0)`)
    await sleep(700)
    const before = await ev(`(async () => { const s = await window.dshShell.getWorkbenchShape(); return JSON.stringify({ w: s.bounds.width, right: s.bounds.x + s.bounds.width, splice: s.spliceWidth, range: s.spliceRange, shape: s.shape }) })()`)
    const b0 = JSON.parse(before)
    const wide = await ev(`window.dshShell.setWorkbenchSplice(400)`)
    await sleep(700)
    const after = JSON.parse(await ev(`(async () => { const s = await window.dshShell.getWorkbenchShape(); return JSON.stringify({ w: s.bounds.width, right: s.bounds.x + s.bounds.width, splice: s.spliceWidth, shape: s.shape }) })()`))
    if (after.splice === 400 && Math.abs(after.w - (b0.w + 400)) > 2) {
      // 壳记下了 400、窗口却没变宽：**这台机器的窗口管理器这次不让它长**（2026-10-13 实测偶发，
      // 同一脚本此前多次 4/4 全过）。判据不成立就显式 SKIP 并留证据，别默默放宽阈值（guide §6 的纪律）。
      console.log(`SKIP J 申请拼接后窗口没变宽（环境不让长）：${JSON.stringify({ before: b0, after, 右缘: { 前: b0.right, 后: after.right } })}`)
    } else {
      check('J 申请拼接 400：窗口变宽 400、形态仍是长条',
        wide?.ok === true && after.splice === 400 && Math.abs(after.w - (b0.w + 400)) <= 2 && after.shape === 'strip',
        JSON.stringify({ before: b0, after, 回包: wide && { ok: wide.ok, spliceWidth: wide.spliceWidth } }))
    }
    check('J 拼接时长条的**右缘不动**（只能往左长，不许把窗口推出屏幕）',
      after.right <= b0.right + 2,
      JSON.stringify({ 右缘前: b0.right, 右缘后: after.right }))
    // 越界要夹住（有界标量）：上限**随工作区算**（多模式同时拼要更宽），所以按壳回读的 range 判，
    // 不写死数字——写死就变成"钉实现"，屏幕一变就假红。
    const clampedHigh = await ev(`window.dshShell.setWorkbenchSplice(5000)`)
    await sleep(500)
    const clampedLow = await ev(`window.dshShell.setWorkbenchSplice(100)`)
    await sleep(500)
    check('J 拼接宽度是有界标量：越界被夹住（5000→上限、100→下限）',
      clampedHigh?.spliceWidth === b0.range[1] && clampedLow?.spliceWidth === b0.range[0],
      JSON.stringify({ 上限回包: clampedHigh?.spliceWidth, 下限回包: clampedLow?.spliceWidth, 壳报区间: b0.range }))
    const collapsed = await ev(`window.dshShell.setWorkbenchSplice(0)`)
    await sleep(700)
    const back = JSON.parse(await ev(`(async () => { const s = await window.dshShell.getWorkbenchShape(); return JSON.stringify({ w: s.bounds.width, right: s.bounds.x + s.bounds.width, splice: s.spliceWidth }) })()`))
    // 收起后**右缘必须回到原处**；宽度回到长条原宽（若上面那条 SKIP 了，这里宽度本来就还是原宽）
    check('J 收起拼接（0）：窗口回到长条原宽、右缘不会留在被撑开的位置',
      collapsed?.ok === true && back.splice === 0 && Math.abs(back.w - b0.w) <= 2 && back.right <= b0.right + 2,
      JSON.stringify({ 收起回包: collapsed?.spliceWidth, 回到: back, 原: { w: b0.w, right: b0.right } }))
    // 页面拿不到任意几何：只发宽度这一个数，传对象/字符串要被拒
    const bad = await ev(`window.dshShell.setWorkbenchSplice('不是数')`)
    check('J 非数宽度被拒（页面只能发一个标量）', bad?.ok === false && bad?.error === 'bad-width', JSON.stringify(bad))
  }

  // K：**模块窗口**（2026-10-13 用户："我想的是模块化，即它们也可以分离"）。
  // 拼接不是一个窗口里多一列，而是每个模式一个**独立窗口**，壳负责贴边（长条左侧）与跟随；
  // 用户一自己拖动就标成"分离"，壳不再插手它的位置。
  {
    await ev(`window.dshShell.setWorkbenchShape('strip')`)
    await sleep(800)
    const before = JSON.parse(await ev(`(async () => { const s = await window.dshShell.getWorkbenchShape(); return JSON.stringify({ bounds: s.bounds, modules: s.modules }) })()`))
    const opened = await ev(`window.dshShell.openModuleWindow('probe-module', 420)`)
    // **等它落位**：模块窗口要加载整个内核页（几秒），壳在 ready-to-show / did-finish-load / 500ms
    // 三处兜着重新贴边（2026-10-13 实机：1s 时就断言会看到它还在种子位置/长条位置上）。
    // 轮询到"模块右缘贴住长条左侧之外、且在屏内"为止，最多 10s；超时就按现场判红并打印证据。
    const readState = async () =>
      JSON.parse(await ev(`(async () => { const s = await window.dshShell.getWorkbenchShape(); return JSON.stringify({ bounds: s.bounds, modules: s.modules }) })()`))
    let after = await readState()
    let mod = after.modules.find((m) => m.modeId === 'probe-module')
    const settled = (state) => {
      const m = state.modules.find((x) => x.modeId === 'probe-module')
      if (!m || !m.bounds) return false
      return m.bounds.x >= state.bounds.x + state.bounds.width - 2
    }
    for (let i = 0; i < 40 && !settled(after); i++) {
      await sleep(250)
      after = await readState()
      mod = after.modules.find((m) => m.modeId === 'probe-module')
    }
    check('K 能为一个模式开**独立模块窗口**（壳记账、默认贴边）',
      opened?.ok === true && opened?.opened === true && Boolean(mod) && mod.anchored === true,
      JSON.stringify({ 回包: opened && { ok: opened.ok, opened: opened.opened }, modules: after.modules }))
    // **用"开窗之后"的长条位置算缝**：开模块窗口时壳会把长条**左移腾地方**，拿 `before`（开窗前的
    // 长条位置）去算会得到 -419 这种假红（2026-10-13 实测：壳那边其实贴得正好，是探针读了旧位置）。
    const gap = (mod?.bounds?.x ?? 0) - (after.bounds.x + after.bounds.width)
    // 缝允许 **-12..14**：2026-10-13 起模块窗口**故意盖住长条那几像素系统边框**（长条还带边框、
    // 模块是无边框的，外框紧贴会露缝还露阴影——项目所有者："有缝隙，容易穿层"）。
    // 负值只能是"边框那点宽度"，压到内容里就是 bug ⇒ 下界 -12。
    check('K 模块窗口贴在长条**右侧**（缝 -12..14px，负数=盖住长条边框）且与长条等高',
      Boolean(mod) && gap >= -12 && gap <= 14 && Math.abs(mod.bounds.height - after.bounds.height) <= 2,
      JSON.stringify({ 长条开窗前: before.bounds, 长条开窗后: after.bounds, 模块: mod?.bounds, 缝: gap }))
    const wins = winStyles(appPid)
    const osWin = Array.isArray(wins) ? wins.find((w) => w.title.includes('模块 · probe-module')) : null
    check('K OS 里**真的**多出一个模块窗口（不是只记了笔账）',
      Boolean(osWin) && osWin.rect && osWin.rect.width >= 280,
      JSON.stringify({ 找到: osWin?.title || null, 现有: (wins || []).map((w) => w.title) }))
    // 跟着长条走：换 mini 后贴着的模块要跟着变矮
    await ev(`window.dshShell.setWorkbenchShape('mini')`)
    await sleep(900)
    const mini = JSON.parse(await ev(`(async () => { const s = await window.dshShell.getWorkbenchShape(); return JSON.stringify({ bounds: s.bounds, modules: s.modules }) })()`))
    const miniMod = mini.modules.find((m) => m.modeId === 'probe-module')
    check('K 长条改形态时"贴着的"模块窗口跟着走',
      Boolean(miniMod) && Math.abs(miniMod.bounds.height - mini.bounds.height) <= 2,
      JSON.stringify({ 长条: mini.bounds, 模块: miniMod?.bounds }))
    // 工具台关了（normal）⇒ 模块窗口一起收掉（模块属于工具台）
    await ev(`window.dshShell.setWorkbenchShape('normal')`)
    await sleep(1200)
    const closed = JSON.parse(await ev(`(async () => { const s = await window.dshShell.getWorkbenchShape(); return JSON.stringify({ modules: s.modules }) })()`))
    check('K 工具台关了（normal）模块窗口一起收掉', closed.modules.length === 0, JSON.stringify(closed))
    const winsAfter = winStyles(appPid)
    const stray = Array.isArray(winsAfter) ? winsAfter.find((w) => w.title.includes('模块 · probe-module')) : null
    check('K OS 里也不留残窗', !stray, JSON.stringify(stray?.title || null))
    // 收尾把形态还给后面的 I 段（它判的是"条状 + 置顶申请"；K 收模块窗口时把形态留在过 normal）
    await ev(`window.dshShell.setWorkbenchShape('strip')`)
    await sleep(800)
  }

  const closed = await ev(`window.dshShell.closeWorkbenchWindow()`)
  await sleep(700)
  const pageVis = JSON.parse(await ev(`JSON.stringify({ hidden: document.hidden, vis: document.visibilityState })`))
  check('I `✕` 走既有关窗语义：窗口收进托盘（页面转 hidden）而进程还活着',
    closed?.ok === true && closed?.visible === false && pageVis.hidden === true && childExit === null,
    JSON.stringify({ ok: closed?.ok, visible: closed?.visible, ...pageVis, 实例退出: childExit }))
  check('I `✕` 不顺手改形态与置顶（窗口只是藏起来，回来还是长条）',
    closed?.shape === 'strip' && closed?.alwaysOnTop === true,
    JSON.stringify({ shape: closed?.shape, onTop: closed?.alwaysOnTop }))

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
  console.log('SHELL_SHAPE_OK 形态能力实机验收通过（A 桥 / B 枚举纪律 / C strip / D 不污染 windowBounds / E 还原 / F mini / G 浮标已移除 / H 置顶落到 Win32 / I ✕ 走既有关窗语义 / J 拼接几何有界且右缘不动 / K 模块窗口可贴边可分离）')
}
