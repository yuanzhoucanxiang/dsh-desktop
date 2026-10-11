/**
 * Harness adapter —— 实现已抽到共享库 `@dsh-local/mode-kit`（2026-10-11 P3）。
 *
 * 这里**只做再导出**：审计探针（docs/audits 下各期 probes.mjs）、单测与 src 内部都按这条
 * 老路径 import，换路径会同时打断它们（审计探针是历史证据，不能改）。
 *
 * 实现：packages/mode-kit/src/harness/adapter.js。
 * 构建期由 esbuild 内联进 client.js —— 内核客户端 bundle 的纯净门禁禁止跨插件值导入，
 * 运行期并不存在 `@dsh-local/mode-kit` 这个包。
 *
 * 注意：本注释里不要出现星号加斜杠的路径通配（会提前终止块注释，node --check 直接报
 * Unexpected identifier）。
 */
export { PEER_WAIT, adapterError, newOperationToken, createHarnessAdapter } from '../../../../../../packages/mode-kit/src/harness/adapter.js'
