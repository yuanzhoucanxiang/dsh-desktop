// 协调记录（lib/coordination.js）单测：阶段机、token 语义、锁与坏记录的安全边界。
// 覆盖的验收场景（方案 H01–H07 里 host 侧可判定的部分）：
//   H01 两个窗口同时首次关联 → 只有一个 claim 成功，另一个拿到 in-progress（不重复创建）
//   H02 连点：同一 operationToken 重复 claim 幂等
//   H04 workspace 已建但 session 结果丢失 → 只能写部分绑定，不假装 bound
//   H05 绑定确认失败 → uncertain，且新 claim 看到 uncertain（走恢复而不是新建）
//   H06 会话被删 → 明确 forget 后才允许重新 claim
// 另测：过期 token 无法改写新绑定、释放的安全边界、坏 JSON 保留原件、跨进程锁竞争。
//
// 用法：node plugin/writing-mode/test/coordination.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-coord-'))
process.env.DSH_HOME = path.join(temp, 'home')

const {
  claimCoordination, markCreatingCoordination, confirmCoordination, markUncertainCoordination,
  releaseCoordination, forgetCoordination, readCoordination, recordPath, bucketOf, coordinationDir,
} = await import('../lib/coordination.js')

let pass = 0
const ok = (name, fn) => {
  try {
    fn()
    pass++
    console.log('PASS', name)
  } catch (err) {
    console.error('FAIL', name, '\n  ', err.message)
    process.exitCode = 1
  }
}
const PROJECT = 'E:/novel/演示作品'
const OTHER = 'E:/novel/另一部作品'

console.log('--- 阶段机与 token 语义')

ok('H01 第二个窗口同一作品 claim 拿到 in-progress，不重复创建', () => {
  const a = claimCoordination({ projectKey: PROJECT, operationToken: 'tok-A', owner: 'win-1' })
  assert.equal(a._outcome, 'claimed')
  markCreatingCoordination({ projectKey: PROJECT, operationToken: 'tok-A' })
  const b = claimCoordination({ projectKey: PROJECT, operationToken: 'tok-B', owner: 'win-2' })
  assert.equal(b._outcome, 'in-progress', '第二个窗口必须看到创建中')
  assert.equal(b.operationToken, 'tok-A', '记录里仍应是第一个窗口的 token')
  // 第二个窗口不能用自己的 token 写绑定
  const stolen = confirmCoordination({ projectKey: PROJECT, operationToken: 'tok-B', sessionId: 'sess-B' })
  assert.equal(stolen._outcome, 'stale-token')
  assert.equal(readCoordination(PROJECT).sessionId, null)
})

ok('H02 同一 operationToken 重复 claim 幂等（连点发送/设置）', () => {
  const first = claimCoordination({ projectKey: PROJECT, operationToken: 'tok-A' })
  const again = claimCoordination({ projectKey: PROJECT, operationToken: 'tok-A' })
  assert.equal(again._outcome, 'claimed')
  assert.equal(first.operationToken, again.operationToken)
})

ok('创建成功后 confirm → bound，之后的 claim 直接用已有绑定', () => {
  const r = confirmCoordination({ projectKey: PROJECT, operationToken: 'tok-A', sessionId: 'sess-A', workspaceId: 'ws-A', bindingVersion: 1 })
  assert.equal(r._outcome, 'bound')
  const later = claimCoordination({ projectKey: PROJECT, operationToken: 'tok-C' })
  assert.equal(later._outcome, 'bound')
  assert.equal(later.sessionId, 'sess-A')
})

ok('过期 token 在 bound 之后也不能改写绑定', () => {
  const r = confirmCoordination({ projectKey: PROJECT, operationToken: 'tok-B', sessionId: 'sess-hijack' })
  assert.equal(r._outcome, 'stale-token')
  assert.equal(readCoordination(PROJECT).sessionId, 'sess-A')
})

ok('H04 workspace 已建但 session 结果丢失 → 只写部分绑定，不假装 bound', () => {
  const p = 'E:/novel/半途而废'
  claimCoordination({ projectKey: p, operationToken: 't1' })
  markCreatingCoordination({ projectKey: p, operationToken: 't1' })
  const r = confirmCoordination({ projectKey: p, operationToken: 't1', workspaceId: 'ws-only' })
  assert.equal(r._outcome, 'partial')
  const rec = readCoordination(p)
  assert.equal(rec.phase, 'creating')
  assert.equal(rec.workspaceId, 'ws-only')
  assert.equal(rec.sessionId, null)
})

