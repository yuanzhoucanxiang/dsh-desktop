'use strict'

/**
 * 外壳（Electron 桌面版本体）加固回归 S1–S6（2026-09-21）。
 *
 * 每一项对应 hunt 探针实锤复现过的一个缺陷；这里断言的是**修复后的行为**。
 * 原始复现取证见 docs/audits/shell-hardening/2026-09-21/hunt-shell.mjs（修复后应全部 NOT_REPRODUCED）。
 *
 * 纯 node 跑，秒级：node lib/shell-hardening.test.js → exit 0 = 通过。
 * 不启动 Electron、不结束任何进程、不碰真实安装与用户工作区（全部在 %TEMP% 隔离目录）。
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { shellQuotePath, expandNotifyCommand } = require('./shell-quote')
const { readNdjsonTail } = require('./ndjson-tail')
const { setEntryDisabled, parsePatchList } = require('./plugin-manager')

const failures = []
function check(name, ok, detail) {
  if (!ok) failures.push(name)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined && detail !== '' ? '  [' + detail + ']' : ''}`)
}

const ROOT = path.resolve(__dirname, '..')
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const isWin = process.platform === 'win32'
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-shell-hardening-'))

// S3 的真实 shell 验证是异步的；在 try 外先占位，块内再赋值
// （const 会因块作用域在块外的回调里报 ReferenceError，marker 同理）
let shellProbe = Promise.resolve()
let marker = ''

/** 取某个 IPC handler 的源码片段，用来断言它有没有确认框 / 发送方校验。 */
function handlerSource(channel, span = 1400) {
  const main = src('main.js')
  const a = main.indexOf(`ipcMain.handle('${channel}'`)
  const b = main.indexOf(`ipcMain.on('${channel}'`)
  const i = a >= 0 ? a : b
  return i >= 0 ? main.slice(i, i + span) : ''
}

