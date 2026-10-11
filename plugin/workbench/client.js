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
var react6 = __toESM(require("react"), 1);

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
    refs: descriptor.refs && typeof descriptor.refs === "object" ? descriptor.refs : null,
    // 辅助坞视图（L2，可选）：别的模式当主视图时，工具台可以在右缘把这份"轻视图"显示出来。
    // 组件引用是**运行时传过来的值**（不是 import 别的插件），所以不违反内核的 bundle 纯净门禁。
    dock: descriptor.dock && typeof descriptor.dock === "object" && descriptor.dock.view ? {
      label: descriptor.dock.label,
      view: descriptor.dock.view,
      order: Number.isFinite(descriptor.dock.order) ? Number(descriptor.dock.order) : 100
    } : null,
    // 交接接收端（可选）：别的模式把一份不透明载荷交给它时调用。没有这个钩子的模式收到交接
    // 会被如实标成 delivered:false（工具台不替它假装收到了）。
    onHandoff: typeof descriptor.onHandoff === "function" ? descriptor.onHandoff : null
  };
}
function publicView(mode, activeId) {
  return {
    id: mode.id,
    label: normalizeLabel(mode.rawLabel) || mode.id,
    order: mode.order,
    mount: mode.mount,
    active: mode.id === activeId,
    hasContext: mode.context !== null,
    hasDock: mode.dock !== null
  };
}
function sortModes(modes) {
  return [...modes].sort((a, b) => a.order === b.order ? a.id.localeCompare(b.id, "en") : a.order - b.order);
}
function createRegistry(options = {}) {
  const onPersist = typeof options.onPersist === "function" ? options.onPersist : null;
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const modes = /* @__PURE__ */ new Map();
  const listeners2 = /* @__PURE__ */ new Set();
  let activeId = null;
  let lastHandoffRecord = null;
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
    if (mode.context && typeof mode.context.subscribe === "function") {
      try {
        mode.offContext = mode.context.subscribe(() => notify());
      } catch (err) {
        console.warn("[workbench] context.subscribe failed:", err);
      }
    }
    notify();
    return function unregister() {
      if (modes.get(id) !== mode) return;
      modes.delete(id);
      try {
        mode.offContext?.();
      } catch (err) {
        console.warn("[workbench] context unsubscribe failed:", err);
      }
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
  function dockViewOf(id) {
    const key = id === null || id === void 0 ? null : String(id).trim();
    const mode = key === null ? null : modes.get(key);
    if (!mode || !mode.dock) return null;
    return { id: mode.id, label: normalizeLabel(mode.dock.label) || mode.id, order: mode.dock.order, view: mode.dock.view };
  }
  function contextOf(id) {
    const key = id === null || id === void 0 ? null : String(id).trim();
    const mode = key === null ? null : modes.get(key);
    if (!mode || !mode.context || typeof mode.context.get !== "function") return null;
    try {
      const value = mode.context.get();
      if (!value || typeof value !== "object") return null;
      return { ...value, mode: mode.id };
    } catch (err) {
      console.warn("[workbench] context.get failed:", err);
      return null;
    }
  }
  function normalizePayload(payload, fallbackFrom) {
    const p = payload && typeof payload === "object" ? payload : {};
    const str = (v) => v === null || v === void 0 ? null : String(v);
    return {
      from: String(p.from || fallbackFrom || ""),
      kind: String(p.kind || "text"),
      title: p.title === void 0 ? "" : String(p.title),
      text: typeof p.text === "string" ? p.text : null,
      path: str(p.path),
      refs: Array.isArray(p.refs) ? p.refs.slice(0, 20) : [],
      at: now()
    };
  }
  async function handoff(to, payload) {
    const targetId = String(to ?? "").trim();
    const target = modes.get(targetId);
    if (!target) return { ok: false, error: "unknown-mode", to: targetId, active: activeId };
    const envelope = normalizePayload(payload, activeId);
    const switched = await setActive(targetId, "handoff");
    if (!switched.ok) return { ok: false, error: switched.error || "switch-failed", to: targetId, active: activeId };
    let delivered = false;
    if (target.onHandoff) {
      try {
        target.onHandoff(envelope);
        delivered = true;
      } catch (err) {
        console.warn("[workbench] onHandoff failed:", err);
      }
    }
    lastHandoffRecord = { ...envelope, to: targetId, delivered };
    notify();
    return { ok: true, delivered, to: targetId, active: activeId, envelope: lastHandoffRecord };
  }
  function lastHandoff() {
    return lastHandoffRecord;
  }
  return { registerMode, list, setActive, adopt, getActive, has, size, subscribe: subscribe2, resolveLabel, contextOf, handoff, lastHandoff, dockViewOf };
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
  // 上下文行（L1）：工具台只汇总与展示，模式自己报"正在做什么"
  ".dshWbCtx{margin:2px 0 2px;padding:6px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
  // 通知出口（L1）：交接结果与各模式上报都走这里；点一下即关
  ".dshWbToast{position:fixed;left:12px;bottom:56px;z-index:1410;max-width:min(420px,calc(100vw - 24px));padding:8px 12px;border:1px solid var(--dsw-alias-border-l2);border-left:3px solid var(--dsw-alias-brand-primary);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 28px rgba(0,0,0,.28);font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);cursor:pointer;pointer-events:auto;}",
  ".dshWbToast.is-warn{border-left-color:var(--dsw-alias-state-error-primary);}",
  // 辅助坞（L2）：右缘常驻面；收起时留竖排 rail。都走设计令牌，跟随主题/皮肤。
  ".dshWbDock{position:fixed;top:0;right:0;bottom:0;z-index:2100;display:flex;flex-direction:column;border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:-12px 0 32px rgba(0,0,0,.24);pointer-events:auto;}",
  ".dshWbDockHead{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);}",
  ".dshWbDockTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-secondary);}",
  ".dshWbDockPick{flex:1;min-width:0;font:inherit;font-size:12px;padding:3px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}",
  ".dshWbDockClose{flex:none;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:1;padding:4px 7px;cursor:pointer;}",
  ".dshWbDockClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}",
  ".dshWbDockBody{flex:1;min-height:0;overflow:auto;padding:10px;}",
  ".dshWbDockRail{position:fixed;top:50%;right:0;transform:translateY(-50%);z-index:2100;padding:10px 6px;border:1px solid var(--dsw-alias-border-l2);border-right:none;border-radius:8px 0 0 8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;pointer-events:auto;}",
  ".dshWbDockRail:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}",
  ".dshWbDockRailText{writing-mode:vertical-rl;letter-spacing:.08em;}",
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
  contextNow: "正在做",
  noticeDismiss: "点击关闭",
  // 辅助坞（L2）
  dockTitle: (label) => `${label} · 辅助坞`,
  dockOpen: (label) => `展开${label}的辅助坞`,
  dockCollapse: "收起辅助坞",
  dockPick: "选择坞里显示哪个模式",
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
var dockOpen = false;
var dockWidth = 340;
var dockModeId = null;
var listeners = /* @__PURE__ */ new Set();
var LS_DOCK = "dsh-workbench-dock";
function readDockLS() {
  try {
    const raw = localStorage.getItem(LS_DOCK);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.open === "boolean") dockOpen = parsed.open;
    if (Number.isFinite(parsed?.width)) dockWidth = Math.min(720, Math.max(240, Number(parsed.width)));
    if (typeof parsed?.modeId === "string" || parsed?.modeId === null) dockModeId = parsed.modeId;
  } catch {
  }
}
readDockLS();
function persistDock() {
  try {
    localStorage.setItem(LS_DOCK, JSON.stringify({ open: dockOpen, width: dockWidth, modeId: dockModeId }));
  } catch {
  }
}
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
function setNotice(next) {
  const value = next && next.text ? { kind: next.kind === "warn" ? "warn" : "info", text: String(next.text) } : null;
  notice = value;
  emit();
}
function subscribe(fn) {
  if (typeof fn !== "function") return () => {
  };
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function isDockOpen() {
  return dockOpen;
}
function setDockOpen(next) {
  const value = next === true;
  if (dockOpen === value) return;
  dockOpen = value;
  persistDock();
  emit();
}
function getDockWidth() {
  return dockWidth;
}
function getDockModeId() {
  return dockModeId;
}
function setDockModeId(next) {
  const value = next === null || next === void 0 || next === "" ? null : String(next);
  if (dockModeId === value) return;
  dockModeId = value;
  persistDock();
  emit();
}

// plugin/workbench/src/client/use-workbench.js
var react = __toESM(require("react"), 1);
function useWorkbench() {
  const registry2 = getRegistry();
  const snapshot = react.useCallback(
    () => ({
      modes: registry2.list(),
      active: registry2.getActive(),
      // 上下文只在需要时问（模式的 context.get 可能读文件/状态，不该每次渲染都全量拉）
      context: registry2.contextOf(registry2.getActive()),
      lastHandoff: registry2.lastHandoff(),
      open: isOpen(),
      notice: getNotice(),
      // 辅助坞（L2）：开合/宽度/显示哪个模式
      dockOpen: isDockOpen(),
      dockWidth: getDockWidth(),
      dockModeId: getDockModeId()
    }),
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
  const { modes, active, context, open: open2, registry: registry2 } = useWorkbench();
  if (modes.length === 0) return null;
  const activeLabel = (modes.find((m) => m.id === active) || {}).label || "";
  const contextLabel = context ? context.title || context.project || context.path || "" : "";
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
      title: [T.entry, activeLabel, contextLabel].filter(Boolean).join(" · "),
      "aria-label": T.entry,
      "data-wb-entry": "",
      "data-wb-count": String(modes.length)
    },
    react2.createElement("span", { className: "dshWbEntryGlyph", "aria-hidden": "true" }, "◧"),
    react2.createElement("span", { className: "dshWbEntryLabel" }, T.entry),
    activeLabel ? react2.createElement("span", { className: "dshWbEntryMode", "data-wb-active-label": "" }, contextLabel ? `${activeLabel} · ${contextLabel}` : activeLabel) : null
  );
}

// plugin/workbench/src/client/Chrome.js
var react3 = __toESM(require("react"), 1);
var NOTICE_MS = 6e3;
function WorkbenchChrome() {
  const { modes, active, context, lastHandoff, open: open2, notice: notice2, registry: registry2 } = useWorkbench();
  const seenHandoffAt = react3.useRef(0);
  react3.useEffect(() => {
    if (!lastHandoff || lastHandoff.at === seenHandoffAt.current) return;
    seenHandoffAt.current = lastHandoff.at;
    const from = registry2.resolveLabel(lastHandoff.from);
    const to = registry2.resolveLabel(lastHandoff.to);
    if (lastHandoff.delivered) setNotice({ kind: "info", text: `已把「${from}」的引用交给「${to}」` });
    else setNotice({ kind: "warn", text: `「${to}」还没有接收端，引用没有送出去` });
  }, [lastHandoff, registry2]);
  react3.useEffect(() => {
    if (!notice2) return void 0;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice2]);
  if (!open2 && !notice2) return null;
  const contextLabel = context ? context.title || context.project || context.path || "" : "";
  const activeLabel = (modes.find((m) => m.id === active) || {}).label || "";
  const toast = notice2 ? react3.createElement(
    "div",
    {
      className: `dshWbToast${notice2.kind === "warn" ? " is-warn" : ""}`,
      role: "status",
      onClick: () => setNotice(null),
      title: T.noticeDismiss,
      "data-wb-notice": notice2.kind
    },
    notice2.text
  ) : null;
  if (!open2) return react3.createElement(react3.Fragment, null, toast);
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
      active ? react3.createElement(
        "div",
        { className: "dshWbCtx", "data-wb-context": active },
        `${T.contextNow}：${activeLabel}${contextLabel ? ` · ${contextLabel}` : ""}`
      ) : null,
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
    ),
    toast
  );
}

