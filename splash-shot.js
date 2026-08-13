'use strict'
// 调试工具：截图启动画面并保存（用于人工/像素检查 splash 是否正常渲染）
// 运行：electron splash-shot.js
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1360, height: 920, show: false,
    backgroundColor: '#070b16',
    webPreferences: { offscreen: false },
  })
  await win.loadFile(path.join(__dirname, 'renderer', 'splash.html'))
  await new Promise((r) => setTimeout(r, 900))
  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(__dirname, 'build', 'splash-preview.png'), img.toPNG())
  console.log('SPLASH_SHOT_OK')
  win.destroy()
  app.exit(0)
})
