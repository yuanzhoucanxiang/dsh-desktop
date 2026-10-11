/**
 * 协调协议 HTTP 客户端 —— 实现已抽到共享库 `@dsh-local/mode-kit`（2026-10-11 P3）。
 * 这里只做再导出；实现见 `packages/mode-kit/src/harness/coordination-client.js`。
 *
 * 注意：抽库后 `httpCoordination(api)` 的 `api` 变成**必填**（库不再默认 import 写作模式的
 * writing-api）。写作模式自己的调用点（`runtime.js` → adapter 的 `api` 依赖）本来就显式传，
 * 所以这里不需要额外适配。
 */
export { httpCoordination } from '../../../../../../packages/mode-kit/src/harness/coordination-client.js'