// plugin/workbench/src/client/Dock.js
var react4 = __toESM(require("react"), 1);
function useDockInset(open2, width) {
  react4.useEffect(() => {
    try {
      document.documentElement.style.setProperty("--dsh-wb-dock-width", open2 ? `${width}px` : "0px");
    } catch {
    }
    return () => {
      try {
        document.documentElement.style.setProperty("--dsh-wb-dock-width", "0px");
      } catch {
      }
    };
  }, [open2, width]);
}
function WorkbenchDock() {
  const { modes, active, dockOpen: dockOpen2, dockWidth: dockWidth2, dockModeId: dockModeId2, registry: registry2 } = useWorkbench();
  const candidates = modes.filter((m) => m.hasDock && m.id !== active).map((m) => registry2.dockViewOf(m.id)).filter(Boolean).sort((a, b) => a.order === b.order ? a.id.localeCompare(b.id, "en") : a.order - b.order);
  useDockInset(dockOpen2 && candidates.length > 0, dockWidth2);
  if (candidates.length === 0) return null;
  const chosen = candidates.find((c) => c.id === dockModeId2) || candidates[0];
  if (!dockOpen2) {
    return react4.createElement(
      "button",
      {
        type: "button",
        className: "dshWbDockRail",
        onClick: () => setDockOpen(true),
        title: T.dockOpen(chosen.label),
        "aria-label": T.dockOpen(chosen.label),
        "data-wb-dock-rail": ""
      },
      react4.createElement("span", { className: "dshWbDockRailText" }, chosen.label)
    );
  }
  const DockView = chosen.view;
  return react4.createElement(
    "aside",
    {
      className: "dshWbDock",
      style: { width: `${dockWidth2}px` },
      "data-wb-dock": chosen.id,
      "aria-label": T.dockTitle(chosen.label)
    },
    react4.createElement(
      "div",
      { className: "dshWbDockHead" },
      candidates.length > 1 ? react4.createElement(
        "select",
        {
          className: "dshWbDockPick",
          value: chosen.id,
          onChange: (event) => setDockModeId(event.target.value),
          title: T.dockPick,
          "data-wb-dock-pick": ""
        },
        candidates.map((c) => react4.createElement("option", { key: c.id, value: c.id }, c.label))
      ) : react4.createElement("span", { className: "dshWbDockTitle" }, chosen.label),
      react4.createElement(
        "button",
        { type: "button", className: "dshWbDockClose", onClick: () => setDockOpen(false), title: T.dockCollapse, "data-wb-dock-close": "" },
        "⟩"
      )
    ),
    react4.createElement("div", { className: "dshWbDockBody", "data-wb-dock-body": chosen.id }, react4.createElement(DockView))
  );
}

