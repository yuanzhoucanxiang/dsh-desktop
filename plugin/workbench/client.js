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
var react7 = __toESM(require("react"), 1);

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
    // 主屏瓷砖视图（L2 主屏，可选）：进入工具台主屏时，右侧瓷砖格里渲染这份「主要内容窗口」。
    // 与 dock 并立：dock 是别人当主视图时的右缘轻视图，tile 是主屏里的内容窗口；同为运行时组件引用。
    tile: descriptor.tile && typeof descriptor.tile === "object" && descriptor.tile.view ? {
      label: descriptor.tile.label,
      view: descriptor.tile.view,
      order: Number.isFinite(descriptor.tile.order) ? Number(descriptor.tile.order) : 100
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
    hasDock: mode.dock !== null,
    hasTile: mode.tile !== null
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
  function tileViewOf(id) {
    const key = id === null || id === void 0 ? null : String(id).trim();
    const mode = key === null ? null : modes.get(key);
    if (!mode || !mode.tile) return null;
    return { id: mode.id, label: normalizeLabel(mode.tile.label) || mode.id, order: mode.tile.order, view: mode.tile.view };
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
  return { registerMode, list, setActive, adopt, getActive, has, size, subscribe: subscribe2, resolveLabel, contextOf, handoff, lastHandoff, dockViewOf, tileViewOf };
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
  // 主屏（L2 主屏，2026-10-11 项目所有者定形态）：全屏门面——左列对话 + 右侧模式瓷砖格；
  // z 层 2200：盖过模式浮层（写作 2000 / GIR 60）与辅助坞（2100），打开时盖住、关闭后原样回到。
  ".dshWbHome{position:fixed;inset:0;z-index:2200;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);animation:dshWbIn .16s ease-out;}",
  "@keyframes dshWbIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}",
  "@media (prefers-reduced-motion:reduce){.dshWbHome{animation:none}}",
  ".dshWbHomePanel{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px;padding:20px 24px;overflow:auto;}",
  ".dshWbHomeBody{flex:1;min-height:0;display:flex;gap:16px;}",
  // 左列：对话瓷砖（真实但克制的 v1：会话标题 + 回到完整会话；完整聊天交互下一轮）
  ".dshWbChat{flex:none;width:340px;display:flex;flex-direction:column;gap:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);padding:14px;}",
  ".dshWbChatHead{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);}",
  ".dshWbChatCard{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;}",
  ".dshWbChatSession{min-width:0;flex:1;}",
  ".dshWbChatSessionTitle{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
  ".dshWbChatHint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}",
  // 状态条（输入框下那条窄条）：三个指标各占一段，读不到就如实写"还没数据"+原因（title）
  ".dshWbStrip{flex:none;display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:8px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1);}",
  ".dshWbStripItem{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;cursor:default;}",
  // 真聊天瓷砖（只读转录）：最多几条 + 角色标签，长文截断，绝不撑破窄窗
  ".dshWbChatLog{flex:1;min-height:0;display:flex;flex-direction:column;gap:6px;overflow:auto;margin-top:8px;padding-right:2px;}",
  ".dshWbChatLine{display:flex;gap:6px;align-items:flex-start;font-size:12px;line-height:17px;}",
  ".dshWbChatWho{flex:none;padding:1px 5px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px;}",
  ".dshWbChatLine.is-user .dshWbChatWho{color:var(--dsw-alias-brand-primary);}",
  ".dshWbChatLine.is-error .dshWbChatWho{color:var(--dsw-alias-state-error-primary);}",
  ".dshWbChatText{flex:1;min-width:0;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;}",
  // 输入框那一行（长条底部）：文本域 + 发送钮，禁用时靠 placeholder/title 说清出路
  ".dshWbComposer{flex:none;display:flex;gap:8px;align-items:flex-end;margin-top:8px;}",
  ".dshWbComposerInput{flex:1;min-width:0;resize:none;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:17px;}",
  ".dshWbComposerInput:disabled{opacity:.55;cursor:not-allowed;}",
  ".dshWbComposer .dshWbBtn:disabled{opacity:.55;cursor:not-allowed;}",
  // 右侧：瓷砖格（提供 tile 的模式渲染内容窗口；没提供的退化为大按钮卡，保证可达）
  ".dshWbTiles{flex:1;min-width:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;align-content:start;overflow:auto;padding-bottom:4px;}",
  ".dshWbTile{position:relative;display:flex;flex-direction:column;min-height:220px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;}",
  ".dshWbTile.is-active{border-color:var(--dsw-alias-brand-primary);}",
  ".dshWbTileHead{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);}",
  ".dshWbTileLabel{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
  ".dshWbTileEnter{flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;padding:3px 9px;cursor:pointer;}",
  ".dshWbTileEnter:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-brand-primary);}",
  ".dshWbTileEnter:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}",
  ".dshWbTileBody{flex:1;min-height:0;overflow:auto;padding:10px;}",
  // 窄窗（<900px）对话列收上、瓷砖格收下，不横向挤坏
  "@media (max-width:900px){.dshWbHomeBody{flex-direction:column;}.dshWbChat{width:auto;flex:none;}}",
  ".dshWbHead{display:flex;align-items:baseline;gap:8px;}",
  ".dshWbTitle{flex:1;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);}",
  ".dshWbClose{border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;cursor:pointer;padding:2px 4px;border-radius:6px;}",
  ".dshWbClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}",
  // 长条自绘顶栏三钮（2026-10-12 拍板）：只在条状形态出现；normal 仍走原生标题栏，两套并排就是混乱。
  // 刻意**不写 -webkit-app-region**——这一刀窗口还有原生边框，拖拽归原生标题栏；无边框那一刀再补。
  ".dshWbBar{flex:none;display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);}",
  ".dshWbBarTitle{flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
  ".dshWbBarBtn{flex:none;width:26px;height:22px;display:flex;align-items:center;justify-content:center;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;}",
  ".dshWbBarBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}",
  ".dshWbBarBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}",
  ".dshWbBarBtn.is-close:hover{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);}",
  // `—` 收到小条：整块门面只剩顶栏 + 一行"正在做什么"（168px 高塞对话与瓷砖就是破版）
  ".dshWbMini{position:fixed;inset:0;z-index:2200;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);}",
  ".dshWbMiniLine{flex:1;min-height:0;display:flex;align-items:center;padding:0 14px;font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
  ".dshWbHint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}",
  // 模式卡片（2026-10-11 前端轮，中央面板版）：大徽标 + 名称 + 该模式自己上报的「正在做什么」；当前模式品牌色描边
  ".dshWbList{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;}",
  ".dshWbMode{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:10px;width:100%;min-height:96px;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;cursor:pointer;text-align:left;}",
  ".dshWbMode:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2);}",
  ".dshWbMode:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}",
  ".dshWbMode.is-active{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);}",
  ".dshWbModeGlyph{flex:none;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-brand-primary);font-size:16px;font-weight:600;}",
  ".dshWbMode.is-active .dshWbModeGlyph{border-color:var(--dsw-alias-brand-primary);}",
  ".dshWbModeBody{min-width:0;display:flex;flex-direction:column;gap:3px;}",
  ".dshWbModeLabel{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}",
  ".dshWbModeCtx{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}",
  ".dshWbRowMark{flex:none;font-size:11px;padding:1px 8px;border:1px solid var(--dsw-alias-brand-primary);border-radius:999px;color:var(--dsw-alias-brand-primary);}",
  ".dshWbMode .dshWbRowMark{position:absolute;top:10px;right:10px;}",
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
  // 左缘拖拽把手（2026-10-11 前端轮）：宽度仍由 ui-store 的 clamp(240–720) 与 localStorage 管
  ".dshWbDockGrip{position:absolute;left:-4px;top:0;bottom:0;width:8px;cursor:ew-resize;pointer-events:auto;}",
  ".dshWbDockGrip:hover{background:var(--dsw-alias-interactive-bg-hover);box-shadow:inset 1px 0 0 var(--dsw-alias-brand-primary);}",
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
  ".dshWbBtn:hover{background:var(--dsw-alias-interactive-bg-hover);}",
  // 长条·接缝扇形（原型 v2.2：以接缝为轴心、中间那颗顶到最外、逐颗错峰滑入）。
  // 窗外画不了（窗口边界是硬的），所以是**窗内扇形**：收起态 opacity+visibility 双保险
  // （只靠 opacity 还会吃点击），展开态按 --wb-delay 逐颗错峰。
  ".dshWbSeam{position:fixed;top:50%;right:0;transform:translateY(-50%);z-index:2210;display:flex;align-items:center;pointer-events:auto;}",
  ".dshWbSeamGrip{flex:none;padding:10px 3px;border:1px solid var(--dsw-alias-border-l2);border-right:none;border-radius:8px 0 0 8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1;}",
  ".dshWbSeamFan{position:absolute;right:0;top:50%;width:0;height:0;}",
  ".dshWbSeamItem{position:absolute;right:0;top:0;margin-top:-14px;display:flex;align-items:center;gap:0;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;opacity:0;visibility:hidden;pointer-events:none;transform:translate(0,calc(var(--wb-y) * 1px));transition:transform .18s ease-out,opacity .18s ease-out,visibility .18s;}",
  ".dshWbSeam.is-open .dshWbSeamItem{opacity:1;visibility:visible;pointer-events:auto;transform:translate(calc(var(--wb-out) * -1px),calc(var(--wb-y) * 1px));transition-delay:var(--wb-delay);}",
  ".dshWbSeamItem:hover,.dshWbSeamItem:focus-visible{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);}",
  ".dshWbSeamItem.is-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}",
  ".dshWbSeamGlyph{flex:none;width:28px;height:28px;display:grid;place-items:center;border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:12px;}",
  ".dshWbSeamText{max-width:0;overflow:hidden;opacity:0;transition:max-width .16s ease-out,opacity .16s ease-out;}",
  ".dshWbSeamItem:hover .dshWbSeamText,.dshWbSeamItem:focus-visible .dshWbSeamText{max-width:150px;opacity:1;padding-right:10px;}",
  ".dshWbSeamEmpty{position:absolute;right:34px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;opacity:0;visibility:hidden;transition:opacity .16s ease-out,visibility .16s;}",
  ".dshWbSeam.is-open .dshWbSeamEmpty{opacity:1;visibility:visible;}"
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
var sessions = null;
var chatService = null;
function setRegistry(next) {
  registry = next;
}
function getRegistry() {
  if (!registry) throw new Error("workbench registry 尚未建立");
  return registry;
}
function setSessions(next) {
  sessions = next && typeof next === "object" ? next : null;
}
function getSessions() {
  return sessions;
}
function setChatService(next) {
  chatService = next && typeof next === "object" ? next : null;
}
function getChatService() {
  return chatService;
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
  switcherHint: "选一个模式开始创作；↑↓ 选择、回车进入，Esc 关闭。切走时模式自己的守卫会先被问一次。",
  close: "关闭",
  empty: "还没有模式接入工具台。",
  emptyHint: "写作、GIR 生图等模式就绪后，会出现在这里。",
  current: "当前",
  contextNow: "正在做",
  noticeDismiss: "点击关闭",
  // 辅助坞（L2）
  dockTitle: (label) => `${label} · 辅助坞`,
  dockOpen: (label) => `展开${label}的辅助坞`,
  dockCollapse: "收起辅助坞",
  dockPick: "选择坞里显示哪个模式",
  // 主屏（L2 主屏）：入口打开的就是它——左列对话 + 右侧模式瓷砖格
  homeTitle: "创作工具台",
  homeHint: "左边接着和 agent 聊，右边是各模式的内容窗口；点一块进入该模式。",
  chatTitle: "对话",
  chatBack: "回到完整会话",
  chatNoService: "读不到会话（内核会话服务不可用）。",
  chatEmpty: "还没有会话。关掉主屏，在内核界面里发起一段对话。",
  chatOpenHint: "当前会话",
  tileEnter: (label) => `进入${label}`,
  tileEmpty: "这个模式还没有提供内容窗口；点「进入」打开它的完整界面。",
  dockResize: "拖拽调整辅助坞宽度",
  // 长条形态的**接缝呼出**（原型 v2.2 扇形的第一版）：悬停右缘列出模式，点一个进入。
  // 长条里因此不再摆瓷砖格——对话优先，模式入口走接缝（与原型一致；主屏仍然保留瓷砖格）。
  seamLabel: "模式接缝",
  seamHint: "悬停右缘呼出模式",
  seamEmpty: "还没有模式可拼",
  activeNone: "未进入任何模式",
  exit: "退出模式",
  // 长条自绘顶栏三钮（2026-10-12 拍板语义：`—` 收小条 / `⎋` 退出工具台并还原窗口 / `✕` 走既有关窗语义）
  btnMini: (back) => back ? "展开成长条" : "收成小条",
  btnExit: "退出工具台（窗口还原成正常大小）",
  btnClose: "关闭这个窗口（按应用的关窗设置走：默认收进托盘，不会退出应用）",
  switchTo: (label) => `切换到 ${label}`,
  settingsIntro: "工具台是模式的统一门面：入口、切换、互斥与共享上下文都在这里，模式自己的实现不受影响。",
  settingsModes: "已注册的模式",
  settingsNone: "当前没有模式向工具台注册。若刚升级过，请确认写作模式 / GIR 生图插件处于启用状态。",
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
var chatDraft = "";
function getChatDraft() {
  return chatDraft;
}
function setChatDraft(text) {
  chatDraft = String(text ?? "");
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
function setDockWidth(next) {
  const value = Math.min(720, Math.max(240, Number(next) || dockWidth));
  if (dockWidth === value) return;
  dockWidth = value;
  persistDock();
  emit();
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

// plugin/workbench/src/client/FooterEntry.js
function WorkbenchEntry() {
  const { modes, active, context, open: open2 } = useWorkbench();
  if (modes.length === 0) return null;
  const activeLabel = (modes.find((m) => m.id === active) || {}).label || "";
  const contextLabel = context ? context.title || context.project || context.path || "" : "";
  const onClick = () => {
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
var react4 = __toESM(require("react"), 1);

// plugin/workbench/src/client/actions.js
async function switchMode(registry2, id, reason = "switch") {
  const result = await registry2.setActive(id, reason);
  if (result.ok) setOpen(false);
  return result;
}
function exitMode(registry2) {
  return switchMode(registry2, null, "exit");
}

// plugin/workbench/src/client/ConversationTile.js
var react3 = __toESM(require("react"), 1);

// plugin/workbench/src/client/session-telemetry.js
function asObject(value) {
  return value && typeof value === "object" ? value : null;
}
function usageOf(values) {
  return asObject(values?.tokenUsage?.totals) || asObject(values?.tokenUsage);
}
function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function projectionValuesOf(sessions2, sessionId) {
  if (!sessions2 || !sessionId) return null;
  try {
    const snap = sessions2.list?.getSnapshot?.();
    const record = snap?.byId?.[sessionId];
    return asObject(record?.projectionValues);
  } catch {
    return null;
  }
}
function telemetryOf(values) {
  const v = asObject(values);
  const stats = asObject(v?.sessionStats);
  const usage = usageOf(v);
  const pressure = asObject(v?.contextPressure);
  const decodeMs = num(stats?.decodeMs);
  const decodeTokens = num(stats?.decodeTokens);
  const tokensPerSecond = decodeMs && decodeMs > 0 && decodeTokens !== null ? decodeTokens / (decodeMs / 1e3) : null;
  const cacheRead = num(usage?.cacheReadTokens) ?? 0;
  const promptInput = (num(usage?.uncachedInputTokens) ?? 0) + cacheRead + (num(usage?.cacheWriteTokens) ?? 0);
  const cacheHitPercent = usage && promptInput > 0 ? cacheRead / promptInput * 100 : null;
  const pressureTokens = num(pressure?.pressureTokens);
  const contextWindow = num(pressure?.contextWindow);
  const contextPercent = pressureTokens !== null && contextWindow && contextWindow > 0 ? pressureTokens / contextWindow * 100 : null;
  return { tokensPerSecond, cacheHitPercent, contextPercent, pressureTokens, contextWindow };
}
function watchSessionProjections(sessions2, sessionId, onChange) {
  const noop = () => {
  };
  if (!sessions2 || !sessionId) return { source: "no-session", dispose: noop };
  if (typeof sessions2.retain !== "function" || typeof sessions2.binding !== "function") {
    onChange(projectionValuesOf(sessions2, sessionId));
    return { source: "list-row", dispose: noop };
  }
  let ref = null;
  try {
    ref = sessions2.retain(sessionId, { source: "mainView" });
  } catch {
    onChange(projectionValuesOf(sessions2, sessionId));
    return { source: "list-row", dispose: noop };
  }
  const store = sessions2.binding?.(sessionId)?.session?.projections;
  if (!store || typeof store.values !== "function") {
    try {
      ref?.release?.();
    } catch {
    }
    return { source: "no-store", dispose: noop };
  }
  const sync = () => {
    try {
      onChange(store.values());
    } catch {
    }
  };
  sync();
  let off = null;
  try {
    off = typeof store.subscribeAny === "function" ? store.subscribeAny(sync) : null;
  } catch {
    off = null;
  }
  return {
    source: "retained",
    dispose() {
      try {
        if (typeof off === "function") off();
      } catch {
      }
      try {
        ref?.release?.();
      } catch {
      }
    }
  };
}
function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
function formatTelemetry(t) {
  const speed = t?.tokensPerSecond !== null && t?.tokensPerSecond !== void 0 ? { text: `⚡ ${round(t.tokensPerSecond)} tok/s`, title: "解码速度：输出 token ÷ 解码墙钟时间（内核 sessionStats 投影）" } : { text: "⚡ 还没数据", title: "这条会话还没有流式输出过，所以算不出解码速度" };
  const cache = t?.cacheHitPercent !== null && t?.cacheHitPercent !== void 0 ? { text: `缓存 ${round(t.cacheHitPercent)}%`, title: "缓存命中率：命中的输入 token ÷ 全部输入 token（内核 tokenUsage 投影）" } : { text: "缓存 还没数据", title: "这条会话还没有带用量的请求，所以算不出命中率" };
  const context = t?.contextPercent !== null && t?.contextPercent !== void 0 ? {
    text: `上下文 ${round(t.contextPercent)}%`,
    title: `占用 ${t.pressureTokens} / 窗口 ${t.contextWindow} token（内核 contextPressure 投影）`
  } : { text: "上下文 未上报", title: "内核还没给出这条会话的上下文占用或窗口大小，所以不显示百分比" };
  return { speed, cache, context };
}

// packages/mode-kit/src/harness/projection.js
var REFERENCE_SEPARATOR = "\n\n--- 供本次讨论参考的稿件快照（可能尚未保存） ---\n";
function textOf(parts) {
  return (parts || []).filter((p) => p && (p.kind === "text" || p.type === "text")).map((p) => p.text || "").join("");
}
var INJECTED_PREFIXES = ["【写作模式状态】", "【项目备忘"];
function stripInjectedBlocks(text) {
  let out = String(text || "");
  for (let i = 0; i < 4; i++) {
    const trimmed = out.replace(/^\s+/, "");
    if (!INJECTED_PREFIXES.some((p) => trimmed.startsWith(p))) break;
    const nl = trimmed.indexOf("\n\n");
    out = nl < 0 ? "" : trimmed.slice(nl + 2);
  }
  return out.trim();
}
function projectChat(chat) {
  if (!chat) return { messages: [], hasUnknown: false };
  const nodes = chat.nodes;
  const order = chat.order || [];
  const messages = [];
  let hasUnknown = false;
  for (const key of order) {
    const node = nodes && typeof nodes.get === "function" ? nodes.get(key) : nodes ? nodes[key] : null;
    if (!node || node.visibility === "hidden") continue;
    const data = node.data || {};
    if (node.kind === "user" || node.kind === "steering") {
      const raw = textOf(data.content);
      const idx = raw.indexOf(REFERENCE_SEPARATOR);
      const text = stripInjectedBlocks(idx >= 0 ? raw.slice(0, idx) : raw);
      const reference = idx >= 0 ? raw.slice(idx + REFERENCE_SEPARATOR.length) : void 0;
      messages.push({ key, kind: "user", text: text || "附件消息（在完整会话中查看）", reference });
      continue;
    }
    if (node.kind === "assistant-step") {
      const text = textOf(data.blocks);
      if (text) messages.push({ key, kind: "assistant", text });
      continue;
    }
    if (node.kind === "turn-tail") continue;
    if (node.kind === "tool-call") {
      const root = data.root && typeof data.root === "object" ? data.root : data;
      const result = root.kind === "tool-result" ? root : null;
      messages.push({
        key,
        kind: "detail",
        text: "工具活动",
        detail: data,
        tool: {
          name: String((result ? result.call?.name : root.name) || ""),
          callId: String(root.callId || ""),
          argsRaw: String((result ? result.call?.argsRaw : root.argsRaw) || ""),
          phase: result ? "result" : String(root.phase || ""),
          isError: result ? result.isError === true : false
        }
      });
      continue;
    }
    if (node.kind === "turn-error") {
      messages.push({ key, kind: "error", text: data.failure?.message || "这次回复未能完成，请查看完整会话。" });
      continue;
    }
    hasUnknown = true;
    messages.push({ key, kind: "detail", text: node.kind === "context" ? "补充上下文" : "会话活动", detail: data });
  }
  return { messages, hasUnknown };
}

// plugin/workbench/src/client/chat-transcript.js
var TRANSCRIPT_LIMIT = 6;
function asFunction(value) {
  return typeof value === "function" ? value : null;
}
function graphOf(target) {
  if (!target || typeof target !== "object") return null;
  const snap = asFunction(target.getSnapshot);
  const value = snap ? snap.call(target) : target;
  if (!value || typeof value !== "object") return null;
  if (value.nodes || Array.isArray(value.order)) return value;
  if (value.chat && (value.chat.nodes || Array.isArray(value.chat.order))) return value.chat;
  return null;
}
function emptyState(source) {
  return { source, messages: [], hasUnknown: false };
}
function projected(source, graph) {
  return { source, ...projectChat(graph) };
}
function watchTranscript(sessions2, uiConversation, sessionId, onChange) {
  const offs = [];
  let closed = false;
  const dispose = () => {
    closed = true;
    while (offs.length) {
      const off = offs.pop();
      try {
        if (typeof off === "function") off();
      } catch {
      }
    }
  };
  const notify = (state) => {
    if (closed || typeof onChange !== "function") return;
    try {
      onChange(state);
    } catch {
    }
  };
  const attach = (subscribe2, reader) => {
    const ret = subscribe2(() => notify(reader()));
    if (typeof ret === "function") offs.push(ret);
  };
  if (!sessionId) return { ...emptyState("no-session"), dispose };
  if (!sessions2 && !uiConversation) return { ...emptyState("no-service"), dispose };
  try {
    const target = uiConversation?.binding?.(sessionId)?.target?.("chat");
    if (target) {
      const read = () => {
        const graph = graphOf(target);
        return graph ? projected("uiConversation", graph) : emptyState("pending");
      };
      if (asFunction(target.subscribe)) attach(target.subscribe.bind(target), read);
      const first = read();
      return { ...first, dispose };
    }
  } catch {
  }
  try {
    const session = sessions2?.binding?.(sessionId)?.session;
    const store = session?.chat && asFunction(session.chat.subscribe) ? session.chat : null;
    const read = () => {
      const graph = graphOf(store) || graphOf(session?.chat) || graphOf(session);
      return graph ? projected("session", graph) : emptyState("none");
    };
    if (store) attach(store.subscribe.bind(store), read);
    const first = read();
    if (first.source === "session") return { ...first, dispose };
  } catch {
  }
  return { ...emptyState("none"), dispose };
}
function tailMessages(messages, limit = TRANSCRIPT_LIMIT) {
  const list = Array.isArray(messages) ? messages : [];
  return list.slice(Math.max(0, list.length - limit));
}

// plugin/workbench/src/client/chat-send.js
function sendSurface(sessions2, sessionId) {
  if (!sessionId) return { canSend: false, session: null, reason: "还没有会话，先在内核界面里发起一段对话。" };
  let session = null;
  try {
    session = sessions2?.binding?.(sessionId)?.session || null;
  } catch {
    session = null;
  }
  if (!session || typeof session.prompt !== "function") {
    return { canSend: false, session: null, reason: "这个内核版本没有给出发送面。点下面「回到完整会话」在原处发送。" };
  }
  return { canSend: true, session, reason: "" };
}
async function dispatchMessage(session, text) {
  const body = String(text || "").trim();
  if (!body) return { result: "rejected", code: "empty-body", error: "还没写内容", retainedBody: "" };
  if (!session || typeof session.prompt !== "function") {
    return { result: "rejected", code: "no-send-surface", error: "没有发送面", retainedBody: body };
  }
  try {
    const res = await session.prompt([{ type: "text", text: body }], "queue");
    if (res && res.ok === true) return { result: "accepted", retainedBody: "" };
    if (res && res.ok === false) {
      return { result: "rejected", code: String(res.error?.code || "send-rejected"), error: String(res.error?.message || res.error || "内核拒绝了这条消息"), retainedBody: body };
    }
    return { result: "uncertain", code: "no-response-shape", error: "发送结果无法核对", retainedBody: body };
  } catch (err) {
    return { result: "uncertain", code: String(err?.code || "send-threw"), error: String(err?.message || err), retainedBody: body };
  }
}

// plugin/workbench/src/client/ConversationTile.js
var WHO = { user: "作者", assistant: "助手", detail: "活动", error: "出错" };
function readSnapshot(sessions2) {
  try {
    const store = sessions2?.list;
    if (!store || typeof store.getSnapshot !== "function") return null;
    const snap = store.getSnapshot();
    if (!snap || !Array.isArray(snap.ids) || typeof snap.byId !== "object" || !snap.byId) return null;
    return snap;
  } catch {
    return null;
  }
}
function ConversationTile({ onBack }) {
  const sessions2 = getSessions();
  const [snap, setSnap] = react3.useState(() => readSnapshot(sessions2));
  react3.useEffect(() => {
    const store = sessions2?.list;
    if (!store || typeof store.subscribe !== "function") return void 0;
    const sync = () => setSnap(readSnapshot(sessions2));
    try {
      return store.subscribe(sync);
    } catch {
      return void 0;
    }
  }, [sessions2]);
  const first = snap && snap.ids.length > 0 ? snap.byId[snap.ids[0]] : null;
  const sessionId = snap && snap.ids.length > 0 ? snap.ids[0] : null;
  const [projValues, setProjValues] = react3.useState(null);
  const [telemetrySource, setTelemetrySource] = react3.useState("no-session");
  react3.useEffect(() => {
    const watch = watchSessionProjections(sessions2, sessionId, setProjValues);
    setTelemetrySource(watch.source);
    return watch.dispose;
  }, [sessionId, sessions2]);
  const metrics = formatTelemetry(telemetryOf(projValues));
  const [transcript, setTranscript] = react3.useState({ source: "no-session", messages: [] });
  react3.useEffect(() => {
    const watch = watchTranscript(
      sessions2,
      getChatService(),
      sessionId,
      (next) => setTranscript({ source: next.source, messages: tailMessages(next.messages) })
    );
    setTranscript({ source: watch.source, messages: tailMessages(watch.messages) });
    return watch.dispose;
  }, [sessionId, sessions2]);
  const log = transcript.messages.length ? react3.createElement(
    "div",
    { className: "dshWbChatLog", "data-wb-chat-log": "", "data-wb-chat-source": transcript.source },
    transcript.messages.map(
      (m) => react3.createElement(
        "div",
        { key: m.key, className: `dshWbChatLine is-${m.kind}`, "data-wb-chat-line": m.kind },
        react3.createElement("span", { className: "dshWbChatWho" }, WHO[m.kind] || "会话"),
        react3.createElement("span", { className: "dshWbChatText" }, String(m.text || "").slice(0, 160))
      )
    )
  ) : null;
  const logHint = !transcript.messages.length && sessionId && (transcript.source === "none" || transcript.source === "no-service") ? react3.createElement(
    "div",
    { className: "dshWbChatHint", "data-wb-chat-log-empty": transcript.source },
    "这条会话的内容暂时读不到（内核会话图通道不可用）。点下面「回到完整会话」看全文。"
  ) : null;
  const strip = react3.createElement(
    "div",
    {
      className: "dshWbStrip",
      "data-wb-strip": "",
      "data-wb-telemetry": telemetrySource,
      // 自查用：句柄投影里**到底有哪些键**（真内核上一眼能分清"还没送到"与"根本没这个键"）
      "data-wb-telemetry-keys": Object.keys(projValues || {}).sort().join(",")
    },
    react3.createElement("span", { className: "dshWbStripItem", title: metrics.speed.title, "data-wb-metric": "speed" }, metrics.speed.text),
    react3.createElement("span", { className: "dshWbStripItem", title: metrics.cache.title, "data-wb-metric": "cache" }, metrics.cache.text),
    react3.createElement("span", { className: "dshWbStripItem", title: metrics.context.title, "data-wb-metric": "context" }, metrics.context.text)
  );
  const title = first?.displayTitle ? String(first.displayTitle) : "";
  const surface = sendSurface(sessions2, sessionId);
  const draftRef = react3.useRef(null);
  const [sending, setSending] = react3.useState(false);
  const send = async () => {
    const box = draftRef.current;
    const text = box ? String(box.value || "") : "";
    if (sending) return;
    setSending(true);
    const out = await dispatchMessage(surface.session, text);
    setSending(false);
    if (out.result === "accepted") {
      if (box) box.value = "";
      setChatDraft("");
      return;
    }
    setNotice({
      kind: "warn",
      text: out.result === "uncertain" ? `这条消息的发送结果没能核对（${out.error}）——你写的内容还留着，可重试；不放心就点「回到完整会话」在原处发。` : `这条消息没发出去（${out.error}）——你写的内容还留着。`
    });
  };
  const composer = first ? react3.createElement(
    "div",
    { className: "dshWbComposer", "data-wb-composer-row": "" },
    react3.createElement("textarea", {
      className: "dshWbComposerInput",
      ref: draftRef,
      // 未发送正文记在模块级（见 ui-store.js 的 getChatDraft）：`—` 收小条会卸载这一整块，
      // 只靠 DOM 就会把作者打到一半的字吞掉。刻意不落盘。
      defaultValue: getChatDraft(),
      onChange: (event) => setChatDraft(event.target.value),
      rows: 2,
      placeholder: surface.canSend ? "接着和 agent 说…（Enter 发送，Shift+Enter 换行）" : "现在还不能在这里发送",
      disabled: !surface.canSend,
      title: surface.canSend ? "" : surface.reason,
      "data-wb-composer": "",
      onKeyDown: (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          void send();
        }
      }
    }),
    react3.createElement(
      "button",
      {
        type: "button",
        className: "dshWbBtn is-primary",
        disabled: !surface.canSend || sending,
        title: surface.canSend ? "" : surface.reason,
        onClick: () => void send(),
        "data-wb-send": ""
      },
      sending ? "发送中…" : "发送"
    )
  ) : null;
  return react3.createElement(
    "div",
    { className: "dshWbChatCard", "data-wb-chat-card": "", "data-wb-chat-source": transcript.source },
    !sessions2 ? react3.createElement("div", { className: "dshWbChatHint", "data-wb-chat-empty": "noservice" }, T.chatNoService) : !snap ? react3.createElement("div", { className: "dshWbChatHint", "data-wb-chat-empty": "unreadable" }, T.chatNoService) : !first ? react3.createElement("div", { className: "dshWbChatHint", "data-wb-chat-empty": "empty" }, T.chatEmpty) : react3.createElement(
      "div",
      { className: "dshWbChatSession", "data-wb-chat-session": "" },
      react3.createElement("div", { className: "dshWbChatSessionTitle", title }, title)
    ),
    log,
    logHint,
    // 没有会话时不摆三条"还没数据"——那时该说的只有上面那句空状态，窄条只会添噪。
    first ? strip : null,
    composer,
    react3.createElement(
      "button",
      { type: "button", className: "dshWbBtn is-primary", onClick: () => void onBack(), "data-wb-chat-back": "" },
      T.chatBack
    )
  );
}

// plugin/workbench/src/client/shell-shape.js
function getShapeBridge(globalThisRef = typeof window === "undefined" ? null : window) {
  const bridge = globalThisRef && globalThisRef.dshShell;
  if (!bridge || typeof bridge.setWorkbenchShape !== "function" || typeof bridge.getWorkbenchShape !== "function") return null;
  return bridge;
}
async function requestShape(shape) {
  const bridge = getShapeBridge();
  if (!bridge) return { ok: false, error: "no-shell-bridge" };
  try {
    const result = await bridge.setWorkbenchShape(shape);
    return result && typeof result === "object" ? result : { ok: false, error: "bad-response" };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}
async function readShape() {
  const bridge = getShapeBridge();
  if (!bridge) return null;
  try {
    const state = await bridge.getWorkbenchShape();
    return state && typeof state === "object" ? state : null;
  } catch {
    return null;
  }
}
async function requestWindowClose(globalThisRef = typeof window === "undefined" ? null : window) {
  const bridge = globalThisRef && globalThisRef.dshShell;
  if (!bridge || typeof bridge.closeWorkbenchWindow !== "function") return { ok: false, error: "no-shell-bridge" };
  try {
    const result = await bridge.closeWorkbenchWindow();
    return result && typeof result === "object" ? result : { ok: false, error: "bad-response" };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// plugin/workbench/src/client/Chrome.js
var SEAM_FAN_OUT = 46;
var SEAM_FAN_GAP = 44;
var SEAM_FAN_STAGGER = 45;
var NOTICE_MS = 6e3;
function contextLabelOf(registry2, id) {
  const c = registry2.contextOf(id);
  if (!c) return "";
  return c.title || c.project || c.doc || c.path || "";
}
function WorkbenchChrome() {
  const { modes, active, context, lastHandoff, open: open2, notice: notice2, registry: registry2 } = useWorkbench();
  const panelRef = react4.useRef(null);
  const seenHandoffAt = react4.useRef(0);
  react4.useEffect(() => {
    if (!lastHandoff || lastHandoff.at === seenHandoffAt.current) return;
    seenHandoffAt.current = lastHandoff.at;
    const from = registry2.resolveLabel(lastHandoff.from);
    const to = registry2.resolveLabel(lastHandoff.to);
    if (lastHandoff.delivered) setNotice({ kind: "info", text: `已把「${from}」的引用交给「${to}」` });
    else setNotice({ kind: "warn", text: `「${to}」还没有接收端，引用没有送出去` });
  }, [lastHandoff, registry2]);
  react4.useEffect(() => {
    if (!notice2) return void 0;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice2]);
  const [shape, setShape] = react4.useState("");
  const [seamOpen, setSeamOpen] = react4.useState(false);
  const askedForStrip = react4.useRef(false);
  react4.useEffect(() => {
    let cancelled = false;
    const apply2 = async (next) => {
      if (!getShapeBridge()) {
        setShape("unsupported");
        return;
      }
      const result = await requestShape(next);
      if (cancelled) return;
      setShape(result.ok ? next : `failed:${result.error}`);
    };
    if (open2) {
      askedForStrip.current = true;
      void apply2("strip");
    } else if (askedForStrip.current) {
      askedForStrip.current = false;
      void apply2("normal");
    }
    return () => {
      cancelled = true;
    };
  }, [open2]);
  react4.useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (open2 || !getShapeBridge()) return;
      const now = await readShape();
      if (cancelled || !now || now.shape === "normal" || now.shape === void 0) return;
      const result = await requestShape("normal");
      if (!cancelled && result.ok) setShape("normal");
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  react4.useEffect(() => {
    if (!open2) return;
    const panel = panelRef.current;
    if (!panel) return;
    const target = panel.querySelector('[data-wb-mode-active="1"]') || panel.querySelector("[data-wb-mode]");
    try {
      target?.focus({ preventScroll: true });
    } catch {
    }
  }, [open2]);
  if (!open2 && !notice2) return null;
  const contextLabel = context ? context.title || context.project || context.path || "" : "";
  const activeLabel = (modes.find((m) => m.id === active) || {}).label || "";
  const toast = notice2 ? react4.createElement(
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
  if (!open2) return react4.createElement(react4.Fragment, null, toast);
  const backToChat = async () => {
    if (active) {
      const result = await exitMode(registry2);
      if (!result.ok) return;
    }
    setOpen(false);
  };
  const isStrip = shape === "strip" || shape === "mini";
  const toggleMini = async () => {
    const next = shape === "mini" ? "strip" : "mini";
    const result = await requestShape(next);
    setShape(result.ok ? next : `failed:${result.error}`);
  };
  const exitWorkbench = async () => {
    if (active) {
      const result = await exitMode(registry2);
      if (!result.ok) return;
    }
    setOpen(false);
  };
  const bar = !isStrip ? null : react4.createElement(
    "div",
    { className: "dshWbBar", "data-wb-bar": "", "data-wb-bar-shape": shape },
    react4.createElement("span", { className: "dshWbBarTitle" }, T.homeTitle),
    react4.createElement(
      "button",
      {
        type: "button",
        className: "dshWbBarBtn",
        onClick: () => void toggleMini(),
        title: T.btnMini(shape === "mini"),
        "aria-label": T.btnMini(shape === "mini"),
        "data-wb-btn": "mini"
      },
      shape === "mini" ? "▢" : "—"
    ),
    react4.createElement(
      "button",
      {
        type: "button",
        className: "dshWbBarBtn",
        onClick: () => void exitWorkbench(),
        title: T.btnExit,
        "aria-label": T.btnExit,
        "data-wb-btn": "exit"
      },
      "⎋"
    ),
    react4.createElement(
      "button",
      {
        type: "button",
        className: "dshWbBarBtn is-close",
        onClick: () => void requestWindowClose(),
        title: T.btnClose,
        "aria-label": T.btnClose,
        "data-wb-btn": "close"
      },
      "✕"
    )
  );
  if (shape === "mini") {
    return react4.createElement(
      react4.Fragment,
      null,
      react4.createElement(
        "div",
        {
          className: "dshWbMini",
          // Escape 在小条下等价于 `⎋`（长条那套键盘出口不能因为换形态就断掉）
          onKeyDown: (event) => {
            if (event.key === "Escape") void exitWorkbench();
          },
          "data-wb-mini": "",
          "data-wb-shape": shape
        },
        bar,
        react4.createElement(
          "div",
          { className: "dshWbMiniLine", "data-wb-mini-line": "" },
          (active && contextLabel ? `${activeLabel} · ${contextLabel}` : activeLabel) || T.chatOpenHint
        )
      ),
      toast
    );
  }
  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll("[data-wb-mode]"));
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement);
    let next = 0;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % items.length;
    else next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
    try {
      items[next].focus({ preventScroll: true });
    } catch {
    }
  };
  const tiles = modes.map((mode) => {
    const ctxLabel = contextLabelOf(registry2, mode.id);
    const tile = mode.hasTile ? registry2.tileViewOf(mode.id) : null;
    if (tile) {
      const TileView = tile.view;
      return react4.createElement(
        "div",
        { key: mode.id, className: `dshWbTile${mode.active ? " is-active" : ""}`, "data-wb-tile": mode.id },
        react4.createElement(
          "div",
          { className: "dshWbTileHead" },
          react4.createElement("span", { className: "dshWbTileLabel" }, tile.label),
          mode.active ? react4.createElement("span", { className: "dshWbRowMark" }, T.current) : null,
          react4.createElement(
            "button",
            {
              type: "button",
              className: "dshWbTileEnter",
              onClick: () => void switchMode(registry2, mode.id),
              "data-wb-tile-enter": mode.id
            },
            T.tileEnter(tile.label)
          )
        ),
        react4.createElement("div", { className: "dshWbTileBody" }, react4.createElement(TileView))
      );
    }
    return react4.createElement(
      "button",
      {
        key: mode.id,
        type: "button",
        className: `dshWbMode${mode.active ? " is-active" : ""}`,
        onClick: () => void switchMode(registry2, mode.id),
        title: T.switchTo(mode.label),
        "data-wb-mode": mode.id,
        "data-wb-mode-active": mode.active ? "1" : "0",
        "aria-current": mode.active ? "true" : void 0
      },
      react4.createElement("span", { className: "dshWbModeGlyph", "aria-hidden": "true" }, mode.label.slice(0, 1) || "·"),
      react4.createElement(
        "span",
        { className: "dshWbModeBody" },
        react4.createElement("span", { className: "dshWbModeLabel" }, mode.label),
        ctxLabel ? react4.createElement("span", { className: "dshWbModeCtx", title: ctxLabel }, ctxLabel) : react4.createElement("span", { className: "dshWbModeCtx" }, T.tileEmpty)
      ),
      mode.active ? react4.createElement("span", { className: "dshWbRowMark" }, T.current) : null
    );
  });
  return react4.createElement(
    "div",
    { className: "dshWbHome", onKeyDown, "data-wb-switcher": "", "data-wb-shape": shape || "none" },
    bar,
    react4.createElement(
      "div",
      { className: "dshWbHomePanel", ref: panelRef, role: "dialog", "aria-label": T.homeTitle },
      react4.createElement(
        "div",
        { className: "dshWbHead" },
        react4.createElement("span", { className: "dshWbTitle" }, isStrip ? T.chatTitle : T.homeTitle),
        react4.createElement("button", { type: "button", className: "dshWbClose", onClick: () => setOpen(false), "data-wb-close": "" }, T.close)
      ),
      isStrip ? null : react4.createElement("div", { className: "dshWbHint" }, T.homeHint),
      active ? react4.createElement(
        "div",
        { className: "dshWbCtx", "data-wb-context": active },
        `${T.contextNow}：${activeLabel}${contextLabel ? ` · ${contextLabel}` : ""}`
      ) : null,
      react4.createElement(
        "div",
        { className: "dshWbHomeBody" },
        react4.createElement(
          "aside",
          { className: "dshWbChat", "data-wb-chat": "", "aria-label": T.chatTitle },
          react4.createElement("div", { className: "dshWbChatHead" }, T.chatTitle),
          react4.createElement(ConversationTile, { onBack: backToChat })
        ),
        // 长条形态：**对话优先**，瓷砖格让位给右缘接缝（原型 v2.2）；主屏（normal）仍保留瓷砖格
        isStrip ? null : modes.length === 0 ? react4.createElement(
          "div",
          { className: "dshWbEmpty", "data-wb-empty": "" },
          react4.createElement("div", null, T.empty),
          react4.createElement("div", null, T.emptyHint)
        ) : react4.createElement("section", { className: "dshWbTiles", "data-wb-tiles": "" }, tiles)
      ),
      active ? react4.createElement(
        "div",
        { className: "dshWbFoot" },
        react4.createElement("button", { type: "button", className: "dshWbBtn", onClick: () => void exitMode(registry2), "data-wb-exit": "" }, T.exit)
      ) : null
    ),
    // 接缝呼出·扇形（原型 v2.2：**以接缝为轴心、中间那颗顶到最外**，逐颗错峰滑入）。
    // 几何在 JS 里算好、用 CSS 变量摆位——探针可直接读 data-wb-seam-out / -delay 验证这两条。
    // 窗外画不了（窗口边界是硬的，plan §12-9 的 A/B/C 里已选"收在窗口内贴右缘"），所以是**窗内扇形**。
    isStrip ? react4.createElement(
      "div",
      {
        className: `dshWbSeam${seamOpen ? " is-open" : ""}`,
        "data-wb-seam": "",
        "data-wb-seam-open": seamOpen ? "1" : "0",
        "data-wb-seam-count": String(modes.length),
        role: "group",
        "aria-label": T.seamLabel,
        title: T.seamHint,
        onMouseEnter: () => setSeamOpen(true),
        onMouseLeave: () => setSeamOpen(false),
        onFocus: () => setSeamOpen(true),
        onBlur: () => setSeamOpen(false)
      },
      react4.createElement("div", { className: "dshWbSeamGrip", "aria-hidden": "true" }, "⋮"),
      modes.length === 0 ? react4.createElement("div", { className: "dshWbSeamEmpty", "data-wb-seam-empty": "" }, T.seamEmpty) : react4.createElement(
        "div",
        { className: "dshWbSeamFan", "data-wb-seam-fan": "" },
        modes.map((mode, i) => {
          const mid = (modes.length - 1) / 2;
          const t = mid === 0 ? 0 : (i - mid) / mid;
          const out = Math.round(SEAM_FAN_OUT * (1 - Math.abs(t)));
          const y = Math.round((i - mid) * SEAM_FAN_GAP);
          const delay = i * SEAM_FAN_STAGGER;
          return react4.createElement(
            "button",
            {
              key: mode.id,
              type: "button",
              className: `dshWbSeamItem${mode.active ? " is-active" : ""}`,
              style: { "--wb-out": String(out), "--wb-y": String(y), "--wb-delay": `${delay}ms` },
              onClick: () => void switchMode(registry2, mode.id),
              title: T.switchTo(mode.label),
              "data-wb-seam-mode": mode.id,
              "data-wb-seam-out": String(out),
              "data-wb-seam-y": String(y),
              "data-wb-seam-delay": String(delay)
            },
            react4.createElement("span", { className: "dshWbSeamGlyph", "aria-hidden": "true" }, mode.label.slice(0, 1) || "·"),
            react4.createElement("span", { className: "dshWbSeamText" }, mode.label)
          );
        })
      )
    ) : null,
    toast
  );
}

// plugin/workbench/src/client/Dock.js
var react5 = __toESM(require("react"), 1);
function useDockInset(open2, width) {
  react5.useEffect(() => {
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
    return react5.createElement(
      "button",
      {
        type: "button",
        className: "dshWbDockRail",
        onClick: () => setDockOpen(true),
        title: T.dockOpen(chosen.label),
        "aria-label": T.dockOpen(chosen.label),
        "data-wb-dock-rail": ""
      },
      react5.createElement("span", { className: "dshWbDockRailText" }, chosen.label)
    );
  }
  const DockView = chosen.view;
  const onGripDown = (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = dockWidth2;
    const onMove = (moveEvent) => setDockWidth(startWidth + (startX - moveEvent.clientX));
    const onUp = () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  };
  return react5.createElement(
    "aside",
    {
      className: "dshWbDock",
      style: { width: `${dockWidth2}px` },
      "data-wb-dock": chosen.id,
      "aria-label": T.dockTitle(chosen.label)
    },
    react5.createElement("div", {
      className: "dshWbDockGrip",
      onMouseDown: onGripDown,
      title: T.dockResize,
      "aria-hidden": "true",
      "data-wb-dock-resize": ""
    }),
    react5.createElement(
      "div",
      { className: "dshWbDockHead" },
      candidates.length > 1 ? react5.createElement(
        "select",
        {
          className: "dshWbDockPick",
          value: chosen.id,
          onChange: (event) => setDockModeId(event.target.value),
          title: T.dockPick,
          "data-wb-dock-pick": ""
        },
        candidates.map((c) => react5.createElement("option", { key: c.id, value: c.id }, c.label))
      ) : react5.createElement("span", { className: "dshWbDockTitle" }, chosen.label),
      react5.createElement(
        "button",
        { type: "button", className: "dshWbDockClose", onClick: () => setDockOpen(false), title: T.dockCollapse, "data-wb-dock-close": "" },
        "⟩"
      )
    ),
    react5.createElement("div", { className: "dshWbDockBody", "data-wb-dock-body": chosen.id }, react5.createElement(DockView))
  );
}

// plugin/workbench/src/client/Settings.js
var react6 = __toESM(require("react"), 1);
function WorkbenchSettings() {
  const { modes, active } = useWorkbench();
  const [host, setHost] = react6.useState({ loading: true });
  react6.useEffect(() => {
    let dead = false;
    void fetchState().then((result) => {
      if (!dead) setHost({ loading: false, ...result });
    });
    return () => {
      dead = true;
    };
  }, []);
  const activeLabel = (modes.find((m) => m.id === active) || {}).label || T.activeNone;
  return react6.createElement(
    "div",
    { className: "dshWbSet", "data-wb-settings": "" },
    react6.createElement(
      "div",
      { className: "dshWbSetCard" },
      react6.createElement("div", { className: "dshWbSetTitle" }, T.settings),
      react6.createElement("div", { className: "dshWbSetLine" }, T.settingsIntro),
      react6.createElement("div", { className: "dshWbSetMuted" }, T.settingsDegraded)
    ),
    react6.createElement(
      "div",
      { className: "dshWbSetCard" },
      react6.createElement("div", { className: "dshWbSetTitle" }, T.settingsModes),
      modes.length === 0 ? react6.createElement("div", { className: "dshWbSetMuted", "data-wb-settings-none": "" }, T.settingsNone) : react6.createElement(
        "div",
        { className: "dshWbSetLine", style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
        modes.map(
          (mode) => react6.createElement(
            "span",
            { key: mode.id, className: `dshWbSetChip${mode.active ? " is-active" : ""}`, "data-wb-settings-mode": mode.id },
            mode.label
          )
        )
      )
    ),
    react6.createElement(
      "div",
      { className: "dshWbSetCard" },
      react6.createElement("div", { className: "dshWbSetTitle" }, T.settingsActive),
      react6.createElement("div", { className: "dshWbSetLine", "data-wb-settings-active": active || "" }, activeLabel)
    ),
    react6.createElement(
      "div",
      { className: "dshWbSetCard" },
      react6.createElement("div", { className: "dshWbSetTitle" }, T.settingsHost),
      react6.createElement("div", { className: "dshWbSetMuted" }, T.settingsHostHint),
      host.loading ? react6.createElement("div", { className: "dshWbSetMuted" }, "…") : host.ok ? react6.createElement(
        "div",
        { className: "dshWbSetLine", "data-wb-settings-rev": String(host.state?.revision ?? "") },
        T.settingsRevision(host.state?.revision ?? 0),
        host.state?.activeModeId ? ` · ${host.state.activeModeId}` : ""
      ) : react6.createElement("div", { className: "dshWbSetLine", "data-wb-settings-error": host.error || "error" }, T.settingsUnreachable)
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
  try {
    ctx.inject(["sessions"], (scope) => setSessions(scope?.sessions || null));
  } catch (err) {
    console.warn("[workbench] sessions inject failed:", err);
  }
  try {
    ctx.inject(["uiConversation"], (scope) => setChatService(scope?.uiConversation || null));
  } catch (err) {
    console.warn("[workbench] uiConversation inject failed:", err);
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
