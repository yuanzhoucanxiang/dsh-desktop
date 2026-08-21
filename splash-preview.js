'use strict'
/**
 * 开发工具：在真实窗口里预览启动画面（不拉内核、不碰正在运行的桌面版）
 *   npm run splash-preview                     成功流程循环播放（拉起 → 等待 → 就绪 → 淡出 → 重播）
 *   npm run splash-preview -- --theme=seascape  预览海景皮肤（缺省 deep）
 *   npm run splash-preview -- --error           末尾演示错误态（可点"重新启动"看恢复流程）
 *   npm run splash-preview -- --check           离屏跑一轮自检，打印 PREVIEW_CYCLE_OK 后退出（给 CI/agent 用）
 * 说明：本脚本不申请单实例锁、不写设置、不碰开机自启，因此可与已安装的桌面版同时运行。
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const WITH_ERROR = process.argv.includes('--error')
const CHECK = process.argv.includes('--check')
const THEME = (process.argv.find((a) => a.startsWith('--theme=')) || '').split('=')[1] || 'deep'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** @type {BrowserWindow | null} */
let win = null
let cycles = 0
let exited = false

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

async function timeline(forceSuccess) {
  const showError = WITH_ERROR && !forceSuccess
  send('shell:status', { phase: 'kernel' })
  await sleep(1600)
  send('shell:status', { phase: 'wait' })
  await sleep(1900)
  if (showError) {
    send('shell:boot-error', {
      message: '内核进程异常退出（code=1）\n（预览：这是错误态演示，点"重新启动"看恢复流程）',
      logTail: 'launching kernel: node .../bin.js web --port 8469\nkernel spawn error: ENOENT',
    })
    return
  }
  send('shell:status', { phase: 'ready', elapsedMs: 3500 })
  await sleep(900) // 与 main.js 的 READY_HOLD_MS 同量级
  send('shell:splash-exit')
  await sleep(900) // 等淡出播完（渲染侧 340ms + 余量）
  cycles++
  if (CHECK) {
    console.log(`PREVIEW_CYCLE_OK cycles=${cycles} exitAcked=${exited}`)
    app.exit(0)
    return
  }
  if (win && !win.isDestroyed()) win.webContents.reload() // reload → splash 再次 splashReady → 自动重播
}

app.whenReady().then(async () => {
  // 最小 IPC 桥桩：让 splash.js 走真实 preload 路径，观感与成品完全一致
  ipcMain.handle('shell:get-state', () => ({
    version: app.getVersion(),
    theme: THEME,
    phase: 'boot',
    message: '正在初始化…',
    port: 0,
    url: '',
    elapsedMs: 0,
    lastError: '',
    logTail: '',
  }))
  ipcMain.on('shell:splash-ready', () => { timeline() })
  ipcMain.on('shell:restart-kernel', () => { timeline(true) })
  ipcMain.on('shell:splash-exit-done', () => { exited = true })
  ipcMain.on('shell:copy-log', () => {})
  ipcMain.on('shell:quit', () => app.exit(0))

  win = new BrowserWindow({
    width: 1180,
    height: 820,
    show: true,
    center: !CHECK,
    x: CHECK ? -20000 : undefined,
    y: CHECK ? -20000 : undefined,
    skipTaskbar: CHECK,
    focusable: !CHECK,
    title: '启动画面预览 · DeepSeek Harness Desktop',
    backgroundColor: THEME === 'seascape' ? '#0a0b0c' : THEME === 'palis' ? '#0a0a0a' : '#05070f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  win.on('closed', () => { win = null; app.exit(0) })
  const url = pathToFileURL(path.join(__dirname, 'renderer', 'splash.html'))
  url.searchParams.set('theme', THEME)
  await win.loadURL(url.toString())
  if (CHECK) {
    setTimeout(() => { console.log('PREVIEW_TIMEOUT'); app.exit(1) }, 30000)
  }
}).catch((err) => {
  console.log('PREVIEW_FAIL', err && err.stack ? err.stack : err)
  app.exit(1)
})
