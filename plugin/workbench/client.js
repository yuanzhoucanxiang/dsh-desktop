/**
 * GENERATED FILE — do not hand-edit.
 * Source: plugin/workbench/src/client/entry.js (+ ./registry.js, ./Entry.js, ./Chrome.js, ./Settings.js)
 * Build:  node scripts/build-workbench-client.mjs   (or npm run build:workbench)
 * Bundle: esbuild (CJS) wrapped as window.__ModuleLoader__.load factory body
 */
window.__ModuleLoader__.load({
  id: "@dsh-local/workbench",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// plugin/workbench/src/client/entry.js
var entry_exports = {};
__export(entry_exports, {
  __workbenchRegistry: () => __workbenchRegistry,
  apply: () => apply,
  createRegistry: () => createRegistry,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(entry_exports);
var react5 = __toESM(require("react"), 1);

// plugin/workbench/src/client/registry.js
var MOUNTS = /* @__PURE__ */ new Set(["overlay", "panel"]);
function normalizeLabel(label) {
  if (typeof label === "function") {
    try {
      return String(label() ?? "");
    } catch {
      return "";
    }
  }
  return String(label ?? "");
}
function normalizeMode(descriptor, id) {
  const order = Number.isFinite(descriptor.order) ? Number(descriptor.order) : 100;
  const mount = MOUNTS.has(descriptor.mount) ? descriptor.mount : "overlay";
  return {
    id,
    order,
    mount,
    rawLabel: descriptor.label,
    canDeactivate: typeof descriptor.canDeactivate === "function" ? descriptor.canDeactivate : null,
    onActivate: typeof descriptor.onActivate === "function" ? descriptor.onActivate : null,
    onDeactivate: typeof descriptor.onDeactivate === "function" ? descriptor.onDeactivate : null,
    context: descriptor.context && typeof descriptor.context === "object" ? descriptor.context : null,
    health: descriptor.health && typeof descriptor.health === "object" ? descriptor.health : null,
    refs: descriptor.refs && typeof descriptor.refs === "object" ? descriptor.refs : null
  };
}
function publicView(mode, activeId) {
  return {
    id: mode.id,
    label: normalizeLabel(mode.rawLabel) || mode.id,
    order: mode.order,
    mount: mode.mount,
    active: mode.id === activeId,
    hasContext: mode.context !== null
  };
}
function sortModes(modes) {
  return [...modes].sort((a, b) => a.order === b.order ? a.id.localeCompare(b.id, "en") : a.order - b.order);
}
function createRegistry(options = {}) {
  const onPersist = typeof options.onPersist === "function" ? options.onPersist : null;
  const modes = /* @__PURE__ */ new Map();
  const listeners2 = /* @__PURE__ */ new Set();
  let activeId = null;
  function notify() {
    for (const fn of [...listeners2]) {
      try {
        fn();
      } catch (err) {
        console.warn("[workbench] registry listener failed:", err);
      }
    }
  }
  function resolveLabel(id) {
    const mode = modes.get(id);
    return mode ? normalizeLabel(mode.rawLabel) || mode.id : id;
  }
  function registerMode(descriptor) {
    const id = String(descriptor?.id ?? "").trim();
    if (!id) throw new Error("workbench.registerMode: id 必填");
    if (modes.has(id)) throw new Error(`workbench.registerMode: 重复的模式 id "${id}"`);
    const mode = normalizeMode(descriptor || {}, id);
    modes.set(id, mode);
    notify();
    return function unregister() {
      if (modes.get(id) !== mode) return;
      modes.delete(id);
      if (activeId === id) {
        activeId = null;
        try {
          mode.onDeactivate?.({ to: null, reason: "unregistered" });
        } catch (err) {
          console.warn("[workbench] onDeactivate failed:", err);
        }
        if (onPersist) persist();
      }
      notify();
    };
  }
  function list() {
    return sortModes(modes.values()).map((mode) => publicView(mode, activeId));
  }
  function getActive() {
    return activeId;
  }
  function has(id) {
    return modes.has(String(id ?? "").trim());
  }
  function size() {
    return modes.size;
  }
  function subscribe2(fn) {
    if (typeof fn !== "function") return () => {
    };
    listeners2.add(fn);
    return () => listeners2.delete(fn);
  }
  function persist() {
    if (!onPersist) return;
    try {
      onPersist({ activeModeId: activeId });
    } catch (err) {
      console.warn("[workbench] persist failed:", err);
    }
  }
  async function setActive(id, reason = "switch") {
    const next = id === null || id === void 0 ? null : String(id).trim();
    if (next !== null && !modes.has(next)) return { ok: false, changed: false, active: activeId, error: "unknown-mode" };
    if (next === activeId) return { ok: true, changed: false, active: activeId };
    const current = activeId === null ? null : modes.get(activeId) || null;
    if (current && current.canDeactivate) {
      let allowed = false;
      try {
        allowed = await current.canDeactivate({ to: next, reason }) === true;
      } catch (err) {
        console.warn("[workbench] canDeactivate failed (按拒绝处理):", err);
        allowed = false;
      }
      if (!allowed) return { ok: false, changed: false, active: activeId, error: "deactivate-refused" };
    }
    const from = activeId;
    activeId = next;
    const fromLabel = from ? resolveLabel(from) : "";
    if (current?.onDeactivate) {
      try {
        current.onDeactivate({ to: next, reason, from });
      } catch (err) {
        console.warn("[workbench] onDeactivate failed:", err);
      }
    }
    const target = next === null ? null : modes.get(next);
    if (target?.onActivate) {
      try {
        target.onActivate({ from, reason, fromLabel });
      } catch (err) {
        console.warn("[workbench] onActivate failed:", err);
      }
    }
    notify();
    persist();
    return { ok: true, changed: true, active: activeId };
  }
  function adopt(id) {
    const next = id === null || id === void 0 ? null : String(id).trim();
    if (next !== null && !modes.has(next)) return { ok: false, changed: false, active: activeId, error: "unknown-mode" };
    if (next === activeId) return { ok: true, changed: false, active: activeId };
    activeId = next;
    const target = next === null ? null : modes.get(next);
    if (target?.onActivate) {
      try {
        target.onActivate({ from: null, reason: "restore" });
      } catch (err) {
        console.warn("[workbench] onActivate(restore) failed:", err);
      }
    }
    notify();
    return { ok: true, changed: true, active: activeId };
  }
  return { registerMode, list, setActive, adopt, getActive, has, size, subscribe: subscribe2, resolveLabel };
}

// plugin/workbench/src/client/styles.js
var STYLE_ID = "dsh-workbench-style";
var CSS = [
  // 入口（侧栏底部）
  ".dshWbEntry{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer;text-align:left;}",
  ".dshWbEntry:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}",
  ".dshWbEntry.is-open{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}",
  ".dshWbEntryGlyph{flex:none;font-size:14px;line-height:1;color:var(--dsw-alias-brand-primary);}",
  ".dshWbEntryLabel{flex:none;}",
  ".dshWbEntryMode{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:var(--dsw-alias-label-tertiary);font-size:12px;}",
  // 切换器（帧级浮层；浮层本身 click-through，只有面板接指针）
  ".dshWbScrim{position:fixed;inset:0;z-index:1400;background:transparent;}",
  ".dshWbPanel{position:absolute;left:12px;bottom:56px;min-width:260px;max-width:min(420px,calc(100vw - 24px));padding:12px;display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 40px rgba(0,0,0,.32);pointer-events:auto;}",
  ".dshWbHead{display:flex;align-items:baseline;gap:8px;}",
  ".dshWbTitle{flex:1;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);}",
  ".dshWbClose{border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;cursor:pointer;padding:2px 4px;border-radius:6px;}",
  ".dshWbClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}",
  ".dshWbHint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}",
  ".dshWbList{display:flex;flex-direction:column;gap:4px;}",
  ".dshWbRow{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;text-align:left;}",
  ".dshWbRow:hover{background:var(--dsw-alias-interactive-bg-hover);}",
  ".dshWbRow.is-active{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);}",
  ".dshWbRowLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
  ".dshWbRowMark{flex:none;font-size:11px;color:var(--dsw-alias-brand-primary);}",
  ".dshWbEmpty{padding:8px 10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}",
  ".dshWbFoot{display:flex;align-items:center;gap:8px;padding-top:4px;border-top:1px solid var(--dsw-alias-border-l1);}",
  ".dshWbNotice{font-size:12px;color:var(--dsw-alias-state-error-primary);}",
  // 设置段
  ".dshWbSet{display:flex;flex-direction:column;gap:12px;max-width:720px;color:var(--dsw-alias-label-primary);}",
  ".dshWbSetCard{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-2);}",
  ".dshWbSetTitle{font-size:13px;font-weight:600;}",
  ".dshWbSetLine{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);}",
  ".dshWbSetMuted{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}",
  ".dshWbSetChip{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;font-size:12px;color:var(--dsw-alias-label-secondary);}",
  ".dshWbSetChip.is-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}",
  ".dshWbBtn{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:5px 10px;cursor:pointer;}",
  ".dshWbBtn:hover{background:var(--dsw-alias-interactive-bg-hover);}"
].join("");
function ensureCss() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// plugin/workbench/src/client/runtime.js
var registry = null;
function setRegistry(next) {
  registry = next;
}
function getRegistry() {
  if (!registry) throw new Error("workbench registry 尚未建立");
  return registry;
}

// plugin/workbench/src/client/host-api.js
var API = "/api/workbench";
async function call(method, { route, body } = {}) {
  const url = `${API}?route=${encodeURIComponent(route || "state")}`;
  try {
    const res = await fetch(url, {
      method,
      headers: method === "GET" ? void 0 : { "content-type": "application/json" },
      body: method === "GET" ? void 0 : JSON.stringify(body || {})
    });
    const text = await res.text();
    let payload = null;
    try {
      payload = JSON.parse(text || "{}");
    } catch {
      return { ok: false, error: "bad-response", detail: text.slice(0, 200) };
    }
    if (!res.ok || payload?.ok !== true) {
      return { ok: false, status: res.status, error: payload?.error || `http-${res.status}`, backup: payload?.backup || null };
    }
    return { ok: true, state: payload.state };
  } catch (err) {
    return { ok: false, error: "network", detail: String(err?.message || err) };
  }
}
function fetchState() {
  return call("GET", { route: "state" });
}
function pushState(patch) {
  return call("POST", { route: "state", body: patch });
}

// plugin/workbench/src/client/copy.js
var T = {
  entry: "工具台",
  settings: "工具台",
  switcherTitle: "创作工具台",
  switcherHint: "选择一个模式进入；切走时模式自己的守卫会先被问一次。",
  close: "关闭",
  empty: "还没有可用的模式。",
  emptyHint: "写作模式与 GIR 生图模式接入后，会出现在这里。",
  current: "当前",
  activeNone: "未进入任何模式",
  exit: "退出模式",
  switchTo: (label) => `切换到 ${label}`,
  settingsIntro: "工具台是模式的统一门面：入口、切换、互斥与共享上下文都在这里，模式自己的实现不受影响。",
  settingsModes: "已注册的模式",
  settingsNone: "当前没有模式向工具台注册（写作模式与 GIR 生图模式尚未接入，见 docs/plans/workbench-layer-v1.md 的 P1/P2）。",
  settingsActive: "当前模式",
  settingsHost: "状态文件",
  settingsHostHint: "状态权威在 host（$DSH_HOME/workbench.json）：跨窗口一致，壳侧热键可读。",
  settingsRevision: (n) => `revision ${n}`,
  settingsUnreachable: "读不到工具台状态（host 路由不可用或状态文件损坏）。",
  settingsDegraded: "未挂载工具台时，各模式保留自己的入口（官方壳兼容路径）。"
};

// plugin/workbench/src/client/FooterEntry.js
var react2 = __toESM(require("react"), 1);

// plugin/workbench/src/client/ui-store.js
var open = false;
var notice = null;
var listeners = /* @__PURE__ */ new Set();
function emit() {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (err) {
      console.warn("[workbench] ui listener failed:", err);
    }
  }
}
function isOpen() {
  return open;
}
function setOpen(next) {
  const value = next === true;
  if (open === value) return;
  open = value;
  emit();
}
function toggleOpen() {
  setOpen(!open);
}
function getNotice() {
  return notice;
}
function subscribe(fn) {
  if (typeof fn !== "function") return () => {
  };
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// plugin/workbench/src/client/use-workbench.js
var react = __toESM(require("react"), 1);
function useWorkbench() {
  const registry2 = getRegistry();
  const snapshot = react.useCallback(
    () => ({ modes: registry2.list(), active: registry2.getActive(), open: isOpen(), notice: getNotice() }),
    [registry2]
  );
  const [state, setState] = react.useState(snapshot);
  react.useEffect(() => {
    const sync = () => setState(snapshot());
    const offRegistry = registry2.subscribe(sync);
    const offUi = subscribe(sync);
    sync();
    return () => {
      offRegistry();
      offUi();
    };
  }, [registry2, snapshot]);
  return { ...state, registry: registry2 };
}

// plugin/workbench/src/client/actions.js
async function switchMode(registry2, id, reason = "switch") {
  const result = await registry2.setActive(id, reason);
  if (result.ok) setOpen(false);
  return result;
}
function exitMode(registry2) {
  return switchMode(registry2, null, "exit");
}

// plugin/workbench/src/client/FooterEntry.js
function WorkbenchEntry() {
  const { modes, active, open: open2, registry: registry2 } = useWorkbench();
  if (modes.length === 0) return null;
  const activeLabel = (modes.find((m) => m.id === active) || {}).label || "";
  const only = modes.length === 1 ? modes[0] : null;
  const onClick = () => {
    if (only && active !== only.id) {
      void switchMode(registry2, only.id);
      return;
    }
    toggleOpen();
  };
  return react2.createElement(
    "button",
    {
      type: "button",
      className: `dshWbEntry${open2 ? " is-open" : ""}`,
      onClick,
      title: activeLabel ? `${T.entry} · ${activeLabel}` : T.entry,
      "aria-label": T.entry,
      "data-wb-entry": "",
      "data-wb-count": String(modes.length)
    },
    react2.createElement("span", { className: "dshWbEntryGlyph", "aria-hidden": "true" }, "◧"),
    react2.createElement("span", { className: "dshWbEntryLabel" }, T.entry),
    activeLabel ? react2.createElement("span", { className: "dshWbEntryMode", "data-wb-active-label": "" }, activeLabel) : null
  );
}

// plugin/workbench/src/client/Chrome.js
var react3 = __toESM(require("react"), 1);
function WorkbenchChrome() {
  const { modes, active, open: open2, registry: registry2 } = useWorkbench();
  if (!open2) return null;
  const onKeyDown = (event) => {
    if (event.key === "Escape") setOpen(false);
  };
  const rows = modes.map(
    (mode) => react3.createElement(
      "button",
      {
        key: mode.id,
        type: "button",
        className: `dshWbRow${mode.active ? " is-active" : ""}`,
        onClick: () => void switchMode(registry2, mode.id),
        title: T.switchTo(mode.label),
        "data-wb-mode": mode.id,
        "data-wb-mode-active": mode.active ? "1" : "0"
      },
      react3.createElement("span", { className: "dshWbRowLabel" }, mode.label),
      mode.active ? react3.createElement("span", { className: "dshWbRowMark" }, T.current) : null
    )
  );
  return react3.createElement(
    "div",
    { className: "dshWbScrim", onClick: () => setOpen(false), onKeyDown, "data-wb-switcher": "" },
    react3.createElement(
      "div",
      { className: "dshWbPanel", onClick: (event) => event.stopPropagation(), role: "dialog", "aria-label": T.switcherTitle },
      react3.createElement(
        "div",
        { className: "dshWbHead" },
        react3.createElement("span", { className: "dshWbTitle" }, T.switcherTitle),
        react3.createElement("button", { type: "button", className: "dshWbClose", onClick: () => setOpen(false), "data-wb-close": "" }, T.close)
      ),
      react3.createElement("div", { className: "dshWbHint" }, T.switcherHint),
      modes.length === 0 ? react3.createElement(
        "div",
        { className: "dshWbEmpty", "data-wb-empty": "" },
        react3.createElement("div", null, T.empty),
        react3.createElement("div", null, T.emptyHint)
      ) : react3.createElement("div", { className: "dshWbList" }, rows),
      active ? react3.createElement(
        "div",
        { className: "dshWbFoot" },
        react3.createElement("button", { type: "button", className: "dshWbBtn", onClick: () => void exitMode(registry2), "data-wb-exit": "" }, T.exit)
      ) : null
    )
  );
}

// plugin/workbench/src/client/Settings.js
var react4 = __toESM(require("react"), 1);
function WorkbenchSettings() {
  const { modes, active } = useWorkbench();
  const [host, setHost] = react4.useState({ loading: true });
  react4.useEffect(() => {
    let dead = false;
    void fetchState().then((result) => {
      if (!dead) setHost({ loading: false, ...result });
    });
    return () => {
      dead = true;
    };
  }, []);
  const activeLabel = (modes.find((m) => m.id === active) || {}).label || T.activeNone;
  return react4.createElement(
    "div",
    { className: "dshWbSet", "data-wb-settings": "" },
    react4.createElement(
      "div",
      { className: "dshWbSetCard" },
      react4.createElement("div", { className: "dshWbSetTitle" }, T.settings),
      react4.createElement("div", { className: "dshWbSetLine" }, T.settingsIntro),
      react4.createElement("div", { className: "dshWbSetMuted" }, T.settingsDegraded)
    ),
    react4.createElement(
      "div",
      { className: "dshWbSetCard" },
      react4.createElement("div", { className: "dshWbSetTitle" }, T.settingsModes),
      modes.length === 0 ? react4.createElement("div", { className: "dshWbSetMuted", "data-wb-settings-none": "" }, T.settingsNone) : react4.createElement(
        "div",
        { className: "dshWbSetLine", style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
        modes.map(
          (mode) => react4.createElement(
            "span",
            { key: mode.id, className: `dshWbSetChip${mode.active ? " is-active" : ""}`, "data-wb-settings-mode": mode.id },
            mode.label
          )
        )
      )
    ),
    react4.createElement(
      "div",
      { className: "dshWbSetCard" },
      react4.createElement("div", { className: "dshWbSetTitle" }, T.settingsActive),
      react4.createElement("div", { className: "dshWbSetLine", "data-wb-settings-active": active || "" }, activeLabel)
    ),
    react4.createElement(
      "div",
      { className: "dshWbSetCard" },
      react4.createElement("div", { className: "dshWbSetTitle" }, T.settingsHost),
      react4.createElement("div", { className: "dshWbSetMuted" }, T.settingsHostHint),
      host.loading ? react4.createElement("div", { className: "dshWbSetMuted" }, "…") : host.ok ? react4.createElement(
        "div",
        { className: "dshWbSetLine", "data-wb-settings-rev": String(host.state?.revision ?? "") },
        T.settingsRevision(host.state?.revision ?? 0),
        host.state?.activeModeId ? ` · ${host.state.activeModeId}` : ""
      ) : react4.createElement("div", { className: "dshWbSetLine", "data-wb-settings-error": host.error || "error" }, T.settingsUnreachable)
    )
  );
}

// plugin/workbench/src/client/entry.js
var __wbAlreadyLoaded = window.__dshWorkbenchLoaded === true;
window.__dshWorkbenchLoaded = true;
var name = "workbench";
var inject = __wbAlreadyLoaded ? [] : ["slots"];
var liveRegistry = null;
var restoreTarget = null;
var restored = false;
function apply(ctx) {
  if (__wbAlreadyLoaded) return;
  ensureCss();
  const registry2 = createRegistry({
    onPersist: (patch) => {
      void pushState(patch);
    }
  });
  liveRegistry = registry2;
  setRegistry(registry2);
  try {
    ctx.effect(() => ctx.reflect.provide("workbench", registry2), "workbench: service");
  } catch (err) {
    console.warn("[workbench] provide service failed:", err);
  }
  const tryRestore = () => {
    if (restored || !restoreTarget) return;
    if (!registry2.has(restoreTarget)) return;
    restored = true;
    registry2.adopt(restoreTarget);
  };
  registry2.subscribe(tryRestore);
  void fetchState().then((result) => {
    if (!result?.ok) return;
    const id = result.state?.activeModeId || null;
    if (!id) return;
    restoreTarget = id;
    tryRestore();
  });
  const register = (slot, options, Component, tag) => {
    try {
      ctx.effect(() => ctx.slots.inject(slot, () => ctx.slots.register(options, Component)), tag);
    } catch (err) {
      console.warn("[workbench] slot register failed:", slot, err);
    }
  };
  register("sidebar.footer.action", { name: "sidebar.footer.action", id: "workbench", order: 10, label: () => T.entry }, WorkbenchEntry, "workbench: entry");
  register("shell.overlay", { name: "shell.overlay", id: "workbench", order: 10, label: () => T.entry }, WorkbenchChrome, "workbench: switcher");
  register("settings.section", { name: "settings.section", id: "workbench", order: 45, label: () => T.settings }, WorkbenchSettings, "workbench: settings");
  console.info("[workbench] client ready · entry + switcher + settings（P0：无模式接入）");
}
function __workbenchRegistry() {
  return liveRegistry;
}
    return module.exports
  },
})
