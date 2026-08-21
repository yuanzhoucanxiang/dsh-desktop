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
  globalShortcut, Notification,
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
const { createGitReview } = require('./lib/git-review')

const isWin = process.platform === 'win32'
const SMOKE = process.argv.includes('--smoke') // 冒烟测试：完成"拉起→就绪"后打印结果并退出
const UI_SMOKE = process.argv.includes('--ui-smoke') // UI 冒烟：真实窗口验证侧边栏注入/开关/拖拽/查看器
const DEV = process.argv.includes('--dev')

const APP_NAME = 'DeepSeek Harness Desktop'
const SPLASH_PATH = path.join(__dirname, 'renderer', 'splash.html')
const ICON_PATH = path.join(__dirname, 'build', 'icon.png')
const READY_TIMEOUT_MS = 120000
// 启动画面交接编排（只影响观感，不影响内核拉起时序）：
const MIN_SPLASH_MS = 1250 // 最短展示时长：内核秒起时也不把开场动画剪断
const READY_HOLD_MS = 420  // 就绪后停顿：让进度光环可见地合上再走
const SPLASH_EXIT_MS = 520 // 淡出等待上限：渲染侧 ack 会提前返回

/** @type {BrowserWindow | null} */
let win = null
/** @type {BrowserWindow | null} 托盘「预览启动画面」用的独立窗口 */
let previewWin = null
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
  splashAt: 0, // 启动画面开始动画的时刻（渲染侧订阅完成时），用于最短展示时长
  logTail: [],
  logStream: null,
  logPath: '',
  reviewStreamPath: '',
  turnTimer: null,   // 回合完成通知的轮询定时器
  turnOffset: 0,     // 已消费的审阅事件流字节数
  turnPrimed: false, // 是否已跳过"首次扫描的历史事件"
  updateReady: null, // 已下载待安装的更新信息（{version,...}）；有值时托盘/菜单出现安装入口
  patchMode: 'full', // 内核补丁模式：full=审阅桥+内置插件 / bridge=仅审阅桥 / none=无补丁
  quarantined: [],   // 本次会话被自动隔离的坏插件名（用于汇总提示）
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
  theme: 'deep',          // 外壳皮肤：deep=深海·单光环 / seascape=海景·Seascape
  notifyOnTurnEnd: true,  // 回合完成时发系统通知（仅在主窗口失焦时）
  globalHotkey: 'Control+Alt+D', // 全局唤起热键（空字符串 = 关闭）
}

/**
 * 外壳皮肤（只作用于外壳自己拥有的界面：启动画面 + 窗口底色 + 预览窗口）。
 * 内核页面与注入的审阅侧边栏一律跟随内核自己的设计令牌（--dsw-alias-*），
 * 不在这里改色 —— 那是"内核零修改"的一部分。
 */
const THEMES = {
  deep: { label: '深海 · 单光环', bg: '#05070f' },
  seascape: { label: '海景 · Seascape（致敬杉本博司）', bg: '#0a0b0c' },
  palis: { label: '复古科幻档案终端 · PALIS', bg: '#0a0a0a' },
}

