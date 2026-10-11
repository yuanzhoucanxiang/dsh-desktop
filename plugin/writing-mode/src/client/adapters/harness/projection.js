/**
 * 会话投影 —— 实现已抽到共享库 `@dsh-local/mode-kit`（2026-10-11 P3）。
 * 这里只做再导出；实现见 `packages/mode-kit/src/harness/projection.js`。
 */
export {
  textOf,
  stripInjectedBlocks,
  projectChat,
  turnBaseline,
  turnEvidence,
  createSnapshotCache,
} from '../../../../../../packages/mode-kit/src/harness/projection.js'
