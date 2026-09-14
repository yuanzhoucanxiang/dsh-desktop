/**
 * 文件行（带版本徽标；P1-① 从 app/WritingModeApp.js 搬出）。
 * 由闭包捕获改为显式 props：{ file, maxVer, active, onPick, labels }；DOM 类名保持不变。
 */
import * as jsx from 'react/jsx-runtime'
import { versionOf } from '../../state/prefs-store.js'
import { groupKeyOf } from './grouping.js'

export function fileRow({ file: f, maxVer, active, onPick, labels }) {
  const T = labels
  const ver = versionOf(f.name)
  const latest = maxVer instanceof Map ? maxVer.get(groupKeyOf(f.abs)) : 0
  const isHist = ver != null && ver < latest
  return jsx.jsx(
    'button',
    {
      type: 'button',
      className: 'dshWmItem' + (active ? ' is-on' : ''),
      onClick: () => onPick(f.abs),
      title: f.rel,
      children: [
        jsx.jsx(
          'div',
          {
            className: 'dshWmItemRow',
            children: [
              jsx.jsx(
                'span',
                {
                  className: 'dshWmItemTitle',
                  style: { flex: 1, minWidth: 0 },
                  children: f.name.replace(/-v\d+(\.[^.]+)?$/i, '$1'),
                },
                't'
              ),
              ver != null
                ? jsx.jsx(
                    'span',
                    {
                      className: 'dshWmVer' + (isHist ? ' is-hist' : ''),
                      children: 'v' + ver,
                    },
                    'v'
                  )
                : null,
            ],
          },
          'row'
        ),
        jsx.jsx(
          'span',
          { className: 'dshWmItemMeta', children: f.chars + T.chars },
          'm'
        ),
      ],
    },
    f.abs
  )
}
