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
 * data-wb-tile / data-wb-tile-enter。
 */
import * as react from 'react'
import { T } from './copy.js'
import { setNotice, setOpen } from './ui-store.js'
import { useWorkbench } from './use-workbench.js'
import { exitMode, switchMode } from './actions.js'
import { ConversationTile } from './ConversationTile.js'
import { getShapeBridge, requestShape } from './shell-shape.js'

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
  const askedForStrip = react.useRef(false)
  react.useEffect(() => {
    let cancelled = false
    const apply = async (next) => {
      if (!getShapeBridge()) {
        setShape('unsupported')
        return
      }
      const result = await requestShape(next)
      if (!cancelled) setShape(result.ok ? next : `failed:${result.error}`)
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

  return react.createElement(
    'div',
    { className: 'dshWbHome', onKeyDown, 'data-wb-switcher': '', 'data-wb-shape': shape || 'none' },
    react.createElement(
      'div',
      { className: 'dshWbHomePanel', ref: panelRef, role: 'dialog', 'aria-label': T.homeTitle },
      react.createElement(
        'div',
        { className: 'dshWbHead' },
        react.createElement('span', { className: 'dshWbTitle' }, T.homeTitle),
        react.createElement('button', { type: 'button', className: 'dshWbClose', onClick: () => setOpen(false), 'data-wb-close': '' }, T.close),
      ),
      react.createElement('div', { className: 'dshWbHint' }, T.homeHint),
      active
        ? react.createElement(
            'div',
            { className: 'dshWbCtx', 'data-wb-context': active },
            `${T.contextNow}：${activeLabel}${contextLabel ? ` · ${contextLabel}` : ''}`,
          )
        : null,
      react.createElement(
        'div',
        { className: 'dshWbHomeBody' },
        react.createElement(
          'aside',
          { className: 'dshWbChat', 'data-wb-chat': '', 'aria-label': T.chatTitle },
          react.createElement('div', { className: 'dshWbChatHead' }, T.chatTitle),
          react.createElement(ConversationTile, { onBack: backToChat }),
        ),
        modes.length === 0
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
    toast,
  )
}
