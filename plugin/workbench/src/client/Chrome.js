/**
 * 工具台主屏（`shell.overlay`）：左列 agent 对话 + 右侧模式瓷砖格 + 上下文行 + 通知出口。
 *
 * 形态来源（2026-10-11，项目所有者定）：进入工具台 = 一块全屏主屏，参考多窗口预览——
 * 左列放 agent 对话（ConversationTile），右侧把各模式的「主要内容窗口」排成瓷砖
 * （模式经 `registerMode({ tile })` 提供内容窗口——运行时组件引用，不违反 bundle 纯净门禁；
 * 没提供的退化为大按钮卡，保证每个模式都可达）。
 *
 * 与互斥的关系：主屏本身**不改 activeModeId**——它只是门面；点瓷砖上的「进入」/按钮卡才走
 * switchMode（同一套关闭守卫，被拦下时主屏留在原地、不自造文案）。主屏 z 层（2200）在模式
 * 浮层与辅助坞之上：打开时盖住、关闭后原样回到（模式不卸载，草稿/滚动位置都留住）。
 *
 * 探针钩子保留：data-wb-switcher / data-wb-mode / data-wb-mode-active / data-wb-context /
 * data-wb-exit / data-wb-close / data-wb-empty / data-wb-notice；新增 data-wb-chat / data-wb-tiles /
 * data-wb-tile / data-wb-tile-enter；长条三钮：data-wb-bar / data-wb-bar-shape /
 * data-wb-btn="mini|exit|close" / data-wb-mini / data-wb-mini-line。
 */
import * as react from 'react'
import { T } from './copy.js'
import { setNotice, setOpen } from './ui-store.js'
import { useWorkbench } from './use-workbench.js'
import { exitMode, switchMode } from './actions.js'
import { ConversationTile } from './ConversationTile.js'
import { SplicePanelBody } from './Splice.js'
import { getShapeBridge, hasModuleWindowBridge, openSettings, openModuleWindow, closeModuleWindow, readShape, requestShape, requestSplice, requestWindowClose } from './shell-shape.js'
import { TelemetryMeter, useSessionSnapshot, useSessionTelemetry } from './use-session.js'

/** 拼接区默认宽度（px）：壳侧允许 280 到"工作区上限"，这里取中间值；拖拽调宽是同一刀的后半。 */
const SPLICE_WIDTH = 420
/** 面板最小宽度（px）：拖拽阶段先夹到这个值，落定时再由壳夹到 280。 */
const SPLICE_DRAG_MIN = 120
/** 壳侧硬下限（与 main.js 的 SPLICE_MIN 对齐）：申请宽度时不低于它，免得每次都被夹、白跑一趟。 */
const SPLICE_MIN = 280

/** 接缝扇形的几何（原型 `.fan`：**以接缝为轴心按角度排开**、逐颗错峰弹出）。 */
const SEAM_FAN_R = 58 // 弹出半径（px，原型 fanPop 的终点就是 58）
const SEAM_FAN_SPREAD = 34 // 两端相对中间的夹角（度，原型 -34° / 0° / 34°）
const SEAM_FAN_STAGGER = 45 // 逐颗错峰的步长（ms，原型 .02/.07/.12s）
/** 鼠标离开接缝后**等多久才收**（ms）：扇形是从窄条往里弹的，不留宽限根本来不及挪过去。 */
const SEAM_CLOSE_GRACE_MS = 240

/** 通知停留时长（点一下也能立刻关掉）。 */
const NOTICE_MS = 6000

/**
 * 模式卡上的「正在做什么」：与入口同一回退链（title → project → doc → path）。
 * 模式没报或报错时 contextOf 返回 null → 如实空着，不编造。
 */
function contextLabelOf(registry, id) {
  const c = registry.contextOf(id)
  if (!c) return ''
  return c.title || c.project || c.doc || c.path || ''
}