/** 当前皮肤 id（脏数据一律回落到 deep）。 */
function themeId() {
  return THEMES[settings.theme] ? settings.theme : 'deep'
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

/* ─────────────────────────────── 修改审阅（git） ─────────────────────────────
 * 具体 git 逻辑在 lib/git-review.js（纯 Node，可用 `node lib/git-review.test.js`
 * 直接单测）。这里只保留"外壳职责"：确认对话框、IPC、把结果回给渲染侧。
 */

const review = createGitReview(kernelCwd)

/** 在工作目录里跑 git；失败返回 null（老调用点沿用这个宽松签名）。 */
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

const isGitRepo = () => review.isRepo()
const gitInit = () => review.init()
const collectChanges = () => review.changes()
const revertFile = (p, untracked) => review.revertFile(p, untracked).ok

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

/**
 * 自包含运行时根目录：打包后=用户目录下的外部副本，开发=项目下 runtime/。
 *
 * 内核运行时的落盘位置是关键设计：让它永远从「安装目录之外」执行，更新时安装器
 * 只需覆盖外壳，不再需要去杀正在运行的内核、等它释放安装目录里的文件锁。
 * 这正是"能像正常软件一样更新"的前提（历史上 0.1.11~0.1.14 的安装失败都源于
 * 内核从 resources/runtime 里执行导致安装器撞上活文件）。
 */
function externalRuntimeDir() {
  const base = isWin
    ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
    : path.join(os.homedir(), 'Library', 'Application Support')
  return path.join(base, APP_NAME, 'runtime')
}

/** 读 JSON 元数据（runtime.json / runtime-marker.json 字段一致：dsh/node/builtAt）。 */
function readRuntimeMeta(file) {
  try {
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch { return null }
}

/**
 * 打包后：首次启动（或内置运行时版本变化时）把 resources/runtime.tar.gz 解压到用户目录。
 * 安装目录只装外壳、不装运行时树 → 更新时安装器直接覆盖外壳即可，永不触达巨型运行时；
 * 内核始终从用户目录的副本执行（见 externalRuntimeDir 的定位）。
 * 解压到临时目录再整体替换，避免中断留下半成品；内置标记与本地一致则跳过。
 */
async function ensureExternalRuntime() {
  if (!app.isPackaged) return
  const archive = path.join(process.resourcesPath, 'runtime.tar.gz')
  if (!fs.existsSync(archive)) return // 旧安装/异常：无归档则交给 resolveDshBin 兜底
  const local = externalRuntimeDir()
  const want = readRuntimeMeta(path.join(process.resourcesPath, 'runtime-marker.json'))
  const have = readRuntimeMeta(path.join(local, 'runtime.json'))
  if (want && have && have.dsh === want.dsh && have.node === want.node && have.builtAt === want.builtAt) return
  setStatus('kernel', '正在解压内核运行时…')
  log(`extracting kernel runtime -> ${local}`)
  const parent = path.dirname(local)
  const stage = path.join(parent, '.runtime-extract')
  await fs.promises.rm(stage, { recursive: true, force: true })
  await fs.promises.mkdir(parent, { recursive: true })
  await fs.promises.mkdir(stage, { recursive: true })
  // 系统 tar（Win10 1803+ 自带 bsdtar；开发机 Git 也带 GNU tar）。归档内容带 runtime/ 前缀。
  const tarExe = isWin && process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'tar.exe')
    : 'tar'
  const r = spawnSync(tarExe, ['-xf', archive, '-C', stage], { windowsHide: true })
  const extracted = path.join(stage, 'runtime')
  const complete = (dir) =>
    fs.existsSync(path.join(dir, 'runtime.json')) &&
    fs.existsSync(path.join(dir, isWin ? 'node.exe' : path.join('bin', 'node'))) &&
    fs.existsSync(path.join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  if (r.status !== 0 || !complete(extracted)) {
    // 解压不完整时绝不碰现有运行时——宁可继续用旧版，也不把应用搞成无内核可用
    await fs.promises.rm(stage, { recursive: true, force: true }).catch(() => {})
    throw new Error(`内核运行时解压不完整（tar exit ${r.status}），已保留现有运行时`)
  }
  // 原子交换 + 保留上一版：旧 runtime 先改名为 .prev 备份，新运行时就位后才算完成；
  // 交换中途任何失败自动回滚；.prev 留作运行时损坏时的回退（见 runtimeRoot）。
  const backup = local + '.prev'
  await fs.promises.rm(backup, { recursive: true, force: true }).catch(() => {})
  if (fs.existsSync(local)) {
    try { await fs.promises.rename(local, backup) } catch {}
  }
  try {
    await fs.promises.rename(extracted, local)
  } catch (err) {
    if (fs.existsSync(backup) && !fs.existsSync(local)) {
      await fs.promises.rename(backup, local).catch(() => {})
    }
    await fs.promises.rm(stage, { recursive: true, force: true }).catch(() => {})
    throw new Error(`内核运行时切换失败：${err.message}`)
  }
  await fs.promises.rm(stage, { recursive: true, force: true }).catch(() => {})
  log(`kernel runtime ready at ${local}（上一版备份于 ${backup}）`)
}

function runtimeRoot() {
  if (app.isPackaged) {
    const local = externalRuntimeDir()
    const ok = (dir) => fs.existsSync(path.join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
    // 主运行时不完整（更新中途断电/被杀等）时回退到上一版备份，不至于无内核可用
    if (!ok(local)) {
      const prev = local + '.prev'
      if (ok(prev)) {
        log(`runtime fallback: ${local} incomplete, using ${prev}`)
        return prev
      }
    }
    return local
  }
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
const BUILTIN_PLUGINS = ['dialog-optimize', 'palis-theme']

function syncBuiltinPlugin(name) {
  const src = path.join(pluginRoot(), name)
  if (!fs.existsSync(path.join(src, 'package.json'))) return false
  const dest = path.join(dshHome(), 'profiles', 'node_modules', '@dsh-local', name)
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
      log(`sync ${name} ${file} failed: ${err.message}`)
    }
  }
  if (synced) log(`${name} synced to ${dest}`)
  return true
}

const syncBuiltinDialogPlugin = () => syncBuiltinPlugin('dialog-optimize') // 旧名保留（降级链调用）

/**
 * 用户自己的补丁层里是否已挂载同名插件（$DSH_HOME 级或 profile 级 cordis.patch.yml）。
 * 已存在时不再注入内置行，避免同一插件出现两个 loader 条目（客户端模块表按条目
 * 名去重，重复名会在浏览器侧启动时抛错）。
 */
function userInstalledPlugin(name) {
  const home = dshHome()
  const candidates = [
    path.join(home, 'cordis.patch.yml'),
    path.join(home, 'profiles', 'web', 'cordis.patch.yml'),
  ]
  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(file, 'utf8')
      if (raw.includes(name)) return true
    } catch {}
  }
  return false
}

