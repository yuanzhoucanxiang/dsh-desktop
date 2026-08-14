'use strict'

/**
 * DeepSeek Harness Desktop —— 快捷启动外壳（Electron main 进程）
 *
 * 职责边界：本文件只做"外壳"该做的事，绝不修改内核：
 *   1. 找到一个空闲端口，把 `dsh web --port <port>` 作为子进程拉起
 *   2. 探测内核 HTTP 就绪，期间展示启动画面（splash）
 *   3. 就绪后用原生窗口承载内核页面，附托盘、单实例、外链接管
 *   4. 退出/崩溃时负责进程树收尾与"重启内核"恢复入口
 *   5. 外壳设置持久化：窗口位置/大小、工作目录、开机自启、关闭到托盘
 *
 * 可用的环境开关（全部可选）：
 *   DSH_LAUNCHER     内核入口 bin.js 的完整路径（默认自动从 npm root -g 解析）
 *   DSH_DESKTOP_HOME 桌面实例专属 DSH_HOME（默认与 CLI 共享 ~/.dsh）
 *   DSH_DESKTOP_CWD  内核工作目录（优先于设置里的"工作目录"）
 */

const {
  app, BrowserWindow, Tray, Menu, ipcMain, shell,
  nativeImage, nativeTheme, clipboard, dialog, screen,
} = require('electron')
// 注意：autoUpdater 来自 electron-updater 包（支持 {provider:'github'|'generic'}），
// 不是 Electron 内置的 autoUpdater（内置只接受 {url}，二者 API 不兼容）。
const { autoUpdater } = require('electron-updater')
const { spawn, spawnSync, execFileSync } = require('node:child_process')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')

const isWin = process.platform === 'win32'
const SMOKE = process.argv.includes('--smoke') // 冒烟测试：完成"拉起→就绪"后打印结果并退出
const UI_SMOKE = process.argv.includes('--ui-smoke') // UI 冒烟：真实窗口验证侧边栏注入/开关/拖拽/查看器
const DEV = process.argv.includes('--dev')

const APP_NAME = 'DeepSeek Harness Desktop'
const SPLASH_PATH = path.join(__dirname, 'renderer', 'splash.html')
const ICON_PATH = path.join(__dirname, 'build', 'icon.png')
const READY_TIMEOUT_MS = 120000

/** @type {BrowserWindow | null} */
let win = null
/** @type {Tray | null} */
let tray = null

const state = {
  port: 0,
  url: '',
  child: null,
  ready: false,
  restarting: false,
  quitting: false,
  phase: 'boot',
  message: '正在初始化…',
  lastError: '',
  elapsedMs: 0,
  logTail: [],
  logStream: null,
  logPath: '',
  reviewStreamPath: '',
  patchMode: 'full', // 内核补丁模式：full=审阅桥+内置插件 / bridge=仅审阅桥 / none=无补丁
}

/* ─────────────────────────────── 设置持久化 ───────────────────────────────── */

const DEFAULT_UPDATE_REPO = 'yuanzhoucanxiang/dsh-desktop' // 默认 GitHub 更新源（owner/repo）

const DEFAULT_SETTINGS = {
  autoLaunch: false,      // 开机自启
  closeToTray: true,      // 关闭窗口时最小化到托盘（而非退出）
  workspace: '',          // 内核工作目录；空 = 用默认（主目录）
  windowBounds: null,     // { x, y, width, height, maximized }
  updateRepo: '',         // GitHub 更新源 owner/repo（空 = 用 DEFAULT_UPDATE_REPO）
  updateUrl: '',          // generic 更新源 URL（优先级低于 updateRepo）
  panelWidth: 360,        // 审阅侧边栏宽度（用户拖拽调整后持久化）
}

let settings = loadSettings()

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8')
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2))
  } catch (err) {
    log(`save settings failed: ${err.message}`)
  }
}

function kernelCwd() {
  if (process.env.DSH_DESKTOP_CWD) return process.env.DSH_DESKTOP_CWD
  if (settings.workspace && fs.existsSync(settings.workspace)) return settings.workspace
  return os.homedir()
}

/* ─────────────────────────────── 修改审阅（git） ───────────────────────────── */

/** 在工作目录里跑 git；失败返回 null（如"不是仓库"）。 */
function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: kernelCwd(),
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

function isGitRepo() {
  const r = git(['rev-parse', '--is-inside-work-tree'])
  return !!r && r.trim() === 'true'
}

/** 在当前工作目录初始化 git 仓库（仅当还不是仓库时）。 */
function gitInit() {
  if (isGitRepo()) return { ok: true, already: true }
  const r = git(['init', '-q'])
  return { ok: r !== null, already: false }
}

