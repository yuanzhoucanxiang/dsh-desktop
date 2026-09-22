/**
 * S1 授权闸的实机验证（2026-09-21）。
 *
 * 验的是**安全属性**，不是 UX：从一个「不是设置窗口」的真实渲染进程（内核页面主世界，
 * 也就是第三方插件 client 代码所在的地方）调 `dshShell.notifyCommand(...)` /
 * `notifyCommandTest()`，必须被主进程拒绝，且 settings.json 里的命令**一字不变**。
 * 两个原生确认框属交互，需人工目检（见 report.md §五.5），本探针不代劳。
 *
 * 做法：真拉起外壳（dev 态 electron . 或 --exe 指定的装机版），全部路径隔离到 %TEMP%，
 * 用 --remote-debugging-port 连 CDP 在真实窗口里求值。**清理只按本轮 spawn 出来的 PID**
 * （lib/pid-cleanup.js），绝不按镜像名结束进程——那会连用户正在用的正式桌面一起杀掉。
 *
 * 用法：
 *   node docs/audits/shell-hardening/2026-09-21/verify-ipc-authz.mjs
 *   node docs/audits/shell-hardening/2026-09-21/verify-ipc-authz.mjs --exe "<解包目录>\DeepSeek Harness Desktop.exe"
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const { killTree, pidAlive } = require(path.join(ROOT, 'lib/pid-cleanup.js'))

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}
const packagedExe = flag('--exe')

const failures = []
function check(name, ok, detail) {
  if (!ok) failures.push(name)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined && detail !== '' ? '  [' + detail + ']' : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ipc-authz-'))
const home = path.join(temp, 'home')
const userData = path.join(temp, 'user-data')
fs.mkdirSync(home, { recursive: true })
fs.mkdirSync(userData, { recursive: true })

// 裁决4（字段最小化）的端到端取证：先预置一个**带秘密的** notifyCommand，
// 再从内核页面（非设置窗口）读 status()，断言秘密一个字也不出现在回包里。
// 用预置文件而不是走 IPC 写入，因为写入通道本身已被 S1 挡住（那是另一件事）。
const PROBE_SECRET = 'echo DSH-AUTHZ-PROBE-SECRET-9f3c17'
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
  autoLaunch: false,
  closeToTray: true,
  workspace: '',
  notifyOnTurnEnd: false, // 不让探针期间真的触发钩子
  notifyCommand: PROBE_SECRET,
  // 显式写默认热键：下面的断言要比对“改键被拒后 settings.json 未变”，
  // 不能依赖应用是否已经因其他原因落盘过（否则字段缺失会让断言变成假失败）。
  globalHotkey: 'Control+Alt+D',
}, null, 2), 'utf8')

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port
      srv.close(() => resolve(p))
    })
  })
}

async function cdpTargets(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })
    if (!r.ok) return []
    return await r.json()
  } catch {
    return []
  }
}

/** 最小 CDP 求值：连上 target，跑一个表达式，拿回 JSON 值。 */
async function evaluate(wsUrl, expression, timeoutMs = 20000) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
    setTimeout(() => reject(new Error('CDP 连接超时')), timeoutMs)
  })
  try {
    const send = (id, method, params) => ws.send(JSON.stringify({ id, method, params }))
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('求值超时')), timeoutMs)
      ws.addEventListener('message', (ev) => {
        let msg = null
        try { msg = JSON.parse(ev.data) } catch { return }
        if (msg.id !== 1) return
        clearTimeout(timer)
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        else resolve(msg.result)
      })
      send(1, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    })
    if (result && result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'renderer 异常')
    }
    return result && result.result ? result.result.value : undefined
  } finally {
    try { ws.close() } catch {}
  }
}

