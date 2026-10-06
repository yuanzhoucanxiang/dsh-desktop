/**
 * 每日快照（安全网）回归：zip 纯 JS 生成（真实用 System32 tar 解包验证）+ 按日去重 +
 * 保留清理 + save 触发端到端。备份红线：只读项目、只写备份目录、失败不挡保存。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import http from 'node:http'
import assert from 'node:assert/strict'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-snap-'))
process.env.DSH_HOME = path.join(temp, 'home')
const root = path.join(temp, 'library')
fs.mkdirSync(root, { recursive: true })

const snap = await import('../lib/snapshot.js')
const store = await import('../lib/store.js')
const host = await import('../index.js')

let passed = 0
const ok = (cond, label, extra) => {
  assert.ok(cond, label + (extra === undefined ? '' : ' ' + JSON.stringify(extra)))
  passed++
  console.log('PASS', label)
}

const NOON = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0)
const sysTar = `${process.env.SystemRoot}\\System32\\tar.exe`

/* ── 纯函数：crc32 / buildZip ───────────────────────────── */

ok(snap.crc32(Buffer.from('123456789')) === 0xcbf43926, 'crc32 标准向量（123456789 → CBF43926）')

{
  const zip = snap.buildZip([
    { name: 'draft/第一章.md', data: '雾从海面压过来。' },
    { name: 'project.md', data: '作品名：快照测试' },
  ], NOON(2026, 10, 6))
  ok(zip.slice(0, 2).toString() === 'PK', 'zip 头魔数')
  const outDir = path.join(temp, 'unzip')
  fs.mkdirSync(outDir, { recursive: true })
  const zipPath = path.join(temp, 'probe.zip')
  fs.writeFileSync(zipPath, zip)
  execFileSync(sysTar, ['-xf', zipPath, '-C', outDir], { stdio: 'ignore' })
  ok(fs.readFileSync(path.join(outDir, 'draft/第一章.md'), 'utf8') === '雾从海面压过来。', 'System32 tar 能解包：中文路径 + 内容逐字一致')
  ok(fs.readFileSync(path.join(outDir, 'project.md'), 'utf8') === '作品名：快照测试', '第二个条目内容一致')
}

/* ── snapshotProject：建份 / 去重 / 保留清理 ─────────────── */

{
  const project = path.join(root, '快照作品')
  fs.mkdirSync(path.join(project, 'draft/novel'), { recursive: true })
  fs.writeFileSync(path.join(project, 'project.md'), '作品名：快照作品')
  fs.writeFileSync(path.join(project, 'draft/novel/第1章-v1.md'), '第一章正文')
  const backups = path.join(temp, 'backups')

  const r1 = await snap.snapshotProject(project, { now: NOON(2026, 10, 6), keep: 2, backupDir: backups })
  ok(r1.ok === true && r1.skipped === false && fs.existsSync(r1.file), '当天首拍落盘', r1)
  const zipName = path.basename(r1.file)
  ok(zipName === '快照作品-20261006.zip', '文件名 = <作品名>-<YYYYMMDD>.zip', zipName)

  const before = fs.statSync(r1.file).mtimeMs
  const r2 = await snap.snapshotProject(project, { now: NOON(2026, 10, 6), keep: 2, backupDir: backups })
  ok(r2.ok === true && r2.skipped === true && fs.statSync(r1.file).mtimeMs === before, '同日再拍跳过（不去重会一天几百份）')

  // 次日再拍 + 伪造更早的档，验证保留数清理（keep=2）
  fs.writeFileSync(path.join(backups, '快照作品-20261003.zip'), 'old')
  fs.writeFileSync(path.join(backups, '快照作品-20261004.zip'), 'old2')
  await snap.snapshotProject(project, { now: NOON(2026, 10, 7), keep: 2, backupDir: backups })
  const left = fs.readdirSync(backups).filter((n) => n.startsWith('快照作品-')).sort()
  ok(left.join(',') === '快照作品-20261006.zip,快照作品-20261007.zip', '保留最近 keep 份，更旧清掉', left)

  // 项目消失：如实失败不抛
  const r3 = await snap.snapshotProject(path.join(temp, 'no-such'), { backupDir: backups })
  ok(r3.ok === false && r3.reason === 'project-missing', '项目不存在如实报')
}

/* ── HTTP 端到端：save 触发每日快照 ─────────────────────── */

store.writeConfig({ roots: [{ path: root }], activeRoot: root })
let handler
host.apply({ effect: (f) => f(), webServer: { register: (r) => { handler = r.handler; return () => {} } } })
const server = http.createServer((req, res) => handler(req, res))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/api/writing-mode`
const post = async (body, route = 'save') =>
  (await fetch(`${base}?route=${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()

try {
  const created = await post({ title: '快照触发', templateId: 'novel' }, 'create-project')
  assert.equal(created.ok, true, JSON.stringify(created))
  const project = created.project.path
  const doc = path.join(project, 'draft', 'novel', '第1章-v1.md')
  const opened = await (await fetch(`${base}?route=get&path=${encodeURIComponent(doc)}`)).json()
  const sv = await post({ path: doc, content: opened.doc.content + '新增一段。', revision: opened.doc.revision }, 'save')
  assert.equal(sv.ok, true, JSON.stringify(sv))
  // scheduleDailySnapshot 是 fire-and-forget：轮询等它落盘
  const backups = path.join(process.env.DSH_HOME, 'writing-backups')
  let file = null
  for (let i = 0; i < 50 && !file; i += 1) {
    await new Promise((r) => setTimeout(r, 100))
    const dir = fs.existsSync(backups) ? fs.readdirSync(backups).find((n) => n.startsWith('快照触发-')) : null
    if (dir) file = path.join(backups, dir)
  }
  ok(file !== null && fs.existsSync(file), 'save 成功后备份目录出现当日快照', file)
  ok(String(process.env.DSH_HOME).includes('wm-snap'), '备份落在隔离 DSH_HOME（不碰真实 ~/.dsh）')
  ok(!fs.readdirSync(project).some((n) => n.endsWith('.zip')), '项目目录内零污染（备份全在项目外）')
} finally {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
}

console.log(`WRITING_SNAPSHOT_OK ${passed} passed, 0 failed`)
