'use strict'

/* 启动画面逻辑：订阅主进程状态流，渲染进度/日志/错误；就绪后由主进程切换页面。 */

const $ = (id) => document.getElementById(id)
const statusText = $('statusText')
const progress = document.querySelector('.progress')
const statusPill = document.querySelector('.status')
const logEl = $('logTail')
const errorBox = $('errorBox')
const errorText = $('errorText')
const copyLogBtn = $('copyLogBtn')
const markImg = $('markImg')
const markTile = $('markTile')

const PHASE_TEXT = {
  boot: '正在初始化…',
  kernel: '正在拉起 Harness 内核…',
  wait: '正在等待服务就绪…',
  ready: '已就绪，正在进入工作区…',
  error: '启动失败',
}

// 四个官方鲸鱼图标按固定节奏循环轮换（与真实启动阶段解耦，保证快启动也能看清四版）
const ROTATION = [
  { src: '../build/icon-whale-official.png', cls: 'tile-light' },
  { src: '../build/icon-whale-tile-dark.png', cls: '' },
  { src: '../build/icon-whale-tile-white.png', cls: '' },
  { src: '../build/icon-whale-white.png', cls: 'tile-dark glow-white' },
]
const READY_MARK = { src: '../build/icon-whale-white.png', cls: 'tile-dark glow-white' }
const ERROR_MARK = { src: '../build/icon-whale-tile-dark.png', cls: '' }
const ROTATE_MS = 900

let rotateTimer = null
let markToken = 0

function showMark(mark) {
  // 同图同样式则跳过，避免重复触发闪烁（比较时忽略临时换场类 mark-pop）
  const nextCls = 'mark-tile' + (mark.cls ? ' ' + mark.cls : '')
  const curCls = markTile.className.replace(/mark-pop/g, '').trim()
  if (markImg.getAttribute('src') === mark.src && curCls === nextCls) return
  // 先淡出旧图，再换图淡入，避免生硬跳变；token 防止快速切换时旧定时器覆盖新状态
  const token = ++markToken
  markImg.style.opacity = '0'
  setTimeout(() => {
    if (token !== markToken) return
    markImg.src = mark.src
    markTile.className = nextCls
    markImg.style.opacity = ''
    // 重触发换场动画
    void markTile.offsetWidth
    markTile.classList.add('mark-pop')
  }, 160)
}

function startRotation() {
  if (rotateTimer) return
  let i = 0
  showMark(ROTATION[0])
  rotateTimer = setInterval(() => {
    i = (i + 1) % ROTATION.length
    showMark(ROTATION[i])
  }, ROTATE_MS)
}

function lockMark(mark) {
  if (rotateTimer) {
    clearInterval(rotateTimer)
    rotateTimer = null
  }
  showMark(mark)
}

function renderLog(tail) {
  if (!tail) { logEl.hidden = true; return }
  logEl.hidden = false
  const lines = tail.split('\n')
  logEl.textContent = lines.slice(-6).join('\n')
}

function renderError(info) {
  statusPill.classList.add('error')
  statusText.textContent = '启动失败'
  progress.classList.remove('done')
  errorBox.hidden = false
  errorText.textContent = info.message || '未知错误'
  renderLog(info.logTail || '')
  lockMark(ERROR_MARK)
}

function applyStatus(s) {
  let text = PHASE_TEXT[s.phase] || s.message || '…'
  if (s.phase === 'ready' && s.elapsedMs) {
    text = `已就绪（${(s.elapsedMs / 1000).toFixed(1)}s），正在进入工作区…`
  }
  if (statusText.textContent !== text) {
    statusText.textContent = text
    // 重触发淡入动画，让状态切换更平滑
    statusText.classList.remove('text-swap')
    void statusText.offsetWidth
    statusText.classList.add('text-swap')
  }

  if (s.phase === 'ready') {
    progress.classList.add('done')
    statusPill.classList.remove('error')
    lockMark(READY_MARK)
  } else if (s.phase === 'error') {
    statusPill.classList.add('error')
    lockMark(ERROR_MARK)
  } else {
    statusPill.classList.remove('error')
    startRotation()
  }
}

async function boot() {
  window.dshShell.onStatus(applyStatus)
  window.dshShell.onBootError(renderError)
  // 重启结果也反映到启动画面（成功→即将切换页面；失败→重新展示错误）
  window.dshShell.onKernel((s) => {
    if (s.alive) applyStatus({ phase: 'ready' })
    else renderError({ message: s.message })
  })

  const initial = await window.dshShell.status()
  applyStatus(initial)
  if (initial.phase === 'error') {
    renderError({ message: initial.lastError, logTail: initial.logTail })
    return
  }
  renderLog(initial.logTail)

  // 订阅完成，通知主进程可以开始拉内核了
  window.dshShell.splashReady()
}

copyLogBtn.addEventListener('click', () => {
  window.dshShell.copyLog()
  copyLogBtn.textContent = '已复制 ✓'
  setTimeout(() => { copyLogBtn.textContent = '复制日志' }, 1500)
})

$('retryBtn').addEventListener('click', () => {
  errorBox.hidden = true
  statusPill.classList.remove('error')
  progress.classList.remove('done')
  statusText.textContent = '正在重新启动内核…'
  startRotation()
  // 重启流程完全由主进程负责（拉起→就绪→切换页面），不要再发 splash-ready，避免双重拉起
  window.dshShell.restartKernel()
})
$('quitBtn').addEventListener('click', () => window.dshShell.quit())

boot()