ok('H05 绑定确认失败 → uncertain，保留已知标识；新窗口看到 uncertain 而不是重新创建', () => {
  const p = 'E:/novel/确认失败'
  claimCoordination({ projectKey: p, operationToken: 't1' })
  markCreatingCoordination({ projectKey: p, operationToken: 't1' })
  const u = markUncertainCoordination({ projectKey: p, operationToken: 't1', workspaceId: 'ws-x', reason: 'confirm-network-down' })
  assert.equal(u._outcome, 'uncertain')
  const rec = readCoordination(p)
  assert.equal(rec.phase, 'uncertain')
  assert.equal(rec.workspaceId, 'ws-x')
  const other = claimCoordination({ projectKey: p, operationToken: 't2' })
  assert.equal(other._outcome, 'uncertain', '另一个窗口不得把 uncertain 当成"没有记录"而新建')
})

ok('B03 forget 必须带条件：无守卫/过期 token/版本不符一律拒绝，不做删除', () => {
  const p = 'E:/novel/守卫'
  claimCoordination({ projectKey: p, operationToken: 't1' })
  markCreatingCoordination({ projectKey: p, operationToken: 't1' })
  confirmCoordination({ projectKey: p, operationToken: 't1', sessionId: 'sess-guard' })
  assert.throws(() => forgetCoordination({ projectKey: p }), /forget-needs-guard/)
  assert.equal(forgetCoordination({ projectKey: p, operationToken: 'wrong' }).error, 'stale-token')
  assert.equal(forgetCoordination({ projectKey: p, operationToken: 't1', expectedVersion: 999 }).error, 'version-mismatch')
  assert.equal(readCoordination(p).sessionId, 'sess-guard', '被拒绝的 forget 不得动记录')
  const okForget = forgetCoordination({ projectKey: p, operationToken: 't1', expectedVersion: readCoordination(p).version })
  assert.equal(okForget.ok, true)
  assert.equal(readCoordination(p).phase, null)
})

ok('H06 会话被删：明确 forget 之后才允许重新 claim', () => {
  const p = 'E:/novel/会话被删'
  claimCoordination({ projectKey: p, operationToken: 't1' })
  markCreatingCoordination({ projectKey: p, operationToken: 't1' })
  confirmCoordination({ projectKey: p, operationToken: 't1', sessionId: 'sess-gone' })
  assert.equal(claimCoordination({ projectKey: p, operationToken: 't2' })._outcome, 'bound')
  forgetCoordination({ projectKey: p, operationToken: 't1', expectedVersion: readCoordination(p).version })
  const after = claimCoordination({ projectKey: p, operationToken: 't2' })
  assert.equal(after._outcome, 'claimed')
})

console.log('--- 释放的安全边界')

ok('预留后尚未创建任何对象 → 可以释放（记录删除）', () => {
  const p = 'E:/novel/纯预留'
  claimCoordination({ projectKey: p, operationToken: 't1' })
  const r = releaseCoordination({ projectKey: p, operationToken: 't1' })
  assert.equal(r._outcome, 'released')
  assert.equal(fs.existsSync(recordPath(p)), false)
})

ok('creating 阶段拒绝释放（外部创建可能已发生，删了就找不回来）', () => {
  const p = 'E:/novel/创建中不释放'
  claimCoordination({ projectKey: p, operationToken: 't1' })
  markCreatingCoordination({ projectKey: p, operationToken: 't1' })
  const r = releaseCoordination({ projectKey: p, operationToken: 't1' })
  assert.equal(r._outcome, 'kept')
  assert.equal(fs.existsSync(recordPath(p)), true)
  assert.equal(readCoordination(p).phase, 'creating')
})

ok('已建过对象的 reserved 也拒绝释放', () => {
  const p = 'E:/novel/残留标识'
  claimCoordination({ projectKey: p, operationToken: 't1' })
  confirmCoordination({ projectKey: p, operationToken: 't1', workspaceId: 'ws-y' })
  const r = releaseCoordination({ projectKey: p, operationToken: 't1' })
  assert.equal(r._outcome, 'kept')
  assert.equal(readCoordination(p).workspaceId, 'ws-y')
})

