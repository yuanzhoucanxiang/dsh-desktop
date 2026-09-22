/**
 * CXR01 / CXR02 修复验证（2026-09-22）。
 *
 * 这份探针**照 Codex 的 `handoff-probes.mjs` 原样重放同两个场景**，但断言的是修复后的行为。
 * 之所以另写一份而不改对方的探针：`handoff-probes.mjs` 是复现取证，它 assert 的是**缺陷成立**
 * （`assert.ok(quarantined)` / `assert.equal(candidate.importable, true)`）；修复后它会
 * 在断言处抛错——那正是修复生效的证据，但退出码不可读，所以这里给一份可读的正向门禁。
 *
 * 只读用户数据：全部在 %TEMP% 的隔离 DSH_HOME 下跑，不碰 ~/.dsh，不动生产源码。
 * 跑法：node docs/audits/writing-world-settings/2026-09-22/fix-verification.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(HERE, '../../../../plugin/writing-mode')

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cxr-fix-verify-'))
process.env.DSH_HOME = path.join(base, 'home')

const { quarantineStaleLock, withFileLock } = await import('../../../../plugin/writing-mode/lib/file-lock.js')
const { relocationCandidates, recoverRelocation } = await import('../../../../plugin/writing-mode/lib/project-recovery.js')
const { writeCheckpoint, listCheckpoints, listStaleDraftLocks, listDraftLocks } = await import('../../../../plugin/writing-mode/lib/draft-checkpoints.js')

const failures = []
function ok(name, pass, detail) {
  if (!pass) failures.push(name)
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail !== undefined && detail !== '' ? '  [' + detail + ']' : ''}`)
}

/* ─────────────────────────────────────────────────────────────
 * CXR01 · 在线绝不移动他人的锁
 *
 * Codex 的时序：清扫 B 复核后暂停 → 清扫 A 移走旧死锁 → 写入 W 取得新锁进临界区
 *              → B 恢复并把 W 的活锁改名 → 写入 X 又取同路径锁 → W/X 临界区重叠。
 * 它靠 monkey-patch fs.renameSync 在 rename 边界注入调度来确定性复现。
 *
 * 修复后的性质：**在线路径根本不会调 renameSync 去动锁**，所以这个时序无从发生。
 * 下面用同一个 seam 证明这一点——如果生产代码试图 rename 那把锁，seam 会记录到。
 * ───────────────────────────────────────────────────────────── */
{
  // 锁必须建在 drafts 根下且名为 <bucket>.json，否则 listDraftLocks()（只筛 *.json.lock）看不到
  const draftsDir = path.join(process.env.DSH_HOME, 'writing-mode', 'drafts')
  fs.mkdirSync(draftsDir, { recursive: true })
  const file = path.join(draftsDir, 'cxr01-record.json')
  const lock = file + '.lock'
  const deadPid = 2147483646
  let probeSawDeadPid = false
  try { process.kill(deadPid, 0) } catch { probeSawDeadPid = true }
  ok('前置：探针用的 PID 确实不存在（能被判为可证明已死）', probeSawDeadPid)
  fs.writeFileSync(lock, deadPid + ':dead-owner', 'utf8')

  // 与 Codex 相同的注入点：任何对该锁路径的 renameSync 都会被记录
  const realRename = fs.renameSync
  let renameAttempts = 0
  let movedLiveOwner = null
  fs.renameSync = function (from, to) {
    if (from === lock) {
      renameAttempts++
      // 复现 Codex 的抢占时序：旧死锁已被别的清扫者移走，写入方 W 取得新锁
      try { fs.unlinkSync(lock) } catch {}
      withFileLock(file, () => {
        try {
          realRename(from, to)
          movedLiveOwner = fs.readFileSync(to, 'utf8')
        } catch { movedLiveOwner = null }
      })
      return undefined
    }
    return realRename(from, to)
  }

  let onlineResult
  try {
    onlineResult = quarantineStaleLock(file)          // ← 在线调用（不传 offline）
  } finally {
    fs.renameSync = realRename
  }

  ok('CXR01 在线调用 quarantineStaleLock 直接拒绝，不尝试任何 rename',
    onlineResult === null && renameAttempts === 0,
    `返回=${JSON.stringify(onlineResult)} rename 尝试次数=${renameAttempts}`)
  ok('CXR01 在线拒绝后锁文件仍在原处（没有被移走，也没有隔离产物）',
    fs.existsSync(lock) && fs.readdirSync(draftsDir).filter((n) => n.includes('.stale-')).length === 0)
  ok('CXR01 因此不可能出现"移走活锁"（movedLiveOwner 从未被写入）', movedLiveOwner === null, String(movedLiveOwner))

  // 只读诊断：报得出残留锁 + 绝对路径，但不动它
  const rows = listDraftLocks()
  const stale = listStaleDraftLocks()
  ok('CXR01 只读诊断能报出残留锁，并给出作者要删的绝对路径',
    stale.length === 1 && stale[0].dead === true && stale[0].path === lock && fs.existsSync(lock),
    JSON.stringify(rows))

  // 离线维护仍可动作（显式声明"我已确认没有写入者"）
  const moved = quarantineStaleLock(file, { offline: true })
  ok('CXR01 显式 { offline: true } 时离线维护仍能隔离，并保留取证文件',
    typeof moved === 'string' && moved.length > 0 && fs.existsSync(path.join(draftsDir, moved)) && !fs.existsSync(lock),
    String(moved))
  try { fs.rmSync(path.join(draftsDir, moved), { force: true }) } catch {}

  // 活锁：即使显式离线也绝不移动
  fs.writeFileSync(lock, process.pid + ':live-owner', 'utf8')
  ok('CXR01 活锁即使显式离线也不移动（dead=false 是硬条件）',
    quarantineStaleLock(file, { offline: true }) === null && fs.existsSync(lock))
  fs.rmSync(lock, { force: true })

  // 源码形状：index.js 里不该再有任何在线清扫；维护动作必须拒绝
  const indexSrc = fs.readFileSync(path.join(PLUGIN, 'index.js'), 'utf8')
  ok('CXR01 index.js 已无任何在线清扫调用（sweepStale* 不再存在）', !/sweepStale/.test(indexSrc))
  ok('CXR01 index.js 启动路径改为只读诊断', /listStaleDraftLocks\(\)/.test(indexSrc) && /listStaleCoordinationLocks\(\)/.test(indexSrc))
  ok('CXR01 维护接口 clear-stale-locks 改为拒绝并给出可操作指引',
    /stale-lock-clear-refused-online/.test(indexSrc) && /instruction/.test(indexSrc))
  for (const f of ['lib/draft-checkpoints.js', 'lib/coordination.js']) {
    const s = fs.readFileSync(path.join(PLUGIN, f), 'utf8')
    const importLine = (s.split('\n').find((l) => l.startsWith('import') && l.includes('./file-lock.js')) || '')
    ok(`CXR01 ${f} 的 file-lock 导入里不再包含 quarantineStaleLock`,
      importLine.length > 0 && !importLine.includes('quarantineStaleLock'), importLine.trim())
    ok(`CXR01 ${f} 改为导出只读的残留锁诊断`, /export function listStale\w+Locks\(\)/.test(s))
  }
}

