/**
 * 文件行（带版本徽标；P1-① 从 app/WritingModeApp.js 搬出；P1-② 由普通函数改为 memo 组件）。
 * 显式 props：{ file, maxVer, active, onPick, labels }；DOM 类名不变，
 * key 由调用点传入（值仍是 f.abs）。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { versionOf, stemWithExtOf } from '../../../shared/filename.js'
import { groupKeyOf } from './grouping.js'

export const FileRow = react.memo(function FileRow({ file: f, maxVer, active, onPick, labels }) {
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
                  children: stemWithExtOf(f.displayName || f.name),
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
    }
  )
})
