/**
 * GENERATED FILE — do not hand-edit.
 * Source: plugin/writing-mode/src/client/entry.js (+ ../shared, features/…)
 * Build:  node scripts/build-writing-client.mjs   (or npm run build:writing)
 * Bundle: esbuild (CJS) wrapped as window.__ModuleLoader__.load factory body
 */
window.__ModuleLoader__.load({
  id: "@dsh-local/writing-mode",
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

// plugin/writing-mode/src/client/entry.js
var entry_exports = {};
__export(entry_exports, {
  __draftConflict: () => companionDraftConflict,
  __draftDirty: () => companionDraftDirty,
  __draftStatus: () => companionDraftStatus,
  api: () => api,
  apply: () => apply,
  companionRows: () => companionRows,
  createEditorSession: () => createEditorSession,
  createHarnessAdapter: () => createHarnessAdapter,
  getDraftStatus: () => getDraftStatus,
  inject: () => inject,
  loadCompanionDraft: () => loadCompanionDraft,
  name: () => name,
  newOperationToken: () => newOperationToken,
  persistCompanionDraft: () => persistCompanionDraft,
  resolveDraftConflict: () => resolveDraftConflict,
  retryDraftConflictRemote: () => retryDraftConflictRemote,
  subscribeDraftStatus: () => subscribeDraftStatus
});
module.exports = __toCommonJS(entry_exports);
var react6 = __toESM(require("react"), 1);
var jsx13 = __toESM(require("react/jsx-runtime"), 1);

// plugin/writing-mode/src/shared/editor-session.js
function createEditorSession(io, recovered) {
  let state = { path: null, content: "", revision: null, edit: 0, dirty: false, status: "idle", error: "", loading: false };
  let generation = 0;
  let saving = null;
  let creating = false;
  const listeners = /* @__PURE__ */ new Set();
  const notify = (patch) => {
    state = { ...state, ...patch };
    try {
      io.backup?.(state.dirty ? { path: state.path, content: state.content, revision: state.revision } : recovered || null);
    } catch {
      state = { ...state, error: "恢复草稿暂存失败，请保存后再退出。" };
    }
    for (const fn of listeners) fn(state);
  };
  const errorText = (err) => {
    const code = err?.message || String(err);
    return code === "document-conflict" ? "文件已在别处修改。当前文字已保留，请另存新版后再比较。" : code === "revision-required" ? "读写协议已更新，请刷新页面后重新打开文稿。" : code === "historical-version" ? "这是历史稿，请另存新版。" : `操作失败，当前文字已保留：${code}`;
  };
  async function result(promise) {
    const data = await promise;
    if (!data?.ok || !data.doc) throw new Error(data?.error || "invalid-response");
    return data.doc;
  }
  const adopt = (doc) => notify({ path: doc.path, content: doc.content, revision: doc.revision, edit: state.edit + 1, dirty: false, status: "idle", loading: false, error: "" });
  const session = {
    get: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    change(value) {
      if (state.loading || !state.path) return;
      notify({ content: typeof value === "function" ? value(state.content) : value, edit: state.edit + 1, dirty: true, status: "idle", error: "" });
    },
    async refresh() {
      if (!state.path || state.loading || saving || creating) return false;
      const snapshot = state;
      const token = generation;
      try {
        const doc = await result(io.read(snapshot.path));
        if (token !== generation || state.revision !== snapshot.revision || state.edit !== snapshot.edit || saving || creating) return false;
        if (doc.revision === state.revision) return true;
        if (state.dirty) notify({ status: "error", error: "文件已在别处修改。当前输入已保留，请另存新版后比较。" });
        else adopt(doc);
        return true;
      } catch {
        return false;
      }
    },
    async flush() {
      if (saving) {
        const ok2 = await saving;
        return ok2 ? session.flush() : false;
      }
      if (!state.dirty || !state.path) return true;
      const snapshot = state;
      notify({ status: "saving", error: "" });
      saving = (async () => {
        try {
          const doc = await result(io.save({ path: snapshot.path, content: snapshot.content, revision: snapshot.revision }));
          const dirty = state.edit !== snapshot.edit;
          notify({ revision: doc.revision, dirty, status: dirty ? "idle" : "saved" });
          io.saved?.(doc);
          return true;
        } catch (err) {
          notify({ status: "error", error: errorText(err) });
          return false;
        }
      })();
      const ok = await saving;
      saving = null;
      return ok && state.dirty ? session.flush() : ok;
    },
    async open(target) {
      if (creating) return false;
      if (!target || state.path === target && !state.error) return true;
      const token = ++generation;
      notify({ loading: true });
      if (!await session.flush()) {
        if (token === generation) notify({ loading: false });
        return false;
      }
      if (token !== generation) return false;
      try {
        const doc = await result(io.read(target));
        if (token !== generation) return false;
        adopt(doc);
        if (recovered?.path === doc.path) {
          const draft = recovered;
          recovered = null;
          if (draft.content !== doc.content) notify({ content: draft.content, revision: draft.revision, dirty: true, edit: state.edit + 1, status: "error", error: "已恢复未保存文字。请保存；如原文件已变化，请另存新版。" });
        }
        return true;
      } catch (err) {
        if (token === generation) {
          if (!state.path && recovered?.path === target) {
            notify({ path: target, content: recovered.content, revision: recovered.revision, dirty: true });
            recovered = null;
          }
          notify({ loading: false, status: "error", error: errorText(err) });
        }
        return false;
      }
    },
    async create(root, title) {
      if (creating) return false;
      const token = ++generation;
      notify({ loading: true });
      if (!await session.flush()) {
        if (token === generation) notify({ loading: false });
        return false;
      }
      if (token !== generation) return false;
      creating = true;
      try {
        const doc = await result(io.save({ root, title, content: "# " + title + "\n\n", revision: null }));
        io.saved?.(doc);
        if (token !== generation) return false;
        adopt(doc);
        return true;
      } catch (err) {
        if (token === generation) notify({ loading: false, status: "error", error: errorText(err) });
        return false;
      } finally {
        creating = false;
      }
    },
    async version() {
      if (!state.path || state.loading) return false;
      creating = true;
      ++generation;
      notify({ loading: true });
      if (saving) await saving;
      const snapshot = state;
      try {
        const doc = await result(io.version({ path: snapshot.path, content: snapshot.content }));
        adopt(doc);
        io.saved?.(doc);
        return true;
      } catch (err) {
        notify({ loading: false, status: "error", error: errorText(err) });
        return false;
      } finally {
        creating = false;
      }
    },
    async close() {
      if (creating) return false;
      ++generation;
      notify({ loading: true });
      const ok = await session.flush();
      notify({ loading: false });
      return ok;
    }
  };
  return session;
}

// plugin/writing-mode/src/shared/context-builder.js
var DEFAULT_MEMORY_BUDGET = 6e3;
var INJECTABLE_KINDS = ["fact", "preference"];
var LABEL_OF = { fact: "设定", preference: "偏好", "open-question": "待定问题" };
function isInjectable(item) {
  return Boolean(item) && item.status === "confirmed" && INJECTABLE_KINDS.includes(item.kind);
}
function isPinnable(item) {
  return Boolean(item) && item.status === "confirmed" && Boolean(LABEL_OF[item.kind]);
}
function selectMemory(items, pinnedIds, budget = DEFAULT_MEMORY_BUDGET) {
  const list = Array.isArray(items) ? items : [];
  const pinned = new Set((pinnedIds || []).map((id) => String(id)));
  const selected = [];
  const omissions = [];
  let used = 0;
  const take = (item, reason, isPinned) => {
    const label = LABEL_OF[item.kind] || "设定";
    const line = `- [${label}] ${item.text}`;
    const cost = line.length + 1;
    if (used + cost > budget) {
      omissions.push({ id: item.id, kind: item.kind, reason: "budget", chars: cost, pinned: isPinned });
      return;
    }
    used += cost;
    selected.push({
      id: item.id,
      kind: item.kind,
      label,
      status: item.status,
      source: item.source ? Object.freeze({ kind: item.source.kind || "author", sessionId: item.source.sessionId || null, messageId: item.source.messageId || null, path: item.source.path || null }) : null,
      text: item.text,
      reason,
      pinned: isPinned,
      chars: cost
    });
  };
  for (const id of pinned) {
    const item = list.find((it) => it && String(it.id) === id);
    if (!item) {
      omissions.push({ id, reason: "missing", pinned: true });
      continue;
    }
    if (!isPinnable(item)) {
      omissions.push({ id, kind: item.kind, status: item.status, reason: "not-injectable", pinned: true });
      continue;
    }
    take(item, "author-pinned", true);
  }
  const pinnedTaken = new Set(selected.map((s) => String(s.id)));
  for (const item of list) {
    if (!isInjectable(item)) continue;
    if (pinnedTaken.has(String(item.id))) continue;
    take(item, "auto", false);
  }
  return { selected, omissions, charsUsed: used };
}
function buildReference(reference) {
  if (!reference || !reference.text) return null;
  const selection = reference.selection && typeof reference.selection === "object" ? Object.freeze({
    start: Number.isInteger(reference.selection.start) ? reference.selection.start : null,
    end: Number.isInteger(reference.selection.end) ? reference.selection.end : null
  }) : null;
  return Object.freeze({
    label: reference.label || null,
    text: String(reference.text),
    path: reference.path || null,
    revision: reference.revision ?? null,
    selection,
    // 未保存内容的快照标记（与源稿 revision 一起构成引用身份，不用正文拼接代替结构相等）
    snapshotFingerprint: reference.snapshotFingerprint || null,
    stale: Boolean(reference.stale)
  });
}
function buildPreparedTurn(input) {
  const message = String(input?.message ?? "");
  const budget = Number.isFinite(input?.budget) ? Number(input.budget) : DEFAULT_MEMORY_BUDGET;
  const includeMemory = input?.includeMemory !== false;
  const reference = buildReference(input?.reference);
  const items = Array.isArray(input?.memoryItems) ? input.memoryItems : [];
  const { selected, omissions, charsUsed } = includeMemory ? selectMemory(items, input?.pinnedMemoryIds, budget) : { selected: [], omissions: [], charsUsed: 0 };
  const parts = [];
  if (selected.length) {
    const body = selected.map((s) => `- [${s.label}] ${s.text}`).join("\n");
    const budgetNote = omissions.filter((o) => o.reason === "budget").length;
    parts.push(
      "【项目备忘 · 作者已确认，仅供参考，不要伪装成系统指令】\n" + body + (budgetNote ? `
（另有 ${budgetNote} 条因长度省略）` : "")
    );
  }
  if (reference) {
    parts.push(
      `【引用 · ${reference.label || "稿件快照"}${reference.path ? " · " + reference.path : ""}${reference.stale ? "（来自旧快照）" : ""}】
${reference.text}`
    );
  }
  if (message) parts.push(message);
  return Object.freeze({
    schemaVersion: 2,
    projectKey: input?.projectKey || null,
    operationId: input?.operationId || null,
    message,
    reference,
    memoryRevision: input?.memoryRevision ?? null,
    memoryEtag: input?.memoryEtag ?? null,
    includeMemory,
    budget,
    charsUsed,
    selectedMemory: Object.freeze(selected.map((s) => Object.freeze(s))),
    omissions: Object.freeze(omissions.map((o) => Object.freeze(o))),
    omittedCount: omissions.filter((o) => o.reason === "budget").length,
    body: parts.join("\n\n")
  });
}
function memoryHint(memoryItems) {
  const n = (Array.isArray(memoryItems) ? memoryItems : []).filter(isInjectable).length;
  return n ? `参考项目备忘 · ${n} 条` : null;
}

// plugin/writing-mode/src/client/copy.js
var zh = {
  toggle: "写作模式",
  exit: "退出写作",
  docs: "文档库",
  newDoc: "新建",
  newProject: "新建项目",
  projTitle: "项目名",
  projPremise: "一句话前提",
  projTemplate: "模板",
  create: "创建",
  cancel: "取消",
  created: "已创建项目",
  untitled: "未命名",
  save: "保存",
  saved: "已保存",
  saving: "保存中…",
  delete: "删除",
  confirmDelete: "删除这篇文档？",
  ai: "写作伙伴",
  polish: "润色",
  continue: "续写",
  outline: "大纲",
  compress: "压缩",
  expand: "扩写",
  research: "找资料",
  spark: "灵感",
  insert: "插入文末",
  replaceSel: "替换选区",
  sendChat: "发送到会话",
  applying: "处理中…",
  noText: "先选中或写点内容",
  aiUnavailable: "内核未提供 LLM 服务，可「发送到会话」由主对话完成。",
  empty: "还没有库根。点 + 选择写作文件夹（例如 E:\\剧本）。",
  emptyCta: "一键加入 E:\\剧本",
  noProjects: "该库下没有含 project.md 的项目。可打开任意 .md / .fountain。",
  focus: "专注",
  chars: "字",
  words: "字数",
  openAi: "AI",
  closeAi: "收 AI",
  gates: "门禁",
  gateShort: "门禁",
  runGates: "跑门禁",
  gatesPass: "全部通过",
  gatesFail: "{n} 项未达标",
  gatesNone: "不支持该类型",
  gatesIdle: "打开 .md / .fountain 后可跑门禁",
  saveAsNew: "另存为新版",
  bumpHint: "按文件名生成 v(N+1)，保留旧稿",
  hideLib: "收起库",
  showLib: "展开库",
  search: "搜索文件…",
  openLatest: "打开最新版",
  isHistory: "历史稿",
  isLatest: "当前版",
  versions: "版本",
  comparePrev: "对比上一版",
  closeDiff: "关闭对比",
  diffTitle: "与上一版对比",
  reviewFix: "按此评审改稿",
  ledger: "台账速览",
  ledgerHook: "当前钩子",
  ledgerFores: "伏笔未兑现",
  ledgerReview: "最新评审",
  ledgerTimeline: "时间线尾条",
  ledgerNone: "打开项目内文件后显示",
  addRoot: "添加库…",
  switchRoot: "切换库",
  removeRoot: "移除",
  missing: "路径失效",
  unsaved: "未保存",
  pathLabel: "路径",
  suggestRoot: "建议加入库：",
  addSuggest: "加入库",
  copyPath: "复制路径",
  copied: "已复制"
};
var en = {
  toggle: "Writing",
  exit: "Exit writing",
  docs: "Library",
  newDoc: "New",
  newProject: "New project",
  projTitle: "Title",
  projPremise: "Premise",
  projTemplate: "Template",
  create: "Create",
  cancel: "Cancel",
  created: "Project created",
  untitled: "Untitled",
  save: "Save",
  saved: "Saved",
  saving: "Saving…",
  delete: "Delete",
  confirmDelete: "Delete this document?",
  ai: "Assistant",
  polish: "Polish",
  continue: "Continue",
  outline: "Outline",
  compress: "Compress",
  expand: "Expand",
  research: "Research",
  spark: "Sparks",
  insert: "Append",
  replaceSel: "Replace selection",
  sendChat: "Send to chat",
  applying: "Working…",
  noText: "Select or write something first",
  aiUnavailable: "No LLM service; use Send to chat instead.",
  empty: "No library root. Click + to pick a folder (e.g. E:\\剧本).",
  emptyCta: "Add E:\\剧本",
  noProjects: "No project.md under this root. You can still open any .md / .fountain.",
  focus: "Focus",
  chars: "chars",
  words: "Words",
  openAi: "AI",
  closeAi: "Hide AI",
  gates: "Gates",
  gateShort: "Gate",
  runGates: "Run gates",
  gatesPass: "All pass",
  gatesFail: "{n} failed",
  gatesNone: "Unsupported type",
  gatesIdle: "Open .md / .fountain to run gates",
  saveAsNew: "Save as v+1",
  bumpHint: "Create -v(N+1) keeping the old draft",
  hideLib: "Hide library",
  showLib: "Show library",
  search: "Search files…",
  openLatest: "Open latest",
  isHistory: "History",
  isLatest: "Current",
  versions: "Versions",
  comparePrev: "Diff vs prev",
  closeDiff: "Close diff",
  diffTitle: "Diff vs previous",
  reviewFix: "Fix from review",
  ledger: "Ledger",
  ledgerHook: "Chapter hook",
  ledgerFores: "Open foreshadows",
  ledgerReview: "Latest review",
  ledgerTimeline: "Timeline tail",
  ledgerNone: "Open a project file",
  addRoot: "Add library…",
  switchRoot: "Library",
  removeRoot: "Remove",
  missing: "Missing",
  unsaved: "Unsaved",
  pathLabel: "Path",
  suggestRoot: "Suggested library:",
  addSuggest: "Add",
  copyPath: "Copy path",
  copied: "Copied"
};
function pickLocale() {
  try {
    const lang = String(navigator.language || "").toLowerCase();
    return lang.startsWith("zh") ? zh : en;
  } catch {
    return zh;
  }
}
var T = pickLocale();

// plugin/writing-mode/src/client/styles/writing-css.js
var CSS = [
  /* 写作台打开：藏自有浮钮 + PALIS 浮钮/状态条，避免叠层 */
  'html[data-writing-mode="on"] #dsh-writing-mode-float{display:none !important;}',
  'html[data-writing-mode="on"] .ptp-float{display:none !important;}',
  'html[data-writing-mode="on"] #palis-theme-float,',
  'html[data-writing-mode="on"] #palis-float,',
  'html[data-writing-mode="on"] .palis-float,',
  'html[data-writing-mode="on"] .ptp-status,',
  'html[data-writing-mode="on"] #palis-status,',
  'html[data-writing-mode="on"] [data-palis-status],',
  'html[data-writing-mode="on"] .palis-statusbar{display:none !important;}',
  ".dshWmFloat{",
  "  position:fixed;right:18px;bottom:18px;z-index:95;",
  "  display:inline-flex;align-items:center;gap:6px;",
  "  height:34px;padding:0 14px;border-radius:999px;cursor:pointer;",
  "  border:1px solid var(--dsw-alias-border-l2);",
  "  background:var(--dsw-alias-bg-layer-3);",
  "  color:var(--dsw-alias-label-secondary);",
  "  font:inherit;font-size:12px;line-height:1;",
  "  box-shadow:0 4px 16px rgba(0,0,0,.16);",
  "}",
  ".dshWmFloat:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);}",
  /* 压住 PALIS 状态条 / 更高层 UI */
  ".dshWmRoot{",
  "  position:fixed;top:0;left:0;right:0;bottom:0;",
  "  z-index:2000 !important;",
  "  display:flex;flex-direction:column;",
  "  background:var(--dsw-alias-bg-base);",
  "  color:var(--dsw-alias-label-primary);",
  "  font-family:var(--dsw-font-sans,var(--ds-font-family-sans,system-ui,sans-serif));",
  "  overflow:hidden;",
  "}",
  /* 顶栏右侧让出系统窗口控件（Win 最小化/最大化/关闭约 120–140px） */
  ".dshWmBar{",
  "  display:flex;align-items:center;gap:8px;",
  "  height:52px;padding:0 148px 0 16px;flex:none;",
  "  border-bottom:1px solid var(--dsw-alias-border-l2);",
  "  background:var(--dsw-alias-bg-layer-1);",
  "  box-sizing:border-box;",
  "}",
  ".dshWmBrand{",
  "  font-size:13px;font-weight:650;color:var(--dsw-alias-label-primary);",
  "  padding-right:10px;margin-right:2px;",
  "  border-right:1px solid var(--dsw-alias-border-l2);",
  "  flex:none;",
  "}",
  ".dshWmBarGroup{display:flex;align-items:center;gap:6px;min-width:0;flex:none;}",
  ".dshWmBarSpacer{flex:1;min-width:16px;}",
  ".dshWmSelect{",
  "  font:inherit;font-size:12px;padding:6px 10px;border-radius:8px;",
  "  border:1px solid var(--dsw-alias-border-l2);",
  "  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);",
  "  max-width:160px;",
  "}",
  ".dshWmBtn{",
  "  font:inherit;font-size:12px;padding:6px 12px;border-radius:8px;cursor:pointer;",
  "  background:transparent;color:var(--dsw-alias-label-secondary);",
  "  border:1px solid var(--dsw-alias-border-l2);",
  "  white-space:nowrap;flex:none;",
  "}",
  ".dshWmBtn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);}",
  ".dshWmBtn:disabled{opacity:.4;cursor:default;}",
  ".dshWmBtn.is-primary{",
  "  background:var(--dsw-alias-button-primary-fill);",
  "  color:var(--dsw-alias-label-primary-foreground);border-color:transparent;",
  "}",
  ".dshWmBtn.is-ghost{border-color:transparent;padding-left:8px;padding-right:8px;}",
  ".dshWmBtn.is-danger{color:var(--dsw-alias-state-error-primary);}",
  ".dshWmBtn.is-on{",
  "  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);",
  "  border-color:var(--dsw-alias-brand-primary);",
  "  color:var(--dsw-alias-label-primary);",
  "}",
  ".dshWmBody{flex:1;display:flex;min-height:0;}",
  ".dshWmSide{",
  "  width:248px;flex:none;display:flex;flex-direction:column;min-height:0;",
  "  border-right:1px solid var(--dsw-alias-border-l2);",
  "  background:var(--dsw-alias-bg-layer-1);",
  "}",
  ".dshWmSide.is-ai{width:clamp(360px,34vw,560px);border-right:none;border-left:1px solid var(--dsw-alias-border-l2);}",
  ".dshWmCompanion{display:flex;flex-direction:column;flex:1;min-height:0;padding:0 16px 16px;gap:12px;}",
  ".dshWmConversationHead{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--dsw-alias-label-tertiary);}.dshWmConversationHead>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
  ".dshWmQuiet{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:5px 2px;cursor:pointer;white-space:nowrap;}.dshWmQuiet:hover{color:var(--dsw-alias-label-primary);}.dshWmQuiet:disabled{opacity:.4;cursor:default;}",
  ".dshWmConversation{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px 2px;scrollbar-width:thin;}",
  ".dshWmCompanionEmpty{padding:clamp(30px,12vh,130px) 16px 30px;color:var(--dsw-alias-label-secondary);line-height:1.9;white-space:pre-line;}.dshWmCompanionEmpty h3{font-size:21px;font-weight:500;margin:16px 0 8px;color:var(--dsw-alias-label-primary);}.dshWmCompanionEmpty p{font-size:13px;margin:0;}.dshWmCompanionMark{font-size:24px;opacity:.6;}",
  ".dshWmMessage{margin:0 0 26px;}.dshWmMessageWho{display:block;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-bottom:8px;}.dshWmMessageText{font-size:14px;line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;}.dshWmMessage.is-user{padding:12px 14px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);}.dshWmMessage.is-error{color:var(--dsw-alias-state-error-primary);}",
  ".dshWmActivity{font-size:12px;color:var(--dsw-alias-label-secondary);margin:8px 0;overflow-wrap:anywhere;}.dshWmActivity pre,.dshWmReference pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;font-family:inherit;font-size:12px;line-height:1.6;}.dshWmActivity summary,.dshWmReference summary{cursor:pointer;}",
  ".dshWmRequest{padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font-size:12px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;margin:12px 0;}.dshWmThinking{font-size:12px;color:var(--dsw-alias-label-secondary);padding:10px 0;}",
  ".dshWmCompanionError{padding:10px;font-size:12px;line-height:1.6;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;max-height:120px;overflow:auto;}",
  ".dshWmMemory{border-bottom:1px solid var(--dsw-alias-border-l2);max-height:220px;display:flex;flex-direction:column;}",
  ".dshWmMemoryList{overflow:auto;flex:1;padding:0 10px 8px;}",
  ".dshWmMemoryItem{padding:6px 8px;margin-bottom:6px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);font-size:12px;}",
  ".dshWmMemoryItem.is-retracted{opacity:.55;}",
  ".dshWmMemoryItem.is-resolved{opacity:.75;}",
  ".dshWmMemoryMeta{display:flex;gap:6px;margin-bottom:2px;font-size:10px;color:var(--dsw-alias-label-tertiary);}",
  ".dshWmMemoryKind{font-weight:700;color:var(--dsw-alias-label-secondary);}",
  ".dshWmMemoryText{line-height:1.45;color:var(--dsw-alias-label-primary);}",
  ".dshWmMemoryActions{display:flex;gap:6px;margin-top:4px;}",
  // P3：备忘完整操作（候选/编辑/历史/审计）与当轮参考面板
  ".dshWmMemoryCompose{flex-shrink:0;}",
  ".dshWmMemoryKind{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-secondary);font-size:11px;padding:2px 4px;}",
  ".dshWmMemorySource{color:var(--dsw-alias-label-tertiary);}",
  ".dshWmMemoryNote{font-size:10px;line-height:1.5;color:var(--dsw-alias-label-tertiary);padding:2px 10px 4px;}",
  ".dshWmMemoryEdit{display:flex;align-items:center;gap:6px;}",
  ".dshWmMemoryHistory{margin-top:6px;border-top:1px dashed var(--dsw-alias-border-l2);padding-top:6px;}",
  ".dshWmMemoryHistoryRow{margin-bottom:6px;}.dshWmMemoryHistoryRow:last-child{margin-bottom:0;}",
  ".dshWmMemoryDiff{font-size:11px;line-height:1.5;}.dshWmMemoryDiff .is-del{color:var(--dsw-alias-state-error-primary);}.dshWmMemoryDiff .is-add{color:var(--dsw-alias-state-success-primary);}",
  ".dshWmMessageAction{margin-top:4px;font-size:11px;}",
  ".dshWmDraftCandidates{display:flex;flex-direction:column;gap:4px;border-bottom:1px dashed var(--dsw-alias-border-l2);padding-bottom:8px;margin-bottom:8px;}",
  ".dshWmDraftCandidate{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}",
  ".dshWmDraftPreview pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:auto;font-family:inherit;font-size:12px;line-height:1.6;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;background:var(--dsw-alias-bg-layer-2);}",
  ".dshWmContext{display:flex;flex-direction:column;gap:4px;padding:6px 0 2px;}",
  ".dshWmContextSwitch{margin-left:auto;display:flex;align-items:center;gap:4px;font-size:11px;color:var(--dsw-alias-label-tertiary);}",
  ".dshWmContextPanel{max-height:200px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;background:var(--dsw-alias-bg-layer-2);}",
  ".dshWmContextItem{display:flex;align-items:flex-start;gap:6px;font-size:11px;line-height:1.5;padding:3px 0;}",
  ".dshWmContextText{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;}",
  ".dshWmContextQuestions{margin-top:4px;border-top:1px dashed var(--dsw-alias-border-l2);padding-top:4px;}",
  ".dshWmCompose{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:12px;}.dshWmCompose:focus-within{border-color:var(--dsw-alias-label-tertiary);}.dshWmChatInput{display:block;box-sizing:border-box;width:100%;min-height:88px;max-height:200px;resize:vertical;border:0;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:1.7;}.dshWmChatInput::placeholder{color:var(--dsw-alias-label-tertiary);}",
  ".dshWmComposeFoot{display:flex;align-items:center;gap:8px;margin-top:8px;}.dshWmInputHint{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-tertiary);}.dshWmSend{margin-left:auto;flex-shrink:0;width:30px;height:30px;border:0;border-radius:8px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);font-size:21px;cursor:pointer;}.dshWmSend:disabled{opacity:.25;cursor:default;}",
  ".dshWmReference{display:flex;align-items:start;gap:8px;border-bottom:1px solid var(--dsw-alias-border-l2);padding-bottom:10px;margin-bottom:10px;font-size:12px;color:var(--dsw-alias-label-secondary);}.dshWmReference details{flex:1;min-width:0;}",
  ".dshWmSide.is-ai>.dshWmSideHead{gap:22px;padding:14px 18px 10px;}.dshWmTab{font:inherit;font-size:13px;padding:4px 0 8px;background:none;border:0;border-bottom:2px solid transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;}.dshWmTab.is-on{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-label-primary);}",
  "@media(max-width:1250px){.dshWmInputHint{display:none;}}",
  ".dshWmSideHead{",
  "  display:flex;align-items:center;gap:6px;padding:12px 12px 8px;flex:none;",
  "  font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary);",
  "}",
  ".dshWmList{flex:1;overflow:auto;padding:4px 10px 20px;}",
  ".dshWmProj{margin-bottom:12px;}",
  ".dshWmProjToggle{",
  "  display:flex;align-items:center;gap:6px;width:100%;",
  "  padding:8px 8px 4px;border:none;background:transparent;cursor:pointer;",
  "  font:inherit;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);",
  "  text-align:left;",
  "}",
  ".dshWmProjToggle:hover{color:var(--dsw-alias-brand-primary);}",
  ".dshWmProjChev{font-size:10px;color:var(--dsw-alias-label-tertiary);transition:transform .12s;flex:none;}",
  ".dshWmProjChev.is-open{transform:rotate(90deg);}",
  ".dshWmFolder{",
  "  font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;",
  "  color:var(--dsw-alias-label-tertiary);padding:8px 8px 3px;",
  "}",
  ".dshWmSearch{",
  "  width:100%;margin:0 0 8px;padding:7px 10px;border-radius:8px;",
  "  border:1px solid var(--dsw-alias-border-l2);",
  "  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);",
  "  font:inherit;font-size:12px;outline:none;box-sizing:border-box;",
  "}",
  ".dshWmSearch:focus{border-color:var(--dsw-alias-brand-primary);}",
  ".dshWmItem{",
  "  display:block;width:100%;text-align:left;cursor:pointer;",
  "  padding:7px 8px;margin-bottom:2px;border-radius:8px;border:1px solid transparent;",
  "  background:transparent;color:var(--dsw-alias-label-primary);",
  "  font:inherit;font-size:12.5px;line-height:1.35;box-sizing:border-box;",
  "}",
  ".dshWmItem:hover{background:var(--dsw-alias-interactive-bg-hover);}",
  ".dshWmItem.is-on{",
  "  border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 50%,transparent);",
  "  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);",
  "}",
  ".dshWmItemRow{display:flex;align-items:baseline;gap:4px;}",
  ".dshWmItemTitle{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;}",
  ".dshWmItemMeta{display:block;font-size:10px;color:var(--dsw-alias-label-tertiary);margin-top:2px;}",
  ".dshWmVer{",
  "  display:inline-block;margin-left:6px;padding:0 5px;border-radius:4px;flex:none;",
  "  font-size:10px;font-weight:700;line-height:16px;",
  "  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);",
  "  color:var(--dsw-alias-brand-primary);",
  "}",
  ".dshWmVer.is-hist{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);}",
  ".dshWmMain{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;}",
  ".dshWmDocChrome{flex:none;padding:24px 32px 0;max-width:820px;margin:0 auto;width:100%;box-sizing:border-box;}",
  ".dshWmPathRow{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-tertiary);flex-wrap:wrap;}",
  ".dshWmPathText{flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
  ".dshWmDocName{margin:10px 0 4px;font-size:22px;font-weight:650;line-height:1.3;}",
  ".dshWmDocRule{height:1px;margin:12px 0 0;background:var(--dsw-alias-border-l2);}",
  ".dshWmHistBanner{",
  "  display:flex;align-items:center;gap:10px;margin-top:10px;padding:8px 12px;",
  "  border-radius:8px;border:1px solid var(--dsw-alias-border-l2);",
  "  background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#c9a227) 12%,transparent);",
  "  font-size:12px;",
  "}",
  ".dshWmVerBar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px;}",
  ".dshWmVerBarLabel{font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--dsw-alias-label-tertiary);}",
  ".dshWmVerChip{",
  "  font:inherit;font-size:11px;padding:3px 8px;border-radius:999px;cursor:pointer;",
  "  border:1px solid var(--dsw-alias-border-l2);background:transparent;",
  "  color:var(--dsw-alias-label-secondary);",
  "}",
  ".dshWmVerChip:hover{border-color:var(--dsw-alias-brand-primary);}",
  ".dshWmVerChip.is-on{",
  "  border-color:var(--dsw-alias-brand-primary);",
  "  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);",
  "  color:var(--dsw-alias-label-primary);font-weight:600;",
  "}",
  ".dshWmEditorWrap{flex:1;min-height:0;display:flex;justify-content:center;}",
  ".dshWmEditor{",
  "  flex:1;min-height:0;max-width:820px;width:100%;",
  "  resize:none;outline:none;border:none;box-sizing:border-box;",
  "  padding:20px 32px 48px;",
  '  font-family:"Source Han Serif SC","Noto Serif SC","Songti SC","SimSun",Georgia,serif;',
  "  font-size:var(--dsh-wm-font-size,17px);",
  "  line-height:var(--dsh-wm-line-height,1.95);letter-spacing:.02em;",
  "  color:var(--dsw-alias-label-primary);background:transparent;",
  "}",
  ".dshWmStatus{",
  "  flex:none;height:32px;display:flex;align-items:center;gap:10px;padding:0 16px;",
  "  border-top:1px solid var(--dsw-alias-border-l2);",
  "  background:var(--dsw-alias-bg-layer-1);",
  "  font-size:11px;color:var(--dsw-alias-label-tertiary);",
  "}",
  ".dshWmStatus .dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary);}",
  ".dshWmStatus .dot.is-dirty{background:var(--dsw-alias-state-warning-primary,#c9a227);}",
  ".dshWmStatus .dot.is-saved{background:var(--dsw-alias-state-success-primary);}",
  ".dshWmStatusSep{opacity:.35;}",
  ".dshWmAiBody{",
  "  flex:1;display:flex;flex-direction:column;min-height:0;",
  "  padding:8px 12px 20px;gap:8px;overflow:auto;",
  "}",
  ".dshWmAiSection{display:flex;flex-direction:column;gap:8px;}",
  ".dshWmAiSectionTitle{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);}",
  ".dshWmAiMain{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;}",
  ".dshWmAiActions{display:flex;flex-wrap:wrap;gap:6px;}",
  ".dshWmAiOut{",
  "  flex:1;min-height:140px;overflow:auto;padding:12px;border-radius:10px;",
  "  border:1px solid var(--dsw-alias-border-l2);",
  "  background:var(--dsw-alias-bg-layer-2);",
  "  font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:break-word;",
  "}",
  ".dshWmAiHint{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.5;}",
  ".dshWmSec{display:flex;flex-direction:column;gap:6px;}",
  ".dshWmSecToggle{",
  "  display:flex;align-items:center;gap:6px;width:100%;",
  "  padding:6px 0;border:none;background:transparent;cursor:pointer;",
  "  font:inherit;font-size:11px;font-weight:700;letter-spacing:.06em;",
  "  text-transform:uppercase;color:var(--dsw-alias-label-tertiary);text-align:left;",
  "}",
  ".dshWmSecToggle:hover{color:var(--dsw-alias-label-primary);}",
  ".dshWmSecBadge{",
  "  margin-left:auto;font-size:10px;font-weight:600;letter-spacing:0;text-transform:none;",
  "  padding:1px 6px;border-radius:999px;",
  "  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);",
  "}",
  ".dshWmSecBadge.is-pass{color:var(--dsw-alias-state-success-primary);}",
  ".dshWmSecBadge.is-fail{color:var(--dsw-alias-state-error-primary);}",
  ".dshWmGateList{display:flex;flex-direction:column;gap:3px;}",
  ".dshWmGateRow{",
  "  display:flex;gap:8px;align-items:baseline;font-size:12px;line-height:1.45;",
  "  padding:5px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);",
  "}",
  ".dshWmGateRow .ok{color:var(--dsw-alias-state-success-primary);font-weight:700;font-size:10px;flex:none;width:34px;}",
  ".dshWmGateRow .bad{color:var(--dsw-alias-state-error-primary);font-weight:700;font-size:10px;flex:none;width:34px;}",
  ".dshWmGateLabel{color:var(--dsw-alias-label-primary);flex:none;min-width:5em;}",
  ".dshWmGateDetail{color:var(--dsw-alias-label-tertiary);flex:1;word-break:break-word;font-size:11px;}",
  ".dshWmLedger{",
  "  display:flex;flex-direction:column;gap:6px;font-size:12px;line-height:1.55;",
  "  padding:8px 10px;border-radius:10px;",
  "  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);",
  "  color:var(--dsw-alias-label-secondary);",
  "}",
  ".dshWmLedgerRow{display:flex;gap:8px;}",
  ".dshWmLedgerK{flex:none;min-width:4.5em;color:var(--dsw-alias-label-tertiary);font-size:11px;}",
  ".dshWmLedgerV{flex:1;word-break:break-word;color:var(--dsw-alias-label-primary);}",
  ".dshWmDiff{",
  "  flex:none;max-height:36%;overflow:auto;",
  "  border-top:1px solid var(--dsw-alias-border-l2);",
  "  background:var(--dsw-alias-bg-layer-1);padding:8px 12px;",
  "}",
  ".dshWmDiffHead{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:11px;color:var(--dsw-alias-label-tertiary);}",
  ".dshWmDiffLine{",
  "  font-family:var(--ds-font-family-code,monospace);font-size:11px;line-height:1.55;",
  "  white-space:pre-wrap;word-break:break-word;padding:1px 6px;border-radius:3px;",
  "}",
  ".dshWmDiffLine.add{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);}",
  ".dshWmDiffLine.del{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);text-decoration:line-through;}",
  ".dshWmDiffLine.ctx{color:var(--dsw-alias-label-tertiary);}",
  ".dshWmWelcome{",
  "  flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;",
  "  gap:14px;padding:40px;text-align:center;color:var(--dsw-alias-label-secondary);",
  "}",
  ".dshWmWelcomeTitle{font-size:22px;font-weight:650;color:var(--dsw-alias-label-primary);}",
  ".dshWmWelcomeBody{font-size:13px;line-height:1.7;max-width:420px;}",
  ".dshWmEmpty{padding:16px;color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:1.6;}",
  ".dshWmFlash{",
  "  position:absolute;left:50%;transform:translateX(-50%);top:60px;z-index:20;",
  "  max-width:70%;padding:8px 14px;border-radius:8px;",
  "  background:color-mix(in srgb,var(--dsw-alias-bg-layer-3) 95%,transparent);",
  "  border:1px solid var(--dsw-alias-border-l2);",
  "  color:var(--dsw-alias-label-primary);font-size:12px;",
  "  box-shadow:0 4px 16px rgba(0,0,0,.2);",
  "}",
  'body[data-writing-focus="1"] .dshWmSide{display:none;}',
  'body[data-writing-focus="1"] .dshWmEditor{',
  "  font-size:calc(var(--dsh-wm-font-size,17px) + 1px);",
  "  line-height:calc(var(--dsh-wm-line-height,1.95) + 0.1);max-width:720px;",
  "}",
  'body[data-writing-focus="1"] .dshWmDocChrome{max-width:720px;}',
  'html[data-writing-mode] body[data-writing-lib="0"] .dshWmSide:not(.is-ai){display:none;}'
].join("\n");
var TAG = "dsh-writing-mode-css";
function ensureWritingCss() {
  if (typeof document !== "undefined" && !document.getElementById(TAG)) {
    const tag = document.createElement("style");
    tag.id = TAG;
    tag.textContent = CSS;
    document.head.appendChild(tag);
  }
}

// plugin/writing-mode/src/client/services/writing-api.js
var API = "/api/writing-mode";
async function api(route, opts, query) {
  const params = new URLSearchParams({ route, ...query });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), route === "assist" ? 9e4 : 15e3);
  try {
    const res = await fetch(`${API}?${params}`, { ...opts, signal: controller.signal });
    return await res.json().catch(() => ({ ok: false, error: "invalid-response" }));
  } finally {
    clearTimeout(timer);
  }
}