/* ─────────────────────────────────────────────────────────────
 * CXR02 · 同名稿件不再被当成同一作品的证据
 * 场景与 Codex 完全一致：A/B 各有 draft/第一章.md，内容不同；移动 A 后在 B 查候选。
 * ───────────────────────────────────────────────────────────── */
{
  const old = path.join(base, '作品A')
  const target = path.join(base, '作品B')
  fs.mkdirSync(path.join(old, 'draft'), { recursive: true })
  fs.mkdirSync(path.join(target, 'draft'), { recursive: true })
  fs.writeFileSync(path.join(old, 'draft', '第一章.md'), '完全不同的A')
  fs.writeFileSync(path.join(target, 'draft', '第一章.md'), '完全不同的B')
  writeCheckpoint(old, 'writer', {
    baseRev: 0,
    text: 'A的秘密草稿',
    reference: { path: path.join(old, 'draft', '第一章.md'), text: '完全不同的A' },
  })
  fs.renameSync(old, old + '-moved')

  const candidate = relocationCandidates(target).find((c) => c.oldPath === old)
  ok('CXR02 同名同位不再被判为有关联（importable=false）',
    Boolean(candidate) && candidate.importable === false,
    JSON.stringify(candidate && { relation: candidate.relation, importable: candidate.importable }))
  ok('CXR02 relation 不再是 manuscript-reference，而是明确的"仅提示"',
    candidate?.relation === 'unrelated-filename-hint', String(candidate?.relation))
  ok('CXR02 detail 如实说明文件名相同不等于同一部作品',
    typeof candidate?.detail === 'string' && candidate.detail.includes('文件名相同不等于同一部作品') && candidate.detail.includes('不构成关联证据'),
    String(candidate?.detail))

  let importErr = null
  try { recoverRelocation(target, old, candidate.token) } catch (e) { importErr = e }
  ok('CXR02 不带 confirmUnrelated 时 host 拒绝导入（Codex 实测此处曾 copied=1）',
    importErr?.code === 'recovery-source-unrelated', String(importErr?.code || importErr))
  ok('CXR02 B 的桶未被 A 的草稿污染',
    listCheckpoints(target).every((c) => !String(c.text || '').includes('A的秘密草稿')))

  // 显式知情覆盖仍然是唯一出路，且留审计痕迹
  const forced = recoverRelocation(target, old, candidate.token, {}, { confirmUnrelated: true })
  ok('CXR02 作者显式确认后仍可导入（非破坏性），且关系记为 unrelated-author-confirmed',
    forced.copied >= 1 && forced.confirmedUnrelated === true && forced.relation === 'unrelated-author-confirmed',
    JSON.stringify({ copied: forced.copied, relation: forced.relation }))
  ok('CXR02 覆盖导入写进历史桶供事后追查',
    forced.histories.some((h) => h.relation === 'unrelated-author-confirmed' && h.oldPath === old))

  // 真迁移（备忘里记着旧路径）不受本次收紧影响
  const realOld = path.join(base, '真作品-old')
  const realNew = path.join(base, '真作品-new')
  fs.mkdirSync(realOld, { recursive: true })
  fs.mkdirSync(path.join(realNew, 'state'), { recursive: true })
  fs.writeFileSync(path.join(realOld, 'project.md'), 'x')
  writeCheckpoint(realOld, 'w', { baseRev: 0, text: '真作品的草稿' })
  fs.writeFileSync(path.join(realNew, 'state', 'writing-memory.json'),
    JSON.stringify({ schemaVersion: 2, projectKey: realOld, revision: 0, items: [], changes: [], operations: [] }))
  fs.renameSync(realOld, realOld + '-moved')
  const realCand = relocationCandidates(realNew).find((c) => c.oldPath === realOld)
  ok('CXR02 真迁移的强证据（备忘里的旧路径）未被误伤，仍可直接导入',
    Boolean(realCand) && realCand.importable === true && realCand.relation === 'memory-project-key',
    JSON.stringify(realCand && { relation: realCand.relation, importable: realCand.importable }))
}