/** 解析 git status --porcelain=v1：XY <path>（重命名为 XY <old> -> <new>）。 */
function parseStatus(out) {
  const files = []
  for (const line of String(out).split(/\r?\n/)) {
    if (!line) continue
    const xy = line.slice(0, 2)
    const rest = line.slice(3)
    const p = rest.includes(' -> ') ? rest.split(' -> ')[1] : rest
    files.push({ status: xy, path: p })
  }
  return files
}

function fileDiff(p) {
  const unstaged = git(['diff', '--', p]) || ''
  const staged = git(['diff', '--cached', '--', p]) || ''
  return unstaged + (staged && staged !== unstaged ? staged : '')
}

function collectChanges() {
  const workspace = kernelCwd()
  if (!isGitRepo()) return { isGit: false, workspace, files: [] }
  const statusOut = git(['status', '--porcelain=v1']) || ''
  const files = parseStatus(statusOut).map((f) => ({
    path: f.path,
    status: f.status,
    untracked: f.status === '??',
    diff: f.status === '??' ? '' : fileDiff(f.path),
  }))
  return { isGit: true, workspace, files }
}

function revertFile(p, untracked) {
  if (untracked) {
    const fp = path.join(kernelCwd(), p)
    try { fs.rmSync(fp, { force: true }); return true } catch { return false }
  }
  const r = git(['restore', '--staged', '--worktree', '--', p])
  return r !== null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function log(line) {
  const text = String(line).replace(/\s+$/, '')
  if (!text) return
  state.logTail.push(text)
  if (state.logTail.length > 80) state.logTail.shift()
  try {
    if (!state.logStream) {
      const logDir = app.getPath('userData')
      fs.mkdirSync(logDir, { recursive: true })
      state.logPath = path.join(logDir, 'kernel.log')
      state.logStream = fs.createWriteStream(state.logPath, { flags: 'a' })
    }
    state.logStream.write(`[${new Date().toISOString()}] ${text}\n`)
  } catch {}
}

function setStatus(phase, message) {
  state.phase = phase
  state.message = message
  if (win && !win.isDestroyed()) {
    win.webContents.send('shell:status', {
      phase, message, port: state.port, url: state.url, elapsedMs: state.elapsedMs,
    })
  }
}

/* ─────────────────────────────── 内核进程管理 ─────────────────────────────── */

/** 自包含运行时根目录：打包后=resources/runtime，开发=项目下 runtime/。 */
function runtimeRoot() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'runtime')
  return path.join(__dirname, 'runtime')
}

/* ─────────────────────────────── 审阅桥（会话改动） ───────────────────────── */

/** 审阅桥插件根目录：打包后=resources/plugin，开发=项目下 plugin/。 */
function pluginRoot() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'plugin')
  return path.join(__dirname, 'plugin')
}

/** 内核 DSH_HOME：与 kernelEnv() 的判定保持一致（桌面专属优先，其次环境，最后默认 ~/.dsh）。 */
function dshHome() {
  if (process.env.DSH_DESKTOP_HOME) return process.env.DSH_DESKTOP_HOME
  if (process.env.DSH_HOME) return process.env.DSH_HOME
  return path.join(os.homedir(), '.dsh')
}

/**
 * 把内置 dialog-optimize 插件同步到内核可解析的位置：
 *   $DSH_HOME/profiles/node_modules/@dsh-local/dialog-optimize/
 * 内核 profile 的裸包名从 profile 目录向上解析（healProfilesModuleFallback 已在该
 * 目录为 @deepseek-ai/* 建好链接），客户端插件表（dsh-client-modules）用同一解析
 * 锚点读 dsh.client 声明，所以 host/client 两半都从这里加载。
 * 内容相同则跳过（不扰动 mtime）；返回插件文件是否可用。
 */
function syncBuiltinDialogPlugin() {
  const src = path.join(pluginRoot(), 'dialog-optimize')
  if (!fs.existsSync(path.join(src, 'package.json'))) return false
  const dest = path.join(dshHome(), 'profiles', 'node_modules', '@dsh-local', 'dialog-optimize')
  let synced = false
  for (const file of ['package.json', 'index.js', 'client.js']) {
    const s = path.join(src, file)
    const d = path.join(dest, file)
    try {
      if (fs.existsSync(d) && fs.readFileSync(d).equals(fs.readFileSync(s))) continue
      fs.mkdirSync(path.dirname(d), { recursive: true })
      fs.copyFileSync(s, d)
      synced = true
    } catch (err) {
      log(`sync dialog-optimize ${file} failed: ${err.message}`)
    }
  }
  if (synced) log(`dialog-optimize synced to ${dest}`)
  return true
}

/**
 * 用户自己的补丁层里是否已挂载同名插件（$DSH_HOME 级或 profile 级 cordis.patch.yml）。
 * 已存在时不再注入内置行，避免同一插件出现两个 loader 条目（客户端模块表按条目
 * 名去重，重复名会在浏览器侧启动时抛错）。
 */
