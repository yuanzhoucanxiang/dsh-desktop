'use strict'

/* 启动画面逻辑（极简克制版 · 双皮肤）：
 *   1. 入场闸门：窗口真正可见后才放行动画，保证从第 0 帧看到完整开场
 *   2. 进度引擎：把主进程相位（boot/kernel/wait/ready）映射成真实里程碑，
 *      里程碑之间做渐近爬升 —— 单调递增、永不回退、不假装跑完；
 *      同一个数值同时驱动两套皮肤：深海=光环弧长，海景=地平线铺开的宽度
 *   3. 状态文案：一行字交叉淡入，替代"胶囊 + 进度条 + 三点"的三重冗余
 *   4. 淡出交接：主进程发 shell:splash-exit → 整幕淡出 → 回 ack → 才 loadURL
 *   5. 错误恢复：错误面板（含日志尾巴）+ 复制日志 / 重启 / 退出
 *   6. 预览模式（splash.html?preview=1）：自驱动一轮演示，不碰内核、不发 splash-ready
 */

const $ = (id) => document.getElementById(id)

const stage = $('stage')
const mark = $('mark')
const statusRow = $('statusPill')
const statusText = $('statusText')
const ringArc = $('ringArc')
const ringTip = $('ringTip')
const horizonLine = $('horizonLine')
const logEl = $('logTail')
const errorBox = $('errorBox')
const errorText = $('errorText')
const copyLogBtn = $('copyLogBtn')

const PHASE_TEXT = {
  boot: '正在初始化…',
  kernel: '正在拉起 Harness 内核…',
  wait: '正在等待服务就绪…',
  ready: '已就绪，正在进入工作区…',
  error: '启动失败',
}

/** 相位里程碑：[到达即跳到] → [本相位最多爬到]（爬升是渐近的，永远到不了上限） */
const PHASE_P = {
  boot: [0.04, 0.15],
  kernel: [0.17, 0.58],
  wait: [0.60, 0.93],
  ready: [1, 1],
}

/** 皮肤：deep = 深海 · 单光环；seascape = 海景 · Seascape；palis = 复古科幻档案终端 */
const THEMES = {
  deep: { note: '内核零修改', title: 'DeepSeek Harness' },
  seascape: { note: '海景 · after Hiroshi Sugimoto', title: 'DeepSeek Harness' },
  palis: { note: 'PALIS // NODE 09A', title: 'DEEPSEEK HARNESS ARCHIVE' },
}

const RING_CIRC = 345.575 // 2π × r(55)，与 splash.css 的 stroke-dasharray 一致
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const query = new URLSearchParams(location.search)
const PREVIEW = query.get('preview') === '1'

let progress = 0
let ceiling = 0
let creepTimer = 0
let exiting = false
let flashTimer = 0
let currentTheme = 'deep'
let currentPhase = 'boot'

/* ─────────────────────────── 入场编排启动闸门 ─────────────────────────── */

// 隐藏加载期间 CSS 动画时间线行为因平台而异；等窗口真正可见再统一放行
// （CSS 规则：body:not(.is-live) 暂停所有入场动画）。
function armIntro() {
  let timer = 0
  function go() {
    document.body.classList.add('is-live')
    document.removeEventListener('visibilitychange', tryGo)
    window.removeEventListener('focus', tryGo)
    if (timer) clearInterval(timer)
  }
  function tryGo() {
    if (document.visibilityState === 'visible') go()
  }
  if (document.visibilityState === 'visible') {
    go()
  } else {
    // visibilitychange 为主，focus/轮询兜底，保证窗口显示后动画必然放行
    document.addEventListener('visibilitychange', tryGo)
    window.addEventListener('focus', tryGo)
    timer = setInterval(tryGo, 120)
  }
}

/* ─────────────────────────── 皮肤 ─────────────────────────── */