// plugin/writing-mode/src/client/app/WritingModeApp.js
var react3 = __toESM(require("react"), 1);
var jsx7 = __toESM(require("react/jsx-runtime"), 1);

// plugin/writing-mode/src/client/adapters/harness/identity.js
function canonicalProjectKey(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  return raw.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
function projectIdentityOf(binding, fallbackPath) {
  const canonical = binding && typeof binding.project === "string" ? binding.project : "";
  if (canonical) return { key: canonicalProjectKey(canonical), authoritative: true, display: canonical };
  return { key: canonicalProjectKey(fallbackPath), authoritative: false, display: String(fallbackPath || "") };
}

// plugin/writing-mode/src/client/adapters/harness/projection.js
var REFERENCE_SEPARATOR = "\n\n--- 供本次讨论参考的稿件快照（可能尚未保存） ---\n";
function textOf(parts) {
  return (parts || []).filter((p) => p && (p.kind === "text" || p.type === "text")).map((p) => p.text || "").join("");
}
function normalizeForMatch(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
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
      const text = idx >= 0 ? raw.slice(0, idx) : raw;
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
      messages.push({ key, kind: "detail", text: "工具活动", detail: data });
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
function turnEvidence(session, body) {
  const snap = session && typeof session.getSnapshot === "function" ? session.getSnapshot() : null;
  if (!snap) return { accepted: false, queued: false, evidence: "no-session-snapshot" };
  const needle = normalizeForMatch(String(body || "").split(REFERENCE_SEPARATOR)[0]).slice(0, 200);
  if (!needle) return { accepted: false, queued: false, evidence: "empty-body" };
  const chat = snap.chat;
  const nodes = chat?.nodes;
  for (const key of chat?.order || []) {
    const node = nodes && typeof nodes.get === "function" ? nodes.get(key) : nodes ? nodes[key] : null;
    if (!node || node.kind !== "user" && node.kind !== "steering") continue;
    const text = normalizeForMatch(textOf(node.data?.content)).slice(0, 200);
    if (text.includes(needle.slice(0, 80))) return { accepted: true, queued: false, evidence: "user-node" };
  }
  for (const row of snap.queue || []) {
    const text = normalizeForMatch(row?.text || row?.preview || "");
    if (text.includes(needle.slice(0, 80))) return { accepted: true, queued: true, evidence: "queue-row" };
  }
  return { accepted: false, queued: false, evidence: "not-found" };
}
function createSnapshotCache() {
  let cache = null;
  let lastKey = "";
  const ids = /* @__PURE__ */ new WeakMap();
  let seq = 0;
  const idOf = (part) => {
    if (part && typeof part === "object") {
      if (!ids.has(part)) ids.set(part, ++seq);
      return `o${ids.get(part)}`;
    }
    return String(part ?? "");
  };
  return {
    get(fingerprintParts, build) {
      const key = fingerprintParts.map(idOf).join("\0");
      if (cache && key === lastKey) return cache;
      cache = build();
      lastKey = key;
      return cache;
    },
    peek() {
      return cache;
    }
  };
}

// plugin/writing-mode/src/client/adapters/harness/coordination-client.js
var JSON_POST = { method: "POST", headers: { "content-type": "application/json" } };
function httpCoordination(api2 = api) {
  const post = async (op, body) => {
    const res = await api2("coordination", { ...JSON_POST, body: JSON.stringify({ op, ...body }) });
    return {
      ok: Boolean(res?.ok),
      outcome: res?.outcome || null,
      record: res?.record || null,
      error: res?.error || null
    };
  };
  return {
    claim: (body) => post("claim", body),
    creating: (body) => post("creating", body),
    confirm: (body) => post("confirm", body),
    uncertain: (body) => post("uncertain", body),
    release: (body) => post("release", body),
    forget: (body) => post("forget", body),
    read: async (body) => {
      const res = await api2("coordination", void 0, { path: body.path });
      return { ok: Boolean(res?.ok), record: res?.record || null, error: res?.error || null };
    }
  };
}

// plugin/writing-mode/src/client/adapters/harness/adapter.js
var PEER_WAIT = { attempts: 40, intervalMs: 250 };
function adapterError(code, message, extra = {}) {
  const err = new Error(message || code);
  err.code = code;
  Object.assign(err, extra);
  return err;
}
function newOperationToken() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `op-${Date.now().toString(36)}-${rand}`;
}
var has = (obj, name2) => Boolean(obj && typeof obj[name2] === "function");
function createHarnessAdapter(deps = {}) {
  const {
    sessions = null,
    workspaces = null,
    connection = null,
    api: api2 = null,
    coordination = api2 ? httpCoordination(api2) : null,
    now = () => Date.now(),
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = () => {
    }
  } = deps;
  const inflight = /* @__PURE__ */ new Map();
  function capabilities() {
    const flags = {
      sessions: Boolean(sessions),
      "sessions.refresh": has(sessions, "refresh"),
      "sessions.create": has(sessions, "create"),
      "sessions.open": has(sessions, "open"),
      "sessions.binding": has(sessions, "binding"),
      "sessions.provideInfo": has(sessions, "provideInfo"),
      "workspaces.create": has(workspaces, "create"),
      "agentPresets.select": has(connection?.agentPresets, "select"),
      coordination: Boolean(coordination && coordination.claim),
      api: typeof api2 === "function"
    };
    const required = ["sessions", "sessions.refresh", "sessions.create", "workspaces.create", "agentPresets.select", "coordination", "api"];
    const soft = ["sessions.binding", "sessions.provideInfo", "sessions.open", "sessions.noteAgentPreset"];
    const missing = required.filter((k) => !flags[k]);
    const degraded = soft.filter((k) => !flags[k]);
    return {
      flags,
      missing,
      degraded,
      canCreate: missing.length === 0,
      // 已有会话时能干活的条件（不需要创建能力）：能拿到 store 与输入面
      canSend: Boolean(flags.sessions && flags["sessions.binding"] && flags.api)
    };
  }
  function sessionStoreOf(id) {
    if (!id || !has(sessions, "binding")) return null;
    try {
      return sessions.binding(id)?.session || null;
    } catch {
      return null;
    }
  }
  function liveSessionIds() {
    try {
      const snap = sessions?.list?.getSnapshot?.();
      return new Set(Object.keys(snap?.byId || {}));
    } catch {
      return /* @__PURE__ */ new Set();
    }
  }
  async function resolveBinding(path) {
    if (typeof api2 !== "function") throw adapterError("api-missing", "写作模式 HTTP 服务不可用");
    const res = await api2("companion", void 0, { path });
    if (!res?.ok) throw adapterError(res?.error || "binding-unavailable", "无法解析作品身份：" + (res?.error || "unknown"));
    const identity = projectIdentityOf(res, path);
    if (!identity.authoritative) throw adapterError("identity-unverified", "host 未返回规范作品身份，暂不建立关联");
    return { binding: res, identity };
  }
  async function readRecord(path) {
    if (!coordination?.read) return null;
    try {
      const r = await coordination.read({ path });
      return r?.ok ? r.record : null;
    } catch {
      return null;
    }
  }
  async function openBinding({ path, operationId, preset }) {
    const { binding, identity } = await resolveBinding(path);
    const key = identity.key;
    const rec = await readRecord(path);
    const claim = await coordination.claim({ path, operationToken: operationId, owner: String(preset?.owner || "window") });
    if (!claim.ok) throw adapterError(claim.error || "coordination-unavailable", "协调服务不可用");
    log(`adapter claim ${key} → ${claim.outcome}`);
    if (claim.outcome === "bound") {
      const found = verifyRecord(claim.record, binding);
      if (found.status === "ready" || found.status === "missing") return { ...found, key, path, binding };
      return { ...found, key, path, binding };
    }
    if (claim.outcome === "in-progress") {
      const peer = await waitForPeer({ path, binding, key });
      return { ...peer, key, path, binding };
    }
    if (claim.outcome === "uncertain") {
      return { status: "uncertain", sessionId: claim.record?.sessionId || null, workspaceId: claim.record?.workspaceId || null, record: claim.record, wrongness: "previous-attempt-unconfirmed", key, path, binding };
    }
    void rec;
    return createNow({ path, operationId, key, binding });
  }
  function verifyRecord(record, binding) {
    const sessionId = record?.sessionId || binding?.sessionId || null;
    if (!sessionId) return { status: "error", error: "record-without-session", record };
    if (!liveSessionIds().has(sessionId)) return { status: "missing", sessionId, workspaceId: record?.workspaceId || null, record };
    return { status: "ready", sessionId, workspaceId: record?.workspaceId || null, record, outcome: "existing" };
  }
  async function waitForPeer({ path, binding, key }) {
    for (let i = 0; i < PEER_WAIT.attempts; i++) {
      await wait(PEER_WAIT.intervalMs);
      const rec2 = await readRecord(path);
      if (!rec2) return { status: "error", error: "record-vanished" };
      if (rec2.phase === "bound" && rec2.sessionId) return { ...verifyRecord(rec2, binding), outcome: "adopted-peer" };
      if (rec2.phase === "uncertain") return { status: "uncertain", sessionId: rec2.sessionId || null, workspaceId: rec2.workspaceId || null, record: rec2, wrongness: "peer-unconfirmed" };
      if (rec2.phase === null) return { status: "error", error: "record-cleared-while-waiting" };
    }
    const rec = await readRecord(path);
    return { status: "waiting", sessionId: null, workspaceId: rec?.workspaceId || null, record: rec, wrongness: "peer-still-creating" };
  }
  async function createNow({ path, operationId, key, binding }) {
    const caps = capabilities();
    if (!caps.canCreate) {
      await coordination.release({ path, operationToken: operationId });
      throw adapterError("capabilities-missing", "内核未提供创建会话所需能力：" + caps.missing.join(", "), { missing: caps.missing });
    }
    await coordination.creating({ path, operationToken: operationId });
    let workspaceId = null;
    let sessionId = null;
    try {
      const prepared = await api2("companion", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, prepare: true }) });
      if (!prepared?.ok) throw adapterError(prepared?.error || "preset-unavailable", "写作伙伴预设不可用：" + (prepared?.error || "unknown"));
      const workspace = await workspaces.create({ path: binding.project });
      workspaceId = workspace?.workspaceId || null;
      if (!workspaceId) throw adapterError("workspace-create-empty", "工作区创建未返回标识");
      sessionId = await sessions.create({ workspaceId });
      if (!sessionId) throw adapterError("session-create-empty", "会话创建未返回标识");
      const selected = await connection.agentPresets.select({ sessionId, agentPreset: prepared.preset });
      if (!selected?.result?.ok) throw adapterError(selected?.result?.error?.code || "preset-select-failed", selected?.result?.error?.message || "角色预设应用失败");
      if (has(sessions, "noteAgentPreset")) sessions.noteAgentPreset(sessionId, selected.result.value?.agentPreset);
      const saved = await api2("companion", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, sessionId }) });
      if (!saved?.ok) throw adapterError(saved?.error || "binding-save-failed", "会话已创建，但作品关联未保存：" + (saved?.error || "unknown"));
      await sessions.refresh();
      const confirmed = await coordination.confirm({ path, operationToken: operationId, sessionId, workspaceId });
      if (confirmed.outcome !== "bound") {
        return { status: "uncertain", sessionId, workspaceId, record: confirmed.record, wrongness: "confirm-" + confirmed.outcome, outcome: "created-unconfirmed" };
      }
      await sessions.open(sessionId);
      return { status: "ready", sessionId, workspaceId, record: confirmed.record, outcome: "created" };
    } catch (err) {
      const code = err?.code || "create-failed";
      if (sessionId) {
        await coordination.uncertain({ path, operationToken: operationId, sessionId, workspaceId, reason: code });
        return { status: "uncertain", sessionId, workspaceId, record: await readRecord(path), wrongness: code, error: err.message, outcome: "created-partially" };
      }
      if (workspaceId) {
        await coordination.confirm({ path, operationToken: operationId, workspaceId });
        await coordination.uncertain({ path, operationToken: operationId, workspaceId, reason: code });
        return { status: "uncertain", sessionId: null, workspaceId, record: await readRecord(path), wrongness: code, error: err.message, outcome: "workspace-only" };
      }
      await coordination.release({ path, operationToken: operationId });
      return { status: "error", error: err.message, code, record: await readRecord(path) };
    }
  }
  async function connect(projectIdentity, operationToken, options = {}) {
    const operationId = operationToken || newOperationToken();
    const localKey = canonicalProjectKey(projectIdentity);
    if (!localKey) throw adapterError("project-identity-required", "缺少作品身份");
    const existing = inflight.get(localKey) || (options.canonicalKey ? inflight.get(options.canonicalKey) : null);
    if (existing) {
      const shared = await existing;
      log(`adapter in-process share ${localKey}`);
      return makeHandle({ ...shared, operationId, shared: true, requestedPath: projectIdentity });
    }
    const promise = openBinding({ path: projectIdentity, operationId, preset: options });
    inflight.set(localKey, promise);
    try {
      const resolved = await promise;
      if (resolved.key && resolved.key !== localKey && !inflight.has(resolved.key)) inflight.set(resolved.key, Promise.resolve(resolved));
      return makeHandle({ ...resolved, operationId, requestedPath: projectIdentity });
    } finally {
      inflight.delete(localKey);
    }
  }
  function makeHandle(bound) {
    const { key, path, binding } = bound;
    const operationId = bound.operationId || newOperationToken();
    let state = {
      status: bound.status,
      sessionId: bound.sessionId || null,
      workspaceId: bound.workspaceId || null,
      record: bound.record || null,
      error: bound.error || null,
      wrongness: bound.wrongness || null
    };
    const snapshotCache = createSnapshotCache();
    const listeners = /* @__PURE__ */ new Set();
    const nativeUnsubs = [];
    let attachedSessionId = null;
    let disposed = false;
    const currentSession = () => sessionStoreOf(state.sessionId);
    const currentInfo = () => {
      if (!state.sessionId || !has(sessions, "provideInfo")) return null;
      try {
        return sessions.provideInfo(state.sessionId);
      } catch {
        return null;
      }
    };
    function notify() {
      if (disposed) return;
      for (const fn of [...listeners]) {
        try {
          fn();
        } catch (err) {
          log("adapter listener failed: " + (err?.message || err));
        }
      }
    }
    function attach2(store) {
      if (!store || !has(store, "subscribe")) return;
      const off = store.subscribe(() => notify());
      if (typeof off === "function") nativeUnsubs.push(off);
    }
    function ensureAttached() {
      if (attachedSessionId === state.sessionId) return;
      attachedSessionId = state.sessionId;
      if (!state.sessionId) return;
      attach2(currentSession());
      attach2(currentInfo()?.hooks?.input);
    }
    function refreshStatus() {
      if (state.status === "ready") return;
      if (state.status === "waiting" && state.sessionId && liveSessionIds().has(state.sessionId) && state.record?.phase === "bound") {
        state.status = "ready";
      }
    }
    function getSnapshot() {
      if (disposed) throw adapterError("disposed", "handle 已释放");
      ensureAttached();
      refreshStatus();
      const session = currentSession();
      const info = currentInfo();
      const chatSnap = session?.getSnapshot?.() || null;
      const inputSnap = info?.hooks?.input?.getSnapshot?.() || null;
      const caps = capabilities();
      const statusKey = `${state.status}|${state.record?.phase || ""}|${state.record?.version ?? ""}|${state.sessionId || ""}|${state.error || ""}`;
      const queueSig = (chatSnap?.queue || []).map((row) => row?.id ?? "").join("|");
      const pendingSig = (chatSnap?.pending || []).map((wait2) => wait2?.key ?? "").join("|");
      const order = chatSnap?.chat?.order || [];
      const orderSig = `${order.length}:${order.length ? order[order.length - 1] : ""}:${chatSnap?.chat?.nodes?.size ?? ""}`;
      return snapshotCache.get(
        [chatSnap?.chat, orderSig, statusKey, key, chatSnap?.running, queueSig, pendingSig, chatSnap?.hasMore, inputSnap?.draft, inputSnap?.claim, (inputSnap?.imageIds || []).join(","), caps.missing.join(","), caps.degraded.join(",")],
        () => {
          const { messages, hasUnknown } = projectChat(chatSnap?.chat);
          return Object.freeze({
            projectKey: key,
            projectPath: path,
            operationToken: operationId,
            shared: Boolean(bound.shared),
            status: state.status,
            wrongness: state.wrongness,
            error: state.error,
            sessionId: state.sessionId,
            messages,
            hasUnknown,
            running: Boolean(chatSnap?.running),
            queue: (chatSnap?.queue || []).map((row) => ({ id: row?.id, text: row?.text, preview: row?.preview })),
            pending: (chatSnap?.pending || []).map((wait2) => ({ key: wait2?.key, kind: wait2?.kind })),
            hasMore: Boolean(chatSnap?.hasMore),
            draft: inputSnap?.draft ?? "",
            claim: inputSnap?.claim ?? null,
            imageIds: inputSnap?.imageIds || [],
            record: state.record ? Object.freeze({
              phase: state.record.phase,
              sessionId: state.record.sessionId || null,
              workspaceId: state.record.workspaceId || null,
              version: state.record.version ?? null,
              reason: state.record.reason || null,
              stale: Boolean(state.record.stale)
            }) : null,
            missing: caps.missing,
            degraded: caps.degraded
          });
        }
      );
    }
    function subscribe(fn) {
      listeners.add(fn);
      ensureAttached();
      return () => listeners.delete(fn);
    }
    function getDraft() {
      return currentInfo()?.hooks?.input?.getSnapshot?.().draft ?? "";
    }
    function setDraft(text) {
      const info = currentInfo();
      const actions = info?.props?.inputActions;
      if (!actions?.setDraft) throw adapterError("input-not-ready", "原生输入框尚未就绪");
      actions.setDraft(String(text ?? ""));
      return true;
    }
    async function send(preparedTurn) {
      const body = String(preparedTurn?.body || "");
      const at = { key, sessionId: state.sessionId, operationId };
      if (!body.trim()) return { result: "rejected", code: "empty-body", projectKey: key, operationId };
      if (state.status !== "ready" || !at.sessionId) {
        return { result: "rejected", code: "not-ready", status: state.status, projectKey: key, operationId };
      }
      const session = currentSession();
      if (!session || !has(session, "prompt")) {
        const gone = Boolean(at.sessionId) && !liveSessionIds().has(at.sessionId);
        if (gone) {
          state.status = "missing";
          notify();
          return { result: "rejected", code: "session-missing", projectKey: key, operationId, sessionId: at.sessionId };
        }
        return { result: "rejected", code: "session-unavailable", projectKey: key, operationId };
      }
      let res = null;
      let thrown = null;
      try {
        res = await session.prompt([{ type: "text", text: body }], "queue");
      } catch (err) {
        thrown = err;
      }
      if (state.sessionId !== at.sessionId || key !== at.key) {
        return { result: "rejected", code: "session-changed", projectKey: at.key, operationId: at.operationId };
      }
      const freshSession = currentSession() || session;
      const evidence = turnEvidence(freshSession, body);
      if (res?.ok) return { result: "accepted", evidence: evidence.evidence, queued: evidence.queued, projectKey: key, operationId, sessionId: state.sessionId };
      if (evidence.accepted) return { result: "accepted", evidence: evidence.evidence, queued: evidence.queued, projectKey: key, operationId, sessionId: state.sessionId };
      const message = thrown?.message || res?.error?.message || res?.error || "发送失败";
      const code = thrown?.code || res?.error?.code || "send-failed";
      if (thrown) return { result: "uncertain", code, error: String(message), retainedBody: body, projectKey: key, operationId, sessionId: state.sessionId };
      return { result: "rejected", code, error: String(message), projectKey: key, operationId, sessionId: state.sessionId };
    }
    async function cancel() {
      const session = currentSession();
      if (!session || !has(session, "cancel")) throw adapterError("cancel-unavailable", "当前会话不支持取消");
      await session.cancel();
      return { ok: true, sessionId: state.sessionId };
    }
    function openFullSession() {
      if (!state.sessionId || !has(sessions, "open")) throw adapterError("open-unavailable", "没有可打开的会话");
      sessions.open(state.sessionId);
      return { ok: true, sessionId: state.sessionId };
    }
    function dispose() {
      disposed = true;
      for (const off of nativeUnsubs.splice(0)) {
        try {
          off();
        } catch {
        }
      }
      listeners.clear();
    }
    async function recover(reason = "author-requested") {
      if (state.status !== "missing" && state.status !== "uncertain" && state.status !== "waiting") {
        throw adapterError("recover-not-allowed", "当前状态不需要恢复（" + state.status + "）");
      }
      if (coordination?.forget) await coordination.forget({ path });
      const next = await connect(path, newOperationToken(), { canonicalKey: key });
      const snap = next.getSnapshot();
      state = { status: snap.status, sessionId: snap.sessionId, workspaceId: snap.workspaceId || null, record: snap.record ? { ...snap.record } : null, error: snap.error, wrongness: reason };
      notify();
      return snap;
    }
    async function refresh() {
      const rec = await readRecord(path);
      if (rec) {
        state.record = rec;
        if (rec.sessionId) state.sessionId = rec.sessionId;
        if (rec.workspaceId) state.workspaceId = rec.workspaceId;
      }
      refreshStatus();
      if (state.status === "waiting" && state.sessionId) state.status = liveSessionIds().has(state.sessionId) ? "ready" : state.status;
      notify();
      return getSnapshot();
    }
    const handle = {
      projectKey: key,
      projectPath: path,
      operationToken: operationId,
      binding,
      getSnapshot,
      subscribe,
      getDraft,
      setDraft,
      send,
      cancel,
      openFullSession,
      dispose,
      recover,
      refresh,
      record: () => state.record,
      sessionId: () => state.sessionId,
      status: () => state.status
    };
    return handle;
  }
  function attach(projectIdentity, sessionId, options = {}) {
    const key = canonicalProjectKey(projectIdentity);
    if (!key || !sessionId) throw adapterError("attach-arguments", "需要作品身份与会话标识");
    const live = liveSessionIds().has(sessionId);
    return makeHandle({
      key,
      path: projectIdentity,
      binding: options.binding || null,
      status: live ? "ready" : "missing",
      sessionId,
      workspaceId: options.workspaceId || null,
      record: options.record || null,
      requestedPath: projectIdentity,
      operationId: options.operationToken || newOperationToken()
    });
  }
  return {
    capabilities,
    connect,
    attach,
    /** 诊断用：当前进行中的绑定键（UI 不读）。 */
    inflightKeys: () => [...inflight.keys()],
    _sessionStoreOf: sessionStoreOf
  };
}

