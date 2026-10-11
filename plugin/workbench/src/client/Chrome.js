/**
 * 帧级浮层（`shell.overlay`）：模式切换器。
 *
 * 内核的 `shell.overlay` 是**加法列表槽且默认 click-through**（浮层本身不接指针），
 * 所以这里只在打开时渲染一层透明的 scrim，真正的面板自己声明 `pointer-events:auto`。
 * 关闭时渲染 null——工具台平时不占屏、不挡下面的内核界面。
 */
import * as react from 'react'
import { T } from './copy.js'
import { setOpen } from './ui-store.js'
import { useWorkbench } from './use-workbench.js'
import { exitMode, switchMode } from './actions.js'

export function WorkbenchChrome() {
  const { modes, active, open, registry } = useWorkbench()
  if (!open) return null

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
  )
}