/** palis 的打字机：JS 逐字打出标题（CSS width 动画在离屏合成下不渲染文字，已弃用） */
let typeTimer = 0
function typePalisTitle() {
  const titleEl = $('title')
  const full = THEMES.palis.title
  if (typeTimer) clearInterval(typeTimer)
  if (reducedMotion.matches) {
    titleEl.textContent = full
    return
  }
  titleEl.textContent = ''
  const cursor = document.createElement('span')
  cursor.className = 'type-cursor'
  titleEl.appendChild(cursor)
  let n = 0
  typeTimer = setInterval(() => {
    if (n >= full.length) {
      clearInterval(typeTimer)
      typeTimer = 0
      cursor.remove()
      return
    }
    n++
    cursor.before(document.createTextNode(full[n - 1]))
  }, 48)
}

/** 应用皮肤：只切 body[data-theme] + 页脚署名，三套皮肤共用同一套 DOM 与进度数值 */
function applyTheme(id) {
  const theme = THEMES[id] ? id : 'deep'
  if (document.body.dataset.theme === theme) return
  document.body.dataset.theme = theme
  currentTheme = theme
  const titleEl = $('title')
  if (theme === 'palis') {
    typePalisTitle()
  } else {
    if (typeTimer) { clearInterval(typeTimer); typeTimer = 0 }
    titleEl.textContent = THEMES[theme].title
  }
  titleEl.setAttribute('aria-label', THEMES[theme].title)
  $('footerNote').textContent = THEMES[theme].note
  paintProgress() // 换皮肤后立刻按当前进度重画（弧/地平线/日志各归各位）
  renderBootLog() // palis 的日志面板按当前状态立即重画
}

/* ─────────────────────────── 进度：一个数值，三种表达 ─────────────────────────── */

function paintProgress() {
  // 深海：光环弧长 + 弧尖光点
  ringArc.style.strokeDashoffset = String(RING_CIRC * (1 - progress))
  ringTip.style.transform = `rotate(${(progress * 360).toFixed(2)}deg)`
  ringTip.style.opacity = progress > 0.015 ? '1' : '0'
  // 海景：地平线从正中向两侧铺开（scaleX 与进度同值）
  horizonLine.style.transform = `scaleX(${progress.toFixed(4)})`
}

/** PALIS 引导日志：状态行逐行输出 + 一行方括号空格进度（与全局 progress 同步） */
const BOOT_ROWS = {
  boot: ['SYS  INIT', 'MOUNT /dev/kernel'],
  kernel: ['MOUNT /dev/kernel', 'LOAD AGENT RUNTIME'],
  wait: ['LOAD AGENT RUNTIME', 'AWAIT SERVICE LINK'],
  ready: ['AWAIT SERVICE LINK', 'LINK OK'],
  error: ['AWAIT SERVICE LINK', 'ABORT'],
}

function renderBootLog() {
  const el = $('bootLog')
  if (!el) return
  if (currentTheme !== 'palis') {
    el.textContent = ''
    return
  }
  const phase = currentPhase
  const rows = BOOT_ROWS[phase] || BOOT_ROWS.boot
  const html = rows.map((r, i) => {
    const cls = phase === 'error' && i === rows.length - 1 ? 'ln-red' : 'ln-ok'
    return `<span class="${cls}">[ ${r} ]</span>`
  }).join('\n')
  const ticks = Math.max(0, Math.min(20, Math.round(progress * 20)))
  let cells = ''
  for (let i = 0; i < 20; i++) cells += `<i class="${i < ticks ? 'on' : ''}"></i>`
  const progCls = phase === 'error' ? 'ln-red' : phase === 'ready' ? 'ln-blue' : 'ln-dim'
  el.innerHTML = html
    + `\n<span class="${progCls}">[ <span class="ln-prog">${cells}</span> ] ${Math.round(progress * 100)}%</span>`
    + '\n<span class="ln-dim">&gt; <span class="cursor"></span></span>'
}

/** 推进 PALIS 日志（每次 advance 都跟着重画，保持与全局进度同源） */
function paintPalisLog() {
  if (currentTheme === 'palis') renderBootLog()
}

/** 相位切换时的一次性扫描线闪烁（palis 专属；deep/seascape 保持各自的绽放） */
function scanFlash() {
  if (currentTheme !== 'palis') return
  stage.classList.remove('flash')
  void stage.offsetWidth
  stage.classList.add('flash')
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => stage.classList.remove('flash'), 420)
}

