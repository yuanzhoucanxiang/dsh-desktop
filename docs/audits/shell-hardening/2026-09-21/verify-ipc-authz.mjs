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

  // 同类通道对照：破坏性操作仍按既有分寸走原生确认（这里只验它没被我的改动弄坏）
  const restoreRes = await evaluate(target.webSocketDebuggerUrl, 'window.dshShell.pluginsRestore()')
  check('S2 pluginsRestore 在无隔离记录时安全返回（有记录时会先弹原生确认）',
    restoreRes && (restoreRes.ok === true && restoreRes.restored === 0 || restoreRes.canceled === true || restoreRes.ok === false),
    JSON.stringify(restoreRes))

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