function userInstalledDialogOptimize() {
  const home = dshHome()
  const candidates = [
    path.join(home, 'cordis.patch.yml'),
    path.join(home, 'profiles', 'web', 'cordis.patch.yml'),
  ]
  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(file, 'utf8')
      if (raw.includes('@dsh-local/dialog-optimize')) return true
    } catch {}
  }
  return false
}

/**
 * 生成内核补丁文件（写入 userData），供内核 --patch 注入：
 *   mode 'full'   → 审阅桥 + 内置 dialog-optimize（默认）
 *   mode 'bridge' → 仅审阅桥（内置插件导致启动失败时的降级）
 * 审阅桥经 file:// URL 引用（Node ESM 在 Windows 不接受裸绝对路径），事件流输出到
 * userData/review-events.ndjson（每次内核启动重置）；dialog-optimize 用裸包名，
 * 由外壳先同步到 $DSH_HOME/profiles/node_modules 再注入。
 * 补丁内容为空时返回 ''（内核不带补丁启动，功能降级）。
 */
function writeKernelPatch(mode) {
  try {
    const dir = app.getPath('userData')
    fs.mkdirSync(dir, { recursive: true })
    const rows = []
    const pluginFile = path.join(pluginRoot(), 'review-bridge.js')
    if (!fs.existsSync(pluginFile)) {
      log('review-bridge plugin not found, running without session review')
    } else {
      const streamFile = path.join(dir, 'review-events.ndjson')
      state.reviewStreamPath = streamFile
      try { fs.rmSync(streamFile, { force: true }) } catch {}
      const url = pathToFileURL(pluginFile).href
      rows.push([
        '- insert:',
        '    - id: review-bridge',
        `      name: '${url}'`,
        '      config:',
        `        out: '${streamFile.replace(/\\/g, '/')}'`,
      ].join('\n'))
    }
    if (mode === 'full' && syncBuiltinDialogPlugin()) {
      if (userInstalledDialogOptimize()) {
        log('dialog-optimize already in user patch layer, skipping builtin row')
      } else {
        rows.push([
          '- insert:',
          '    - id: dialog-optimize',
          "      name: '@dsh-local/dialog-optimize'",
        ].join('\n'))
      }
    }
    if (rows.length === 0) return ''
    const patchFile = path.join(dir, 'kernel.patch.yml')
    const yaml = ['# generated by the desktop shell', ...rows, ''].join('\n')
    fs.writeFileSync(patchFile, yaml)
    log(`kernel patch: ${patchFile}`)
    return patchFile
  } catch (err) {
    log(`writeKernelPatch failed: ${err.message}`)
    return ''
  }
}

function readSessionChanges() {
  if (!state.reviewStreamPath) return { ok: false, entries: [], error: 'no stream' }
  try {
    const raw = fs.readFileSync(state.reviewStreamPath, 'utf8')
    const entries = raw.split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
    return { ok: true, entries }
  } catch (err) {
    return { ok: false, entries: [], error: err.message }
  }
}