const userInstalledDialogOptimize = () => userInstalledPlugin('@dsh-local/dialog-optimize') // 旧名保留

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
    if (mode === 'full') {
      for (const pluginName of BUILTIN_PLUGINS) {
        if (!syncBuiltinPlugin(pluginName)) continue
        const pkg = `@dsh-local/${pluginName}`
        if (userInstalledPlugin(pkg)) {
          log(`${pluginName} already in user patch layer, skipping builtin row`)
          continue
        }
        rows.push([
          '- insert:',
          `    - id: ${pluginName}`,
          `      name: '${pkg}'`,
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

/* ───────────────────── 回合完成通知（后台感知：失焦时才提醒） ─────────────────
 * 数据来自审阅桥写的 review-events.ndjson（内核零修改，外壳只读）。
 * 只在"主窗口没有焦点"时弹系统通知 —— 盯着屏幕时不打扰，这是 Codex 的 notify 思路。
 */
function startTurnWatcher() {
  if (SMOKE || UI_SMOKE) return // 冒烟不弹系统通知
  if (state.turnTimer) clearInterval(state.turnTimer)
  state.turnTimer = setInterval(() => {
    if (!settings.notifyOnTurnEnd || !state.reviewStreamPath) return
    let size = 0
    try {
      size = fs.statSync(state.reviewStreamPath).size
    } catch {
      return // 流文件还没出现（无补丁模式）：静默跳过
    }
    if (size === state.turnOffset) return
    if (size < state.turnOffset) state.turnOffset = 0 // 内核重启后流被重置
    let chunk = ''
    try {
      const fd = fs.openSync(state.reviewStreamPath, 'r')
      const len = size - state.turnOffset
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, state.turnOffset)
      fs.closeSync(fd)
      chunk = buf.toString('utf8')
    } catch (err) {
      return
    }
    state.turnOffset = size
    let ended = 0
    let files = 0
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue
      let e = null
      try { e = JSON.parse(line) } catch { continue }
      if (!e) continue
      if (e.kind === 'tool-call' && e.file) files++
      if (e.kind === 'turn-end') ended++
    }
    if (!ended) return
    // 首次扫描（外壳刚起来时读到历史事件）不提醒，避免"补课式"轰炸
    if (!state.turnPrimed) {
      state.turnPrimed = true
      return
    }
    const focused = !!win && !win.isDestroyed() && win.isFocused()
    if (focused) return
    notifyTurnEnd(files)
  }, 2000)
}

function notifyTurnEnd(files) {
  try {
    if (!Notification.isSupported()) return
    const n = new Notification({
      title: 'DeepSeek Harness · 本轮完成',
      body: files > 0 ? `改动了 ${files} 处文件，点此查看审阅面板` : '任务已结束，点此回到工作区',
      silent: false,
    })
    n.on('click', () => {
      showMainWindow()
      if (win && !win.isDestroyed() && files > 0) win.webContents.send('shell:open-review')
    })
    n.show()
  } catch (err) {
    log(`notify failed: ${err.message}`)
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

/* ─────────────────────── 插件故障隔离（内容更新防砖） ───────────────────────
 * 内核对 profile bundle 是"任一失败即整体退出"：历史上 PALIS 缺 dsh.bundle、
 * 工作区插件依赖解析失败，都把整个应用搞挂（内核起不来 = 应用不可用）。
 * 这组函数在启动失败时自动找出报错点名的坏 bundle，从 profile 的
 * dsh.profile.bundles 里摘除并重试，把"插件更新搞崩内核"降级为
 * "禁用一个插件 + 通知用户（托盘可一键恢复）"。
 */

/** 内核核心 bundle，永不隔离（摘了也救不回来，反而必挂）。 */
const CORE_BUNDLES = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])

function quarantineFile() {
  return path.join(app.getPath('userData'), 'disabled-bundles.json')
}

function readQuarantine() {
  try {
    const list = readJsonStripBom(quarantineFile())
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

/** 读 JSON 并剥掉可能的 UTF-8 BOM：Windows PowerShell 5.1 的 `Set-Content -Encoding UTF8`
 *  会写 BOM，而内核与本应用对带 BOM 的 profile manifest 都会 JSON.parse 直接失败。 */
function readJsonStripBom(file) {
  const raw = fs.readFileSync(file, 'utf8')
  return JSON.parse(raw.replace(/^\uFEFF/, ''))
}

function profileWebManifest() {
  return path.join(dshHome(), 'profiles', 'web', 'package.json')
}

/** 从日志文本里提取报错点名的 bundle 包名（排除内核自身的 cordis:* 内部条目）。 */
function detectBrokenBundles(text) {
  const names = new Set()
  const push = (n) => {
    n = (n || '').trim()
    if (n && !n.includes(':') && !CORE_BUNDLES.has(n)) names.add(n)
  }
  for (const m of text.matchAll(/(?:failed to import|failed to apply) loader entry [^(]*?\(([^)]+)\)/g)) push(m[1])
  for (const m of text.matchAll(/profile bundle "([^"]+)" declares/g)) push(m[1])
  return [...names]
}

/** 把坏 bundle 从 profile 的 bundles 列表摘除（仅在确有变化时写回，不扰动其余字段）。 */
function quarantineBundles(names, reason) {
  const file = profileWebManifest()
  let manifest
  try {
    manifest = readJsonStripBom(file)
  } catch (err) {
    log(`quarantine: cannot read profile manifest (${err.message})`)
    return []
  }
  const bundles = manifest?.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) return []
  const removed = names.filter((n) => bundles.includes(n))
  if (!removed.length) return []
  manifest.dsh.profile.bundles = bundles.filter((n) => !removed.includes(n))
  try {
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  } catch (err) {
    log(`quarantine: cannot write profile manifest (${err.message})`)
    return []
  }
  const list = readQuarantine()
  const at = new Date().toISOString()
  for (const n of removed) {
    if (!list.some((e) => e.name === n)) list.push({ name: n, reason, at })
  }
  try { fs.writeFileSync(quarantineFile(), JSON.stringify(list, null, 2), 'utf8') } catch {}
  refreshMenus() // 托盘出现「重新启用被隔离的插件」入口
  for (const n of removed) log(`quarantined broken bundle: ${n} (${reason})`)
  return removed
}

/** 一键恢复：把隔离过的 bundle 加回 profile（依赖仍存在的才加），然后重启内核。 */
function restoreQuarantinedBundles() {
  const list = readQuarantine()
  if (!list.length) return
  try {
    const file = profileWebManifest()
    const manifest = readJsonStripBom(file)
    const deps = manifest?.dependencies ?? {}
    const bundles = manifest?.dsh?.profile?.bundles ?? []
    let restored = 0
    for (const e of list) {
      if (deps[e.name] && !bundles.includes(e.name)) { bundles.push(e.name); restored++ }
    }
    manifest.dsh.profile.bundles = bundles
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    try { fs.rmSync(quarantineFile(), { force: true }) } catch {}
    log(`restored ${restored} quarantined bundle(s); restarting kernel`)
    refreshMenus()
    restartKernel()
  } catch (err) {
    log(`restore quarantine failed: ${err.message}`)
  }
}

/** 内核输出在 Windows 上是 OEM/GBK，而本应用日志是 UTF-8：直接 toString 会得到乱码，
 *  排查全靠猜。按"含替换符即非合法 UTF-8"判定后用 GBK 解码（Electron 自带全量 ICU）。 */
function decodeChunk(buf) {
  const s = buf.toString('utf8')
  if (!s.includes('\uFFFD')) return s
  try { return new TextDecoder('gbk').decode(buf) } catch { return s }
}

/** 清掉卡在更新器缓存目录里的残留安装器进程——它们会让新安装器误判"同款已在运行"
 *  而中止（实战遇到过 setup.exe --updated /S 僵尸挡住更新的情况）。 */
function killStaleUpdaterInstallers() {
  if (!isWin || !process.env.LOCALAPPDATA) return
  try {
    const dir = path.join(process.env.LOCALAPPDATA, 'dsh-desktop-updater')
    if (!fs.existsSync(dir)) return
    const ps = "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('" + dir + "', 'OrdinalIgnoreCase') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    spawnSync('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 15000 })
  } catch {}
}

function notifyQuarantine(removed) {
  state.quarantined = [...(state.quarantined || []), ...removed]
  try {
    if (Notification.isSupported()) {
      const n = new Notification({
        title: `已自动禁用 ${removed.length} 个出错的插件`,
        body: `${removed.join('、')} 导致内核启动失败，已跳过它们保证应用可用；托盘菜单可重新启用。`,
      })
      n.show()
    }
  } catch {}
}

/**
 * startKernel + waitReady，带启动恢复链：坏插件隔离（最多 4 轮）→ 补丁降级
 * （full→bridge→none，仅初始启动启用降级；内核重启只做隔离，避免慢启动被误降级）。
 * 任一轮成功即返回；全部失败向上抛（进入启动失败画面 / 内核状态提示）。
 */
async function startKernelUntilReady({ degradePatch = false } = {}) {
  for (let round = 0; ; round++) {
    try {
      await startKernel()
      await waitReady()
      return
    } catch (err) {
      const bad = detectBrokenBundles(state.logTail.join('\n'))
      const known = new Set(readQuarantine().map((e) => e.name))
      const fresh = bad.filter((n) => !known.has(n))
      if (fresh.length && round < 4) {
        const removed = quarantineBundles(fresh, String(err.message).slice(0, 200))
        if (removed.length) {
          notifyQuarantine(removed)
          killChild()
          state.ready = false
          continue
        }
      }
      if (degradePatch && state.patchMode === 'full') {
        log(`boot failed (${err.message}); retrying with review bridge only`)
        state.patchMode = 'bridge'
      } else if (degradePatch && state.patchMode === 'bridge') {
        log(`boot failed (${err.message}); retrying without kernel patch`)
        state.patchMode = 'none'
      } else {
        throw err
      }
      killChild()
      state.ready = false
    }
  }
}

async function startKernel() {
  await ensureExternalRuntime() // 打包后：保证内核从外部副本启动（见 ensureExternalRuntime 注释）
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

  child.stdout.on('data', (d) => log(decodeChunk(d)))
  child.stderr.on('data', (d) => log(decodeChunk(d)))
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

/** 等内核进程真正退出（最多 maxMs）。用于"安装更新前确认没有残留进程"。 */
function waitChildExit(child, maxMs) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return resolve()
    const t = setTimeout(resolve, maxMs)
    child.once('exit', () => { clearTimeout(t); resolve() })
  })
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
    // 内核重启也走隔离恢复链（装了坏插件后点「重启内核」不再把应用搞挂）；
    // 但不做补丁降级——内核偶发慢启动不该悄悄丢掉审阅桥。
    await startKernelUntilReady({ degradePatch: false })
    if (win && !win.isDestroyed()) {
      win.webContents.send('shell:kernel-status', { alive: true })
      if (win.webContents.getURL().startsWith('http')) win.webContents.reload()
      else {
        // 错误态重启成功：同样走"合环 → 淡出 → 交接"，不硬切
        await sleep(READY_HOLD_MS)
        await playSplashExit()
        await win.loadURL(state.url)
      }
    }
  } catch (err) {
    log(`restart failed: ${err.message}`)
    state.lastError = err.message
    win && !win.isDestroyed() && win.webContents.send('shell:kernel-status', { alive: false, message: err.message })
  } finally {
    state.restarting = false
  }
}

