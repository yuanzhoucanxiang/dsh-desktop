/**
 * 写作模式客户端模块（P1 从 entry.js 搬迁；行为不变）。
 */
import { getPrefs, subscribePrefs, loadPrefs, savePrefs } from '../../state/prefs-store.js'
import { setModeActive } from '../../state/mode-store.js'
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { api, API } from '../../services/writing-api.js'

export function WritingModeSettings() {
  const [prefs, setPrefsLocal] = react.useState(getPrefs)
  const [roots, setRoots] = react.useState([])
  const [pathDraft, setPathDraft] = react.useState('')
  react.useEffect(() => subscribePrefs(() => setPrefsLocal({ ...getPrefs() })), [])
  react.useEffect(() => {
    void loadPrefs()
    void api('config')
      .then((d) => {
        if (d.ok) setRoots(d.roots || [])
      })
      .catch(() => {})
  }, [])

  const row = { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }
  const label = { width: 120, flex: 'none', color: 'var(--dsw-alias-label-secondary)', fontSize: 13 }
  const hint = { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', lineHeight: 1.5 }

  function numInput(key, min, max, step) {
    return jsx.jsx('input', {
      type: 'number',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(prefs[key]),
      style: {
        width: 90,
        padding: '6px 8px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: 13,
      },
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
    const d = await api('config')
    if (d.ok) setRoots(d.roots || [])
    void loadPrefs()
  }

  async function removeRoot(p) {
    await api('roots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'remove', path: p }),
    })
    const d = await api('config')
    if (d.ok) setRoots(d.roots || [])
  }

  return jsx.jsx(
    'div',
    {
      style: {
        width: '100%',
        maxWidth: 640,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        color: 'var(--dsw-alias-label-primary)',
      },
      children: [
        jsx.jsx(
          'div',
          {
            style: { fontSize: 13, color: 'var(--dsw-alias-label-tertiary)', marginBottom: 8 },
            children: '写作工作台（Ctrl+Shift+W 或右下角进入）。设置即时生效并写入 ~/.dsh/writing-mode.json。',
          },
          'intro'
        ),
        jsx.jsx(
          'div',
          {
            style: row,
            children: [
              jsx.jsx('span', { style: label, children: '库根目录' }),
              jsx.jsx(
                'div',
                {
                  style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 6 },
                  children: [
                    ...(roots || []).map((r) =>
                      jsx.jsx(
                        'div',
                        {
                          style: {
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 13,
                          },
                          children: [
                            jsx.jsx('span', {
                              style: {
                                flex: 1,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              },
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
                        style: { display: 'flex', gap: 8 },
                        children: [
                          jsx.jsx('input', {
                            style: {
                              flex: 1,
                              padding: '6px 10px',
                              borderRadius: 8,
                              border: '1px solid var(--dsw-alias-border-l2)',
                              background: 'var(--dsw-alias-bg-layer-2)',
                              color: 'var(--dsw-alias-label-primary)',
                              font: 'inherit',
                              fontSize: 13,
                            },
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
            style: row,
            children: [
              jsx.jsx('span', { style: label, children: '正文字号' }),
              numInput('fontSize', 12, 28, 1),
              jsx.jsx('span', { style: hint, children: 'px' }),
            ],
          },
          'fs'
        ),
        jsx.jsx(
          'div',
          {
            style: row,
            children: [
              jsx.jsx('span', { style: label, children: '行距' }),
              numInput('lineHeight', 1.4, 2.6, 0.05),
            ],
          },
          'lh'
        ),
        jsx.jsx(
          'div',
          {
            style: row,
            children: [
              jsx.jsx('span', { style: label, children: '自动保存' }),
              numInput('autoSaveMs', 200, 5000, 100),
              jsx.jsx('span', { style: hint, children: 'ms（防抖）' }),
            ],
          },
          'as'
        ),
        jsx.jsx(
          'div',
          {
            style: row,
            children: [
              jsx.jsx('span', { style: label, children: '保存后门禁' }),
              jsx.jsx('input', {
                type: 'checkbox',
                checked: Boolean(prefs.autoGate),
                onChange: (e) => void savePrefs({ autoGate: e.target.checked }),
              }),
              jsx.jsx('span', { style: hint, children: 'md / fountain 存盘后自动跑一次' }),
            ],
          },
          'ag'
        ),
        jsx.jsx(
          'div',
          {
            style: {
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid var(--dsw-alias-border-l2)',
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--dsw-alias-label-tertiary)',
              letterSpacing: '0.06em',
            },
            children: 'AI 模型',
          },
          'ai-head'
        ),
        jsx.jsx(
          'div',
          {
            style: row,
            children: [
              jsx.jsx('span', { style: label, children: '来源' }),
              jsx.jsx(
                'select',
                {
                  value: prefs.aiMode === 'custom' ? 'custom' : 'harness',
                  style: {
                    padding: '6px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--dsw-alias-border-l2)',
                    background: 'var(--dsw-alias-bg-layer-2)',
                    color: 'var(--dsw-alias-label-primary)',
                    font: 'inherit',
                    fontSize: 13,
                  },
                  onChange: (e) =>
                    void savePrefs({ aiMode: e.target.value === 'custom' ? 'custom' : 'harness' }),
                  children: [
                    jsx.jsx('option', { value: 'harness', children: 'Harness 全局默认（文字工具）' }, 'h'),
                    jsx.jsx('option', { value: 'custom', children: '自定义 Provider / Model' }, 'c'),
                  ],
                }
              ),
              jsx.jsx('span', {
                style: hint,
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
                style: { ...row, alignItems: 'flex-start' },
                children: [
                  jsx.jsx('span', { style: label, children: 'Provider' }),
                  jsx.jsx('input', {
                    style: {
                      flex: 1,
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--dsw-alias-border-l2)',
                      background: 'var(--dsw-alias-bg-layer-2)',
                      color: 'var(--dsw-alias-label-primary)',
                      font: 'inherit',
                      fontSize: 13,
                    },
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
                style: { ...row, alignItems: 'flex-start' },
                children: [
                  jsx.jsx('span', { style: label, children: 'Model' }),
                  jsx.jsx('input', {
                    style: {
                      flex: 1,
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--dsw-alias-border-l2)',
                      background: 'var(--dsw-alias-bg-layer-2)',
                      color: 'var(--dsw-alias-label-primary)',
                      font: 'inherit',
                      fontSize: 13,
                    },
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
                style: { ...row, alignItems: 'flex-start' },
                children: [
                  jsx.jsx('span', { style: label, children: 'API Key' }),
                  jsx.jsx('input', {
                    type: 'password',
                    style: {
                      flex: 1,
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--dsw-alias-border-l2)',
                      background: 'var(--dsw-alias-bg-layer-2)',
                      color: 'var(--dsw-alias-label-primary)',
                      font: 'inherit',
                      fontSize: 13,
                    },
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
            style: row,
            children: [
              jsx.jsx('span', { style: label, children: '进入工作台' }),
              jsx.jsx('button', {
                type: 'button',
                className: 'dshWmBtn is-primary',
                onClick: () => setModeActive(true),
                children: '打开写作模式',
              }),
              jsx.jsx('span', { style: hint, children: '快捷键 Ctrl+Shift+W' }),
            ],
          },
          'open'
        ),
      ],
    }
  )
}