/** 唯一的进度写入口：只接受"更大的值"，从机制上保证光环不回退 */
function advance(value) {
  const next = Math.max(progress, Math.min(1, value))
  if (next === progress) return
  progress = next
  paintProgress()
  paintPalisLog()
}

function stopCreep() {
  if (creepTimer) clearInterval(creepTimer)
  creepTimer = 0
}

/** 里程碑之间的渐近爬升：越接近本相位上限越慢，等得久也不会撞线 */
function startCreep() {
  stopCreep()
  if (reducedMotion.matches) return
  creepTimer = setInterval(() => {
    if (exiting || progress >= ceiling - 0.002) return
    advance(progress + (ceiling - progress) * 0.085)
  }, 200)
}

function setPhaseProgress(phase) {
  const milestone = PHASE_P[phase]
  if (!milestone) return
  ceiling = Math.max(ceiling, milestone[1])
  advance(milestone[0])
  if (phase === 'ready') stopCreep()
  else startCreep()
}

function resetProgress() {
  stopCreep()
  progress = 0
  ceiling = 0
  const frozen = [ringArc, ringTip, horizonLine]
  for (const el of frozen) el.style.transition = 'none'
  paintProgress()
  renderBootLog() // palis 的引导日志也要跟着归零
  // 强制回流后恢复过渡，避免"归零"这一步被动画成倒退
  void ringArc.getBoundingClientRect()
  for (const el of frozen) el.style.transition = ''
}

/* ─────────────────────────── 状态渲染 ─────────────────────────── */

function setStatusText(text) {
  if (statusText.textContent === text) return
  statusText.textContent = text
  statusText.classList.remove('text-swap')
  void statusText.offsetWidth
  statusText.classList.add('text-swap')
}

/** 相位切换时的一次性能量绽放（不循环，只在 ready/error 这类节点上用） */
function bloom() {
  mark.classList.remove('bloom')
  void mark.offsetWidth
  mark.classList.add('bloom')
}

function setVisual(phase) {
  const ready = phase === 'ready'
  const failed = phase === 'error'
  mark.classList.toggle('is-ready', ready)
  mark.classList.toggle('is-error', failed)
  stage.classList.toggle('ready', ready)
  stage.classList.toggle('failed', failed)
  statusRow.classList.toggle('is-ready', ready)
  statusRow.classList.toggle('is-error', failed)
  if (failed) stopCreep() // 错误就停在原地，不假装跑完
  if (ready || failed) bloom()
  scanFlash() // palis：相位节点来一次扫描线闪烁（其余皮肤无感）
  renderBootLog()
}

function renderLog(tail) {
  if (!tail) {
    logEl.hidden = true
    return
  }
  logEl.hidden = false
  logEl.textContent = String(tail).split('\n').slice(-5).join('\n')
}

function renderError(info) {
  currentPhase = 'error' // palis 引导日志要能切成 ABORT 行
  setVisual('error')
  setStatusText(PHASE_TEXT.error)
  errorBox.hidden = false
  errorText.textContent = (info && info.message) || '未知错误'
  renderLog(info && info.logTail)
}

function applyStatus(s) {
  const phase = (s && s.phase) || 'boot'
  currentPhase = phase
  let text = PHASE_TEXT[phase] || (s && s.message) || '…'
  if (phase === 'ready' && s && s.elapsedMs) {
    text = `已就绪（${(s.elapsedMs / 1000).toFixed(1)}s），正在进入工作区…`
  }
  setStatusText(text)
  setPhaseProgress(phase)
  setVisual(phase)
}

function setVersionText(version) {
  $('versionText').textContent = version ? `外壳 v${version}` : '外壳'
}

/* ─────────────────────────── 淡出交接 ─────────────────────────── */

/** 主进程在 loadURL 之前调用；播完淡出回 ack，让工作区在黑场里接手 */
function playExit() {
  if (exiting) return
  exiting = true
  stopCreep()
  advance(1)
  stage.classList.add('is-leaving')
  const wait = reducedMotion.matches ? 40 : 340
  setTimeout(() => {
    if (!PREVIEW && window.dshShell && window.dshShell.splashExitDone) window.dshShell.splashExitDone()
  }, wait)
}

