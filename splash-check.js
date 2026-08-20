'use strict'
// 调试工具：splash 布局与行为回归检查（不弹窗、测完自动退出，exit 0 = 通过）
// 运行：electron splash-check.js  （或 npm run splash-check）
// 覆盖两套皮肤：deep（深海 · 单光环）/ seascape（海景 · Seascape）
// 检查项：
//   1. 两套皮肤 × 四种窗口尺寸（含应用最小 980×640）下所有可见元素都在视口内
//   2. 卡片水平居中、无滚动溢出、页脚不与内容重叠、徽标区正方、鲸鱼居中
//   3. 装饰层 pointer-events:none（不挡按钮）
//   4. 海景的"概念约束"：地平线正落在画面中线、天与海等高、鲸鱼在海面之下、署名致敬
//   5. 进度单调递增永不回退：深海=光环 dashoffset，海景=地平线 scaleX（含迟到旧相位）
//   6. 错误态：两套皮肤在最小尺寸下面板完整可见、进度就地冻结（不假装跑完）
//   7. 恢复入口：点"重新启动"清面板 + 光环合法归零 + 真的发出 restart IPC
//   8. 淡出交接握手：收到 shell:splash-exit 后版心淡出并回 shell:splash-exit-done
//   9. 像素取证（每套皮肤各开一个干净窗口截一次图）：白鲸够亮、四角够暗、
//      深海的弧真的画在 12 点钟、海景近乎单色且天比海亮、地平线是最亮的一条带
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

app.disableHardwareAcceleration()

// 兜底：脚本自身出错或卡住时必须"响亮地失败"，绝不无声挂住（历史上挂住过一次）
const WATCHDOG_MS = 240000
const watchdog = setTimeout(() => {
  console.log('FAIL watchdog: splash-check exceeded ' + WATCHDOG_MS + 'ms')
  app.exit(1)
}, WATCHDOG_MS)
watchdog.unref && watchdog.unref()
const die = (tag) => (err) => {
  console.log(`FAIL ${tag}: ${err && err.stack ? err.stack : err}`)
  app.exit(1)
}
process.on('uncaughtException', die('uncaughtException'))
process.on('unhandledRejection', die('unhandledRejection'))

const SPLASH = path.join(__dirname, 'renderer', 'splash.html')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const THEMES = ['deep', 'seascape']

function registerStubs() {
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
}

function makeWindow(query) {
  return new BrowserWindow({
    width: 1360,
    height: 920,
    show: true,           // 离屏可见：隐藏窗口会冻结 CSS 动画，测不到最终布局
    x: -20000,
    y: -20000,
    skipTaskbar: true,
    focusable: false,
    backgroundColor: '#05070f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      offscreen: false,
      backgroundThrottling: false, // 隐藏窗口也让 CSS 动画走完，测到的是最终布局
    },
  })
}

const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}${detail ? ' | ' + detail : ''}`)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  [' + detail + ']' : ''}`)
}

/* ══════════════════════════ 像素取证（每套皮肤一个干净窗口） ══════════════════════════
   注意：capturePage 之后离屏窗口的合成器会停摆（CSS 过渡不再推进），所以像素采样
   一律用一次性窗口，且放在所有行为断言之后，避免污染基于过渡的测量。 */
async function shootTheme(theme) {
  const w = makeWindow()
  // loadFile(path,{query}) 在含空格的路径上会拼出非法 URL（ERR_FAILED），用 file:// URL
  const url = pathToFileURL(SPLASH)
  url.searchParams.set('theme', theme)
  await w.loadURL(url.toString())
  await sleep(1500)
  w.webContents.send('shell:status', { phase: 'ready', elapsedMs: 1840 })
  await sleep(1400) // 等就绪过渡与一次性绽放走完
  const exec = (js) => w.webContents.executeJavaScript(js, true)
  const anchors = await exec(`(function () {
    const b = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { l: r.left, t: r.top, r: r.right, b: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }
    }
    return { whale: b('.mark-whale'), mark: b('.mark'), title: b('.title'), vw: innerWidth, vh: innerHeight }
  })()`)
  let shot = null
  for (let i = 0; i < 5 && !shot; i++) {
    try {
      shot = await w.webContents.capturePage()
    } catch (err) {
      console.log(`… capturePage retry ${i + 1} (${theme}): ${err.message}`)
      await sleep(500)
    }
  }
  if (!shot) throw new Error(`capturePage failed for theme=${theme}`)
  const size = shot.getSize()
  const bmp = shot.toBitmap() // BGRA
  // 注意：不要 destroy —— 一旦窗口数归零，Electron 默认的 window-all-closed 会开始退出应用，
  // 之后新建窗口的 load 全都 ERR_FAILED（本脚本踩过这个坑）。统一交给 app.exit 收尾。
  w.hide()
  return { anchors, size, bmp }
}

