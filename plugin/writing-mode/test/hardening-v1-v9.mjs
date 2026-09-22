/**
 * V1–V9 加固回归（2026-09-21）。
 *
 * 每一项都对应 hunt 探针实锤复现过的一个缺陷；这里断言的是**修复后的行为**，
 * 探针原件见工作区根 hunt-writing-20260921.mjs（复现记录）与本仓库的审查报告。
 *
 * 隔离：独立 DSH_HOME + %TEMP% 库根；不碰真实作品、不起 Electron、不结束任何进程。
 * exit 0 = 全部通过。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-hardening-'))
process.env.DSH_HOME = path.join(temp, 'home')
fs.mkdirSync(process.env.DSH_HOME, { recursive: true })
const draftsDir = path.join(process.env.DSH_HOME, 'writing-mode', 'drafts')

let pass = 0
let fail = 0
const failures = []
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('PASS ' + name) } else { fail++; failures.push(name); console.log('FAIL ' + name + (detail !== undefined ? '  [' + detail + ']' : '')) }
}
function errCode(fn) {
  try { fn(); return null } catch (e) { return e?.code || e?.message || String(e) }
}
const srcOf = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')

// ── V1 · readBody 必须按字节收集后一次解码（原缺陷：大体积中文正文出现 U+FFFD） ──
{
  const { readBody, MAX_BODY_BYTES } = await import('../index.js')
  const server = http.createServer(async (req, res) => {
    const raw = await readBody(req)
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ raw }))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const chapter = '夜色落在港口的桅杆上，风把咸味推进行人衣领里。'.repeat(4000)
  const body = JSON.stringify({ route: 'save', content: chapter })
  const out = await (await fetch(`http://127.0.0.1:${port}/api/writing-mode?route=save`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  })).json()
  server.close()
  const got = JSON.parse(out.raw).content
  ok('V1 大体积中文正文 round-trip 码点级全等、无 U+FFFD',
    got === chapter && !got.includes('\uFFFD'),
    `收到码点=${[...got].length} 期望=${[...chapter].length} 请求体字节=${Buffer.byteLength(body)}`)
  ok('V1 body 上限按字节计且与 CONTRACT 的 1 MiB 一致', MAX_BODY_BYTES === 1024 * 1024, String(MAX_BODY_BYTES))
  // 不断言「旧字串不在」：源码注释里会原文引用旧写法，纯文本扫描会误报。
  // 改成断言正向代码形状：按字节收集 + 最后一次性解码。
  const readBodySrc = srcOf('../index.js')
  ok('V1 readBody 按 Buffer 收集并最后一次性 utf8 解码',
    /chunks\.push\(buf\)/.test(readBodySrc) && /Buffer\.concat\(chunks\)\.toString\('utf8'\)/.test(readBodySrc))
}

// ── V2 · 配置损坏 ≠ 不存在；损坏不得被回写；写入带 revision 且在锁内 ──
{
  const { readConfig, writeConfig, updateConfig, normalizePrefs, configFile } = await import('../lib/store.js')
  const libRoot = path.join(temp, 'v2-lib')
  fs.mkdirSync(libRoot, { recursive: true })
  fs.mkdirSync(path.dirname(configFile()), { recursive: true })
  fs.writeFileSync(configFile(), JSON.stringify({
    revision: 3,
    roots: [{ path: libRoot, label: 'L', default: true }],
    activeRoot: libRoot,
    prefs: normalizePrefs({ fontSize: 20, aiApiKey: 'sk-secret' }),
    companions: { 'e:/剧本/雾港夜航': 'sess-1' },
  }, null, 2), 'utf8')

  const whole = fs.readFileSync(configFile())
  fs.writeFileSync(configFile(), whole.subarray(0, Math.floor(whole.length / 2)))
  const damaged = fs.readFileSync(configFile(), 'utf8')

  const cfg = readConfig()
  ok('V2 损坏配置不再静默降级为空默认值', cfg.__damaged === true && cfg.configError === 'corrupt-config', JSON.stringify({ d: cfg.__damaged, e: cfg.configError }))
  ok('V2 损坏时返回对象仍带 companions 键', cfg.companions && typeof cfg.companions === 'object' && !Array.isArray(cfg.companions))
  ok('V2 writeConfig 拒绝回写损坏读出的配置', errCode(() => writeConfig(cfg)) === 'config-damaged-refused')
  ok('V2 updateConfig 同样拒绝', errCode(() => updateConfig((c) => ({ ...c, prefs: normalizePrefs({ fontSize: 22 }) }))) === 'config-damaged-refused')
  ok('V2 原件字节未被改动', fs.readFileSync(configFile(), 'utf8') === damaged)
  const cfgDir = path.dirname(configFile())
  const baks = fs.readdirSync(cfgDir).filter((n) => n.includes('.damaged-'))
  ok('V2 损坏原件已留证备份且字节一致',
    baks.length >= 1 && fs.readFileSync(path.join(cfgDir, baks[0]), 'utf8') === damaged, JSON.stringify(baks))

  fs.rmSync(configFile())
  for (const b of baks) fs.rmSync(path.join(cfgDir, b))
  const blank = readConfig()
  ok('V2 文件不存在才算空配置，且带 companions / revision',
    blank.__damaged === undefined && blank.roots.length === 0 && blank.companions && blank.revision === 0)

  const o1 = updateConfig((c) => ({ ...c, roots: [{ path: libRoot, label: 'L', default: true }], activeRoot: libRoot }))
  const o2 = updateConfig((c) => ({ ...c, companions: { ...c.companions, k: 'sess' }, prefs: normalizePrefs({ ...c.prefs, fontSize: 24 }) }))
  const final = JSON.parse(fs.readFileSync(configFile(), 'utf8'))
  ok('V2 配置写入带 revision 且单调递增', o1.revision === 1 && o2.revision === 2 && final.revision === 2, `${o1.revision}/${o2.revision}/${final.revision}`)
  ok('V2 连续两次改不同项都保留（读改写在同一锁内）',
    final.roots.length === 1 && final.companions.k === 'sess' && final.prefs.fontSize === 24, JSON.stringify({ r: final.roots.length, c: final.companions, f: final.prefs.fontSize }))
}

// ── V3 · 协调记录：stale-token 不落盘坏记录；既有中毒记录自愈；坏记录有出路 ──
{
  const c = await import('../lib/coordination.js')
  const pk = path.join(temp, 'v3-project')
  c.claimCoordination({ projectKey: pk, operationToken: 'T1', owner: 'winA' })
  c.forgetCoordination({ projectKey: pk, operationToken: 'T1' })
  const late = c.confirmCoordination({ projectKey: pk, operationToken: 'T1', sessionId: 's-1' })
  ok('V3 迟到 confirm 仍返回 stale-token', late._outcome === 'stale-token', String(late._outcome))
  ok('V3 stale-token 不再把 phase=null 落盘', !fs.existsSync(c.recordPath(pk)))
  ok('V3 之后 GET 正常（不再 bad-record 500）', c.readCoordination(pk).phase === null)
  ok('V3 之后新窗口能正常 claim', c.claimCoordination({ projectKey: pk, operationToken: 'T2' })._outcome === 'claimed')
  ok('V3 release 不再被坏记录顶成 500', ['released', 'absent', 'kept', 'stale-token', 'unreadable'].includes(c.releaseCoordination({ projectKey: pk, operationToken: 'T2' })._outcome))

  const pk2 = path.join(temp, 'v3-poisoned')
  fs.mkdirSync(path.dirname(c.recordPath(pk2)), { recursive: true })
  fs.writeFileSync(c.recordPath(pk2), JSON.stringify({ schemaVersion: 1, projectKey: pk2, version: 1, phase: null, operationToken: null, owner: null, sessionId: null, workspaceId: null, bindingVersion: null, reservedAt: null, updatedAt: 1, history: [] }), 'utf8')
  ok('V3 既有 phase=null 中毒记录读时自愈为空记录', c.readCoordination(pk2).phase === null)
  ok('V3 中毒记录之后仍可 claim', c.claimCoordination({ projectKey: pk2, operationToken: 'T9' })._outcome === 'claimed')

  const pk3 = path.join(temp, 'v3-corrupt')
  fs.mkdirSync(path.dirname(c.recordPath(pk3)), { recursive: true })
  fs.writeFileSync(c.recordPath(pk3), '{bad json', 'utf8')
  const noForce = c.forgetCoordination({ projectKey: pk3, operationToken: 'z' })
  ok('V3 非 force 不删坏记录（原件保留给诊断）',
    noForce.ok === false && noForce.error === 'corrupt-record' && fs.readFileSync(c.recordPath(pk3), 'utf8') === '{bad json')
  const forced = c.forgetCoordination({ projectKey: pk3, force: true })
  const kept = fs.readdirSync(path.dirname(c.recordPath(pk3))).filter((n) => n.includes('.corrupt-'))
  ok('V3 force 能清坏记录，且原件改名保留、字节一致',
    forced.ok === true && kept.length === 1 && fs.readFileSync(path.join(path.dirname(c.recordPath(pk3)), kept[0]), 'utf8') === '{bad json',
    JSON.stringify({ forced, kept }))

  const pk4 = path.join(temp, 'v3-binding-bad')
  fs.mkdirSync(path.dirname(c.recordPath(pk4)), { recursive: true })
  fs.writeFileSync(c.recordPath(pk4), JSON.stringify({ schemaVersion: 1, phase: null, sessionId: 'live-session' }), 'utf8')
  ok('V3 带绑定的畸形记录仍报 bad-record（不静默当空）', errCode(() => c.readCoordination(pk4)) === 'bad-record')
}

// ── V4 / CXR01 · 残留锁：快速失败 + 可操作诊断；在线**绝不移动**他人的锁 ──
{
  const { writeCheckpoint, readCheckpoint, listDraftLocks, listStaleDraftLocks } = await import('../lib/draft-checkpoints.js')
  const { quarantineStaleLock } = await import('../lib/file-lock.js')
  const proj = path.join(temp, 'v4-project')
  writeCheckpoint(proj, 'w', { baseRev: 0, text: 'v1' })
  const only = fs.readdirSync(draftsDir).filter((n) => n.endsWith('.json'))
  assert.equal(only.length, 1, '此段依赖 drafts 目录里只有一个桶')
  const bucketFile = path.join(draftsDir, only[0])
  fs.writeFileSync(bucketFile + '.lock', '999999:deadbeef-0000', 'utf8')

  const t0 = Date.now()
  let staleErr = null
  try { writeCheckpoint(proj, 'w', { baseRev: 1, text: 'v2' }) } catch (e) { staleErr = e }
  const ms = Date.now() - t0
  ok('V4 残留锁快速失败而不是卡满 8s', staleErr?.code === 'lock-stale' && ms < 2000, `${staleErr?.code} ${ms}ms`)
  ok('V4 残留锁期间旧值未被破坏', readCheckpoint(proj, 'w').text === 'v1')
  const locks = listDraftLocks()
  ok('V4 残留锁对诊断可见（含存活判定与绝对路径）',
    locks.length === 1 && locks[0].alive === false && locks[0].dead === true && locks[0].path === bucketFile + '.lock',
    JSON.stringify(locks))

  // CXR01（2026-09-22 复核，P1）：在线一律**不移动**他人的锁。
  // check-then-rename 无法原子化：复核之后、改名之前若有写入者取得该锁，
  // 就会把活锁移走 → 两个写入方临界区重叠。把窗口缩到微秒不是互斥保证。
  ok('CXR01 残留锁只被诊断、不被在线清扫移走（锁文件仍在原处、无隔离产物）',
    listStaleDraftLocks().length === 1 && fs.existsSync(bucketFile + '.lock')
      && fs.readdirSync(draftsDir).filter((n) => n.includes('.stale-')).length === 0,
    JSON.stringify(listStaleDraftLocks()))
  ok('CXR01 lock-stale 错误带上锁文件绝对路径与持有者（作者知道该删哪个）',
    staleErr?.lockPath === bucketFile + '.lock' && typeof staleErr?.lockOwner === 'string' && staleErr.lockOwner.length > 0,
    JSON.stringify({ lockPath: staleErr?.lockPath, lockOwner: staleErr?.lockOwner }))
  ok('CXR01 quarantineStaleLock 默认拒绝（必须显式声明离线）',
    quarantineStaleLock(bucketFile) === null && fs.existsSync(bucketFile + '.lock'))
  const movedName = quarantineStaleLock(bucketFile, { offline: true })
  ok('CXR01 显式离线维护仍可隔离并保留取证文件',
    typeof movedName === 'string' && movedName.length > 0 && fs.existsSync(path.join(draftsDir, movedName)) && !fs.existsSync(bucketFile + '.lock'),
    String(movedName))
  try { fs.rmSync(path.join(draftsDir, movedName), { force: true }) } catch {}
  ok('CXR01 清掉残留锁后保存恢复正常',
    writeCheckpoint(proj, 'w', { baseRev: 1, text: 'v2' }).ok === true && readCheckpoint(proj, 'w').text === 'v2')

  fs.writeFileSync(bucketFile + '.lock', `${process.pid}:alive-lock`, 'utf8')
  ok('V4 活锁不算残留、也绝不会被移动（W01）', listStaleDraftLocks().length === 0 && fs.existsSync(bucketFile + '.lock'))
  ok('CXR01 活锁即使显式离线也不移动（dead=false 是硬条件）',
    quarantineStaleLock(bucketFile, { offline: true }) === null && fs.existsSync(bucketFile + '.lock'))
  fs.rmSync(bucketFile + '.lock')

  const indexSrc = srcOf('../index.js')
  ok('CXR01 index.js 里再无任何在线清扫（启动与维护入口都只读/拒绝）',
    !/sweepStale/.test(indexSrc) && /listStaleDraftLocks\(\)/.test(indexSrc) && /stale-lock-clear-refused-online/.test(indexSrc))

  // 回归（W23）：“读不出持有者”有三种成因，绝不得当成同一种处理。
  // 我把 stale 快速失败从 8s 收到 250ms 后，一度把“锁刚被释放”与“对方正在写入的空档”
  // 也当成残留锁，结果 W23（子进程持锁 2.5s）间歇性报 lock-stale 而不是获取成功。
  const { ownerIsProvablyDead, inspectLock } = await import('../lib/file-lock.js')
  ok('V4 空令牌不算已死（对方 openSync 后、writeSync 前的空档是活锁）',
    ownerIsProvablyDead('') === false && ownerIsProvablyDead('   ') === false)
  ok('V4 解析不出 PID 的令牌不算已死（宁可当活锁等，不把未知当死亡）',
    ownerIsProvablyDead('not-a-pid:x') === false && ownerIsProvablyDead(':x') === false)
  ok('V4 自己的 PID 不算已死', ownerIsProvablyDead(`${process.pid}:self`) === false)
  ok('V4 可解析且 PID 已消失的令牌才算已死', ownerIsProvablyDead('999999:deadbeef') === true)

  // 空锁文件（存在但读不出持有者）：不得被当作残留锁隔离
  fs.writeFileSync(bucketFile + '.lock', '', 'utf8')
  const emptyInfo = inspectLock(bucketFile)
  ok('V4 空锁文件诊断：exists=true / alive=false / dead=false',
    emptyInfo.exists === true && emptyInfo.alive === false && emptyInfo.dead === false, JSON.stringify(emptyInfo))
  ok('V4 空锁文件即使显式离线也不被移走（dead=false）', quarantineStaleLock(bucketFile, { offline: true }) === null && fs.existsSync(bucketFile + '.lock'))
  ok('V4 空锁文件不进残留锁诊断（不会被当成可清理对象）', listStaleDraftLocks().length === 0 && fs.existsSync(bucketFile + '.lock'))
  fs.rmSync(bucketFile + '.lock')

  // 复核裁决 3：“未知 owner 不应当死锁处理，但也无需每次阻塞 8 秒”——
  // 垃圾内容的锁文件应有限重试后快速返回一个语义明确的**可重试**错误。
  fs.writeFileSync(bucketFile + '.lock', 'garbage-not-a-pid-token', 'utf8')
  const tu0 = Date.now()
  let unknownErr = null
  try {
    const cur = readCheckpoint(proj, 'w')
    writeCheckpoint(proj, 'w', { baseRev: cur?.rev ?? 0, text: 'should-not-land' })
  } catch (e) { unknownErr = e }
  const unknownWait = Date.now() - tu0
  ok('裁决3 垃圾锁内容 → 快速返回可重试的 lock-owner-unknown（不再白等 8s）',
    unknownErr?.code === 'lock-owner-unknown' && unknownWait < 3000, `${unknownErr?.code} ${unknownWait}ms`)
  ok('裁决3 lock-owner-unknown 也带上锁文件绝对路径', unknownErr?.lockPath === bucketFile + '.lock', String(unknownErr?.lockPath))
  ok('裁决3 垃圾锁期间旧值未被破坏、非法写入未落盘', readCheckpoint(proj, 'w').text === 'v2')
  ok('裁决3 垃圾锁不算残留（dead=false），不会被当成可清理对象', listStaleDraftLocks().length === 0)
  fs.rmSync(bucketFile + '.lock')

  // 锁在等待期间消失 → 必须获取成功，不得抛 lock-stale（W23 的真实形态）。
  // 用真子进程持锁后 unlink，重复多轮把竞态窗口跑出来。
  const { spawn } = await import('node:child_process')
  let vanishStale = 0
  let vanishOk = 0
  for (let i = 0; i < 6; i++) {
    const childCode = `import fs from 'node:fs';const L=${JSON.stringify(bucketFile + '.lock')};fs.writeFileSync(L, process.pid + ':childhold');await new Promise(r=>setTimeout(r,${300 + i * 60}));try{fs.unlinkSync(L)}catch{}`
    const child = spawn(process.execPath, ['--input-type=module', '-e', childCode], { stdio: 'ignore' })
    await new Promise((r) => setTimeout(r, 120))
    try {
      const cur = readCheckpoint(proj, 'w')
      writeCheckpoint(proj, 'w', { baseRev: cur?.rev ?? 0, text: 'vanish-' + i })
      vanishOk++
    } catch (e) {
      if (e?.code === 'lock-stale') vanishStale++
    }
    await new Promise((r) => child.on('exit', r))
    try { fs.rmSync(bucketFile + '.lock', { force: true }) } catch {}
  }
  ok('V4 锁在等待期间被释放时能正常获取，不报 lock-stale（W23 回归）',
    vanishStale === 0 && vanishOk >= 5, `成功=${vanishOk}/6 lock-stale=${vanishStale}`)
  const lockSrc = srcOf('../lib/file-lock.js')
  ok('V4 等待改走 sleepSync/Atomics.wait，不再在获取循环里空转（三个等待分支各一处）',
    /Atomics\.wait\(/.test(lockSrc) && (lockSrc.match(/sleepSync\(20\)/g) || []).length === 3,
    `sleepSync(20) 出现 ${(lockSrc.match(/sleepSync\(20\)/g) || []).length} 次`)
  // 防 W23 重演：unknown 分支在放弃前必须再确认一次锁是否已消失，
  // 否则“existsSync 为真 → 文件被释放 → readLockOwner 拿到空串”会把一个本该成功的获取变成硬失败。
  ok('裁决3 unknown 分支放弃前会再确认锁已消失则重试（防 W23 重演）',
    /unknownMs\) \{[\s\S]{0,500}?if \(!fs\.existsSync\(lock\)\) continue/.test(lockSrc))
}

// ── V5 · 移动恢复：候选必须携带与目标作品的关联证据 ──
{
  const { writeCheckpoint, listCheckpoints } = await import('../lib/draft-checkpoints.js')
  const { relocationCandidates, recoverRelocation } = await import('../lib/project-recovery.js')
  const { applyMemoryOp, emptyEtag } = await import('../lib/project-memory.js')
  const A_old = path.join(temp, 'v5-A-old')
  const A_new = path.join(temp, 'v5-A-new')
  const B_old = path.join(temp, 'v5-B-old')
  const B_new = path.join(temp, 'v5-B-new')
  for (const d of [A_old, B_old]) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'project.md'), 'x') }
  applyMemoryOp(A_old, { op: 'add', baseRevision: 0, baseEtag: emptyEtag(), item: { kind: 'fact', text: 'A 的设定', status: 'confirmed' } })
  writeCheckpoint(A_old, 'wa', { baseRev: 0, text: 'A 的草稿' })
  writeCheckpoint(B_old, 'wb', { baseRev: 0, text: 'B 的草稿' })
  fs.renameSync(A_old, A_new)
  fs.renameSync(B_old, B_new)

  const candB = relocationCandidates(B_new)
  const aFromB = candB.find((x) => x.oldPath === A_old)
  ok('V5 打开 B 时 A 的旧位置被标为不可导入',
    Boolean(aFromB) && aFromB.importable === false && aFromB.relation === 'unrelated',
    JSON.stringify(aFromB && { relation: aFromB.relation, importable: aFromB.importable }))
  ok('V5 跨作品导入默认被 host 拒绝（客户端/模型绕不过）',
    errCode(() => recoverRelocation(B_new, A_old, aFromB.token)) === 'recovery-source-unrelated')
  ok('V5 confirmUnrelated 非严格 true 不算确认',
    errCode(() => recoverRelocation(B_new, A_old, aFromB.token, {}, { confirmUnrelated: 'yes' })) === 'recovery-source-unrelated')
  ok('V5 默认拒绝时 B 的桶未被 A 的草稿污染', listCheckpoints(B_new).every((x) => !String(x.text || '').includes('A 的草稿')))

  const candA = relocationCandidates(A_new)
  const aSelf = candA.find((x) => x.oldPath === A_old)
  ok('V5 真搬迁仍有证据（备忘里记着旧路径）可导入',
    Boolean(aSelf) && aSelf.importable === true && aSelf.relation === 'memory-project-key',
    JSON.stringify(aSelf && { relation: aSelf.relation, importable: aSelf.importable }))
  const r = recoverRelocation(A_new, A_old, aSelf.token)
  ok('V5 合法导入仍成功且带回关联依据',
    r.copied >= 1 && r.relation === 'memory-project-key' && r.confirmedUnrelated === false && listCheckpoints(A_new).some((x) => x.text === 'A 的草稿'),
    JSON.stringify({ copied: r.copied, relation: r.relation }))

  // 作者显式知情覆盖：非破坏性操作不能把真搬迁但无证据的作品逼成死路，但必须留审计痕迹
  const overridden = recoverRelocation(B_new, A_old, aFromB.token, {}, { confirmUnrelated: true })
  ok('V5 显式确认后可导入，且关系记为 unrelated-author-confirmed（可审计）',
    overridden.copied >= 1 && overridden.confirmedUnrelated === true && overridden.relation === 'unrelated-author-confirmed',
    JSON.stringify({ copied: overridden.copied, relation: overridden.relation }))
  ok('V5 覆盖导入也写进历史桶供事后追查',
    overridden.histories.some((hrow) => hrow.relation === 'unrelated-author-confirmed' && hrow.oldPath === A_old),
    JSON.stringify(overridden.histories))

  // CXR02（2026-09-22 复核，P1）：同名同位**不是**关联证据。
  // 两部不同作品都会很自然地有 draft/第一章.md；曾经据此判 importable=true，
  // 于是 A 的草稿能不经确认就导进 B（复核探针实测 copied=1）。
  const C_old = path.join(temp, 'cxr02-C-old')
  const D_new = path.join(temp, 'cxr02-D-new')
  fs.mkdirSync(path.join(C_old, 'draft'), { recursive: true })
  fs.mkdirSync(path.join(D_new, 'draft'), { recursive: true })
  fs.writeFileSync(path.join(C_old, 'draft', '第一章.md'), 'C 的第一章，完全不同的内容')
  fs.writeFileSync(path.join(D_new, 'draft', '第一章.md'), 'D 的第一章，另一部作品')
  writeCheckpoint(C_old, 'wc', {
    baseRev: 0,
    text: 'C 的秘密草稿',
    reference: { path: path.join(C_old, 'draft', '第一章.md'), text: 'C 的第一章，完全不同的内容' },
  })
  fs.renameSync(C_old, C_old + '-moved')

  const cFromD = relocationCandidates(D_new).find((x) => x.oldPath === C_old)
  ok('CXR02 同相对路径文件名不再被当成关联证据',
    Boolean(cFromD) && cFromD.importable === false && cFromD.relation === 'unrelated-filename-hint',
    JSON.stringify(cFromD && { relation: cFromD.relation, importable: cFromD.importable }))
  ok('CXR02 detail 如实说明这只是提示、不构成证据',
    typeof cFromD?.detail === 'string' && cFromD.detail.includes('不构成关联证据'), String(cFromD?.detail))
  ok('CXR02 跨作品导入被 host 拒绝（客户端/模型绕不过）',
    errCode(() => recoverRelocation(D_new, C_old, cFromD.token)) === 'recovery-source-unrelated')
  ok('CXR02 默认拒绝时 D 的桶未被 C 的草稿污染',
    listCheckpoints(D_new).every((x) => !String(x.text || '').includes('C 的秘密草稿')))

  // 内容一致也只是辅助线索，同样不授予导入资格（两个作品可能都放同一份模板/空文件）
  const E_old = path.join(temp, 'cxr02-E-old')
  const F_new = path.join(temp, 'cxr02-F-new')
  fs.mkdirSync(path.join(E_old, 'draft'), { recursive: true })
  fs.mkdirSync(path.join(F_new, 'draft'), { recursive: true })
  fs.writeFileSync(path.join(E_old, 'draft', '模板.md'), '同一份模板')
  fs.writeFileSync(path.join(F_new, 'draft', '模板.md'), '同一份模板')
  writeCheckpoint(E_old, 'we', {
    baseRev: 0,
    text: 'E 的草稿',
    reference: { path: path.join(E_old, 'draft', '模板.md'), text: '同一份模板' },
  })
  fs.renameSync(E_old, E_old + '-moved')
  const eFromF = relocationCandidates(F_new).find((x) => x.oldPath === E_old)
  ok('CXR02 内容一致也只算辅助线索，仍不可导入',
    Boolean(eFromF) && eFromF.importable === false && /快照一致/.test(eFromF.detail || ''),
    JSON.stringify(eFromF && { relation: eFromF.relation, importable: eFromF.importable, detail: eFromF.detail }))
}

// ── V6 · 项目身份单一口径：尾分隔符不分裂桶、旧口径桶可只读回退 ──
{
  const { writeCheckpoint, readCheckpoint, listCheckpoints } = await import('../lib/draft-checkpoints.js')
  const { bucketOf } = await import('../lib/coordination.js')
  const { identityKey } = await import('../lib/project-identity.js')
  const p = path.join(temp, 'v6-project')
  const trailing = p + path.sep
  ok('V6 identityKey 归一尾分隔符/分隔符方向/大小写',
    identityKey(p) === identityKey(trailing) && identityKey(p) === identityKey(p.toUpperCase()) && identityKey(p) === identityKey(p.replace(/\\/g, '/')))
  ok('V6 draft 与 coordination 身份同口径（不再一个剥一个不剥）', bucketOf(p) === bucketOf(trailing))
  writeCheckpoint(trailing, 'w1', { baseRev: 0, text: '写在带尾分隔符的桶' })
  ok('V6 尾分隔符不再分裂草稿桶', readCheckpoint(p, 'w1')?.text === '写在带尾分隔符的桶')
  ok('V6 listCheckpoints 按身份匹配而非原始串全等', listCheckpoints(p).length === 1 && listCheckpoints(trailing).length === 1)

  // 旧口径（不剥尾分隔符）写过的桶，升级后仍可读，写入自动迁移到新桶
  const legacyName = createHash('sha256').update(String(trailing).replace(/\\/g, '/').toLowerCase() + '\n' + 'legacyWin').digest('hex').slice(0, 32) + '.json'
  fs.writeFileSync(path.join(draftsDir, legacyName), JSON.stringify({ schemaVersion: 2, project: trailing, windowId: 'legacyWin', text: '旧桶内容', rev: 4 }), 'utf8')
  const viaFallback = readCheckpoint(trailing, 'legacyWin')
  ok('V6 旧口径桶可只读回退（升级不失联）', viaFallback?.text === '旧桶内容' && viaFallback.legacyBucket === true, JSON.stringify(viaFallback))
  const migrated = writeCheckpoint(trailing, 'legacyWin', { baseRev: 4, text: '迁移后' })
  ok('V6 回退读到的 rev 可作写入基线，写入落新桶', migrated.ok === true && readCheckpoint(trailing, 'legacyWin').text === '迁移后')
  const srcIdx = srcOf('../index.js')
  ok('V6 草稿路由用规范路径而不是客户端原始串', /const resolved = draftBucket\(/.test(srcIdx) && !/readCheckpoint\(project \+/.test(srcIdx))
}

// ── V7 · 列表回传元数据且有上限；库层迁移不受上限影响 ──
{
  const { checkpointMeta, MAX_DRAFT_LIST, writeCheckpoint, listCheckpoints } = await import('../lib/draft-checkpoints.js')
  const rec = { windowId: 'w', rev: 3, updatedAt: '2026-09-21T00:00:00.000Z', text: '正文'.repeat(100), reference: { label: 'L', text: '引用全文', path: '/x.md', revision: 'r1' } }
  const meta = checkpointMeta(rec)
  ok('V7 列表元数据不含正文与引用全文，但带 chars/preview/引用身份',
    meta.text === undefined && meta.chars === 200 && [...meta.preview].length <= 120 && meta.reference?.path === '/x.md' && meta.reference.text === undefined,
    JSON.stringify(Object.keys(meta)))
  const wm = checkpointMeta({ windowId: 'w2', rev: 1, updatedAt: 'x', text: JSON.stringify({ version: 1, drafts: [{ title: '甲' }, { title: '乙' }] }) }, { world: true })
  ok('V7 世界观桶给标题汇总，列表无需全文即可渲染', wm.summary?.draftCount === 2 && wm.summary.titles.join(',') === '甲,乙', JSON.stringify(wm.summary))
  const srcIdx = srcOf('../index.js')
  ok('V7 路由列表有上限且回传 total/truncated', srcIdx.includes('.slice(0, MAX_DRAFT_LIST)') && srcIdx.includes('truncated: all.length > MAX_DRAFT_LIST'))
  ok('V7 上限是有限常量', Number.isInteger(MAX_DRAFT_LIST) && MAX_DRAFT_LIST > 0 && MAX_DRAFT_LIST <= 100, String(MAX_DRAFT_LIST))
  const many = path.join(temp, 'v7-many')
  for (let i = 0; i < MAX_DRAFT_LIST + 6; i++) writeCheckpoint(many, 'w' + i, { baseRev: 0, text: 'draft ' + i })
  ok('V7 库层 listCheckpoints 不设上限（移动恢复不漏桶）', listCheckpoints(many).length === MAX_DRAFT_LIST + 6, String(listCheckpoints(many).length))
}

// ── V8 · 路由 × 方法白名单覆盖全部业务路由 ──
{
  const { ROUTE_METHODS } = await import('../index.js')
  const src = srcOf('../index.js')
  const referenced = new Set([...src.matchAll(/route === '([a-z-]+)'/g)].map((m) => m[1]))
  const missing = [...referenced].filter((r) => !Object.prototype.hasOwnProperty.call(ROUTE_METHODS, r))
  ok('V8 所有被处理的 route 都在方法白名单里', missing.length === 0, JSON.stringify(missing))
  ok('V8 白名单只含 GET/POST（无 PUT/DELETE/PATCH 通路）',
    Object.values(ROUTE_METHODS).every((ms) => ms.every((m) => m === 'GET' || m === 'POST')))
  ok('V8 project-recovery / coordination 受白名单约束',
    ROUTE_METHODS['project-recovery'].join() === 'GET,POST' && ROUTE_METHODS.coordination.join() === 'GET,POST')
  ok('V8 content-type 门禁不再只判 POST', /req\.method !== 'GET' && !\/\^application/.test(src))
}

// ── V9 · 配额天花板必须有出口：先归档备份再裁，撤回不白占配额，迟到重试不重复建 ──
{
  const { applyMemoryOp, readMemory, quotaOf } = await import('../lib/project-memory.js')
  const root = path.join(temp, 'v9-root')
  const proj = path.join(root, '长篇')
  fs.mkdirSync(proj, { recursive: true })
  fs.writeFileSync(path.join(proj, 'project.md'), '# 长篇')
  const opts = { libraryRoots: [root] }
  let r = readMemory(proj, opts)
  let rev = r.memory.revision
  let etag = r.etag
  const call = (payload) => {
    const res = applyMemoryOp(proj, { ...payload, baseRevision: rev, baseEtag: etag, clientSchemaVersion: 2, actor: 'author' }, opts)
    rev = res.memory.revision
    etag = res.etag
    return res
  }
  const attempt = (payload) => { try { return { res: call(payload) } } catch (e) { return { err: e } } }

  for (let i = 0; i < 200; i++) call({ op: 'save-setting-candidate', operationId: 'op-' + i, item: { kind: 'fact', setting: { title: '设定' + i, conclusion: '结论' + i } } })
  const blocked = attempt({ op: 'save-setting-candidate', operationId: 'op-201', item: { kind: 'fact', setting: { title: '第201条', conclusion: '结论' } } })
  ok('V9 收据满 200 后确实拒绝（前提成立）', blocked.err?.code === 'operations-full', String(blocked.err?.code))
  ok('V9 配额用量随读返回，UI 可提前提醒', quotaOf(readMemory(proj, opts).memory).operations === 200)

  const pruned = attempt({ op: 'prune-operations' })
  const backupRel = pruned.res?.archived?.backup
  const backupAbs = backupRel ? path.join(proj, ...backupRel.split('/')) : null
  const backupBody = backupAbs && fs.existsSync(backupAbs) ? JSON.parse(fs.readFileSync(backupAbs, 'utf8')) : null
  ok('V9 prune-operations 打开出口并回报归档条数', pruned.res?.ok !== undefined || pruned.res?.archived?.dropped > 0, JSON.stringify(pruned.res?.archived))
  ok('V9 归档先落备份：被裁收据字节可在 state/backups/ 找到',
    Boolean(backupBody) && backupBody.kind === 'operations' && Array.isArray(backupBody.dropped) && backupBody.dropped.length === pruned.res.archived.dropped,
    JSON.stringify({ backupRel, dropped: backupBody?.dropped?.length }))
  const after = attempt({ op: 'save-setting-candidate', operationId: 'op-after', item: { kind: 'fact', setting: { title: '归档后新设定', conclusion: '结论' } } })
  ok('V9 归档后世界观操作恢复可用', Boolean(after.res) && after.res.receipt?.itemId !== undefined, String(after.err?.code))
  const replayPruned = attempt({ op: 'save-setting-candidate', operationId: 'op-0', item: { kind: 'fact', setting: { title: '设定0', conclusion: '结论0' } } })
  ok('V9 被裁收据的迟到重试判 operation-pruned，不重复建设定',
    replayPruned.err?.code === 'operation-pruned', String(replayPruned.err?.code || replayPruned.res?.receipt?.itemId))
  const itemsNow = readMemory(proj, opts).memory.items.length
  ok('V9 归档不影响已保存的设定条目', itemsNow === 201, String(itemsNow))

  let guard = 0
  while (readMemory(proj, opts).memory.items.length < 400 && guard++ < 250) {
    const a = attempt({ op: 'add', item: { kind: 'fact', text: '填充 ' + guard } })
    if (a.err) break
  }
  const full = attempt({ op: 'add', item: { kind: 'fact', text: '第401条' } })
  ok('V9 条目满 400 后确实拒绝（前提成立）', full.err?.code === 'memory-full', String(full.err?.code))
  const someId = readMemory(proj, opts).memory.items.at(-1)?.id
  attempt({ op: 'retract', id: someId })
  const stillFull = attempt({ op: 'add', item: { kind: 'fact', text: '撤回后重试' } })
  ok('V9 撤回不自动释放配额（因此需要显式清理出口）', stillFull.err?.code === 'memory-full', String(stillFull.err?.code))
  const purge = attempt({ op: 'purge-retracted' })
  const purgeBackup = purge.res?.archived?.backup ? path.join(proj, ...purge.res.archived.backup.split('/')) : null
  ok('V9 purge-retracted 只清终态条目且先备份',
    purge.res?.archived?.dropped >= 1 && Boolean(purgeBackup) && fs.existsSync(purgeBackup)
    && JSON.parse(fs.readFileSync(purgeBackup, 'utf8')).dropped.every((it) => ['retracted', 'resolved'].includes(it.status)),
    JSON.stringify(purge.res?.archived))
  ok('V9 清理后新增恢复可用', Boolean(attempt({ op: 'add', item: { kind: 'fact', text: '清理后新增' } }).res))
  ok('V9 purge 不接受 confirmed/proposed（只允许终态）',
    errCode(() => applyMemoryOp(proj, { op: 'purge-retracted', statuses: ['confirmed'], baseRevision: rev, baseEtag: etag }, opts)) === 'bad-statuses')

  // 历史上限：填满后仍能归档（维护路径不受 history-full 阻挡）
  const histId = readMemory(proj, opts).memory.items.at(-1)?.id
  let g2 = 0
  let histFull = null
  while (g2++ < 900) {
    const a = attempt({ op: 'update', id: histId, item: { text: '反复改 ' + g2 } })
    if (a.err) { histFull = a.err.code; break }
  }
  ok('V9 变更历史满后报 history-full', histFull === 'history-full', String(histFull))
  const arch = attempt({ op: 'archive-history' })
  ok('V9 历史满时归档出口仍可用（不是满了就再也清不了）',
    arch.res?.archived?.dropped > 0 && arch.err === undefined, JSON.stringify({ dropped: arch.res?.archived?.dropped, err: arch.err?.code }))
  ok('V9 归档后普通操作恢复可用', Boolean(attempt({ op: 'update', id: histId, item: { text: '归档后再改一次' } }).res))
  ok('V9 客户端有配额文案而不是裸错误码',
    /operations-full/.test(srcOf('../src/client/features/memory/index.js')) && /QUOTA_ERROR_COPY/.test(srcOf('../src/client/features/world-settings/index.js')))
}

console.log(`\n${fail ? 'HARDENING_FAIL' : 'HARDENING_OK'} ${pass} passed, ${fail} failed`)
if (fail) console.log('失败项：' + failures.join(' | '))
console.log('隔离目录：' + temp)
process.exit(fail === 0 ? 0 : 1)
