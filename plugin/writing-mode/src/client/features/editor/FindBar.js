/**
 * 查找/替换栏（P1-② 从 app/WritingModeApp.js 抽出；DOM、data-wm-find* 与 key 逐字不变）。
 * 纯 props 渲染：匹配集与动作由外壳算好传入（textarea 无高亮，靠选区定位）。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { T } from '../../copy.js'

export const FindBar = react.memo(function FindBar({
  findQuery,
  setFindQuery,
  replaceText,
  setReplaceText,
  findMatches,
  findIndex,
  findStep,
  findInputRef,
  documentState,
  isHistoryDoc,
  replaceCurrent,
  replaceAllMatches,
  setFindOpen,
}) {
  return jsx.jsxs(
    'div',
    {
      className: 'dshWmFindBar',
      'data-wm-findbar': '1',
      children: [
        jsx.jsx('input', {
          ref: findInputRef,
          className: 'dshWmFindInput',
          'data-wm-find-input': '1',
          value: findQuery,
          placeholder: T.findPlaceholder,
          spellCheck: false,
          onChange: e => setFindQuery(e.target.value),
          onKeyDown: e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              findStep(e.shiftKey ? -1 : 1)
            }
          },
        }, 'fq'),
        jsx.jsx('input', {
          className: 'dshWmFindInput is-replace',
          'data-wm-find-replace': '1',
          value: replaceText,
          placeholder: T.replacePlaceholder,
          spellCheck: false,
          onChange: e => setReplaceText(e.target.value),
        }, 'fr'),
        jsx.jsx('span', {
          className: 'dshWmFindCount',
          'data-wm-find-count': '1',
          children: findQuery
            ? (findMatches.length
                ? (findIndex + 1) + '/' + findMatches.length
                : T.findNone)
            : '',
        }, 'fc'),
        jsx.jsx('button', {
          type: 'button',
          className: 'dshWmBtn is-ghost',
          disabled: !findMatches.length,
          onClick: () => findStep(-1),
          children: T.findPrev,
        }, 'fp'),
        jsx.jsx('button', {
          type: 'button',
          className: 'dshWmBtn is-ghost',
          disabled: !findMatches.length,
          onClick: () => findStep(1),
          children: T.findNext,
        }, 'fn'),
        jsx.jsx('button', {
          type: 'button',
          className: 'dshWmBtn is-ghost',
          disabled: !findMatches.length || documentState.loading || isHistoryDoc,
          onClick: replaceCurrent,
          children: T.findReplace,
        }, 'frep'),
        jsx.jsx('button', {
          type: 'button',
          className: 'dshWmBtn is-ghost',
          disabled: !findMatches.length || documentState.loading || isHistoryDoc,
          onClick: replaceAllMatches,
          children: T.findReplaceAll,
        }, 'fra'),
        jsx.jsx('button', {
          type: 'button',
          className: 'dshWmBtn is-ghost',
          title: T.findClose,
          onClick: () => setFindOpen(false),
          children: '✕',
        }, 'fx'),
        jsx.jsx('span', { className: 'dshWmFindHint', children: T.findHint }, 'fh'),
      ],
    },
    'findbar'
  )
})
