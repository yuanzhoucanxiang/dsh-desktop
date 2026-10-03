/**
 * 写作模式客户端模块（P1 从 entry.js 搬迁；行为不变）。
 */
import { getPrefs, subscribePrefs, loadPrefs, savePrefs } from '../../state/prefs-store.js'
import { getLibrary, subscribeLibrary, refreshLibrary } from '../../state/library-store.js'
import { setModeActive } from '../../state/mode-store.js'
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { api } from '../../services/writing-api.js'

export function WritingModeSettings() {
  const [prefs, setPrefsLocal] = react.useState(getPrefs)
  const roots = react.useSyncExternalStore(subscribeLibrary, getLibrary).roots
  const [pathDraft, setPathDraft] = react.useState('')
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

  async function addRoot() {
    const p = String(pathDraft || '').trim()
    if (!p) return
    await api('roots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'add', path: p, active: true }),
    })
    setPathDraft('')
    await refreshLibrary()
    void loadPrefs()
  }

  async function removeRoot(p) {
    await api('roots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'remove', path: p }),
    })
    await refreshLibrary()
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
              jsx.jsx('span', { className: 'dshWmLabel', children: '库根目录' }),
              jsx.jsx(
                'div',
                {
                  className: 'dshWmSetColumn',
                  children: [
                    ...(roots || []).map((r) =>
                      jsx.jsx(
                        'div',
                        {
                          className: 'dshWmSetRootRow',
                          children: [
                            jsx.jsx('span', {
                              className: 'dshWmSetRootPath',
                              children: (r.missing ? '⚠ ' : '') + r.path,
                            }),
                            jsx.jsx('button', {
                              type: 'button',
                              className: 'dshWmBtn',
                              onClick: () => void removeRoot(r.path),
                              children: '移除',
                            }),
                          ],
                        },
                        r.path
                      )
                    ),
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
                        ],
                      },
                      'add'
                    ),
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
              jsx.jsx('span', { className: 'dshWmLabel', children: '保存后门禁' }),
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
      ],
    }
  )
}
