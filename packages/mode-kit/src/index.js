/**
 * `@dsh-local/mode-kit` 公共入口（barrel）。
 *
 * 定位（见 dsh-desktop/docs/plans/workbench-layer-v1.md §5.2）：
 *   把「一个创作模式怎么跟 dsh 内核打交道」这件事抽成一份实现——会话查找/创建/绑定、
 *   会话图投影、项目身份归一、跨窗口创建协调。写作模式（writing-mode）是第一个用户；
 *   GIR 生图模式按需接入。
 *
 * **重要：这是构建期共享，不是运行期共享模块。**
 *   内核的客户端 bundle 纯净门禁禁止跨插件值导入（"collaboration through cordis services"），
 *   所以各模式在**构建时**把本库内联进自己的 client.js（写作模式用 esbuild 打包；GIR 的
 *   client.js 目前是手写无构建，要接入就得先给它加构建或 vendor 一份 + 漂移门禁）。
 *   运行时不存在 `@dsh-local/mode-kit` 这个包，也不该有插件去 require 它。
 */
export { canonicalProjectKey, projectIdentityOf } from './harness/identity.js'
export {
  textOf,
  stripInjectedBlocks,
  projectChat,
  turnBaseline,
  turnEvidence,
  createSnapshotCache,
} from './harness/projection.js'
export { httpCoordination } from './harness/coordination-client.js'
export { PEER_WAIT, adapterError, newOperationToken, createHarnessAdapter } from './harness/adapter.js'