/** 解析 dsh 内核入口：优先自带运行时，其次环境变量，最后全局安装。 */
function resolveDshBin() {
  if (process.env.DSH_LAUNCHER && fs.existsSync(process.env.DSH_LAUNCHER)) {
    return process.env.DSH_LAUNCHER
  }
  const bundled = path.join(runtimeRoot(), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (fs.existsSync(bundled)) return bundled
  const candidates = []
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', windowsHide: true }).trim()
    if (root) candidates.push(path.join(root, '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  } catch {}
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return 'dsh' // POSIX 兜底；找不到时 boot 会给出明确报错
}

/** 自带 node 二进制路径：Windows=node.exe，macOS/Linux=bin/node。 */
function bundledNodePath() {
  return path.join(runtimeRoot(), isWin ? 'node.exe' : path.join('bin', 'node'))
}

/** 解析 node 可执行文件：优先自带运行时，其次环境变量，最后 PATH。 */
function resolveNodeExe() {
  if (process.env.DSH_NODE_EXE && fs.existsSync(process.env.DSH_NODE_EXE)) {
    return process.env.DSH_NODE_EXE
  }
  const bundled = bundledNodePath()
  if (fs.existsSync(bundled)) return bundled
  try {
    const out = execFileSync(isWin ? 'where' : 'which', ['node'], { encoding: 'utf8', windowsHide: true }).trim()
    const first = out.split(/\r?\n/)[0].trim()
    if (first && fs.existsSync(first)) return first
  } catch {}
  if (isWin) {
    const p = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe')
    if (fs.existsSync(p)) return p
  }
  return 'node' // POSIX：按 PATH 解析
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

/** 给内核一个干净的环境：剥离本会话的 DSH_* 注入，只保留数据目录与自定义项。 */
function kernelEnv() {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('DSH_') && key !== 'DSH_HOME') delete env[key]
  }
  if (process.env.DSH_DESKTOP_HOME) env.DSH_HOME = process.env.DSH_DESKTOP_HOME
  return env
}

async function startKernel() {
  state.port = await freePort()
  state.url = `http://127.0.0.1:${state.port}`
  const bin = resolveDshBin()
  const isJsLauncher = bin.endsWith('.js')
  const launcher = isJsLauncher ? resolveNodeExe() : bin
  // 注入内核补丁（审阅桥 + 内置 dialog-optimize）；patchMode=none 或插件缺失时不带补丁启动
  const patch = state.patchMode !== 'none' ? writeKernelPatch(state.patchMode) : ''
  const patchArgs = patch ? ['--patch', patch] : []
  const baseArgs = ['--profile', 'web', ...patchArgs, '--port', String(state.port)]
  const args = isJsLauncher ? [bin, ...baseArgs] : baseArgs
  const cwd = kernelCwd()

  log(`launching kernel: ${launcher} ${args.join(' ')} (cwd=${cwd})`)
  setStatus('kernel', '正在拉起 Harness 内核…')

  const child = spawn(launcher, args, {
    env: kernelEnv(),
    cwd,
    windowsHide: true,
    detached: !isWin, // POSIX：独立进程组，便于整树收尾
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  state.child = child

  // spawn 失败（如找不到入口）时快速失败，而不是让就绪探测等满超时
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })

  child.stdout.on('data', (d) => log(d.toString()))
  child.stderr.on('data', (d) => log(d.toString()))
  child.on('error', (err) => {
    log(`kernel spawn error: ${err.message}`)
    if (!state.quitting) {
      state.lastError = `无法启动内核进程：${err.message}`
      win && !win.isDestroyed() && win.webContents.send('shell:boot-error', {
        message: state.lastError,
        logTail: state.logTail.join('\n'),
      })
    }
  })
  child.on('exit', (code, signal) => {
    if (state.quitting) return
    const msg = `内核已退出（code=${code}${signal ? `, signal=${signal}` : ''}）`
    log(msg)
    state.ready = false
    state.lastError = msg
    win && !win.isDestroyed() && win.webContents.send('shell:kernel-status', { alive: false, message: msg })
  })
}

function killChild() {
  const child = state.child
  state.child = null
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  try {
    if (isWin) {
      // 连同内核可能派生的 shell/工具子进程一起收掉
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    } else {
      // POSIX：向整个进程组发信号（detached: true 使子进程为组长）
      try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
      setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
      }, 3000).unref()
    }
  } catch (err) {
    log(`kill kernel failed: ${err.message}`)
  }
}

/* ─────────────────────────────── 就绪探测 ─────────────────────────────────── */

async function probeReady() {
  try {
    const res = await fetch(`${state.url}/`, { signal: AbortSignal.timeout(2500) })
    return res.ok
  } catch {
    return false
  }
}

async function waitReady() {
  const start = Date.now()
  setStatus('wait', `等待服务就绪（127.0.0.1:${state.port}）…`)
  while (Date.now() - start < READY_TIMEOUT_MS) {
    if (state.quitting) throw new Error('启动已取消')
    const c = state.child
    if (c && c.exitCode !== null) {
      throw new Error(`内核提前退出（code=${c.exitCode}${c.signalCode ? `, signal=${c.signalCode}` : ''}）`)
    }
    if (await probeReady()) {
      state.ready = true
      return
    }
    await sleep(500)
  }
  throw new Error(`内核在 ${Math.round(READY_TIMEOUT_MS / 1000)}s 内未就绪`)
}

async function restartKernel() {
  if (state.restarting || state.quitting) return
  state.restarting = true
  try {
    killChild()
    state.ready = false
    await startKernel()
    await waitReady()
    if (win && !win.isDestroyed()) {
      win.webContents.send('shell:kernel-status', { alive: true })
      if (win.webContents.getURL().startsWith('http')) win.webContents.reload()
      else await win.loadURL(state.url)
    }
  } catch (err) {
    log(`restart failed: ${err.message}`)
    state.lastError = err.message
    win && !win.isDestroyed() && win.webContents.send('shell:kernel-status', { alive: false, message: err.message })
  } finally {
    state.restarting = false
  }
}

/* ─────────────────────────────── 窗口 / 托盘 ──────────────────────────────── */

/** 校验已存的窗口 bounds 是否仍落在某个显示器的工作区内。 */
function validBounds(b) {
  if (!b || typeof b.width !== 'number' || typeof b.height !== 'number') return null
  const displays = screen.getAllDisplays()
  const visible = displays.some((d) => {
    const wa = d.workArea
    return b.x < wa.x + wa.width - 40 && b.x + b.width > wa.x + 40 &&
      b.y >= wa.y - 10 && b.y < wa.y + wa.height - 40
  })
  return visible ? b : null
}