export function WorkbenchChrome() {
  const { modes, active, context, lastHandoff, open, notice, registry } = useWorkbench()
  const panelRef = react.useRef(null)

  // 交接结果 → 工具台通知出口（交付成功/目标没有接收端，两种都如实说）
  const seenHandoffAt = react.useRef(0)
  react.useEffect(() => {
    if (!lastHandoff || lastHandoff.at === seenHandoffAt.current) return
    seenHandoffAt.current = lastHandoff.at
    const from = registry.resolveLabel(lastHandoff.from)
    const to = registry.resolveLabel(lastHandoff.to)
    if (lastHandoff.delivered) setNotice({ kind: 'info', text: `已把「${from}」的引用交给「${to}」` })
    else setNotice({ kind: 'warn', text: `「${to}」还没有接收端，引用没有送出去` })
  }, [lastHandoff, registry])

  // 通知自动消失（组件常挂载，所以关掉主屏也照样计时）
  react.useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice])

  // 长条门面接线（2026-10-12 刀 2）：主屏打开 → 请壳把窗口收成条；**收过条才**在关闭时还原
  // （没收成过就发 normal 会把用户的窗口尺寸/最大化状态乱改回去）。桥缺席 → 主屏照旧全屏。
  const [shape, setShape] = react.useState('')
  // 小条（mini）显示**同一份**状态数据（原型 `.mini` 不是"少画点东西"，是换个尺寸显示同一份）：
  // 读取逻辑与长条共用 use-session.js，这里只负责摆位置。
  const sessionState = useSessionSnapshot()
  const telemetry = useSessionTelemetry(sessionState.sessions, sessionState.sessionId)
  // 接缝扇形的开合（悬停/聚焦）。用 React 状态而不是纯 CSS `:hover`：探针能直接读
  // `data-wb-seam-open` 与逐颗的几何属性，不必去合成鼠标事件猜样式。
  const [seamOpen, setSeamOpen] = react.useState(false)
  // 接缝的关合宽限（见下面 openSeam/scheduleCloseSeam 的注释）：定时器放 ref，重开时清掉
  const seamCloseTimer = react.useRef(null)
  const openSeam = react.useCallback(() => {
    if (seamCloseTimer.current) {
      window.clearTimeout(seamCloseTimer.current)
      seamCloseTimer.current = null
    }
    setSeamOpen(true)
  }, [])
  const scheduleCloseSeam = react.useCallback(() => {
    if (seamCloseTimer.current) window.clearTimeout(seamCloseTimer.current)
    seamCloseTimer.current = window.setTimeout(() => {
      seamCloseTimer.current = null
      setSeamOpen(false)
    }, SEAM_CLOSE_GRACE_MS)
  }, [])
  react.useEffect(
    () => () => {
      if (seamCloseTimer.current) window.clearTimeout(seamCloseTimer.current)
    },
    [],
  )
  // 拼接：右侧拼了哪些模式（数组，**index 0 = 贴着主长条那块**；新拼的插到最前）+ 壳回读的总宽
  const [spliced, setSpliced] = react.useState([])
  const [spliceWidth, setSpliceWidth] = react.useState(0)
  // 长条**自己**的宽度（壳报的，别在插件里写死 420）：拼接时用它把对话列钉住
  const [stripWidth, setStripWidth] = react.useState(SPLICE_WIDTH)
  // 壳记账的**模块窗口**列表（每个被拼接的模式一个独立窗口；`anchored:false` = 用户拖开了=分离）
  const [modules, setModules] = react.useState([])
  const moduleIds = modules.map((m) => m.modeId)
  /** 壳每次回包都带 `stripWidth`，见到就记下来（挂载读、申请形态、申请拼接三处都会过这里）。 */
  const rememberShape = (state) => {
    const w = Number(state && state.stripWidth)
    if (Number.isFinite(w) && w > 0) setStripWidth(w)
  }
  // 拖拽回调是**闭包**，拿到的 `spliced` 是渲染那一刻的旧值——松手时按它落定会把宽度改回去
  // （2026-10-13 写这刀时当场看出来的）。所以始终从 ref 读最新值。
  // **hook 必须在所有 early return 之前**：放到下面那个拼接块里会报 "Rendered more hooks than
  // during the previous render"（主屏关着时不走那段，开着时多两个 hook——2026-10-13 实付过学费）。
  const panelsRef = react.useRef([])
  react.useEffect(() => {
    panelsRef.current = spliced
  }, [spliced])
  const askedForStrip = react.useRef(false)
  // 壳每次广播形态时也带 `modules`（模块窗口记账）——拼上/关掉/拖开都从这里同步过来，
  // 接缝上的「已拼接」标记才不会与真实情况脱节（2026-10-13 模块化那一刀）。
  react.useEffect(() => {
    const bridge = getShapeBridge()
    if (!bridge || typeof bridge.onWorkbenchShape !== 'function') return undefined
    const off = bridge.onWorkbenchShape((state) => {
      if (state && Array.isArray(state.modules)) setModules(state.modules)
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [])
  react.useEffect(() => {
    let cancelled = false
    const apply = async (next) => {
      if (!getShapeBridge()) {
        setShape('unsupported')
        return
      }
      const result = await requestShape(next)
      if (cancelled) return
      rememberShape(result)
      setShape(result.ok ? next : `failed:${result.error}`)
    }
    if (open) {
      askedForStrip.current = true
      void apply('strip')
    } else if (askedForStrip.current) {
      askedForStrip.current = false
      void apply('normal')
    }
    return () => {
      cancelled = true
    }
  }, [open])

  // **挂载时对账**（2026-10-13，用户实报"竖直长条里面的前端内容不对"）：
  // 页面重载 / 插件重挂之后 `open` 是 false、`askedForStrip` 也归零，而壳可能**还停在条状**——
  // 那时长条里就只剩内核自己的界面（侧栏 + hero + 会话），门面一行都没画。这里读一次壳的形态，
  // 非 normal 且主屏没开就还回去。**只对账一次**（挂载），不常驻轮询。
  react.useEffect(() => {
    let cancelled = false
    void (async () => {
      if (open || !getShapeBridge()) return
      const now = await readShape()
      rememberShape(now)
      if (cancelled || !now || now.shape === 'normal' || now.shape === undefined) return
      // 拼接宽度也一起对账：壳可能还停在上次拼宽的状态（`settings.workbenchSplice` 是持久化的），
      // 而门面这边没有拼任何模式 → 先把它收回去，再还形态（顺序无所谓，两个都是幂等请求）。
      if (Number(now.spliceWidth) > 0) await requestSplice(0)
      const result = await requestShape('normal')
      if (!cancelled && result.ok) setShape('normal')
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 打开时把焦点交给当前模式（没有当前模式就交给第一个可达模式）：↑↓/回车 立即可用
  react.useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return
    const target = panel.querySelector('[data-wb-mode-active="1"]') || panel.querySelector('[data-wb-mode]')
    try {
      target?.focus({ preventScroll: true })
    } catch {
      /* 无 focus 的环境（单测）忽略 */
    }
  }, [open])

  if (!open && !notice) return null
  const contextLabel = context ? context.title || context.project || context.path || '' : ''
  const activeLabel = (modes.find((m) => m.id === active) || {}).label || ''

  const toast = notice
    ? react.createElement(
        'div',
        {
          className: `dshWbToast${notice.kind === 'warn' ? ' is-warn' : ''}`,
          role: 'status',
          onClick: () => setNotice(null),
          title: T.noticeDismiss,
          'data-wb-notice': notice.kind,
        },
        notice.text,
      )
    : null

  if (!open) return react.createElement(react.Fragment, null, toast)

  // 「回到完整会话」：若正有模式激活，先走同一套守卫退出模式（被拦下就留在主屏），再关主屏
  const backToChat = async () => {
    if (active) {
      const result = await exitMode(registry)
      if (!result.ok) return
    }
    setOpen(false)
  }

  /* ── 长条自绘顶栏三钮（2026-10-12 项目所有者拍板的语义） ──────────────────
   * `—` 收成小条（再点展开回长条）· `⎋` 退出工具台并还原窗口 · `✕` 走**既有关窗语义**
   * （壳里 `closeToTray` 说了算：默认进托盘，不退出应用）。
   * 三条纪律：① 只在条状形态出现——normal 还有原生标题栏，两套按钮并排就是自找混乱；
   * ② 桥缺席（官方壳 / 老安装包）时 `—` 与 `✕` 什么都不做（不弹自造错误文案），`⎋` 退化成
   *    "关主屏"这个插件自己做得到的动作；③ 三钮都是真 `<button>`：Tab 可达、带 title 与
   *    aria-label，并挂 `data-wb-btn` 供实机与探针自查。无边框那一刀落地前，拖动仍走原生标题栏。
   */
  const isStrip = shape === 'strip' || shape === 'mini'
  const toggleMini = async () => {
    const next = shape === 'mini' ? 'strip' : 'mini'
    const result = await requestShape(next)
    setShape(result.ok ? next : `failed:${result.error}`)
  }
  /* ── 模式拼接（2026-10-13，用户拍板 A：**接缝点模式 = 拼到右侧**） ─────────────
   * 与"进入模式"分工：进全屏走宽窗主屏的瓷砖「进入」；接缝点一下是把该模式的**完整界面**
   * 拼在长条右侧（用户拍板 A：要的是完整界面，不是轻视图），窗口跟着变宽（壳侧 `splice` 几何）。
   * 视图来源优先 `splice`（`mount(container)` 给单实例模式 / `view` 给可重挂模式），没有才退回 `dock`。
   * 2026-10-13 第二版：**可以拼多个**（新拼的贴主长条插入，旧的整体外顶——原型 v2.2 的规则），
   * 每块左缘可**拖拽调宽**（280–上限，壳侧夹住；宽度记忆在壳的 `settings.workbenchSplice` 里）。
   * 纪律：① 没有可嵌入视图的模式**不拼**（如实说明，不硬塞）；② 壳不支持拼接（老壳）时
   * 整个入口不出现；③ 进入模式 / 关主屏 / 退出工具台时**先收起拼接**，别把窗口留在加宽状态。
   */
  const totalSpliceOf = (panels) => panels.reduce((sum, it) => sum + (Number(it.width) || SPLICE_WIDTH), 0)
  const applySpliceWidth = async (panels) => {
    const want = panels.length ? Math.max(SPLICE_MIN, totalSpliceOf(panels)) : 0
    const result = await requestSplice(want)
    if (!result.ok) return result
    rememberShape(result)
    setSpliceWidth(Number(result.spliceWidth) || want)
    return result
  }
  const spliceMode = async (id) => {
    // **模块窗口路径**（2026-10-13 用户拍板："模块化，即它们也可以分离"）：壳在位且支持模块窗口时，
    // 拼接就是**开一个独立窗口**贴到长条左边——不是把主窗撑宽。再点一次同一个模式＝关掉那个窗口。
    if (hasModuleWindowBridge()) {
      if (moduleIds.includes(id)) {
        const closed = await closeModuleWindow(id)
        if (Array.isArray(closed?.modules)) setModules(closed.modules)
        return closed
      }
      const view = registry.spliceViewOf(id) || registry.dockViewOf(id)
      const wantWidth = Number(view && view.width) > 0 ? Number(view.width) : SPLICE_WIDTH
      const result = await openModuleWindow(id, wantWidth)
      if (!result.ok) {
        setNotice({ kind: 'error', text: T.spliceFailed(result.error) })
        return result
      }
      if (Array.isArray(result.modules)) setModules(result.modules)
      return result
    }
    // **降级路径**（老壳没有模块窗口）：退回"窗口内拼接"——主窗撑宽、右侧多一列
    if (spliced.some((it) => it.id === id)) return unsplice(id)
    const view = registry.spliceViewOf(id) || registry.dockViewOf(id)
    if (!view) {
      setNotice({ kind: 'info', text: T.spliceNoView(registry.resolveLabel(id)) })
      return
    }
    // 新拼的**贴主长条插入**（原型 v2.2：右侧新界面贴长条、旧界面依次外顶）。
    // 宽度优先用**模式自己声明的**（`splice.width`）——写作台那种宽窗设计的界面在 420 里会被裁。
    const width = Number(view.width) > 0 ? Number(view.width) : SPLICE_WIDTH
    const next = [{ id, width }, ...spliced]
    const result = await applySpliceWidth(next)
    if (!result.ok) {
      setNotice({ kind: 'error', text: T.spliceFailed(result.error) })
      return
    }
    setSpliced(next)
  }
  const unsplice = async (id) => {
    const next = spliced.filter((it) => it.id !== id)
    await applySpliceWidth(next)
    setSpliced(next)
  }
  const collapseSplice = async () => {
    if (!spliced.length) return { ok: true }
    setSpliced([])
    setSpliceWidth(0)
    return requestSplice(0)
  }
  // 拖拽调宽（面板左缘的 grip）：往左拖 = 变宽。用 pointer capture，拖的过程中**节流**申请，
  // 松手再落一次最终值——壳侧本来就会夹到 280–上限，这里不重复夹（只保证不发负数）。
  const dragSplice = (id) => (event) => {
    const panel = spliced.find((it) => it.id === id)
    if (!panel) return
    const startX = event.clientX
    const startWidth = Number(panel.width) || SPLICE_WIDTH
    const target = event.currentTarget
    try {
      target.setPointerCapture(event.pointerId)
    } catch {
      /* 拿不到捕获也能拖，只是移出元素就断 */
    }
    let last = 0
    const onMove = (moveEvent) => {
      const want = Math.max(SPLICE_DRAG_MIN, Math.round(startWidth + (startX - moveEvent.clientX)))
      const now = Date.now()
      if (now - last < 80) return
      last = now
      const nextPanels = panelsRef.current.map((it) => (it.id === id ? { ...it, width: want } : it))
      // **立刻同步 ref**：effect 要等这一轮渲染之后才跑，而 pointerup 可能就在同一 tick 里
      // （探针一次 evaluate 里连发 down/move/up 就是这种情形）——只靠 effect 会读到旧数组，
      // 松手那一下把宽度又改回去（2026-10-13 探针实测抓到）。
      panelsRef.current = nextPanels
      void requestSplice(Math.max(SPLICE_MIN, totalSpliceOf(nextPanels)))
      setSpliced(nextPanels)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      void applySpliceWidth(panelsRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const exitWorkbench = async () => {
    await collapseSplice()
    if (active) {
      const result = await exitMode(registry)
      if (!result.ok) return
    }
    setOpen(false)
  }
  // 顶栏（原型 `.topbar`）：← 回宽窗主屏 / 中间"工作台·当前" / ⚙ 设置 / — 小条 / ⎋ 退出 / ✕ 关窗。
  // ← 与 ⎋ 的区别：← **只是把窗口变回宽窗**（主屏还在，瓷砖格随之出现 = 原型的"工作区选择"），
  // ⎋ 才是退出工具台（有模式在场时先过同一套守卫）。
  const backToWide = async () => {
    await collapseSplice() // 回宽窗主屏 = 不拼了（主屏自己有瓷砖格，拼着的模式视图没地方站）
    const result = await requestShape('normal')
    if (result.ok) setShape('normal')
  }
  const bar = !isStrip
    ? null
    : react.createElement(
        'div',
        { className: 'dshWbBar', 'data-wb-bar': '', 'data-wb-bar-shape': shape },
        react.createElement(
          'button',
          {
            type: 'button',
            className: 'dshWbBarBtn',
            onClick: () => void backToWide(),
            title: T.btnBackWide,
            'aria-label': T.btnBackWide,
            'data-wb-btn': 'back',
          },
          '←',
        ),
        react.createElement(
          'span',
          { className: 'dshWbBarTitle', 'data-wb-bar-who': '' },
          `${T.entry}${active ? ` · ${activeLabel}` : ''}`,
        ),
        react.createElement(
          'button',
          {
            type: 'button',
            className: 'dshWbBarBtn',
            onClick: () => openSettings(),
            title: T.btnSettings,
            'aria-label': T.btnSettings,
            'data-wb-btn': 'settings',
          },
          '⚙',
        ),
        react.createElement(
          'button',
          {
            type: 'button',
            className: 'dshWbBarBtn',
            onClick: () => void toggleMini(),
            title: T.btnMini(shape === 'mini'),
            'aria-label': T.btnMini(shape === 'mini'),
            'data-wb-btn': 'mini',
          },
          shape === 'mini' ? '▢' : '—',
        ),
        react.createElement(
          'button',
          {
            type: 'button',
            // 2026-10-13：字形 `⎋` 没人认得出（项目所有者直接问"怎么回到主界面"）→ 换成**文字**「退出」。
            // 这一钮是"回到内核主界面"的唯一出口（← 只是回宽窗主屏，✕ 是关窗进托盘），必须一眼看懂。
            className: 'dshWbBarBtn is-exit',
            onClick: () => void exitWorkbench(),
            title: T.btnExit,
            'aria-label': T.btnExit,
            'data-wb-btn': 'exit',
          },
          T.btnExitShort,
        ),
        react.createElement(
          'button',
          {
            type: 'button',
            className: 'dshWbBarBtn is-close',
            onClick: () => void requestWindowClose(),
            title: T.btnClose,
            'aria-label': T.btnClose,
            'data-wb-btn': 'close',
          },
          '✕',
        ),
      )

  // 小条形态：只留顶栏 + 一行"正在做什么"，对话与瓷砖格整体让位（168px 高塞不下，硬塞就是破版）
  if (shape === 'mini') {
    return react.createElement(
      react.Fragment,
      null,
      react.createElement(
        'div',
        {
          className: 'dshWbMini',
          // Escape 在小条下等价于 `⎋`（长条那套键盘出口不能因为换形态就断掉）
          onKeyDown: (event) => {
            if (event.key === 'Escape') void exitWorkbench()
          },
          'data-wb-mini': '',
          'data-wb-shape': shape,
        },
        bar,
        react.createElement(
          'div',
          { className: 'dshWbMiniLine', 'data-wb-mini-line': '' },
          (active && contextLabel ? `${activeLabel} · ${contextLabel}` : activeLabel) || T.chatOpenHint,
        ),
        // 小条也显示**同一份**状态数据（原型 `.mini` 的语义）：紧凑版，去掉进度条
        react.createElement(TelemetryMeter, {
          metrics: telemetry.metrics,
          source: telemetry.source,
          values: telemetry.values,
          compact: true,
        }),
      ),
      toast,
    )
  }

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    // 键盘导航：↑↓ 在可达模式（按钮卡）间循环移动焦点，Home/End 到两端；回车由按钮原生触发
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const panel = panelRef.current
    if (!panel) return
    const items = Array.from(panel.querySelectorAll('[data-wb-mode]'))
    if (items.length === 0) return
    event.preventDefault()
    const index = items.indexOf(document.activeElement)
    let next = 0
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length
    else next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length
    try {
      items[next].focus({ preventScroll: true })
    } catch {
      /* 同上 */
    }
  }

  const tiles = modes.map((mode) => {
    const ctxLabel = contextLabelOf(registry, mode.id)
    const tile = mode.hasTile ? registry.tileViewOf(mode.id) : null
    // 提供了「主要内容窗口」的模式：渲染瓷砖壳（标题 + 进入）+ 模式自己的组件
    if (tile) {
      const TileView = tile.view
      return react.createElement(
        'div',
        { key: mode.id, className: `dshWbTile${mode.active ? ' is-active' : ''}`, 'data-wb-tile': mode.id },
        react.createElement(
          'div',
          { className: 'dshWbTileHead' },
          react.createElement('span', { className: 'dshWbTileLabel' }, tile.label),
          mode.active ? react.createElement('span', { className: 'dshWbRowMark' }, T.current) : null,
          react.createElement(
            'button',
            {
              type: 'button',
              className: 'dshWbTileEnter',
              onClick: () => void switchMode(registry, mode.id),
              'data-wb-tile-enter': mode.id,
            },
            T.tileEnter(tile.label),
          ),
        ),
        react.createElement('div', { className: 'dshWbTileBody' }, react.createElement(TileView)),
      )
    }
    // 没提供内容窗口的模式：大按钮卡兜底，保证可达
    return react.createElement(
      'button',
      {
        key: mode.id,
        type: 'button',
        className: `dshWbMode${mode.active ? ' is-active' : ''}`,
        onClick: () => void switchMode(registry, mode.id),
        title: T.switchTo(mode.label),
        'data-wb-mode': mode.id,
        'data-wb-mode-active': mode.active ? '1' : '0',
        'aria-current': mode.active ? 'true' : undefined,
      },
      react.createElement('span', { className: 'dshWbModeGlyph', 'aria-hidden': 'true' }, mode.label.slice(0, 1) || '·'),
      react.createElement(
        'span',
        { className: 'dshWbModeBody' },
        react.createElement('span', { className: 'dshWbModeLabel' }, mode.label),
        ctxLabel
          ? react.createElement('span', { className: 'dshWbModeCtx', title: ctxLabel }, ctxLabel)
          : react.createElement('span', { className: 'dshWbModeCtx' }, T.tileEmpty),
      ),
      mode.active ? react.createElement('span', { className: 'dshWbRowMark' }, T.current) : null,
    )
  })

  // 拼接面板（长条右侧那些列）：每块 = 模式的**完整界面**（`splice`：mount 或 view；没有才退回
  // 坞的轻视图）+ 头部（模式名 + ✕）+ 左缘**拖拽把手**。宽度由壳回读的 `spliceWidth` 定。
  const splicePanels = spliced
    .map((panel) => {
      const view = registry.spliceViewOf(panel.id) || registry.dockViewOf(panel.id)
      if (!view) return null
      return react.createElement(
        'section',
        {
          key: panel.id,
          className: 'dshWbSplice',
          'data-wb-splice': panel.id,
          'data-wb-splice-width': String(panel.width || SPLICE_WIDTH),
          style: { flexBasis: `${Number(panel.width) || SPLICE_WIDTH}px` },
          'aria-label': T.spliceTitle(view.label),
        },
        react.createElement('div', {
          className: 'dshWbSpliceGrip',
          title: T.spliceResize,
          'aria-hidden': 'true',
          'data-wb-splice-grip': panel.id,
          onPointerDown: dragSplice(panel.id),
        }),
        react.createElement(
          'div',
          { className: 'dshWbSpliceHead' },
          react.createElement('span', { className: 'dshWbSpliceLabel' }, T.spliceTitle(view.label)),
          react.createElement(
            'button',
            {
              type: 'button',
              className: 'dshWbBarBtn',
              title: T.spliceCollapse,
              'aria-label': T.spliceCollapse,
              onClick: () => void unsplice(panel.id),
              'data-wb-splice-collapse': panel.id,
            },
            '✕',
          ),
        ),
        react.createElement(
          'div',
          { className: 'dshWbSpliceBody', 'data-wb-splice-body': '' },
          react.createElement(SplicePanelBody, { view }),
        ),
      )
    })
    .filter(Boolean)
  // **只在降级路径下**渲染窗口内的拼接列：壳支持模块窗口时，被拼的模式是独立窗口（贴边/可分离），
  // 主窗不该再撑宽多一列（2026-10-13 用户拍板换了架构）。
  const splicePanel =
    !hasModuleWindowBridge() && splicePanels.length
      ? react.createElement(
          'div',
          { className: 'dshWbSpliceWrap', 'data-wb-splice-wrap': String(splicePanels.length), style: { flexBasis: `${spliceWidth || SPLICE_WIDTH}px` } },
          splicePanels,
        )
      : null

  return react.createElement(
    'div',
    {
      className: 'dshWbHome',
      onKeyDown,
      'data-wb-switcher': '',
      'data-wb-shape': shape || 'none',
      // 长条自己的宽度（壳报的）：拼接时用它把对话列钉住
      style: { '--dsh-wb-strip-w': `${stripWidth}px` },
    },
    bar,
    react.createElement(
      'div',
      { className: 'dshWbHomePanel', ref: panelRef, role: 'dialog', 'aria-label': T.homeTitle },
      // 长条形态**不摆第二层标题**（原型只有一条 `.topbar`：← / 工作台·当前 / ⚙ / 三钮）——
      // 两层标题在 412px 宽里纯属浪费；主屏（宽窗）才需要"创作工具台 + 关闭"这一行。
      isStrip
        ? null
        : react.createElement(
            'div',
            { className: 'dshWbHead' },
            react.createElement('span', { className: 'dshWbTitle' }, T.homeTitle),
            react.createElement('button', { type: 'button', className: 'dshWbClose', onClick: () => setOpen(false), 'data-wb-close': '' }, T.close),
          ),
      isStrip ? null : react.createElement('div', { className: 'dshWbHint' }, T.homeHint),
      active
        ? react.createElement(
            'div',
            { className: 'dshWbCtx', 'data-wb-context': active },
            `${T.contextNow}：${activeLabel}${contextLabel ? ` · ${contextLabel}` : ''}`,
          )
        : null,
      react.createElement(
        'div',
        { className: `dshWbHomeBody${splicePanel ? ' is-spliced' : ''}`, 'data-wb-home-body': splicePanel ? 'spliced' : 'plain' },
        react.createElement(
          'aside',
          { className: 'dshWbChat', 'data-wb-chat': '', 'aria-label': T.chatTitle },
          // 长条下不摆"对话"小标题（顶栏已说明这是什么）；宽窗主屏才需要这一行分区标题
          isStrip ? null : react.createElement('div', { className: 'dshWbChatHead' }, T.chatTitle),
          react.createElement(ConversationTile, {
            onBack: backToChat,
            modes,
            onPickMode: (id) => void spliceMode(id), // 长条下的模式入口 = 拼接（用户拍板 A）
          }),
        ),
        // 长条形态：**对话优先**，瓷砖格让位给右缘接缝（原型 v2.2）；主屏（normal）仍保留瓷砖格。
        // 拼接时右侧多一列：模式的**可嵌入视图**（第一版就用它的 `dock` 视图）——窗口已由壳加宽。
        isStrip
          ? splicePanel
          : modes.length === 0
            ? react.createElement(
                'div',
                { className: 'dshWbEmpty', 'data-wb-empty': '' },
                react.createElement('div', null, T.empty),
                react.createElement('div', null, T.emptyHint),
              )
            : react.createElement('section', { className: 'dshWbTiles', 'data-wb-tiles': '' }, tiles),
      ),
      active
        ? react.createElement(
            'div',
            { className: 'dshWbFoot' },
            react.createElement('button', { type: 'button', className: 'dshWbBtn', onClick: () => void exitMode(registry), 'data-wb-exit': '' }, T.exit),
          )
        : null,
    ),
    // 接缝呼出·扇形（原型 `.edge`/`.fan`：**以接缝为轴心按角度排开**，逐颗错峰弹出）。
    // 几何在 JS 里算好、用 CSS 变量摆位——探针直接读 `data-wb-seam-a`（角度）与 `-delay`。
    // 窗外画不了（窗口边界是硬的，plan §12-9 已选"收在窗口内贴右缘"），所以是**窗内扇形**：
    // 角度照原型（中间 0°、两端 ±34°），半径固定；图标与标签反向旋转，保证文字始终是正的。
    isStrip
      ? react.createElement(
          'div',
          {
            className: `dshWbSeam${seamOpen ? ' is-open' : ''}`,
            // **接缝站在"拼合处"**：拼了东西之后，它就是长条与拼接区之间那条缝（原型 v2.2 的规则：
            // "已有模式拼着时，鼠标放在长条窗与模式窗口的拼合处"）。没拼时贴窗口右缘。
            // 2026-10-13 实机抓到：原来一直贴在窗口最右缘，拼完之后扇形跑到了面板外侧，形式不对。
            style: { right: spliceWidth > 0 ? `${spliceWidth}px` : 0 },
            'data-wb-seam': '',
            'data-wb-seam-at': spliceWidth > 0 ? 'junction' : 'edge',
            'data-wb-seam-open': seamOpen ? '1' : '0',
            'data-wb-seam-count': String(modes.length),
            role: 'group',
            'aria-label': T.seamLabel,
            title: T.seamHint,
            /**
             * 开合带**宽限延迟**（2026-10-13 项目所有者实报："图标呼出时，鼠标还没挪过去就消失了"）。
             * 原因是几何：扇形从 26px 宽的右缘条往里弹出 58px，鼠标从条上往图标走**中途就出了条**，
             * `mouseleave` 立刻收起。两处一起兜：① 展开时命中区撑宽到覆盖扇形（CSS `.is-open`）；
             * ② 离开后等 `SEAM_CLOSE_GRACE_MS` 再收，进到图标/重新进条上就取消这个定时器。
             */
            onMouseEnter: () => openSeam(),
            onMouseLeave: () => scheduleCloseSeam(),
            onFocus: () => openSeam(),
            onBlur: () => scheduleCloseSeam(),
          },
          react.createElement('div', { className: 'dshWbSeamGrip', 'aria-hidden': 'true' }),
          modes.length === 0
            ? react.createElement('div', { className: 'dshWbSeamEmpty', 'data-wb-seam-empty': '' }, T.seamEmpty)
            : react.createElement(
                'div',
                { className: 'dshWbSeamFan', 'data-wb-seam-fan': '' },
                modes.map((mode, i) => {
                  const mid = (modes.length - 1) / 2
                  // 角度：**第一颗在上、最后一颗在下**（`mid - i`，不是 `i - mid`——2026-10-13 实机量到
                  // 顺序反了：writing 落在 y=304、gir 落在 y=270，看着像"朝内翻"）。中间那颗 0°。
                  const step = modes.length > 1 ? Math.min(SEAM_FAN_SPREAD, (SEAM_FAN_SPREAD * 2) / (modes.length - 1)) : 0
                  const a = Math.round((mid - i) * step)
                  const delay = i * SEAM_FAN_STAGGER
                  // 「已拼接」两种形态都算：模块窗口（新路径）或窗口内的拼接列（老壳降级路径）
                  const isSpliced = moduleIds.includes(mode.id) || spliced.some((it) => it.id === mode.id)
                  return react.createElement(
                    'button',
                    {
                      key: mode.id,
                      type: 'button',
                      className: `dshWbSeamItem${mode.active ? ' is-active' : ''}${isSpliced ? ' is-spliced' : ''}`,
                      style: { '--wb-a': `${a}deg`, '--wb-out': String(SEAM_FAN_R), '--wb-delay': `${delay}ms` },
                      // 用户拍板 A：接缝点一下 = **拼到右侧**（进模式全屏走宽窗主屏的瓷砖「进入」）
                      onClick: () => void spliceMode(mode.id),
                      title: T.spliceTo(mode.label),
                      'data-wb-seam-mode': mode.id,
                      'data-wb-seam-a': String(a),
                      'data-wb-seam-out': String(SEAM_FAN_R),
                      'data-wb-seam-delay': String(delay),
                    },
                    // 图标与标签**反向旋转**：扇形是转出来的，但字要正着读（原型里图标跟着斜，这里改好一点）
                    react.createElement(
                      'span',
                      { className: 'dshWbSeamGlyph', 'aria-hidden': 'true', style: { transform: `rotate(${-a}deg)` } },
                      mode.label.slice(0, 1) || '·',
                    ),
                    // 状态点（原型 `.st`）：图标右下角的小徽标，只有"已拼接/当前"才显示
                    react.createElement('span', {
                      className: `dshWbSeamSt${mode.active ? ' is-active' : ''}`,
                      'data-wb-seam-st': mode.active ? 'active' : isSpliced ? 'spliced' : 'ready',
                      'aria-hidden': 'true',
                    }),
                    react.createElement(
                      'span',
                      { className: 'dshWbSeamText', style: { transform: `translateY(-50%) rotate(${-a}deg)` } },
                      mode.label,
                      isSpliced
                        ? react.createElement('em', { className: 'dshWbSeamTag', 'data-wb-seam-tag': 'spliced' }, T.spliced)
                        : mode.active
                          ? react.createElement('em', { className: 'dshWbSeamTag', 'data-wb-seam-tag': 'active' }, T.current)
                          : null,
                    ),
                  )
                }),
              ),
        )
      : null,
    toast,
  )
}