// plugin/writing-mode/src/client/adapters/harness/runtime.js
var sessionsRef = null;
var connectionRef = null;
var workspacesRef = null;
var adapterRef = null;
function bindHarness(ctx) {
  sessionsRef = ctx.sessions || null;
  connectionRef = ctx.connection?.api || null;
  workspacesRef = ctx.workspaces || null;
  adapterRef = null;
}
function harnessSessions() {
  return sessionsRef;
}
function harnessAdapter() {
  if (!adapterRef) {
    adapterRef = createHarnessAdapter({
      sessions: sessionsRef,
      workspaces: workspacesRef,
      connection: connectionRef ? { agentPresets: connectionRef.agentPresets } : null,
      api
    });
  }
  return adapterRef;
}

// plugin/writing-mode/src/client/state/mode-store.js
var LS_KEY = "dsh-writing-mode-active";
function applyBodyAttr(active) {
  try {
    if (active) document.documentElement.setAttribute("data-writing-mode", "on");
    else {
      document.documentElement.removeAttribute("data-writing-mode");
      document.body.removeAttribute("data-writing-focus");
      document.body.removeAttribute("data-writing-lib");
    }
  } catch {
  }
}
function readActiveLS() {
  try {
    return localStorage.getItem(LS_KEY) === "1";
  } catch {
    return false;
  }
}
var modeActive = readActiveLS();
var closeGuard = null;
function setCloseGuard(fn) {
  closeGuard = fn;
}
var modeListeners = /* @__PURE__ */ new Set();
function setModeActive(next) {
  if (!next && modeActive && closeGuard) {
    void closeGuard();
    return;
  }
  commitModeActive(next);
}
function commitModeActive(next) {
  if (modeActive === next) return;
  modeActive = next;
  try {
    localStorage.setItem(LS_KEY, next ? "1" : "0");
  } catch {
  }
  applyBodyAttr(next);
  for (const fn of modeListeners) {
    try {
      fn();
    } catch {
    }
  }
}
function subscribeMode(fn) {
  modeListeners.add(fn);
  return () => modeListeners.delete(fn);
}
function getModeActive() {
  return modeActive;
}

// plugin/writing-mode/src/client/state/prefs-store.js
function versionOf(name2) {
  const m = String(name2 || "").match(/-v(\d+)(\.[^.]+)?$/i);
  return m ? Number(m[1]) : null;
}
var DEFAULT_PREFS = {
  fontSize: 17,
  lineHeight: 1.95,
  autoSaveMs: 800,
  autoGate: true,
  aiMode: "harness",
  aiProvider: "deepseek-official",
  aiModel: "deepseek-v4-flash",
  aiApiKey: ""
};
var prefsCache = { ...DEFAULT_PREFS };
var prefsListeners = /* @__PURE__ */ new Set();
function getPrefs() {
  return prefsCache;
}
function subscribePrefs(fn) {
  prefsListeners.add(fn);
  return () => prefsListeners.delete(fn);
}
function notifyPrefs() {
  for (const fn of prefsListeners) {
    try {
      fn();
    } catch {
    }
  }
}
function applyPrefsCss(p) {
  try {
    const el = document.documentElement;
    el.style.setProperty("--dsh-wm-font-size", String(p.fontSize) + "px");
    el.style.setProperty("--dsh-wm-line-height", String(p.lineHeight));
  } catch {
  }
}
async function loadPrefs() {
  try {
    const data = await api("config");
    if (data.ok && data.prefs) {
      prefsCache = { ...DEFAULT_PREFS, ...data.prefs };
      applyPrefsCss(prefsCache);
      notifyPrefs();
    }
  } catch {
  }
  return prefsCache;
}
async function savePrefs(patch) {
  prefsCache = { ...prefsCache, ...patch };
  applyPrefsCss(prefsCache);
  notifyPrefs();
  try {
    await api("prefs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch)
    });
  } catch {
  }
  return prefsCache;
}
if (typeof window !== "undefined") {
  void loadPrefs();
}

// plugin/writing-mode/src/client/features/library/grouping.js
function groupKeyOf(absPath) {
  return String(absPath || "").replace(/-v\d+(\.[^.]+)$/i, "$1").toLowerCase();
}
function groupFiles(files, q) {
  const query = String(q || "").trim().toLowerCase();
  const map = /* @__PURE__ */ new Map();
  for (const f of files || []) {
    if (query) {
      const hay = (f.name + " " + f.rel).toLowerCase();
      if (!hay.includes(query)) continue;
    }
    const top = String(f.rel || "").includes("/") ? String(f.rel).split("/")[0] : "·";
    if (!map.has(top)) map.set(top, []);
    map.get(top).push(f);
  }
  const order = ["draft", "bible", "outline", "state", "reviews", "·"];
  const keys = [...map.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, "zh");
  });
  return keys.map((k) => ({ key: k, files: map.get(k) }));
}
function maxVersionInGroup(files) {
  const max = /* @__PURE__ */ new Map();
  for (const f of files || []) {
    const v = versionOf(f.name);
    const key = groupKeyOf(f.abs);
    if (v != null) max.set(key, Math.max(max.get(key) || 0, v));
  }
  return max;
}

