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
  nativeImage, nativeTheme, clipboard, dialog, screen, autoUpdater,
} = require('electron')
const { spawn, spawnSync, execFileSync } = require('node:child_process')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const isWin = process.platform === 'win32'
const SMOKE = process.argv.includes('--smoke') // 冒烟测试：完成"拉起→就绪"后打印结果并退出
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
  const args = isJsLauncher
    ? [bin, 'web', '--port', String(state.port)]
    : ['web', '--port', String(state.port)]
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
  autoUpdater.setFeedURL(feed)
  try {
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
  ipcMain.handle('shell:open-file', (_e, p) => {
    const fp = path.join(kernelCwd(), String(p))
    return shell.openPath(fp)
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
  await startKernel()
  await waitReady()
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
  showMainWindow()
  log(`ready at ${state.url}`)
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
    registerIpc()
    createWindow()
    applyAutoLaunch() // 应用持久化的开机自启设置
    setupAutoUpdater() // 打包后生效（启动后静默检查 + 托盘手动检查）
    try {
      createTray()
    } catch (err) {
      log(`tray unavailable: ${err.message}`)
    }
    // 先加载 splash，等渲染侧确认订阅完成后才开始拉内核，避免丢状态事件
    win.once('ready-to-show', () => {
      if (!SMOKE) win.show()
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
