'use strict'

/**
 * 只清理**本轮创建**的进程树（N01）。
 *
 * 纪律（来源：工作区/仓库 AGENTS.md「不擅自关闭用户桌面」）：
 *   **绝不**按镜像名或路径批量结束进程——同名进程里可能有用户正在用的正式桌面，
 *   那与本次测试的 PID/环境无关。清理只能按"我们亲手 spawn 出来的 PID"来做。
 *
 * 这里提供两个纯函数，方便用隔离测试证明"另一个同名进程不在清理集合里"。
 */

const { spawnSync } = require('node:child_process')

/** 结束一棵进程树（含它拉起的子进程，如内核）。只接受具体 PID。 */
function killTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false
  try {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    return true
  } catch {
    return false
  }
}

/** 某个 PID 是否仍存活（只针对该 PID，不扫同名进程）。 */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return Boolean(err && err.code === 'EPERM')
  }
}

/** 清理集合的选择规则：只收下调用方显式登记的 PID（可证明归属）。 */
function selectCleanupTargets(spawned) {
  return (Array.isArray(spawned) ? spawned : [])
    .map((x) => (typeof x === 'number' ? x : x && x.pid))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
}

module.exports = { killTree, pidAlive, selectCleanupTargets }