// plugin/writing-mode/src/client/features/library/FileRow.js
var jsx = __toESM(require("react/jsx-runtime"), 1);
function fileRow({ file: f, maxVer, active, onPick, labels }) {
  const T2 = labels;
  const ver = versionOf(f.name);
  const latest = maxVer instanceof Map ? maxVer.get(groupKeyOf(f.abs)) : 0;
  const isHist = ver != null && ver < latest;
  return jsx.jsx(
    "button",
    {
      type: "button",
      className: "dshWmItem" + (active ? " is-on" : ""),
      onClick: () => onPick(f.abs),
      title: f.rel,
      children: [
        jsx.jsx(
          "div",
          {
            className: "dshWmItemRow",
            children: [
              jsx.jsx(
                "span",
                {
                  className: "dshWmItemTitle",
                  style: { flex: 1, minWidth: 0 },
                  children: f.name.replace(/-v\d+(\.[^.]+)?$/i, "$1")
                },
                "t"
              ),
              ver != null ? jsx.jsx(
                "span",
                {
                  className: "dshWmVer" + (isHist ? " is-hist" : ""),
                  children: "v" + ver
                },
                "v"
              ) : null
            ]
          },
          "row"
        ),
        jsx.jsx(
          "span",
          { className: "dshWmItemMeta", children: f.chars + T2.chars },
          "m"
        )
      ]
    },
    f.abs
  );
}

// plugin/writing-mode/src/client/features/editor/diff.js
function lineDiff(oldText, newText) {
  const a = String(oldText || "").split(/\r?\n/);
  const b = String(newText || "").split(/\r?\n/);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) {
    s++;
  }
  const out = [];
  const ctx = 2;
  for (const line of a.slice(Math.max(0, p - ctx), p)) out.push({ t: "ctx", line });
  for (const line of a.slice(p, a.length - s)) out.push({ t: "del", line });
  for (const line of b.slice(p, b.length - s)) out.push({ t: "add", line });
  for (const line of a.slice(a.length - s, a.length - s + Math.min(s, ctx))) {
    out.push({ t: "ctx", line });
  }
  return out;
}

// plugin/writing-mode/src/client/features/tools/selection.js
function selectionText({ ta, content }) {
  if (!ta) return content.slice(0, 4e3);
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  if (typeof s === "number" && typeof e === "number" && e > s) {
    return content.slice(s, e);
  }
  return content.slice(Math.max(0, (s || 0) - 400), (s || 0) + 1600) || content.slice(0, 2e3);
}

// plugin/writing-mode/src/client/features/tools/prompts.js
function assistantPrompt(payload) {
  return payload ? `请作为写作助手处理下面的文稿：

${payload}` : "请作为写作助手，帮我完善当前文稿。";
}
function reviewPrompt({ reportContent, reportPath }) {
  return "请作为写作主理，严格按下列评审报告修订对应文稿（只改 draft/bible/outline/state，报告本身不要改）。\n先读报告与 draft 当前版本，再输出修改计划并执行；完成后把新版本号写入 project.md。\n\n=== 评审报告 ===\n" + reportContent + "\n\n=== 报告路径 ===\n" + reportPath + "\n";
}