/* ─────────────────────────────── 启动画面交接 ──────────────────────────────── */

/** 当前窗口是否还停在启动画面（file:// 页面）。 */
function onSplash() {
  return !!win && !win.isDestroyed() && win.webContents.getURL().startsWith('file:')
}

/**
 * 切工作区之前先播启动画面淡出，避免"硬切"：
 * 通知渲染侧淡出 → 等它 ack（最多 SPLASH_EXIT_MS 兜底）→ 调用方再 loadURL。
 * 窗口背景色与启动画面同色，所以淡出结束到新页面首帧之间是无缝黑场。
 * @returns {Promise<boolean>} 渲染侧是否在预算内确认（false = 走了兜底超时）
 */
function playSplashExit() {
  if (!onSplash()) return Promise.resolve(false)
  return new Promise((resolve) => {
    let settled = false
    const finish = (acked) => {
      if (settled) return
      settled = true
      ipcMain.removeListener('shell:splash-exit-done', ack)
      resolve(acked)
    }
    const ack = () => finish(true)
    ipcMain.once('shell:splash-exit-done', ack)
    setTimeout(() => finish(false), SPLASH_EXIT_MS)
    win.webContents.send('shell:splash-exit')
  })
}

/** 就绪 → 工作区的完整交接：补足最短展示时长 + 就绪停顿 + 淡出。 */
async function handoffFromSplash() {
  if (!onSplash()) return
  const shown = state.splashAt ? Date.now() - state.splashAt : MIN_SPLASH_MS
  await sleep(Math.max(READY_HOLD_MS, MIN_SPLASH_MS - shown))
  if (!(await playSplashExit())) log('splash exit ack timed out; handing off anyway')
}

/* ─────────────────────────────── 皮肤（外壳级） ────────────────────────────── */

/**
 * 把所选皮肤同步给内核 Web UI：内置插件 @dsh-local/palis-theme 在 /api/palis-theme
 * 上维护主题态（POST 写入），其 client 半轮询该端点，用内核自己的 --dsw-alias-*
 * 设计令牌 + 一段自包含样式表给整个页面换肤（不刮 DOM、不依赖编译 hash 类名）。
 * 未就绪/未启用时静默跳过 —— 这只是"联动"，不影响外壳皮肤本身。
 */
function pushThemeToKernel(theme) {
  if (!state.ready || !state.url) return
  const value = theme === 'palis' ? 'palis' : ''
  fetch(`${state.url}/api/palis-theme`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ theme: value }),
    signal: AbortSignal.timeout(2500),
  }).then((r) => {
    if (!r.ok) log(`palis-theme push returned ${r.status}`)
  }).catch(() => {}) // 内核没装插件时 404/网络错，静默
}

/**
 * 切换外壳皮肤：持久化 + 窗口底色 + 广播给启动画面/预览窗口 + 联动内核页面主题。
 * palis 皮肤下，内核 Web UI 经内置 palis-theme 插件一起换成档案终端观感。
 */
function applyTheme(id) {
  const next = THEMES[id] ? id : 'deep'
  settings.theme = next
  saveSettings()
  for (const w of [win, previewWin]) {
    if (!w || w.isDestroyed()) continue
    try {
      w.setBackgroundColor(THEMES[next].bg)
    } catch (err) {
      log(`setBackgroundColor failed: ${err.message}`)
    }
    w.webContents.send('shell:theme', next)
  }
  if (previewWin && !previewWin.isDestroyed()) {
    previewWin.setTitle(`预览启动画面 · ${THEMES[next].label}`)
  }
  for (const w of extraWins) {
    if (!w.isDestroyed()) {
      try { w.setBackgroundColor(THEMES[next].bg) } catch {}
      w.webContents.send('shell:theme', next)
    }
  }
  refreshMenus()
  pushThemeToKernel(next)
  log(`theme -> ${next}`)
}

