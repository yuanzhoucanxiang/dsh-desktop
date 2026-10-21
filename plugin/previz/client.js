/**
 * GENERATED FILE — do not hand-edit.
 * Source: plugin/previz/src/client/entry.js (+ ./PrevizPanel.js, ./PrevizEntry.js, ./PrevizOverlay.js, ./mode.js, ./store.js, ./api.js)
 * Build:  node scripts/build-previz-client.mjs   (or npm run build:previz)
 * Bundle: esbuild (CJS) wrapped as window.__ModuleLoader__.load factory body
 */
window.__ModuleLoader__.load({
  id: "@dsh-local/previz",
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

// plugin/previz/src/client/entry.js
var entry_exports = {};
__export(entry_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(entry_exports);

// plugin/previz/src/client/PrevizEntry.js
var react2 = __toESM(require("react"), 1);

// plugin/previz/src/client/api.js
var API = "/api/previz";
async function api(route, body) {
  const url = `${API}?route=${encodeURIComponent(route)}`;
  const init = body === void 0 ? { method: "GET" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return { ok: false, error: "network", detail: String(err?.message || err) };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: `http-${res.status}` };
  }
  if (!res.ok && json && json.ok === void 0) return { ok: false, error: `http-${res.status}`, detail: json.error };
  return json;
}
function artifactUrl(rel) {
  return `${API}?route=artifact&path=${encodeURIComponent(String(rel || ""))}`;
}
function selectProject(id) {
  return api("project", { id });
}
function createProject(id, title) {
  return api("project-create", { id, title });
}

// plugin/previz/src/client/store.js
var last = null;
var timer = null;
var polling = false;
var stateSubs = /* @__PURE__ */ new Set();
var jobSubs = /* @__PURE__ */ new Set();
var artifactSubs = /* @__PURE__ */ new Set();
var runtimeSubs = /* @__PURE__ */ new Set();
var workbenchPresent = false;
var wbSubs = /* @__PURE__ */ new Set();
var workbenchService = null;
var activeModeId = null;
var activeSubs = /* @__PURE__ */ new Set();
var ui = { open: false, selected: null };
var uiSubs = /* @__PURE__ */ new Set();
function getLast() {
  return last;
}
function getUi() {
  return ui;
}
function setUi(patch) {
  ui = { ...ui, ...patch };
  for (const fn of [...uiSubs]) {
    try {
      fn();
    } catch {
    }
  }
}
function subscribeUi(fn) {
  uiSubs.add(fn);
  return () => uiSubs.delete(fn);
}
function subscribeState(fn) {
  stateSubs.add(fn);
  return () => stateSubs.delete(fn);
}
function subscribeJobs(fn) {
  jobSubs.add(fn);
  return () => jobSubs.delete(fn);
}
function subscribeRuntime(fn) {
  runtimeSubs.add(fn);
  return () => runtimeSubs.delete(fn);
}
function isWorkbenchPresent() {
  return workbenchPresent;
}
function setWorkbenchPresent(value) {
  const next = !!value;
  if (workbenchPresent === next) return;
  workbenchPresent = next;
  for (const fn of [...wbSubs]) {
    try {
      fn();
    } catch {
    }
  }
}
function subscribeWorkbench(fn) {
  wbSubs.add(fn);
  return () => wbSubs.delete(fn);
}
function setWorkbenchService(wb) {
  workbenchService = wb || null;
  activeModeId = workbenchService?.getActive?.() || null;
  if (workbenchService?.subscribe) {
    try {
      workbenchService.subscribe(() => {
        const next = workbenchService.getActive?.() || null;
        if (next === activeModeId) return;
        activeModeId = next;
        for (const fn of [...activeSubs]) {
          try {
            fn();
          } catch {
          }
        }
      });
    } catch (err) {
      console.warn("[previz] workbench subscribe failed:", err);
    }
  }
}
function getActiveModeId() {
  return activeModeId;
}
function subscribeActive(fn) {
  activeSubs.add(fn);
  return () => activeSubs.delete(fn);
}
function exitPreviz() {
  if (workbenchService?.setActive) {
    return workbenchService.setActive(null, "exit");
  }
  setUi({ open: false });
  return { ok: true };
}
function notify(set) {
  for (const fn of [...set]) {
    try {
      fn();
    } catch (err) {
      console.warn("[previz] subscriber failed:", err);
    }
  }
}
async function refresh() {
  const next = await api("state");
  if (!next || next.ok === false) return next;
  const prev = last;
  last = next;
  notify(stateSubs);
  if (prev?.job?.state !== next.job?.state || prev?.job?.progress !== next.job?.progress) notify(jobSubs);
  if ((prev?.artifacts?.length || 0) !== (next.artifacts?.length || 0)) notify(artifactSubs);
  if (prev?.runtime?.state !== next.runtime?.state) notify(runtimeSubs);
  return next;
}
function startPolling() {
  if (polling) return () => {
  };
  polling = true;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    await refresh();
    if (!stopped) timer = setTimeout(tick, 2500);
  };
  void tick();
  return () => {
    stopped = true;
    polling = false;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

// plugin/previz/src/client/usePreviz.js
var react = __toESM(require("react"), 1);
function useSnapshot() {
  const [snap, setSnap] = react.useState(getLast());
  react.useEffect(() => subscribeState(() => setSnap(getLast())), []);
  return snap;
}
function useUiState() {
  const [ui2, setUi2] = react.useState(getUi());
  react.useEffect(() => subscribeUi(() => setUi2(getUi())), []);
  return ui2;
}
function useWorkbenchPresent() {
  const [present, setPresent] = react.useState(isWorkbenchPresent());
  react.useEffect(() => subscribeWorkbench(() => setPresent(isWorkbenchPresent())), []);
  return present;
}
function useActiveModeId() {
  const [active, setActive] = react.useState(getActiveModeId());
  react.useEffect(() => subscribeActive(() => setActive(getActiveModeId())), []);
  return active;
}

// plugin/previz/src/client/PrevizEntry.js
var h = react2.createElement;
function PrevizEntry() {
  const ui2 = useUiState();
  const wb = useWorkbenchPresent();
  if (wb) return null;
  return h(
    "button",
    {
      type: "button",
      onClick: () => setUi({ open: !ui2.open }),
      title: "白模预演（P0 demo）",
      "aria-label": "预演",
      "data-previz-entry": "",
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        border: "1px solid var(--dsw-alias-border-l2)",
        borderRadius: 7,
        background: "transparent",
        color: "var(--dsw-alias-label-primary)",
        cursor: "pointer",
        fontSize: 12
      }
    },
    h("span", { "aria-hidden": "true" }, "◫"),
    h("span", null, "预演")
  );
}

// plugin/previz/src/client/PrevizOverlay.js
var react4 = __toESM(require("react"), 1);

// plugin/previz/src/client/PrevizPanel.js
var react3 = __toESM(require("react"), 1);
var h2 = react3.createElement;
var S = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    height: "100%",
    minHeight: 0,
    padding: 14,
    boxSizing: "border-box",
    color: "var(--dsw-alias-label-primary)",
    background: "var(--dsw-alias-bg-base)",
    font: "13px/1.5 system-ui, sans-serif"
  },
  header: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  title: { fontWeight: 700, fontSize: 15 },
  muted: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 },
  pill: (color) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "1px 8px",
    borderRadius: 999,
    border: `1px solid ${color}`,
    color,
    fontSize: 11,
    lineHeight: "17px",
    whiteSpace: "nowrap"
  }),
  btn: (kind) => ({
    padding: "4px 10px",
    borderRadius: 7,
    border: "1px solid var(--dsw-alias-border-l2)",
    background: kind === "primary" ? "var(--dsw-alias-brand-primary)" : "transparent",
    color: kind === "primary" ? "var(--dsw-alias-bg-base)" : "var(--dsw-alias-label-primary)",
    cursor: "pointer",
    fontSize: 12,
    opacity: kind === "disabled" ? 0.55 : 1
  }),
  body: { display: "flex", gap: 12, flex: 1, minHeight: 0 },
  main: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 },
  side: { width: 250, flex: "none", display: "flex", flexDirection: "column", gap: 6, minHeight: 0 },
  panel: {
    border: "1px solid var(--dsw-alias-border-l1)",
    borderRadius: 10,
    background: "var(--dsw-alias-bg-layer-1)",
    padding: 10
  },
  preview: {
    flex: 1,
    minHeight: 160,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--dsw-alias-bg-layer-2)",
    borderRadius: 10,
    overflow: "hidden"
  },
  video: { width: "100%", maxHeight: "48vh", background: "#000", display: "block" },
  img: { maxWidth: "100%", maxHeight: "48vh", objectFit: "contain", display: "block" },
  artifact: (active) => ({
    textAlign: "left",
    padding: "5px 8px",
    borderRadius: 7,
    border: `1px solid ${active ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-border-l1)"}`,
    background: active ? "var(--dsw-alias-interactive-bg-hover)" : "transparent",
    color: "var(--dsw-alias-label-primary)",
    cursor: "pointer",
    fontSize: 12
  }),
  log: {
    margin: 0,
    maxHeight: 110,
    overflow: "auto",
    padding: 8,
    borderRadius: 8,
    background: "var(--dsw-alias-bg-layer-2)",
    color: "var(--dsw-alias-label-secondary)",
    fontSize: 11,
    whiteSpace: "pre-wrap"
  },
  row: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }
};
function runtimeColor(state) {
  if (state === "ready") return "var(--dsw-alias-brand-primary)";
  if (state === "down") return "var(--dsw-alias-label-warning, #d8a657)";
  if (state === "error") return "var(--dsw-alias-label-danger, #e06c75)";
  return "var(--dsw-alias-label-tertiary)";
}
function runtimeText(runtime) {
  if (!runtime) return "读取中…";
  if (runtime.state === "ready") return "Blender 就绪";
  if (runtime.state === "down") return "后端未启动";
  if (runtime.state === "starting") return "启动中…";
  return "后端异常";
}
function jobText(job) {
  if (!job) return "空闲";
  if (job.state === "running") {
    return Number.isFinite(job.progress) ? `渲染中 ${Math.round(job.progress * 100)}%` : "渲染中…";
  }
  return { done: "已完成", failed: "失败", cancelled: "已取消", queued: "排队中" }[job.state] || job.state;
}
function PrevizPanel({ compact = false } = {}) {
  const snap = useSnapshot();
  const ui2 = useUiState();
  const [busy, setBusy] = react3.useState(false);
  const [error, setError] = react3.useState("");
  const [notice, setNotice] = react3.useState("");
  const [creating, setCreating] = react3.useState(false);
  const [newId, setNewId] = react3.useState("");
  const [newTitle, setNewTitle] = react3.useState("");
  const runtime = snap?.runtime || null;
  const job = snap?.job || null;
  const artifacts = snap?.artifacts || [];
  const projects = snap?.projects || [];
  const project = snap?.project || null;
  const selected = artifacts.find((a) => a.path === ui2.selected) || artifacts.find((a) => a.kind === "animatic") || artifacts.find((a) => a.kind === "image") || null;
  const running = job?.state === "running" || job?.state === "queued";
  async function act(fn, okText) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await fn();
      if (!result || result.ok === false) {
        setError(result?.detail || result?.error || "操作失败");
      } else {
        if (okText) setNotice(okText);
        await refresh();
      }
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  }
  const run = () => act(() => api("demo", {}), "已开始构建 / 渲染");
  const cancel = () => act(() => api("cancel", {}), "已取消");
  const probe = () => act(() => api("probe"), "已重新探测");
  const openBlender = () => act(() => api("open-blender", {}), "已请求打开 Blender");
  const switchProject = (e) => {
    const id = e.target.value;
    if (!id || id === project?.id) return;
    void act(() => selectProject(id), `已切到 ${id}`);
  };
  const newProject = () => {
    setCreating(true);
    setNewId("");
    setNewTitle("");
    setError("");
    setNotice("");
  };
  const confirmCreate = () => {
    const id = newId.trim();
    if (!id) {
      setError("项目 id 不能为空");
      return;
    }
    const title = newTitle.trim() || id;
    void act(async () => {
      const r = await createProject(id, title);
      if (r?.ok) setCreating(false);
      return r;
    }, `已创建 ${id}`);
  };
  const projectPicker = h2(
    "select",
    {
      value: project?.id || "",
      onChange: switchProject,
      disabled: busy || running,
      title: running ? "有任务在跑，先取消再切项目" : "切换项目",
      style: { ...S.btn(), paddingRight: 18 },
      "data-previz-project": ""
    },
    projects.length ? projects.map((p) => h2("option", { key: p.id, value: p.id, disabled: !p.valid }, `${p.valid ? "" : "（缺文件）"}${p.id} · ${p.title}`)) : h2("option", { value: project?.id || "" }, project?.title || "boutique")
  );
  const newProjectBtn = h2(
    "button",
    {
      type: "button",
      onClick: newProject,
      disabled: busy || running,
      title: "从 boutique starter 新建项目",
      style: S.btn(),
      "data-previz-new-project": ""
    },
    "新建"
  );
  const header = h2(
    "div",
    { style: S.header },
    h2("span", { style: S.title }, "预演"),
    projectPicker,
    newProjectBtn,
    h2("span", { style: S.pill(runtimeColor(runtime?.state)) }, runtimeText(runtime)),
    h2("span", { style: S.pill(running ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-border-l2)") }, jobText(job)),
    h2("span", { style: { flex: 1 } }),
    runtime?.state === "ready" ? h2("button", { type: "button", style: S.btn("primary"), disabled: busy || running, onClick: run, title: running ? "有任务在跑" : "构建 + 渲染 + 编码 + QC" }, "运行 demo") : h2("button", { type: "button", style: S.btn("primary"), disabled: busy, onClick: probe }, "重新探测"),
    running ? h2("button", { type: "button", style: S.btn(), disabled: busy, onClick: cancel }, "取消") : null,
    runtime?.state === "ready" ? h2("button", { type: "button", style: S.btn(), disabled: busy, onClick: openBlender }, "打开 Blender") : null,
    h2("button", { type: "button", style: S.btn(), disabled: busy, onClick: () => void refresh() }, "刷新")
  );
  const runtimeBox = runtime && runtime.state !== "ready" ? h2(
    "div",
    { style: S.panel },
    h2("div", { style: { fontWeight: 600, marginBottom: 4 } }, runtimeText(runtime)),
    h2("div", { style: S.muted }, runtime.detail || "没有更多信息"),
    h2(
      "div",
      { style: { ...S.muted, marginTop: 6 } },
      "下一步：设置环境变量 PREVIZ_BLENDER，或安装 Blender 5.2 / 把 ffmpeg 放进 PATH，然后点「重新探测」。"
    )
  ) : null;
  const createRow = creating ? h2(
    "div",
    { style: { ...S.panel, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }, "data-previz-create-row": "" },
    h2("input", {
      value: newId,
      onChange: (e) => setNewId(e.target.value),
      placeholder: "项目 id（字母/数字/._-）",
      style: { ...S.btn(), minWidth: 150, cursor: "text" },
      "data-previz-new-id": ""
    }),
    h2("input", {
      value: newTitle,
      onChange: (e) => setNewTitle(e.target.value),
      placeholder: "标题（可空）",
      style: { ...S.btn(), minWidth: 130, cursor: "text" },
      "data-previz-new-title": ""
    }),
    h2("button", { type: "button", style: S.btn("primary"), onClick: confirmCreate, disabled: busy }, "创建"),
    h2("button", { type: "button", style: S.btn(), onClick: () => setCreating(false), disabled: busy }, "取消")
  ) : null;
  const feedback = error || notice ? h2("div", { style: { ...S.muted, color: error ? "var(--dsw-alias-label-danger, #e06c75)" : "var(--dsw-alias-brand-primary)" } }, error || notice) : null;
  const preview = selected ? String(selected.path).endsWith(".mp4") ? h2("video", { key: selected.path, src: artifactUrl(selected.path), controls: true, style: S.video }) : String(selected.path).endsWith(".png") ? h2("img", { key: selected.path, src: artifactUrl(selected.path), alt: selected.title, style: S.img }) : h2(
    "div",
    { style: S.panel },
    h2("div", { style: { fontWeight: 600 } }, selected.title),
    h2("div", { style: S.muted }, "这个产物不是视频/图片；点右侧下载或打开原文件。")
  ) : h2("div", { style: { ...S.muted, padding: 24 } }, running ? "渲染中…完成后这里会出现 animatic / 平面图。" : "还没有产物。点「运行 demo」。");
  const list = h2(
    "div",
    { style: S.side },
    h2("div", { style: { ...S.muted, fontWeight: 600 } }, "最近产物"),
    artifacts.length ? artifacts.map(
      (a) => h2(
        "button",
        {
          key: a.path,
          type: "button",
          style: S.artifact(selected?.path === a.path),
          onClick: () => setUi({ selected: a.path }),
          title: a.path
        },
        a.title || a.path,
        h2("span", { style: { ...S.muted, marginLeft: 6 } }, a.kind)
      )
    ) : h2("div", { style: S.muted }, "暂无"),
    selected ? h2(
      "a",
      { href: artifactUrl(selected.path), target: "_blank", rel: "noreferrer", style: { ...S.muted, marginTop: 4 } },
      "在新窗口打开原文件"
    ) : null,
    h2("div", { style: { ...S.muted, marginTop: "auto" } }, "P0 demo · 2 人 3 镜 9 秒 · 产出在临时目录")
  );
  const log = job?.logTail?.length ? h2("pre", { style: S.log }, job.logTail.slice(-12).join("\n")) : null;
  return h2(
    "div",
    { style: { ...S.root, padding: compact ? 10 : 14 }, "data-previz-panel": "" },
    header,
    createRow,
    runtimeBox,
    feedback,
    h2(
      "div",
      { style: S.body },
      h2(
        "div",
        { style: S.main },
        h2("div", { style: S.preview }, preview),
        job ? h2("div", { style: S.row }, h2("span", { style: S.muted }, `任务 ${job.id} · ${jobText(job)}`), job.error ? h2("span", { style: { ...S.muted, color: "var(--dsw-alias-label-danger, #e06c75)" } }, job.error) : null) : null,
        log
      ),
      list
    )
  );
}
function PrevizTile() {
  const snap = useSnapshot();
  const runtime = snap?.runtime;
  const job = snap?.job;
  const plan = (snap?.artifacts || []).find((a) => a.path === "plan.png");
  return h2(
    "div",
    { style: { padding: 10, display: "flex", flexDirection: "column", gap: 6 }, "data-previz-tile": "" },
    h2("div", { style: S.row }, h2("strong", null, "预演 · P0 demo"), h2("span", { style: S.pill(runtimeColor(runtime?.state)) }, runtimeText(runtime))),
    h2("div", { style: S.muted }, job ? jobText(job) : "2 人 3 镜 9 秒；运行 demo 出 animatic + 平面图。"),
    plan ? h2("img", { src: artifactUrl(plan.path), alt: "平面图", style: { width: "100%", maxHeight: 150, objectFit: "contain", borderRadius: 6 } }) : null
  );
}

// plugin/previz/src/client/PrevizOverlay.js
var h3 = react4.createElement;
function PrevizOverlay() {
  const ui2 = useUiState();
  const wb = useWorkbenchPresent();
  const active = useActiveModeId();
  const activePreviz = wb && active === "previz";
  const show = activePreviz || !wb && ui2.open;
  if (!show) return null;
  const close = () => {
    if (activePreviz) void exitPreviz();
    else setUi({ open: false });
  };
  return h3(
    "div",
    {
      style: {
        position: "fixed",
        inset: 0,
        zIndex: 2e3,
        display: "flex",
        flexDirection: "column",
        background: "var(--dsw-alias-bg-base)"
      },
      "data-previz-overlay": ""
    },
    h3(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderBottom: "1px solid var(--dsw-alias-border-l1)"
        }
      },
      h3("strong", { style: { fontSize: 14 } }, "预演"),
      h3("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 } }, "P0 demo"),
      h3("span", { style: { flex: 1 } }),
      h3(
        "button",
        {
          type: "button",
          onClick: close,
          style: {
            padding: "2px 9px",
            border: "1px solid var(--dsw-alias-border-l2)",
            borderRadius: 7,
            background: "transparent",
            color: "var(--dsw-alias-label-primary)",
            cursor: "pointer"
          }
        },
        wb && active === "previz" ? "退出预演" : "关闭"
      )
    ),
    h3("div", { style: { flex: 1, minHeight: 0 } }, h3(PrevizPanel, { compact: false }))
  );
}

