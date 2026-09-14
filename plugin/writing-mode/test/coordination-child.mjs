// 跨进程协调记录 fixture：作为**另一个进程**执行一次 claim + confirm，验证记录能被真实跨进程写入。
// 用法：node coordination-child.mjs <projectKey> <operationToken>
import process from 'node:process'

const [projectKey, operationToken] = process.argv.slice(2)
const { claimCoordination, markCreatingCoordination, confirmCoordination } = await import('../lib/coordination.js')

const claimed = claimCoordination({ projectKey, operationToken, owner: `child-${process.pid}` })
if (claimed._outcome !== 'claimed') {
  console.error(`child 未拿到创建权：${claimed._outcome}`)
  process.exit(2)
}
markCreatingCoordination({ projectKey, operationToken })
const bound = confirmCoordination({ projectKey, operationToken, sessionId: `sess-${process.pid}`, workspaceId: `ws-${process.pid}` })
if (bound._outcome !== 'bound') {
  console.error(`child 确认失败：${bound._outcome}`)
  process.exit(3)
}
console.log(JSON.stringify({ pid: process.pid, sessionId: bound.sessionId, version: bound.version }))