/** 托盘「预览启动画面」：独立窗口自驱动播一遍启动节奏，不碰内核、不影响主窗口。 */
function openSplashPreview(withError) {
  if (previewWin && !previewWin.isDestroyed()) {
    previewWin.focus()
    previewWin.webContents.send('shell:theme', themeId())
    return
  }
  previewWin = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 620,
    minHeight: 440,
    title: `预览启动画面 · ${THEMES[themeId()].label}`,
    backgroundColor: THEMES[themeId()].bg,
    icon: ICON_PATH,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  previewWin.on('closed', () => { previewWin = null })
  // 注意：不能用 loadFile(path, { query })—— 路径含空格/反斜杠时它拼出的 URL 会加载失败
  // （实测 ERR_FAILED）。一律 pathToFileURL 生成合法 file:// URL 再挂查询串。
  const url = pathToFileURL(SPLASH_PATH)
  url.searchParams.set('preview', '1')
  url.searchParams.set('theme', themeId())
  if (withError) url.searchParams.set('error', '1')
  previewWin.loadURL(url.toString()).catch((err) => log(`preview failed: ${err.message}`))
}

/* ──────────────── 应用菜单 / 快捷键 / 多窗口 / 全局唤起 / 深链接 ────────────────
 * 设计取向（对标 Codex，见 docs/codex-benchmark.md 的 P0）：
 *   · 命令走原生菜单 + accelerator：菜单栏默认隐藏（Alt 唤出），但快捷键始终生效，
 *     既保持干净外观，又让每个能力"可发现、可键盘直达"
 *   · 设置留在托盘（开机自启/皮肤/通知/热键），命令留在菜单，两边不混
 *   · 全部只用外壳能力（窗口/菜单/通知/热键/协议），内核零修改
 */

/** @type {Set<BrowserWindow>} 附加窗口（同一内核，多会话并行） */
const extraWins = new Set()

/** 把命令发给当前聚焦的窗口（没有就发主窗口）。 */
function sendToFocused(channel, payload) {
  const target = BrowserWindow.getFocusedWindow() || win
  if (target && !target.isDestroyed() && target.webContents.getURL().startsWith('http')) {
    target.webContents.send(channel, payload)
  }
}

/** 新窗口：承载同一个内核，用于并行看多个会话。 */
function openExtraWindow() {
  if (!state.ready || !state.url) return null
  const w = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: THEMES[themeId()].bg,
    icon: ICON_PATH,
    title: APP_NAME,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  extraWins.add(w)
  w.on('closed', () => extraWins.delete(w))
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  w.loadURL(state.url).catch((err) => log(`extra window failed: ${err.message}`))
  return w
}

/** 全局热键：按一次唤起并聚焦，再按一次收起（不打断当前应用的心智）。 */
function applyGlobalHotkey() {
  try {
    globalShortcut.unregisterAll()
  } catch {}
  const acc = settings.globalHotkey
  if (!acc || SMOKE || UI_SMOKE) return
  try {
    const ok = globalShortcut.register(acc, () => {
      if (win && !win.isDestroyed() && win.isFocused()) win.hide()
      else showMainWindow()
    })
    log(ok ? `global hotkey: ${acc}` : `global hotkey rejected (被占用?): ${acc}`)
  } catch (err) {
    log(`global hotkey failed: ${err.message}`)
  }
}

/** 深链接：dsh://open | dsh://review | dsh://restart（外部工具/浏览器可直接唤起）。 */
function handleDeepLink(url) {
  if (!url || !/^dsh:/i.test(url)) return
  let action = ''
  try {
    const u = new URL(url)
    action = (u.hostname || u.pathname.replace(/^\/+/, '')).toLowerCase()
  } catch {
    return
  }
  log(`deep link: ${url}`)
  showMainWindow()
  if (action === 'review') sendToFocused('shell:open-review')
  else if (action === 'restart') restartKernel()
}

function showShortcutHelp() {
  const rows = [
    ['Ctrl+Shift+B', '切换「修改审阅」侧边栏'],
    ['Ctrl+Shift+N', '新窗口（同一内核，多会话并行）'],
    ['Ctrl+Shift+K', '重启内核'],
    ['Ctrl+Shift+O', '设置工作目录…'],
    ['Ctrl+R', '重载页面'],
    ['Ctrl+Shift+F5', '强制重载'],
    ['Ctrl+0 / Ctrl+= / Ctrl+-', '缩放复位 / 放大 / 缩小'],
    ['F11', '全屏'],
    ['Ctrl+/', '这份快捷键一览'],
    ['Alt', '临时显示菜单栏'],
    [settings.globalHotkey || '（已关闭）', '全局唤起/收起主窗口（任何应用里都能按）'],
  ]
  dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
    type: 'info',
    title: '快捷键一览',
    message: 'DeepSeek Harness Desktop · 快捷键',
    detail: rows.map(([k, v]) => `${k}\n    ${v}`).join('\n'),
    buttons: ['好'],
    noLink: true,
  })
}

function themeMenuItems() {
  return [
    ...Object.keys(THEMES).map((id) => ({
      label: THEMES[id].label,
      type: 'radio',
      checked: themeId() === id,
      click: () => applyTheme(id),
    })),
    { type: 'separator' },
    { label: '预览启动画面…', click: () => openSplashPreview(false) },
    { label: '预览启动失败画面…', click: () => openSplashPreview(true) },
  ]
}

