/**
 * 左栏「文档库」（P1-② 从 app/WritingModeApp.js 抽出；DOM、类名、key 与事件语义逐字不变）。
 * 纯 props 渲染：库树/视图模式/内联新建条与三个视图切换全部来自 WritingModeApp。
 * 覆盖层（成书/档案）走 onExportBook / onOpenArchive 意图回调，本面板不碰覆盖层状态。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { T } from '../../copy.js'
import { FileRow } from './FileRow.js'
import { OutlineView } from './OutlineView.js'
import { groupFiles, navigationGroups, maxVersionInGroup, resourceChoices } from './grouping.js'

export const LibraryPane = react.memo(function LibraryPane({
  roots,
  activeTree,
  projects,
  openProjectMode,
  createDocInRoot,
  projMode,
  setProjMode,
  projTitle,
  setProjTitle,
  projPremise,
  setProjPremise,
  projTemplate,
  setProjTemplate,
  templates,
  commitProject,
  newDocMode,
  setNewDocMode,
  newDocName,
  setNewDocName,
  commitNewDoc,
  libraryView,
  setLibraryView,
  libQuery,
  setLibQuery,
  collapsed,
  toggleProj,
  filePath,
  setFilePath,
  handleReordered,
  flashMsg,
  addProjectResource,
  setAddRootMode,
  setAddRootPath,
  KEY_HINT,
  onOpenArchive,
  onExportBook,
}) {
  return jsx.jsx(
    'aside',
    {
      className: 'dshWmSide',
      children: [
        jsx.jsx(
          'div',
          {
            className: 'dshWmSideHead',
            children: [
              jsx.jsx('span', { children: T.docs }),
              jsx.jsx('span', { style: { flex: 1 } }),
              jsx.jsx('button', {
                type: 'button',
                className: 'dshWmBtn',
                onClick: openProjectMode,
                children: T.newProject,
              }),
              jsx.jsx('button', {
                type: 'button',
                className: 'dshWmBtn',
                onClick: createDocInRoot,
                children: T.newDoc,
              }),
            ],
          },
          'dh'
        ),
        projMode
          ? jsx.jsx(
              'div',
              {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '0 10px 10px',
                },
                children: [
                  jsx.jsx('input', {
                    className: 'dshWmSearch',
                    style: { margin: 0 },
                    value: projTitle,
                    autoFocus: true,
                    placeholder: T.projTitle,
                    onChange: (e) => setProjTitle(e.target.value),
                  }),
                  jsx.jsx('input', {
                    className: 'dshWmSearch',
                    style: { margin: 0 },
                    value: projPremise,
                    placeholder: T.projPremise,
                    onChange: (e) => setProjPremise(e.target.value),
                  }),
                  jsx.jsx(
                    'select',
                    {
                      className: 'dshWmSearch',
                      style: { margin: 0 },
                      value: projTemplate,
                      onChange: (e) => setProjTemplate(e.target.value),
                      children: (templates.length
                        ? templates
                        : [
                            { id: 'novel', name: '小说 · 长篇连载' },
                            { id: 'shortdrama', name: '短剧 · 竖屏' },
                            { id: 'screenplay', name: '电影 / 剧集' },
                          ]
                      ).map((t) =>
                        jsx.jsx(
                          'option',
                          { value: t.id, children: t.name },
                          t.id
                        )
                      ),
                    },
                    'tmpl'
                  ),
                  jsx.jsx('p', { className: 'dshWmAiHint', children: '只创建作品概览和第一篇正文，其他资料需要时再添加。' }, 'starter-hint'),
                  jsx.jsx(
                    'div',
                    {
                      style: { display: 'flex', gap: 6 },
                      children: [
                        jsx.jsx('button', {
                          type: 'button',
                          className: 'dshWmBtn is-primary',
                          onClick: () => void commitProject(),
                          children: T.create,
                        }),
                        jsx.jsx('button', {
                          type: 'button',
                          className: 'dshWmBtn',
                          onClick: () => setProjMode(false),
                          children: T.cancel,
                        }),
                      ],
                    },
                    'pb'
                  ),
                ],
              },
              'proj'
            )
          : null,
        newDocMode
          ? jsx.jsx(
              'div',
              {
                style: { display: 'flex', gap: 6, padding: '0 10px 8px' },
                children: [
                  jsx.jsx('input', {
                    className: 'dshWmSearch',
                    style: { margin: 0, flex: 1 },
                    value: newDocName,
                    autoFocus: true,
                    placeholder: T.untitled,
                    onChange: (e) => setNewDocName(e.target.value),
                    onKeyDown: (e) => {
                      if (e.key === 'Enter') commitNewDoc()
                      if (e.key === 'Escape') setNewDocMode(false)
                    },
                  }),
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn is-primary',
                    onClick: commitNewDoc,
                    children: 'OK',
                  }),
                ],
              },
              'new-doc'
            )
          : null,
        roots.length > 0 ? jsx.jsx('div', {
          style: { padding: '8px', display: 'flex', gap: 6 },
          children: [['writing', '作品导航'], ['files', '文件视图'], ['outline', '大纲']].map(([value, label]) => jsx.jsx('button', {
            type: 'button', className: 'dshWmBtn', 'aria-pressed': libraryView === value,
            onClick: () => setLibraryView(value), children: label,
          }, value)),
        }, 'library-view') : null,
        roots.length > 0
          ? jsx.jsx(
              'div',
              {
                style: { padding: '8px 8px 0' },
                children: jsx.jsx('input', {
                  className: 'dshWmSearch',
                  value: libQuery,
                  placeholder: T.search,
                  onChange: (e) => setLibQuery(e.target.value),
                }),
              },
              'sq'
            )
          : null,
        jsx.jsx(
          'div',
          {
            className: 'dshWmList',
            children:
              libraryView === 'outline'
                ? jsx.jsx(OutlineView, { projects, onOpen: (abs) => setFilePath(abs), onReorderDone: handleReordered, onFlash: flashMsg }, 'outline-view')
                : roots.length === 0
                ? jsx.jsx(
                    'div',
                    {
                      className: 'dshWmWelcome',
                      children: [
                        jsx.jsx(
                          'div',
                          { className: 'dshWmWelcomeTitle', children: T.toggle },
                          'wt'
                        ),
                        jsx.jsx(
                          'div',
                          { className: 'dshWmWelcomeBody', children: T.empty },
                          'wb'
                        ),
                        jsx.jsx(
                          'button',
                          {
                            type: 'button',
                            className: 'dshWmBtn is-primary',
                            onClick: () => {
                              setAddRootMode(true)
                              setAddRootPath('E:\\剧本')
                            },
                            children: T.emptyCta,
                          },
                          'wc'
                        ),
                        jsx.jsx(
                          'div',
                          {
                            className: 'dshWmAiHint',
                            children: KEY_HINT,
                          },
                          'wk'
                        ),
                      ],
                    },
                    'wel'
                  )
                : projects.length === 0
                  ? jsx.jsx('div', {
                      className: 'dshWmEmpty',
                      children: (activeTree && activeTree.missing ? T.missing + '\n' : '') + T.noProjects,
                    })
                  : projects.map((proj) => {
                      const groups = libraryView === 'files' ? groupFiles(proj.files, libQuery) : navigationGroups(proj.files, libQuery)
                      const openP = !collapsed.has(proj.path)
                      const maxDraft = maxVersionInGroup(
                        (proj.files || []).filter((f) => String(f.rel).startsWith('draft/'))
                      )
                      if (libQuery && groups.length === 0) return null
                      return jsx.jsx(
                        'div',
                        {
                          className: 'dshWmProj',
                          children: [
                            jsx.jsx(
                              'button',
                              {
                                type: 'button',
                                className: 'dshWmProjToggle',
                                onClick: () => toggleProj(proj.path),
                                children: [
                                  jsx.jsx(
                                    'span',
                                    {
                                      className:
                                        'dshWmProjChev' + (openP ? ' is-open' : ''),
                                      children: '▸',
                                    },
                                    'c'
                                  ),
                                  jsx.jsx('span', { children: proj.name }, 'n'),
                                ],
                              },
                              'pt'
                            ),
                            openP ? jsx.jsxs('div', {
                              className: 'dshWmProjOps',
                              children: [
                                jsx.jsx('button', {
                                  type: 'button',
                                  className: 'dshWmBtn is-ghost',
                                  title: '作品档案：已确认设定、进度与资料的只读汇总页',
                                  onClick: () => onOpenArchive(proj),
                                  children: '档案',
                                }, 'archive'),
                                jsx.jsx('button', {
                                  type: 'button',
                                  className: 'dshWmBtn is-ghost',
                                  title: '导出成书：把各章最新版按顺序拼成一份完整书稿（原稿不动）',
                                  onClick: () => onExportBook(proj),
                                  children: '成书',
                                }, 'export'),
                                jsx.jsx('select', {
                                  className: 'dshWmSearch', 'aria-label': '按需添加资料', value: '',
                                  onChange: e => void addProjectResource(proj, e.target.value),
                                  children: [jsx.jsx('option', { value: '', children: '＋ 添加人物、设定或规划…' }, 'placeholder'),
                                    ...resourceChoices.filter(item => !(proj.files || []).some(f => f.rel === item.rel)).map(item => jsx.jsx('option', { value: item.rel, children: item.label }, item.rel))],
                                }, 'add-resource'),
                              ],
                            }, 'proj-ops') : null,
                            proj.scanWarning ? jsx.jsx('p', { role: 'status', children: proj.scanWarning }) : null,
                            openP
                              ? groups.map((g) =>
                                  jsx.jsx(
                                    'details',
                                    {
                                      open: libraryView === 'files' || Boolean(libQuery) || ['正文', '作品概览'].includes(g.key) || g.files.some(f => f.abs === filePath),
                                      children: [
                                        jsx.jsx(
                                          'summary',
                                          {
                                            className: 'dshWmFolder',
                                            style: { cursor: 'pointer', textTransform: 'none' },
                                            children: g.key === '·' ? 'ROOT' : g.key,
                                          },
                                          'fh'
                                        ),
                                        ...g.files.map((f) =>
                                          jsx.jsx(FileRow, {
                                            file: f,
                                            maxVer: String(f.rel).startsWith('draft/') ? maxDraft : 0,
                                            active: Boolean(filePath) && f.abs === filePath,
                                            onPick: setFilePath,
                                            labels: T,
                                          }, f.abs)
                                        ),
                                      ],
                                    },
                                    'g-' + g.key
                                  )
                                )
                              : null,
                          ],
                        },
                        proj.path
                      )
                    }),
          },
          'dl'
        ),
      ],
    },
    'docs'
  )
})