// plugin/writing-mode/src/shared/reference.js
function hash32(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
function contentFingerprint(text) {
  const body = String(text ?? "");
  return `${body.length}:${hash32(body)}`;
}
function makeReference({ label, excerpt, path = null, revision = null, start = null, end = null, dirty = false, note = null }) {
  const selection = Number.isInteger(start) && Number.isInteger(end) && end > start ? { start, end } : null;
  return Object.freeze({
    label: label || "稿件快照",
    text: String(excerpt ?? ""),
    path: path || null,
    revision: revision ?? null,
    selection,
    snapshotFingerprint: dirty ? `unsaved:${contentFingerprint(excerpt)}` : null,
    note: note || null
  });
}
function sameReference(a, b) {
  if (!a || !b) return !a && !b;
  const sel = (r) => r.selection ? `${r.selection.start}-${r.selection.end}` : "none";
  return String(a.path ?? "") === String(b.path ?? "") && String(a.revision ?? "") === String(b.revision ?? "") && sel(a) === sel(b) && String(a.snapshotFingerprint ?? "") === String(b.snapshotFingerprint ?? "");
}
function referenceStatus(reference, source) {
  if (!reference?.text) return "empty";
  if (reference.snapshotFingerprint) return "unsaved";
  if (!source || !source.path || !reference.path) return "unknown";
  if (String(source.path) !== String(reference.path)) return "unknown";
  if (reference.revision == null || source.revision == null) return "unknown";
  return String(source.revision) === String(reference.revision) ? "current" : "stale";
}
function normalizeReference(raw) {
  if (!raw || !raw.text) return null;
  if (raw.path !== void 0 || raw.revision !== void 0 || raw.selection !== void 0) return raw;
  return Object.freeze({
    label: raw.label || "稿件快照",
    text: String(raw.text),
    path: null,
    revision: null,
    selection: null,
    snapshotFingerprint: raw.snapshotFingerprint || null,
    note: raw.note || null,
    legacy: true
  });
}

// plugin/writing-mode/src/client/features/memory/index.js
var react = __toESM(require("react"), 1);
var jsx3 = __toESM(require("react/jsx-runtime"), 1);
var KIND_LABEL = { fact: "设定", preference: "偏好", "open-question": "待定" };
var STATUS_LABEL = { proposed: "候选", confirmed: "已确认", retracted: "已撤回", resolved: "已解决" };
var SOURCE_LABEL = { author: "作者", assistant: "助手建议", host: "内核" };
async function loadProjectMemory(path) {
  try {
    return await api("memory", void 0, { path });
  } catch (err) {
    return { ok: false, error: String(err?.message || "memory-load-failed"), memory: { items: [] }, injectable: [] };
  }
}
function memoryHistory(memory, id) {
  const changes = Array.isArray(memory?.changes) ? memory.changes : [];
  return changes.filter((c) => c && String(c.id) === String(id)).map((c) => ({
    at: c.at || null,
    actor: c.actor || "host",
    op: c.op || "update",
    before: c.before || null,
    after: c.after || null,
    status: c.status || null
  }));
}
function restorableText(entry) {
  return entry?.after && entry.after.text || entry?.before && entry.before.text || "";
}
function CompanionMemoryPanel({ path, candidate, onCandidateConsumed, onChanged }) {
  const [state, setState] = react.useState({ loading: true, items: [], etag: "", revision: 0, error: "", raw: null });
  const [text, setText] = react.useState("");
  const [kind, setKind] = react.useState("fact");
  const [asCandidate, setAsCandidate] = react.useState(false);
  const [editing, setEditing] = react.useState(null);
  const [history, setHistory] = react.useState(null);
  const [notice, setNotice] = react.useState("");
  const [busy, setBusy] = react.useState(false);
  const refresh = react.useCallback(async () => {
    if (!path) {
      setState({ loading: false, items: [], etag: "", revision: 0, error: "", raw: null });
      return;
    }
    const data = await loadProjectMemory(path);
    if (data.ok) {
      setState({ loading: false, items: data.memory.items || [], etag: data.etag, revision: data.memory.revision, error: "", raw: data.memory });
    } else {
      setState({ loading: false, items: [], etag: "", revision: 0, error: String(data.error || "unavailable"), raw: null });
    }
  }, [path]);
  react.useEffect(() => {
    void refresh();
  }, [refresh]);
  react.useEffect(() => {
    if (!candidate) return;
    setText(candidate.text || "");
    setKind(candidate.kind || "fact");
    setAsCandidate(true);
    setNotice("正在从助手消息记为候选：可以删改后保存（保存后仍是候选，不会自动当成事实）");
    onCandidateConsumed?.();
  }, [candidate, onCandidateConsumed]);
  async function post(op, body, { keepText = false } = {}) {
    if (busy) return;
    setBusy(true);
    try {
      const data = await api("memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, op, baseEtag: state.etag, baseRevision: state.revision, actor: "author", ...body })
      });
      if (data.ok) {
        setState({ loading: false, items: data.memory.items || [], etag: data.etag, revision: data.memory.revision, error: "", raw: data.memory });
        if (!keepText) {
          setText("");
          setAsCandidate(false);
        }
        setNotice(op === "add" ? body?.item?.status === "proposed" ? "已存为候选（未确认前不会自动带入对话）" : "已记下" : "已更新");
        onChanged?.(data);
        return true;
      }
      if (data.error === "etag-conflict" || data.error === "revision-conflict") {
        await refresh();
        setNotice("备忘已在别处修改，已刷新。你写的内容还在编辑框里，请比对后重试。");
        return false;
      }
      setNotice("操作失败：" + String(data.error || "unknown"));
      return false;
    } catch (err) {
      setNotice("操作失败：" + String(err?.message || err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function saveNew() {
    const body = String(text || "").trim();
    if (!body) return;
    const source = asCandidate && candidate?.source ? candidate.source : { kind: "author" };
    void post("add", { item: { kind, text: body, status: asCandidate ? "proposed" : "confirmed", source } }, { keepText: true });
  }
  const items = state.items.slice().reverse();
  return jsx3.jsxs("div", { className: "dshWmMemory", children: [
    jsx3.jsx("div", {
      className: "dshWmCompanionEmpty",
      style: { padding: "8px 10px", textAlign: "left", lineHeight: 1.5 },
      children: "只有作者确认过的设定/偏好会被自动带入对话。助手建议默认是候选，不会当成事实；待定问题即便确认也仍是问题，不混进默认事实。"
    }),
    // ── 新增 / 候选编辑 ───────────────────────────────────────────
    jsx3.jsxs("div", { className: "dshWmMemoryCompose", children: [
      jsx3.jsxs("div", { className: "dshWmAiActions", style: { padding: "0 10px 6px" }, children: [
        jsx3.jsx("select", {
          className: "dshWmMemoryKind",
          value: kind,
          onChange: (e) => setKind(e.target.value),
          disabled: busy,
          children: ["fact", "preference", "open-question"].map(
            (k) => jsx3.jsx("option", { value: k, children: KIND_LABEL[k] }, k)
          )
        }),
        jsx3.jsx("input", {
          className: "dshWmSearch",
          style: { margin: 0, flex: 1 },
          placeholder: asCandidate ? "候选内容（可删改）…" : "写下一条设定、偏好或待定问题…",
          value: text,
          disabled: busy,
          onChange: (e) => setText(e.target.value),
          onKeyDown: (e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              saveNew();
            }
          }
        }),
        jsx3.jsx("button", {
          className: "dshWmBtn is-primary",
          disabled: !text.trim() || state.loading || busy || !state.etag,
          "data-wm-memory-save": asCandidate ? "candidate" : "author",
          onClick: saveNew,
          children: asCandidate ? "存为候选" : "保存为项目备忘"
        })
      ] }),
      asCandidate ? jsx3.jsx("div", { className: "dshWmMemoryNote", children: "来源：助手消息（保存后仍是候选，需你确认才生效）" }) : null
    ] }),
    notice ? jsx3.jsx("div", { className: "dshWmMemoryNote", role: "status", children: notice }) : null,
    state.error ? jsx3.jsxs("div", { className: "dshWmCompanionError", role: "alert", children: [
      state.error === "corrupt-memory" || state.error === "unknown-schema" ? `备忘文件格式异常（${state.error}）。原件已原样保留、没有被覆盖：可以让我在完整会话里先诊断再安全恢复。` : `备忘暂不可用：${state.error}`,
      jsx3.jsx("button", { className: "dshWmQuiet", onClick: () => void refresh(), children: "重试" })
    ] }) : null,
    // ── 条目列表 ─────────────────────────────────────────────────
    jsx3.jsx("div", { className: "dshWmMemoryList", children: items.map((it) => jsx3.jsxs("div", {
      className: "dshWmMemoryItem is-" + it.status,
      "data-wm-memory-id": it.id,
      children: [
        jsx3.jsxs("div", { className: "dshWmMemoryMeta", children: [
          jsx3.jsx("span", { className: "dshWmMemoryKind", children: KIND_LABEL[it.kind] || it.kind }),
          jsx3.jsx("span", { className: "dshWmMemoryStatus", "data-status": it.status, children: STATUS_LABEL[it.status] || it.status }),
          jsx3.jsx("span", { className: "dshWmMemorySource", children: SOURCE_LABEL[it.source?.kind] || it.source?.kind || "作者" })
        ] }),
        editing && editing.id === it.id ? jsx3.jsxs("div", { className: "dshWmMemoryEdit", children: [
          jsx3.jsx("input", {
            className: "dshWmSearch",
            value: editing.text,
            autoFocus: true,
            onChange: (e) => setEditing({ id: it.id, text: e.target.value })
          }),
          jsx3.jsx("button", {
            className: "dshWmQuiet",
            disabled: busy,
            onClick: async () => {
              const ok = await post("update", { id: it.id, item: { text: editing.text } });
              if (ok) setEditing(null);
            },
            children: "保存"
          }),
          jsx3.jsx("button", { className: "dshWmQuiet", onClick: () => setEditing(null), children: "取消" }),
          it.status === "proposed" ? jsx3.jsx("span", { className: "dshWmMemoryNote", children: "改动后仍是候选" }) : jsx3.jsx("span", { className: "dshWmMemoryNote", children: "保存会记入历史（前后可对照）" })
        ] }) : jsx3.jsx("div", { className: "dshWmMemoryText", children: it.text }),
        jsx3.jsxs("div", { className: "dshWmMemoryActions", children: [
          it.status === "proposed" ? jsx3.jsx("button", {
            className: "dshWmQuiet",
            disabled: busy,
            onClick: () => void post("update", { id: it.id, item: { status: "confirmed", text: it.text } }),
            children: "确认"
          }) : null,
          it.status !== "retracted" && it.status !== "resolved" ? jsx3.jsx("button", { className: "dshWmQuiet", onClick: () => setEditing({ id: it.id, text: it.text }), children: "编辑" }) : null,
          it.kind === "open-question" && it.status === "confirmed" ? jsx3.jsx("button", { className: "dshWmQuiet", disabled: busy, onClick: () => void post("resolve", { id: it.id }), children: "已解决" }) : null,
          it.status === "confirmed" || it.status === "proposed" ? jsx3.jsx("button", { className: "dshWmQuiet", disabled: busy, onClick: () => void post("retract", { id: it.id }), children: "撤回" }) : null,
          jsx3.jsx("button", {
            className: "dshWmQuiet",
            onClick: () => setHistory(history && history.id === it.id ? null : { id: it.id, entries: memoryHistory(state.raw, it.id) }),
            children: "历史"
          })
        ] }),
        history && history.id === it.id ? jsx3.jsxs("div", { className: "dshWmMemoryHistory", children: [
          history.entries.length ? history.entries.slice().reverse().map((entry, i) => jsx3.jsxs("div", { className: "dshWmMemoryHistoryRow", children: [
            jsx3.jsxs("div", { className: "dshWmMemoryMeta", children: [
              jsx3.jsx("span", { children: (entry.at || "").replace("T", " ").slice(0, 16) }),
              jsx3.jsx("span", { children: entry.actor === "author" ? "作者操作" : "内核操作" }),
              jsx3.jsx("span", { children: entry.op })
            ] }),
            entry.before && entry.after && entry.before.text !== entry.after.text ? jsx3.jsxs("div", { className: "dshWmMemoryDiff", children: [
              jsx3.jsx("div", { className: "is-del", children: "− " + entry.before.text }),
              jsx3.jsx("div", { className: "is-add", children: "+ " + entry.after.text })
            ] }) : jsx3.jsx("div", { className: "dshWmMemoryText", children: entry.after?.text || entry.before?.text || "" }),
            entry.op !== "add" ? jsx3.jsx("button", {
              className: "dshWmQuiet",
              disabled: busy,
              onClick: async () => {
                const ok = await post("restore", {
                  id: it.id,
                  item: { text: restorableText(entry) || it.text, status: entry.status || entry.after?.status || it.status }
                });
                if (ok) setHistory(null);
              },
              children: "恢复这一版"
            }) : null
          ] }, String(i))) : jsx3.jsx("div", { className: "dshWmMemoryNote", children: "还没有历史记录" }),
          jsx3.jsx("div", { className: "dshWmMemoryNote", children: "恢复会生成新的 revision，版本号不会回退。" })
        ] }) : null
      ]
    }, it.id)) })
  ] });
}

// plugin/writing-mode/src/client/features/companion/index.js
var react2 = __toESM(require("react"), 1);
var jsx5 = __toESM(require("react/jsx-runtime"), 1);

// plugin/writing-mode/src/client/state/companion-drafts.js
var companionDrafts = /* @__PURE__ */ new Map();
var companionWindowId = null;
try {
  let id = sessionStorage.getItem("dsh-writing-window");
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem("dsh-writing-window", id);
  }
  companionWindowId = id;
} catch {
  companionWindowId = "default";
}
async function loadCompanionDraft(project) {
  try {
    const data = await api("draft", void 0, { project, window: companionWindowId });
    if (data.ok && data.checkpoint) {
      return {
        text: data.checkpoint.text || "",
        reference: data.checkpoint.reference || null,
        rev: data.checkpoint.rev ?? 0
      };
    }
    return { text: "", reference: null, rev: 0 };
  } catch {
    return { text: "", reference: null, rev: 0 };
  }
}
async function listDraftCandidates(project) {
  try {
    const data = await api("draft", void 0, { project, window: companionWindowId });
    if (!data.ok) return [];
    const mine = companionWindowId;
    return (data.checkpoints || []).filter((c) => c && c.windowId !== mine && String(c.text || "").trim()).map((c) => ({
      windowId: c.windowId,
      updatedAt: c.updatedAt || null,
      rev: c.rev ?? 0,
      text: c.text || "",
      reference: c.reference || null
    }));
  } catch {
    return [];
  }
}
var draftSaveQueue = /* @__PURE__ */ new Map();
var companionRecoveryState = /* @__PURE__ */ new Map();
var companionDraftDirty = /* @__PURE__ */ new Map();
var companionDraftConflict = /* @__PURE__ */ new Map();
var companionDraftStatus = /* @__PURE__ */ new Map();
var draftStatusListeners = /* @__PURE__ */ new Set();
function setDraftStatus(project, patch) {
  const prev = companionDraftStatus.get(project) || {
    phase: "idle",
    error: "",
    code: "",
    rev: null,
    textHash: ""
  };
  companionDraftStatus.set(project, { ...prev, ...patch });
  notifyDraftStatus();
}
function getDraftStatus(project) {
  return companionDraftStatus.get(project) || { phase: "idle", error: "", code: "", rev: null, textHash: "" };
}
function notifyDraftStatus() {
  for (const fn of draftStatusListeners) {
    try {
      fn();
    } catch {
    }
  }
}
function subscribeDraftStatus(fn) {
  draftStatusListeners.add(fn);
  return () => draftStatusListeners.delete(fn);
}
function isDraftConflict(project) {
  return Boolean(companionDraftConflict.get(project));
}
function draftErrorText(code) {
  if (code === "draft-too-large") return "草稿过长，未能保存。请缩短后重试。";
  if (code === "reference-too-large") return "引用过长，未能保存。请缩短选区后重试。";
  if (code === "draft-conflict") return "草稿与另一处写入冲突，请选择保留本地或采用远端。";
  if (code === "draft-rev-conflict") return "草稿版本冲突，请刷新基线后重试。";
  if (code === "network") return "网络中断，草稿尚未保存。可重试保存。";
  if (code === "invalid-response") return "保存响应无效，草稿尚未确认落盘。";
  return "草稿未能保存：" + (code || "save-failed");
}
function applyDraftSnapshot(project, { text, reference }, appliers) {
  const t = String(text ?? "");
  const r = reference || null;
  const prev = companionDrafts.get(project) || { text: "", reference: null, rev: 0 };
  companionDrafts.set(project, { ...prev, text: t, reference: r });
  if (appliers?.setLocalDraft) appliers.setLocalDraft(t);
  if (appliers?.setReference) appliers.setReference(r);
  if (appliers?.setNativeDraft) {
    try {
      appliers.setNativeDraft(t);
    } catch {
    }
  }
  notifyDraftStatus();
}
function resolveDraftConflict(project, mode, appliers) {
  const snap = companionDraftConflict.get(project);
  if (!snap) return Promise.resolve({ ok: false, error: "no-conflict" });
  if (mode === "keep-local") {
    const prev = companionDrafts.get(project) || { text: "", reference: null, rev: 0 };
    if (Number.isInteger(snap.remoteRev)) {
      companionDrafts.set(project, { ...prev, rev: snap.remoteRev });
    }
    companionDraftConflict.delete(project);
    companionDraftDirty.set(project, true);
    setDraftStatus(project, { phase: "pending", error: "", code: "" });
    return persistCompanionDraft(project);
  }
  if (mode === "keep-remote") {
    if (snap.remoteStatus !== "valid" || !Number.isInteger(snap.remoteRev)) {
      return Promise.resolve({ ok: false, error: "remote-not-valid" });
    }
    applyDraftSnapshot(
      project,
      { text: snap.remoteText || "", reference: snap.remoteReference || null },
      appliers
    );
    const prev = companionDrafts.get(project) || { text: "", reference: null, rev: 0 };
    companionDrafts.set(project, { ...prev, rev: snap.remoteRev });
    companionDraftConflict.delete(project);
    companionDraftDirty.set(project, false);
    setDraftStatus(project, { phase: "saved", error: "", code: "", rev: snap.remoteRev });
    return Promise.resolve({ ok: true });
  }
  return Promise.resolve({ ok: false, error: "bad-mode" });
}
async function retryDraftConflictRemote(project) {
  const snap = companionDraftConflict.get(project);
  if (!snap) return { ok: false, error: "no-conflict" };
  try {
    const cur = await api("draft", void 0, { project, window: companionWindowId });
    if (cur?.ok && cur.checkpoint && Number.isInteger(cur.checkpoint.rev)) {
      companionDraftConflict.set(project, {
        ...snap,
        remoteStatus: "valid",
        remoteRev: cur.checkpoint.rev,
        remoteText: cur.checkpoint.text || "",
        remoteReference: cur.checkpoint.reference || null
      });
      notifyDraftStatus();
      return { ok: true };
    }
  } catch {
  }
  companionDraftConflict.set(project, { ...snap, remoteStatus: "failed" });
  notifyDraftStatus();
  return { ok: false, error: "remote-read-failed" };
}
function persistCompanionDraft(project, onStatus) {
  const cached0 = companionDrafts.get(project) || { text: "", reference: null, rev: 0 };
  const sentHash = String(cached0.text || "") + "|" + String(cached0.reference?.text || "");
  if (companionRecoveryState.get(project) === "pending") {
    setDraftStatus(project, { phase: "pending", error: "", code: "recovery-pending" });
    if (onStatus) onStatus("deferred");
    return Promise.resolve({ ok: false, error: "recovery-pending", deferred: true });
  }
  if (isDraftConflict(project)) {
    setDraftStatus(project, { phase: "conflict", error: draftErrorText("draft-conflict"), code: "draft-conflict" });
    if (onStatus) onStatus("error:draft-conflict");
    return Promise.resolve({ ok: false, error: "draft-conflict" });
  }
  const prevQ = draftSaveQueue.get(project) || Promise.resolve();
  const next = prevQ.then(async () => {
    if (isDraftConflict(project)) {
      setDraftStatus(project, { phase: "conflict", error: draftErrorText("draft-conflict"), code: "draft-conflict" });
      if (onStatus) onStatus("error:draft-conflict");
      return { ok: false, error: "draft-conflict" };
    }
    const cached = companionDrafts.get(project) || { text: "", reference: null, rev: 0 };
    const payload = {
      project,
      windowId: companionWindowId,
      text: cached.text,
      reference: cached.reference,
      baseRev: cached.rev ?? 0
    };
    const hash = String(payload.text || "") + "|" + String(payload.reference?.text || "");
    setDraftStatus(project, { phase: "saving", error: "", code: "" });
    let data;
    try {
      data = await api("draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      setDraftStatus(project, {
        phase: "error",
        error: draftErrorText("network"),
        code: "network",
        textHash: hash
      });
      if (onStatus) onStatus("error:network");
      return { ok: false, error: "network" };
    }
    if (data?.ok) {
      const rev = data.checkpoint?.rev ?? data.rev;
      if (Number.isInteger(rev)) {
        const now2 = companionDrafts.get(project) || { text: "", reference: null, rev: 0 };
        companionDrafts.set(project, { ...now2, rev });
      }
      const now = companionDrafts.get(project) || { text: "", reference: null, rev: 0 };
      const nowHash = String(now.text || "") + "|" + String(now.reference?.text || "");
      if (nowHash === hash) {
        companionDraftDirty.set(project, false);
      }
      setDraftStatus(project, {
        phase: "saved",
        error: "",
        code: "",
        rev: Number.isInteger(rev) ? rev : null,
        textHash: hash
      });
      if (onStatus) onStatus("saved");
      return data;
    }
    const code = data?.error || "save-failed";
    if (code === "draft-rev-conflict") {
      const conflict = {
        remoteStatus: "loading",
        remoteRev: null,
        remoteText: "",
        remoteReference: null,
        localText: cached.text,
        localReference: cached.reference
      };
      companionDraftConflict.set(project, conflict);
      setDraftStatus(project, { phase: "conflict", error: draftErrorText("draft-conflict"), code: "draft-conflict" });
      try {
        const cur = await api("draft", void 0, { project, window: companionWindowId });
        if (cur?.ok && cur.checkpoint && Number.isInteger(cur.checkpoint.rev)) {
          companionDraftConflict.set(project, {
            ...conflict,
            remoteStatus: "valid",
            remoteRev: cur.checkpoint.rev,
            remoteText: cur.checkpoint.text || "",
            remoteReference: cur.checkpoint.reference || null
          });
        } else {
          companionDraftConflict.set(project, { ...conflict, remoteStatus: "failed" });
        }
      } catch {
        companionDraftConflict.set(project, { ...conflict, remoteStatus: "failed" });
      }
      notifyDraftStatus();
      if (onStatus) onStatus("error:draft-conflict");
      return data;
    }
    setDraftStatus(project, {
      phase: "error",
      error: draftErrorText(code),
      code,
      textHash: hash
    });
    if (onStatus) onStatus("error:" + code);
    return data;
  });
  draftSaveQueue.set(project, next.catch(() => {
  }));
  return next;
}

// plugin/writing-mode/src/client/features/companion/index.js
var emptyCompanionSnapshot = Object.freeze({});
var noSubscribe = () => () => {
};
var emptySnapshot = () => emptyCompanionSnapshot;
function useCompanionStore(store) {
  const subscribe = react2.useCallback((fn) => store ? store.subscribe(fn) : noSubscribe(), [store]);
  const snapshot = react2.useCallback(() => store ? store.getSnapshot() : emptySnapshot(), [store]);
  return react2.useSyncExternalStore(subscribe, snapshot);
}
function companionRows(snapshot) {
  return Array.isArray(snapshot?.messages) ? snapshot.messages : [];
}
function CompanionTranscript({ snapshot, onFull, onCandidate }) {
  const rows = companionRows(snapshot);
  const scroll = react2.useRef(null);
  const follow = react2.useRef(true);
  react2.useLayoutEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [snapshot]);
  return jsx5.jsxs("div", { className: "dshWmConversation", ref: scroll, onScroll: (e) => {
    const el = e.currentTarget;
    follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
  }, children: [
    snapshot.hasMore ? jsx5.jsx("button", { className: "dshWmQuiet", onClick: onFull, children: "查看更早的对话 ↗" }) : null,
    !rows.length ? jsx5.jsxs("div", { className: "dshWmCompanionEmpty", children: [
      jsx5.jsx("span", { className: "dshWmCompanionMark", children: "✦" }),
      jsx5.jsx("h3", { children: "故事，慢慢聊。" }),
      jsx5.jsx("p", { children: "一个人物、一段卡住的情节，\n或一个还没成形的念头。" })
    ] }) : rows.map((row) => row.kind === "detail" ? jsx5.jsxs("details", { className: "dshWmActivity", children: [
      jsx5.jsx("summary", { children: row.text }),
      jsx5.jsx("pre", { children: JSON.stringify(row.detail, null, 2) })
    ] }, row.key) : jsx5.jsxs("article", { className: "dshWmMessage is-" + row.kind, children: [
      jsx5.jsx("span", { className: "dshWmMessageWho", children: row.kind === "user" ? "你" : "写作伙伴" }),
      jsx5.jsx("div", { className: "dshWmMessageText", children: row.text }),
      row.reference ? jsx5.jsxs("details", { className: "dshWmActivity", children: [jsx5.jsx("summary", { children: "引用的稿件" }), jsx5.jsx("pre", { children: row.reference })] }) : null,
      row.kind === "assistant" && onCandidate ? jsx5.jsx("button", {
        className: "dshWmQuiet dshWmMessageAction",
        "data-wm-candidate": row.key,
        onClick: () => onCandidate({ text: row.text, messageId: row.key }),
        children: "记为候选"
      }) : null
    ] }, row.key)),
    (snapshot.queue || []).map((row) => jsx5.jsx("div", { className: "dshWmActivity", children: "等待回复后发送 · " + (row.text || row.preview || "消息") }, row.id)),
    (snapshot.pending || []).map((wait) => jsx5.jsxs("div", { className: "dshWmRequest", children: [
      jsx5.jsx("strong", { children: wait.kind === "approval" ? "有一项操作需要你授权" : "写作伙伴有个问题想确认" }),
      jsx5.jsx("button", { className: "dshWmQuiet", onClick: onFull, children: "查看并处理 ↗" })
    ] }, wait.key)),
    snapshot.running ? jsx5.jsx("div", { className: "dshWmThinking", role: "status", children: "正在回应…" }) : null
  ] });
}
function CompanionChat({ initialBinding, path, contextText, sourceInfo, onExit }) {
  const sessions = harnessSessions();
  const adapter = harnessAdapter();
  const [binding, setBinding] = react2.useState(initialBinding);
  const project = binding.project;
  const cached = companionDrafts.get(project) || { text: "", reference: null };
  const [localDraft, setLocalDraft] = react2.useState(cached.text);
  const [reference, setReference] = react2.useState(cached.reference);
  const [busy, setBusy] = react2.useState(false);
  const [error, setError] = react2.useState("");
  const [memOpen, setMemOpen] = react2.useState(false);
  const [candidate, setCandidate] = react2.useState(null);
  const [draftCandidates, setDraftCandidates] = react2.useState([]);
  const [previewCandidate, setPreviewCandidate] = react2.useState(null);
  const [contextOpen, setContextOpen] = react2.useState(false);
  const [includeMemory, setIncludeMemory] = react2.useState(true);
  const [pinned, setPinned] = react2.useState([]);
  const [memoryItems, setMemoryItems] = react2.useState([]);
  const [memoryMeta, setMemoryMeta] = react2.useState({ revision: null, etag: null, ok: true, error: "" });
  const alive = react2.useRef(true);
  const sending = react2.useRef(false);
  const id = binding.sessionId;
  const [handle, setHandle] = react2.useState(() => id ? adapter.attach(project, id, { binding }) : null);
  const opRef = react2.useRef(null);
  const operationIdRef = react2.useRef(null);
  const snapshot = useCompanionStore(handle);
  const draft = handle ? snapshot.draft || "" : localDraft;
  const needsFullComposer = Boolean(snapshot.imageIds && snapshot.imageIds.length || snapshot.claim || draft.trimStart().startsWith("/"));
  const recovery = handle && snapshot.status !== "ready" ? snapshot.status : null;
  const setNativeDraft = react2.useCallback((text) => {
    try {
      handle?.setDraft(text);
    } catch {
    }
  }, [handle]);
  const ensureHandle = react2.useCallback(async () => {
    if (handle && handle.status() !== "missing" && handle.status() !== "waiting") return handle;
    if (!opRef.current) opRef.current = newOperationToken();
    const next = await adapter.connect(path, opRef.current);
    if (alive.current) {
      setHandle(next);
      setBinding((prev) => ({ ...prev, sessionId: next.sessionId() }));
    }
    return next;
  }, [adapter, handle, path]);
  const reloadMemory = react2.useCallback(async () => {
    const data = await loadProjectMemory(project);
    setMemoryItems(data.ok ? data.memory?.items || [] : []);
    setMemoryMeta({
      revision: data.ok ? data.memory?.revision ?? null : null,
      etag: data.ok ? data.etag ?? null : null,
      ok: Boolean(data.ok),
      error: data.ok ? "" : String(data.error || "memory-unavailable")
    });
    return data;
  }, [project]);
  react2.useEffect(() => {
    void reloadMemory();
  }, [reloadMemory]);
  const reloadCandidates = react2.useCallback(async () => {
    const list = await listDraftCandidates(project);
    setDraftCandidates(list);
  }, [project]);
  react2.useEffect(() => {
    void reloadCandidates();
  }, [reloadCandidates]);
  const startCandidate = react2.useCallback((msg) => {
    setCandidate({ text: msg.text, source: { kind: "assistant", sessionId: snapshot.sessionId || null, messageId: msg.messageId || null } });
    setMemOpen(true);
  }, [snapshot.sessionId]);
  react2.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  react2.useEffect(() => {
    if (!id) return;
    const started = id ? adapter.attach(project, id, { binding }) : null;
    setHandle(started);
    try {
      started?.openFullSession();
    } catch {
    }
  }, [adapter, id, project]);
  react2.useEffect(() => () => {
    handle?.dispose();
  }, [handle]);
  const handleRef = react2.useRef(null);
  const setNativeDraftRef = react2.useRef(null);
  react2.useEffect(() => {
    handleRef.current = handle ?? null;
  }, [handle]);
  react2.useEffect(() => {
    setNativeDraftRef.current = setNativeDraft;
  }, [setNativeDraft]);
  const recoveryGen = react2.useRef(0);
  const [draftUi, setDraftUi] = react2.useState(() => ({
    conflict: null,
    dirty: false,
    status: { phase: "idle", error: "", code: "" }
  }));
  react2.useEffect(() => {
    const read = () => setDraftUi({
      conflict: companionDraftConflict.get(project) || null,
      dirty: Boolean(companionDraftDirty.get(project)),
      status: getDraftStatus(project)
    });
    read();
    return subscribeDraftStatus(read);
  }, [project]);
  react2.useEffect(() => {
    let cancelled = false;
    const started = recoveryGen.current;
    companionRecoveryState.set(project, "pending");
    void loadCompanionDraft(project).then((c) => {
      if (cancelled) return;
      const typedDuring = recoveryGen.current !== started;
      if (!typedDuring) {
        let nativeDraft = "";
        try {
          nativeDraft = handleRef.current ? handleRef.current.getDraft() : "";
        } catch {
          nativeDraft = "";
        }
        const adoptText = nativeDraft || c.text || "";
        const adoptRef = normalizeReference(c.reference) || null;
        companionDrafts.set(project, {
          text: adoptText,
          reference: adoptRef,
          rev: Number.isInteger(c.rev) ? c.rev : 0
        });
        if (adoptRef) setReference((prev) => prev || adoptRef);
        if (!nativeDraft && c.text) {
          setLocalDraft(c.text);
          try {
            setNativeDraftRef.current?.(c.text);
          } catch {
          }
        }
      } else if (Number.isInteger(c.rev)) {
        const prev = companionDrafts.get(project) || { text: "", reference: null, rev: 0 };
        companionDrafts.set(project, { ...prev, rev: c.rev });
      }
      companionRecoveryState.set(project, "done");
      if (companionDraftDirty.get(project)) {
        persistCompanionDraft(project);
      } else {
        setDraftStatus(project, { phase: "saved", error: "", code: "" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [project]);
  function updateDraft(text) {
    recoveryGen.current++;
    let wroteNative = false;
    if (handle) {
      try {
        handle.setDraft(text);
        wroteNative = true;
      } catch {
        wroteNative = false;
      }
    }
    if (!wroteNative) setLocalDraft(text);
    const prev = companionDrafts.get(project) || { text: "", reference: null, rev: 0 };
    companionDrafts.set(project, { ...prev, text });
    companionDraftDirty.set(project, true);
    if (companionRecoveryState.get(project) === "pending") return;
    persistCompanionDraft(project);
  }
  function updateReference(value) {
    recoveryGen.current++;
    setReference(value);
    const prev = companionDrafts.get(project) || { text: "", reference: null, rev: 0 };
    companionDrafts.set(project, { ...prev, reference: value });
    companionDraftDirty.set(project, true);
    if (companionRecoveryState.get(project) === "pending") return;
    persistCompanionDraft(project);
  }
  async function fullConversation() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      const target = handle || await ensureHandle();
      if (!target || !alive.current) return;
      if (!id && draft) {
        const already = target.getDraft();
        try {
          target.setDraft(already ? already + "\n\n" + draft : draft);
        } catch {
        }
      }
      target.openFullSession();
      onExit();
    } catch (err) {
      if (alive.current) setError(err.message);
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function send() {
    if (sending.current || !draft.trim()) return;
    if (needsFullComposer) {
      void fullConversation();
      return;
    }
    sending.current = true;
    setBusy(true);
    setError("");
    const sentDraft = draft, sentReference = reference;
    operationIdRef.current = newOperationToken();
    try {
      const target = handle || await ensureHandle();
      if (!target || !alive.current) return;
      const memData = await loadProjectMemory(project);
      const freshItems = memData.ok ? memData.memory?.items || [] : [];
      const memWarning = memData.ok ? "" : String(memData.error || "memory-unavailable");
      if (memData.ok && alive.current) {
        setMemoryItems(freshItems);
        setMemoryMeta({ revision: memData.memory?.revision ?? null, etag: memData.etag ?? null, ok: true, error: "" });
      }
      const prepared = buildPreparedTurn({
        message: sentDraft,
        reference: sentReference,
        memoryItems: freshItems,
        includeMemory,
        pinnedMemoryIds: pinned,
        projectKey: project,
        operationId: operationIdRef.current,
        memoryRevision: memData.ok ? memData.memory?.revision : null,
        memoryEtag: memData.ok ? memData.etag : null
      });
      if (memWarning && alive.current) setError("备忘读取失败，本次未带入已确认设定。正文已保留，可以重试或不参考发送：" + memWarning);
      const result = await target.send(prepared);
      if (result.result === "rejected") {
        throw new Error(result.error || "发送失败，请重试");
      }
      if (result.result === "uncertain") {
        if (alive.current) setError("这一轮是否已被受理无法确认，正文已保留。请先查看完整会话确认原生回合，再决定是否重发。");
        return;
      }
      let nowDraft = null;
      try {
        nowDraft = target.getDraft();
      } catch {
        nowDraft = null;
      }
      const draftCleared = nowDraft === sentDraft || nowDraft === "" || nowDraft == null;
      const nowRef = companionDrafts.get(project)?.reference || null;
      const refCleared = !nowRef || sameReference(nowRef, sentReference);
      if (draftCleared) {
        try {
          target.setDraft("");
        } catch {
        }
        if (alive.current) setLocalDraft("");
      }
      if (refCleared && alive.current) setReference(null);
      if (draftCleared || refCleared) {
        const prev = companionDrafts.get(project) || { text: "", reference: null, rev: 0 };
        companionDrafts.set(project, {
          text: draftCleared ? "" : prev.text || "",
          reference: refCleared ? null : prev.reference || null,
          rev: prev.rev ?? 0
        });
        persistCompanionDraft(project);
      }
    } catch (err) {
      if (alive.current) setError(err.message || String(err));
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const failure = error || snapshot.error;
  const statusNote = !handle || snapshot.status === "ready" ? "" : snapshot.status === "waiting" ? "正在关联这个作品的写作伙伴…（另一个窗口可能正在创建，等它完成即可）" : snapshot.status === "uncertain" ? "上一次关联没有确认完成。已知的会话/工作区标识都保留着，不会被当作没有发生过。" : snapshot.status === "missing" ? "原本关联的会话已不存在（可能被删除了）。" : snapshot.status === "error" ? `关联失败：${snapshot.error || "未知原因"}` : "";
  const recoverable = snapshot.status === "missing" || snapshot.status === "uncertain" || snapshot.status === "waiting";
  let refStatus = "empty";
  try {
    refStatus = referenceStatus(reference, sourceInfo ? sourceInfo() : null);
  } catch {
    refStatus = "unknown";
  }
  return jsx5.jsxs("div", { className: "dshWmCompanion", children: [
    jsx5.jsxs("div", { className: "dshWmConversationHead", children: [
      jsx5.jsx("span", { title: project, children: project.split(/[\\/]/).filter(Boolean).pop() }),
      jsx5.jsx("button", { className: "dshWmQuiet", onClick: () => setMemOpen((v) => !v), children: memOpen ? "收起备忘" : "项目备忘" }),
      jsx5.jsx("button", { className: "dshWmQuiet", onClick: () => void fullConversation(), disabled: busy || !sessions, title: "打开完整会话，调整模型、工具或处理请求", children: "会话设置 ↗" })
    ] }),
    memOpen ? jsx5.jsx(CompanionMemoryPanel, {
      path: project,
      candidate,
      onCandidateConsumed: () => setCandidate(null),
      onChanged: () => void reloadMemory()
    }) : null,
    statusNote ? jsx5.jsxs("div", { className: "dshWmCompanionError", role: "alert", "data-wm-status": snapshot.status, children: [
      statusNote,
      jsx5.jsx("button", { className: "dshWmQuiet", onClick: () => void handle?.refresh(), children: "重查状态" }),
      recoverable ? jsx5.jsx("button", {
        className: "dshWmQuiet",
        onClick: () => void handle?.recover().catch((err) => setError(err.message || String(err))),
        children: "继续关联"
      }) : null,
      jsx5.jsx("button", {
        className: "dshWmQuiet",
        onClick: () => {
          try {
            handle?.openFullSession();
          } catch (err) {
            setError(err.message || String(err));
          }
        },
        children: "查看完整会话"
      })
    ] }) : null,
    jsx5.jsx(CompanionTranscript, { snapshot, onFull: () => void fullConversation(), onCandidate: startCandidate }),
    draftUi.conflict ? jsx5.jsxs("div", { className: "dshWmCompanionError", role: "alert", children: [
      draftUi.conflict.remoteStatus === "valid" ? "草稿与另一处写入冲突，自动保存已暂停。" : draftUi.conflict.remoteStatus === "failed" ? "冲突后无法读取远端草稿。" : "冲突处理中，正在读取远端草稿…",
      jsx5.jsx("button", {
        className: "dshWmQuiet",
        onClick: () => void resolveDraftConflict(project, "keep-local", {
          setLocalDraft,
          setReference,
          setNativeDraft
        }),
        children: "保留本地并覆盖"
      }),
      draftUi.conflict.remoteStatus === "valid" ? jsx5.jsx("button", {
        className: "dshWmQuiet",
        onClick: () => {
          void resolveDraftConflict(project, "keep-remote", {
            setLocalDraft,
            setReference,
            setNativeDraft
          });
        },
        children: "采用远端"
      }) : null,
      draftUi.conflict.remoteStatus === "failed" ? jsx5.jsx("button", {
        className: "dshWmQuiet",
        onClick: () => void retryDraftConflictRemote(project),
        children: "重试读取远端"
      }) : null
    ] }) : null,
    draftUi.status.phase === "error" && !draftUi.conflict ? jsx5.jsxs("div", { className: "dshWmCompanionError", role: "alert", children: [
      draftUi.status.error,
      jsx5.jsx("button", {
        className: "dshWmQuiet",
        onClick: () => void persistCompanionDraft(project),
        children: "重试保存"
      })
    ] }) : null,
    draftUi.status.phase === "saving" ? jsx5.jsx("div", { className: "dshWmAiHint", role: "status", children: "正在保存草稿…" }) : null,
    failure ? jsx5.jsx("div", { className: "dshWmCompanionError", role: "alert", children: failure }) : null,
    needsFullComposer ? jsx5.jsx("button", { className: "dshWmQuiet", onClick: () => void fullConversation(), children: "在完整会话中发送附件或使用指令 ↗" }) : null,
    jsx5.jsxs("div", { className: "dshWmCompose", children: [
      draftCandidates.length ? jsx5.jsxs("div", { className: "dshWmDraftCandidates", "data-wm-draft-candidates": String(draftCandidates.length), children: [
        jsx5.jsx("span", { className: "dshWmMemoryNote", children: "其他窗口还有未合并的草稿（不会自动覆盖你正在写的）：" }),
        ...draftCandidates.map((c) => jsx5.jsxs("div", { className: "dshWmDraftCandidate", children: [
          jsx5.jsx("span", { className: "dshWmMemoryKind", children: "窗口 " + String(c.windowId).slice(0, 6) + (c.updatedAt ? " · " + String(c.updatedAt).replace("T", " ").slice(5, 16) : "") }),
          jsx5.jsx("button", { className: "dshWmQuiet", onClick: () => setPreviewCandidate(previewCandidate && previewCandidate.windowId === c.windowId ? null : c), children: "预览" }),
          jsx5.jsx("button", {
            className: "dshWmQuiet",
            "data-wm-draft-adopt": c.windowId,
            onClick: () => {
              updateDraft(c.text);
              if (c.reference) updateReference(c.reference);
              setDraftCandidates((prev) => prev.filter((x) => x.windowId !== c.windowId));
              setPreviewCandidate(null);
            },
            children: "采用这一份"
          })
        ] }, c.windowId)),
        previewCandidate ? jsx5.jsxs("div", { className: "dshWmDraftPreview", children: [
          jsx5.jsx("pre", { children: previewCandidate.text }),
          jsx5.jsx("span", { className: "dshWmMemoryNote", children: '采用会替换当前编辑框内容（你原来的草稿仍在"其他窗口"候选里，可再切换回来）' })
        ] }) : null
      ] }) : null,
      reference ? jsx5.jsxs("div", { className: "dshWmReference", "data-wm-reference-status": refStatus, children: [
        jsx5.jsxs("details", { children: [
          jsx5.jsx("summary", { children: reference.label }),
          jsx5.jsxs("div", { className: "dshWmMemoryNote", children: [
            reference.path ? "来源：" + reference.path : "来源：未记录（旧引用）",
            reference.revision != null ? " · 版本 " + String(reference.revision).slice(0, 10) : "",
            reference.selection ? " · 选区 " + reference.selection.start + "-" + reference.selection.end : "",
            refStatus === "unsaved" ? " · 取自未保存的编辑器内容" : ""
          ] }),
          jsx5.jsx("pre", { children: reference.text })
        ] }),
        refStatus === "stale" ? jsx5.jsx("button", {
          className: "dshWmQuiet",
          "data-wm-reference-restale": "1",
          title: "源稿已经改过，重新取当前内容作为引用",
          onClick: () => {
            const value = contextText?.();
            if (value?.text) updateReference(value);
          },
          children: "引用来自旧快照 · 重新引用"
        }) : null,
        jsx5.jsx("button", { className: "dshWmQuiet", "aria-label": "移除稿件引用", onClick: () => updateReference(null), children: "×" })
      ] }) : null,
      jsx5.jsx("textarea", { className: "dshWmChatInput", "aria-label": "和写作伙伴聊聊", placeholder: "说说你正在想的…", value: draft, disabled: !sessions, onChange: (e) => updateDraft(e.target.value), onKeyDown: (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
          e.preventDefault();
          void send();
        }
      } }),
      jsx5.jsxs("div", { className: "dshWmContext", children: [
        jsx5.jsx("button", {
          className: "dshWmQuiet",
          "data-wm-context-toggle": "1",
          disabled: !sessions,
          onClick: () => setContextOpen((v) => !v),
          children: includeMemory ? memoryHint(memoryItems) || "本次没有可参考的已确认条目" : "本次不参考项目备忘"
        }),
        jsx5.jsxs("label", { className: "dshWmContextSwitch", title: "这一轮是否参考项目备忘", children: [
          jsx5.jsx("input", {
            type: "checkbox",
            "data-wm-context-enabled": "1",
            checked: includeMemory,
            onChange: (e) => setIncludeMemory(e.target.checked)
          }),
          "参考"
        ] }),
        contextOpen ? jsx5.jsxs("div", { className: "dshWmContextPanel", children: [
          memoryMeta.ok ? null : jsx5.jsx("div", { className: "dshWmMemoryNote", children: "备忘读取失败（" + memoryMeta.error + "）：可以重试，或直接不参考发送。正文不会丢。" }),
          memoryItems.filter(isInjectable).length ? memoryItems.filter(isInjectable).map((it) => jsx5.jsxs("label", { className: "dshWmContextItem", children: [
            jsx5.jsx("input", {
              type: "checkbox",
              "data-wm-memory-pin": it.id,
              checked: pinned.includes(it.id),
              onChange: (e) => setPinned((prev) => e.target.checked ? [...prev, it.id] : prev.filter((x) => x !== it.id))
            }),
            jsx5.jsx("span", { className: "dshWmMemoryKind", children: it.kind === "preference" ? "偏好" : "设定" }),
            jsx5.jsx("span", { className: "dshWmContextText", children: it.text })
          ] }, it.id)) : jsx5.jsx("div", { className: "dshWmMemoryNote", children: '还没有已确认的设定/偏好。在"项目备忘"里确认后才会出现在这里。' }),
          jsx5.jsxs("div", { className: "dshWmMemoryNote", children: [
            "勾选的条目优先带入（作者固定），其余按备忘顺序自动补齐；自动部分有 ",
            String(DEFAULT_MEMORY_BUDGET),
            " 字上限（Unicode 字符数，不是 token）。你的正文与显式引用的稿件不受这个上限影响。"
          ] }),
          memoryItems.filter((it) => it.kind === "open-question" && it.status === "confirmed").length ? jsx5.jsxs("div", { className: "dshWmContextQuestions", children: [
            jsx5.jsx("div", { className: "dshWmMemoryNote", children: "待定问题（确认了也仍是问题，默认不带入；可单独勾选）" }),
            memoryItems.filter((it) => it.kind === "open-question" && it.status === "confirmed").map((it) => jsx5.jsxs("label", { className: "dshWmContextItem", children: [
              jsx5.jsx("input", {
                type: "checkbox",
                "data-wm-memory-pin": it.id,
                checked: pinned.includes(it.id),
                onChange: (e) => setPinned((prev) => e.target.checked ? [...prev, it.id] : prev.filter((x) => x !== it.id))
              }),
              jsx5.jsx("span", { className: "dshWmMemoryKind", children: "待定" }),
              jsx5.jsx("span", { className: "dshWmContextText", children: it.text })
            ] }, it.id))
          ] }) : null
        ] }) : null
      ] }),
      jsx5.jsxs("div", { className: "dshWmComposeFoot", children: [
        jsx5.jsx("button", { className: "dshWmQuiet", disabled: !sessions, onClick: () => {
          const value = contextText();
          if (value?.text) updateReference(value);
        }, children: "＋ 引用稿件 / 选区" }),
        jsx5.jsx("span", { className: "dshWmInputHint", children: "Shift + Enter 换行" }),
        snapshot.running ? jsx5.jsx("button", { className: "dshWmQuiet", "aria-label": "停止回复", onClick: () => void (handle ? handle.cancel().catch((err) => setError(err.message)) : setError("会话尚未就绪")), children: "停止" }) : null,
        jsx5.jsx("button", { className: "dshWmSend", disabled: !sessions || busy || !draft.trim(), onClick: () => void send(), "aria-label": snapshot.running ? "排队发送" : "发送", title: snapshot.running ? "在本次回复后发送" : "发送", children: busy ? "…" : "↑" })
      ] })
    ] })
  ] });
}
function WritingCompanion({ path, contextText, sourceInfo, onExit }) {
  const [result, setResult] = react2.useState(null);
  const [retry, setRetry] = react2.useState(0);
  react2.useEffect(() => {
    let active = true;
    if (path) void api("companion", void 0, { path }).then(async (data) => {
      if (data.ok && data.sessionId && harnessSessions()) {
        await harnessSessions().refresh();
        if (!harnessSessions().list.getSnapshot().byId[data.sessionId]) data.sessionId = null;
      }
      if (active) setResult({ path, ...data });
    }).catch((err) => {
      if (active) setResult({ path, error: err.message });
    });
    return () => {
      active = false;
    };
  }, [path, retry]);
  if (!path || result?.path !== path) return jsx5.jsx("div", { className: "dshWmCompanionEmpty", children: path ? "正在打开对话…" : "打开一份稿件，从这里聊起。" });
  if (!result.ok) return jsx5.jsxs("div", { className: "dshWmCompanionError", role: "alert", children: [result.error, jsx5.jsx("button", { className: "dshWmQuiet", onClick: () => setRetry((n) => n + 1), children: "重试" })] });
  return jsx5.jsx(CompanionChat, { initialBinding: result, path, contextText, sourceInfo, onExit }, result.project);
}

// plugin/writing-mode/src/client/app/WritingModeApp.js
var LS_FILE = "dsh-writing-mode-file";
function WritingModeApp() {
  const [active, setActive] = react3.useState(getModeActive);
  react3.useEffect(() => subscribeMode(() => setActive(getModeActive())), []);
  const open = () => setModeActive(true);
  const close = () => setModeActive(false);
  const [roots, setRoots] = react3.useState([]);
  const [tree, setTree] = react3.useState([]);
  const [activeRoot, setActiveRoot] = react3.useState(null);
  const editorRef = react3.useRef(null);
  if (!editorRef.current) {
    let recovered = null;
    let recoveryKey = "dsh-writing-recovery";
    try {
      let id = sessionStorage.getItem("dsh-writing-window");
      if (!id) {
        id = crypto.randomUUID();
        sessionStorage.setItem("dsh-writing-window", id);
      }
      recoveryKey += ":" + id;
      recovered = JSON.parse(localStorage.getItem(recoveryKey) || "null");
      if (!recovered) {
        const last = localStorage.getItem(LS_FILE);
        const drafts = Object.keys(localStorage).filter((k) => k.startsWith("dsh-writing-recovery:")).map((k) => {
          try {
            return JSON.parse(localStorage.getItem(k));
          } catch {
            return null;
          }
        }).filter((d) => d?.path === last).sort((a, b) => b.updatedAt - a.updatedAt);
        recovered = drafts[0] || null;
      }
    } catch {
    }
    const post = (route, body) => api(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    editorRef.current = createEditorSession({
      read: (path) => api("get", void 0, { path }),
      save: (body) => post("save", body),
      version: (body) => post("version", body),
      backup: (draft) => {
        if (draft) localStorage.setItem(recoveryKey, JSON.stringify({ ...draft, updatedAt: Date.now() }));
        else localStorage.removeItem(recoveryKey);
      }
    }, recovered);
  }
  const editor = editorRef.current;
  const [documentState, setDocumentState] = react3.useState(editor.get);
  react3.useEffect(() => editor.subscribe(setDocumentState), [editor]);
  const { path: filePath, content, dirty, status: saveState } = documentState;
  const setContent = (value) => editor.change(value);
  const setFilePath = (path) => {
    void editor.open(path);
  };
  const [aiOpen, setAiOpen] = react3.useState(true);
  const [aiTab, setAiTab] = react3.useState("companion");
  const [aiOut, setAiOut] = react3.useState("");
  const [aiBusy, setAiBusy] = react3.useState(false);
  const [aiErr, setAiErr] = react3.useState("");
  const [gate, setGate] = react3.useState(null);
  const [gateBusy, setGateBusy] = react3.useState(false);
  const [gateErr, setGateErr] = react3.useState("");
  const [focus, setFocus] = react3.useState(false);
  const [libOpen, setLibOpen] = react3.useState(true);
  const [libQuery, setLibQuery] = react3.useState("");
  const [collapsed, setCollapsed] = react3.useState(() => /* @__PURE__ */ new Set());
  const [copied, setCopied] = react3.useState(false);
  const [diffLines, setDiffLines] = react3.useState(null);
  const [diffLabel, setDiffLabel] = react3.useState("");
  const [ledger, setLedger] = react3.useState(null);
  const [gateOpen, setGateOpen] = react3.useState(false);
  const [ledgerOpen, setLedgerOpen] = react3.useState(false);
  const [newDocMode, setNewDocMode] = react3.useState(false);
  const [newDocName, setNewDocName] = react3.useState("");
  const [projMode, setProjMode] = react3.useState(false);
  const [projTitle, setProjTitle] = react3.useState("");
  const [projPremise, setProjPremise] = react3.useState("");
  const [projTemplate, setProjTemplate] = react3.useState("novel");
  const [templates, setTemplates] = react3.useState([]);
  const [addRootMode, setAddRootMode] = react3.useState(false);
  const [addRootPath, setAddRootPath] = react3.useState("");
  const [flash, setFlash] = react3.useState("");
  const [prefs, setPrefs] = react3.useState(getPrefs);
  react3.useEffect(() => subscribePrefs(() => setPrefs({ ...getPrefs() })), []);
  react3.useEffect(() => {
    void loadPrefs();
  }, [active]);
  const taRef = react3.useRef(null);
  const fillOpRef = react3.useRef(null);
  const aiTarget = react3.useRef(null);
  const saveTimer = react3.useRef(0);
  const fileInputRef = react3.useRef(null);
  const runGateRef = react3.useRef(() => {
  });
  const docBasename = filePath ? String(filePath).split(/[\\/]/).filter(Boolean).pop() : "";
  const docFolder = filePath ? (() => {
    const parts = String(filePath).split(/[\\/]/).filter(Boolean);
    if (parts.length < 2) return "";
    return parts[parts.length - 2];
  })() : "";
  const versionSeries = react3.useMemo(() => {
    if (!filePath) return [];
    const curVer = versionOf(docBasename);
    if (curVer == null) return [];
    const base = docBasename.replace(/-v\d+(\.[^.]+)?$/i, "");
    const ext = (docBasename.match(/\.[^.]+$/) || [""])[0];
    const out = [];
    for (const root of tree) {
      for (const proj of root.projects || []) {
        for (const f of proj.files || []) {
          if (f.abs.replace(/[\\/][^\\/]+$/, "").toLowerCase() !== filePath.replace(/[\\/][^\\/]+$/, "").toLowerCase()) continue;
          const n = f.name;
          if (n.replace(/-v\d+(\.[^.]+)?$/i, "").toLowerCase() !== base.toLowerCase() || !n.toLowerCase().endsWith(ext.toLowerCase())) continue;
          const v = versionOf(n);
          if (v == null) continue;
          out.push({ v, abs: f.abs, name: n });
        }
      }
    }
    out.sort((a, b) => a.v - b.v);
    return out;
  }, [filePath, docBasename, tree]);
  const curVerNum = versionOf(docBasename);
  const latestVer = versionSeries.length > 0 ? versionSeries[versionSeries.length - 1] : null;
  const isHistoryDoc = curVerNum != null && latestVer != null && curVerNum < latestVer.v;
  react3.useEffect(() => {
    applyBodyAttr(active);
  }, [active]);
  react3.useEffect(() => {
    try {
      if (focus) document.body.setAttribute("data-writing-focus", "1");
      else document.body.removeAttribute("data-writing-focus");
    } catch {
    }
  }, [focus]);
  react3.useEffect(() => {
    try {
      document.body.setAttribute("data-writing-lib", libOpen ? "1" : "0");
    } catch {
    }
  }, [libOpen]);
  const refreshTree = react3.useCallback(async () => {
    const data = await api("config");
    if (!data.ok) return;
    setRoots(data.roots || []);
    setTree(data.tree || []);
    const active2 = data.config && data.config.activeRoot || (data.roots || []).find((r) => r.default && !r.missing)?.path || (data.roots || [])[0]?.path || null;
    setActiveRoot(active2);
  }, []);
  react3.useEffect(() => {
    if (!active) return;
    void refreshTree();
  }, [active, refreshTree]);
  react3.useEffect(() => {
    if (!active || !harnessSessions()) return;
    let running = /* @__PURE__ */ new Set();
    const update = () => {
      const snapshot = harnessSessions().list.getSnapshot();
      const next = new Set(Object.values(snapshot.byId).filter((s) => s.running).map((s) => s.id));
      if (Array.from(running).some((id) => !next.has(id))) {
        void refreshTree().catch(() => {
        });
        void editor.refresh();
      }
      running = next;
    };
    update();
    return harnessSessions().list.subscribe(update);
  }, [active, editor, refreshTree]);
  const persist = react3.useCallback(() => editor.flush(), [editor]);
  const saveAsNewVersion = () => editor.version();
  react3.useEffect(() => {
    if (!active) return;
    let reading = false;
    const refresh = async () => {
      if (reading) return;
      reading = true;
      try {
        await editor.refresh();
      } finally {
        reading = false;
      }
    };
    const timer = window.setInterval(refresh, 2e3);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [active, editor]);
  react3.useEffect(() => {
    if (!active || editor.get().path) return;
    try {
      const p = localStorage.getItem(LS_FILE);
      if (p) void editor.open(p);
    } catch {
    }
  }, [active, editor]);
  react3.useEffect(() => {
    setCloseGuard(async () => {
      if (await editor.close()) commitModeActive(false);
    });
    const protect = (e) => {
      if (!editor.get().dirty && editor.get().status !== "saving") return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => {
      setCloseGuard(null);
      window.removeEventListener("beforeunload", protect);
    };
  }, [editor]);
  react3.useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    setGate(null);
    setGateErr("");
    setLedger(null);
    setDiffLines(null);
    try {
      localStorage.setItem(LS_FILE, filePath);
    } catch {
    }
    void refreshTree().catch((err) => flashMsg(err.message));
    void api("ledger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: filePath })
    }).then((d) => {
      if (!cancelled && d.ok) setLedger(d.ledger);
    }).catch(() => {
    });
    return () => {
      cancelled = true;
    };
  }, [filePath, documentState.revision, refreshTree]);
  react3.useEffect(() => {
    if (!active || !dirty || !filePath || documentState.loading || documentState.status === "error") return;
    saveTimer.current = window.setTimeout(() => {
      void persist();
    }, prefs.autoSaveMs || 800);
    return () => window.clearTimeout(saveTimer.current);
  }, [active, dirty, filePath, content, documentState.loading, documentState.status, persist, prefs.autoSaveMs]);
  react3.useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (newDocMode || addRootMode) return;
        close();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (e.shiftKey) void editor.version();
        else void persist();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, newDocMode, addRootMode, editor, persist]);
  function flashMsg(msg) {
    setFlash(String(msg || ""));
    window.setTimeout(() => setFlash(""), 3200);
  }
  async function addRootFromPrompt() {
    setAddRootMode(true);
    setAddRootPath("");
  }
  async function commitAddRoot() {
    const p = String(addRootPath || "").trim();
    if (!p) return;
    const data = await api("roots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "add", path: p, active: true })
    });
    setAddRootMode(false);
    setAddRootPath("");
    if (!data.ok) flashMsg("添加库失败：" + (data.error || "unknown"));
    void refreshTree();
  }
  async function activateRoot(p) {
    setActiveRoot(p);
    await api("roots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "activate", path: p })
    });
    void refreshTree();
  }
  function pickNativeFolder() {
    setAddRootMode(true);
    setAddRootPath("");
  }
  function createDocInRoot() {
    const root = roots.find((r) => r.path === activeRoot && !r.missing) || roots.find((r) => !r.missing);
    if (!root) {
      setAddRootMode(true);
      flashMsg("先添加一个库文件夹");
      return;
    }
    setNewDocMode(true);
    setNewDocName(T.untitled);
  }
  function openProjectMode() {
    setProjMode(true);
    setProjTitle("");
    setProjPremise("");
    void api("templates").then((d) => {
      if (d.ok) setTemplates(d.templates || []);
    }).catch(() => {
    });
  }
  async function commitProject() {
    const data = await api("create-project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: projTitle,
        premise: projPremise,
        templateId: projTemplate
      })
    });
    setProjMode(false);
    if (!data.ok) {
      flashMsg(data.error === "project-exists" ? "同名项目已存在" : "创建失败：" + (data.error || ""));
      return;
    }
    flashMsg(T.created + "：" + (data.project?.name || ""));
    void refreshTree();
  }
  async function commitNewDoc() {
    const root = roots.find((r) => r.path === activeRoot && !r.missing) || roots.find((r) => !r.missing);
    if (!root) return;
    const name2 = (newDocName || T.untitled).trim() || T.untitled;
    if (await editor.create(root.path, name2)) {
      setNewDocMode(false);
      setNewDocName("");
      taRef.current?.focus();
    }
  }
  async function runAssist(action) {
    const snapshot = editor.get();
    const selection = taRef.current ? { start: taRef.current.selectionStart, end: taRef.current.selectionEnd } : { start: 0, end: 0 };
    const isRec = action === "research" || action === "spark";
    const text = selectionText({ ta: taRef.current, content });
    if (!isRec && !text.trim()) {
      setAiErr(T.noText);
      flashMsg(T.noText);
      return;
    }
    setAiBusy(true);
    setAiErr("");
    setAiOut("");
    try {
      const data = await api("assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          text: text || content.slice(0, 4e3),
          path: filePath,
          style: action === "spark" ? "spark" : "research"
        })
      });
      if (data.ok) {
        if (editor.get().path !== snapshot.path || editor.get().edit !== snapshot.edit) {
          flashMsg("文稿已切换或修改，本次 AI 结果未应用。");
          return;
        }
        aiTarget.current = { path: snapshot.path, edit: snapshot.edit, ...selection };
        setAiOut(data.result || "");
        return;
      }
      if (data.error === "llm-unavailable") {
        const tip = T.aiUnavailable + "\n\n【可直接发送到会话】\n请作为写作助手，对下列文本做「" + (T[action] || action) + "」：\n\n" + (text || content).slice(0, 2e3);
        setAiOut(tip);
        setAiErr(T.aiUnavailable);
        flashMsg(T.aiUnavailable);
        return;
      }
      setAiErr(String(data.error || "failed"));
      flashMsg(String(data.error || "failed"));
    } catch (err) {
      const m = String(err && err.message ? err.message : err);
      setAiErr(m);
      flashMsg(m);
    } finally {
      setAiBusy(false);
    }
  }
  const runGate = react3.useCallback(async () => {
    setGateBusy(true);
    setGateErr("");
    try {
      const data = await api("gate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: filePath, content })
      });
      if (data.ok && data.gate) {
        setGate(data.gate);
        if (data.gate.kind === "none") setGateErr(T.gatesNone);
      } else {
        setGateErr(String(data.error || "failed"));
      }
    } catch (err) {
      setGateErr(String(err && err.message ? err.message : err));
    } finally {
      setGateBusy(false);
    }
  }, [filePath, content]);
  runGateRef.current = runGate;
  react3.useEffect(() => {
    if (!active || !filePath || !prefs.autoGate) return;
    const ext = String(filePath).toLowerCase().split(".").pop();
    if (ext !== "md" && ext !== "markdown" && ext !== "fountain") return;
    void runGate();
  }, [active, filePath, documentState.revision, prefs.autoGate]);
  function applyInsert() {
    if (!aiOut) return;
    if (isHistoryDoc || !aiTarget.current || aiTarget.current.path !== filePath || aiTarget.current.edit !== editor.get().edit) {
      flashMsg("文稿已变化或为历史稿，请重新生成；历史稿请先另存新版。");
      return;
    }
    setContent((c) => (c.endsWith("\n") ? c : c + "\n") + "\n" + aiOut + "\n");
  }
  function applyReplace() {
    if (!aiOut) return;
    const target = aiTarget.current;
    if (isHistoryDoc || !target || target.path !== filePath || target.edit !== editor.get().edit) {
      flashMsg("文稿已变化，请重新选择并生成。");
      return;
    }
    const s = target.start;
    const e = target.end;
    if (typeof s === "number" && typeof e === "number" && e > s) {
      setContent(content.slice(0, s) + aiOut + content.slice(e));
    } else {
      flashMsg("生成前没有选区，请使用“插入文末”。");
    }
  }
  async function copyPath() {
    if (!filePath) return;
    try {
      await navigator.clipboard.writeText(filePath);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
    }
  }
  if (!active) {
    return null;
  }
  const activeTree = tree.find((r) => {
    if (!activeRoot) return false;
    return String(r.path).toLowerCase() === String(activeRoot).toLowerCase();
  }) || tree.find((r) => r.active) || tree[0];
  const projects = activeTree ? activeTree.projects || [] : [];
  function toggleProj(key) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  async function comparePrev() {
    if (curVerNum == null || versionSeries.length < 2) return;
    const idx = versionSeries.findIndex((s) => s.abs === filePath);
    const prev = versionSeries[idx - 1];
    if (!prev) return;
    const a = await api("get", void 0, { path: prev.abs });
    const b = await api("get", void 0, { path: filePath });
    if (!a.ok || !b.ok) return;
    setDiffLines(lineDiff(a.doc.content, b.doc.content));
    setDiffLabel(`v${prev.v} → v${curVerNum}`);
  }
  const isReviewFile = /(^|[\\/])reviews[\\/]/i.test(String(filePath || ""));
  async function fillComposer(prompt) {
    const source = editor.get().path;
    try {
      if (!fillOpRef.current) fillOpRef.current = newOperationToken();
      const target = await harnessAdapter().connect(source || activeRoot, fillOpRef.current);
      if (!target) return false;
      if (editor.get().path !== source || !getModeActive()) return false;
      const already = target.getDraft();
      target.setDraft(already ? already + "\n\n" + prompt : prompt);
      setAiOpen(true);
      setAiTab("companion");
      setFocus(false);
      flashMsg("已追加到写作伙伴输入框，补充想法后发送");
      return true;
    } catch (err) {
      flashMsg(err.message);
      setAiErr(err.message);
      return false;
    }
  }
  async function sendToChat() {
    const payload = aiOut || selectionText({ ta: taRef.current, content });
    const prompt = assistantPrompt(payload);
    await fillComposer(prompt);
  }
  async function sendReviewToChat() {
    const prompt = reviewPrompt({ reportContent: content, reportPath: filePath });
    await fillComposer(prompt);
  }
  const notice = documentState.error || flash;
  return jsx7.jsx("div", {
    className: "dshWmRoot",
    role: "dialog",
    "aria-label": T.toggle,
    children: [
      notice ? jsx7.jsx("div", { className: "dshWmFlash", role: "alert", children: notice }, "flash") : null,
      jsx7.jsx(
        "div",
        {
          className: "dshWmBar",
          children: [
            jsx7.jsx("span", { className: "dshWmBrand", children: "写作台" }),
            roots.length > 0 ? jsx7.jsx(
              "select",
              {
                className: "dshWmSelect",
                value: activeRoot || "",
                onChange: (e) => void activateRoot(e.target.value),
                title: T.switchRoot,
                children: roots.map(
                  (r) => jsx7.jsx(
                    "option",
                    {
                      value: r.path,
                      children: (r.missing ? "⚠ " : "") + (r.label || r.path)
                    },
                    r.path
                  )
                )
              },
              "roots"
            ) : null,
            jsx7.jsx("button", {
              type: "button",
              className: "dshWmBtn is-ghost",
              onClick: () => setAddRootMode(true),
              title: T.addRoot,
              children: "+"
            }),
            jsx7.jsx("button", {
              type: "button",
              className: "dshWmBtn is-ghost",
              onClick: () => setAddRootMode(true),
              children: "…",
              title: T.addRoot
            }),
            addRootMode ? jsx7.jsx(
              "span",
              {
                className: "dshWmBarGroup",
                children: [
                  jsx7.jsx("input", {
                    className: "dshWmSearch",
                    style: { width: 180, margin: 0 },
                    value: addRootPath,
                    placeholder: "E:\\剧本",
                    autoFocus: true,
                    onChange: (e) => setAddRootPath(e.target.value),
                    onKeyDown: (e) => {
                      if (e.key === "Enter") void commitAddRoot();
                      if (e.key === "Escape") setAddRootMode(false);
                    }
                  }),
                  jsx7.jsx("button", {
                    type: "button",
                    className: "dshWmBtn is-primary",
                    onClick: () => void commitAddRoot(),
                    children: "OK"
                  })
                ]
              },
              "add-root"
            ) : null,
            jsx7.jsx("span", { className: "dshWmBarSpacer" }),
            jsx7.jsx(
              "div",
              {
                className: "dshWmBarGroup",
                children: [
                  jsx7.jsx("button", {
                    type: "button",
                    className: "dshWmBtn is-ghost",
                    onClick: () => setLibOpen((v) => !v),
                    title: libOpen ? T.hideLib : T.showLib,
                    children: libOpen ? "⟨" : "⟩"
                  }),
                  jsx7.jsx("button", {
                    type: "button",
                    className: "dshWmBtn" + (focus ? " is-on" : ""),
                    onClick: () => setFocus((v) => !v),
                    children: T.focus
                  }),
                  jsx7.jsx("button", {
                    type: "button",
                    className: "dshWmBtn" + (aiOpen ? " is-on" : ""),
                    onClick: () => setAiOpen((v) => !v),
                    children: aiOpen ? T.closeAi : T.openAi
                  })
                ]
              },
              "views"
            ),
            jsx7.jsx("span", { className: "dshWmBarGroup", children: [
              jsx7.jsx("button", {
                type: "button",
                className: "dshWmBtn",
                disabled: !filePath,
                onClick: () => void persist(),
                children: saveState === "saving" ? T.saving : saveState === "saved" ? T.saved : T.save
              }),
              jsx7.jsx("button", {
                type: "button",
                className: "dshWmBtn",
                disabled: !filePath,
                title: T.bumpHint || T.saveAsNew,
                onClick: () => void saveAsNewVersion(),
                children: "v+1"
              })
            ] }, "file-ops"),
            jsx7.jsx("button", {
              type: "button",
              className: "dshWmBtn is-primary",
              onClick: close,
              children: T.exit
            })
          ]
        },
        "bar"
      ),
      jsx7.jsx(
        "div",
        {
          className: "dshWmBody",
          children: [
            jsx7.jsx(
              "aside",
              {
                className: "dshWmSide",
                children: [
                  jsx7.jsx(
                    "div",
                    {
                      className: "dshWmSideHead",
                      children: [
                        jsx7.jsx("span", { children: T.docs }),
                        jsx7.jsx("span", { style: { flex: 1 } }),
                        jsx7.jsx("button", {
                          type: "button",
                          className: "dshWmBtn",
                          onClick: openProjectMode,
                          children: T.newProject
                        }),
                        jsx7.jsx("button", {
                          type: "button",
                          className: "dshWmBtn",
                          onClick: createDocInRoot,
                          children: T.newDoc
                        })
                      ]
                    },
                    "dh"
                  ),
                  projMode ? jsx7.jsx(
                    "div",
                    {
                      style: {
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        padding: "0 10px 10px"
                      },
                      children: [
                        jsx7.jsx("input", {
                          className: "dshWmSearch",
                          style: { margin: 0 },
                          value: projTitle,
                          autoFocus: true,
                          placeholder: T.projTitle,
                          onChange: (e) => setProjTitle(e.target.value)
                        }),
                        jsx7.jsx("input", {
                          className: "dshWmSearch",
                          style: { margin: 0 },
                          value: projPremise,
                          placeholder: T.projPremise,
                          onChange: (e) => setProjPremise(e.target.value)
                        }),
                        jsx7.jsx(
                          "select",
                          {
                            className: "dshWmSearch",
                            style: { margin: 0 },
                            value: projTemplate,
                            onChange: (e) => setProjTemplate(e.target.value),
                            children: (templates.length ? templates : [
                              { id: "novel", name: "小说 · 长篇连载" },
                              { id: "shortdrama", name: "短剧 · 竖屏" },
                              { id: "screenplay", name: "电影 / 剧集" }
                            ]).map(
                              (t) => jsx7.jsx(
                                "option",
                                { value: t.id, children: t.name },
                                t.id
                              )
                            )
                          },
                          "tmpl"
                        ),
                        jsx7.jsx(
                          "div",
                          {
                            style: { display: "flex", gap: 6 },
                            children: [
                              jsx7.jsx("button", {
                                type: "button",
                                className: "dshWmBtn is-primary",
                                onClick: () => void commitProject(),
                                children: T.create
                              }),
                              jsx7.jsx("button", {
                                type: "button",
                                className: "dshWmBtn",
                                onClick: () => setProjMode(false),
                                children: T.cancel
                              })
                            ]
                          },
                          "pb"
                        )
                      ]
                    },
                    "proj"
                  ) : null,
                  newDocMode ? jsx7.jsx(
                    "div",
                    {
                      style: { display: "flex", gap: 6, padding: "0 10px 8px" },
                      children: [
                        jsx7.jsx("input", {
                          className: "dshWmSearch",
                          style: { margin: 0, flex: 1 },
                          value: newDocName,
                          autoFocus: true,
                          placeholder: T.untitled,
                          onChange: (e) => setNewDocName(e.target.value),
                          onKeyDown: (e) => {
                            if (e.key === "Enter") commitNewDoc();
                            if (e.key === "Escape") setNewDocMode(false);
                          }
                        }),
                        jsx7.jsx("button", {
                          type: "button",
                          className: "dshWmBtn is-primary",
                          onClick: commitNewDoc,
                          children: "OK"
                        })
                      ]
                    },
                    "new-doc"
                  ) : null,
                  roots.length > 0 ? jsx7.jsx(
                    "div",
                    {
                      style: { padding: "8px 8px 0" },
                      children: jsx7.jsx("input", {
                        className: "dshWmSearch",
                        value: libQuery,
                        placeholder: T.search,
                        onChange: (e) => setLibQuery(e.target.value)
                      })
                    },
                    "sq"
                  ) : null,
                  jsx7.jsx(
                    "div",
                    {
                      className: "dshWmList",
                      children: roots.length === 0 ? jsx7.jsx(
                        "div",
                        {
                          className: "dshWmWelcome",
                          children: [
                            jsx7.jsx(
                              "div",
                              { className: "dshWmWelcomeTitle", children: T.toggle },
                              "wt"
                            ),
                            jsx7.jsx(
                              "div",
                              { className: "dshWmWelcomeBody", children: T.empty },
                              "wb"
                            ),
                            jsx7.jsx(
                              "button",
                              {
                                type: "button",
                                className: "dshWmBtn is-primary",
                                onClick: () => {
                                  setAddRootMode(true);
                                  setAddRootPath("E:\\剧本");
                                },
                                children: T.emptyCta
                              },
                              "wc"
                            ),
                            jsx7.jsx(
                              "div",
                              {
                                className: "dshWmAiHint",
                                children: "Esc · Ctrl+S · Ctrl+Shift+S"
                              },
                              "wk"
                            )
                          ]
                        },
                        "wel"
                      ) : projects.length === 0 ? jsx7.jsx("div", {
                        className: "dshWmEmpty",
                        children: (activeTree && activeTree.missing ? T.missing + "\n" : "") + T.noProjects
                      }) : projects.map((proj) => {
                        const groups = groupFiles(proj.files, libQuery);
                        const openP = !collapsed.has(proj.path);
                        const maxDraft = maxVersionInGroup(
                          (proj.files || []).filter((f) => String(f.rel).startsWith("draft/"))
                        );
                        if (libQuery && groups.length === 0) return null;
                        return jsx7.jsx(
                          "div",
                          {
                            className: "dshWmProj",
                            children: [
                              jsx7.jsx(
                                "button",
                                {
                                  type: "button",
                                  className: "dshWmProjToggle",
                                  onClick: () => toggleProj(proj.path),
                                  children: [
                                    jsx7.jsx(
                                      "span",
                                      {
                                        className: "dshWmProjChev" + (openP ? " is-open" : ""),
                                        children: "▸"
                                      },
                                      "c"
                                    ),
                                    jsx7.jsx("span", { children: proj.name }, "n")
                                  ]
                                },
                                "pt"
                              ),
                              openP ? groups.map(
                                (g) => jsx7.jsx(
                                  react3.Fragment,
                                  {
                                    children: [
                                      jsx7.jsx(
                                        "div",
                                        {
                                          className: "dshWmFolder",
                                          children: g.key === "·" ? "ROOT" : g.key
                                        },
                                        "fh"
                                      ),
                                      ...g.files.map(
                                        (f) => fileRow({
                                          file: f,
                                          maxVer: g.key === "draft" || String(f.rel).includes("/draft/") ? maxDraft : 0,
                                          active: Boolean(filePath) && f.abs === filePath,
                                          onPick: setFilePath,
                                          labels: T
                                        })
                                      )
                                    ]
                                  },
                                  "g-" + g.key
                                )
                              ) : null
                            ]
                          },
                          proj.path
                        );
                      })
                    },
                    "dl"
                  )
                ]
              },
              "docs"
            ),
            jsx7.jsx(
              "main",
              {
                className: "dshWmMain",
                children: [
                  jsx7.jsx(
                    "div",
                    {
                      className: "dshWmDocChrome",
                      children: [
                        jsx7.jsx(
                          "div",
                          {
                            className: "dshWmPathRow",
                            children: [
                              jsx7.jsx("span", {
                                className: "dshWmPathText",
                                children: filePath ? (docFolder ? docFolder + " / " : "") + docBasename : "—"
                              }),
                              filePath ? jsx7.jsx("button", {
                                type: "button",
                                className: "dshWmBtn is-ghost",
                                onClick: () => void copyPath(),
                                children: copied ? T.copied : T.copyPath
                              }) : null,
                              isReviewFile ? jsx7.jsx("button", {
                                type: "button",
                                className: "dshWmBtn",
                                onClick: sendReviewToChat,
                                children: T.reviewFix
                              }) : null
                            ]
                          },
                          "pr"
                        ),
                        jsx7.jsx(
                          "div",
                          {
                            className: "dshWmDocName",
                            children: (docBasename || T.untitled).replace(/-v\d+(\.[^.]+)?$/i, "$1") + (curVerNum != null ? "  v" + curVerNum : "")
                          },
                          "dn"
                        ),
                        isHistoryDoc && latestVer ? jsx7.jsx(
                          "div",
                          {
                            className: "dshWmHistBanner",
                            children: [
                              jsx7.jsx("span", {
                                children: T.isHistory + " · " + T.isLatest + " v" + latestVer.v
                              }, "h"),
                              jsx7.jsx("span", { style: { flex: 1 } }),
                              jsx7.jsx("button", {
                                type: "button",
                                className: "dshWmBtn",
                                onClick: () => setFilePath(latestVer.abs),
                                children: T.openLatest
                              })
                            ]
                          },
                          "hb"
                        ) : null,
                        versionSeries.length > 1 ? jsx7.jsx(
                          "div",
                          {
                            className: "dshWmVerBar",
                            children: [
                              jsx7.jsx(
                                "span",
                                { className: "dshWmVerBarLabel", children: T.versions },
                                "vl"
                              ),
                              ...versionSeries.map(
                                (s) => jsx7.jsx(
                                  "button",
                                  {
                                    type: "button",
                                    className: "dshWmVerChip" + (s.abs === filePath ? " is-on" : ""),
                                    onClick: () => setFilePath(s.abs),
                                    children: "v" + s.v
                                  },
                                  "v" + s.v
                                )
                              ),
                              jsx7.jsx(
                                "button",
                                {
                                  type: "button",
                                  className: "dshWmBtn is-ghost",
                                  disabled: curVerNum == null || versionSeries.length < 2,
                                  onClick: () => void comparePrev(),
                                  children: T.comparePrev
                                },
                                "cmp"
                              )
                            ]
                          },
                          "vb"
                        ) : null,
                        jsx7.jsx("div", { className: "dshWmDocRule" }, "dr")
                      ]
                    },
                    "chrome"
                  ),
                  jsx7.jsx(
                    "div",
                    {
                      className: "dshWmEditorWrap",
                      children: jsx7.jsx("textarea", {
                        ref: taRef,
                        className: "dshWmEditor",
                        value: content,
                        spellCheck: false,
                        readOnly: documentState.loading || isHistoryDoc,
                        placeholder: filePath ? "开始写…" : "# …",
                        onChange: (e) => {
                          setContent(e.target.value);
                        }
                      })
                    },
                    "ew"
                  ),
                  diffLines ? jsx7.jsx(
                    "div",
                    {
                      className: "dshWmDiff",
                      children: [
                        jsx7.jsx(
                          "div",
                          {
                            className: "dshWmDiffHead",
                            children: [
                              jsx7.jsx("span", {
                                children: T.diffTitle + " " + diffLabel
                              }),
                              jsx7.jsx("span", { style: { flex: 1 } }),
                              jsx7.jsx("button", {
                                type: "button",
                                className: "dshWmBtn is-ghost",
                                onClick: () => setDiffLines(null),
                                children: T.closeDiff
                              })
                            ]
                          },
                          "dh"
                        ),
                        ...diffLines.map(
                          (d, i) => jsx7.jsx(
                            "div",
                            {
                              className: "dshWmDiffLine " + d.t,
                              children: (d.t === "add" ? "+ " : d.t === "del" ? "- " : "  ") + d.line
                            },
                            "L" + i
                          )
                        )
                      ]
                    },
                    "diff"
                  ) : null,
                  jsx7.jsx(
                    "div",
                    {
                      className: "dshWmStatus",
                      children: [
                        jsx7.jsx("span", {
                          className: "dot " + (dirty ? "is-dirty" : saveState === "saved" ? "is-saved" : "")
                        }),
                        jsx7.jsx("span", {
                          children: dirty ? T.unsaved : saveState === "saved" ? T.saved : "—"
                        }),
                        jsx7.jsx("span", { className: "dshWmStatusSep", children: "·" }),
                        jsx7.jsx("span", {
                          children: `${content.replace(/\s+/g, "").length} ${T.chars}`
                        }),
                        jsx7.jsx("span", {
                          className: "dshWmStatusSep",
                          children: "·"
                        }),
                        jsx7.jsx("span", {
                          children: (filePath || "").toLowerCase().endsWith(".fountain") ? "Fountain" : "Markdown"
                        }),
                        gate ? jsx7.jsx("span", {
                          className: "dshWmStatusSep",
                          children: "·"
                        }) : null,
                        gate ? jsx7.jsx("span", {
                          style: {
                            color: gate.pass ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)",
                            fontWeight: 600
                          },
                          children: gate.pass ? T.gateShort + " ✓" : T.gateShort + " " + gate.fail
                        }) : null
                      ]
                    },
                    "st"
                  )
                ]
              },
              "main"
            ),
            aiOpen ? jsx7.jsx(
              "aside",
              {
                className: "dshWmSide is-ai",
                children: [
                  jsx7.jsxs("div", { className: "dshWmSideHead", children: [
                    jsx7.jsx("button", { className: "dshWmTab" + (aiTab === "companion" ? " is-on" : ""), onClick: () => setAiTab("companion"), children: T.ai }),
                    jsx7.jsx("button", { className: "dshWmTab" + (aiTab === "tools" ? " is-on" : ""), onClick: () => setAiTab("tools"), children: "文字工具" })
                  ] }, "ah"),
                  aiTab === "companion" && !focus ? jsx7.jsx(WritingCompanion, {
                    path: filePath || activeRoot,
                    sourceInfo: () => {
                      const snap = editor.get();
                      return snap.path ? { path: snap.path, revision: snap.revision } : null;
                    },
                    contextText: () => {
                      const selected = Boolean(taRef.current && taRef.current.selectionEnd > taRef.current.selectionStart);
                      const start = selected ? taRef.current.selectionStart : null;
                      const end = selected ? taRef.current.selectionEnd : null;
                      const excerpt = selected ? content.slice(start, end) : content;
                      const snap = editor.get();
                      return makeReference({
                        label: (selected ? "选区 · " : "稿件 · ") + (filePath || "未命名").split(/[\\/]/).pop() + " · " + excerpt.length + " 字",
                        excerpt,
                        path: filePath || null,
                        revision: snap.path === filePath ? snap.revision : null,
                        start,
                        end,
                        dirty: Boolean(snap.dirty),
                        note: "请以我随后补充的想法为准。"
                      });
                    },
                    onExit: close
                  }, "companion") : null,
                  aiTab === "tools" ? jsx7.jsx(
                    "div",
                    {
                      className: "dshWmAiBody",
                      children: [
                        jsx7.jsx(
                          "div",
                          { className: "dshWmAiSection", children: [
                            jsx7.jsx("div", { className: "dshWmAiSectionTitle", children: "AI" }, "at"),
                            jsx7.jsx(
                              "div",
                              {
                                className: "dshWmAiActions",
                                children: ["polish", "continue", "outline", "compress", "expand", "research", "spark"].map(
                                  (a) => jsx7.jsx(
                                    "button",
                                    {
                                      type: "button",
                                      className: "dshWmBtn" + (a === "research" || a === "spark" ? " is-on" : ""),
                                      disabled: aiBusy,
                                      onClick: () => void runAssist(a),
                                      children: T[a] || a
                                    },
                                    a
                                  )
                                )
                              },
                              "acts"
                            )
                          ] },
                          "sec-ai"
                        ),
                        aiBusy ? jsx7.jsx("div", { className: "dshWmAiHint", children: T.applying }) : null,
                        aiErr ? jsx7.jsx("div", { className: "dshWmAiHint", children: aiErr }) : null,
                        jsx7.jsx(
                          "div",
                          { className: "dshWmAiMain", children: [
                            jsx7.jsx("div", { className: "dshWmAiOut", children: aiOut || " " }, "out")
                          ] },
                          "aim"
                        ),
                        jsx7.jsx(
                          "div",
                          {
                            className: "dshWmAiActions",
                            children: [
                              jsx7.jsx("button", {
                                type: "button",
                                className: "dshWmBtn",
                                disabled: !aiOut,
                                onClick: applyInsert,
                                children: T.insert
                              }),
                              jsx7.jsx("button", {
                                type: "button",
                                className: "dshWmBtn",
                                disabled: !aiOut,
                                onClick: applyReplace,
                                children: T.replaceSel
                              }),
                              jsx7.jsx("button", {
                                type: "button",
                                className: "dshWmBtn is-primary",
                                onClick: sendToChat,
                                children: T.sendChat
                              })
                            ]
                          },
                          "apply"
                        ),
                        /* ── 门禁：默认收起，只露一行摘要 ── */
                        jsx7.jsx(
                          "div",
                          {
                            className: "dshWmSec",
                            children: [
                              jsx7.jsx(
                                "button",
                                {
                                  type: "button",
                                  className: "dshWmSecToggle",
                                  onClick: () => setGateOpen((v) => !v),
                                  children: [
                                    jsx7.jsx("span", {
                                      children: (gateOpen ? "▾ " : "▸ ") + T.gates
                                    }, "t"),
                                    jsx7.jsx("span", {
                                      className: "dshWmSecBadge" + (gate ? gate.pass ? " is-pass" : " is-fail" : ""),
                                      children: gateBusy ? T.applying : gate ? gate.pass ? T.gatesPass : T.gatesFail.replace("{n}", String(gate.fail)) : "—"
                                    }, "b")
                                  ]
                                },
                                "gt"
                              ),
                              gateOpen ? jsx7.jsx(
                                "div",
                                {
                                  className: "dshWmSec",
                                  children: [
                                    jsx7.jsx(
                                      "div",
                                      {
                                        className: "dshWmAiActions",
                                        children: [
                                          jsx7.jsx("button", {
                                            type: "button",
                                            className: "dshWmBtn",
                                            disabled: gateBusy || !filePath,
                                            onClick: () => void runGate(),
                                            children: gateBusy ? T.applying : T.runGates
                                          })
                                        ]
                                      },
                                      "gb"
                                    ),
                                    gateErr ? jsx7.jsx("div", {
                                      className: "dshWmAiHint",
                                      children: gateErr
                                    }, "ge") : null,
                                    !gate && !gateErr ? jsx7.jsx("div", {
                                      className: "dshWmAiHint",
                                      children: T.gatesIdle
                                    }, "gi") : null,
                                    gate && gate.rows ? jsx7.jsx(
                                      "div",
                                      {
                                        className: "dshWmGateList",
                                        children: gate.rows.map(
                                          (r, i) => jsx7.jsx(
                                            "div",
                                            {
                                              className: "dshWmGateRow",
                                              children: [
                                                jsx7.jsx("span", {
                                                  className: r.ok ? "ok" : "bad",
                                                  children: r.ok ? "PASS" : "FAIL"
                                                }),
                                                jsx7.jsx("span", {
                                                  className: "dshWmGateLabel",
                                                  children: r.label
                                                }),
                                                jsx7.jsx("span", {
                                                  className: "dshWmGateDetail",
                                                  children: r.detail
                                                })
                                              ]
                                            },
                                            "r" + i
                                          )
                                        )
                                      },
                                      "gl"
                                    ) : null
                                  ]
                                },
                                "gb2"
                              ) : null
                            ]
                          },
                          "gh"
                        ),
                        /* ── 台账：默认收起 ── */
                        jsx7.jsx(
                          "div",
                          {
                            className: "dshWmSec",
                            children: [
                              jsx7.jsx(
                                "button",
                                {
                                  type: "button",
                                  className: "dshWmSecToggle",
                                  onClick: () => setLedgerOpen((v) => !v),
                                  children: [
                                    jsx7.jsx("span", {
                                      children: (ledgerOpen ? "▾ " : "▸ ") + T.ledger
                                    }, "t"),
                                    jsx7.jsx("span", {
                                      className: "dshWmSecBadge",
                                      children: ledger ? (ledger.foreshadowOpen != null ? ledger.foreshadowOpen + " · " : "") + (ledger.latestReview || "—").slice(0, 18) : "—"
                                    }, "b")
                                  ]
                                },
                                "lt"
                              ),
                              ledgerOpen ? ledger ? jsx7.jsx(
                                "div",
                                {
                                  className: "dshWmLedger",
                                  children: [
                                    jsx7.jsx(
                                      "div",
                                      {
                                        className: "dshWmLedgerRow",
                                        children: [
                                          jsx7.jsx("span", {
                                            className: "dshWmLedgerK",
                                            children: T.ledgerHook
                                          }),
                                          jsx7.jsx("span", {
                                            className: "dshWmLedgerV",
                                            children: ledger.hook || "—"
                                          })
                                        ]
                                      },
                                      "lh"
                                    ),
                                    jsx7.jsx(
                                      "div",
                                      {
                                        className: "dshWmLedgerRow",
                                        children: [
                                          jsx7.jsx("span", {
                                            className: "dshWmLedgerK",
                                            children: T.ledgerFores
                                          }),
                                          jsx7.jsx("span", {
                                            className: "dshWmLedgerV",
                                            children: ledger.foreshadowOpen == null ? "—" : String(ledger.foreshadowOpen)
                                          })
                                        ]
                                      },
                                      "lf"
                                    ),
                                    jsx7.jsx(
                                      "div",
                                      {
                                        className: "dshWmLedgerRow",
                                        children: [
                                          jsx7.jsx("span", {
                                            className: "dshWmLedgerK",
                                            children: T.ledgerReview
                                          }),
                                          jsx7.jsx("span", {
                                            className: "dshWmLedgerV",
                                            children: ledger.latestReview || "—"
                                          })
                                        ]
                                      },
                                      "lr"
                                    ),
                                    ledger.timeline && ledger.timeline.length ? jsx7.jsx(
                                      "div",
                                      {
                                        className: "dshWmLedgerRow",
                                        children: [
                                          jsx7.jsx("span", {
                                            className: "dshWmLedgerK",
                                            children: T.ledgerTimeline
                                          }),
                                          jsx7.jsx("span", {
                                            className: "dshWmLedgerV",
                                            children: ledger.timeline[ledger.timeline.length - 1]
                                          })
                                        ]
                                      },
                                      "lts"
                                    ) : null
                                  ]
                                },
                                "lb"
                              ) : jsx7.jsx(
                                "div",
                                {
                                  className: "dshWmAiHint",
                                  children: T.ledgerNone
                                },
                                "ln"
                              ) : null
                            ]
                          },
                          "lsec"
                        ),
                        jsx7.jsx(
                          "div",
                          { className: "dshWmAiHint", children: "Esc · Ctrl+S · Ctrl+Shift+W" },
                          "kbd"
                        )
                      ]
                    },
                    "ab"
                  ) : null
                ]
              },
              "ai"
            ) : null
          ]
        },
        "body"
      )
    ]
  });
}

