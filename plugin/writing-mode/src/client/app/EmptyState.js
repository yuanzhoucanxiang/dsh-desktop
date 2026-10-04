/**
 * 无文件时的空页（纯写作第一屏的主角）。
 * 只有一行标题与两个文字级动作：新建一篇 / 从库里打开。
 * 文库与右栏默认收起，作者进来先看到的是稿纸，不是资料架。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { T } from '../copy.js'

export const EmptyState = react.memo(function EmptyState({ onNew, onBrowse }) {
  return jsx.jsxs('div', {
    className: 'dshWmEmptyPage',
    'data-wm-empty': '1',
    children: [
      jsx.jsx('div', { className: 'dshWmEmptyTitle', children: T.emptyTitle }, 't'),
      jsx.jsxs('div', {
        className: 'dshWmEmptyActs',
        children: [
          jsx.jsx('button', {
            type: 'button',
            className: 'dshWmBtn is-ghost',
            onClick: onNew,
            children: T.emptyNew,
          }, 'new'),
          jsx.jsx('span', { className: 'dshWmEmptyDot', children: '·' }, 'dot'),
          jsx.jsx('button', {
            type: 'button',
            className: 'dshWmBtn is-ghost',
            onClick: onBrowse,
            children: T.emptyBrowse,
          }, 'browse'),
        ],
      }, 'acts'),
    ],
  })
})
