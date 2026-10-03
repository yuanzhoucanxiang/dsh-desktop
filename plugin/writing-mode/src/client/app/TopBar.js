/**
 * 顶栏（P1-② 从 app/WritingModeApp.js 抽出）。
 * 状态与动作仍全部来自 WritingModeApp；本地只有「辅助 ▾」菜单的开合（E1 控件降噪）。
 */
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { T } from '../copy.js'
import { savePrefs } from '../state/prefs-store.js'
import { basenameOf } from '../../shared/filename.js'

export const TopBar = react.memo(function TopBar({
  roots,
  activeRoot,
  activateRoot,
  setAddRootMode,
  setAddRootPath,
  setAddRootKind,
  addRootMode,
  addRootPath,
  addRootKind,
  commitAddRoot,
  libOpen,
  setLibOpen,
  focus,
  setFocus,
  prefs,
  aiOpen,
  setAiOpen,
  filePath,
  saveState,
  dirty,
  documentState,
  persist,
  close,
}) {
  // 「辅助 ▾」菜单：内容常挂载（门禁按文本点击不检查可见性），关闭时由 .dshWmMenu 规则 display:none
  const [auxOpen, setAuxOpen] = react.useState(false)
  const auxRef = react.useRef(null)
  react.useEffect(() => {
    if (!auxOpen) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setAuxOpen(false) }
    const onDown = (e) => { if (!auxRef.current?.contains(e.target)) setAuxOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [auxOpen])
  return jsx.jsx(
    'div',
    {
      className: 'dshWmBar',
      children: [
        jsx.jsx('span', { className: 'dshWmBrand', children: '写作台' }),
        roots.length > 0
          ? jsx.jsx(
              'select',
              {
                className: 'dshWmSelect',
                value: activeRoot || '',
                onChange: (e) => void activateRoot(e.target.value),
                title: T.switchRoot,
                children: roots.map((r) =>
                  jsx.jsx(
                    'option',
                    {
                      value: r.path,
                      children: (r.missing ? '⚠ ' : '') + (r.label || basenameOf(r.path)),
                    },
                    r.path
                  )
                ),
              },
              'roots'
            )
          : null,
        jsx.jsx('button', {
          type: 'button',
          className: 'dshWmBtn is-ghost',
          onClick: () => { setAddRootKind('library'); setAddRootMode(true) },
          title: T.addRoot,
          children: '+',
        }),
        jsx.jsx('button', {
          type: 'button',
          className: 'dshWmBtn is-ghost',
          onClick: () => { setAddRootKind('project'); setAddRootPath(''); setAddRootMode(true) },
          children: '打开已有',
          title: '读取原有目录，不搬动资料、不自动确认设定',
        }),
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
        jsx.jsx('span', { className: 'dshWmBarSep' }, 'sep-roots'),
        jsx.jsx('span', { className: 'dshWmBarSpacer' }),
        jsx.jsx(
          'div',
          {
            className: 'dshWmBarGroup',
            children: [
              jsx.jsx('button', {
                type: 'button',
                className: 'dshWmBtn is-ghost',
                onClick: () => setLibOpen((v) => !v),
                title: libOpen ? T.hideLib : T.showLib,
                children: libOpen ? '⟨ 库' : '库 ⟩',
              }),
              jsx.jsx('button', {
                type: 'button',
                className: 'dshWmBtn' + (focus ? ' is-on' : ''),
                onClick: () => setFocus((v) => !v),
                'aria-pressed': focus,
                title: '专注：只留稿纸，收起文档库与右栏',
                children: T.focus,
              }),
              jsx.jsxs('div', { className: 'dshWmAux', ref: auxRef, children: [
                jsx.jsx('button', {
                  type: 'button',
                  className: 'dshWmBtn' + (prefs.hemingway || prefs.typewriter ? ' is-on' : ''),
                  onClick: () => setAuxOpen((v) => !v),
                  'aria-expanded': auxOpen,
                  title: '写作辅助开关',
                  children: '辅助 ▾',
                }, 'aux-btn'),
                jsx.jsxs('div', { className: 'dshWmMenu' + (auxOpen ? ' is-open' : ''), children: [
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn dshWmMenuRow' + (prefs.hemingway ? ' is-on' : ''),
                    'data-wm-hemingway': '1',
                    'aria-pressed': prefs.hemingway,
                    title: T.hemingwayHint,
                    onClick: () => { void savePrefs({ hemingway: !prefs.hemingway }) },
                    children: T.hemingway,
                  }, 'hemingway'),
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn dshWmMenuRow' + (prefs.typewriter ? ' is-on' : ''),
                    'data-wm-typewriter': '1',
                    'aria-pressed': prefs.typewriter,
                    title: T.typewriterHint,
                    onClick: () => { void savePrefs({ typewriter: !prefs.typewriter }) },
                    children: T.typewriter,
                  }, 'typewriter'),
                ] }, 'aux-menu'),
              ] }, 'aux'),
              jsx.jsx('button', {
                type: 'button',
                className: 'dshWmBtn' + (aiOpen && !focus ? ' is-on' : ''),
                // 专注模式下右栏被整体收起，此时「AI」按钮必须真的能唤回右栏，
                // 否则就是一只按了没反应的按钮（专注中的用户最不需要这个）。
                onClick: () => {
                  if (focus) { setFocus(false); setAiOpen(true) }
                  else setAiOpen((v) => !v)
                },
                'aria-pressed': focus ? false : aiOpen,
                children: aiOpen && !focus ? T.closeAi : T.openAi,
              }),
            ],
          },
          'views'
        ),
        jsx.jsx('span', { className: 'dshWmBarSep' }, 'sep-save'),
        jsx.jsx('span', { className: 'dshWmBarGroup', children: [
          jsx.jsx('button', {
            type: 'button',
            className: 'dshWmBtn is-primary',
            disabled: !filePath,
            title: saveState === 'error' ? documentState.error : undefined,
            onClick: () => void persist(),
            children: saveState === 'saving'
              ? T.saving
              : saveState === 'error'
                ? '重试保存'
                : saveState === 'saved' && !dirty
                  ? T.saved
                  : T.save,
          }),
        ]}, 'file-ops'),
        jsx.jsx('span', { className: 'dshWmBarSep' }, 'sep-exit'),
        jsx.jsx('button', {
          type: 'button',
          className: 'dshWmBtn',
          onClick: close,
          children: T.exit,
        }),
      ],
    },
    'bar'
  )
})