// plugin/previz/src/client/mode.js
function registerPrevizMode(workbench) {
  if (!workbench || typeof workbench.registerMode !== "function") return null;
  return workbench.registerMode({
    id: "previz",
    label: () => "预演",
    order: 40,
    mount: "overlay",
    canDeactivate: async () => true,
    onActivate: () => {
      void refresh();
    },
    context: {
      get: () => {
        const snap = getLast();
        const running = snap?.job?.state === "running";
        return {
          kind: "previz",
          title: "预演 · 小店",
          project: "boutique",
          doc: running ? "渲染中" : snap?.job?.state === "done" ? "animatic 已就绪" : null
        };
      }
    },
    runtime: {
      probe: async () => {
        const result = await api("probe");
        if (result?.runtime) return result.runtime;
        return { state: "error", detail: result?.detail || result?.error || "probe failed", version: null };
      },
      start: () => api("open-blender", {}),
      subscribe: (fn) => subscribeRuntime(fn)
    },
    jobs: {
      list: () => {
        const job = getLast()?.job;
        return job ? [job] : [];
      },
      cancel: () => api("cancel", {}),
      subscribe: (fn) => subscribeJobs(fn)
    },
    artifacts: {
      list: () => getLast()?.artifacts || [],
      open: (ref) => {
        const path = typeof ref === "string" ? ref : ref?.path || ref?.id || null;
        setUi({ selected: path });
        return true;
      }
    },
    splice: { label: "预演", view: PrevizPanel, width: 960 },
    tile: { label: "预演", view: PrevizTile, order: 40 }
  });
}