function buildAppMenu() {
  const ready = !!(state.ready && state.url)
  return Menu.buildFromTemplate([
    {
      label: '会话',
      submenu: [
        { label: '新窗口', accelerator: 'CmdOrCtrl+Shift+N', enabled: ready, click: () => openExtraWindow() },
        { type: 'separator' },
        { label: '设置工作目录…', accelerator: 'CmdOrCtrl+Shift+O', click: () => pickWorkspace() },
        {
          label: '在文件管理器中打开工作目录',
          click: () => { const ws = kernelCwd(); if (ws) shell.openPath(ws) },
        },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => { state.quitting = true; app.quit() } },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重载页面' },
        { role: 'forceReload', label: '强制重载', accelerator: 'CmdOrCtrl+Shift+F5' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        ...(DEV ? [{ role: 'toggleDevTools', label: '开发者工具' }] : []),
      ],
    },
    {
      label: '审阅',
      submenu: [
        { label: '切换审阅侧边栏', accelerator: 'CmdOrCtrl+Shift+B', click: () => sendToFocused('shell:toggle-review') },
        { label: '刷新改动', click: () => sendToFocused('shell:refresh-review') },
      ],
    },
    {
      label: '内核',
      submenu: [
        { label: '重启内核', accelerator: 'CmdOrCtrl+Shift+K', click: () => restartKernel() },
        {
          label: '打开日志',
          click: () => shell.openPath(state.logPath || path.join(app.getPath('userData'), 'kernel.log')),
        },
        { label: '复制启动日志', click: () => clipboard.writeText(state.logTail.join('\n')) },
        { type: 'separator' },
        ...(state.updateReady
          ? [{
            label: `重启并安装更新 ${state.updateReady.version}`,
            click: () => installUpdateNow(),
          }]
          : []),
        { label: '检查更新…', click: () => checkForUpdates(true) },
      ],
    },
    { label: '皮肤', submenu: themeMenuItems() },
    {
      label: '帮助',
      submenu: [
        { label: '快捷键一览', accelerator: 'CmdOrCtrl+/', click: () => showShortcutHelp() },
        { type: 'separator' },
        {
          label: '关于',
          click: () => dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
            type: 'info',
            title: '关于',
            message: `${APP_NAME} v${app.getVersion()}`,
            detail: '外壳只负责拉起 dsh web 并承载页面，内核原样运行、未做任何修改。',
            buttons: ['好'],
            noLink: true,
          }),
        },
      ],
    },
  ])
}

