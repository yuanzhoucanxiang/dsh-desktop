/**
 * 稿纸页头（P1-② 从 app/WritingModeApp.js 抽出；DOM、类名与 key 逐字不变）。
 * 路径行 / 文稿名 / 历史稿横幅 / 版本条 / 分隔线；纯 props 渲染，版本数据由外壳算好传入。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { T } from '../../copy.js'
import { stemWithExtOf } from '../../../shared/filename.js'

export const EditorChrome = react.memo(function EditorChrome({
  filePath,
  docFolder,
  docBasename,
  copied,
  copyPath,
  isReviewFile,
  sendReviewToChat,
  curVerNum,
  latestVer,
  isHistoryDoc,
  versionSeries,
  setFilePath,
  comparePrev,
  saveAsNewVersion,
}) {
  return jsx.jsx(
    'div',
    {
      className: 'dshWmDocChrome',
      children: [
        jsx.jsx(
          'div',
          {
            className: 'dshWmPathRow',
            children: [
              jsx.jsx('span', {
                className: 'dshWmPathText',
                children: filePath ? (docFolder ? docFolder + ' / ' : '') + docBasename : '—',
              }),
              filePath
                ? jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn is-ghost',
                    onClick: () => void copyPath(),
                    children: copied ? T.copied : T.copyPath,
                  })
                : null,
              isReviewFile
                ? jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn',
                    onClick: sendReviewToChat,
                    children: T.reviewFix,
                  })
                : null,
            ],
          },
          'pr'
        ),
        jsx.jsx(
          'div',
          {
            className: 'dshWmDocName',
            children:
              stemWithExtOf(docBasename || T.untitled) +
              (curVerNum != null ? '  v' + curVerNum : ''),
          },
          'dn'
        ),
        isHistoryDoc && latestVer
          ? jsx.jsx(
              'div',
              {
                className: 'dshWmHistBanner',
                children: [
                  jsx.jsx('span', {
                    children: T.isHistory + ' · ' + T.isLatest + ' v' + latestVer.v,
                  }, 'h'),
                  jsx.jsx('span', { className: 'dshWmSpacer' }),
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn',
                    onClick: () => setFilePath(latestVer.abs),
                    children: T.openLatest,
                  }),
                ],
              },
              'hb'
            )
          : null,
        filePath
          ? jsx.jsx(
              'div',
              {
                className: 'dshWmVerBar',
                children: [
                  jsx.jsx(
                    'span',
                    { className: 'dshWmVerBarLabel', children: T.versions },
                    'vl'
                  ),
                  ...versionSeries.map((s) =>
                    jsx.jsx(
                      'button',
                      {
                        type: 'button',
                        className:
                          'dshWmVerChip' +
                          (s.abs === filePath ? ' is-on' : ''),
                        onClick: () => setFilePath(s.abs),
                        children: 'v' + s.v,
                      },
                      'v' + s.v
                    )
                  ),
                  jsx.jsx(
                    'button',
                    {
                      type: 'button',
                      className: 'dshWmBtn is-ghost',
                      disabled: curVerNum == null || versionSeries.length < 2,
                      onClick: () => void comparePrev(),
                      children: T.comparePrev,
                    },
                    'cmp'
                  ),
                  jsx.jsx(
                    'button',
                    {
                      type: 'button',
                      className: 'dshWmBtn is-ghost',
                      disabled: !filePath,
                      title: T.bumpHint || T.saveAsNew,
                      onClick: () => void saveAsNewVersion(),
                      children: T.saveAsNew,
                    },
                    'bump'
                  ),
                ],
              },
              'vb'
            )
          : null,
        jsx.jsx('div', { className: 'dshWmDocRule' }, 'dr'),
      ],
    },
    'chrome'
  )
})
