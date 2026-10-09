/**
 * 写作模式客户端模块（P1 从 entry.js 搬迁；行为不变）。
 */
import { getPrefs, subscribePrefs, loadPrefs, savePrefs } from '../../state/prefs-store.js'
import { getLibrary, subscribeLibrary, refreshLibrary } from '../../state/library-store.js'
import { setModeActive } from '../../state/mode-store.js'
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { api } from '../../services/writing-api.js'
import { pickFolderNative, hasNativePicker } from '../../services/folder-picker.js'
import { FolderBrowser } from './FolderBrowser.js'

export function WritingModeSettings() {
  const [prefs, setPrefsLocal] = react.useState(getPrefs)
  const library = react.useSyncExternalStore(subscribeLibrary, getLibrary)
  const roots = library.roots
  const treeByPath = new Map((library.tree || []).map((t) => [String(t.path || '').replace(/\\/g, '/').toLowerCase(), t]))
  const activeKey = String(library.activeRoot || '').replace(/\\/g, '/').toLowerCase()
  const base = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || '')
  const [pathDraft, setPathDraft] = react.useState('')
  // 选文件夹（2026-10-09）：原生系统对话框优先，没有那座桥就开内置浏览
  const [browserOpen, setBrowserOpen] = react.useState(false)
  const [browserStart, setBrowserStart] = react.useState('')
  const [picking, setPicking] = react.useState(false)
  const [pickNote, setPickNote] = react.useState('')
  react.useEffect(() => subscribePrefs(() => setPrefsLocal({ ...getPrefs() })), [])
  react.useEffect(() => {
    void loadPrefs()
    // 打开设置就重取一次库（与旧行为同请求数）；并发/失败语义由 store 承担。
    void refreshLibrary()
  }, [])

  function numInput(key, min, max, step) {
    return jsx.jsx('input', {
      type: 'number',
      className: 'dshWmField is-num',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(prefs[key]),
      onChange: (e) => void savePrefs({ [key]: Number(e.target.value) }),
    })
  }

  async function postRoots(body) {
    await api('roots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    await refreshLibrary()
    void loadPrefs()
  }

  async function addRoot() {
    await addRootPath(pathDraft)
  }

  /** 添加库根（浏览选中与手打共用同一条写路径）。 */
  async function addRootPath(p) {
    const value = String(p || '').trim()
    if (!value) return
    await postRoots({ mode: 'add', path: value, active: true })
    setPathDraft('')
  }

  /**
   * 「浏览…」：桌面版走系统原生文件夹对话框（与官方添加工作区同一个），
   * 其余环境退到内置文件夹浏览。取消不算错误，什么都不做。
   */
  async function browseForRoot() {
    if (picking) return
    setPickNote('')
    const start =
      String(pathDraft || '').trim() ||
      String(library.activeRoot || '') ||
      (roots && roots[0] ? String(roots[0].path) : '')
    setPicking(true)
    const native = await pickFolderNative()
    setPicking(false)
    if (native.ok) {
      if (native.path) await addRootPath(native.path)
      return
    }
    if (native.reason !== 'no-native') {
      setPickNote(`系统文件夹对话框打不开（${native.reason}），已改用内置浏览。`)
    }
    setBrowserStart(start)
    setBrowserOpen(true)
  }

  async function removeRoot(p) {
    await postRoots({ mode: 'remove', path: p })
  }

  /** 设为默认工作区（2026-10-09 新增）：同时切为当前库根——作者预期"默认=打开工作台时用的那个"。 */
  async function setDefaultRoot(p) {
    await postRoots({ mode: 'default', path: p })
  }

  async function activateRoot(p) {
    await postRoots({ mode: 'activate', path: p })
  }

  return jsx.jsx(
    'div',
    {
      className: 'dshWmSettings',
      children: [
        jsx.jsx(
          'div',
          {
            className: 'dshWmSetIntro',
            children: '写作工作台（Ctrl+Shift+W 或右下角进入）。设置即时生效并写入 ~/.dsh/writing-mode.json。',
          },
          'intro'
        ),
        jsx.jsx(
          'div',
          {
            className: 'dshWmSetRow',
            children: [
              jsx.jsx('span', { className: 'dshWmLabel', children: '工作区（库根）' }),
              jsx.jsx(
                'div',
                {
                  className: 'dshWmSetColumn',
                  children: [
                    ...(roots || []).map((r) => {
                      const t = treeByPath.get(String(r.path || '').replace(/\\/g, '/').toLowerCase())
                      const count = t && Array.isArray(t.projects) ? t.projects.length : null
                      const isActive = activeKey !== '' && activeKey === String(r.path || '').replace(/\\/g, '/').toLowerCase()
                      return jsx.jsxs(
                        'div',
                        {
                          className: 'dshWmSetRootRow',
                          children: [
                            jsx.jsxs('div', {
                              className: 'dshWmSetRootMain',
                              children: [
                                jsx.jsxs('div', {
                                  className: 'dshWmSetRootTitle',
                                  children: [
                                    jsx.jsx('span', { children: (r.missing ? '⚠ ' : '') + (r.label || base(r.path)) }, 'n'),
                                    r.default ? jsx.jsx('span', { className: 'dshWmTag', children: '默认' }, 'd') : null,
                                    isActive ? jsx.jsx('span', { className: 'dshWmTag is-on', children: '当前' }, 'a') : null,
                                    r.missing ? jsx.jsx('span', { className: 'dshWmTag is-warn', children: '路径不存在' }, 'm') : null,
                                  ],
                                }),
                                jsx.jsx('div', { className: 'dshWmSetRootPath', children: r.path }),
                                jsx.jsx('div', {
                                  className: 'dshWmSetHint',
                                  children: [
                                    count === null ? '' : count + ' 个作品',
                                    r.kind === 'project' ? ' · 单个项目' : '',
                                    r.missing ? ' · 请检查磁盘或移除' : '',
                                  ].join(''),
                                }),
                              ],
                            }),
                            jsx.jsxs('div', {
                              className: 'dshWmSetRootOps',
                              children: [
                                r.default
                                  ? null
                                  : jsx.jsx('button', {
                                      type: 'button',
                                      className: 'dshWmBtn',
                                      title: '设为默认工作区（同时切为当前库根）',
                                      onClick: () => void setDefaultRoot(r.path),
                                      children: '设为默认',
                                    }),
                                isActive || r.missing
                                  ? null
                                  : jsx.jsx('button', {
                                      type: 'button',
                                      className: 'dshWmBtn',
                                      title: '切换到这个工作区',
                                      onClick: () => void activateRoot(r.path),
                                      children: '切到此库',
                                    }),
                                jsx.jsx('button', {
                                  type: 'button',
                                  className: 'dshWmBtn',
                                  onClick: () => void removeRoot(r.path),
                                  children: '移除',
                                }),
                              ],
                            }),
                          ],
                        },
                        r.path
                      )
                    }),
                    jsx.jsx(
                      'div',
                      {
                        className: 'dshWmSetAddRow',
                        children: [
                          jsx.jsx('input', {
                            className: 'dshWmField is-grow',
                            placeholder: '例如 E:\\剧本',
                            value: pathDraft,
                            onChange: (e) => setPathDraft(e.target.value),
                            onKeyDown: (e) => {
                              if (e.key === 'Enter') void addRoot()
                            },
                          }),
                          jsx.jsx('button', {
                            type: 'button',
                            className: 'dshWmBtn is-primary',
                            onClick: () => void addRoot(),
                            children: '添加',
                          }),
                          jsx.jsx('button', {
                            type: 'button',
                            className: 'dshWmBtn dshWmBrowseBtn',
                            title: '在电脑里选择文件夹（不用手打路径）',
                            disabled: picking,
                            onClick: () => void browseForRoot(),
                            children: picking ? '选择中…' : '浏览…',
                          }),
                        ],
                      },
                      'add'
                    ),
                    jsx.jsx('div', {
                      className: 'dshWmSetHint',
                      children: hasNativePicker()
                        ? '「浏览…」打开系统文件夹对话框（与官方「添加工作区」同一个），选中的文件夹会立即成为库根。'
                        : '「浏览…」打开内置文件夹浏览，点着进目录即可；也可以在上面粘贴路径后按「添加」。',
                    }),
                    pickNote
                      ? jsx.jsx('div', { className: 'dshWmSetHint is-warn', children: pickNote })
                      : null,
                  ],
                }
              ),
            ],
          },
          'roots'
        ),
        jsx.jsx(
          'div',
          {
            className: 'dshWmSetRow',
            children: [
              jsx.jsx('span', { className: 'dshWmLabel', children: '正文字号' }),
              numInput('fontSize', 12, 28, 1),
              jsx.jsx('span', { className: 'dshWmSetHint', children: 'px' }),
            ],
          },
          'fs'
        ),
        jsx.jsx(
          'div',
          {
            className: 'dshWmSetRow',
            children: [
              jsx.jsx('span', { className: 'dshWmLabel', children: '行距' }),
              numInput('lineHeight', 1.4, 2.6, 0.05),
            ],
          },
          'lh'
        ),
        jsx.jsx(
          'div',
          {
            className: 'dshWmSetRow',
            children: [
              jsx.jsx('span', { className: 'dshWmLabel', children: '自动保存' }),
              numInput('autoSaveMs', 200, 5000, 100),
              jsx.jsx('span', { className: 'dshWmSetHint', children: 'ms（防抖）' }),
            ],
          },
          'as'
        ),
        jsx.jsx(
          'div',
          {
            className: 'dshWmSetRow',
            children: [
              jsx.jsx('span', { className: 'dshWmLabel', children: '保存后检查' }),
              jsx.jsx('input', {
                type: 'checkbox',
                checked: Boolean(prefs.autoGate),
                onChange: (e) => void savePrefs({ autoGate: e.target.checked }),
              }),
              jsx.jsx('span', { className: 'dshWmSetHint', children: 'md / fountain 存盘后自动跑一次' }),
            ],
          },
          'ag'
        ),
        jsx.jsx(
          'div',
          {
            className: 'dshWmSetSectionHead',
            children: 'AI 模型',
          },
          'ai-head'
        ),
        jsx.jsx(
          'div',
          {
            className: 'dshWmSetRow',
            children: [
              jsx.jsx('span', { className: 'dshWmLabel', children: '来源' }),
              jsx.jsx(
                'select',
                {
                  className: 'dshWmField',
                  value: prefs.aiMode === 'custom' ? 'custom' : 'harness',
                  onChange: (e) =>
                    void savePrefs({ aiMode: e.target.value === 'custom' ? 'custom' : 'harness' }),
                  children: [
                    jsx.jsx('option', { value: 'harness', children: 'Harness 全局默认（文字工具）' }, 'h'),
                    jsx.jsx('option', { value: 'custom', children: '自定义 Provider / Model' }, 'c'),
                  ],
                }
              ),
              jsx.jsx('span', {
                className: 'dshWmSetHint',
                children:
                  prefs.aiMode === 'custom'
                    ? '润色/续写/找资料走下面配置的模型'
                    : '文字工具使用 Harness 全局默认模型；写作伙伴使用其原生会话模型',
              }),
            ],
          },
          'ai-mode'
        ),
        prefs.aiMode === 'custom'
          ? jsx.jsx(
              'div',
              {
                className: 'dshWmSetRow is-top',
                children: [
                  jsx.jsx('span', { className: 'dshWmLabel', children: 'Provider' }),
                  jsx.jsx('input', {
                    className: 'dshWmField is-grow',
                    value: prefs.aiProvider,
                    placeholder: 'deepseek-official',
                    onChange: (e) => void savePrefs({ aiProvider: e.target.value }),
                  }),
                ],
              },
              'ai-prov'
            )
          : null,
        prefs.aiMode === 'custom'
          ? jsx.jsx(
              'div',
              {
                className: 'dshWmSetRow is-top',
                children: [
                  jsx.jsx('span', { className: 'dshWmLabel', children: 'Model' }),
                  jsx.jsx('input', {
                    className: 'dshWmField is-grow',
                    value: prefs.aiModel,
                    placeholder: 'deepseek-v4-flash',
                    onChange: (e) => void savePrefs({ aiModel: e.target.value }),
                  }),
                ],
              },
              'ai-model'
            )
          : null,
        prefs.aiMode === 'custom'
          ? jsx.jsx(
              'div',
              {
                className: 'dshWmSetRow is-top',
                children: [
                  jsx.jsx('span', { className: 'dshWmLabel', children: 'API Key' }),
                  jsx.jsx('input', {
                    type: 'password',
                    className: 'dshWmField is-grow',
                    value: prefs.aiApiKey,
                    placeholder: '可选；仅本机配置文件',
                    onChange: (e) => void savePrefs({ aiApiKey: e.target.value }),
                  }),
                ],
              },
              'ai-key'
            )
          : null,
        jsx.jsx(
          'div',
          {
            className: 'dshWmSetRow',
            children: [
              jsx.jsx('span', { className: 'dshWmLabel', children: '进入工作台' }),
              jsx.jsx('button', {
                type: 'button',
                className: 'dshWmBtn is-primary',
                onClick: () => setModeActive(true),
                children: '打开写作模式',
              }),
              jsx.jsx('span', { className: 'dshWmSetHint', children: '快捷键 Ctrl+Shift+W' }),
            ],
          },
          'open'
        ),
        // 内置文件夹浏览（原生桥不可用时由「浏览…」打开；open=false 时不渲染任何东西）
        jsx.jsx(
          FolderBrowser,
          {
            open: browserOpen,
            initialPath: browserStart,
            onCancel: () => setBrowserOpen(false),
            onPick: async (p) => {
              setBrowserOpen(false)
              await addRootPath(p)
            },
          },
          'picker'
        ),
      ],
    }
  )
}