// plugin/writing-mode/src/client/app/dom-float.js
var domFloatEl = null;
function ensureDomFloat() {
  if (typeof document === "undefined") return;
  if (domFloatEl && document.body.contains(domFloatEl)) return;
  const existing = document.getElementById("dsh-writing-mode-float");
  if (existing) {
    domFloatEl = existing;
    return;
  }
  const btn = document.createElement("button");
  btn.id = "dsh-writing-mode-float";
  btn.type = "button";
  btn.className = "dshWmFloat";
  btn.textContent = T.toggle;
  btn.addEventListener("click", () => setModeActive(!getModeActive()));
  const sync = () => {
    const on = getModeActive();
    btn.classList.toggle("is-on", on);
    btn.textContent = on ? T.exit : T.toggle;
    btn.title = on ? T.exit : T.toggle;
    btn.style.display = "";
    btn.style.zIndex = "95";
  };
  modeListeners.add(sync);
  sync();
  document.body.appendChild(btn);
  domFloatEl = btn;
  if (!window.__dshWritingModeHotkey) {
    window.__dshWritingModeHotkey = true;
    window.addEventListener(
      "keydown",
      (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "w") {
          e.preventDefault();
          setModeActive(!getModeActive());
        }
      },
      true
    );
  }
}

// plugin/writing-mode/src/client/features/settings/WritingModeSettings.js
var react4 = __toESM(require("react"), 1);
var jsx9 = __toESM(require("react/jsx-runtime"), 1);
function WritingModeSettings() {
  const [prefs, setPrefsLocal] = react4.useState(getPrefs);
  const [roots, setRoots] = react4.useState([]);
  const [pathDraft, setPathDraft] = react4.useState("");
  react4.useEffect(() => subscribePrefs(() => setPrefsLocal({ ...getPrefs() })), []);
  react4.useEffect(() => {
    void loadPrefs();
    void api("config").then((d) => {
      if (d.ok) setRoots(d.roots || []);
    }).catch(() => {
    });
  }, []);
  const row = { display: "flex", alignItems: "center", gap: 12, padding: "8px 0" };
  const label = { width: 120, flex: "none", color: "var(--dsw-alias-label-secondary)", fontSize: 13 };
  const hint = { fontSize: 12, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.5 };
  function numInput(key, min, max, step) {
    return jsx9.jsx("input", {
      type: "number",
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(prefs[key]),
      style: {
        width: 90,
        padding: "6px 8px",
        borderRadius: 8,
        border: "1px solid var(--dsw-alias-border-l2)",
        background: "var(--dsw-alias-bg-layer-2)",
        color: "var(--dsw-alias-label-primary)",
        font: "inherit",
        fontSize: 13
      },
      onChange: (e) => void savePrefs({ [key]: Number(e.target.value) })
    });
  }
  async function addRoot() {
    const p = String(pathDraft || "").trim();
    if (!p) return;
    await api("roots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "add", path: p, active: true })
    });
    setPathDraft("");
    const d = await api("config");
    if (d.ok) setRoots(d.roots || []);
    void loadPrefs();
  }
  async function removeRoot(p) {
    await api("roots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "remove", path: p })
    });
    const d = await api("config");
    if (d.ok) setRoots(d.roots || []);
  }
  return jsx9.jsx(
    "div",
    {
      style: {
        width: "100%",
        maxWidth: 640,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        color: "var(--dsw-alias-label-primary)"
      },
      children: [
        jsx9.jsx(
          "div",
          {
            style: { fontSize: 13, color: "var(--dsw-alias-label-tertiary)", marginBottom: 8 },
            children: "写作工作台（Ctrl+Shift+W 或右下角进入）。设置即时生效并写入 ~/.dsh/writing-mode.json。"
          },
          "intro"
        ),
        jsx9.jsx(
          "div",
          {
            style: row,
            children: [
              jsx9.jsx("span", { style: label, children: "库根目录" }),
              jsx9.jsx(
                "div",
                {
                  style: { flex: 1, display: "flex", flexDirection: "column", gap: 6 },
                  children: [
                    ...(roots || []).map(
                      (r) => jsx9.jsx(
                        "div",
                        {
                          style: {
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: 13
                          },
                          children: [
                            jsx9.jsx("span", {
                              style: {
                                flex: 1,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap"
                              },
                              children: (r.missing ? "⚠ " : "") + r.path
                            }),
                            jsx9.jsx("button", {
                              type: "button",
                              className: "dshWmBtn",
                              onClick: () => void removeRoot(r.path),
                              children: "移除"
                            })
                          ]
                        },
                        r.path
                      )
                    ),
                    jsx9.jsx(
                      "div",
                      {
                        style: { display: "flex", gap: 8 },
                        children: [
                          jsx9.jsx("input", {
                            style: {
                              flex: 1,
                              padding: "6px 10px",
                              borderRadius: 8,
                              border: "1px solid var(--dsw-alias-border-l2)",
                              background: "var(--dsw-alias-bg-layer-2)",
                              color: "var(--dsw-alias-label-primary)",
                              font: "inherit",
                              fontSize: 13
                            },
                            placeholder: "例如 E:\\剧本",
                            value: pathDraft,
                            onChange: (e) => setPathDraft(e.target.value),
                            onKeyDown: (e) => {
                              if (e.key === "Enter") void addRoot();
                            }
                          }),
                          jsx9.jsx("button", {
                            type: "button",
                            className: "dshWmBtn is-primary",
                            onClick: () => void addRoot(),
                            children: "添加"
                          })
                        ]
                      },
                      "add"
                    )
                  ]
                }
              )
            ]
          },
          "roots"
        ),
        jsx9.jsx(
          "div",
          {
            style: row,
            children: [
              jsx9.jsx("span", { style: label, children: "正文字号" }),
              numInput("fontSize", 12, 28, 1),
              jsx9.jsx("span", { style: hint, children: "px" })
            ]
          },
          "fs"
        ),
        jsx9.jsx(
          "div",
          {
            style: row,
            children: [
              jsx9.jsx("span", { style: label, children: "行距" }),
              numInput("lineHeight", 1.4, 2.6, 0.05)
            ]
          },
          "lh"
        ),
        jsx9.jsx(
          "div",
          {
            style: row,
            children: [
              jsx9.jsx("span", { style: label, children: "自动保存" }),
              numInput("autoSaveMs", 200, 5e3, 100),
              jsx9.jsx("span", { style: hint, children: "ms（防抖）" })
            ]
          },
          "as"
        ),
        jsx9.jsx(
          "div",
          {
            style: row,
            children: [
              jsx9.jsx("span", { style: label, children: "保存后门禁" }),
              jsx9.jsx("input", {
                type: "checkbox",
                checked: Boolean(prefs.autoGate),
                onChange: (e) => void savePrefs({ autoGate: e.target.checked })
              }),
              jsx9.jsx("span", { style: hint, children: "md / fountain 存盘后自动跑一次" })
            ]
          },
          "ag"
        ),
        jsx9.jsx(
          "div",
          {
            style: {
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px solid var(--dsw-alias-border-l2)",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--dsw-alias-label-tertiary)",
              letterSpacing: "0.06em"
            },
            children: "AI 模型"
          },
          "ai-head"
        ),
        jsx9.jsx(
          "div",
          {
            style: row,
            children: [
              jsx9.jsx("span", { style: label, children: "来源" }),
              jsx9.jsx(
                "select",
                {
                  value: prefs.aiMode === "custom" ? "custom" : "harness",
                  style: {
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--dsw-alias-border-l2)",
                    background: "var(--dsw-alias-bg-layer-2)",
                    color: "var(--dsw-alias-label-primary)",
                    font: "inherit",
                    fontSize: 13
                  },
                  onChange: (e) => void savePrefs({ aiMode: e.target.value === "custom" ? "custom" : "harness" }),
                  children: [
                    jsx9.jsx("option", { value: "harness", children: "Harness 全局默认（文字工具）" }, "h"),
                    jsx9.jsx("option", { value: "custom", children: "自定义 Provider / Model" }, "c")
                  ]
                }
              ),
              jsx9.jsx("span", {
                style: hint,
                children: prefs.aiMode === "custom" ? "润色/续写/找资料走下面配置的模型" : "文字工具使用 Harness 全局默认模型；写作伙伴使用其原生会话模型"
              })
            ]
          },
          "ai-mode"
        ),
        prefs.aiMode === "custom" ? jsx9.jsx(
          "div",
          {
            style: { ...row, alignItems: "flex-start" },
            children: [
              jsx9.jsx("span", { style: label, children: "Provider" }),
              jsx9.jsx("input", {
                style: {
                  flex: 1,
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--dsw-alias-border-l2)",
                  background: "var(--dsw-alias-bg-layer-2)",
                  color: "var(--dsw-alias-label-primary)",
                  font: "inherit",
                  fontSize: 13
                },
                value: prefs.aiProvider,
                placeholder: "deepseek-official",
                onChange: (e) => void savePrefs({ aiProvider: e.target.value })
              })
            ]
          },
          "ai-prov"
        ) : null,
        prefs.aiMode === "custom" ? jsx9.jsx(
          "div",
          {
            style: { ...row, alignItems: "flex-start" },
            children: [
              jsx9.jsx("span", { style: label, children: "Model" }),
              jsx9.jsx("input", {
                style: {
                  flex: 1,
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--dsw-alias-border-l2)",
                  background: "var(--dsw-alias-bg-layer-2)",
                  color: "var(--dsw-alias-label-primary)",
                  font: "inherit",
                  fontSize: 13
                },
                value: prefs.aiModel,
                placeholder: "deepseek-v4-flash",
                onChange: (e) => void savePrefs({ aiModel: e.target.value })
              })
            ]
          },
          "ai-model"
        ) : null,
        prefs.aiMode === "custom" ? jsx9.jsx(
          "div",
          {
            style: { ...row, alignItems: "flex-start" },
            children: [
              jsx9.jsx("span", { style: label, children: "API Key" }),
              jsx9.jsx("input", {
                type: "password",
                style: {
                  flex: 1,
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--dsw-alias-border-l2)",
                  background: "var(--dsw-alias-bg-layer-2)",
                  color: "var(--dsw-alias-label-primary)",
                  font: "inherit",
                  fontSize: 13
                },
                value: prefs.aiApiKey,
                placeholder: "可选；仅本机配置文件",
                onChange: (e) => void savePrefs({ aiApiKey: e.target.value })
              })
            ]
          },
          "ai-key"
        ) : null,
        jsx9.jsx(
          "div",
          {
            style: row,
            children: [
              jsx9.jsx("span", { style: label, children: "进入工作台" }),
              jsx9.jsx("button", {
                type: "button",
                className: "dshWmBtn is-primary",
                onClick: () => setModeActive(true),
                children: "打开写作模式"
              }),
              jsx9.jsx("span", { style: hint, children: "快捷键 Ctrl+Shift+W" })
            ]
          },
          "open"
        )
      ]
    }
  );
}

