/**
 * 版本对比与改稿预览（P1-② 从 app/WritingModeApp.js 抽出；DOM、类名与 key 逐字不变）。
 * 两块共用同一套行渲染（diffLineNodes）：版本对比 key 前缀 L，改稿预览 R。
 * 纯 props 渲染，数据与动作全部由 WritingModeApp 传入。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { T } from '../../copy.js'
import { lineDiff } from './diff.js'

/** 行渲染：前后缀对齐的极简行 diff 结果 → 带 +/- 前缀的行（章稿对比够用）。 */
function diffLineNodes(lines, prefix) {
  return lines.map((d, i) =>
    jsx.jsx(
      'div',
      {
        className: 'dshWmDiffLine ' + d.t,
        children: (d.t === 'add' ? '+ ' : d.t === 'del' ? '- ' : '  ') + d.line,
      },
      prefix + i
    )
  )
}

export const DiffPanel = react.memo(function DiffPanel({
  diffLines,
  diffLabel,
  onClose,
}) {
  return jsx.jsx(
    'div',
    {
      className: 'dshWmDiff',
      children: [
        jsx.jsx(
          'div',
          {
            className: 'dshWmDiffHead',
            children: [
              jsx.jsx('span', {
                children: T.diffTitle + ' ' + diffLabel,
              }),
              jsx.jsx('span', { className: 'dshWmSpacer' }),
              jsx.jsx('button', {
                type: 'button',
                className: 'dshWmBtn is-ghost',
                onClick: onClose,
                children: T.closeDiff,
              }),
            ],
          },
          'dh'
        ),
        ...diffLineNodes(diffLines, 'L'),
      ],
    },
    'diff'
  )
})

/**
 * 改稿预览（".dshWmRewrite"）：文字工具「替换选区」先出预览，作者采纳才落稿。
 * 与版本对比共用 diffLineNodes；key 前缀 R。
 */
export const RewritePanel = react.memo(function RewritePanel({
  rewrite,
  onAccept,
  onDiscard,
}) {
  return jsx.jsxs(
    'div',
    {
      className: 'dshWmDiff dshWmRewrite',
      'data-wm-rewrite': '1',
      children: [
        jsx.jsx(
          'div',
          {
            className: 'dshWmDiffHead',
            children: [
              jsx.jsx('span', {
                children: T.rewriteTitle + (rewrite.label ? ' · ' + rewrite.label : ''),
              }),
              jsx.jsx('span', { className: 'dshWmSpacer' }),
              jsx.jsx('button', {
                type: 'button',
                className: 'dshWmBtn',
                'data-wm-rewrite-accept': '1',
                onClick: onAccept,
                children: T.rewriteAccept,
              }),
              jsx.jsx('button', {
                type: 'button',
                className: 'dshWmBtn is-ghost',
                'data-wm-rewrite-discard': '1',
                onClick: onDiscard,
                children: T.rewriteDiscard,
              }),
            ],
          },
          'rh'
        ),
        ...diffLineNodes(lineDiff(rewrite.before, rewrite.after), 'R'),
      ],
    },
    'rewrite'
  )
})