function showMainWindow() {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow() {
  const bounds = validBounds(settings.windowBounds)
  win = new BrowserWindow({
    width: bounds?.width || 1360,
    height: bounds?.height || 920,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#070b16', // 与 splash 同色，避免任何白闪
    icon: ICON_PATH,
    title: APP_NAME,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  if (bounds?.maximized) win.maximize()

  // 记住窗口位置/大小（防抖落盘）
  let saveTimer = null
  const scheduleSaveBounds = () => {
    if (!win || win.isDestroyed() || win.isMaximized() || win.isMinimized()) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const b = win.getNormalBounds()
      settings.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: false }
      saveSettings()
    }, 500)
  }
  win.on('resize', scheduleSaveBounds)
  win.on('move', scheduleSaveBounds)
  win.on('maximize', () => { settings.windowBounds.maximized = true; saveSettings() })
  win.on('unmaximize', () => { settings.windowBounds.maximized = false; saveSettings() })

  // 关闭 → 最小化到托盘（可选），真正的退出走托盘"退出"
  win.on('close', (e) => {
    if (state.quitting) return
    if (settings.closeToTray) {
      e.preventDefault()
      win.hide()
    }
  })

  win.webContents.on('before-input-event', (_e, input) => {
    if (DEV && input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools()
    }
  })

  // 外链一律交给系统浏览器，不在应用内打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const isOurs = url.startsWith('file://') || (state.ready && url.startsWith(state.url))
    if (!isOurs) {
      e.preventDefault()
      if (/^https?:/i.test(url)) shell.openExternal(url)
    }
  })

  win.on('closed', () => { win = null })
  return win
}

/** 托盘用官方鲸鱼：深色任务栏用白鲸，浅色用黑鲸。 */
function trayIconPath() {
  const dark = nativeTheme.shouldUseDarkColors
  return path.join(__dirname, 'build', dark ? 'tray-whale-white.png' : 'tray-whale-black.png')
}

function applyAutoLaunch() {
  try {
    app.setLoginItemSettings(app.isPackaged
      ? { openAtLogin: settings.autoLaunch }
      : { openAtLogin: settings.autoLaunch, path: process.execPath, args: [app.getAppPath()] })
  } catch (err) {
    log(`autoLaunch failed: ${err.message}`)
  }
}

/* ─────────────────────────────── 自动更新 ─────────────────────────────────── */

/** 返回更新源描述对象（github 或 generic），未配置则返回 null。 */
function updateFeed() {
  const repo = settings.updateRepo || process.env.DSH_DESKTOP_UPDATE_REPO || DEFAULT_UPDATE_REPO
  if (repo && repo.includes('/')) {
    const [owner, name] = repo.split('/')
    if (owner && name) return { provider: 'github', owner: owner.trim(), repo: name.trim() }
  }
  const url = settings.updateUrl || process.env.DSH_DESKTOP_UPDATE_URL || ''
  if (url) return { provider: 'generic', url }
  return null
}

async function checkForUpdates(manual) {
  if (!app.isPackaged) {
    if (manual) {
      dialog.showMessageBox(win, {
        type: 'info', title: '检查更新', message: '开发模式不支持自动更新',
        detail: '打包安装后，更新功能才会生效。',
      })
    }
    return
  }
  const feed = updateFeed()
  if (!feed) {
    if (manual) {
      dialog.showMessageBox(win, {
        type: 'info', title: '检查更新', message: '未配置更新源',
        detail: '请在设置里配置 updateUrl，或设置环境变量 DSH_DESKTOP_UPDATE_URL。',
      })
    }
    return
  }
  try {
    autoUpdater.setFeedURL(feed)
    const result = await autoUpdater.checkForUpdates()
    if (manual && !result) {
      dialog.showMessageBox(win, { type: 'info', title: '检查更新', message: '当前已是最新版本。' })
    }
  } catch (err) {
    log(`update check failed: ${err.message}`)
    if (manual) {
      dialog.showMessageBox(win, {
        type: 'error', title: '检查更新', message: '检查更新失败', detail: String(err.message),
      })
    }
  }
}

function setupAutoUpdater() {
  if (!app.isPackaged) return
  const feed = updateFeed()
  if (!feed) {
    log('auto-update disabled: no update URL configured (set settings.updateUrl or DSH_DESKTOP_UPDATE_URL)')
    return
  }
  try {
    autoUpdater.setFeedURL(feed)
    autoUpdater.autoDownload = true
    autoUpdater.on('update-available', (info) => log(`update available: ${info.version}`))
    autoUpdater.on('update-downloaded', async (info) => {
      const r = await dialog.showMessageBox(win, {
        type: 'info', buttons: ['立即重启安装', '稍后'], defaultId: 0, cancelId: 1,
        title: '更新已就绪', message: `新版本 ${info.version} 已下载完成。`, detail: '重启应用即可完成安装。',
      })
      if (r.response === 0) {
        state.quitting = true
        killChild()
        autoUpdater.quitAndInstall()
      }
    })
    autoUpdater.on('error', (err) => log(`autoUpdater error: ${err && err.message ? err.message : err}`))
    // 启动后延迟自动检查一次（静默）
    setTimeout(() => { checkForUpdates(false).catch(() => {}) }, 8000)
  } catch (err) {
    log(`auto-update setup failed: ${err && err.message ? err.message : err}`)
  }
}

