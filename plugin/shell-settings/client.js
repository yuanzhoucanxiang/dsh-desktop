/**
 * Browser half of @dsh-local/shell-settings.
 *
 * Registers a "桌面外壳" tab into the kernel Web Settings via the official
 * `settings.plugins.tab` slot contract (same mechanism as the kernel's own
 * plugin-inventory tab — no private DOM scraping). The tab surfaces shell
 * version + update state and forwards actions to the desktop shell through
 * the preload bridge (window.dshShell). In a plain browser (no desktop
 * shell) it degrades to a static note.
 */
window.__ModuleLoader__.load({
  id: "@dsh-local/shell-settings",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

    // Idempotency: double evaluation on SPA soft refresh must be a no-op
    // (flag never cleared — this tab has no disposable effect on its own).
    if (window.__dshShellSettingsLoaded === true) {
      exports.name = "shell-settings"
      exports.apply = function () {}
      exports.inject = []
      return module.exports
    }
    window.__dshShellSettingsLoaded = true

    const react = require("react")
    const jsx = require("react/jsx-runtime")

    // ------------------------------------------------------------------ css
    // 全部走 --dsw-alias-* 设计令牌，自动跟随内核明暗主题（皮肤层会重定义）。
    const css = [
      ".dshShellTab{width:100%;max-width:760px;display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary);}",
      ".dshShellTabCard{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;}",
      ".dshShellTabRow{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px;}",
      ".dshShellTabVer{font-family:var(--ds-font-family-code,monospace);font-size:12px;color:var(--dsw-alias-label-secondary);}",
      ".dshShellTabState{font-size:13px;color:var(--dsw-alias-label-secondary);line-height:20px;}",
      ".dshShellTabState.is-ok{color:var(--dsw-alias-state-success-primary);}",
      ".dshShellTabState.is-err{color:var(--dsw-alias-state-error-primary);}",
      ".dshShellTabBar{height:8px;border-radius:5px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 15%,transparent);overflow:hidden;}",
      ".dshShellTabBarFill{height:100%;border-radius:5px;background:var(--dsw-alias-brand-primary);transition:width .25s;}",
      ".dshShellTab button{font:inherit;font-size:12px;padding:6px 14px;border-radius:8px;cursor:pointer;background:transparent;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2);}",
      ".dshShellTab button:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);}",
      ".dshShellTab button.is-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent;}",
      ".dshShellTabHint{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:18px;}",
    ].join("\n")
    const tagId = "@dsh-local/shell-settings/shell-settings.css"
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      const tag = document.createElement("style")
      tag.dataset.plugin = "@dsh-local/shell-settings"
      tag.dataset.pluginCss = tagId
      tag.textContent = css
      document.head.appendChild(tag)
    }

    // ------------------------------------------------------------------ i18n
    const NS = "settings.shellBridge"
    const zh = {
      tab: "桌面外壳",
      onlyInShell: "此页仅在外壳内可用：当前是浏览器直连内核。插件体检与软件更新请打开 DeepSeek Harness Desktop 桌面应用。",
      current: "当前版本",
      idle: "启动后会自动在后台检查并下载更新。",
      checking: "正在检查更新…",
      none: "已是最新版本",
      available: "发现新版本 {v}，正在后台自动下载…",
      downloading: "正在下载 {v}…",
      downloaded: "{v} 已下载完成，可立即安装；退出应用时也会自动装上。",
      error: "更新失败：{m}",
      openSettings: "打开桌面设置（插件体检 / 软件更新）",
      check: "检查更新",
      retry: "重试",
      install: "重启并安装",
    }
    const en = {
      tab: "Desktop Shell",
      onlyInShell: "Only available inside the desktop shell. Open DeepSeek Harness Desktop for plugin health & updates.",
      current: "Current version",
      idle: "Updates are checked and downloaded automatically in the background.",
      checking: "Checking for updates…",
      none: "You are up to date",
      available: "Version {v} found — downloading in the background…",
      downloading: "Downloading {v}…",
      downloaded: "{v} downloaded. Install now, or it will install on next quit.",
      error: "Update failed: {m}",
      openSettings: "Open desktop settings (plugins / updates)",
      check: "Check for updates",
      retry: "Retry",
      install: "Restart & install",
    }

    const fmt = (s, vars) => String(s == null ? "" : s).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? String(vars[k]) : ""))

    // ------------------------------------------------------------------ tab
    /** 桌面外壳标签页：{ t } 由设置分区按插槽契约注入（与官方 plugin-inventory 相同）。 */
    function ShellSettingsTab({ t }) {
      const bridge = (typeof window !== "undefined" && window.dshShell) || null
      const [info, setInfo] = react.useState(null)
      const [busy, setBusy] = react.useState(false)

      const tr = (key, vars) => {
        let s = key
        try {
          s = t ? t(key) : zh[key]
        } catch {
          s = zh[key]
        }
        if (s == null) s = zh[key] != null ? zh[key] : key
        return fmt(s, vars)
      }

      const refresh = react.useCallback(async () => {
        if (!bridge || !bridge.updateGet) return
        try {
          setInfo(await bridge.updateGet())
        } catch {}
      }, [bridge])

      react.useEffect(() => {
        refresh()
        if (!bridge || !bridge.onUpdateStatus) return undefined
        const off = bridge.onUpdateStatus((s) => setInfo((prev) => ({ ...(prev || {}), ...s })))
        return () => {
          try {
            if (off) off()
          } catch {}
        }
      }, [refresh, bridge])

      if (!bridge || !bridge.updateGet) {
        return jsx.jsx("div", { className: "dshShellTab", children:
          jsx.jsxs("div", { className: "dshShellTabCard", children: [
            jsx.jsx("div", { className: "dshShellTabRow", children: jsx.jsx("strong", { children: "DeepSeek Harness Desktop" }) }),
            jsx.jsx("div", { className: "dshShellTabState", children: tr("onlyInShell") }),
          ] }) })
      }

      const s = info || { state: "idle" }
      let stateText = tr("idle")
      let stateCls = ""
      if (s.state === "checking") stateText = tr("checking")
      else if (s.state === "none") { stateText = tr("none"); stateCls = "is-ok" }
      else if (s.state === "available") stateText = tr("available", { v: s.version || "" })
      else if (s.state === "downloading") stateText = tr("downloading", { v: s.version || "" })
      else if (s.state === "downloaded") { stateText = tr("downloaded", { v: s.version || "" }); stateCls = "is-ok" }
      else if (s.state === "error") { stateText = tr("error", { m: s.message || "" }); stateCls = "is-err" }
      else if (s.state === "dev" || s.state === "unconfigured") { stateText = s.message || s.state; stateCls = "" }

      const doCheck = async () => {
        if (!bridge.updateCheck || busy) return
        setBusy(true)
        try {
          setInfo(await bridge.updateCheck())
        } catch {}
        setBusy(false)
      }

      return jsx.jsxs("div", { className: "dshShellTab", children: [
        jsx.jsxs("div", { className: "dshShellTabCard", children: [
          jsx.jsxs("div", { className: "dshShellTabRow", children: [
            jsx.jsx("strong", { children: "DeepSeek Harness Desktop" }),
            jsx.jsx("span", { className: "dshShellTabVer", children: s.appVersion ? `v${s.appVersion}` : "" }),
          ] }),
          jsx.jsx("div", { className: `dshShellTabState ${stateCls}`, children: stateText }),
          s.state === "downloading"
            ? jsx.jsxs("div", { className: "dshShellTabRow", children: [
                jsx.jsx("div", { className: "dshShellTabBar", children:
                  jsx.jsx("div", { className: "dshShellTabBarFill", style: { width: `${Math.max(0, Math.min(100, s.percent || 0))}%` } }) }),
                jsx.jsx("span", { className: "dshShellTabVer", children: `${Math.floor(s.percent || 0)}%` }),
              ] })
            : null,
          jsx.jsxs("div", { className: "dshShellTabRow", children: [
            s.state === "downloaded"
              ? jsx.jsx("button", { className: "is-primary", onClick: () => { try { bridge.updateInstall().catch(() => {}) } catch {} }, children: tr("install") })
              : null,
            s.state === "error"
              ? jsx.jsx("button", { disabled: busy, onClick: doCheck, children: tr("retry") })
              : jsx.jsx("button", { disabled: busy, onClick: doCheck, children: busy ? tr("checking") : tr("check") }),
          ] }),
        ] }),
        jsx.jsx("div", { children:
          jsx.jsx("button", { className: "is-primary", onClick: () => { try { bridge.openSettings() } catch {} }, children: tr("openSettings") }) }),
      ] })
    }

    // -------------------------------------------------------------- plugin
    const inject = ["slots", "locale"]

    function apply(ctx) {
      // 防御性注册：插槽契约若随内核版本变化，本插件静默降级而不是拖垮激活批次
      try {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), "shell-settings: dictionaries")
      } catch (err) {
        console.warn("[shell-settings] locale register failed:", err)
      }
      const t = ctx.locale && ctx.locale.bind ? ctx.locale.bind(NS) : null
      const label = (k) => {
        try {
          return t ? t(k) : zh[k]
        } catch {
          return zh[k]
        }
      }
      try {
        ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
          name: "settings.plugins.tab",
          id: "desktop",
          order: 20,
          label: () => label("tab"),
          locale: NS,
          inject: () => ({}),
        }, ShellSettingsTab))
      } catch (err) {
        console.warn("[shell-settings] settings tab register failed:", err)
      }
    }

    exports.NS = NS
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
