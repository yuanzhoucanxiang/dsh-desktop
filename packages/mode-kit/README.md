# @dsh-local/mode-kit —— 创作模式的共用底座

把「一个创作模式怎么跟 dsh 内核打交道」抽成一份实现，供写作模式（`plugin/writing-mode`）与
GIR 生图模式（`E:\GIR\gir-dsh` / 发布线）共用。设计依据
`dsh-desktop/docs/plans/workbench-layer-v1.md` §5.2；2026-10-11 P3 从写作模式里抽出。

## 里面有什么

| 模块 | 职责 |
|---|---|
| `src/harness/adapter.js` | **唯一 native 接触面**：会话查找/创建/绑定、双栈创建（`remote.session.create`+`workspaces.create` / 旧三步）、聚焦四级退路、输入双通道、`send` 三态、创建协调、迟到结果身份核对 |
| `src/harness/projection.js` | 会话图投影（`chat` → 稳定行列表）、`stripInjectedBlocks`（剥掉注入的上下文块）、快照缓存 |
| `src/harness/identity.js` | 项目身份归一（Windows 大小写/分隔符/尾斜杠） |
| `src/harness/coordination-client.js` | 跨窗口创建协调的协议客户端（`api` **必填**，由模式注入自己的 HTTP 入口） |

`createHarnessAdapter(deps)` 是**全依赖注入**的：`sessions / workspaces / connection / remoteSession /
uiWorkspace / uiConversation / conversation / userQuestions / api / coordination / now / wait / log`
都由调用方给。库本身不 import React / DOM / 任何宿主插件的模块（`npm run test:mode-kit` 会用
结构检查守住这条：包内出现裸包名或逃出包边界的 import 一律红）。

## 怎么被使用（重要：这是**构建期**共享，不是运行期模块）

内核客户端 bundle 的纯净门禁禁止跨插件值导入（"collaboration through cordis services"），
所以各模式在**构建时**把本库内联进自己的 `client.js`：

- **写作模式**：esbuild 打包（`npm run build:writing`）。它保留
  `plugin/writing-mode/src/client/adapters/harness/*.js` 四个**再导出 shim**——审计探针
  （`docs/audits/` 下各期 `probes.mjs`）、单测与 src 内部仍按老路径 import，换路径会同时打断它们。
  shim 与库必须逐名一致，`npm run test:mode-kit` 守这条漂移。
- **GIR 生图模式**：它的 `client.js` 目前是**手写、无构建**的。要接入有两条路：① 给它加构建
  （把本库当依赖打包进去，推荐）；② vendor 一份源码进 GIR 仓库 + 漂移门禁（改动更小但会分叉）。
  两条都属 GIR 仓库自己的决定，本库不替它选。

运行期**不存在** `@dsh-local/mode-kit` 这个包：不要在插件里 `require`/`import` 它，
也不要在 `dsh.client.inject` 里声明它。

## 不放进来的东西（各模式自己保留）

模式自己的 HTTP 路由与 `api()` 入口、协调记录的服务端实现、preset 与工具集、领域数据模型与 UI、
以及模式特有的可靠性机器（例如写作模式的跨进程文件锁、草稿 checkpoint 分桶）。

## 门禁

```
npm run test:mode-kit      # 导出面 + shim 漂移 + 结构边界 + api 必填
npm run build:writing      # 内联进写作模式 client.js
npm run verify:writing-build
```

`test:mode-kit` 已接进 `verify:writing-quick` / `verify:writing-all` 两条链。
