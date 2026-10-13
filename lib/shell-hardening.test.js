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
  // 全局热键：以前注册失败只写一行日志（实测 17 次成功对 92 次被拒），而且只能开关不能改键，
  // 一旦被其他程序占住用户就没自救出口。现在：失败可见 + 退避重试 + 可改键（且改键只给设置窗口）。
  check('热键 改键通道按发送方授权（与 notify-command 同一口径）',
    /shell:set-global-hotkey'[\s\S]{0,300}?isSettingsSender\(event\)/.test(mainSrc))
  check('热键 写入前过 accelerator 白名单校验（启动与改键两处都过）',
    /normalizeAccelerator\(next\)/.test(mainSrc) && /normalizeAccelerator\(raw\)/.test(mainSrc))
  check('热键 校验模块被主进程 require（会进 app.asar 的依赖闭包）',
    /require\('\.\/lib\/hotkey'\)/.test(mainSrc))
  check('热键 注册失败会退避重试而不是静默放弃',
    /HOTKEY_RETRY_DELAYS/.test(mainSrc) && /hotkeyGen/.test(mainSrc)
      && /gen !== hotkeyGen/.test(mainSrc))
  check('热键 失败对用户可见（系统通知 + 托盘标签 + get-state）',
    /notifyHotkey\(/.test(mainSrc) && /hotkeyLabel\(\)/.test(mainSrc) && /hotkey: state\.hotkey/.test(mainSrc))
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
  // 审阅侧栏已于 0.1.44 移除（改用 dsh-better-sidebar），truncated 的 UI 展示随之消失。
  // 这里钉住的是仍然成立的契约：休眠通道「shell:session-changes」在 preload 与 main 两侧都还在，
  // 哪天有新消费方接入时，截断标记仍能原样拿到。
  check('S6 侧栏已移除，session-changes 休眠通道两侧仍在（preload 桥 + main 路由）',
    /sessionChanges:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('shell:session-changes'\)/.test(src('preload.js'))
    && /ipcMain\.handle\('shell:session-changes'/.test(src('main.js')))

  /* ── S7 · 作品档案窗口：新增的开窗 IPC 只能开那一个地址 ─────────────────── */
  const wikiSrc = handlerSource('shell:open-wiki')
  const wikiFn = /function openWikiWindow\(rawPath\)[\s\S]{0,2600}?\n}\n/.exec(mainSrc)
  check('S7 preload 只暴露 openWiki(路径)，没有通用 open-url/open-external',
    /openWiki:\s*\(p\)\s*=>\s*ipcRenderer\.invoke\('shell:open-wiki',\s*p\)/.test(src('preload.js'))
    && !/openUrl|openURL|openExternal/.test(src('preload.js')))
  check('S7 IPC 处理器只做转发，校验集中在 openWikiWindow', /=>\s*openWikiWindow\(p\)/.test(wikiSrc))
  check('S7 路径入参被限长、拒控制字符、拒 scheme 前缀（不是"看起来像路径就行"）',
    !!wikiFn && wikiFn[0].includes('p.length > 500')
    && wikiFn[0].includes('\\u0000-\\u001f')
    && wikiFn[0].includes("^[a-z][a-z0-9+.-]*:\\/\\/"))
  check('S7 URL 由外壳用 kernelPageUrl() 拼，插件传不进地址',
    !!wikiFn && /kernelPageUrl\(\)/.test(wikiFn[0]) && /encodeURIComponent\(p\)/.test(wikiFn[0])
    && !/new URL\(p\)|loadURL\(p\)/.test(wikiFn[0]))
  check('S7 窗口数有上限（插件刷不出几十个窗口）', !!wikiFn && /WIKI_WINDOW_LIMIT/.test(wikiFn[0]))
  check('S7 同一路径复用窗口而不是每次新开', !!wikiFn && /existing\.show\(\)/.test(wikiFn[0]) && /reused: true/.test(wikiFn[0]))
  check('S7 走既有窗口配方（sandbox + contextIsolation + 无 nodeIntegration + hardenWindow）',
    !!wikiFn && /nodeIntegration: false/.test(wikiFn[0]) && /contextIsolation: true/.test(wikiFn[0])
    && /sandbox: true/.test(wikiFn[0]) && /hardenWindow\(w\)/.test(wikiFn[0]))
  check('S7 内核重启/装更新时收掉档案窗口（端口换了旧地址已死）',
    /closeWikiWindows\(\)/.test(mainSrc) && /function closeWikiWindows\(\)/.test(mainSrc)
    && (mainSrc.match(/closeWikiWindows\(\)/g) || []).length >= 2)
  check('S7 未授权前插件仍拿不到 window.open（弹窗闸未松动）',
    /setWindowOpenHandler\(\(\{ url \}\)[\s\S]{0,220}?action: 'deny'/.test(mainSrc))

  /* ── S8 · 同源判据：非标准协议的 origin 是 "null"，不能拿 .origin 直接比 ── */
  const { originKey, sameOrigin } = require('./url-origin')
  check('S8 dsh-app: 的 URL.origin 确实是 "null"（这条 bug 的根因，钉住平台行为）',
    new URL('dsh-app://app/api/writing-mode').origin === 'null')
  check('S8 originKey 对 dsh-app 给出可用键，带不带路径都一样',
    originKey('dsh-app://app') === 'dsh-app://app'
    && originKey('dsh-app://app/') === 'dsh-app://app'
    && originKey('dsh-app://app/api/writing-mode?route=wiki&path=x') === 'dsh-app://app')
  check('S8 originKey 对 http 与 WHATWG origin 同形（旧直连方式行为不变）',
    originKey('http://127.0.0.1:4567/?token=abc') === 'http://127.0.0.1:4567'
    && originKey('http://127.0.0.1:4567') === new URL('http://127.0.0.1:4567').origin)
  check('S8 同协议不同 host / 不同协议都不算同源',
    sameOrigin('dsh-app://app/a', 'dsh-app://app/b') === true
    && sameOrigin('dsh-app://app', 'http://127.0.0.1:9') === false
    && sameOrigin('dsh-app://app', 'dsh-app://evil') === false)
  check('S8 解析失败与空值一律不同源（宁严不松）',
    originKey('not a url') === '' && sameOrigin('', 'dsh-app://app') === false
    && sameOrigin(undefined, undefined) === false)
  check('S8 file: 塌缩成同一键，所以 isKernelPageUrl 不放 file（本地页另走 isAppFileUrl）',
    originKey('file:///C:/x/y.html') === 'file://'
    && !/isAppFileUrl\(url\)/.test(/function isKernelPageUrl[\s\S]{0,500}?\n}/.exec(mainSrc)?.[0] || ''))
  check('S8 main.js 的 isKernelPageUrl 走 originKey，不再直接比 u.origin',
    /function isKernelPageUrl\(url\)[\s\S]{0,400}?originKey\(url\)/.test(mainSrc)
    && !/function isKernelPageUrl[\s\S]{0,400}?u\.origin === APP_ORIGIN/.test(mainSrc))
  check('S8 新模块已随包发布（build.files 含 lib/*.js）', /"lib\/\*\.js"/.test(src('package.json')))

  /* ── 附带：这两处新逻辑必须是零 Electron 依赖，才能被普通 node 单测 ─────── */
  check('新模块不依赖 electron',
    !/require\('electron'\)/.test(src('lib/shell-quote.js')) && !/require\('electron'\)/.test(src('lib/ndjson-tail.js')))
  check('新模块已随包发布（build.files 含 lib/*.js）', /"lib\/\*\.js"/.test(src('package.json')))

  /* ── S9 · 工作台窗口形态通道（2026-10-12 获准改外壳）：只收枚举、只认内核页面、不污染窗口记忆 ── */
  const shapeHandler = handlerSource('shell:set-workbench-shape', 1600)
  check('S9 set-workbench-shape 有发送方校验（非内核页面主帧直接拒）', /isKernelPageSender\(event\)/.test(shapeHandler))
  check('S9 未知档位被枚举挡掉（不落到 applyWorkbenchShape）', /WORKBENCH_SHAPES\.includes\(next\)/.test(shapeHandler))
  check('S9 四条形态通道与关窗通道都过同一道发送方闸',
    ['shell:set-workbench-shape', 'shell:get-workbench-shape', 'shell:set-workbench-strip-on-top', 'shell:set-workbench-splice', 'shell:close-window']
      .every((c) => /isKernelPageSender\(event\)/.test(handlerSource(c, 1600))))
  check('S9 `✕` 只复用既有关窗语义（win.close），页面拿不到 quit/hide 这类越权通道',
    /shell:close-window[\s\S]{0,600}?win\.close\(\)/.test(mainSrc) &&
      !/ipcMain\.handle\('shell:(quit|hide-window|minimize-window)'/.test(mainSrc))
  check('S9 页面传不进任意几何：preload 只发档位字符串',
    /setWorkbenchShape: \(shape\) => ipcRenderer\.invoke\('shell:set-workbench-shape', String\(shape \?\? ''\)\)/.test(src('preload.js')))
  check('S9 反例守卫：preload 的形态接口里没有任何 x/y/height 参数（拼接只允许发宽度这一个标量）',
    !/(setWorkbenchShape|setWorkbenchStripOnTop)[^\n]*?(width|height|\bx\b|\by\b)/.test(src('preload.js')) &&
      /setWorkbenchSplice: \(width\) => ipcRenderer\.invoke\('shell:set-workbench-splice', Number\(width\)\)/.test(src('preload.js')) &&
      // 拼接通道**只**接受一个数：不许出现坐标/尺寸对象
      !/setWorkbenchSplice[^\n]*?(x:|y:|height)/.test(src('preload.js')))
  // 拼接宽度必须**有界**（0 = 收起，或 SPLICE_MIN..spliceMax()），越界夹住——页面拿不到任意几何。
  // 上限随显示器工作区算（多模式同时拼要更宽，写死 760 不够），但仍是**一个标量**。
  const spliceHandler = handlerSource('shell:set-workbench-splice', 2400)
  check('S9 拼接宽度是有界标量（0 或 280 到工作区上限，越界夹住）',
    /SPLICE_MIN = 280/.test(mainSrc) && /SPLICE_HARD_MAX = 1200/.test(mainSrc) &&
      /function spliceMax\(\)/.test(mainSrc) &&
      /area\.width - SHAPE_GEOMETRY\.strip\.width - 32/.test(mainSrc) &&
      /Math\.max\(SPLICE_MIN, Math\.min\(spliceMax\(\), Math\.round\(value\)\)\)/.test(spliceHandler) &&
      /value <= 0 \? 0/.test(spliceHandler))
  check('S9 拼接几何由主进程算（页面不发 x/y/height）',
    /const splice = shape === 'strip' \? currentSplice\(\) : 0/.test(mainSrc) &&
      /x: mem\.x - splice/.test(mainSrc))
  const saveSrc = src('main.js').match(/const scheduleSaveBounds = \(\) => \{[\s\S]{0,1400}?\n  \}/)?.[0] || ''
  check('S9 形态期间不再写 windowBounds（改存 workbenchShapeBounds，且防抖到点再判一次形态）',
    /currentShape\(\) !== 'normal'/.test(saveSrc) &&
      /workbenchShapeBounds/.test(saveSrc) &&
      /if \(!win \|\| win\.isDestroyed\(\) \|\| currentShape\(\) !== 'normal'\) return/.test(saveSrc))
  check('S9 normal 形态一律不置顶（置顶只属于条状）', /const onTop = shape !== 'normal' && settings\.workbenchStripOnTop !== false/.test(src('main.js')))
  // 形态是门面申请的，而"主屏开着"只活在内存里：重启后没人申请形态，若还留着 strip，
  // currentShape() 就与实际窗口说谎，scheduleSaveBounds 会因此永远不写 windowBounds（窗口记忆冻住）。
  const createWinSrc = mainSrc.match(/function createWindow\(\) \{[\s\S]{0,900}?\n  const bounds/)?.[0] || ''
  check('S9 形态不跨过重启说谎：启动把非 normal 的 workbenchShape 落回 normal',
    /settings\.workbenchShape !== 'normal'/.test(createWinSrc) &&
      /settings\.workbenchShape = 'normal'/.test(createWinSrc),
    `createWindow 前 900 字节里找得到复位：${createWinSrc.length > 0}`)
  check('S9 长条确实能把最小尺寸放开（能力不是空壳：980 → 320）',
    /normal: \[980, 640\], strip: \[320, 320\]/.test(src('main.js')))
  // 置顶的三条纪律（2026-10-12 真机实测：level 用 'floating' 或省略 ⇒ OS 的 WS_EX_TOPMOST 根本不置位，
  // 而门禁读自报值一路绿；一次调用还有概率整个窗口生命周期都不落地）。
  const topmostCalls = (mainSrc.match(/\.setAlwaysOnTop\(/g) || []).length
  check('S9 置顶只用会真正置位的 level（screen-saver / pop-up-menu），申请后读 OS 真值复核、没落地按表补刀',
    // 2026-10-13 更新：实现从"单 level + 1500ms 阶梯"升级成"两个会置位的 level 轮换 + 更长阶梯 +
    // 有界落地复核 + 同一窗口只留最新意图 + 后几刀 toggle kick"（连续切形态时旧阶梯会把新位清掉，
    // 且自报值会撒谎，见踩坑 #33/#38）。断言钉**不变量**，不钉具体毫秒数：
    /const TOPMOST_LEVELS = \['screen-saver', 'pop-up-menu'\]/.test(mainSrc) &&
      /target\.setAlwaysOnTop\(want, TOPMOST_LEVELS\[i % TOPMOST_LEVELS\.length\]\)/.test(mainSrc) &&
      // 自报值只当线索（`const selfSays = ...`），不当提前收手的判据
      /const selfSays = target\.isAlwaysOnTop\(\) === want/.test(mainSrc) &&
      /const TOPMOST_RETRY_MS = \[[0-9, ]+\]/.test(mainSrc) &&
      // 阶梯必须递增（否则"补刀"会在原地打转）
      (mainSrc.match(/const TOPMOST_RETRY_MS = \[([0-9, ]+)\]/)?.[1] || '')
        .split(',')
        .map((n) => Number(n.trim()))
        .every((n, i, arr) => i === 0 || n > arr[i - 1]) &&
      // 同一窗口只保留最新一次意图：新申请要取消旧的 token + 定时器
      /prev\.token\.cancelled = true/.test(mainSrc) &&
      /for \(const t of prev\.timers\) clearTimeout\(t\)/.test(mainSrc))
  // 反例守卫（2026-10-13 收紧口径）：`setAlwaysOnTop` 只允许出现在 `enforceTopmost` **函数体内**
  // （阶梯一刀 + 复核/踢一脚各一刀，都是同一套复核逻辑）；函数外再冒出一处就是绕开复核。
  const topmostFn = mainSrc.match(/function enforceTopmost\(target, want, label\) \{[\s\S]*?\n\}/)?.[0] || ''
  const topmostInFn = (topmostFn.match(/\.setAlwaysOnTop\(/g) || []).length
  check('S9 反例守卫：setAlwaysOnTop 只出现在 enforceTopmost 函数体内（别绕开复核）',
    topmostInFn >= 1 && topmostInFn === topmostCalls, `函数内 ${topmostInFn} 处 / 全文件 ${topmostCalls} 处`)
  check('S9 状态回读把"申请值"和"OS 真值"分开报（只报申请值会骗过门禁）',
    /topmostOs: win && !win\.isDestroyed\(\) \? win\.isAlwaysOnTop\(\) : null/.test(mainSrc))
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