/* ─────────────────────────── 预览模式（自驱动一轮演示） ─────────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 托盘「预览启动画面」用：走一遍完整启动节奏，播完 reload 重头再来（真实的第 0 帧） */
async function previewCycle(forceSuccess) {
  const demoError = query.get('error') === '1' && !forceSuccess
  applyStatus({ phase: 'kernel' })
  await sleep(1500)
  applyStatus({ phase: 'wait' })
  await sleep(1800)
  if (demoError) {
    renderError({
      message: '内核进程异常退出（code=1）\n（预览：错误态演示，点"重新启动"看恢复流程）',
      logTail: 'launching kernel: node .../bin.js web --port 8469\nkernel spawn error: ENOENT',
    })
    return
  }
  applyStatus({ phase: 'ready', elapsedMs: 3300 })
  await sleep(950)
  playExit()
  await sleep(1000)
  location.reload()
}

/* ─────────────────────────── 启动桥接 ─────────────────────────── */

async function boot() {
  const themeFromQuery = query.get('theme')
  if (themeFromQuery) applyTheme(themeFromQuery)

  // 预览窗口：只演示，不参与真实启动（绝不发 splash-ready，避免把内核再拉一遍）
  if (PREVIEW) {
    if (window.dshShell) {
      try {
        const s = await window.dshShell.status()
        setVersionText(s.version)
        if (!themeFromQuery) applyTheme(s.theme)
      } catch (err) {
        console.error('preview bridge failed:', err)
      }
    }
    previewCycle()
    return
  }

  if (!window.dshShell) {
    // 独立打开 splash.html（调试/截图工具未挂桥）时给一个可看的静态进度
    setVersionText('')
    setPhaseProgress('kernel')
    setStatusText(PHASE_TEXT.kernel)
    return
  }

  window.dshShell.onStatus(applyStatus)
  window.dshShell.onBootError(renderError)
  if (window.dshShell.onSplashExit) window.dshShell.onSplashExit(playExit)
  if (window.dshShell.onTheme) window.dshShell.onTheme(applyTheme) // 托盘里换皮肤即时生效
  // 重启结果也反映到启动画面（成功→即将切换页面；失败→重新展示错误）
  window.dshShell.onKernel((s) => {
    if (s && s.alive) applyStatus({ phase: 'ready' })
    else renderError({ message: s && s.message })
  })

  try {
    const initial = await window.dshShell.status()
    if (!themeFromQuery) applyTheme(initial.theme)
    applyStatus(initial)
    setVersionText(initial.version)
    if (initial.phase === 'error') {
      renderError({ message: initial.lastError, logTail: initial.logTail })
      return
    }

    // 订阅完成，通知主进程可以开始拉内核了
    window.dshShell.splashReady()
  } catch (err) {
    console.error('splash bridge failed:', err)
  }
}

/* ─────────────────────────── 交互 ─────────────────────────── */

let copyResetTimer = null
copyLogBtn.addEventListener('click', () => {
  if (!window.dshShell) return
  window.dshShell.copyLog()
  copyLogBtn.textContent = '已复制 ✓'
  clearTimeout(copyResetTimer)
  copyResetTimer = setTimeout(() => { copyLogBtn.textContent = '复制日志' }, 1500)
})

$('retryBtn').addEventListener('click', () => {
  errorBox.hidden = true
  logEl.hidden = true
  setVisual('boot')
  resetProgress() // 真正的重来一次：允许归零，但只在用户显式重启时
  setPhaseProgress('boot')
  setStatusText('正在重新启动内核…')
  if (PREVIEW) {
    previewCycle(true) // 预览里演示"恢复成功"
    return
  }
  if (!window.dshShell) return
  // 重启流程完全由主进程负责（拉起→就绪→切换页面），不要再发 splash-ready，避免双重拉起
  window.dshShell.restartKernel()
})

$('quitBtn').addEventListener('click', () => {
  if (PREVIEW) {
    window.close() // 预览窗口只关自己，不退整个应用
    return
  }
  if (window.dshShell) window.dshShell.quit()
})

armIntro()
paintProgress()
setVersionText()
boot()