function sampler(shot) {
  const { width, height } = shot.size
  const bmp = shot.bmp
  const sx = width / shot.anchors.vw // capturePage 输出物理像素，DOM 坐标是 CSS 像素
  const sy = height / shot.anchors.vh
  const at = (x, y) => {
    const X = Math.max(0, Math.min(width - 1, Math.round(x)))
    const Y = Math.max(0, Math.min(height - 1, Math.round(y)))
    const i = (Y * width + X) * 4
    return { r: bmp[i + 2], g: bmp[i + 1], b: bmp[i], l: 0.299 * bmp[i + 2] + 0.587 * bmp[i + 1] + 0.114 * bmp[i] }
  }
  /** 区域统计（CSS 像素输入，自动换算到物理像素） */
  const region = (x0, y0, x1, y1) => {
    let sum = 0
    let n = 0
    let max = 0
    let chroma = 0
    for (let y = y0 * sy; y <= y1 * sy; y += 2) {
      for (let x = x0 * sx; x <= x1 * sx; x += 2) {
        const p = at(x, y)
        sum += p.l
        if (p.l > max) max = p.l
        chroma = Math.max(chroma, Math.abs(p.r - p.g), Math.abs(p.g - p.b), Math.abs(p.r - p.b))
        n++
      }
    }
    return { mean: n ? sum / n : 0, max, chroma, n }
  }
  return { region, at, sx, sy, width, height, vw: shot.anchors.vw, vh: shot.anchors.vh, anchors: shot.anchors }
}

