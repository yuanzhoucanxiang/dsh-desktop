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
  setAddRootKind,
  addRootMode,
  addRootPath,
  addRootKind,
  commitAddRoot,
  KEY_HINT,
  onCollapse,
  onOpenArchive,
  onExportBook,
}) {
  // F1 「＋」入口菜单：四个「加东西」入口收在一处；内容常挂载（门禁按文本点击不看可见性），
  // 关闭时由 .dshWmMenu 规则 display:none；Esc 或点菜单外关闭。
  const [menuOpen, setMenuOpen] = react.useState(false)
  const menuRef = react.useRef(null)
  react.useEffect(() => {
    if (!menuOpen) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    const onDown = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [menuOpen])
  return jsx.jsx(
    'aside',
    {
      className: 'dshWmSide',
      children: [
        jsx.jsxs(
          'div',
          {
            className: 'dshWmSideHead',
            children: [
              jsx.jsx('span', { children: T.docs }),
              jsx.jsx('span', { className: 'dshWmSpacer' }),
              jsx.jsxs('div', { className: 'dshWmAux', ref: menuRef, children: [
                jsx.jsx('button', {
                  type: 'button',
                  className: 'dshWmBtn is-ghost',
                  onClick: () => setMenuOpen((v) => !v),
                  'aria-expanded': menuOpen,
                  title: '新建 / 添加',
                  children: '＋',
                }, 'add-btn'),
                jsx.jsxs('div', { className: 'dshWmMenu' + (menuOpen ? ' is-open' : ''), children: [
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn dshWmMenuRow',
                    onClick: () => { setMenuOpen(false); createDocInRoot() },
                    children: '新建文稿',
                  }, 'new-doc'),
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn dshWmMenuRow',
                    onClick: () => { setMenuOpen(false); openProjectMode() },
                    children: T.newProject,
                  }, 'new-proj'),
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn dshWmMenuRow',
                    title: T.addRoot,
                    onClick: () => { setMenuOpen(false); setAddRootKind('library'); setAddRootMode(true) },
                    children: '添加作品库',
                  }, 'add-lib'),
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn dshWmMenuRow',
                    title: '读取原有目录，不搬动资料、不自动确认设定',
                    onClick: () => { setMenuOpen(false); setAddRootKind('project'); setAddRootPath(''); setAddRootMode(true) },
                    children: '打开已有',
                  }, 'open-existing'),
                ] }, 'add-menu'),
              ] }, 'add'),
              jsx.jsx('button', {
                type: 'button',
                className: 'dshWmSideFold',
                title: T.hideLib,
                'aria-label': T.hideLib,
                onClick: () => onCollapse?.(),
                children: '⟨',
              }, 'fold'),
            ],
          },
          'dh'
        ),
        addRootMode
          ? jsx.jsx(
              'span',
              {
                className: 'dshWmBarGroup',
                children: [
                  jsx.jsx('select', {
                    'aria-label': '文件夹用途', value: addRootKind,
                    onChange: e => setAddRootKind(e.target.value),
                    children: [jsx.jsx('option', { value: 'library', children: '作品库（包含多个项目）' }), jsx.jsx('option', { value: 'project', children: '已有项目（保留原目录）' })],
                  }),
                  jsx.jsx('input', {
                    className: 'dshWmSearch is-compact',
                    value: addRootPath,
                    placeholder: addRootKind === 'project' ? '已有作品文件夹完整路径' : 'E:\\剧本',
                    'aria-label': '文件夹路径',
                    autoFocus: true,
                    onChange: (e) => setAddRootPath(e.target.value),
                    onKeyDown: (e) => {
                      if (e.nativeEvent?.isComposing || e.keyCode === 229) return
                      if (e.key === 'Enter') void commitAddRoot()
                      if (e.key === 'Escape') setAddRootMode(false)
                    },
                  }),
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn is-primary',
                    onClick: () => void commitAddRoot(),
                    children: addRootKind === 'project' ? '打开项目' : '添加库',
                  }),
                ],
              },
              'add-root'
            )
          : null,
        projMode
          ? jsx.jsx(
              'div',
              {
                className: 'dshWmProjForm',
                children: [
                  jsx.jsx('input', {
                    className: 'dshWmSearch is-flat',
                    value: projTitle,
                    autoFocus: true,
                    placeholder: T.projTitle,
                    onChange: (e) => setProjTitle(e.target.value),
                  }),
                  jsx.jsx('input', {
                    className: 'dshWmSearch is-flat',
                    value: projPremise,
                    placeholder: T.projPremise,
                    onChange: (e) => setProjPremise(e.target.value),
                  }),
                  jsx.jsx(
                    'select',
                    {
                      className: 'dshWmSearch is-flat',
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
                      className: 'dshWmProjFormActions',
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
                className: 'dshWmNewDocRow',
                children: [
                  jsx.jsx('input', {
                    className: 'dshWmSearch is-flat is-grow',
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
          className: 'dshWmLibViews',
          children: [['writing', '作品导航'], ['files', '文件视图'], ['outline', '大纲']].map(([value, label]) => jsx.jsx('button', {
            type: 'button', className: 'dshWmBtn', 'aria-pressed': libraryView === value,
            onClick: () => setLibraryView(value), children: label,
          }, value)),
        }, 'library-view') : null,
        roots.length > 0
          ? jsx.jsx(
              'div',
              {
                className: 'dshWmSearchWrap',
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
                                  className: 'dshWmSearch dshWmAddRes', 'aria-label': '按需添加资料', value: '',
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
                                            className: 'dshWmFolder is-clickable',
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