/** 菜单里有勾选项/可用性会随状态变，改动后统一重建菜单与托盘。 */
function refreshMenus() {
  // 注意：模板非法（错误的 role/accelerator）会在 buildFromTemplate 抛错 ——
  // 所以冒烟模式也要构建一次（只是不挂上去），让菜单模板始终有测试兜底。
  const menu = buildAppMenu()
  if (!SMOKE && !UI_SMOKE) Menu.setApplicationMenu(menu)
  refreshTray()
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
    backgroundColor: THEMES[themeId()].bg, // 与启动画面同色，避免任何白闪
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

/**
 * 执行更新安装。这里的每一步都是为了避免"应用没有完全关闭"那类提示：
 *   1. 标记 quitting，先自己把内核子进程收掉（它跑在用户目录的运行时副本里，但进程必须退出）
 *   2. 销毁托盘、关掉附加窗口，让本进程没有残留 UI 资源
 *   3. 等内核进程真正退出后 quitAndInstall(isSilent=true, isForceRunAfter=true)：
 *      · isSilent=true  → 安装器静默执行，不再出现任何"请先关闭应用"的交互
 *      · isForceRunAfter=true → 装完自动把应用重新拉起来（就是"点一下重启就好"）
 *   运行时已迁出安装目录（见 externalRuntimeDir），安装器更新时只需覆盖外壳，
 *   不再需要安装器侧强杀逻辑，手动装包时由安装器默认的"请先关闭应用"提示兜底。
 */
function installUpdateNow() {
  if (!state.updateReady) return
  log(`installing update ${state.updateReady.version}`)
  state.quitting = true
  const child = state.child
  try {
    killChild()
  } catch (err) {
    log(`killChild before install failed: ${err.message}`)
  }
  try {
    if (tray) {
      tray.destroy()
      tray = null
    }
  } catch {}
  for (const w of extraWins) {
    if (!w.isDestroyed()) w.destroy()
  }
  if (previewWin && !previewWin.isDestroyed()) previewWin.destroy()
  // 等内核进程真正退出（taskkill 是异步生效的），再交给安装器，避免它撞上还在跑的进程；
  // 之后内核不再锁安装目录文件，安装器覆盖外壳即可（见 externalRuntimeDir 的设计说明）。
  setTimeout(async () => {
    await waitChildExit(child, 8000)
    await sleep(300) // 让 /T 子树里的残余句柄一并释放
    killStaleUpdaterInstallers() // 清掉更新器目录里卡住的残留安装器，避免新安装器误判"已在运行"而中止
    try {
      autoUpdater.quitAndInstall(true, true)
    } catch (err) {
      log(`quitAndInstall failed: ${err.message}`)
      dialog.showMessageBox({
        type: 'error',
        title: '安装更新失败',
        message: '自动安装没能启动',
        detail: `${err.message}\n\n可以到 GitHub Releases 手动下载安装包。`,
        buttons: ['好'],
        noLink: true,
      })
    }
  }, 200)
}

/** 更新已下载：用系统通知 + 托盘/菜单入口告知（窗口可能正藏在托盘里，模态框看不见）。 */
function announceUpdateReady(info) {
  state.updateReady = info
  refreshMenus() // 让「重启并安装更新」项出现在托盘与菜单里
  const version = (info && info.version) || ''
  try {
    if (Notification.isSupported()) {
      const n = new Notification({
        title: `更新已就绪 · ${version}`,
        body: '点此立即重启并安装（约几秒，装完自动打开）',
      })
      n.on('click', () => installUpdateNow())
      n.show()
    }
  } catch (err) {
    log(`update notify failed: ${err.message}`)
  }
  // 窗口可见时再补一个明确的选择框；隐藏在托盘时不打扰，靠通知/托盘入口
  if (win && !win.isDestroyed() && win.isVisible()) {
    dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['立即重启并安装', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: '更新已就绪',
      message: `新版本 ${version} 已下载完成。`,
      detail: '点「立即重启并安装」后全自动完成：静默安装并自动重新打开，不会再让你手动关闭应用。\n'
        + '选「稍后」也不用重新下载 —— 托盘菜单和「内核」菜单里会一直留着「重启并安装更新」。',
    }).then((r) => {
      if (r.response === 0) installUpdateNow()
    })
  }
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
  // 网络抖动（如 ERR_CONNECTION_RESET，GitHub API 直连常见）自动重试：0s/3s/8s 共 3 次，
  // 只有手动检查且最终失败才弹窗；静默检查失败只记日志。
  let lastErr = null
  for (const delay of [0, 3000, 8000]) {
    if (delay) {
      await sleep(delay)
      log(`update check retrying after ${delay}ms...`)
    }
    try {
      autoUpdater.setFeedURL(feed)
      const result = await autoUpdater.checkForUpdates()
      // 修复：checkForUpdates 在"已是最新"时也返回非空 result（isUpdateAvailable=false），
      // 原条件 `!result` 使"当前已是最新版本"提示永远不弹——手动检查看起来"点了没反应"。
      if (manual && result && !result.isUpdateAvailable) {
        dialog.showMessageBox(win, { type: 'info', title: '检查更新', message: '当前已是最新版本。' })
      }
      return
    } catch (err) {
      lastErr = err
      log(`update check failed: ${err.message}`)
    }
  }
  if (manual) {
    dialog.showMessageBox(win, {
      type: 'error', title: '检查更新', message: '检查更新失败',
      detail: String((lastErr && lastErr.message) || lastErr),
    })
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
    // 退出时自动安装：即便用户从不点"立即重启"，下次正常退出也能装上
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('update-available', (info) => log(`update available: ${info.version}`))
    autoUpdater.on('update-downloaded', (info) => {
      log(`update downloaded: ${info.version}`)
      announceUpdateReady(info)
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
    ...(state.updateReady
      ? [{
        label: `⬆ 重启并安装更新 ${state.updateReady.version}`,
        click: () => installUpdateNow(),
      }]
      : []),
    ...(readQuarantine().length
      ? [{
        label: `↻ 重新启用被隔离的插件（${readQuarantine().length} 个）`,
        click: () => restoreQuarantinedBundles(),
      }]
      : []),
    { type: 'separator' },
    { label: '重启内核', click: () => restartKernel() },
    { label: '设置工作目录…', click: () => pickWorkspace() },
    { label: '打开日志', click: () => shell.openPath(state.logPath || path.join(app.getPath('userData'), 'kernel.log')) },
    { label: '检查更新…', click: () => checkForUpdates(true) },
    { type: 'separator' },
    {
      label: '皮肤',
      submenu: [
        ...Object.keys(THEMES).map((id) => ({
          label: THEMES[id].label,
          type: 'radio',
          checked: themeId() === id,
          click: () => applyTheme(id),
        })),
        { type: 'separator' },
        { label: '预览启动画面…', click: () => openSplashPreview(false) },
        { label: '预览启动失败画面…', click: () => openSplashPreview(true) },
        { type: 'separator' },
        { label: '只影响外壳（启动画面/窗口底色）', enabled: false },
        { label: '内核页面沿用内核自身主题', enabled: false },
      ],
    },
    { type: 'separator' },
    {
      label: '回合完成时通知（失焦才提醒）', type: 'checkbox', checked: settings.notifyOnTurnEnd,
      click: (mi) => { settings.notifyOnTurnEnd = mi.checked; saveSettings(); refreshMenus() },
    },
    {
      label: `全局唤起热键（${settings.globalHotkey || '已关闭'}）`, type: 'checkbox', checked: !!settings.globalHotkey,
      click: (mi) => {
        settings.globalHotkey = mi.checked ? (settings.globalHotkey || 'Control+Alt+D') : ''
        saveSettings()
        applyGlobalHotkey()
        refreshMenus()
      },
    },
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
    version: app.getVersion(),
    theme: themeId(),
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

  /* ── 改动审阅的信任闭环：暂存 / 取消暂存 / 逐块丢弃 / 提交 / 推送 ──────────
   * 分寸：可逆的操作（暂存、取消暂存）不打扰用户；破坏性（丢弃）与对外发布
   * （推送）必须二次确认。git 细节全在 lib/git-review.js，有单测兜底。 */
  const confirm = (opts) => dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
    type: 'warning',
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    ...opts,
  })

  ipcMain.handle('shell:git-stage', (_e, p, hunk) => review.stage(p, hunk ?? null))
  ipcMain.handle('shell:git-unstage', (_e, p, hunk) => review.unstage(p, hunk ?? null))
  ipcMain.handle('shell:git-revert-hunk', async (_e, p, hunk) => {
    const r = await confirm({
      buttons: ['丢弃这一块', '取消'],
      title: '丢弃这一块改动',
      message: `确定丢弃「${p}」里的第 ${Number(hunk) + 1} 块改动吗？`,
      detail: '只影响这一块，同文件的其它改动会保留。丢弃后无法撤销。',
    })
    if (r.response !== 0) return { ok: false, canceled: true }
    return review.revertHunk(p, hunk)
  })
  ipcMain.handle('shell:git-commit', (_e, message) => {
    const r = review.commit(message)
    if (r.ok) log(`commit ${r.hash}: ${String(message).split('\n')[0]}`)
    return r
  })
  ipcMain.handle('shell:git-push', async () => {
    const c = review.changes()
    const r = await confirm({
      type: 'question',
      buttons: ['推送', '取消'],
      title: '推送到远端',
      message: `把 ${c.branch || '当前分支'} 推送到远端？`,
      detail: '这会把已提交的内容发布到远端仓库。',
    })
    if (r.response !== 0) return { ok: false, canceled: true }
    const out = review.push()
    log(out.ok ? `push ok (${out.branch})` : `push failed: ${out.error}`)
    return out
  })
  ipcMain.on('shell:splash-ready', () => {
    // 只认一次：预览窗口不会发这个事件，但内核已在跑时也绝不重复拉起
    if (state.child || state.ready) return
    state.splashAt = Date.now() // 渲染侧已订阅并开始播开场动画
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
  // 启动恢复链：坏插件隔离（≤4 轮）→ 补丁降级（full→bridge→none）。
  // 任何插件更新把内核搞崩，都会被降级成"禁用坏插件 + 通知"，应用本体永远可启动。
  await startKernelUntilReady({ degradePatch: true })
  state.elapsedMs = Date.now() - t0
  setStatus('ready', `已就绪（${(state.elapsedMs / 1000).toFixed(1)}s），正在进入工作区…`)

  if (SMOKE) {
    const ok = await probeReady()
    // 顺带验证淡出交接握手（不参与就绪判定，只把结果打进冒烟输出）
    const acked = await playSplashExit()
    console.log(`SMOKE_HANDOFF acked=${acked}`)
    console.log(ok ? `SMOKE_OK url=${state.url}` : 'SMOKE_FAIL probe-after-ready')
    state.quitting = true
    killChild()
    await sleep(800)
    app.exit(ok ? 0 : 1)
    return
  }

  if (!UI_SMOKE) await handoffFromSplash() // 观感交接：最短展示 + 合环停顿 + 淡出

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
  refreshMenus() // 就绪后"新窗口"等依赖内核的菜单项才可用
  pushThemeToKernel(themeId()) // 就绪后把当前皮肤同步给内核主题插件（重启内核同理）
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

  // 0) 全界面主题联动：palis-theme 插件应已随补丁注入内核
  try {
    await fetch(`${state.url}/api/palis-theme`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme: 'palis' }),
      signal: AbortSignal.timeout(3000),
    })
  } catch (err) {
    check('palis theme endpoint reachable', false)
  }
  await wait(3200) // 客户端 2s 轮询 + 余量
  check('kernel page wears palis (attr)', await js(`document.documentElement.hasAttribute('data-palis-theme')`))
  const tokenBg = await js(
    `getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-bg-base').trim()`)
  check('kernel token overridden to #0a0a0a', tokenBg === '#0a0a0a' || tokenBg === 'rgb(10, 10, 10)', tokenBg)
  check('crt overlay mounted', await js(`document.getElementById('palis-theme-crt') !== null`))
  // 回退验证：外壳皮肤必须是可逆的
  try {
    await fetch(`${state.url}/api/palis-theme`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme: '' }),
      signal: AbortSignal.timeout(3000),
    })
  } catch {}
  await wait(3200)
  check('kernel theme clears cleanly', await js(`!document.documentElement.hasAttribute('data-palis-theme')`))

  // 1) 点开关 → 面板展开
  await js(`document.getElementById('dsh-review-toggle').click()`)
  await wait(400)
  check('panel opens on toggle click', await js(`!document.getElementById('dsh-review-panel').classList.contains('dsh-hidden')`))
  // 共存模式（内核侧装有 better-sidebar 等右侧栏插件时）不挤压页面、隐藏自己的 rail ——
  // 这是设计行为：按实际模式断言，而不是固定期待 360px 挤压
  const coexist = await js(`document.getElementById('dsh-review-root').classList.contains('dsh-coexist')`)
  if (coexist) {
    check('coexist mode: page is not squeezed', await js(`document.body.style.marginRight === ''`))
    check('coexist mode: own rail hidden', await js(`getComputedStyle(document.getElementById('dsh-review-rail')).display === 'none'`))
  } else {
    check('split margin applied', await js(`document.body.style.marginRight === '360px'`))
  }

  // 2) 拖拽竖条 → 面板左缘跟随鼠标加宽 + 持久化（共存模式下跳过：拖拽把手让位了）
  const before = await js(`document.body.style.marginRight`)
  if (coexist) {
    check('drag test skipped (coexist mode)', true)
    check('width persistence skipped (coexist mode)', true)
  } else {
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
  }

  // 3) 双击竖条 → 恢复默认 360px（共存模式下拖拽把手已让位，跳过）
  if (coexist) {
    check('dblclick test skipped (coexist mode)', true)
  } else {
    await js(`(function(){
      const h = document.getElementById('dsh-review-rail')
      const r = h.getBoundingClientRect()
      h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: r.left + 3, clientY: r.top + 300 }))
    })()`)
    await wait(500)
    check('dblclick resets to 360px', await js(`document.body.style.marginRight === '360px'`))
  }

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
  app.on('second-instance', (_e, argv) => {
    const link = Array.isArray(argv) ? argv.find((a) => typeof a === 'string' && /^dsh:/i.test(a)) : null
    if (link) handleDeepLink(link)
    else showMainWindow()
  })

  // macOS 深链接
  app.on('open-url', (e, url) => {
    e.preventDefault()
    handleDeepLink(url)
  })

  app.whenReady().then(async () => {
    // 命令走原生菜单（菜单栏默认隐藏，accelerator 始终有效）；冒烟下不挂菜单
    refreshMenus()
    if (UI_SMOKE) {
      // UI 冒烟用临时 git 仓库作为内核工作目录（Git 视图/查看器测试）
      const repo = prepareUiSmokeRepo()
      if (repo) process.env.DSH_DESKTOP_CWD = repo
    }
    registerIpc()
    createWindow()
    // 冒烟/UI 冒烟不碰开机自启：那会改到真实用户的注册表项（Run 值按 AppUserModelId 命名），
    // 测试实例的默认设置会把用户真开着的自启项抹掉。
    if (!SMOKE && !UI_SMOKE) applyAutoLaunch() // 应用持久化的开机自启设置
    // 全局唤起热键 + 深链接注册（冒烟与开发态都不写注册表，避免污染真实环境）
    applyGlobalHotkey()
    if (app.isPackaged && !SMOKE && !UI_SMOKE) {
      try {
        app.setAsDefaultProtocolClient('dsh')
      } catch (err) {
        log(`protocol client failed: ${err.message}`)
      }
    }
    try {
      setupAutoUpdater() // 打包后生效；任何更新配置问题都不得阻断启动
    } catch (err) {
      log(`auto-update init failed: ${err && err.message ? err.message : err}`)
    }
    killStaleUpdaterInstallers() // 启动即清一次更新器残留（僵尸安装器会挡住下次更新）
    try {
      createTray()
    } catch (err) {
      log(`tray unavailable: ${err.message}`)
    }
    startTurnWatcher() // 回合完成通知（失焦才提醒；无审阅流时自动静默）
    // 首次启动就带 dsh:// 参数时也认（Windows 从浏览器点链接会走这里）
    const bootLink = process.argv.find((a) => typeof a === 'string' && /^dsh:/i.test(a))
    if (bootLink) setTimeout(() => handleDeepLink(bootLink), 1500)
    // 先加载 splash，等渲染侧确认订阅完成后才开始拉内核，避免丢状态事件
    win.once('ready-to-show', () => {
      if (!SMOKE && !UI_SMOKE) win.show()
    })
    await win.loadFile(SPLASH_PATH)
  })

  app.on('will-quit', () => {
    try {
      globalShortcut.unregisterAll()
    } catch {}
    if (state.turnTimer) clearInterval(state.turnTimer)
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