let child = null
let debugPort = 0
try {
  debugPort = await freePort()
  const exe = packagedExe || path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  const cmdArgs = packagedExe ? [] : [ROOT]
  console.log(`启动被测外壳：${exe} ${cmdArgs.join(' ')}`)
  console.log(`隔离 DSH_DESKTOP_HOME=${home}`)
  console.log(`隔离 DSH_DESKTOP_USER_DATA=${userData}`)
  child = spawn(exe, [...cmdArgs, `--remote-debugging-port=${debugPort}`], {
    cwd: ROOT,
    windowsHide: false,
    env: {
      ...process.env,
      // 关键：DSH_DESKTOP_USER_DATA 只隔离 userData（单实例锁按它分桶），
      // **不隔离 DSH_HOME**——所以必须同时给 DSH_DESKTOP_HOME，否则会写进用户真实的 ~/.dsh
      DSH_DESKTOP_HOME: home,
      DSH_DESKTOP_USER_DATA: userData,
      DSH_HOME: home,
      DSH_DESKTOP_CWD: path.join(temp, 'workspace'),
    },
  })
  fs.mkdirSync(path.join(temp, 'workspace'), { recursive: true })
  const myPid = child.pid

  // 等一个带 dshShell 桥的页面 target 出现（内核页；启动画面也算，但会随交接关闭）
  let target = null
  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`外壳提前退出（exit ${child.exitCode}）`)
    const list = await cdpTargets(debugPort)
    target = list.find((t) => t.type === 'page' && /^https?:|^file:/.test(t.url || '') && t.webSocketDebuggerUrl
      && !/splash\.html|settings\.html|splash-preview/.test(t.url || ''))
    if (target) break
    await sleep(500)
  }
  if (!target) throw new Error('180s 内没有出现可用的页面 target（内核没起来？）')
  console.log(`已连上页面 target：${target.url}`)

  // 前置：桥确实活着（否则"被拒"可能只是桥不存在，属于假通过）
  const bridgeAlive = await evaluate(target.webSocketDebuggerUrl, 'typeof window.dshShell?.notifyCommand')
  check('前置：页面里 dshShell.notifyCommand 存在（桥确实暴露给了内核页面）', bridgeAlive === 'function', String(bridgeAlive))
  const stateOk = await evaluate(target.webSocketDebuggerUrl, 'window.dshShell.status().then(s => !!(s && s.version))')
  check('前置：同一窗口调 status() 正常（说明拒绝是针对通道，不是桥整体失效）', stateOk === true, String(stateOk))

  // 攻击面：写入任意命令
  const settingsFile = path.join(userData, 'settings.json')
  const beforeRaw = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : ''
  const writeRes = await evaluate(target.webSocketDebuggerUrl,
    "window.dshShell.notifyCommand('echo INJECTED-BY-PAGE-PLUGIN')")
  check('S1 非设置窗口写 notifyCommand 被拒', writeRes && writeRes.ok === false && writeRes.error === 'only-settings-window',
    JSON.stringify(writeRes))

  // 攻击面：直接触发执行（即使写入被拒，试跑通道也必须独立设闸）
  const testRes = await evaluate(target.webSocketDebuggerUrl, 'window.dshShell.notifyCommandTest()')
  check('S1 非设置窗口触发 notifyCommandTest 被拒', testRes && testRes.ok === false && testRes.error === 'only-settings-window',
    JSON.stringify(testRes))

  await sleep(600)
  const afterRaw = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : ''
  const beforeCmd = beforeRaw ? (JSON.parse(beforeRaw).notifyCommand ?? '') : ''
  let afterCmd = ''
  try { afterCmd = afterRaw ? (JSON.parse(afterRaw).notifyCommand ?? '') : '' } catch { afterCmd = '(settings.json 解析失败)' }
  check('S1 settings.json 里的命令一字未变（没有被注入）',
    beforeCmd === afterCmd && !String(afterCmd).includes('INJECTED'),
    `before=${JSON.stringify(beforeCmd)} after=${JSON.stringify(afterCmd)}`)

  // 裁决4：非设置窗口读 status() 不得拿到 notifyCommand 的内容
  const st = await evaluate(target.webSocketDebuggerUrl, 'window.dshShell.status()')
  check('裁决4 非设置窗口的 status().notifyCommand 被清空（不含命令内容）',
    Boolean(st) && st.notifyCommand === '', JSON.stringify(st && st.notifyCommand))
  check('裁决4 status() 仍告知“是否配了钩子”（不含内容的布尔位，UI 不至于失明）',
    Boolean(st) && st.hasNotifyCommand === true, JSON.stringify(st && st.hasNotifyCommand))
  check('裁决4 秘密串在整个 status() 回包里一字不出现',
    !JSON.stringify(st || {}).includes('DSH-AUTHZ-PROBE-SECRET'))
  check('裁决4 其余状态字段未被这次收紧误伤（version/port/workspace 仍在）',
    Boolean(st && st.version && st.port && typeof st.workspace === 'string'),
    JSON.stringify(st && { version: st.version, port: st.port }))

  // 全局热键：状态对所有窗口可见（不含敏感信息），但**改键只允许设置窗口**。
  // 理由：全局热键是系统级的，让内核页面里的插件 JS 能改它，等于给它一个键盘劫持面
  // （改成裸键就能让全系统打不出那个字母）。
  check('热键 注册状态经 get-state 下发（面板才能把“被占用”说清楚）',
    Boolean(st) && Boolean(st.hotkey) && typeof st.hotkey.status === 'string',
    JSON.stringify(st && st.hotkey))
  check('热键 候选键随 get-state 下发且自身完整（≥3 个）',
    Array.isArray(st && st.hotkeyPresets) && st.hotkeyPresets.length >= 3
      && st.hotkeyPresets.every((p) => p && p.accelerator && p.label),
    JSON.stringify(st && st.hotkeyPresets))
  const hkRes = await evaluate(target.webSocketDebuggerUrl,
    "window.dshShell.setGlobalHotkey('Control+Alt+K')")
  check('热键 非设置窗口改键被拒（防内核页插件 JS 劫持键盘）',
    hkRes && hkRes.ok === false && hkRes.error === 'only-settings-window', JSON.stringify(hkRes))
  const hkBare = await evaluate(target.webSocketDebuggerUrl, "window.dshShell.setGlobalHotkey('D')")
  check('热键 裸键也先撞授权闸（授权先于校验，不泄露校验细节）',
    hkBare && hkBare.ok === false && hkBare.error === 'only-settings-window', JSON.stringify(hkBare))
  await sleep(400)
  const afterHkRaw = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : ''
  let afterHkVal = ''
  try { afterHkVal = afterHkRaw ? (JSON.parse(afterHkRaw).globalHotkey ?? '') : '' } catch { afterHkVal = '(解析失败)' }
  check('热键 settings.json 里的 globalHotkey 未被非设置窗口改动',
    afterHkVal === 'Control+Alt+D', JSON.stringify(afterHkVal))

  // 同类通道对照：破坏性操作仍按既有分寸走原生确认（这里只验它没被我的改动弄坏）
  const restoreRes = await evaluate(target.webSocketDebuggerUrl, 'window.dshShell.pluginsRestore()')
  check('S2 pluginsRestore 在无隔离记录时安全返回（有记录时会先弹原生确认）',
    restoreRes && (restoreRes.ok === true && restoreRes.restored === 0 || restoreRes.canceled === true || restoreRes.ok === false),
    JSON.stringify(restoreRes))

  // ── 授权闸的**放行侧** ──
  // 此前只测过“非设置窗口被拒”，从没测过“设置窗口确实能用”。
  // 万一 isSettingsSender 恒为假，S1 就会变成静默的功能损坏（没人能再改钩子/热键），
  // 而那在只看“被拒”断言时是全绿的。所以必须双向验。
  await evaluate(target.webSocketDebuggerUrl, 'window.dshShell.openSettings()')
  let sTarget = null
  const sDeadline = Date.now() + 25000
  while (Date.now() < sDeadline) {
    const list = await cdpTargets(debugPort)
    sTarget = list.find((t) => t.type === 'page' && /settings\.html/.test(t.url || '') && t.webSocketDebuggerUrl)
    if (sTarget) break
    await sleep(300)
  }
  check('前置：设置窗口能被打开（放行侧验证的前提）',
    Boolean(sTarget), sTarget ? sTarget.url : '25s 内未出现 settings.html target')

  if (sTarget) {
    const sState = await evaluate(sTarget.webSocketDebuggerUrl, 'window.dshShell.status()')
    check('S1 放行侧：设置窗口能读到 notifyCommand 真值（证明授权闸不是恒拒）',
      sState && sState.notifyCommand === PROBE_SECRET, JSON.stringify(sState && sState.notifyCommand))

    const ui = await evaluate(sTarget.webSocketDebuggerUrl, `(() => {
      const st = document.getElementById('hotkey-status')
      const box = document.getElementById('hotkey-presets')
      return {
        hasStatus: !!st,
        statusText: st ? st.textContent : '',
        presetButtons: box ? box.querySelectorAll('button').length : 0,
        hasCustomInput: !!document.getElementById('hotkey-custom'),
        hasSaveBtn: !!document.getElementById('btn-hotkey-save'),
        hasOffBtn: !!document.getElementById('btn-hotkey-off'),
      }
    })()`)
    check('B 设置面板真的渲染出热键卡片（状态 + 候选键 + 自定义输入 + 关闭按钮）',
      Boolean(ui) && ui.hasStatus && ui.presetButtons >= 3 && ui.hasCustomInput && ui.hasSaveBtn && ui.hasOffBtn,
      JSON.stringify(ui))
    check('A 状态行把注册结果说清楚了（不是空白）',
      Boolean(ui) && typeof ui.statusText === 'string' && ui.statusText.length > 0,
      JSON.stringify(ui && ui.statusText))

    const setRes = await evaluate(sTarget.webSocketDebuggerUrl, "window.dshShell.setGlobalHotkey('Control+Alt+K')")
    check('B 放行侧：设置窗口能真的改键（不再返回 only-settings-window）',
      setRes && setRes.ok === true && setRes.accelerator === 'Control+Alt+K', JSON.stringify(setRes))

    const bare = await evaluate(sTarget.webSocketDebuggerUrl, "window.dshShell.setGlobalHotkey('D')")
    check('热键 裸键被白名单拒绝（否则会在系统级劫持 D 键）且带人话解释',
      bare && bare.ok === false && bare.error === 'missing-modifier'
        && typeof bare.message === 'string' && bare.message.length > 4, JSON.stringify(bare))
    const ctrlC = await evaluate(sTarget.webSocketDebuggerUrl, "window.dshShell.setGlobalHotkey('Control+C')")
    check('热键 Control+C 被拒（否则全系统无法复制）',
      ctrlC && ctrlC.ok === false && ctrlC.error === 'letter-needs-alt-or-super', JSON.stringify(ctrlC))
    const injected = await evaluate(sTarget.webSocketDebuggerUrl, "window.dshShell.setGlobalHotkey('Control+Alt+D\\nX')")
    check('热键 换行注入被拒（这个串会进 settings.json / 日志 / 托盘菜单标签）',
      injected && injected.ok === false && injected.error === 'illegal-char', JSON.stringify(injected))

    await sleep(500)
    let finalHk = ''
    try { finalHk = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).globalHotkey } catch { finalHk = '(解析失败)' }
    check('B 改键结果已落盘，且被拒的那几个没写进去',
      finalHk === 'Control+Alt+K', JSON.stringify(finalHk))
  }

  // 清理：只按本轮 PID
  if (pidAlive(myPid)) {
    killTree(myPid)
    const t2 = Date.now() + 15000
    while (Date.now() < t2 && pidAlive(myPid)) await sleep(200)
  }
  check('清理：只结束本轮 spawn 的 PID 树', !pidAlive(myPid), `pid=${myPid} alive=${pidAlive(myPid)}`)
} catch (err) {
  check('探针自身未抛异常', false, err && err.stack ? err.stack : String(err))
  if (child && child.pid && pidAlive(child.pid)) { try { killTree(child.pid) } catch {} }
}

console.log(`\n${failures.length ? 'IPC_AUTHZ_FAIL' : 'IPC_AUTHZ_OK'} ${failures.length} 项失败`)
if (failures.length) console.log('失败项：' + failures.join(' | '))
console.log('隔离目录：' + temp)
process.exit(failures.length === 0 ? 0 : 1)
