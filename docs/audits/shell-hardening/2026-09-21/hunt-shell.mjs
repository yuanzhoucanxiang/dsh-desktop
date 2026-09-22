/**
 * 外壳（Electron 桌面版本体）漏洞 hunt 探针 · 2026-09-21
 *
 * 范围：main.js 的 IPC 面 / 通知钩子 / 会话改动流，lib/plugin-manager.js 的 YAML 行级手术，
 *       plugin/review-bridge.js 的回退端点。不含 writing-mode 插件（见 ../writing-hardening/）。
 *
 * 不启动 Electron、不结束任何进程、不碰真实安装与用户工作区：全部在 %TEMP% 隔离目录内。
 * S1/S5/S6 用源码形状取证（main.js 是 Electron 入口，无法在纯 Node 里 import），
 * S3/S4 是**真实功能复现**（真 spawn 真 shell / 真调用 setEntryDisabled）。
 *
 * REPRODUCED = 缺陷已复现。跑法：node docs/audits/shell-hardening/2026-09-21/hunt-shell.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-shell-hunt-'))
const results = []
function finding(id, title, reproduced, evidence) {
  results.push({ id, title, reproduced })
  console.log(`${reproduced ? 'REPRODUCED' : 'NOT_REPRODUCED'} ${id} ${title}`)
  for (const line of evidence) console.log(`    ${line}`)
}

// ─────────────────────────────────────────────────────────────
// S1 · shell:notify-command = 渲染侧零确认拿到本机命令执行
//      与外壳自己对 open-file / quit / restart-kernel / update-install 的明文策略相矛盾
// ─────────────────────────────────────────────────────────────
{
  const main = src('main.js')
  const preload = src('preload.js')

  // 桥是否无条件暴露给所有用该 preload 的窗口（含承载第三方插件 client 代码的内核页面）
  const bridgeUnconditional = /contextBridge\.exposeInMainWorld\('dshShell'/.test(preload)
    && !/senderFrame|BrowserWindow\.fromWebContents/.test(preload)
  const exposesNotify = /notifyCommand:\s*\(cmd\)\s*=>\s*ipcRenderer\.invoke\('shell:notify-command'/.test(preload)
    && /notifyCommandTest:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('shell:notify-command-test'/.test(preload)

  // 取每个 handler 的源码片段，看有没有确认框 / 发送方校验
  const handlerOf = (channel) => {
    const i = main.indexOf(`ipcMain.handle('${channel}'`) >= 0 ? main.indexOf(`ipcMain.handle('${channel}'`) : main.indexOf(`ipcMain.on('${channel}'`)
    if (i < 0) return ''
    return main.slice(i, i + 900)
  }
  const gated = (channel) => {
    const h = handlerOf(channel)
    return { has: h.length > 0, confirm: /await confirm\(|dialog\.showMessageBox/.test(h), sender: /isSettingsSender|fromWebContents|senderFrame/.test(h) }
  }
  const notify = gated('shell:notify-command')
  const notifyTest = gated('shell:notify-command-test')
  const quit = gated('shell:quit')
  const restart = gated('shell:restart-kernel')
  const install = gated('shell:update-install')

  // 命令怎么被执行
  const runsWithShell = /spawn\(cmd, \{\s*shell: true/.test(main)
  const persists = /settings\.notifyCommand = String\(cmd/.test(main) && /if \(settings\.notifyCommand\) runNotifyHook\(files\)/.test(main)

  finding(
    'S1',
    'shell:notify-command / -test 让内核页面里的任意插件 JS 零确认拿到本机命令执行（且持久化、每回合重放）',
    notify.has && !notify.confirm && !notify.sender && notifyTest.has && !notifyTest.confirm && runsWithShell && bridgeUnconditional && exposesNotify,
    [
      `preload 无条件 exposeInMainWorld('dshShell') 且不做发送方/窗口区分 → ${bridgeUnconditional}`,
      `桥里暴露 notifyCommand / notifyCommandTest → ${exposesNotify}`,
      `main.js runNotifyHook 用 spawn(cmd, { shell: true, detached: true }) → ${runsWithShell}`,
      `写入即持久化并在每个回合结束重放 → ${persists}`,
      `shell:notify-command       确认框=${notify.confirm} 发送方校验=${notify.sender}`,
      `shell:notify-command-test  确认框=${notifyTest.confirm} 发送方校验=${notifyTest.sender}`,
      `对照 shell:quit            确认框=${quit.confirm}（源码注释：「无确认等于让 XSS/恶意插件一键杀掉用户正在用的会话」）`,
      `对照 shell:restart-kernel  确认框=${restart.confirm}`,
      `对照 shell:update-install  确认框=${install.confirm}`,
      '对照 shell:open-file：源码注释「openPath 会按系统关联直接执行 .bat/.cmd/.exe/.js…任何插件 JS 调 openFile 即可触发执行」→ 已改 showItemInFolder',
      '结论：外壳自己把「内核页面任何插件 JS 都能调这些 IPC」定为威胁模型并逐个收口，唯独漏了唯一一个能直接跑任意命令串的入口',
      '威胁主体是**client 侧**插件（跑在沙箱渲染进程、无 Node）与内核页面 XSS；host 侧插件本来就有 Node，不靠这条',
    ]
  )
}

// ─────────────────────────────────────────────────────────────
// S3 · {cwd}/{workspace} 未加引号就拼进 shell:true 的命令串
//      → 工作区路径里的 & | > 等会被 cmd.exe 当命令分隔符（真功能复现）
// ─────────────────────────────────────────────────────────────
{
  const marker = path.join(temp, 'S3_PWNED')
  // 目录名里带 & 与一条 node 命令。Windows 目录名不能含 : \ / " ，
  // 所以载荷放在工作区目录**内部**，靠 spawn 的 cwd 相对解析。
  const cwd = path.join(temp, 'ws & node s3-payload.js')
  fs.mkdirSync(cwd, { recursive: true })
  fs.writeFileSync(path.join(cwd, 's3-payload.js'), `require('fs').writeFileSync(${JSON.stringify(marker)}, '1')\n`, 'utf8')

  // 走生产的替换实现（lib/shell-quote）：修复后应把路径引起来，& 后面的载荷不再执行
  const { expandNotifyCommand } = require(path.join(ROOT, 'lib/shell-quote.js'))
  const raw = 'echo hook {cwd}'
  const cmd = expandNotifyCommand(raw, { files: 0, cwd })
  const naive = raw.replaceAll('{files}', '0').replaceAll('{cwd}', cwd).replaceAll('{workspace}', cwd)

  await new Promise((resolve) => {
    const child = spawn(cmd, { shell: true, cwd, detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
    child.on('exit', () => resolve())
    child.on('error', () => resolve())
    setTimeout(resolve, 4000)
  })
  await new Promise((r) => setTimeout(r, 400))
  const executed = fs.existsSync(marker)

  finding(
    'S3',
    'notifyCommand 的 {cwd}/{workspace} 未做 shell 引号处理：工作区路径里的 & 会把后半段当独立命令执行',
    executed,
    [
      `工作区路径 = ${cwd}`,
      `用户配置的命令 = ${JSON.stringify(raw)}`,
      `旧写法（裸拼）交给 shell 的命令串 = ${naive}`,
      `生产实现 expandNotifyCommand 的输出 = ${cmd}`,
      `路径里 & 之后的 node 载荷是否被执行（生成 S3_PWNED）= ${executed}`,
      '影响：一是安全（路径可由「设置工作目录」选定，也可来自 DSH_DESKTOP_CWD 环境变量）；',
      '      二是正确性——含 & 的合法路径会让钩子静默跑错命令，用户只看到 echo 的输出不见了',
    ]
  )
}

// ─────────────────────────────────────────────────────────────
// S4 · setEntryDisabled 把 entry id 原样插值进 YAML（无引号、无换行校验）
//      → 一个含换行的 id 能改写 profile 补丁结构，之后所有开关都被"无法解析"挡死
// ─────────────────────────────────────────────────────────────
{
  const { setEntryDisabled, parsePatchList } = require(path.join(ROOT, 'lib/plugin-manager.js'))
  const file = path.join(temp, 'cordis.patch.yml')

  // id 来自插件自己的 dsh.bundle.patch（entryIdsFromBundlePatch 只做去引号），插件可自控
  const evilId = "evil\n  disabled: true\n- id: hijacked\n  name: '@attacker/pkg'"
  const first = setEntryDisabled(file, evilId, true)
  const written = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const parsed = parsePatchList(written)
  const ids = parsed.ok ? parsed.entries.map((e) => e.id) : []
  const injectedEntry = ids.includes('hijacked')

  // 第二个 payload：写出解析器不认的形状，看是否把整个开关功能锁死
  const file2 = path.join(temp, 'cordis-2.patch.yml')
  const breakingId = 'evil2\n      bad: [unclosed'
  const second = setEntryDisabled(file2, breakingId, true)
  const written2 = fs.existsSync(file2) ? fs.readFileSync(file2, 'utf8') : ''
  const parsed2 = parsePatchList(written2)
  const afterBroken = setEntryDisabled(file2, 'dsh-better-sidebar', true)

  finding(
    'S4',
    'setEntryDisabled 把 entry id 原样插值进 YAML（无引号、无换行校验）：能注入额外补丁条目，也能写出解析不了的形状把开关功能锁死',
    (first.ok === true && injectedEntry) || (second.ok === true && !parsed2.ok && afterBroken.ok === false),
    [
      `payload A = ${JSON.stringify(evilId)}`,
      `  setEntryDisabled → ok=${first.ok}；落盘后 parsePatchList ok=${parsed.ok}，解析出的 id=${JSON.stringify(ids)}`,
      `  注入的额外条目是否生效（id=hijacked + name=@attacker/pkg）= ${injectedEntry}`,
      `payload B = ${JSON.stringify(breakingId)}`,
      `  setEntryDisabled → ok=${second.ok}；落盘后 parsePatchList ok=${parsed2.ok} error=${JSON.stringify(parsed2.error)}`,
      `  此后对正常插件的开关 → ok=${afterBroken.ok} error=${JSON.stringify(afterBroken.error)}`,
      `  落盘内容：\n${written2.split('\n').map((l) => '        | ' + l).join('\n')}`,
      '定性：**不是权限提升**（id 来自 host 侧插件自己的 bundle patch，而 host 插件本来就有 Node）；',
      '      但它是对外壳自己「解析不了就拒写、宁可不给开关也不毁手工编辑」承诺的绕过：',
      '      一个 id 就能把未经解析器审查的结构写进决定内核加载什么的 profile 补丁文件',
    ]
  )
}

// ─────────────────────────────────────────────────────────────
// S6 · readSessionChanges 无上限：整份 NDJSON 读进内存 + 逐行 parse + 整体过 IPC，
//      而流里每条 tool-call 都带 new:<整个文件内容>
// ─────────────────────────────────────────────────────────────
{
  const main = src('main.js')
  const bridge = src('plugin/review-bridge.js')

  // 只取 readSessionChanges 函数体来判，避免全文正则被其它地方的 slice/truncated 干扰
  const fnAt = main.indexOf('function readSessionChanges()')
  const fnBody = fnAt >= 0 ? main.slice(fnAt, fnAt + 700) : ''
  const readsWholeFile = /fs\.readFileSync\(state\.reviewStreamPath, 'utf8'\)/.test(fnBody)
  const returnsAll = /return \{ ok: true, entries \}/.test(fnBody)
  const noCap = !/slice\(-|MAX_|truncated|byteLength|statSync/.test(fnBody)
  const streamCarriesFullContent = /new: \(a\.new_string !== undefined \? a\.new_string : \(a\.new_str !== undefined \? a\.new_str : a\.content\)\) \?\? null/.test(bridge)
  const onlyTruncatedAtKernelStart = /fs\.rmSync\(streamFile, \{ force: true \}\)/.test(main)

  // 机理演示：按 review-bridge 的真实载荷形状造一份流，跑与 readSessionChanges 相同的代码
  const streamFile = path.join(temp, 'review-events.ndjson')
  const bigFile = 'x'.repeat(400 * 1024) // 一次 write 工具的完整文件内容
  const lines = []
  for (let i = 0; i < 20; i++) {
    lines.push(JSON.stringify({ kind: 'tool-call', seq: i, session: 's1', turn: i, name: 'write', file: `chapter-${i}.md`, old: null, new: bigFile }))
  }
  fs.writeFileSync(streamFile, lines.join('\n') + '\n', 'utf8')
  const bytes = fs.statSync(streamFile).size
  const t0 = Date.now()
  const raw = fs.readFileSync(streamFile, 'utf8')
  const entries = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const ipcPayload = Buffer.byteLength(JSON.stringify(entries))
  const ms = Date.now() - t0

  finding(
    'S6',
    '会话改动流无上限：每条 write 记录整个文件内容，readSessionChanges 每次刷新都全量读+parse+过 IPC',
    readsWholeFile && returnsAll && noCap && streamCarriesFullContent && onlyTruncatedAtKernelStart,
    [
      `review-bridge 的 tool-call 载荷带 new:<完整文件内容> → ${streamCarriesFullContent}`,
      `readSessionChanges 函数体：全量 readFileSync=${readsWholeFile} 全量返回=${returnsAll} 无任何上限/截断=${noCap}`,
      `流文件只在内核启动时 rmSync 一次，会话期间单调增长 → ${onlyTruncatedAtKernelStart}`,
      `机理演示：20 次 400KB 写入 → 流 ${(bytes / 1048576).toFixed(1)}MB，一次 readSessionChanges 读+parse 耗时 ${ms}ms，IPC 载荷 ${(ipcPayload / 1048576).toFixed(1)}MB`,
      '后果：长会话 + 大文件的 agent 工作会让审阅面板每次刷新都搬运几十上百 MB（主进程与渲染侧双份内存），',
      '      界面卡顿乃至 OOM；而回退功能其实**不依赖**这份流（bridge 用自己内存里的 session events 查 callId）',
    ]
  )
}

// ─────────────────────────────────────────────────────────────
// S5 · review-bridge 回退端点不限请求体大小（同仓库的 writing-mode 却限了 1 MiB）
// ─────────────────────────────────────────────────────────────
{
  const bridge = src('plugin/review-bridge.js')
  const writing = src('plugin/writing-mode/index.js')
  const bridgeUncapped = /for await \(const chunk of req\) chunks\.push\(chunk\)/.test(bridge)
    && !/MAX_BODY|content-length|413/.test(bridge)
  const writingCapped = /MAX_BODY_BYTES/.test(writing)

  finding(
    'S5',
    'review-bridge 的 /revert 端点无请求体上限（本机任意进程可 POST 巨体撑爆内核内存），而同仓库 writing-mode 已限 1 MiB',
    bridgeUncapped && writingCapped,
    [
      `review-bridge 用 for await 收集全部 chunk 且无上限/无 413 → ${bridgeUncapped}`,
      `对照 writing-mode/index.js 有 MAX_BODY_BYTES 上限 → ${writingCapped}`,
      '已有回环闸（isLoopbackRequest）挡住了远程，但本机任意进程/浏览器标签页都能 POST',
      '危害有限（需要本机攻击者）但修复只要三行，且与自家另一处口径不一致',
    ]
  )
}

// ─────────────────────────────────────────────────────────────
// S2 · shell:plugins-restore 内部会重启内核，却不需要确认；
//      而 shell:restart-kernel 明文要求确认（同一效果，两道门一道没锁）
// ─────────────────────────────────────────────────────────────
{
  const main = src('main.js')
  const i = main.indexOf("ipcMain.handle('shell:plugins-restore'")
  const h = i >= 0 ? main.slice(i, i + 500) : ''
  const noConfirm = h.length > 0 && !/await confirm\(|dialog\.showMessageBox/.test(h)
  const restartsKernel = /restoreQuarantinedBundles[\s\S]{0,1200}?restartKernel\(/.test(main)
  const restartGated = /ipcMain\.on\('shell:restart-kernel'[\s\S]{0,400}?await confirm\(/.test(main)

  finding(
    'S2',
    'shell:plugins-restore 会重启内核却不弹确认，等于绕过 shell:restart-kernel 的确认门（内核页面任意插件 JS 可一键中断用户会话）',
    noConfirm && restartsKernel && restartGated,
    [
      `shell:plugins-restore handler 里有确认框 → ${!noConfirm}`,
      `restoreQuarantinedBundles 路径最终调用 restartKernel → ${restartsKernel}`,
      `shell:restart-kernel 有确认框 → ${restartGated}（源码注释：无确认等于让 XSS/恶意插件一键杀掉用户正在用的会话）`,
      '附带：它还会把此前因崩溃被自动隔离的插件重新启用，属于"可能再次搞崩内核"的操作，同样无确认',
    ]
  )
}

console.log('\n=== 汇总 ===')
console.log(`隔离目录：${temp}`)
console.log(`复现 ${results.filter((r) => r.reproduced).length} / ${results.length}`)
for (const r of results) console.log(`  ${r.reproduced ? '[REPRODUCED]' : '[  clean   ]'} ${r.id} ${r.title}`)
console.log('SHELL_HUNT_DONE')