ok('释放需 token 一致', () => {
  const p = 'E:/novel/token 一致'
  claimCoordination({ projectKey: p, operationToken: 't1' })
  assert.equal(releaseCoordination({ projectKey: p, operationToken: 't9' })._outcome, 'stale-token')
  assert.equal(fs.existsSync(recordPath(p)), true)
})

console.log('--- 分桶与坏记录')

ok('项目身份分桶：不同作品互不干扰，路径写法归一', () => {
  assert.notEqual(bucketOf('E:/novel/A'), bucketOf('E:/novel/B'))
  assert.equal(bucketOf('E:\\novel\\A\\'), bucketOf('e:/novel/a'))
  assert.throws(() => bucketOf(''), /project-identity-required/)
})

ok('坏 JSON 保留原件，读取报 corrupt-record 且不被覆盖', () => {
  const p = 'E:/novel/坏记录'
  const file = recordPath(p)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '{ 这不是 JSON')
  assert.throws(() => readCoordination(p), /corrupt-record/)
  assert.throws(() => claimCoordination({ projectKey: p, operationToken: 't1' }), /corrupt-record/)
  assert.equal(fs.readFileSync(file, 'utf8'), '{ 这不是 JSON', '原文件必须原样保留')
})

ok('未知 schema 记录不当作空记录', () => {
  const p = 'E:/novel/新 schema'
  const file = recordPath(p)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 99, phase: 'bound', sessionId: 'x' }))
  assert.throws(() => readCoordination(p), /unknown-schema/)
})

console.log('--- 跨进程互斥')

ok('另一进程持锁时本进程拿不到锁（不抢活锁），超时报 lock-timeout', () => {
  const p = 'E:/novel/跨进程'
  const file = recordPath(p)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const lock = file + '.lock'
  // 用当前进程的 pid 造一个"活锁"：owner 活跃 → 不会被视为 stale
  fs.writeFileSync(lock, `${process.pid}:held-by-test`)
  const started = Date.now()
  assert.throws(() => claimCoordination({ projectKey: p, operationToken: 't1' }), /lock-timeout/)
  const held = Date.now() - started
  assert.ok(held >= 7000, `应等满超时窗口（实测 ${held}ms）`)
  assert.equal(fs.readFileSync(lock, 'utf8'), `${process.pid}:held-by-test`, '绝不能删除不属于自己的锁')
  fs.unlinkSync(lock)
})

ok('持锁进程已消失 → lock-stale（报诊断而不是抢占）', () => {
  const p = 'E:/novel/死锁'
  const file = recordPath(p)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const lock = file + '.lock'
  fs.writeFileSync(lock, '999999999:dead-owner')
  assert.throws(() => claimCoordination({ projectKey: p, operationToken: 't1' }), /lock-stale/)
  assert.equal(fs.existsSync(lock), true, '死锁文件保留，交给运维/作者路径处理')
  fs.unlinkSync(lock)
})

ok('子进程可正常完成一次 claim（真实跨进程写入）', () => {
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'coordination-child.mjs')
  const fresh = 'E:/novel/跨进程新建'
  const r = spawnSync(process.execPath, [fixture, fresh, 'tok-child'], {
    encoding: 'utf8', env: { ...process.env, DSH_HOME: process.env.DSH_HOME },
  })
  if (r.status !== 0) throw new Error(`子进程失败：${r.stdout}${r.stderr}`)
  const rec = readCoordination(fresh)
  assert.equal(rec.phase, 'bound', '子进程应把记录推进到 bound')
  assert.equal(rec.operationToken, 'tok-child')
  assert.equal(rec.owner, `child-${JSON.parse(r.stdout).pid}`, 'owner 身份要落到记录里')
  assert.ok(rec.version >= 3, `版本号应随每次写入递增（实测 ${rec.version}）`)
  // 本进程随后 claim 同一作品：看到子进程的绑定，不重复创建
  assert.equal(claimCoordination({ projectKey: fresh, operationToken: 'tok-parent' })._outcome, 'bound')
})

console.log(`\ncoordination: ${pass} 项通过`)
fs.rmSync(temp, { recursive: true, force: true })