/* ──────────────────────────────────────────────
 * CXR02 的界面侧（复核裁决 1：应明确显示来源、目的项目、无关联证据）
 * 这里做**静态形状**断言：真正的端到端 UI 跑动由 Codex 的 repair-ui.cjs（D04）覆盖，
 * 它现在走的正是“无证据 → 显式确认 → 导入”这条路且仍 PASS。
 * ────────────────────────────────────────────── */
{
  const uiSrc = fs.readFileSync(path.join(PLUGIN, 'src/client/features/world-settings/index.js'), 'utf8')
  ok('CXR02 面板说明不再把“同名同位”列为关联证据，并明说它不算证据',
    uiSrc.includes('**不算证据**') && !/或旧草稿引用的手稿在本作品里同名同位）/.test(uiSrc))
  ok('CXR02 确认框同时显示来源与目的项目（不是只说“当前作品”）',
    uiSrc.includes('来源（旧位置）：') && uiSrc.includes('目的（当前作品）：'))
  // 构建产物必须同步（client.js 是 src/client 的打包结果，忘了重建就会发旧文案）
  const built = fs.readFileSync(path.join(PLUGIN, 'client.js'), 'utf8')
  ok('CXR02 已重建的 client.js 里带新文案（源码与产物同步）',
    built.includes('来源（旧位置）：') && built.includes('不算证据'))
}

console.log('')
console.log(failures.length ? 'CXR_FIX_FAIL ' + failures.length + ' 项：' + failures.join(' | ') : 'CXR_FIX_OK 0 项失败')
console.log('隔离目录：' + base)
process.exit(failures.length === 0 ? 0 : 1)