// plugin/previz/src/client/entry.js
var already = window.__dshPrevizLoaded === true;
window.__dshPrevizLoaded = true;
var name = "previz";
var inject = already ? [] : ["slots"];
function apply(ctx) {
  if (already) return;
  ctx.effect(() => startPolling(), "previz: polling");
  const register = (slot, options, Component, tag) => {
    try {
      ctx.effect(() => ctx.slots.inject(slot, () => ctx.slots.register(options, Component)), tag);
    } catch (err) {
      console.warn("[previz] slot register failed:", slot, err);
    }
  };
  register("sidebar.footer.action", { name: "sidebar.footer.action", id: "previz", order: 11, label: () => "预演" }, PrevizEntry, "previz: standalone entry");
  register("shell.overlay", { name: "shell.overlay", id: "previz", order: 9, label: () => "预演" }, PrevizOverlay, "previz: standalone overlay");
  try {
    ctx.inject(["workbench"], (scope) => {
      setWorkbenchPresent(true);
      setWorkbenchService(scope?.workbench);
      try {
        registerPrevizMode(scope?.workbench);
      } catch (err) {
        console.warn("[previz] registerMode failed:", err);
      }
    });
  } catch (err) {
    console.warn("[previz] workbench inject failed:", err);
  }
  console.info("[previz] client ready · standalone entry + workbench mode");
}
    return module.exports
  },
})