async function pickWorkspace() {
  const res = await dialog.showOpenDialog(win, {
    title: '选择工作目录（内核启动目录）',
    properties: ['openDirectory'],
  })
  if (res.canceled || !res.filePaths[0]) return
  settings.workspace = res.filePaths[0]
  saveSettings()
  refreshTray()
  // 内核工作目录是启动期事实，立即重启内核让其生效
  if (state.child || state.ready) restartKernel()
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showMainWindow() },
    { type: 'separator' },
    { label: '重启内核', click: () => restartKernel() },
    { label: '设置工作目录…', click: () => pickWorkspace() },
    { label: '打开日志', click: () => shell.openPath(state.logPath || path.join(app.getPath('userData'), 'kernel.log')) },
    { label: '检查更新…', click: () => checkForUpdates(true) },
    { type: 'separator' },
    {
      label: '开机自启', type: 'checkbox', checked: settings.autoLaunch,
      click: (mi) => { settings.autoLaunch = mi.checked; saveSettings(); applyAutoLaunch() },
    },
    {
      label: '关闭时最小化到托盘', type: 'checkbox', checked: settings.closeToTray,
      click: (mi) => { settings.closeToTray = mi.checked; saveSettings() },
    },
    { type: 'separator' },
    { label: '退出', click: () => { state.quitting = true; app.quit() } },
  ])
}

function refreshTray() {
  if (!tray) return
  tray.setContextMenu(buildTrayMenu())
  const ws = settings.workspace ? ` · ${settings.workspace}` : ''
  tray.setToolTip(APP_NAME + ws)
}

function createTray() {
  const icon = nativeImage.createFromPath(trayIconPath())
  tray = new Tray(icon)
  refreshTray()
  tray.on('double-click', () => showMainWindow())
  // 系统深浅色切换时同步托盘鲸鱼颜色
  nativeTheme.on('updated', () => {
    if (tray) tray.setImage(nativeImage.createFromPath(trayIconPath()))
  })
}

/* ─────────────────────────────── IPC（渲染侧） ────────────────────────────── */

