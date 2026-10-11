/**
 * 帧级浮层（`shell.overlay`）：模式切换器 + 上下文行 + 工具台通知出口。
 *
 * 内核的 `shell.overlay` 是**加法列表槽且默认 click-through**（浮层本身不接指针），
 * 所以这里只在需要时渲染：切换器打开时渲染一层透明 scrim + 面板（面板自己声明
 * `pointer-events:auto`）；只是有通知时渲染一个小 toast。两者都不占屏、不挡下面的界面。
 *
 * 通知出口是 2026-10-11 L1 补上的：交接（`registry.handoff`）的结果、以及将来各模式的上报，
 * 都走这一个出口（文档 §5.1），模式不再各自弹自己的 toast。
 */
import * as react from 'react'
import { T } from './copy.js'
import { setNotice, setOpen } from './ui-store.js'
import { useWorkbench } from './use-workbench.js'
import { exitMode, switchMode } from './actions.js'

/** 通知停留时长（点一下也能立刻关掉）。 */
const NOTICE_MS = 6000

export function WorkbenchChrome() {
  const { modes, active, context, lastHandoff, open, notice, registry } = useWorkbench()

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

  // 通知自动消失（组件常挂载，所以关掉切换器也照样计时）
  react.useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice])

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

  const onKeyDown = (event) => {
    if (event.key === 'Escape') setOpen(false)
  }

  const rows = modes.map((mode) =>
    react.createElement(
      'button',
      {
        key: mode.id,
        type: 'button',
        className: `dshWbRow${mode.active ? ' is-active' : ''}`,
        onClick: () => void switchMode(registry, mode.id),
        title: T.switchTo(mode.label),
        'data-wb-mode': mode.id,
        'data-wb-mode-active': mode.active ? '1' : '0',
      },
      react.createElement('span', { className: 'dshWbRowLabel' }, mode.label),
      mode.active ? react.createElement('span', { className: 'dshWbRowMark' }, T.current) : null,
    ),
  )

  return react.createElement(
    'div',
    { className: 'dshWbScrim', onClick: () => setOpen(false), onKeyDown, 'data-wb-switcher': '' },
    react.createElement(
      'div',
      { className: 'dshWbPanel', onClick: (event) => event.stopPropagation(), role: 'dialog', 'aria-label': T.switcherTitle },
      react.createElement(
        'div',
        { className: 'dshWbHead' },
        react.createElement('span', { className: 'dshWbTitle' }, T.switcherTitle),
        react.createElement('button', { type: 'button', className: 'dshWbClose', onClick: () => setOpen(false), 'data-wb-close': '' }, T.close),
      ),
      react.createElement('div', { className: 'dshWbHint' }, T.switcherHint),
      active
        ? react.createElement(
            'div',
            { className: 'dshWbCtx', 'data-wb-context': active },
            `${T.contextNow}：${activeLabel}${contextLabel ? ` · ${contextLabel}` : ''}`,
          )
        : null,
      modes.length === 0
        ? react.createElement(
            'div',
            { className: 'dshWbEmpty', 'data-wb-empty': '' },
            react.createElement('div', null, T.empty),
            react.createElement('div', null, T.emptyHint),
          )
        : react.createElement('div', { className: 'dshWbList' }, rows),
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