app.whenReady().then(async () => {
  registerStubs()
  const win = makeWindow()
  await win.loadFile(SPLASH)
  await sleep(1500)

  const exec = (js) => win.webContents.executeJavaScript(js, true)

  /** 切皮肤走真实 IPC 通道（顺带验证 shell:theme 桥可用） */
  const setTheme = async (id) => {
    win.webContents.send('shell:theme', id)
    await sleep(300)
    const applied = await exec(`document.body.dataset.theme`)
    if (applied !== id) throw new Error(`theme not applied: ${applied} != ${id}`)
  }

  const measure = () => exec(`(function () {
    const box = (sel) => {
      const el = document.querySelector(sel)
      if (!el || el.hidden) return null
      const b = el.getBoundingClientRect()
      return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }
    }
    const card = document.querySelector('.card').getBoundingClientRect()
    const pe = (sel) => getComputedStyle(document.querySelector(sel)).pointerEvents
    return {
      vw: innerWidth, vh: innerHeight,
      sw: document.documentElement.scrollWidth,
      sh: document.documentElement.scrollHeight,
      theme: document.body.dataset.theme,
      card: box('.card'), mark: box('.mark'), title: box('.title'),
      subtitle: box('.subtitle'), status: box('.status'), footer: box('.footer'),
      whale: box('.mark-whale'), log: box('.log'), error: box('#errorBox'),
      sky: box('.sky'), sea: box('.sea'), horizon: box('.horizon'), print: box('.print'),
      cardCenter: card.left + card.width / 2,
      pe: { glow: pe('.glow'), print: pe('.print'), ring: pe('.ring') },
    }
  })()`)

  const arcOffset = () => exec(
    `parseFloat(getComputedStyle(document.getElementById('ringArc')).strokeDashoffset)`)
  const horizonScale = () => exec(`(function () {
    const t = getComputedStyle(document.getElementById('horizonLine')).transform
    return t === 'none' ? 1 : new DOMMatrixReadOnly(t).a
  })()`)

  /* ── 1&2&3. 布局：两套皮肤 × 四种尺寸 ─────────────────────────────────────── */
  const SIZES = [[1360, 920], [1600, 1000], [980, 640], [1100, 660]]
  for (const theme of THEMES) {
    await setTheme(theme)
    const minMark = theme === 'deep' ? 110 : 50
    for (const [w, h] of SIZES) {
      win.setSize(w, h)
      await sleep(450)
      const m = await measure()
      const label = `${theme}@${w}x${h}`
      for (const key of ['card', 'mark', 'title', 'subtitle', 'status', 'footer', 'whale']) {
        const el = m[key]
        if (!el) {
          check(`[${label}] ${key} exists`, false)
          continue
        }
        const inside = el.l >= -0.5 && el.t >= -0.5 && el.r <= m.vw + 0.5 && el.b <= m.vh + 0.5
        check(`[${label}] ${key} inside viewport`, inside,
          `l=${el.l.toFixed(1)} t=${el.t.toFixed(1)} r=${el.r.toFixed(1)} b=${el.b.toFixed(1)}`)
      }
      check(`[${label}] no scroll overflow`, m.sw <= m.vw && m.sh <= m.vh, `scroll=${m.sw}x${m.sh}`)
      check(`[${label}] card horizontally centered`, Math.abs(m.cardCenter - m.vw / 2) < 1.5,
        `delta=${(m.cardCenter - m.vw / 2).toFixed(2)}px`)
      check(`[${label}] footer below content`, m.footer.t > m.card.b,
        `footerTop=${m.footer.t.toFixed(1)} cardBottom=${m.card.b.toFixed(1)}`)
      check(`[${label}] mark is square & sane`, Math.abs(m.mark.w - m.mark.h) < 1.5 && m.mark.w >= minMark,
        `${m.mark.w.toFixed(1)}x${m.mark.h.toFixed(1)}`)
      check(`[${label}] whale centered in mark`,
        Math.abs((m.whale.l + m.whale.r) / 2 - (m.mark.l + m.mark.r) / 2) < 1.5 &&
        Math.abs((m.whale.t + m.whale.b) / 2 - (m.mark.t + m.mark.b) / 2) < 4,
        `whaleC=${((m.whale.l + m.whale.r) / 2).toFixed(1)},${((m.whale.t + m.whale.b) / 2).toFixed(1)}`)
      check(`[${label}] log hidden on normal boot`, m.log === null || m.log.h === 0, 'no log clutter')
      check(`[${label}] decor layers click-through`,
        m.pe.glow === 'none' && m.pe.print === 'none' && m.pe.ring === 'none', JSON.stringify(m.pe))
    }
  }

  /* ── 4. 海景的概念约束（《海景》的规矩，不许漂移） ───────────────────────── */
  await setTheme('seascape')
  for (const [w, h] of [[1360, 920], [980, 640]]) {
    win.setSize(w, h)
    await sleep(450)
    const m = await measure()
    const label = `seascape@${w}x${h}`
    const mid = m.vh / 2
    const hz = m.horizon.t + m.horizon.h / 2
    check(`[${label}] horizon sits on the exact midline`, Math.abs(hz - mid) <= 1,
      `horizon=${hz.toFixed(2)} mid=${mid.toFixed(2)}`)
    check(`[${label}] sky and sea are equal halves`, Math.abs(m.sky.h - m.sea.h) <= 1,
      `sky=${m.sky.h.toFixed(1)} sea=${m.sea.h.toFixed(1)}`)
    check(`[${label}] sky meets sea at the horizon`,
      Math.abs(m.sky.b - hz) <= 1 && Math.abs(m.sea.t - hz) <= 1,
      `skyBottom=${m.sky.b.toFixed(1)} seaTop=${m.sea.t.toFixed(1)}`)
    check(`[${label}] print is full-bleed`,
      m.print.l <= 0.5 && m.print.t <= 0.5 && m.print.r >= m.vw - 0.5 && m.print.b >= m.vh - 0.5,
      `print=${m.print.w.toFixed(0)}x${m.print.h.toFixed(0)}`)
    check(`[${label}] whale swims below the horizon`, m.whale.t > hz,
      `whaleTop=${m.whale.t.toFixed(1)} horizon=${hz.toFixed(1)}`)
    check(`[${label}] sky half stays empty`, m.mark.t > hz && m.title.t > hz,
      `markTop=${m.mark.t.toFixed(1)} titleTop=${m.title.t.toFixed(1)}`)
  }
  const credit = await exec(`document.getElementById('footerNote').textContent`)
  check('seascape: footer credits Hiroshi Sugimoto', /Sugimoto/i.test(credit), credit)

  /* ── 5. 进度单调递增：两套皮肤各自的表达 ─────────────────────────────────── */
  win.setSize(1360, 920)
  await sleep(400)
  const resetViaRetry = async () => {
    await exec(`(document.getElementById('retryBtn').click(), 1)`)
    await sleep(500)
  }
  const sendPhase = async (phase, extra) => {
    win.webContents.send('shell:status', Object.assign({ phase }, extra || {}))
    await sleep(900) // 覆盖过渡 + 一次爬升 tick
  }

  await setTheme('deep')
  await resetViaRetry()
  await sendPhase('kernel')
  const d1 = await arcOffset()
  await sendPhase('wait')
  const d2 = await arcOffset()
  await sendPhase('boot') // 迟到的旧相位
  const d3 = await arcOffset()
  await sendPhase('ready', { elapsedMs: 1840 })
  const d4 = await arcOffset()
  check('ring: arc rendered (not empty)', d1 < 345.575 - 2, `offset=${d1.toFixed(1)}`)
  check('ring: wait advances', d2 < d1 - 2, `${d1.toFixed(1)} → ${d2.toFixed(1)}`)
  check('ring: stale phase never rewinds', d3 <= d2 + 0.5, `${d2.toFixed(1)} → ${d3.toFixed(1)}`)
  check('ring: ready closes the loop', d4 <= 1.5, `offset=${d4.toFixed(2)}`)

  await setTheme('seascape')
  await resetViaRetry()
  await sendPhase('kernel')
  const s1 = await horizonScale()
  await sendPhase('wait')
  const s2 = await horizonScale()
  await sendPhase('boot') // 迟到的旧相位
  const s3 = await horizonScale()
  await sendPhase('ready', { elapsedMs: 1840 })
  const s4 = await horizonScale()
  check('horizon: starts drawing from the middle', s1 > 0.02 && s1 < 0.9, `scaleX=${s1.toFixed(3)}`)
  check('horizon: wait advances', s2 > s1 + 0.02, `${s1.toFixed(3)} → ${s2.toFixed(3)}`)
  check('horizon: stale phase never rewinds', s3 >= s2 - 0.002, `${s2.toFixed(3)} → ${s3.toFixed(3)}`)
  check('horizon: ready spans edge to edge', s4 >= 0.995, `scaleX=${s4.toFixed(4)}`)

  /* ── 6. 错误态：两套皮肤 @980×640 ───────────────────────────────────────── */
  for (const theme of THEMES) {
    await setTheme(theme)
    win.setSize(980, 640)
    await sleep(400)
    await resetViaRetry()          // 归零，让进度停在半途才测得出"冻结"
    await sendPhase('kernel')
    win.webContents.send('shell:boot-error', {
      message: '内核进程异常退出（code=1）',
      logTail: 'launching kernel: node ... (cwd=...)\nkernel spawn error: ENOENT',
    })
    await sleep(800)
    const m = await measure()
    const label = `error:${theme}@980x640`
    check(`[${label}] error panel exists`, !!m.error && m.error.h > 0)
    if (m.error) {
      check(`[${label}] error panel inside viewport`,
        m.error.l >= -0.5 && m.error.t >= -0.5 && m.error.r <= m.vw + 0.5 && m.error.b <= m.vh + 0.5,
        `l=${m.error.l.toFixed(1)} t=${m.error.t.toFixed(1)} r=${m.error.r.toFixed(1)} b=${m.error.b.toFixed(1)}`)
      check(`[${label}] error panel clears footer`, m.error.b <= m.footer.t,
        `errorBottom=${m.error.b.toFixed(1)} footerTop=${m.footer.t.toFixed(1)}`)
      check(`[${label}] log tail visible inside panel`,
        !!m.log && m.log.h > 0 && m.log.b <= m.error.b + 0.5,
        m.log ? `logBottom=${m.log.b.toFixed(1)}` : 'log missing')
    }
    const cls = await exec(
      `document.getElementById('mark').className + '|' + document.getElementById('stage').className`)
    check(`[${label}] error state styled`, /is-error/.test(cls) && /failed/.test(cls), cls)
    if (theme === 'deep') {
      const frozen = await arcOffset()
      check(`[${label}] arc freezes instead of faking completion`, frozen > 2, `offset=${frozen.toFixed(1)}`)
    } else {
      const frozen = await horizonScale()
      check(`[${label}] horizon freezes instead of faking completion`, frozen < 0.97, `scaleX=${frozen.toFixed(3)}`)
      const printOpacity = await exec(`parseFloat(getComputedStyle(document.querySelector('.print')).opacity)`)
      check(`[${label}] print recedes behind the plate`, printOpacity < 0.9, `opacity=${printOpacity}`)
    }
  }

  /* ── 7. 恢复入口：点"重新启动" ──────────────────────────────────────────── */
  const restarted = new Promise((resolve) => {
    const t = setTimeout(() => {
      ipcMain.removeListener('shell:restart-kernel', hit)
      resolve(false)
    }, 1500)
    const hit = () => { clearTimeout(t); resolve(true) }
    ipcMain.once('shell:restart-kernel', hit)
  })
  await exec(`(document.getElementById('retryBtn').click(), 1)`)
  check('[retry] restart-kernel IPC sent', await restarted === true)
  await sleep(600)
  const afterRetry = await measure()
  check('[retry] error panel hidden', afterRetry.error === null || afterRetry.error.h === 0,
    afterRetry.error ? `h=${afterRetry.error.h}` : 'hidden')
  const retryCls = await exec(`document.getElementById('mark').className`)
  check('[retry] error styling cleared', !/is-error/.test(retryCls), retryCls)
  const retryScale = await horizonScale()
  check('[retry] progress restarts from the beginning', retryScale < 0.2, `scaleX=${retryScale.toFixed(3)}`)

  /* ── 8. 淡出交接握手 ────────────────────────────────────────────────────── */
  const acked = await new Promise((resolve) => {
    const t = setTimeout(() => {
      ipcMain.removeListener('shell:splash-exit-done', done)
      resolve(false)
    }, 1500)
    const done = () => { clearTimeout(t); resolve(true) }
    ipcMain.once('shell:splash-exit-done', done)
    win.webContents.send('shell:splash-exit')
  })
  check('handoff: renderer acks shell:splash-exit-done', acked)
  // 淡出取证：类加上了 + .stage.is-leaving 声明了 opacity:0 + 版心真的起了一条 opacity 过渡
  const fade = await exec(`(function () {
    const s = document.getElementById('stage')
    const card = document.querySelector('.card')
    const rule = [...document.styleSheets[0].cssRules].find((r) => r.selectorText === '.stage.is-leaving')
    return {
      cls: s.classList.contains('is-leaving'),
      declared: rule ? rule.style.opacity : null,
      anims: card.getAnimations().map((a) => String(a.transitionProperty || a.animationName || '?')),
      op: parseFloat(getComputedStyle(card).opacity),
    }
  })()`)
  check('handoff: card fade-out engaged',
    fade.cls === true && fade.declared === '0' && (fade.op < 0.2 || fade.anims.includes('opacity')),
    `cls=${fade.cls} declared=${fade.declared} anims=${JSON.stringify(fade.anims)} opacity=${fade.op}`)

  /* ── 9. 像素取证：每套皮肤一个干净窗口，各截一次图 ─────────────────────── */
  // 主窗口保持存活（见 shootTheme 里的注释：窗口数归零会触发应用退出）
  const deepShot = sampler(await shootTheme('deep'))
  const seaShot = sampler(await shootTheme('seascape'))

  const pixelChecks = (label, s, seascape) => {
    const anchors = s.anchors
    const whale = s.region(anchors.whale.l, anchors.whale.t, anchors.whale.r, anchors.whale.b)
    check(`[px:${label}] white whale is bright on dark stage`, whale.max > 180 && whale.mean > 15,
      `max=${whale.max.toFixed(0)} mean=${whale.mean.toFixed(0)}`)
    const corner = (s.region(8, 8, 148, 148).mean + s.region(s.vw - 149, 8, s.vw - 9, 148).mean) / 2
    check(`[px:${label}] corners stay dark`, corner < 34, `corner mean=${corner.toFixed(1)}`)
    const title = s.region(anchors.title.l, anchors.title.t, anchors.title.r, anchors.title.b)
    check(`[px:${label}] title visibly brighter than bg`, title.max > 150, `title max=${title.max.toFixed(0)}`)
    if (!seascape) {
      const markR = (anchors.mark.r - anchors.mark.l) / 2
      const ringR = markR * (55 / 60)
      const onArc = s.region(anchors.mark.cx - 6, anchors.mark.cy - ringR - 3, anchors.mark.cx + 6, anchors.mark.cy - ringR + 3)
      const offArc = s.region(anchors.mark.cx - 6, anchors.mark.cy - ringR - 22, anchors.mark.cx + 6, anchors.mark.cy - ringR - 14)
      check(`[px:${label}] progress arc drawn at 12 o'clock`, onArc.max > offArc.max + 25,
        `arc=${onArc.max.toFixed(0)} outside=${offArc.max.toFixed(0)}`)
      return
    }
    // 海景专属：近乎单色（冷调银盐允许 ≤14 的极小色偏，绝不出现彩色）。
    // 采样刻意避开文字：Windows 的次像素抗锯齿会让字边缘带 RGB 色边（那是字体渲染，
    // 不是调色板），所以只量"照片本身"——天的整条带 + 海的左侧空白带。
    const mid = s.vh / 2
    const skyBand = s.region(20, 20, s.vw - 20, mid - 24)
    const seaBand = s.region(20, mid + 24, Math.max(80, s.vw / 2 - 320), s.vh - 20)
    check(`[px:${label}] image is monochrome (no colour cast)`,
      skyBand.chroma <= 14 && seaBand.chroma <= 14,
      `skyChroma=${skyBand.chroma} seaChroma=${seaBand.chroma}`)
    check(`[px:${label}] sky half is lighter than the sea`, skyBand.mean > seaBand.mean + 2,
      `sky=${skyBand.mean.toFixed(1)} sea=${seaBand.mean.toFixed(1)}`)
    const onLine = s.region(s.vw / 2 - 40, mid - 1, s.vw / 2 + 40, mid + 1)
    const above = s.region(s.vw / 2 - 40, mid - 42, s.vw / 2 + 40, mid - 34)
    const below = s.region(s.vw / 2 - 40, mid + 34, s.vw / 2 + 40, mid + 42)
    check(`[px:${label}] horizon is the brightest band in the frame`,
      onLine.max > above.max + 20 && onLine.max > below.max + 20,
      `line=${onLine.max.toFixed(0)} above=${above.max.toFixed(0)} below=${below.max.toFixed(0)}`)
    const edge = s.region(4, mid - 1, 60, mid + 1)
    check(`[px:${label}] horizon reaches the frame edge when ready`, edge.max > 60,
      `edge max=${edge.max.toFixed(0)}`)
  }

  pixelChecks('deep', deepShot, false)
  pixelChecks('seascape', seaShot, true)

  app.exit(failures.length === 0 ? 0 : 1)
}).catch(die('main'))
