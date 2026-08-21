'use strict'
// 调试工具：截图启动画面并保存（用于人工/像素检查 splash 是否正常渲染）
// 运行：electron splash-shot.js              → 每套皮肤各一张"拉起中"
//       electron splash-shot.js --states     → 每套皮肤三张：拉起中 / 就绪 / 失败
//       electron splash-shot.js --theme=seascape  → 只截某一套皮肤
// 产物：build/splash-preview-<theme>[-ready|-error].png（已 gitignore）
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ALL_STATES = process.argv.includes('--states')
const only = (process.argv.find((a) => a.startsWith('--theme=')) || '').split('=')[1]
const THEMES = only ? [only] : ['deep', 'seascape', 'palis']
const SPLASH = path.join(__dirname, 'renderer', 'splash.html')
const OUT = path.join(__dirname, 'build')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  // 挂最小 IPC 桥桩：让 splash.js 走真实 preload 路径，渲染与成品完全一致
  ipcMain.handle('shell:get-state', () => ({
    version: app.getVersion(),
    theme: 'deep',
    phase: 'kernel',
    message: '正在拉起 Harness 内核…',
    port: 0,
    url: '',
    elapsedMs: 0,
    lastError: '',
    logTail: '',
  }))
  ipcMain.on('shell:splash-ready', () => {})
  ipcMain.on('shell:restart-kernel', () => {})
  ipcMain.on('shell:copy-log', () => {})
  ipcMain.on('shell:quit', () => {})
  ipcMain.on('shell:splash-exit-done', () => {})

  fs.mkdirSync(OUT, { recursive: true })
  const alive = [] // 不销毁窗口：窗口数归零会触发 Electron 退出应用，后续 load 全失败

  for (const theme of THEMES) {
    const win = new BrowserWindow({
      width: 1360,
      height: 920,
      show: true,           // 离屏可见：隐藏窗口会冻结 CSS 动画，截图会停在第 0 帧
      x: -20000,
      y: -20000,
      skipTaskbar: true,
      focusable: false,
      backgroundColor: theme === 'seascape' ? '#0a0b0c' : theme === 'palis' ? '#0a0a0a' : '#05070f',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: true,
        offscreen: false,
        backgroundThrottling: false, // 隐藏窗口也让 CSS 动画走完，截图反映真实动画态
      },
    })
    alive.push(win)
    const url = pathToFileURL(SPLASH)
    url.searchParams.set('theme', theme)
    await win.loadURL(url.toString())
    await sleep(1800)

    const snap = async (name) => {
      await sleep(250)
      const img = await win.webContents.capturePage()
      fs.writeFileSync(path.join(OUT, name), img.toPNG())
      console.log('SPLASH_SHOT_OK ' + name)
    }

    await snap(`splash-preview-${theme}.png`)

    if (ALL_STATES) {
      win.webContents.send('shell:status', { phase: 'ready', elapsedMs: 1840 })
      await sleep(1100)
      await snap(`splash-preview-${theme}-ready.png`)

      win.webContents.send('shell:boot-error', {
        message: '内核进程异常退出（code=1）',
        logTail: 'launching kernel: node ... (cwd=...)\nkernel spawn error: ENOENT',
      })
      await sleep(900)
      await snap(`splash-preview-${theme}-error.png`)
    }
  }

  app.exit(0)
}).catch((err) => {
  console.log('SPLASH_SHOT_FAIL', err && err.stack ? err.stack : err)
  app.exit(1)
})