// plugin/writing-mode/src/client/features/settings/entries.js
var react5 = __toESM(require("react"), 1);
var jsx11 = __toESM(require("react/jsx-runtime"), 1);
function WritingModeFooterEntry() {
  const [on, setOn] = react5.useState(getModeActive);
  react5.useEffect(() => subscribeMode(() => setOn(getModeActive())), []);
  return jsx11.jsx("button", {
    type: "button",
    className: on ? "dshWmBtn is-primary" : "dshWmBtn",
    title: on ? T.exit : T.toggle,
    style: { width: "100%", justifyContent: "center" },
    onClick: () => setModeActive(!on),
    children: on ? T.exit : T.toggle
  });
}
function WritingModeHeaderEntry() {
  const [on, setOn] = react5.useState(getModeActive);
  react5.useEffect(() => subscribeMode(() => setOn(getModeActive())), []);
  return jsx11.jsx("button", {
    type: "button",
    className: "dshWmBtn",
    title: on ? T.exit : T.toggle,
    onClick: () => setModeActive(!on),
    children: on ? T.exit : T.toggle
  });
}

// plugin/writing-mode/src/client/entry.js
var __wmAlreadyLoaded = window.__dshWritingModeLoaded === true;
window.__dshWritingModeLoaded = true;
var name = "writing-mode";
ensureWritingCss();
var inject = __wmAlreadyLoaded ? [] : ["slots", "sessions", "connection", "workspaces"];
function apply(ctx) {
  if (__wmAlreadyLoaded) return;
  bindHarness(ctx);
  try {
    ensureDomFloat();
  } catch (err) {
    console.warn("[writing-mode] float inject failed:", err);
  }
  try {
    ctx.effect(
      () => ctx.slots.inject(
        "shell.overlay",
        () => ctx.slots.register(
          {
            name: "shell.overlay",
            id: "writing-mode",
            order: 20,
            label: () => T.toggle
          },
          WritingModeApp
        )
      ),
      "writing-mode: overlay"
    );
  } catch (err) {
    console.warn("[writing-mode] shell.overlay register failed:", err);
  }
  try {
    ctx.effect(
      () => ctx.slots.inject(
        "sidebar.footer.action",
        () => ctx.slots.register(
          {
            name: "sidebar.footer.action",
            id: "writing-mode",
            order: 30,
            label: () => T.toggle
          },
          WritingModeFooterEntry
        )
      ),
      "writing-mode: sidebar-footer"
    );
  } catch (err) {
    console.warn("[writing-mode] sidebar.footer.action register failed:", err);
  }
  try {
    ctx.effect(
      () => ctx.slots.inject(
        "conversation.session.header.utilities",
        () => ctx.slots.register(
          {
            name: "conversation.session.header.utilities",
            id: "writing-mode",
            order: 40,
            label: () => T.toggle
          },
          WritingModeHeaderEntry
        )
      ),
      "writing-mode: header-util"
    );
  } catch (err) {
    console.warn("[writing-mode] header.utilities register failed:", err);
  }
  try {
    ctx.effect(
      () => ctx.slots.inject(
        "settings.section",
        () => ctx.slots.register(
          {
            name: "settings.section",
            id: "writing-mode",
            order: 46,
            label: () => "写作模式"
          },
          WritingModeSettings
        )
      ),
      "writing-mode: settings"
    );
  } catch (err) {
    console.warn("[writing-mode] settings.section register failed:", err);
  }
  console.info("[writing-mode] client ready · float=DOM · overlay+sidebar+settings");
}
    return module.exports
  },
})
