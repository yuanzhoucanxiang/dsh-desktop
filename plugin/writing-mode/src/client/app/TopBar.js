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
  focus,
  setFocus,
  prefs,
  filePath,
  saveState,
  dirty,
  documentState,
  persist,
  close,
  archiveProj,
  onOpenArchive,
}) {
  // 「辅助 ▾」菜单：内容常挂载（门禁按文本点击不检查可见性），关闭时由 .dshWmMenu 规则 display:none
  const [auxOpen, setAuxOpen] = react.useState(false)
  const auxRef = react.useRef(null)
  /** 打开/关闭时恢复菜单的命中能力（关闭后由 .dshWmMenu 的 display:none 兜底）。 */
  const setAux = react.useCallback((next) => {
    const menu = auxRef.current?.querySelector?.('.dshWmMenu')
    if (menu) menu.style.pointerEvents = ''
    setAuxOpen(next)
  }, [])
  react.useEffect(() => {
    if (!auxOpen) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setAux(false) }
    const onDown = (e) => {
      if (auxRef.current?.contains(e.target)) return
      // 菜单是绝对定位挂在触发器下方，打开时会盖住右侧 AI 面板的顶部标签。
      // 外点关闭时 React 的 setState 是异步的：DOM 里的菜单还在、pointer-events 仍是 auto，
      // 于是这一次点击被菜单吃掉（观感就是"按了没反应"）。在 mousedown 当场让开命中，
      // 让同一次点击落到下面真正的元素上；下次打开时恢复。
      const menu = auxRef.current?.querySelector?.('.dshWmMenu')
      if (menu) menu.style.pointerEvents = 'none'
      setAuxOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [auxOpen, setAux])
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
        jsx.jsx('span', { className: 'dshWmBarSep' }, 'sep-roots'),
        // 档案（wiki）入口：作用于当前文稿所属项目。定位不到作品时**不再禁用**——
        // 灰掉的按钮只会让作者以为"档案打不开"（2026-10-10 用户反馈），改为可点并在点击时说明。
        jsx.jsx('button', {
          type: 'button',
          className: 'dshWmIconBtn',
          'data-wm-archive': '1',
          title: archiveProj ? T.archive + '：' + archiveProj.name : T.archiveHint,
          'aria-label': T.archive,
          onClick: () => onOpenArchive?.(),
          children: jsx.jsxs('svg', {
            width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
            stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
            'aria-hidden': 'true', focusable: 'false',
            children: [
              jsx.jsx('polyline', { points: '21 8 21 21 3 21 3 8' }, 'p'),
              jsx.jsx('rect', { x: 1, y: 3, width: 22, height: 5 }, 'r'),
              jsx.jsx('line', { x1: 10, y1: 12, x2: 14, y2: 12 }, 'l'),
            ],
          }, 'i'),
        }, 'archive'),
        jsx.jsx('span', { className: 'dshWmBarSpacer' }),
        jsx.jsx(
          'div',
          {
            className: 'dshWmBarGroup',
            children: [
              jsx.jsx('button', {
                type: 'button',
                className: 'dshWmBtn is-ghost' + (focus ? ' is-on' : ''),
                onClick: () => setFocus((v) => !v),
                'aria-pressed': focus,
                title: '专注：只留稿纸，收起文档库与右栏',
                children: T.focus,
              }),
              jsx.jsxs('div', { className: 'dshWmAux', ref: auxRef, children: [
                jsx.jsx('button', {
                  type: 'button',
                  className: 'dshWmBtn is-ghost' + (prefs.hemingway || prefs.typewriter ? ' is-on' : ''),
                  onClick: () => setAux(!auxOpen),
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
                    // 选完就收起菜单：菜单是绝对定位、会盖住右侧 AI 面板的顶部标签，
                    // 留着不收既挡按钮又让人以为"点了没反应"（2026-10-09 实测）。
                    onClick: () => { void savePrefs({ hemingway: !prefs.hemingway }); setAux(false) },
                    children: T.hemingway,
                  }, 'hemingway'),
                  jsx.jsx('button', {
                    type: 'button',
                    className: 'dshWmBtn dshWmMenuRow' + (prefs.typewriter ? ' is-on' : ''),
                    'data-wm-typewriter': '1',
                    'aria-pressed': prefs.typewriter,
                    title: T.typewriterHint,
                    onClick: () => { void savePrefs({ typewriter: !prefs.typewriter }); setAux(false) },
                    children: T.typewriter,
                  }, 'typewriter'),
                ] }, 'aux-menu'),
              ] }, 'aux'),
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
          className: 'dshWmBtn is-ghost',
          onClick: close,
          children: T.exit,
        }),
      ],
    },
    'bar'
  )
})
