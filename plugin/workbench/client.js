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
var react9 = __toESM(require("react"), 1);

// plugin/workbench/src/client/registry.js
var MOUNTS = /* @__PURE__ */ new Set(["overlay", "panel"]);
var MODULE_ASSISTANT_DEFAULT = 360;
var MODULE_ASSISTANT_MIN = 260;
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
    // **拼接视图**（2026-10-13，用户拍板 A）：比 dock 重——拼到长条右侧时要的是模式的**完整界面**，
    // 不是"顺眼看一下"的轻视图。两种给法，二选一：
    //   · `mount(container)`：模式把自己的界面渲染进工具台给的容器（portal / 挂 DOM 都行），
    //     返回 dispose（收起拼接时调用）。**单实例模式（如写作台）走这条**——它有自己的 React 根
    //     与编辑会话，再挂一份会打架（坞视图注释里就写着这条教训）。
    //   · `view`：直接给运行时组件引用（可自由重挂的模式走这条）。
    // `assistant`（可选，2026-10-13 用户："左边是写作模式的 agent 对话窗口——我说的是「写作助手」"）：
    // 声明"这个模式还需要一块**助手对话窗口**"（壳会把它排在长条**左侧**，`kind=assistant`）。
    // 模式自己在那个窗口里按 URL 片段渲染助手界面，所以这里只需要一个宽度。
    splice: descriptor.splice && typeof descriptor.splice === "object" && (typeof descriptor.splice.mount === "function" || descriptor.splice.view) ? {
      label: descriptor.splice.label,
      mount: typeof descriptor.splice.mount === "function" ? descriptor.splice.mount : null,
      view: descriptor.splice.view || null,
      // **模式自己说要多宽**（可选）：写作台那种按宽窗设计的界面在 420px 里会被裁，
      // 所以让它自己声明期望宽度；壳侧仍会按屏幕夹到合法区间（2026-10-13 实机看上裁剪后加）。
      width: Number.isFinite(descriptor.splice.width) ? Math.max(280, Math.min(1200, Math.round(descriptor.splice.width))) : null,
      // 助手窗口（可选）：真值即"这个模式要一块助手对话窗口"，宽度可声明（默认 360）
      assistant: descriptor.splice.assistant && typeof descriptor.splice.assistant === "object" ? {
        width: Number.isFinite(descriptor.splice.assistant.width) ? Math.max(MODULE_ASSISTANT_MIN, Math.min(1200, Math.round(descriptor.splice.assistant.width))) : MODULE_ASSISTANT_DEFAULT
      } : descriptor.splice.assistant === true ? { width: MODULE_ASSISTANT_DEFAULT } : null,
      order: Number.isFinite(descriptor.splice.order) ? descriptor.splice.order : 100
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
    hasTile: mode.tile !== null,
    // 能不能拼（2026-10-13）：给 splice 视图的模式优先，退而求其次用坞视图（旧的"轻视图"路径）。
    hasSplice: mode.splice !== null
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
  function spliceViewOf(id) {
    const key = id === null || id === void 0 ? null : String(id).trim();
    const mode = key === null ? null : modes.get(key);
    if (!mode || !mode.splice) return null;
    return {
      id: mode.id,
      label: normalizeLabel(mode.splice.label) || mode.id,
      order: mode.splice.order,
      mount: mode.splice.mount,
      view: mode.splice.view,
      width: mode.splice.width,
      // 声明了"splice.assistant"的模式：拼接时**同时**开一块助手窗口（壳把它排长条左侧）
      assistant: mode.splice.assistant
    };
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
  return { registerMode, list, setActive, adopt, getActive, has, size, subscribe: subscribe2, resolveLabel, contextOf, handoff, lastHandoff, dockViewOf, tileViewOf, spliceViewOf };
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
  ".dshWbChatSession{min-width:0;flex:none;display:flex;align-items:baseline;gap:10px;}",
  ".dshWbChatSessionTitle{flex:1;min-width:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
  ".dshWbChatHint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}",
  ".dshWbChatBody{flex:1;min-height:0;display:flex;flex-direction:column;}",
  ".dshWbChatBody.is-empty{justify-content:center;align-items:center;text-align:center;padding:0 8px;}",
  // 状态条（输入框下那条窄条）：三指标 + 上下文进度条 + 模型名；读不到就如实写"还没数据"+原因（title）
  // （类名 2026-10-13 从 `.dshWbStrip*` 改成 `.dshWbMeter*`，对齐原型 `.meter` 的形状）
  ".dshWbMeter{flex:none;display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:8px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1);}",
  ".dshWbMeterItem{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;cursor:default;}",
  // 真聊天瓷砖（只读转录）：**气泡**布局（原型 `.msg.user` / `.msg.agent`），长文截断，绝不撑破窄窗
  ".dshWbChatLog{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;overflow:auto;margin-top:4px;padding-right:2px;}",
  ".dshWbMsg{display:flex;flex-direction:column;gap:2px;max-width:86%;}",
  ".dshWbMsg.is-user{align-self:flex-end;align-items:flex-end;}",
  ".dshWbMsgWho{padding:0 2px;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary);}",
  ".dshWbMsgBody{padding:7px 10px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:17px;white-space:pre-wrap;word-break:break-word;}",
  ".dshWbMsg.is-user .dshWbMsgBody{border-bottom-right-radius:4px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}",
  ".dshWbMsg.is-assistant .dshWbMsgBody{border-bottom-left-radius:4px;}",
  ".dshWbMsg.is-error .dshWbMsgBody{border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);}",
  // 长文折叠：默认三行（`-webkit-line-clamp`），展开后自然撑开
  ".dshWbMsgBody.is-clamped{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}",
  ".dshWbMsgMore{align-self:flex-start;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:10px;line-height:14px;padding:1px 2px;cursor:pointer;text-decoration:underline;text-underline-offset:2px;}",
  ".dshWbMsg.is-user .dshWbMsgMore{align-self:flex-end;}",
  ".dshWbMsgMore:hover{color:var(--dsw-alias-label-primary);}",
  ".dshWbMsg.is-detail .dshWbMsgBody{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);}",
  // 工具活动行（结构化 tool）：一行压扁，不套气泡；失败用错误色 + 文字说明（不只靠颜色）
  ".dshWbAct{display:flex;align-items:center;gap:6px;padding:2px 2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);}",
  ".dshWbActIcon{flex:none;opacity:.8;}",
  ".dshWbActName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code,monospace);}",
  ".dshWbActPhase{flex:none;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);}",
  ".dshWbAct.is-error{color:var(--dsw-alias-state-error-primary);}",
  ".dshWbAct.is-error .dshWbActPhase{background:transparent;border:1px solid var(--dsw-alias-state-error-primary);}",
  // 流式态：一个会呼吸的点 + "正在生成…" + 实时 tok/s（尊重 reduced-motion）
  ".dshWbStreaming{display:flex;align-items:center;gap:8px;padding:2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);}",
  ".dshWbStreamDot{flex:none;width:7px;height:7px;border-radius:999px;background:var(--dsw-alias-brand-primary);animation:dshWbPulse 1.1s ease-in-out infinite;}",
  ".dshWbStreamSpeed{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;}",
  "@keyframes dshWbPulse{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}",
  "@media (prefers-reduced-motion:reduce){.dshWbStreamDot{animation:none;opacity:1;}}",
  // 输入区（长条底部，原型 `.composer`）：文本域与发送**同框**，`+` 在左侧圆形
  ".dshWbComposer{flex:none;display:flex;gap:8px;align-items:flex-end;margin-top:8px;}",
  ".dshWbInputWrap{position:relative;flex:1;min-width:0;display:flex;}",
  ".dshWbComposerInput{flex:1;min-width:0;resize:none;padding:7px 62px 7px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:17px;}",
  ".dshWbComposerInput:disabled{opacity:.55;cursor:not-allowed;}",
  ".dshWbSendIn{position:absolute;right:6px;bottom:6px;padding:5px 12px;border:1px solid transparent;border-radius:9px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font:inherit;font-size:12px;cursor:pointer;}",
  ".dshWbSendIn:disabled{opacity:.5;cursor:not-allowed;}",
  // 输入区下方的次要出口（「回到完整会话」从整行大按钮收成一条小链接，别再抢视觉）
  ".dshWbChatFoot{flex:none;display:flex;justify-content:flex-end;margin-top:6px;}",
  ".dshWbLinkBtn{border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;line-height:16px;padding:2px 4px;cursor:pointer;text-decoration:underline;text-underline-offset:2px;}",
  ".dshWbLinkBtn:hover{color:var(--dsw-alias-label-primary);}",
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
  // **顶栏就是拖拽区**（2026-10-13 无边框重建之后）：主窗 `frame:false` 没有标题栏，
  // 用户自然会抓"工具台"这一行来拖窗口；不设 `-webkit-app-region:drag` 就是"拖不动"。
  // 里面的按钮/标题必须显式 `no-drag`，否则被拖拽区吃掉点击。
  ".dshWbBar{-webkit-app-region:drag;}",
  '.dshWbBar button,.dshWbBar a,.dshWbBar input,.dshWbBar select,.dshWbBar [role="button"]{-webkit-app-region:no-drag;}',
  ".dshWbBarTitle{flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
  // 长条形态的收紧：412px 宽里 20/24 的内边距太奢侈；对话列撑满、输入区钉底（原型是一列到底）
  '.dshWbHome[data-wb-shape="strip"] .dshWbHomePanel{padding:10px 12px;gap:8px;}',
  '.dshWbHome[data-wb-shape="strip"] .dshWbChat{width:auto;flex:1;min-height:0;border:none;border-radius:0;background:transparent;padding:0;}',
  '.dshWbHome[data-wb-shape="strip"] .dshWbHomeBody{flex-direction:column;gap:0;}',
  // **拼接时改回横排**（2026-10-13 实机抓到：长条那套竖排没被覆盖 ⇒ 对话列占满整宽、拼接区被挤到下面）。
  // 对话列按壳报的"长条宽度"钉住，拼接区占剩下的宽度——两者相加正好等于窗口宽度。
  '.dshWbHome[data-wb-shape="strip"] .dshWbHomeBody.is-spliced{flex-direction:row;gap:10px;}',
  '.dshWbHome[data-wb-shape="strip"] .dshWbHomeBody.is-spliced .dshWbChat{flex:0 0 var(--dsh-wb-strip-w,420px);}',
  '.dshWbHome[data-wb-shape="strip"] .dshWbChatSessionTitle{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
  // 右下角给**第三方浮标**留位（PALIS 主题面板的角标是 `shell.overlay` 上的固定浮层，会压住
  // 发送钮与状态条最右端——2026-10-13 目检截图实拍）。这不是我们的元素，只能自己让开。
  '.dshWbHome[data-wb-shape="strip"] .dshWbComposer,.dshWbHome[data-wb-shape="strip"] .dshWbMeter{padding-right:76px;}',
  // 拼接区（长条右侧那些列）：窗口已由壳加宽，这里只把列摆进去（总宽来自 spliceWidth）
  ".dshWbHomeBody.is-spliced{gap:10px;}",
  ".dshWbSpliceWrap{flex:none;min-width:0;display:flex;gap:8px;overflow:hidden;}",
  ".dshWbSplice{position:relative;flex:none;min-width:0;display:flex;flex-direction:column;gap:8px;padding-left:10px;border-left:1px solid var(--dsw-alias-border-l1);overflow:auto;}",
  // 左缘拖拽把手：贴在面板左边界上，鼠标移到附近才显形（平时别抢视觉）
  ".dshWbSpliceGrip{position:absolute;left:-3px;top:0;bottom:0;width:7px;cursor:col-resize;background:transparent;}",
  ".dshWbSpliceGrip:hover{background:var(--dsw-alias-brand-primary);opacity:.5;}",
  ".dshWbSpliceHead{flex:none;display:flex;align-items:center;gap:8px;}",
  ".dshWbSpliceLabel{flex:1;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
  ".dshWbSpliceBody{flex:1;min-height:0;overflow:auto;}",
  // 拼接内容容器：模式自己把界面挂进来（portal / appendChild），这里只负责给它一块占满的空间。
  // `position:relative` 是给模式的全屏壳用的——写作台的 `.dshWmRoot` 是 `position:fixed`，
  // 内嵌时它自己会改成 `absolute;inset:0`（见写作模式 writing-css.js 的 `:where(.dshWbSpliceHost)`）。
  ".dshWbSpliceHost{position:relative;flex:1;min-height:100%;display:flex;flex-direction:column;}",
  ".dshWbSeamItem.is-spliced{border-color:var(--dsw-alias-brand-primary);}",
  ".dshWbBarBtn{flex:none;width:26px;height:22px;display:flex;align-items:center;justify-content:center;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;}",
  ".dshWbBarBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}",
  // 「退出」用文字（不是字形）：它是回主界面的唯一出口，得一眼看懂（2026-10-13 项目所有者问过"怎么回去"）
  ".dshWbBarBtn.is-exit{width:auto;padding:0 10px;font-size:12px;border-color:var(--dsw-alias-border-l2);}",
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
  // 2026-10-13 第二版按原型 `.edge`/`.fan` 重做：**整条右缘**是悬停区（原型 26px 宽整高），
  // 中间一道小指示条；项是 **46px 圆形图标钮**，标签在图标**左侧**悬停才出现（原型在右侧，
  // 但那是画在窗外的；我们收在窗内，标签只能往左），状态点是图标右下角的小徽标。
  ".dshWbSeam{position:fixed;top:0;right:0;width:26px;height:100%;z-index:2210;pointer-events:auto;}",
  // 展开时把**命中区撑到覆盖扇形**（26 + 弹出 58 + 图标 46 + 余量）：否则鼠标从窄条往图标挪的中途
  // 就出了命中区，`mouseleave` 一触发扇形就没了（2026-10-13 项目所有者实报）。JS 那边还有一层宽限延迟。
  ".dshWbSeam.is-open{width:132px;}",
  ".dshWbSeamGrip{position:absolute;top:50%;right:6px;width:4px;height:44px;transform:translateY(-50%);border-radius:999px;background:var(--dsw-alias-label-tertiary);opacity:.45;transition:opacity .16s ease-out,background .16s ease-out;}",
  ".dshWbSeam:hover .dshWbSeamGrip,.dshWbSeam.is-open .dshWbSeamGrip{opacity:1;background:var(--dsw-alias-brand-primary);}",
  ".dshWbSeamFan{position:absolute;right:14px;top:50%;width:0;height:0;}",
  // 圆形图标钮：46×46（原型同尺寸）；从轴心**旋转 + 弹出**（角度由 --wb-a 给），逐颗错峰
  ".dshWbSeamItem{position:absolute;right:0;top:0;width:46px;height:46px;margin-top:-23px;padding:0;display:grid;place-items:center;border:1px solid var(--dsw-alias-border-l2);border-radius:50%;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer;opacity:0;visibility:hidden;pointer-events:none;transform:rotate(var(--wb-a)) translateX(0);transition:transform .2s cubic-bezier(.25,.9,.3,1.15),opacity .2s ease-out,visibility .2s;}",
  ".dshWbSeam.is-open .dshWbSeamItem{opacity:1;visibility:visible;pointer-events:auto;transform:rotate(var(--wb-a)) translateX(calc(var(--wb-out) * -1px));transition-delay:var(--wb-delay);}",
  ".dshWbSeamItem:hover,.dshWbSeamItem:focus-visible{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}",
  ".dshWbSeamItem.is-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}",
  ".dshWbSeamGlyph{font-size:19px;line-height:1;pointer-events:none;}",
  // 状态点（原型 `.st`）：图标**右下角的小徽标**，只有"已拼接/当前"才显示（原型 `.joined .st`）
  ".dshWbSeamSt{position:absolute;right:-1px;bottom:-1px;width:11px;height:11px;border-radius:50%;border:2px solid var(--dsw-alias-bg-base);background:var(--dsw-alias-label-tertiary);display:none;}",
  ".dshWbSeamItem.is-spliced .dshWbSeamSt,.dshWbSeamItem.is-active .dshWbSeamSt{display:block;background:var(--dsw-alias-brand-primary);}",
  // 标签：图标**左侧**（窗外画不了，所以反过来），悬停/聚焦才浮出来
  ".dshWbSeamText{position:absolute;right:calc(100% + 9px);top:50%;transform:translateY(-50%);padding:4px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:16px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .14s ease-out;}",
  ".dshWbSeamItem:hover .dshWbSeamText,.dshWbSeamItem:focus-visible .dshWbSeamText{opacity:1;}",
  ".dshWbSeamTag{margin-left:6px;color:var(--dsw-alias-label-tertiary);font-size:11px;font-style:normal;}",
  ".dshWbSeamItem.is-spliced .dshWbSeamTag,.dshWbSeamItem.is-active .dshWbSeamTag{color:var(--dsw-alias-brand-primary);}",
  ".dshWbSeamEmpty{position:absolute;right:34px;top:50%;transform:translateY(-50%);padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;opacity:0;visibility:hidden;transition:opacity .16s ease-out,visibility .16s;}",
  ".dshWbSeam.is-open .dshWbSeamEmpty{opacity:1;visibility:visible;}",
  // 状态条（原型 `.meter`）：三指标 + 上下文进度条 + 模型名
  ".dshWbMeter{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;}",
  ".dshWbMeterItem{white-space:nowrap;}",
  ".dshWbMeterBar{flex:none;width:56px;height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;}",
  ".dshWbMeterBar i{display:block;height:100%;background:var(--dsw-alias-brand-primary);border-radius:999px;}",
  ".dshWbMeterModel{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px;}",
  // 小条的紧凑状态条（原型 `.mini` 就是"同一条数据换个尺寸"）：贴底、更小字号、去掉进度条
  ".dshWbMeter.is-compact{flex:none;margin:0;padding:6px 14px 8px;border-top:1px solid var(--dsw-alias-border-l1);gap:4px 8px;font-size:10px;line-height:14px;}",
  // 输入区左侧「+」与其弹层（原型 `.plus` / `.sheet`）
  ".dshWbComposer{position:relative;display:flex;align-items:flex-end;gap:8px;}",
  ".dshWbPlus{flex:none;width:30px;height:30px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;line-height:1;cursor:pointer;}",
  ".dshWbPlus:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}",
  ".dshWbSheet{position:absolute;left:0;bottom:38px;z-index:2;display:flex;flex-direction:column;gap:2px;min-width:180px;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 24px rgba(0,0,0,.28);}",
  ".dshWbSheetCap{padding:2px 6px;font-size:11px;color:var(--dsw-alias-label-tertiary);}",
  ".dshWbSheetItem{display:block;width:100%;padding:6px 8px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;text-align:left;cursor:pointer;}",
  ".dshWbSheetItem:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}",
  ".dshWbSheetItem.is-active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}",
  ".dshWbSheetItem:disabled{opacity:.5;cursor:not-allowed;}",
  ".dshWbSheetSep{height:1px;margin:6px 4px;background:var(--dsw-alias-border-l1);}",
  ".dshWbSheetEmpty{padding:4px 8px;font-size:12px;color:var(--dsw-alias-label-tertiary);}",
  // 对话里的日期分隔（原型 `.day`）
  ".dshWbChatDay{align-self:center;padding:2px 10px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:11px;color:var(--dsw-alias-label-tertiary);}"
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
  // 拼接（2026-10-13，用户拍板 A：接缝点模式 = **拼到右侧**；进全屏走宽窗主屏的「进入」）
  spliceTo: (label) => `把${label}拼到右侧（要它的全屏界面就回宽窗主屏点「进入」）`,
  spliceTitle: (label) => `${label} · 已拼接`,
  spliceCollapse: "收起这块拼接",
  spliceResize: "拖拽调整拼接宽度（往左拖变宽）",
  spliceNoView: (label) => `${label}还没提供可嵌入视图，拼不了；回宽窗主屏点「进入」可以用它的完整界面。`,
  spliceFailed: (err) => `拼接没成功（${err}）——窗口没变宽，界面保持原样。`,
  spliced: "已拼接",
  // 拖开的那块：接缝上标「已分离」（2026-10-13 交互细节——分离与拼接要看得出区别）
  detached: "已分离",
  activeNone: "未进入任何模式",
  exit: "退出模式",
  // 长条自绘顶栏三钮（2026-10-12 拍板语义：`—` 收小条 / `⎋` 退出工具台并还原窗口 / `✕` 走既有关窗语义）
  btnMini: (back) => back ? "展开成长条" : "收成小条",
  btnBackWide: "回到宽窗主屏（工作区选择）——只把窗口变宽，不退出工具台",
  btnSettings: "打开外壳设置",
  btnExit: "退出工具台，回到主界面（窗口还原成正常大小；有模式在场会先问它的守卫）",
  btnExitShort: "退出",
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
var react6 = __toESM(require("react"), 1);

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
var react4 = __toESM(require("react"), 1);

// plugin/workbench/src/client/use-session.js
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
  const selection = asObject(v?.modelSelection);
  const model = String(selection?.name || selection?.model || selection?.id || "").trim() || null;
  return { tokensPerSecond, cacheHitPercent, contextPercent, pressureTokens, contextWindow, model };
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
function tokens(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value >= 1e4) return `${Math.round(value / 1e3)}k`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return String(value);
}
function formatTelemetry(t) {
  const speed = t?.tokensPerSecond !== null && t?.tokensPerSecond !== void 0 ? { text: `⚡ ${round(t.tokensPerSecond)} tok/s`, title: "解码速度：输出 token ÷ 解码墙钟时间（内核 sessionStats 投影）" } : { text: "⚡ —", title: "还没有解码数据：这条会话还没流式输出过，所以算不出解码速度" };
  const cache = t?.cacheHitPercent !== null && t?.cacheHitPercent !== void 0 ? { text: `缓存命中 ${round(t.cacheHitPercent)}%`, title: "缓存命中率：命中的输入 token ÷ 全部输入 token（内核 tokenUsage 投影）" } : { text: "缓存 —", title: "还没有用量数据：这条会话还没发过带用量的请求，所以算不出命中率" };
  const used = tokens(t?.pressureTokens);
  const window_ = tokens(t?.contextWindow);
  const context = t?.contextPercent !== null && t?.contextPercent !== void 0 ? {
    // 原型形状：`上下文 12.3k/128k`；窗口大小缺席时退回百分比（不编造分母）
    text: used && window_ ? `上下文 ${used}/${window_}` : `上下文 ${round(t.contextPercent)}%`,
    ratio: Math.max(0, Math.min(1, t.contextPercent / 100)),
    title: `占用 ${t.pressureTokens} / 窗口 ${t.contextWindow} token（内核 contextPressure 投影）`
  } : {
    text: "上下文 —",
    ratio: 0,
    title: "还没有上下文数据：内核还没给出占用或窗口大小，所以显示不了用量"
  };
  const model = t?.model ? { text: t.model, title: "当前会话选用的模型（内核 modelSelection 投影）" } : null;
  return { speed, cache, context, model };
}

// plugin/workbench/src/client/use-session.js
function readSessionSnapshot(sessions2) {
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
function useSessionSnapshot(sessions2 = getSessions()) {
  const [snap, setSnap] = react3.useState(() => readSessionSnapshot(sessions2));
  react3.useEffect(() => {
    const store = sessions2?.list;
    if (!store || typeof store.subscribe !== "function") return void 0;
    const sync = () => setSnap(readSessionSnapshot(sessions2));
    try {
      return store.subscribe(sync);
    } catch {
      return void 0;
    }
  }, [sessions2]);
  const first = snap && snap.ids.length > 0 ? snap.byId[snap.ids[0]] : null;
  const sessionId = snap && snap.ids.length > 0 ? snap.ids[0] : null;
  return { sessions: sessions2, snap, first, sessionId, running: Boolean(first?.running) };
}
function useSessionTelemetry(sessions2, sessionId) {
  const [values, setValues] = react3.useState(null);
  const [source, setSource] = react3.useState("no-session");
  react3.useEffect(() => {
    const watch = watchSessionProjections(sessions2, sessionId, setValues);
    setSource(watch.source);
    return watch.dispose;
  }, [sessionId, sessions2]);
  return { metrics: formatTelemetry(telemetryOf(values)), source, values };
}
function TelemetryMeter({ metrics, source, values, compact = false }) {
  if (!metrics) return null;
  return react3.createElement(
    "div",
    {
      className: `dshWbMeter${compact ? " is-compact" : ""}`,
      "data-wb-strip": "",
      "data-wb-meter": compact ? "compact" : "",
      "data-wb-telemetry": source,
      // 自查用：句柄投影里**到底有哪些键**（真内核上一眼能分清"还没送到"与"根本没这个键"）
      "data-wb-telemetry-keys": Object.keys(values || {}).sort().join(",")
    },
    react3.createElement("span", { className: "dshWbMeterItem", title: metrics.speed.title, "data-wb-metric": "speed" }, metrics.speed.text),
    react3.createElement("span", { className: "dshWbMeterItem", title: metrics.cache.title, "data-wb-metric": "cache" }, metrics.cache.text),
    react3.createElement("span", { className: "dshWbMeterItem", title: metrics.context.title, "data-wb-metric": "context" }, metrics.context.text),
    compact ? null : (
      // 进度条只在**有数**时画：没有数据时留一条灰杠看着像坏掉的控件（2026-10-13 目检反馈）
      (metrics.context.ratio || 0) > 0 ? react3.createElement(
        "span",
        { className: "dshWbMeterBar", "data-wb-meter-bar": "", title: metrics.context.title, "aria-hidden": "true" },
        react3.createElement("i", {
          style: { width: `${Math.round((metrics.context.ratio || 0) * 100)}%` },
          "data-wb-meter-fill": String(Math.round((metrics.context.ratio || 0) * 100))
        })
      ) : null
    ),
    metrics.model ? react3.createElement("span", { className: "dshWbMeterModel", title: metrics.model.title, "data-wb-metric": "model" }, metrics.model.text) : null
  );
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
var LONG_TEXT = 180;
function ConversationTile({ onBack, modes = [], onPickMode }) {
  const sessions2 = getSessions();
  const { snap, first, sessionId, running } = useSessionSnapshot(sessions2);
  const { metrics, source: telemetrySource, values: projValues } = useSessionTelemetry(sessions2, sessionId);
  const [sheetOpen, setSheetOpen] = react4.useState(false);
  const [expanded, setExpanded] = react4.useState({});
  const [transcript, setTranscript] = react4.useState({ source: "no-session", messages: [] });
  react4.useEffect(() => {
    const watch = watchTranscript(
      sessions2,
      getChatService(),
      sessionId,
      (next) => setTranscript({ source: next.source, messages: tailMessages(next.messages) })
    );
    setTranscript({ source: watch.source, messages: tailMessages(watch.messages) });
    return watch.dispose;
  }, [sessionId, sessions2]);
  const actLine = (m) => {
    const tool = m.tool;
    if (!tool) return null;
    const phase = tool.phase === "result" ? tool.isError ? "失败" : "完成" : "进行中";
    return react4.createElement(
      "div",
      { key: m.key, className: `dshWbAct${tool.isError ? " is-error" : ""}`, "data-wb-chat-act": tool.phase || "call" },
      react4.createElement("span", { className: "dshWbActIcon", "aria-hidden": "true" }, "⚙"),
      react4.createElement("span", { className: "dshWbActName", title: tool.argsRaw || "" }, tool.name || "工具"),
      react4.createElement("span", { className: "dshWbActPhase" }, phase)
    );
  };
  const log = transcript.messages.length ? react4.createElement(
    "div",
    { className: "dshWbChatLog", "data-wb-chat-log": "", "data-wb-chat-source": transcript.source },
    // 日期分隔（原型里是 `.day`）：v1 只写"今天"——不编造历史日期，等真转录带时间戳再说
    react4.createElement("div", { className: "dshWbChatDay", "data-wb-chat-day": "" }, "今天"),
    // 气泡（原型 `.msg.user` / `.msg.agent`）：作者那一侧自己，助手/活动/出错在另一侧；
    // 工具调用走活动行（上面 actLine），不套气泡
    transcript.messages.map((m) => {
      if (m.kind === "detail" && m.tool) return actLine(m);
      const full = String(m.text || "");
      const isLong = full.length > LONG_TEXT;
      const open2 = expanded[m.key] === true;
      return react4.createElement(
        "div",
        { key: m.key, className: `dshWbMsg is-${m.kind}`, "data-wb-chat-line": m.kind },
        m.kind !== "user" ? react4.createElement("span", { className: "dshWbMsgWho" }, WHO[m.kind] || "会话") : null,
        react4.createElement(
          "span",
          {
            className: `dshWbMsgBody${isLong && !open2 ? " is-clamped" : ""}`,
            "data-wb-msg-open": isLong ? open2 ? "1" : "0" : null
          },
          full
        ),
        // 长文折叠：默认三行，点一下展开全文（比原来"硬截断 160 字"诚实——一个字都不丢）
        isLong ? react4.createElement(
          "button",
          {
            type: "button",
            className: "dshWbMsgMore",
            onClick: () => setExpanded((prev) => ({ ...prev, [m.key]: !open2 })),
            "data-wb-msg-toggle": open2 ? "collapse" : "expand"
          },
          open2 ? "收起" : `展开全文（${full.length} 字）`
        ) : null
      );
    }),
    // 流式态：正在生成时把这一行挂在最下面（带实时 tok/s，读不到就不显示那一段）
    running ? react4.createElement(
      "div",
      { className: "dshWbStreaming", "data-wb-chat-streaming": "" },
      react4.createElement("span", { className: "dshWbStreamDot", "aria-hidden": "true" }),
      react4.createElement("span", null, "正在生成…"),
      metrics.speed.text.includes("还没数据") ? null : react4.createElement("span", { className: "dshWbStreamSpeed", "data-wb-chat-stream-speed": "" }, metrics.speed.text)
    ) : null
  ) : null;
  const logHint = transcript.source === "pending" && !transcript.messages.length ? react4.createElement(
    "div",
    { className: "dshWbChatHint", "data-wb-chat-log-empty": "pending" },
    "正在读取这条会话的内容…"
  ) : !transcript.messages.length && sessionId && (transcript.source === "none" || transcript.source === "no-service") ? react4.createElement(
    "div",
    { className: "dshWbChatHint", "data-wb-chat-log-empty": transcript.source },
    "这条会话的内容暂时读不到（内核会话图通道不可用）。点下面「回到完整会话」看全文。"
  ) : (
    // 通道在位、只是**还没有消息**：也要说明，否则窄条中间就是一大片空白（2026-10-13 截图抓到）。
    // 正在生成时不摆这句——那时该出现的是下面的流式态，不是"还没有消息"。
    !transcript.messages.length && sessionId && !running ? react4.createElement(
      "div",
      { className: "dshWbChatHint", "data-wb-chat-log-empty": "no-messages" },
      "这条会话还没有消息。在下面发一条，或点「回到完整会话」看历史。"
    ) : null
  );
  const strip = react4.createElement(TelemetryMeter, { metrics, source: telemetrySource, values: projValues });
  const title = first?.displayTitle ? String(first.displayTitle) : "";
  const surface = sendSurface(sessions2, sessionId);
  const draftRef = react4.useRef(null);
  const [sending, setSending] = react4.useState(false);
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
  const sheet = sheetOpen ? react4.createElement(
    "div",
    { className: "dshWbSheet", "data-wb-sheet": "", role: "menu" },
    react4.createElement("div", { className: "dshWbSheetCap" }, "上传"),
    react4.createElement(
      "button",
      {
        type: "button",
        className: "dshWbSheetItem",
        disabled: true,
        title: "附件上传还没接（内核的文件通道尚未接入工具台）",
        "data-wb-sheet-upload": ""
      },
      "📎 上传文件"
    ),
    react4.createElement("div", { className: "dshWbSheetSep" }),
    react4.createElement("div", { className: "dshWbSheetCap" }, "更多工具"),
    modes.length === 0 ? react4.createElement("div", { className: "dshWbSheetEmpty" }, T.seamEmpty) : modes.map(
      (m) => react4.createElement(
        "button",
        {
          key: m.id,
          type: "button",
          className: `dshWbSheetItem${m.active ? " is-active" : ""}`,
          onClick: () => {
            setSheetOpen(false);
            onPickMode?.(m.id);
          },
          "data-wb-sheet-mode": m.id
        },
        m.label
      )
    )
  ) : null;
  const composer = first ? react4.createElement(
    react4.Fragment,
    null,
    react4.createElement(
      "div",
      { className: "dshWbComposer", "data-wb-composer-row": "" },
      react4.createElement(
        "button",
        {
          type: "button",
          className: "dshWbPlus",
          title: "上传文件和更多工具",
          "aria-expanded": sheetOpen ? "true" : "false",
          onClick: () => setSheetOpen((v) => !v),
          "data-wb-plus": ""
        },
        "+"
      ),
      sheet,
      // 输入框与发送**同框**（原型把发送放在输入框内右下），textarea 右侧留出按钮的位置
      react4.createElement(
        "div",
        { className: "dshWbInputWrap" },
        react4.createElement("textarea", {
          className: "dshWbComposerInput",
          ref: draftRef,
          // 未发送正文记在模块级（见 ui-store.js 的 getChatDraft）：`—` 收小条会卸载这一整块，
          // 只靠 DOM 就会把作者打到一半的字吞掉。刻意不落盘。
          defaultValue: getChatDraft(),
          onChange: (event) => setChatDraft(event.target.value),
          rows: 2,
          placeholder: surface.canSend ? "发消息……" : "现在还不能在这里发送",
          disabled: !surface.canSend,
          title: surface.canSend ? "Enter 发送，Shift+Enter 换行" : surface.reason,
          "data-wb-composer": "",
          onKeyDown: (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }
        }),
        react4.createElement(
          "button",
          {
            type: "button",
            className: "dshWbSendIn",
            disabled: !surface.canSend || sending,
            title: surface.canSend ? "发送（Enter）" : surface.reason,
            onClick: () => void send(),
            "data-wb-send": ""
          },
          sending ? "发送中…" : "发送"
        )
      )
    ),
    // 状态条在输入框**下方**（原型顺序：`.composer` → `.meter`）；「回到完整会话」上移到会话标题行
    first ? strip : null
  ) : null;
  return react4.createElement(
    "div",
    { className: "dshWbChatCard", "data-wb-chat-card": "", "data-wb-chat-source": transcript.source },
    !sessions2 ? react4.createElement("div", { className: "dshWbChatHint", "data-wb-chat-empty": "noservice" }, T.chatNoService) : !snap ? react4.createElement("div", { className: "dshWbChatHint", "data-wb-chat-empty": "unreadable" }, T.chatNoService) : !first ? react4.createElement("div", { className: "dshWbChatHint", "data-wb-chat-empty": "empty" }, T.chatEmpty) : react4.createElement(
      // 会话标题行：标题在左、「回到完整会话」在右（2026-10-13 从底部右下角上移过来——
      // 掉在最下面既乱又和右下角的状态条/角标打架）
      "div",
      { className: "dshWbChatSession", "data-wb-chat-session": "" },
      react4.createElement("div", { className: "dshWbChatSessionTitle", title, "data-wb-chat-title": "" }, title),
      react4.createElement(
        "button",
        { type: "button", className: "dshWbLinkBtn", onClick: () => void onBack(), "data-wb-chat-back": "" },
        T.chatBack
      )
    ),
    // 对话主体：有消息就是可滚动的气泡列；没消息就把说明**居中**（贴在底部会显得像页脚）
    react4.createElement(
      "div",
      {
        className: `dshWbChatBody${transcript.messages.length ? "" : " is-empty"}`,
        "data-wb-chat-body": transcript.messages.length ? "filled" : "empty"
      },
      log,
      logHint
    ),
    // 输入区（含状态条与次要出口）钉在**底部**：上面是对话，下面这一块不参与滚动
    composer
  );
}

// plugin/workbench/src/client/Splice.js
var react5 = __toESM(require("react"), 1);
function SplicePanelBody({ view }) {
  const hostRef = react5.useRef(null);
  const mount = view && typeof view.mount === "function" ? view.mount : null;
  const viewId = view ? view.id : null;
  react5.useEffect(() => {
    if (!mount || !hostRef.current) return void 0;
    let dispose = null;
    try {
      dispose = mount(hostRef.current);
    } catch (err) {
      console.warn("[workbench] splice mount failed:", err);
    }
    return () => {
      try {
        if (typeof dispose === "function") dispose();
      } catch (err) {
        console.warn("[workbench] splice dispose failed:", err);
      }
    };
  }, [viewId, mount]);
  if (!view) return null;
  if (view.view && !mount) return react5.createElement(view.view);
  return react5.createElement("div", {
    className: "dshWbSpliceHost",
    "data-wb-splice-host": viewId,
    "data-wb-splice-source": mount ? "mount" : view.view ? "view" : "dock-view",
    ref: hostRef
  });
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
async function requestSplice(width) {
  const bridge = getShapeBridge();
  if (!bridge || typeof bridge.setWorkbenchSplice !== "function") return { ok: false, error: "no-splice-bridge" };
  try {
    const result = await bridge.setWorkbenchSplice(Number(width));
    return result && typeof result === "object" ? result : { ok: false, error: "bad-response" };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}
async function openModuleWindow(modeId, width, kind) {
  const bridge = getShapeBridge();
  if (!bridge || typeof bridge.openModuleWindow !== "function") return { ok: false, error: "no-module-bridge" };
  try {
    const result = await bridge.openModuleWindow(String(modeId), Number(width) || void 0, kind === "assistant" ? "assistant" : "main");
    return result && typeof result === "object" ? result : { ok: false, error: "bad-response" };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}
async function closeModuleWindow(modeId) {
  const bridge = getShapeBridge();
  if (!bridge || typeof bridge.closeModuleWindow !== "function") return { ok: false, error: "no-module-bridge" };
  try {
    const result = await bridge.closeModuleWindow(String(modeId));
    return result && typeof result === "object" ? result : { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}
function hasModuleWindowBridge(globalThisRef = typeof window === "undefined" ? null : window) {
  const bridge = globalThisRef && globalThisRef.dshShell;
  return Boolean(bridge && typeof bridge.openModuleWindow === "function" && typeof bridge.closeModuleWindow === "function");
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
async function openSettings(globalThisRef = typeof window === "undefined" ? null : window) {
  const bridge = globalThisRef && globalThisRef.dshShell;
  if (!bridge || typeof bridge.openSettings !== "function") return { ok: false, error: "no-shell-bridge" };
  try {
    const result = await bridge.openSettings();
    return result && typeof result === "object" ? result : { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
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
var SPLICE_WIDTH = 420;
var SPLICE_DRAG_MIN = 120;
var SPLICE_MIN = 280;
var SEAM_FAN_R = 58;
var SEAM_FAN_SPREAD = 34;
var SEAM_FAN_STAGGER = 45;
var SEAM_CLOSE_GRACE_MS = 240;
var NOTICE_MS = 6e3;
function contextLabelOf(registry2, id) {
  const c = registry2.contextOf(id);
  if (!c) return "";
  return c.title || c.project || c.doc || c.path || "";
}
function WorkbenchChrome() {
  const { modes, active, context, lastHandoff, open: open2, notice: notice2, registry: registry2 } = useWorkbench();
  const panelRef = react6.useRef(null);
  const seenHandoffAt = react6.useRef(0);
  react6.useEffect(() => {
    if (!lastHandoff || lastHandoff.at === seenHandoffAt.current) return;
    seenHandoffAt.current = lastHandoff.at;
    const from = registry2.resolveLabel(lastHandoff.from);
    const to = registry2.resolveLabel(lastHandoff.to);
    if (lastHandoff.delivered) setNotice({ kind: "info", text: `已把「${from}」的引用交给「${to}」` });
    else setNotice({ kind: "warn", text: `「${to}」还没有接收端，引用没有送出去` });
  }, [lastHandoff, registry2]);
  react6.useEffect(() => {
    if (!notice2) return void 0;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice2]);
  const [shape, setShape] = react6.useState("");
  const sessionState = useSessionSnapshot();
  const telemetry = useSessionTelemetry(sessionState.sessions, sessionState.sessionId);
  const [seamOpen, setSeamOpen] = react6.useState(false);
  const seamCloseTimer = react6.useRef(null);
  const openSeam = react6.useCallback(() => {
    if (seamCloseTimer.current) {
      window.clearTimeout(seamCloseTimer.current);
      seamCloseTimer.current = null;
    }
    setSeamOpen(true);
  }, []);
  const scheduleCloseSeam = react6.useCallback(() => {
    if (seamCloseTimer.current) window.clearTimeout(seamCloseTimer.current);
    seamCloseTimer.current = window.setTimeout(() => {
      seamCloseTimer.current = null;
      setSeamOpen(false);
    }, SEAM_CLOSE_GRACE_MS);
  }, []);
  react6.useEffect(
    () => () => {
      if (seamCloseTimer.current) window.clearTimeout(seamCloseTimer.current);
    },
    []
  );
  const [spliced, setSpliced] = react6.useState([]);
  const [spliceWidth, setSpliceWidth] = react6.useState(0);
  const [stripWidth, setStripWidth] = react6.useState(SPLICE_WIDTH);
  const [modules, setModules] = react6.useState([]);
  const moduleIds = modules.map((m) => m.modeId);
  const rememberShape = (state) => {
    const w = Number(state && state.stripWidth);
    if (Number.isFinite(w) && w > 0) setStripWidth(w);
  };
  const panelsRef = react6.useRef([]);
  react6.useEffect(() => {
    panelsRef.current = spliced;
  }, [spliced]);
  const askedForStrip = react6.useRef(false);
  react6.useEffect(() => {
    const bridge = getShapeBridge();
    if (!bridge || typeof bridge.onWorkbenchShape !== "function") return void 0;
    const off = bridge.onWorkbenchShape((state) => {
      if (state && Array.isArray(state.modules)) setModules(state.modules);
    });
    return () => {
      if (typeof off === "function") off();
    };
  }, []);
  react6.useEffect(() => {
    let cancelled = false;
    const apply2 = async (next) => {
      if (!getShapeBridge()) {
        setShape("unsupported");
        return;
      }
      const result = await requestShape(next);
      if (cancelled) return;
      rememberShape(result);
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
  react6.useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (open2 || !getShapeBridge()) return;
      const now = await readShape();
      rememberShape(now);
      if (cancelled || !now || now.shape === "normal" || now.shape === void 0) return;
      if (Number(now.spliceWidth) > 0) await requestSplice(0);
      const result = await requestShape("normal");
      if (!cancelled && result.ok) setShape("normal");
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  react6.useEffect(() => {
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
  const toast = notice2 ? react6.createElement(
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
  if (!open2) return react6.createElement(react6.Fragment, null, toast);
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
  const totalSpliceOf = (panels) => panels.reduce((sum, it) => sum + (Number(it.width) || SPLICE_WIDTH), 0);
  const applySpliceWidth = async (panels) => {
    const want = panels.length ? Math.max(SPLICE_MIN, totalSpliceOf(panels)) : 0;
    const result = await requestSplice(want);
    if (!result.ok) return result;
    rememberShape(result);
    setSpliceWidth(Number(result.spliceWidth) || want);
    return result;
  };
  const spliceMode = async (id) => {
    if (hasModuleWindowBridge()) {
      if (moduleIds.includes(id)) {
        const closed = await closeModuleWindow(id);
        if (Array.isArray(closed?.modules)) setModules(closed.modules);
        return closed;
      }
      const view2 = registry2.spliceViewOf(id) || registry2.dockViewOf(id);
      const wantWidth = Number(view2 && view2.width) > 0 ? Number(view2.width) : SPLICE_WIDTH;
      const result2 = await openModuleWindow(id, wantWidth);
      if (!result2.ok) {
        setNotice({ kind: "error", text: T.spliceFailed(result2.error) });
        return result2;
      }
      let modules2 = Array.isArray(result2.modules) ? result2.modules : modules2;
      if (view2 && view2.assistant) {
        const assistant = await openModuleWindow(id, Number(view2.assistant.width) || void 0, "assistant");
        if (Array.isArray(assistant?.modules)) modules2 = assistant.modules;
      }
      setModules(modules2);
      return result2;
    }
    if (spliced.some((it) => it.id === id)) return unsplice(id);
    const view = registry2.spliceViewOf(id) || registry2.dockViewOf(id);
    if (!view) {
      setNotice({ kind: "info", text: T.spliceNoView(registry2.resolveLabel(id)) });
      return;
    }
    const width = Number(view.width) > 0 ? Number(view.width) : SPLICE_WIDTH;
    const next = [{ id, width }, ...spliced];
    const result = await applySpliceWidth(next);
    if (!result.ok) {
      setNotice({ kind: "error", text: T.spliceFailed(result.error) });
      return;
    }
    setSpliced(next);
  };
  const unsplice = async (id) => {
    const next = spliced.filter((it) => it.id !== id);
    await applySpliceWidth(next);
    setSpliced(next);
  };
  const collapseSplice = async () => {
    if (!spliced.length) return { ok: true };
    setSpliced([]);
    setSpliceWidth(0);
    return requestSplice(0);
  };
  const dragSplice = (id) => (event) => {
    const panel = spliced.find((it) => it.id === id);
    if (!panel) return;
    const startX = event.clientX;
    const startWidth = Number(panel.width) || SPLICE_WIDTH;
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
    }
    let last = 0;
    const onMove = (moveEvent) => {
      const want = Math.max(SPLICE_DRAG_MIN, Math.round(startWidth + (startX - moveEvent.clientX)));
      const now = Date.now();
      if (now - last < 80) return;
      last = now;
      const nextPanels = panelsRef.current.map((it) => it.id === id ? { ...it, width: want } : it);
      panelsRef.current = nextPanels;
      void requestSplice(Math.max(SPLICE_MIN, totalSpliceOf(nextPanels)));
      setSpliced(nextPanels);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      void applySpliceWidth(panelsRef.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const exitWorkbench = async () => {
    await collapseSplice();
    if (active) {
      const result = await exitMode(registry2);
      if (!result.ok) return;
    }
    setOpen(false);
  };
  const backToWide = async () => {
    await collapseSplice();
    const result = await requestShape("normal");
    if (result.ok) setShape("normal");
  };
  const bar = !isStrip ? null : react6.createElement(
    "div",
    { className: "dshWbBar", "data-wb-bar": "", "data-wb-bar-shape": shape },
    react6.createElement(
      "button",
      {
        type: "button",
        className: "dshWbBarBtn",
        onClick: () => void backToWide(),
        title: T.btnBackWide,
        "aria-label": T.btnBackWide,
        "data-wb-btn": "back"
      },
      "←"
    ),
    react6.createElement(
      "span",
      { className: "dshWbBarTitle", "data-wb-bar-who": "" },
      `${T.entry}${active ? ` · ${activeLabel}` : ""}`
    ),
    react6.createElement(
      "button",
      {
        type: "button",
        className: "dshWbBarBtn",
        onClick: () => openSettings(),
        title: T.btnSettings,
        "aria-label": T.btnSettings,
        "data-wb-btn": "settings"
      },
      "⚙"
    ),
    react6.createElement(
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
    react6.createElement(
      "button",
      {
        type: "button",
        // 2026-10-13：字形 `⎋` 没人认得出（项目所有者直接问"怎么回到主界面"）→ 换成**文字**「退出」。
        // 这一钮是"回到内核主界面"的唯一出口（← 只是回宽窗主屏，✕ 是关窗进托盘），必须一眼看懂。
        className: "dshWbBarBtn is-exit",
        onClick: () => void exitWorkbench(),
        title: T.btnExit,
        "aria-label": T.btnExit,
        "data-wb-btn": "exit"
      },
      T.btnExitShort
    ),
    react6.createElement(
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
    return react6.createElement(
      react6.Fragment,
      null,
      react6.createElement(
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
        react6.createElement(
          "div",
          { className: "dshWbMiniLine", "data-wb-mini-line": "" },
          (active && contextLabel ? `${activeLabel} · ${contextLabel}` : activeLabel) || T.chatOpenHint
        ),
        // 小条也显示**同一份**状态数据（原型 `.mini` 的语义）：紧凑版，去掉进度条
        react6.createElement(TelemetryMeter, {
          metrics: telemetry.metrics,
          source: telemetry.source,
          values: telemetry.values,
          compact: true
        })
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
      return react6.createElement(
        "div",
        { key: mode.id, className: `dshWbTile${mode.active ? " is-active" : ""}`, "data-wb-tile": mode.id },
        react6.createElement(
          "div",
          { className: "dshWbTileHead" },
          react6.createElement("span", { className: "dshWbTileLabel" }, tile.label),
          mode.active ? react6.createElement("span", { className: "dshWbRowMark" }, T.current) : null,
          react6.createElement(
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
        react6.createElement("div", { className: "dshWbTileBody" }, react6.createElement(TileView))
      );
    }
    return react6.createElement(
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
      react6.createElement("span", { className: "dshWbModeGlyph", "aria-hidden": "true" }, mode.label.slice(0, 1) || "·"),
      react6.createElement(
        "span",
        { className: "dshWbModeBody" },
        react6.createElement("span", { className: "dshWbModeLabel" }, mode.label),
        ctxLabel ? react6.createElement("span", { className: "dshWbModeCtx", title: ctxLabel }, ctxLabel) : react6.createElement("span", { className: "dshWbModeCtx" }, T.tileEmpty)
      ),
      mode.active ? react6.createElement("span", { className: "dshWbRowMark" }, T.current) : null
    );
  });
  const splicePanels = spliced.map((panel) => {
    const view = registry2.spliceViewOf(panel.id) || registry2.dockViewOf(panel.id);
    if (!view) return null;
    return react6.createElement(
      "section",
      {
        key: panel.id,
        className: "dshWbSplice",
        "data-wb-splice": panel.id,
        "data-wb-splice-width": String(panel.width || SPLICE_WIDTH),
        style: { flexBasis: `${Number(panel.width) || SPLICE_WIDTH}px` },
        "aria-label": T.spliceTitle(view.label)
      },
      react6.createElement("div", {
        className: "dshWbSpliceGrip",
        title: T.spliceResize,
        "aria-hidden": "true",
        "data-wb-splice-grip": panel.id,
        onPointerDown: dragSplice(panel.id)
      }),
      react6.createElement(
        "div",
        { className: "dshWbSpliceHead" },
        react6.createElement("span", { className: "dshWbSpliceLabel" }, T.spliceTitle(view.label)),
        react6.createElement(
          "button",
          {
            type: "button",
            className: "dshWbBarBtn",
            title: T.spliceCollapse,
            "aria-label": T.spliceCollapse,
            onClick: () => void unsplice(panel.id),
            "data-wb-splice-collapse": panel.id
          },
          "✕"
        )
      ),
      react6.createElement(
        "div",
        { className: "dshWbSpliceBody", "data-wb-splice-body": "" },
        react6.createElement(SplicePanelBody, { view })
      )
    );
  }).filter(Boolean);
  const splicePanel = !hasModuleWindowBridge() && splicePanels.length ? react6.createElement(
    "div",
    { className: "dshWbSpliceWrap", "data-wb-splice-wrap": String(splicePanels.length), style: { flexBasis: `${spliceWidth || SPLICE_WIDTH}px` } },
    splicePanels
  ) : null;
  return react6.createElement(
    "div",
    {
      className: "dshWbHome",
      onKeyDown,
      "data-wb-switcher": "",
      "data-wb-shape": shape || "none",
      // 长条自己的宽度（壳报的）：拼接时用它把对话列钉住
      style: { "--dsh-wb-strip-w": `${stripWidth}px` }
    },
    bar,
    react6.createElement(
      "div",
      { className: "dshWbHomePanel", ref: panelRef, role: "dialog", "aria-label": T.homeTitle },
      // 长条形态**不摆第二层标题**（原型只有一条 `.topbar`：← / 工作台·当前 / ⚙ / 三钮）——
      // 两层标题在 412px 宽里纯属浪费；主屏（宽窗）才需要"创作工具台 + 关闭"这一行。
      isStrip ? null : react6.createElement(
        "div",
        { className: "dshWbHead" },
        react6.createElement("span", { className: "dshWbTitle" }, T.homeTitle),
        react6.createElement("button", { type: "button", className: "dshWbClose", onClick: () => setOpen(false), "data-wb-close": "" }, T.close)
      ),
      isStrip ? null : react6.createElement("div", { className: "dshWbHint" }, T.homeHint),
      active ? react6.createElement(
        "div",
        { className: "dshWbCtx", "data-wb-context": active },
        `${T.contextNow}：${activeLabel}${contextLabel ? ` · ${contextLabel}` : ""}`
      ) : null,
      react6.createElement(
        "div",
        { className: `dshWbHomeBody${splicePanel ? " is-spliced" : ""}`, "data-wb-home-body": splicePanel ? "spliced" : "plain" },
        react6.createElement(
          "aside",
          { className: "dshWbChat", "data-wb-chat": "", "aria-label": T.chatTitle },
          // 长条下不摆"对话"小标题（顶栏已说明这是什么）；宽窗主屏才需要这一行分区标题
          isStrip ? null : react6.createElement("div", { className: "dshWbChatHead" }, T.chatTitle),
          react6.createElement(ConversationTile, {
            onBack: backToChat,
            modes,
            onPickMode: (id) => void spliceMode(id)
            // 长条下的模式入口 = 拼接（用户拍板 A）
          })
        ),
        // 长条形态：**对话优先**，瓷砖格让位给右缘接缝（原型 v2.2）；主屏（normal）仍保留瓷砖格。
        // 拼接时右侧多一列：模式的**可嵌入视图**（第一版就用它的 `dock` 视图）——窗口已由壳加宽。
        isStrip ? splicePanel : modes.length === 0 ? react6.createElement(
          "div",
          { className: "dshWbEmpty", "data-wb-empty": "" },
          react6.createElement("div", null, T.empty),
          react6.createElement("div", null, T.emptyHint)
        ) : react6.createElement("section", { className: "dshWbTiles", "data-wb-tiles": "" }, tiles)
      ),
      active ? react6.createElement(
        "div",
        { className: "dshWbFoot" },
        react6.createElement("button", { type: "button", className: "dshWbBtn", onClick: () => void exitMode(registry2), "data-wb-exit": "" }, T.exit)
      ) : null
    ),
    // 接缝呼出·扇形（原型 `.edge`/`.fan`：**以接缝为轴心按角度排开**，逐颗错峰弹出）。
    // 几何在 JS 里算好、用 CSS 变量摆位——探针直接读 `data-wb-seam-a`（角度）与 `-delay`。
    // 窗外画不了（窗口边界是硬的，plan §12-9 已选"收在窗口内贴右缘"），所以是**窗内扇形**：
    // 角度照原型（中间 0°、两端 ±34°），半径固定；图标与标签反向旋转，保证文字始终是正的。
    isStrip ? react6.createElement(
      "div",
      {
        className: `dshWbSeam${seamOpen ? " is-open" : ""}`,
        // **接缝站在"拼合处"**：拼了东西之后，它就是长条与拼接区之间那条缝（原型 v2.2 的规则：
        // "已有模式拼着时，鼠标放在长条窗与模式窗口的拼合处"）。没拼时贴窗口右缘。
        // 2026-10-13 实机抓到：原来一直贴在窗口最右缘，拼完之后扇形跑到了面板外侧，形式不对。
        style: { right: spliceWidth > 0 ? `${spliceWidth}px` : 0 },
        "data-wb-seam": "",
        "data-wb-seam-at": spliceWidth > 0 ? "junction" : "edge",
        "data-wb-seam-open": seamOpen ? "1" : "0",
        "data-wb-seam-count": String(modes.length),
        role: "group",
        "aria-label": T.seamLabel,
        title: T.seamHint,
        /**
         * 开合带**宽限延迟**（2026-10-13 项目所有者实报："图标呼出时，鼠标还没挪过去就消失了"）。
         * 原因是几何：扇形从 26px 宽的右缘条往里弹出 58px，鼠标从条上往图标走**中途就出了条**，
         * `mouseleave` 立刻收起。两处一起兜：① 展开时命中区撑宽到覆盖扇形（CSS `.is-open`）；
         * ② 离开后等 `SEAM_CLOSE_GRACE_MS` 再收，进到图标/重新进条上就取消这个定时器。
         */
        onMouseEnter: () => openSeam(),
        onMouseLeave: () => scheduleCloseSeam(),
        onFocus: () => openSeam(),
        onBlur: () => scheduleCloseSeam()
      },
      react6.createElement("div", { className: "dshWbSeamGrip", "aria-hidden": "true" }),
      modes.length === 0 ? react6.createElement("div", { className: "dshWbSeamEmpty", "data-wb-seam-empty": "" }, T.seamEmpty) : react6.createElement(
        "div",
        { className: "dshWbSeamFan", "data-wb-seam-fan": "" },
        modes.map((mode, i) => {
          const mid = (modes.length - 1) / 2;
          const step = modes.length > 1 ? Math.min(SEAM_FAN_SPREAD, SEAM_FAN_SPREAD * 2 / (modes.length - 1)) : 0;
          const a = Math.round((mid - i) * step);
          const delay = i * SEAM_FAN_STAGGER;
          const isSpliced = moduleIds.includes(mode.id) || spliced.some((it) => it.id === mode.id);
          const modeDetached = modules.some((m) => m.modeId === mode.id && m.anchored === false);
          return react6.createElement(
            "button",
            {
              key: mode.id,
              type: "button",
              className: `dshWbSeamItem${mode.active ? " is-active" : ""}${isSpliced ? " is-spliced" : ""}`,
              style: { "--wb-a": `${a}deg`, "--wb-out": String(SEAM_FAN_R), "--wb-delay": `${delay}ms` },
              // 用户拍板 A：接缝点一下 = **拼到右侧**（进模式全屏走宽窗主屏的瓷砖「进入」）
              onClick: () => void spliceMode(mode.id),
              title: T.spliceTo(mode.label),
              "data-wb-seam-mode": mode.id,
              "data-wb-seam-a": String(a),
              "data-wb-seam-out": String(SEAM_FAN_R),
              "data-wb-seam-delay": String(delay)
            },
            // 图标与标签**反向旋转**：扇形是转出来的，但字要正着读（原型里图标跟着斜，这里改好一点）
            react6.createElement(
              "span",
              { className: "dshWbSeamGlyph", "aria-hidden": "true", style: { transform: `rotate(${-a}deg)` } },
              mode.label.slice(0, 1) || "·"
            ),
            // 状态点（原型 `.st`）：图标右下角的小徽标，只有"已拼接/当前"才显示
            react6.createElement("span", {
              className: `dshWbSeamSt${mode.active ? " is-active" : ""}`,
              "data-wb-seam-st": mode.active ? "active" : isSpliced ? "spliced" : "ready",
              "aria-hidden": "true"
            }),
            react6.createElement(
              "span",
              { className: "dshWbSeamText", style: { transform: `translateY(-50%) rotate(${-a}deg)` } },
              mode.label,
              isSpliced ? react6.createElement(
                "em",
                // **分离与拼接要看得出来**（2026-10-13 交互细节）：壳的记账里有 `anchored`，
                // 拖开的那块标「已分离」——否则用户不知道它还算不算拼着。
                { className: `dshWbSeamTag${modeDetached ? " is-detached" : ""}`, "data-wb-seam-tag": modeDetached ? "detached" : "spliced" },
                modeDetached ? T.detached : T.spliced
              ) : mode.active ? react6.createElement("em", { className: "dshWbSeamTag", "data-wb-seam-tag": "active" }, T.current) : null
            )
          );
        })
      )
    ) : null,
    toast
  );
}

// plugin/workbench/src/client/Dock.js
var react7 = __toESM(require("react"), 1);
function useShellShape() {
  const [shape, setShape] = react7.useState("");
  react7.useEffect(() => {
    const bridge = getShapeBridge();
    if (!bridge) return void 0;
    let cancelled = false;
    void (async () => {
      const now = await readShape();
      if (!cancelled && now && now.shape) setShape(now.shape);
    })();
    const off = typeof bridge.onWorkbenchShape === "function" ? bridge.onWorkbenchShape((state) => {
      if (state && state.shape) setShape(state.shape);
    }) : null;
    return () => {
      cancelled = true;
      if (typeof off === "function") off();
    };
  }, []);
  return shape;
}
function useDockInset(open2, width) {
  react7.useEffect(() => {
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
  const shape = useShellShape();
  const inStrip = shape === "strip" || shape === "mini";
  const candidates = modes.filter((m) => m.hasDock && m.id !== active).map((m) => registry2.dockViewOf(m.id)).filter(Boolean).sort((a, b) => a.order === b.order ? a.id.localeCompare(b.id, "en") : a.order - b.order);
  useDockInset(!inStrip && dockOpen2 && candidates.length > 0, dockWidth2);
  if (inStrip || candidates.length === 0) return null;
  const chosen = candidates.find((c) => c.id === dockModeId2) || candidates[0];
  if (!dockOpen2) {
    return react7.createElement(
      "button",
      {
        type: "button",
        className: "dshWbDockRail",
        onClick: () => setDockOpen(true),
        title: T.dockOpen(chosen.label),
        "aria-label": T.dockOpen(chosen.label),
        "data-wb-dock-rail": ""
      },
      react7.createElement("span", { className: "dshWbDockRailText" }, chosen.label)
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
  return react7.createElement(
    "aside",
    {
      className: "dshWbDock",
      style: { width: `${dockWidth2}px` },
      "data-wb-dock": chosen.id,
      "aria-label": T.dockTitle(chosen.label)
    },
    react7.createElement("div", {
      className: "dshWbDockGrip",
      onMouseDown: onGripDown,
      title: T.dockResize,
      "aria-hidden": "true",
      "data-wb-dock-resize": ""
    }),
    react7.createElement(
      "div",
      { className: "dshWbDockHead" },
      candidates.length > 1 ? react7.createElement(
        "select",
        {
          className: "dshWbDockPick",
          value: chosen.id,
          onChange: (event) => setDockModeId(event.target.value),
          title: T.dockPick,
          "data-wb-dock-pick": ""
        },
        candidates.map((c) => react7.createElement("option", { key: c.id, value: c.id }, c.label))
      ) : react7.createElement("span", { className: "dshWbDockTitle" }, chosen.label),
      react7.createElement(
        "button",
        { type: "button", className: "dshWbDockClose", onClick: () => setDockOpen(false), title: T.dockCollapse, "data-wb-dock-close": "" },
        "⟩"
      )
    ),
    react7.createElement("div", { className: "dshWbDockBody", "data-wb-dock-body": chosen.id }, react7.createElement(DockView))
  );
}

// plugin/workbench/src/client/Settings.js
var react8 = __toESM(require("react"), 1);
function WorkbenchSettings() {
  const { modes, active } = useWorkbench();
  const [host, setHost] = react8.useState({ loading: true });
  react8.useEffect(() => {
    let dead = false;
    void fetchState().then((result) => {
      if (!dead) setHost({ loading: false, ...result });
    });
    return () => {
      dead = true;
    };
  }, []);
  const activeLabel = (modes.find((m) => m.id === active) || {}).label || T.activeNone;
  return react8.createElement(
    "div",
    { className: "dshWbSet", "data-wb-settings": "" },
    react8.createElement(
      "div",
      { className: "dshWbSetCard" },
      react8.createElement("div", { className: "dshWbSetTitle" }, T.settings),
      react8.createElement("div", { className: "dshWbSetLine" }, T.settingsIntro),
      react8.createElement("div", { className: "dshWbSetMuted" }, T.settingsDegraded)
    ),
    react8.createElement(
      "div",
      { className: "dshWbSetCard" },
      react8.createElement("div", { className: "dshWbSetTitle" }, T.settingsModes),
      modes.length === 0 ? react8.createElement("div", { className: "dshWbSetMuted", "data-wb-settings-none": "" }, T.settingsNone) : react8.createElement(
        "div",
        { className: "dshWbSetLine", style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
        modes.map(
          (mode) => react8.createElement(
            "span",
            { key: mode.id, className: `dshWbSetChip${mode.active ? " is-active" : ""}`, "data-wb-settings-mode": mode.id },
            mode.label
          )
        )
      )
    ),
    react8.createElement(
      "div",
      { className: "dshWbSetCard" },
      react8.createElement("div", { className: "dshWbSetTitle" }, T.settingsActive),
      react8.createElement("div", { className: "dshWbSetLine", "data-wb-settings-active": active || "" }, activeLabel)
    ),
    react8.createElement(
      "div",
      { className: "dshWbSetCard" },
      react8.createElement("div", { className: "dshWbSetTitle" }, T.settingsHost),
      react8.createElement("div", { className: "dshWbSetMuted" }, T.settingsHostHint),
      host.loading ? react8.createElement("div", { className: "dshWbSetMuted" }, "…") : host.ok ? react8.createElement(
        "div",
        { className: "dshWbSetLine", "data-wb-settings-rev": String(host.state?.revision ?? "") },
        T.settingsRevision(host.state?.revision ?? 0),
        host.state?.activeModeId ? ` · ${host.state.activeModeId}` : ""
      ) : react8.createElement("div", { className: "dshWbSetLine", "data-wb-settings-error": host.error || "error" }, T.settingsUnreachable)
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
