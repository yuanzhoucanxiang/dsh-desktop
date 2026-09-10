/**
 * Browser half of @dsh-local/writing-mode.
 *
 * shell.overlay 挂全屏写作工作台：
 *   关闭态 → 右下角浮动切换钮
 *   打开态 → 三栏布局（文档库 / 专注编辑器 / AI 助手）盖住聊天
 * 数据走同源 /api/writing-mode。不碰内核私有 DOM。
 */
window.__ModuleLoader__.load({
  id: '@dsh-local/writing-mode',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    if (window.__dshWritingModeLoaded === true) {
      exports.name = 'writing-mode'
      exports.apply = function () {}
      exports.inject = []
      return module.exports
    }
    window.__dshWritingModeLoaded = true

    const react = require('react')
    const jsx = require('react/jsx-runtime')
    const API = '/api/writing-mode'
    const LS_KEY = 'dsh-writing-mode-active'

    const zh = {
      toggle: '写作模式',
      exit: '退出写作',
      docs: '文档',
      newDoc: '新建',
      untitled: '未命名',
      save: '保存',
      saved: '已保存',
      saving: '保存中…',
      delete: '删除',
      confirmDelete: '删除这篇文档？',
      ai: 'AI 助手',
      polish: '润色',
      continue: '续写',
      outline: '大纲',
      compress: '压缩',
      expand: '扩写',
      run: '运行',
      insert: '插入文末',
      replaceSel: '替换选区',
      sendChat: '发送到会话',
      applying: '处理中…',
      noText: '先选中或写点内容',
      aiUnavailable: '内核未提供 LLM 服务，可「发送到会话」由主对话完成。',
      empty: '还没有文档，点「新建」开始。',
      focus: '专注',
      chars: '字',
      words: '字数',
      aiClosed: 'AI 面板已收起',
      openAi: '打开 AI',
      closeAi: '收起 AI',
    }
    const en = {
      toggle: 'Writing',
      exit: 'Exit writing',
      docs: 'Docs',
      newDoc: 'New',
      untitled: 'Untitled',
      save: 'Save',
      saved: 'Saved',
      saving: 'Saving…',
      delete: 'Delete',
      confirmDelete: 'Delete this document?',
      ai: 'Assistant',
      polish: 'Polish',
      continue: 'Continue',
      outline: 'Outline',
      compress: 'Compress',
      expand: 'Expand',
      run: 'Run',
      insert: 'Append',
      replaceSel: 'Replace selection',
      sendChat: 'Send to chat',
      applying: 'Working…',
      noText: 'Select or write something first',
      aiUnavailable: 'No LLM service; use Send to chat instead.',
      empty: 'No documents yet — create one.',
      focus: 'Focus',
      chars: 'chars',
      words: 'Words',
      aiClosed: 'Assistant closed',
      openAi: 'Open AI',
      closeAi: 'Hide AI',
    }

    function pickLocale() {
      try {
        const lang = String(navigator.language || '').toLowerCase()
        return lang.startsWith('zh') ? zh : en
      } catch {
        return zh
      }
    }
    const T = pickLocale()

    /* ── CSS（令牌驱动，跟内核明暗主题）── */
    const CSS = [
      '.dshWmFloat{',
      '  position:fixed;right:18px;bottom:18px;z-index:50;',
      '  display:inline-flex;align-items:center;gap:6px;',
      '  height:36px;padding:0 14px;border-radius:18px;cursor:pointer;',
      '  border:1px solid var(--dsw-alias-border-l2);',
      '  background:var(--dsw-alias-bg-layer-3);',
      '  color:var(--dsw-alias-label-primary);',
      '  font:inherit;font-size:13px;line-height:1;',
      '  box-shadow:var(--dsw-shadow-lv2,0 2px 10px rgba(0,0,0,.14));',
      '}',
      '.dshWmFloat:hover{border-color:var(--dsw-alias-brand-primary);}',
      '.dshWmRoot{',
      '  position:fixed;inset:0;z-index:80;',
      '  display:flex;flex-direction:column;',
      '  background:var(--dsw-alias-bg-base);',
      '  color:var(--dsw-alias-label-primary);',
      '  font-family:inherit;',
      '}',
      '.dshWmBar{',
      '  display:flex;align-items:center;gap:10px;',
      '  height:44px;padding:0 14px;flex:none;',
      '  border-bottom:1px solid var(--dsw-alias-border-l2);',
      '  background:var(--dsw-alias-bg-layer-1);',
      '}',
      '.dshWmBarTitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary);}',
      '.dshWmBarSpacer{flex:1;}',
      '.dshWmBtn{',
      '  font:inherit;font-size:12px;padding:5px 12px;border-radius:8px;cursor:pointer;',
      '  background:transparent;color:var(--dsw-alias-label-secondary);',
      '  border:1px solid var(--dsw-alias-border-l2);',
      '}',
      '.dshWmBtn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);}',
      '.dshWmBtn.is-primary{',
      '  background:var(--dsw-alias-button-primary-fill);',
      '  color:var(--dsw-alias-label-primary-foreground);border-color:transparent;',
      '}',
      '.dshWmBtn.is-danger{color:var(--dsw-alias-state-error-primary);}',
      '.dshWmBody{flex:1;display:flex;min-height:0;}',
      '.dshWmSide{',
      '  width:220px;flex:none;display:flex;flex-direction:column;min-height:0;',
      '  border-right:1px solid var(--dsw-alias-border-l2);',
      '  background:var(--dsw-alias-bg-layer-1);',
      '}',
      '.dshWmSide.is-ai{width:280px;border-right:none;border-left:1px solid var(--dsw-alias-border-l2);}',
      '.dshWmSideHead{',
      '  display:flex;align-items:center;gap:8px;padding:10px 12px;flex:none;',
      '  border-bottom:1px solid var(--dsw-alias-border-l2);',
      '  font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);',
      '}',
      '.dshWmList{flex:1;overflow:auto;padding:8px;}',
      '.dshWmItem{',
      '  display:block;width:100%;text-align:left;cursor:pointer;',
      '  padding:8px 10px;margin-bottom:4px;border-radius:8px;border:1px solid transparent;',
      '  background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;',
      '}',
      '.dshWmItem:hover{background:var(--dsw-alias-interactive-bg-hover);}',
      '.dshWmItem.is-on{',
      '  border-color:var(--dsw-alias-brand-primary);',
      '  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);',
      '}',
      '.dshWmItemTitle{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dshWmItemMeta{display:block;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:2px;}',
      '.dshWmMain{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;}',
      '.dshWmTitleRow{',
      '  display:flex;align-items:center;gap:8px;padding:10px 16px 0;flex:none;',
      '}',
      '.dshWmTitle{',
      '  flex:1;font:inherit;font-size:18px;font-weight:600;',
      '  border:none;outline:none;background:transparent;color:var(--dsw-alias-label-primary);',
      '  padding:6px 0;',
      '}',
      '.dshWmEditor{',
      '  flex:1;min-height:0;width:100%;resize:none;outline:none;border:none;',
      '  padding:12px 28px 32px;font-family:var(--ds-font-family-code,ui-monospace,monospace);',
      '  font-size:15px;line-height:1.75;color:var(--dsw-alias-label-primary);',
      '  background:transparent;',
      '}',
      '.dshWmStatus{',
      '  flex:none;height:28px;display:flex;align-items:center;gap:12px;padding:0 16px;',
      '  border-top:1px solid var(--dsw-alias-border-l2);',
      '  font-size:11px;color:var(--dsw-alias-label-tertiary);',
      '}',
      '.dshWmAiBody{flex:1;display:flex;flex-direction:column;min-height:0;padding:10px;gap:8px;}',
      '.dshWmAiActions{display:flex;flex-wrap:wrap;gap:6px;}',
      '.dshWmAiOut{',
      '  flex:1;min-height:0;overflow:auto;padding:10px;border-radius:8px;',
      '  border:1px solid var(--dsw-alias-border-l2);',
      '  background:var(--dsw-alias-bg-layer-2);',
      '  font-size:13px;line-height:1.65;white-space:pre-wrap;word-break:break-word;',
      '}',
      '.dshWmAiHint{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.5;}',
      '.dshWmEmpty{padding:24px;color:var(--dsw-alias-label-tertiary);font-size:13px;}',
      '.dshWmCollapsedAi .dshWmMain{margin-right:0;}',
      // 专注模式：收起两侧
      'body[data-writing-focus="1"] .dshWmSide{display:none;}',
      'body[data-writing-focus="1"] .dshWmEditor{',
      '  max-width:720px;margin:0 auto;width:100%;font-size:17px;line-height:1.85;',
      '}',
      'body[data-writing-focus="1"] .dshWmTitleRow{max-width:720px;margin:0 auto;width:100%;}',
    ].join('\n')
    const TAG = 'dsh-writing-mode-css'
    if (typeof document !== 'undefined' && !document.getElementById(TAG)) {
      const tag = document.createElement('style')
      tag.id = TAG
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    async function api(route, opts) {
      const url = route ? `${API}?route=${encodeURIComponent(route)}` : API
      const res = await fetch(url, opts)
      const data = await res.json().catch(() => ({ ok: false }))
      return data
    }

    function applyBodyAttr(active) {
      try {
        if (active) document.documentElement.setAttribute('data-writing-mode', 'on')
        else {
          document.documentElement.removeAttribute('data-writing-mode')
          document.body.removeAttribute('data-writing-focus')
        }
      } catch {}
    }

    /* ── 主组件 ── */
    function WritingModeApp() {
      const [active, setActive] = react.useState(() => {
        try {
          return localStorage.getItem(LS_KEY) === '1'
        } catch {
          return false
        }
      })
      const [docs, setDocs] = react.useState([])
      const [currentId, setCurrentId] = react.useState(null)
      const [title, setTitle] = react.useState('')
      const [content, setContent] = react.useState('')
      const [dirty, setDirty] = react.useState(false)
      const [saveState, setSaveState] = react.useState('idle')
      const [aiOpen, setAiOpen] = react.useState(true)
      const [aiOut, setAiOut] = react.useState('')
      const [aiBusy, setAiBusy] = react.useState(false)
      const [aiErr, setAiErr] = react.useState('')
      const [focus, setFocus] = react.useState(false)
      const taRef = react.useRef(null)
      const saveTimer = react.useRef(0)

      react.useEffect(() => {
        applyBodyAttr(active)
        try {
          localStorage.setItem(LS_KEY, active ? '1' : '0')
        } catch {}
      }, [active])

      react.useEffect(() => {
        try {
          if (focus) document.body.setAttribute('data-writing-focus', '1')
          else document.body.removeAttribute('data-writing-focus')
        } catch {}
      }, [focus])

      const refreshList = react.useCallback(async () => {
        const data = await api('list')
        if (data.ok) setDocs(data.docs || [])
      }, [])

      react.useEffect(() => {
        if (!active) return
        refreshList()
      }, [active, refreshList])

      const loadDoc = react.useCallback(async (id) => {
        const data = await api('get&id=' + encodeURIComponent(id))
        if (data.ok && data.doc) {
          setCurrentId(data.doc.id)
          setContent(data.doc.content || '')
          // 标题取首个 H1
          const m = (data.doc.content || '').match(/^#\s+(.+)$/m)
          setTitle(m ? m[1].trim() : data.doc.id)
          setDirty(false)
          setSaveState('idle')
        }
      }, [])

      const persist = react.useCallback(async () => {
        if (!dirty && currentId) return
        setSaveState('saving')
        const data = await api('save', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: currentId, title, content }),
        })
        if (data.ok && data.doc) {
          setCurrentId(data.doc.id)
          setDirty(false)
          setSaveState('saved')
          refreshList()
        } else {
          setSaveState('idle')
        }
      }, [currentId, title, content, dirty, refreshList])

      react.useEffect(() => {
        if (!active || !dirty) return
        window.clearTimeout(saveTimer.current)
        saveTimer.current = window.setTimeout(() => {
          void persist()
        }, 800)
        return () => window.clearTimeout(saveTimer.current)
      }, [active, dirty, persist])

      react.useEffect(() => {
        if (!active) return
        const onKey = (e) => {
          if (e.key === 'Escape') {
            setActive(false)
            return
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault()
            void persist()
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
            e.preventDefault()
            createDoc()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [active, persist])

      function createDoc() {
        setCurrentId(null)
        setTitle(T.untitled)
        setContent(`# ${T.untitled}\n\n`)
        setDirty(true)
        setSaveState('idle')
        try {
          taRef.current && taRef.current.focus()
        } catch {}
      }

      function selectionText() {
        const ta = taRef.current
        if (!ta) return content.slice(0, 4000)
        const s = ta.selectionStart
        const e = ta.selectionEnd
        if (typeof s === 'number' && typeof e === 'number' && e > s) {
          return content.slice(s, e)
        }
        // 无选区：取当前段落附近
        return content.slice(Math.max(0, (s || 0) - 400), (s || 0) + 1600) || content.slice(0, 2000)
      }

      async function runAssist(action) {
        const text = selectionText()
        if (!text.trim()) {
          setAiErr(T.noText)
          return
        }
        setAiBusy(true)
        setAiErr('')
        setAiOut('')
        try {
          const data = await api('assist', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action, text }),
          })
          if (data.ok) setAiOut(data.result || '')
          else if (data.error === 'llm-unavailable') setAiErr(T.aiUnavailable)
          else setAiErr(String(data.error || 'failed'))
        } catch (err) {
          setAiErr(String(err && err.message ? err.message : err))
        } finally {
          setAiBusy(false)
        }
      }

      function applyInsert() {
        if (!aiOut) return
        setContent((c) => (c.endsWith('\n') ? c : c + '\n') + '\n' + aiOut + '\n')
        setDirty(true)
      }

      function applyReplace() {
        if (!aiOut) return
        const ta = taRef.current
        if (!ta) {
          setContent(aiOut)
          setDirty(true)
          return
        }
        const s = ta.selectionStart
        const e = ta.selectionEnd
        if (typeof s === 'number' && typeof e === 'number' && e > s) {
          const next = content.slice(0, s) + aiOut + content.slice(e)
          setContent(next)
        } else {
          setContent(aiOut)
        }
        setDirty(true)
      }

      function sendToChat() {
        const payload = aiOut || selectionText()
        const prompt = payload
          ? `请作为写作助手处理下面的文稿：\n\n${payload}`
          : `请作为写作助手，帮我完善文稿《${title || T.untitled}》。`
        try {
          const ta = document.querySelector('[data-composer-seat] textarea, [data-composer-input]')
          if (ta) {
            const setter = Object.getOwnPropertyDescriptor(
              ta.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
              'value'
            )?.set
            if (setter) setter.call(ta, prompt)
            else ta.value = prompt
            ta.dispatchEvent(new Event('input', { bubbles: true }))
            ta.dispatchEvent(new Event('change', { bubbles: true }))
          }
        } catch {}
        setActive(false)
      }

      async function removeDoc() {
        if (!currentId) return
        if (!window.confirm(T.confirmDelete)) return
        await api('delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: currentId }),
        })
        setCurrentId(null)
        setTitle('')
        setContent('')
        setDirty(false)
        refreshList()
      }

      if (!active) {
        return jsx.jsx(
          'button',
          {
            type: 'button',
            className: 'dshWmFloat',
            title: T.toggle,
            onClick: () => setActive(true),
            children: jsx.jsx('span', { children: T.toggle }),
          }
        )
      }

      return jsx.jsx('div', {
        className: 'dshWmRoot',
        role: 'dialog',
        'aria-label': T.toggle,
        children: [
          jsx.jsx(
            'div',
            {
              className: 'dshWmBar',
              children: [
                jsx.jsx('span', { className: 'dshWmBarTitle', children: T.toggle }),
                jsx.jsx('button', {
                  type: 'button',
                  className: 'dshWmBtn' + (focus ? ' is-primary' : ''),
                  onClick: () => setFocus((v) => !v),
                  children: T.focus,
                }),
                jsx.jsx('button', {
                  type: 'button',
                  className: 'dshWmBtn',
                  onClick: () => setAiOpen((v) => !v),
                  children: aiOpen ? T.closeAi : T.openAi,
                }),
                jsx.jsx('span', { className: 'dshWmBarSpacer' }),
                jsx.jsx('button', {
                  type: 'button',
                  className: 'dshWmBtn',
                  onClick: () => void persist(),
                  children: saveState === 'saving' ? T.saving : saveState === 'saved' ? T.saved : T.save,
                }),
                jsx.jsx('button', {
                  type: 'button',
                  className: 'dshWmBtn is-primary',
                  onClick: () => setActive(false),
                  children: T.exit,
                }),
              ],
            },
            'bar'
          ),
          jsx.jsx(
            'div',
            {
              className: 'dshWmBody',
              children: [
                jsx.jsx(
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
                              onClick: createDoc,
                              children: T.newDoc,
                            }),
                          ],
                        },
                        'dh'
                      ),
                      jsx.jsx(
                        'div',
                        {
                          className: 'dshWmList',
                          children:
                            docs.length === 0
                              ? jsx.jsx('div', { className: 'dshWmEmpty', children: T.empty })
                              : docs.map((d) =>
                                  jsx.jsx(
                                    'button',
                                    {
                                      type: 'button',
                                      className: 'dshWmItem' + (currentId === d.id ? ' is-on' : ''),
                                      onClick: () => void loadDoc(d.id),
                                      children: [
                                        jsx.jsx(
                                          'span',
                                          { className: 'dshWmItemTitle', children: d.title || d.id },
                                          't'
                                        ),
                                        jsx.jsx(
                                          'span',
                                          {
                                            className: 'dshWmItemMeta',
                                            children: `${d.chars} ${T.chars}`,
                                          },
                                          'm'
                                        ),
                                      ],
                                    },
                                    d.id
                                  )
                                ),
                        },
                        'dl'
                      ),
                    ],
                  },
                  'docs'
                ),
                jsx.jsx(
                  'main',
                  {
                    className: 'dshWmMain',
                    children: [
                      jsx.jsx(
                        'div',
                        {
                          className: 'dshWmTitleRow',
                          children: [
                            jsx.jsx('input', {
                              className: 'dshWmTitle',
                              value: title,
                              placeholder: T.untitled,
                              onChange: (e) => {
                                setTitle(e.target.value)
                                setDirty(true)
                              },
                            }),
                            currentId
                              ? jsx.jsx('button', {
                                  type: 'button',
                                  className: 'dshWmBtn is-danger',
                                  onClick: () => void removeDoc(),
                                  children: T.delete,
                                })
                              : null,
                          ],
                        },
                        'tr'
                      ),
                      jsx.jsx('textarea', {
                        ref: taRef,
                        className: 'dshWmEditor',
                        value: content,
                        spellCheck: false,
                        placeholder: '# …',
                        onChange: (e) => {
                          setContent(e.target.value)
                          setDirty(true)
                        },
                      }),
                      jsx.jsx(
                        'div',
                        {
                          className: 'dshWmStatus',
                          children: [
                            jsx.jsx('span', {
                              children: `${T.words}: ${content.replace(/\s+/g, '').length}`,
                            }),
                            jsx.jsx('span', {
                              children: dirty ? '·' : saveState === 'saved' ? '· ' + T.saved : '',
                            }),
                          ],
                        },
                        'st'
                      ),
                    ],
                  },
                  'main'
                ),
                aiOpen
                  ? jsx.jsx(
                      'aside',
                      {
                        className: 'dshWmSide is-ai',
                        children: [
                          jsx.jsx(
                            'div',
                            { className: 'dshWmSideHead', children: T.ai },
                            'ah'
                          ),
                          jsx.jsx(
                            'div',
                            {
                              className: 'dshWmAiBody',
                              children: [
                                jsx.jsx(
                                  'div',
                                  {
                                    className: 'dshWmAiActions',
                                    children: ['polish', 'continue', 'outline', 'compress', 'expand'].map(
                                      (a) =>
                                        jsx.jsx(
                                          'button',
                                          {
                                            type: 'button',
                                            className: 'dshWmBtn',
                                            disabled: aiBusy,
                                            onClick: () => void runAssist(a),
                                            children: T[a] || a,
                                          },
                                          a
                                        )
                                    ),
                                  },
                                  'acts'
                                ),
                                aiBusy
                                  ? jsx.jsx('div', { className: 'dshWmAiHint', children: T.applying })
                                  : null,
                                aiErr
                                  ? jsx.jsx('div', { className: 'dshWmAiHint', children: aiErr })
                                  : null,
                                jsx.jsx('div', { className: 'dshWmAiOut', children: aiOut || ' ' }, 'out'),
                                jsx.jsx(
                                  'div',
                                  {
                                    className: 'dshWmAiActions',
                                    children: [
                                      jsx.jsx('button', {
                                        type: 'button',
                                        className: 'dshWmBtn',
                                        disabled: !aiOut,
                                        onClick: applyInsert,
                                        children: T.insert,
                                      }),
                                      jsx.jsx('button', {
                                        type: 'button',
                                        className: 'dshWmBtn',
                                        disabled: !aiOut,
                                        onClick: applyReplace,
                                        children: T.replaceSel,
                                      }),
                                      jsx.jsx('button', {
                                        type: 'button',
                                        className: 'dshWmBtn is-primary',
                                        onClick: sendToChat,
                                        children: T.sendChat,
                                      }),
                                    ],
                                  },
                                  'apply'
                                ),
                                jsx.jsx(
                                  'div',
                                  { className: 'dshWmAiHint', children: 'Esc · Ctrl+S · Ctrl+N' },
                                  'kbd'
                                ),
                              ],
                            },
                            'ab'
                          ),
                        ],
                      },
                      'ai'
                    )
                  : null,
              ],
            },
            'body'
          ),
        ],
      })
    }

    const inject = ['slots']
    function apply(ctx) {
      try {
        ctx.effect(
          () =>
            ctx.slots.inject('shell.overlay', () =>
              ctx.slots.register(
                {
                  name: 'shell.overlay',
                  id: 'writing-mode',
                  order: 20,
                  label: () => T.toggle,
                },
                WritingModeApp
              )
            ),
          'writing-mode: overlay'
        )
      } catch (err) {
        console.warn('[writing-mode] shell.overlay register failed:', err)
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