function registerIpc() {
  ipcMain.handle('shell:get-state', () => ({
    phase: state.phase,
    message: state.message,
    port: state.port,
    url: state.url,
    elapsedMs: state.elapsedMs,
    workspace: kernelCwd(),
    lastError: state.lastError,
    logTail: state.logTail.join('\n'),
  }))
  ipcMain.handle('shell:changes', () => collectChanges())
  ipcMain.handle('shell:git-init', () => gitInit())
  ipcMain.handle('shell:session-changes', () => readSessionChanges())
  ipcMain.handle('shell:get-panel-width', () => settings.panelWidth || 360)
  ipcMain.handle('shell:set-panel-width', (_e, w) => {
    const n = Math.max(320, Math.min(800, Number(w) || 360))
    settings.panelWidth = n
    saveSettings()
    return n
  })
  ipcMain.handle('shell:open-file', (_e, p) => {
    // 审阅流里的路径多为绝对路径：path.resolve 保证绝对路径原样通过，相对路径按工作目录解析
    const fp = path.resolve(kernelCwd(), String(p))
    return shell.openPath(fp)
  })
  // 面板内文件查看器：读文件内容（UTF-8，上限 512KB，二进制拒绝）
  ipcMain.handle('shell:read-file', (_e, p) => {
    const fp = path.resolve(kernelCwd(), String(p))
    try {
      const stat = fs.statSync(fp)
      if (stat.isDirectory()) return { ok: false, error: '这是一个目录' }
      const MAX = 512 * 1024
      const fd = fs.openSync(fp, 'r')
      const buf = Buffer.alloc(Math.min(stat.size, MAX))
      fs.readSync(fd, buf, 0, buf.length, 0)
      fs.closeSync(fd)
      const head = buf.subarray(0, Math.min(buf.length, 8192))
      if (head.includes(0)) return { ok: false, error: '二进制文件，无法预览' }
      return {
        ok: true,
        path: fp,
        content: buf.toString('utf8'),
        size: stat.size,
        truncated: stat.size > MAX,
      }
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) }
    }
  })
  // 会话改动的单条撤销：代理到内核的审阅桥回退端点（Codex 式 Undo）
  ipcMain.handle('shell:revert-change', async (_e, sessionId, callId) => {
    if (!state.ready || !state.url) return { ok: false, error: '内核未就绪' }
    try {
      const res = await fetch(`${state.url}/api/review-bridge/revert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, callId }),
        signal: AbortSignal.timeout(30000),
      })
      return await res.json()
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) }
    }
  })
  ipcMain.handle('shell:revert', async (_e, p, untracked) => {
    const r = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['还原', '取消'],
      defaultId: 1,
      cancelId: 1,
      title: '还原文件',
      message: `确定要还原「${p}」吗？`,
      detail: '该文件的未提交改动将丢失，恢复到最近一次提交（HEAD）。',
    })
    if (r.response !== 0) return { ok: false, canceled: true }
    return { ok: revertFile(p, !!untracked), canceled: false }
  })
  ipcMain.on('shell:splash-ready', () => {
    setStatus('boot', '正在初始化…')
    bootKernel().catch((err) => {
      log(`boot failed: ${err.stack || err.message}`)
      finishBootError(err)
    })
  })
  ipcMain.on('shell:restart-kernel', () => { restartKernel() })
  ipcMain.on('shell:copy-log', () => {
    clipboard.writeText(state.logTail.join('\n'))
  })
  ipcMain.on('shell:quit', () => { state.quitting = true; app.quit() })
}

/* ─────────────────────────────── 启动流程 ─────────────────────────────────── */

async function bootKernel() {
  const t0 = Date.now()
  try {
    await startKernel()
    await waitReady()
  } catch (err) {
    // 兼容性保险：新内置插件（dialog-optimize）或审阅桥若导致启动失败，逐级降级
    // 重试（先仅审阅桥，再完全无补丁），保证应用本体永远可用，而不是启动失败。
    if (state.patchMode === 'full') {
      log(`boot failed (${err.message}); retrying with review bridge only`)
      state.patchMode = 'bridge'
      killChild()
      state.ready = false
      await startKernel()
      await waitReady()
    } else if (state.patchMode === 'bridge') {
      log(`boot failed (${err.message}); retrying without kernel patch`)
      state.patchMode = 'none'
      killChild()
      state.ready = false
      await startKernel()
      await waitReady()
    } else {
      throw err
    }
  }
  state.elapsedMs = Date.now() - t0
  setStatus('ready', `已就绪（${(state.elapsedMs / 1000).toFixed(1)}s），正在进入工作区…`)

  if (SMOKE) {
    const ok = await probeReady()
    console.log(ok ? `SMOKE_OK url=${state.url}` : 'SMOKE_FAIL probe-after-ready')
    state.quitting = true
    killChild()
    await sleep(800)
    app.exit(ok ? 0 : 1)
    return
  }

  await win.loadURL(state.url)

  if (UI_SMOKE) {
    const results = await runUiSmoke(win)
    const fails = results.filter((r) => !r[1]).map((r) => r[0])
    console.log(fails.length === 0 ? 'UI_SMOKE_OK' : 'UI_SMOKE_FAIL: ' + fails.join(' | '))
    state.quitting = true
    killChild()
    await sleep(800)
    app.exit(fails.length === 0 ? 0 : 1)
    return
  }

  showMainWindow()
  log(`ready at ${state.url}`)
}

/* ─────────────────────────────── UI 冒烟（真实窗口回归测试） ───────────────── */

/** 准备一个含 1 个改动文件（md）的临时 git 仓库，供 Git 视图与查看器测试。 */
function prepareUiSmokeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-uis-'))
  const run = (args) => execFileSync('git', args, { cwd: dir, windowsHide: true, stdio: 'ignore' })
  try {
    run(['init', '-q'])
    run(['config', 'user.email', 't@t'])
    run(['config', 'user.name', 't'])
    fs.writeFileSync(path.join(dir, 'a.md'), '# 标题\n\n这是**初始内容**。\n')
    run(['add', '.'])
    run(['commit', '-q', '-m', 'init'])
    fs.writeFileSync(path.join(dir, 'a.md'), '# 标题\n\n这是**改动后内容**。\n')
    return dir
  } catch (err) {
    log(`prepareUiSmokeRepo failed: ${err.message}`)
    return null
  }
}

/** 在真实内核页面上跑侧边栏交互检查，返回 [名称, 通过] 列表。 */
async function runUiSmoke(win) {
  const js = (code) => win.webContents.executeJavaScript(code, true)
  const results = []
  const check = (name, ok) => {
    results.push([name, !!ok])
    log(`ui-smoke: ${name} = ${!!ok}`)
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))

  await wait(6000) // 页面 + React + 侧边栏注入

  check('sidebar root', await js(`document.getElementById('dsh-review-root') !== null`))
  check('rail present', await js(`document.getElementById('dsh-review-rail') !== null`))
  check('toggle present', await js(`document.getElementById('dsh-review-toggle') !== null`))

  // 1) 点开关 → 面板展开
  await js(`document.getElementById('dsh-review-toggle').click()`)
  await wait(400)
  check('panel opens on toggle click', await js(`!document.getElementById('dsh-review-panel').classList.contains('dsh-hidden')`))
  check('split margin applied', await js(`document.body.style.marginRight === '360px'`))

  // 2) 拖拽竖条 → 面板左缘跟随鼠标加宽 + 持久化
  const before = await js(`document.body.style.marginRight`)
  await js(`(function(){
    const h = document.getElementById('dsh-review-rail')
    const r = h.getBoundingClientRect()
    const cx = r.left + 3, cy = r.top + 300
    const ev = (t, x) => new PointerEvent(t, { bubbles: true, clientX: x, clientY: cy, pointerId: 1 })
    h.dispatchEvent(ev('pointerdown', cx))
    h.dispatchEvent(ev('pointermove', cx - 120))
    h.dispatchEvent(ev('pointerup', cx - 120))
  })()`)
  await wait(500)
  const after = await js(`document.body.style.marginRight`)
  check(`drag widens panel (${before} -> ${after})`, before !== after)
  let savedW = null
  for (let i = 0; i < 10 && savedW === null; i++) {
    if (settings.panelWidth !== 360) savedW = settings.panelWidth
    else await wait(300)
  }
  check('width persisted to settings', savedW !== null && savedW > 360)

  // 3) 双击竖条 → 恢复默认 360px
  await js(`(function(){
    const h = document.getElementById('dsh-review-rail')
    const r = h.getBoundingClientRect()
    h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: r.left + 3, clientY: r.top + 300 }))
  })()`)
  await wait(500)
  check('dblclick resets to 360px', await js(`document.body.style.marginRight === '360px'`))

  // 3) Git 视图 + 面板内文件查看器（临时仓库有 1 个改动文件）
  await js(`[...document.querySelectorAll('#dsh-review-mode button')].find(b => b.textContent === 'Git 工作区').click()`)
  let hasRow = false
  for (let i = 0; i < 10 && !hasRow; i++) {
    hasRow = await js(`document.querySelectorAll('#dsh-review-item').length > 0`)
    if (!hasRow) await wait(500)
  }
  check('git view shows changed file', hasRow)
  if (hasRow) {
    await js(`(function(){
      const b = [...document.querySelectorAll('#dsh-review-item-row button')].find(x => x.textContent === '查看')
      if (b) b.click()
    })()`)
    let viewOpen = false
    for (let i = 0; i < 10 && !viewOpen; i++) {
      viewOpen = await js(`document.getElementById('dsh-review-view') !== null`)
      if (!viewOpen) await wait(400)
    }
    check('viewer opens', viewOpen)
    check('markdown h1 rendered', await js(`document.querySelector('#dsh-review-vbody h1') !== null`))
    check('markdown strong rendered', await js(`document.querySelector('#dsh-review-vbody strong') !== null`))
    await js(`(function(){
      const b = [...document.querySelectorAll('#dsh-review-vhead button')].find(x => x.textContent.indexOf('返回') >= 0)
      if (b) b.click()
    })()`)
    await wait(400)
    check('viewer back to list', await js(`document.getElementById('dsh-review-view') === null`))
  }
  return results
}

function finishBootError(err) {
  state.lastError = err.message || String(err)
  setStatus('error', state.lastError)
  if (SMOKE) {
    console.log(`SMOKE_FAIL ${state.lastError}`)
    state.quitting = true
    killChild()
    app.exit(1)
    return
  }
  win && !win.isDestroyed() && win.webContents.send('shell:boot-error', {
    message: state.lastError,
    logTail: state.logTail.join('\n'),
  })
}

/* ─────────────────────────────── 生命周期 ─────────────────────────────────── */

if (isWin) app.setAppUserModelId('com.deepseek.dshdesktop') // Windows 任务栏分组；macOS 无此 API

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    if (UI_SMOKE) {
      // UI 冒烟用临时 git 仓库作为内核工作目录（Git 视图/查看器测试）
      const repo = prepareUiSmokeRepo()
      if (repo) process.env.DSH_DESKTOP_CWD = repo
    }
    registerIpc()
    createWindow()
    applyAutoLaunch() // 应用持久化的开机自启设置
    try {
      setupAutoUpdater() // 打包后生效；任何更新配置问题都不得阻断启动
    } catch (err) {
      log(`auto-update init failed: ${err && err.message ? err.message : err}`)
    }
    try {
      createTray()
    } catch (err) {
      log(`tray unavailable: ${err.message}`)
    }
    // 先加载 splash，等渲染侧确认订阅完成后才开始拉内核，避免丢状态事件
    win.once('ready-to-show', () => {
      if (!SMOKE && !UI_SMOKE) win.show()
    })
    await win.loadFile(SPLASH_PATH)
  })

  app.on('before-quit', () => {
    state.quitting = true
    killChild()
  })

  app.on('window-all-closed', () => {
    // 正常情况下关闭窗口=隐藏到托盘（closeToTray），窗口不会真正关闭；
    // 走到这里说明窗口被真正销毁，直接退出。
    app.quit()
  })
}