// plugin/workbench/src/client/Settings.js
var react5 = __toESM(require("react"), 1);
function WorkbenchSettings() {
  const { modes, active } = useWorkbench();
  const [host, setHost] = react5.useState({ loading: true });
  react5.useEffect(() => {
    let dead = false;
    void fetchState().then((result) => {
      if (!dead) setHost({ loading: false, ...result });
    });
    return () => {
      dead = true;
    };
  }, []);
  const activeLabel = (modes.find((m) => m.id === active) || {}).label || T.activeNone;
  return react5.createElement(
    "div",
    { className: "dshWbSet", "data-wb-settings": "" },
    react5.createElement(
      "div",
      { className: "dshWbSetCard" },
      react5.createElement("div", { className: "dshWbSetTitle" }, T.settings),
      react5.createElement("div", { className: "dshWbSetLine" }, T.settingsIntro),
      react5.createElement("div", { className: "dshWbSetMuted" }, T.settingsDegraded)
    ),
    react5.createElement(
      "div",
      { className: "dshWbSetCard" },
      react5.createElement("div", { className: "dshWbSetTitle" }, T.settingsModes),
      modes.length === 0 ? react5.createElement("div", { className: "dshWbSetMuted", "data-wb-settings-none": "" }, T.settingsNone) : react5.createElement(
        "div",
        { className: "dshWbSetLine", style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
        modes.map(
          (mode) => react5.createElement(
            "span",
            { key: mode.id, className: `dshWbSetChip${mode.active ? " is-active" : ""}`, "data-wb-settings-mode": mode.id },
            mode.label
          )
        )
      )
    ),
    react5.createElement(
      "div",
      { className: "dshWbSetCard" },
      react5.createElement("div", { className: "dshWbSetTitle" }, T.settingsActive),
      react5.createElement("div", { className: "dshWbSetLine", "data-wb-settings-active": active || "" }, activeLabel)
    ),
    react5.createElement(
      "div",
      { className: "dshWbSetCard" },
      react5.createElement("div", { className: "dshWbSetTitle" }, T.settingsHost),
      react5.createElement("div", { className: "dshWbSetMuted" }, T.settingsHostHint),
      host.loading ? react5.createElement("div", { className: "dshWbSetMuted" }, "…") : host.ok ? react5.createElement(
        "div",
        { className: "dshWbSetLine", "data-wb-settings-rev": String(host.state?.revision ?? "") },
        T.settingsRevision(host.state?.revision ?? 0),
        host.state?.activeModeId ? ` · ${host.state.activeModeId}` : ""
      ) : react5.createElement("div", { className: "dshWbSetLine", "data-wb-settings-error": host.error || "error" }, T.settingsUnreachable)
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
  register("shell.overlay", { name: "shell.overlay", id: "workbench-dock", order: 11, label: () => T.entry }, WorkbenchDock, "workbench: dock");
  register("settings.section", { name: "settings.section", id: "workbench", order: 45, label: () => T.settings }, WorkbenchSettings, "workbench: settings");
  console.info("[workbench] client ready · entry + switcher + dock + settings");
}
function __workbenchRegistry() {
  return liveRegistry;
}
    return module.exports
  },
})
