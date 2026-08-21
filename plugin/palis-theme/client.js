window.__ModuleLoader__.load({
  id: "@dsh-local/palis-theme",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

    // Idempotency: SPA soft refresh / boot race can evaluate the bundle twice.
    // The second instance must be a no-op; the flag is cleared on dispose so a
    // real hot reload re-initializes cleanly.
    if (window.__dshPalisThemeLoaded === true) {
      exports.name = "palis-theme"
      exports.apply = function () {}
      exports.inject = []
      return module.exports
    }
    window.__dshPalisThemeLoaded = true

    const ROUTE = "/api/palis-theme"
    const STYLE_ID = "palis-theme-style"
    const OVERLAY_ID = "palis-theme-crt"
    const ATTR = "data-palis-theme"
    const POLL_MS = 2000

    /* ── PALIS 令牌：与外壳 splash/侧栏的 palis 色板同源 ────────────────────────
       直接覆盖内核自己的 --dsw-alias-* 设计令牌 —— 这就是内核明暗主题的同一套
       机制，所以所有内核组件（气泡/输入框/列表/按钮）会自动换色，无需碰 DOM。 */
    const TOKENS = {
      "--dsw-alias-bg-base": "#0a0a0a",
      "--dsw-alias-bg-layer-1": "#141414",
      "--dsw-alias-label-primary": "#e8e8e8",
      "--dsw-alias-label-secondary": "#8a8a8a",
      "--dsw-alias-label-tertiary": "#6e6e6e",
      "--dsw-alias-label-dimmed": "#555555",
      "--dsw-alias-label-caption": "#555555",
      "--dsw-alias-label-primary-foreground": "#0a0a0a",
      "--dsw-alias-border-l1": "rgba(232,232,232,.14)",
      "--dsw-alias-border-l2": "rgba(232,232,232,.30)",
      "--dsw-alias-interactive-bg-hover": "rgba(232,232,232,.07)",
      "--dsw-alias-interactive-bg-hover-accent": "rgba(43,95,217,.22)",
      "--dsw-alias-brand-primary": "#2b5fd9",
      "--dsw-alias-button-primary-fill": "#e8e8e8",
      "--dsw-alias-state-success-primary": "#e8e8e8",
      "--dsw-alias-state-success-secondary": "rgba(232,232,232,.10)",
      "--dsw-alias-state-success-tertiary": "rgba(232,232,232,.06)",
      "--dsw-alias-state-error-primary": "#c8322b",
      "--dsw-alias-state-error-secondary": "rgba(200,50,43,.14)",
      "--dsw-alias-state-warn-primary": "#c8322b",
      "--dsw-alias-state-warn-secondary": "rgba(200,50,43,.10)",
      "--dsw-alias-state-business-primary": "#2b5fd9",
      "--dsw-alias-state-business-tertiary": "rgba(43,95,217,.14)",
    }

    /* ── 通用样式：直角/等宽/滚动条/CRT 质感 ────────────────────────────────────
       纪律：不依赖任何编译 hash 类名；只对"存在才有效、不存在也不崩"的
       语义化 data 属性做增强（[data-chat-flow-key] 等，外壳的 selector-check
       门禁在持续监控这些属性）。 */
    const CSS = [
      `html[${ATTR}] *, html[${ATTR}] *::before, html[${ATTR}] *::after {`,
      "  border-radius: 0 !important;",
      "}",
      `html[${ATTR}] body {`,
      '  font-family: "JetBrains Mono", "IBM Plex Mono", "Cascadia Mono", Consolas, "Courier New", monospace;',
      '  background: var(--dsw-alias-bg-base, #0a0a0a);',
      "}",
      // 滚动条：直角、细、暗
      `html[${ATTR}] ::-webkit-scrollbar { width: 8px; height: 8px; }`,
      `html[${ATTR}] ::-webkit-scrollbar-track { background: #0a0a0a; }`,
      `html[${ATTR}] ::-webkit-scrollbar-thumb { background: #3a3a3a; border: 1px solid #0a0a0a; }`,
      // 用户消息标签 [USER]（data 属性选择器，按 kind 区分；不含 hash 类名）
      `html[${ATTR}] [data-chat-flow-key][data-chat-flow-kind="user"]::before,`,
      `html[${ATTR}] [data-chat-flow-key][data-chat-flow-kind="steering"]::before,`,
      `html[${ATTR}] [data-chat-flow-key][data-chat-flow-kind="context"]::before,`,
      `html[${ATTR}] [data-chat-flow-key][data-chat-flow-kind="command"]::before {`,
      '  content: "[USER]";',
      "  display: block;",
      "  font-size: 10px;",
      "  letter-spacing: .18em;",
      "  color: var(--dsw-alias-brand-primary, #2b5fd9);",
      "  margin-bottom: 2px;",
      "}",
      // 输入框：终端风（占位符文本仍由内核决定，这里只换观感）
      `html[${ATTR}] [data-composer-seat] textarea {`,
      '  font-family: inherit;',
      "  background: #0a0a0a;",
      "  color: #e8e8e8;",
      "  caret-color: #e8e8e8;",
      "  border: 1px solid #3a3a3a !important;",
      "}",
      `html[${ATTR}] [data-composer-seat] textarea::placeholder { color: #6e6e6e; }`,
      // 消息气泡底色交给令牌；文字等宽由 body 继承
    ].join("\n")

    function ensureStyle() {
      let el = document.getElementById(STYLE_ID)
      if (!el) {
        el = document.createElement("style")
        el.id = STYLE_ID
        document.head.appendChild(el)
      }
      if (el.textContent !== CSS) el.textContent = CSS
      return el
    }

    function ensureOverlay() {
      let el = document.getElementById(OVERLAY_ID)
      if (!el) {
        el = document.createElement("div")
        el.id = OVERLAY_ID
        el.setAttribute("aria-hidden", "true")
        el.style.cssText = [
          "position:fixed;inset:0;z-index:2147481000;pointer-events:none;",
          "background:repeating-linear-gradient(0deg, rgba(255,255,255,.025) 0px, rgba(255,255,255,.025) 1px, transparent 1px, transparent 3px),",
          "radial-gradient(ellipse 96% 88% at 50% 46%, transparent 58%, rgba(0,0,0,.35) 100%);",
        ].join("")
        document.documentElement.appendChild(el)
      }
      return el
    }

    function applyTokens() {
      const root = document.documentElement
      for (const [k, v] of Object.entries(TOKENS)) root.style.setProperty(k, v)
    }
    function clearTokens() {
      const root = document.documentElement
      for (const k of Object.keys(TOKENS)) root.style.removeProperty(k)
    }

    let applied = false
    function setTheme(theme) {
      const on = theme === "palis"
      if (on === applied) return
      applied = on
      const root = document.documentElement
      if (on) {
        root.setAttribute(ATTR, "1")
        applyTokens()
        ensureStyle()
        ensureOverlay()
      } else {
        root.removeAttribute(ATTR)
        clearTokens()
        const s = document.getElementById(STYLE_ID)
        if (s) s.remove()
        const o = document.getElementById(OVERLAY_ID)
        if (o) o.remove()
      }
    }

    exports.name = "palis-theme"
    exports.inject = []
    exports.apply = function (ctx) {
      let timer = 0
      let disposed = false
      async function poll() {
        try {
          const res = await fetch(ROUTE, { cache: "no-store" })
          const json = await res.json()
          setTheme(json && json.theme)
        } catch {}
      }
      ctx.effect(() => {
        poll()
        timer = setInterval(poll, POLL_MS)
        return () => {
          disposed = true
          clearInterval(timer)
          setTheme("")
          window.__dshPalisThemeLoaded = false
        }
      })
    }

    return module.exports
  }
})