try {
  /* ── S1 · 通知钩子命令：只有设置窗口能写，且变更要过原生确认 ────────────── */
  const hNotify = handlerSource('shell:notify-command')
  const hNotifyTest = handlerSource('shell:notify-command-test')
  check('S1 notify-command 有发送方窗口授权', /isSettingsSender\(event\)/.test(hNotify))
  check('S1 notify-command-test 有发送方窗口授权', /isSettingsSender\(event\)/.test(hNotifyTest))
  check('S1 notify-command 变更时过原生确认框', /await confirm\(\{/.test(hNotify))
  check('S1 isSettingsSender 真的按窗口比对（不是永真）',
    /function isSettingsSender\(event\)[\s\S]{0,400}?BrowserWindow\.fromWebContents/.test(src('main.js'))
    && /w === settingsWin/.test(src('main.js')))
  check('S1 命令确实经 shell:true 执行（所以这道闸是必要的）', /spawn\(cmd, \{\s*shell: true/.test(src('main.js')))
  // 裁决4（字段最小化）：get-state 是无差别暴露给所有窗口的，而 notifyCommand 可能带敏感参数。
  // 它在本仓库没有任何 get-state 消费者（设置页走已授权的专用 getter，palis 面板的 ShellState
  // 只声明 version/kernelVersion/port/workspace/elapsedMs），所以按发送方分级是安全的。
  const mainSrc = src('main.js')
  check('裁决4 shell:get-state 按发送方最小化 notifyCommand（只有设置窗口拿真值）',
    mainSrc.includes('const privileged = isSettingsSender(event)')
      && mainSrc.includes("notifyCommand: privileged ? (settings.notifyCommand || '') : ''"))
  check('裁决4 get-state 仍给不含内容的 hasNotifyCommand 布尔位（UI 不至于失明）',
    mainSrc.includes('hasNotifyCommand: Boolean(settings.notifyCommand)'))
  check('裁决4 get-state 里没有其它地方再把 notifyCommand 真值无条件放回包',
    (mainSrc.match(/notifyCommand: settings\.notifyCommand/g) || []).length === 0)
  check('S1 授权发生在主进程而不是渲染侧（preload 只做转发）',
    !/isSettingsSender|senderFrame/.test(src('preload.js')))

  /* ── S2 · plugins-restore 会重启内核，必须与 restart-kernel 同一道确认门 ── */
  const hRestore = handlerSource('shell:plugins-restore')
  check('S2 plugins-restore 有原生确认框', /await confirm\(\{/.test(hRestore))
  check('S2 确认文案点明会重启内核', /重启内核/.test(hRestore))
  check('S2 恢复路径确实会 restartKernel（所以确认是必要的）',
    /function restoreQuarantinedBundles\(\)[\s\S]{0,2600}?restartKernel\(\)/.test(src('main.js')))
  check('S2 渲染侧不再用可被页面改写的 window.confirm 顶替原生框',
    !/window\.confirm\('恢复所有被隔离的插件/.test(src('renderer/settings.js')))

  /* ── S3 · 占位符替换必须按 shell 规则加引号 ─────────────────────────────── */
  // 安全路径：与旧的裸拼逐字节一致（不引入回归）
  const safeCwd = isWin ? 'C:\\Users\\me\\dsh-workspace' : '/home/me/dsh-workspace'
  check('S3 安全路径原样返回（既有钩子命令逐字节不变）',
    expandNotifyCommand('echo {cwd}', { files: 0, cwd: safeCwd }) === `echo ${safeCwd}`,
    expandNotifyCommand('echo {cwd}', { files: 0, cwd: safeCwd }))

  // 含 & 的路径：真跑一次 shell，验证 & 后面的载荷**不**被执行
  marker = path.join(temp, 'S3_PWNED')
  const cwdEvil = path.join(temp, isWin ? 'ws & node s3-payload.js' : 'ws ; node s3-payload.js')
  fs.mkdirSync(cwdEvil, { recursive: true })
  fs.writeFileSync(path.join(cwdEvil, 's3-payload.js'), `require('fs').writeFileSync(${JSON.stringify(marker)}, '1')\n`, 'utf8')
  const cmd = expandNotifyCommand('echo hook {cwd}', { files: 0, cwd: cwdEvil })
  check('S3 含 & 的路径被加引号', cmd.includes('"') || cmd.includes("'"), cmd)
  shellProbe = new Promise((resolve) => {
    const child = spawn(cmd, { shell: true, cwd: cwdEvil, detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
    child.on('exit', () => resolve())
    child.on('error', () => resolve())
    setTimeout(resolve, 4000)
  })

  // {files} 必须是整数，不能成为注入面
  check('S3 {files} 强制成整数（传字符串也注不进去）',
    expandNotifyCommand('echo {files}', { files: '1 & calc', cwd: safeCwd }) === 'echo 0',
    expandNotifyCommand('echo {files}', { files: '1 & calc', cwd: safeCwd }))
  check('S3 {workspace} 与 {cwd} 同口径加引号',
    expandNotifyCommand('echo {workspace}', { files: 0, cwd: cwdEvil }) === expandNotifyCommand('echo {cwd}', { files: 0, cwd: cwdEvil }))
  // POSIX 分支（在 Windows 上也能测，靠显式 opts）
  check('S3 POSIX 分支单引号包裹且内部单引号正确逸出',
    shellQuotePath("/tmp/a'b", { win: false }) === "'/tmp/a'\\''b'",
    shellQuotePath("/tmp/a'b", { win: false }))
  check('S3 POSIX 分支对安全路径原样返回', shellQuotePath('/tmp/abc-1_2.x', { win: false }) === '/tmp/abc-1_2.x')

  /* ── S4 · entry id 未校验就插值进 YAML ─────────────────────────────────── */
  const y1 = path.join(temp, 'p1.yml')
  const r1 = setEntryDisabled(y1, "evil\n  disabled: true\n- id: hijacked\n  name: '@attacker/pkg'", true)
  check('S4 含换行的 entry id 被拒绝', r1.ok === false && /不安全字符/.test(r1.error || ''), JSON.stringify(r1))
  check('S4 拒绝时不落盘（不留下被注入的补丁文件）', !fs.existsSync(y1))
  const y2 = path.join(temp, 'p2.yml')
  const r2 = setEntryDisabled(y2, 'evil2\n      bad: [unclosed', true)
  check('S4 能写出解析不了形状的 id 同样被拒绝', r2.ok === false && !fs.existsSync(y2))
  const y3 = path.join(temp, 'p3.yml')
  const r3 = setEntryDisabled(y3, 'dsh-better-sidebar', true)
  const parsed3 = parsePatchList(fs.readFileSync(y3, 'utf8'))
  check('S4 正常 id 仍可切换（白名单不误伤）',
    r3.ok === true && r3.changed === true && parsed3.ok && parsed3.entries.some((e) => e.id === 'dsh-better-sidebar' && e.disabledValue === true),
    JSON.stringify({ r3, ids: parsed3.ok ? parsed3.entries.map((e) => e.id) : parsed3.error }))
  for (const good of ['@dsh-local/palis-theme-panel', 'review-bridge', 'a.b-c_d:e/f']) {
    const f = path.join(temp, `good-${Buffer.from(good).toString('hex').slice(0, 12)}.yml`)
    const r = setEntryDisabled(f, good, true)
    check(`S4 合法形态 id 被接受：${good}`, r.ok === true, JSON.stringify(r))
  }

  /* ── S5 · review-bridge 回退端点必须有请求体上限 ────────────────────────── */
  const bridge = src('plugin/review-bridge.js')
  check('S5 review-bridge 有 1 MiB 请求体上限', /const MAX_BODY_BYTES = 1024 \* 1024/.test(bridge))
  check('S5 超限回 413 而不是继续收集', /bytes > MAX_BODY_BYTES/.test(bridge) && /writeHead\(413/.test(bridge))
  check('S5 回环闸仍在（上限不替代它）', /isLoopbackRequest\(req\)/.test(bridge))

  /* ── S6 · 会话改动流只读尾部，且截断如实上报 ────────────────────────────── */
  const stream = path.join(temp, 'review-events.ndjson')
  const big = 'x'.repeat(200 * 1024)
  const lines = []
  for (let i = 0; i < 40; i++) lines.push(JSON.stringify({ kind: 'tool-call', seq: i, name: 'write', file: `c${i}.md`, new: big, note: '中文尾巴' }))
  fs.writeFileSync(stream, lines.join('\n') + '\n', 'utf8')
  const total = fs.statSync(stream).size

  const capped = readNdjsonTail(stream, { maxBytes: 1024 * 1024 })
  check('S6 超字节上限时只读尾部并标 truncated',
    capped.ok && capped.truncated === true && capped.readBytes <= 1024 * 1024 && capped.streamBytes === total,
    JSON.stringify({ readBytes: capped.readBytes, streamBytes: capped.streamBytes, truncated: capped.truncated }))
  check('S6 尾部读取不产生残行（每条都是完整 JSON）',
    capped.entries.length > 0 && capped.entries.every((e) => Number.isInteger(e.seq)),
    `entries=${capped.entries.length}`)
  check('S6 残行丢弃不切碎多字节字符（无 U+FFFD）',
    capped.entries.every((e) => !String(e.note || '').includes('\uFFFD')),
    JSON.stringify(capped.entries[0] && capped.entries[0].note))
  check('S6 保留的是最近的条目而不是最旧的',
    capped.entries[capped.entries.length - 1].seq === 39 && capped.entries[0].seq > 0,
    `first=${capped.entries[0] && capped.entries[0].seq} last=${capped.entries[capped.entries.length - 1].seq}`)

  const byEntries = readNdjsonTail(stream, { maxEntries: 5 })
  check('S6 条数上限生效并标 truncated',
    byEntries.ok && byEntries.entries.length === 5 && byEntries.truncated === true)

  const whole = readNdjsonTail(stream, { maxBytes: 64 * 1024 * 1024, maxEntries: 100000 })
  check('S6 未触上限时全量返回且 truncated=false',
    whole.ok && whole.entries.length === 40 && whole.truncated === false)

  const missing = readNdjsonTail(path.join(temp, 'nope.ndjson'))
  check('S6 文件不存在时 ok:false 并带 error（不静默当空）', missing.ok === false && Boolean(missing.error))

  const empty = path.join(temp, 'empty.ndjson')
  fs.writeFileSync(empty, '', 'utf8')
  const emptyRes = readNdjsonTail(empty)
  check('S6 空流返回 0 条且不算截断', emptyRes.ok && emptyRes.entries.length === 0 && emptyRes.truncated === false)

  check('S6 main.js 走的是这个纯函数（不是自己整份读）',
    /readNdjsonTail\(state\.reviewStreamPath\)/.test(src('main.js'))
    && !/fs\.readFileSync\(state\.reviewStreamPath, 'utf8'\)/.test(src('main.js')))
  check('S6 侧栏对截断如实告知（textContent，不用 innerHTML）',
    /sessionData\.truncated/.test(src('preload.js')) && /只显示最近的改动/.test(src('preload.js')))

  /* ── 附带：这两处新逻辑必须是零 Electron 依赖，才能被普通 node 单测 ─────── */
  check('新模块不依赖 electron',
    !/require\('electron'\)/.test(src('lib/shell-quote.js')) && !/require\('electron'\)/.test(src('lib/ndjson-tail.js')))
  check('新模块已随包发布（build.files 含 lib/*.js）', /"lib\/\*\.js"/.test(src('package.json')))
} catch (err) {
  check('测试自身未抛异常', false, err && err.stack ? err.stack : String(err))
}

// S3 的真实 shell 验证要等子进程跑完再判定
shellProbe.then(() => new Promise((r) => setTimeout(r, 400))).then(() => {
  check('S3 真跑 shell：路径里 & 之后的载荷没有被执行', !fs.existsSync(marker))

  try { fs.rmSync(temp, { recursive: true, force: true }) } catch {}
  console.log(failures.length ? 'SHELL_HARDENING_FAIL ' + failures.join(' | ') : 'SHELL_HARDENING_OK')
  process.exit(failures.length === 0 ? 0 : 1)
})
