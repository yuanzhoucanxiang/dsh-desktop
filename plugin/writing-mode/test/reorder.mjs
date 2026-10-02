/**
 * 章节重排序（卡片拖拽 host 侧）回归：planReorder / applyReorder 纯函数 + 真实 HTTP 端到端。
 * 安全不变量：两阶段改名绝不覆盖既有文件；失败回滚；崩溃遗留 .tmp 拒绝新事务；
 * 期望顺序必须与现有系列一一对应；只动 draft/ 下的文本文件。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-reorder-'))
process.env.DSH_HOME = path.join(temp, 'home')
const root = path.join(temp, 'library')
fs.mkdirSync(root, { recursive: true })

const reorder = await import('../lib/reorder.js')
const store = await import('../lib/store.js')
const host = await import('../index.js')

let passed = 0
const ok = (cond, label, extra) => {
  assert.ok(cond, label + (extra === undefined ? '' : ' ' + JSON.stringify(extra)))
  passed++
  console.log('PASS', label)
}

/* ── planReorder 纯函数 ─────────────────────────────────── */

const S = (key, base, names) => ({ key, base, files: names.map((n) => ({ abs: 'X:\\p\\draft\\novel\\' + n, name: n })) })
const current = [S('第1章.md', '第1章.md', ['第1章-v1.md', '第1章-v2.md']), S('第2章.md', '第2章.md', ['第2章-v1.md']), S('第3章.md', '第3章.md', ['第3章-v1.md'])]

{
  const plan = reorder.planReorder(current, ['第1章.md', '第2章.md', '第3章.md'])
  ok(plan.moves.length === 0, '同序无需改名')

  const plan2 = reorder.planReorder(current, ['第3章.md', '第1章.md', '第2章.md'])
  ok(plan2.moves.length === 3, '三系列循环移位 → 三个改名计划', plan2.moves.map(m => m.fromBase + '→' + m.toBase))
  const first = plan2.moves.find((m) => m.key === '第3章.md')
  ok(first.files.length === 1 && first.files[0].finalName === '第1章-v1.md', '第3章系列顶到第 1 位：第3章-v1.md → 第1章-v1.md', first.files)
  const second = plan2.moves.find((m) => m.key === '第1章.md')
  ok(second.files.map((f) => f.finalName).join(',') === '第2章-v1.md,第2章-v2.md', '第1章系列（含双版本）→ 第2章，版本后缀保留', second.files)

  assert.throws(() => reorder.planReorder(current, ['第3章.md', '第1章.md']), /order-shape-invalid/, '少一个系列拒绝')
  assert.throws(() => reorder.planReorder(current, ['第3章.md', '第1章.md', '第1章.md']), /order-shape-invalid/, '重复系列拒绝')
  assert.throws(() => reorder.planReorder(current, ['第3章.md', '第1章.md', '第9章.md']), /order-unknown-series/, '未知系列拒绝')
  ok(true, 'planReorder 非法形状按 code 抛错')
}

/* ── applyReorder 可注入 io：两阶段 + 回滚 + 撞名 + 遗留 ── */

{
  const plan = reorder.planReorder(current, ['第3章.md', '第1章.md', '第2章.md'])
  const SEED = [
    ['x:\\p\\draft\\novel\\第1章-v1.md', 'c1v1'],
    ['x:\\p\\draft\\novel\\第1章-v2.md', 'c1v2'],
    ['x:\\p\\draft\\novel\\第2章-v1.md', 'c2v1'],
    ['x:\\p\\draft\\novel\\第3章-v1.md', 'c3v1'],
  ]
  // 每次 mkIo 都用独立快照：io 之间互不污染（io1 的落盘结果不该影响 io3 的预检）
  const mkIo = () => {
    const files = new Map(SEED.map(([k, v]) => [k, v]))
    const renames = []
    return {
      files,
      exists: (p) => files.has(String(p).toLowerCase()),
      rename: (a, b) => {
        const ka = String(a).toLowerCase()
        const kb = String(b).toLowerCase()
        const av = [...files.entries()].find(([k]) => k === ka)
        assert.ok(av, 'rename 源必须存在: ' + a)
        files.delete(ka)
        assert.ok(!files.has(kb), 'rename 目标不得已存在（绝不覆盖）: ' + b)
        files.set(kb, av[1])
        renames.push({ from: a, to: b })
      },
      listTmp: () => [],
    }
  }

  const io1 = mkIo()
  reorder.applyReorder(plan.moves, plan.token, ['X:\\p\\draft\\novel'], io1)
  ok(io1.files.get('x:\\p\\draft\\novel\\第1章-v1.md') === 'c3v1', '新第1章 = 旧第3章内容')
  ok(io1.files.get('x:\\p\\draft\\novel\\第2章-v2.md') === 'c1v2', '新第2章-v2 = 旧第1章-v2 内容（版本后缀保留）')
  ok(io1.files.get('x:\\p\\draft\\novel\\第3章-v1.md') === 'c2v1', '新第3章 = 旧第2章内容')
  ok(io1.files.size === 4 && ![...io1.files.keys()].some((k) => k.includes('.reorder-')), '无遗留 tmp、文件数不变')

  // 阶段一第 3 个 rename 时失败：必须回滚到原始命名
  const io3 = mkIo()
  const origRename = io3.rename
  let n = 0
  io3.rename = (a, b) => { n += 1; if (n === 3) throw new Error('io-fail'); return origRename(a, b) }
  assert.throws(() => reorder.applyReorder(plan.moves, plan.token, ['X:\\p\\draft\\novel'], io3), /io-fail/, '中途失败抛错')
  ok(io3.files.get('x:\\p\\draft\\novel\\第1章-v1.md') === 'c1v1' && io3.files.get('x:\\p\\draft\\novel\\第3章-v1.md') === 'c3v1', '失败后回滚到原始命名（内容各归其位）')
  ok(![...io3.files.keys()].some((k) => k.includes('.reorder-')), '回滚后无 tmp 残留')

  // 遗留 tmp 拒绝
  const io4 = mkIo()
  io4.listTmp = () => ['第2章-v1.md.reorder-旧事务.tmp']
  assert.throws(() => reorder.applyReorder(plan.moves, plan.token, ['X:\\p\\draft\\novel'], io4), /reorder-leftovers/, '遗留 tmp 拒绝新事务')
}

/* ── HTTP 端到端 ────────────────────────────────────────── */

store.writeConfig({ roots: [{ path: root }], activeRoot: root })
let handler
host.apply({ effect: (f) => f(), webServer: { register: (r) => { handler = r.handler; return () => {} } } })
const server = http.createServer((req, res) => handler(req, res))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/api/writing-mode`
const post = async (body, route = 'compile') =>
  (await fetch(`${base}?route=${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()
const get = async (route, qs = '') =>
  (await fetch(`${base}?route=${route}${qs}`)).json()

try {
  const created = await post({ title: '重排测试', templateId: 'novel' }, 'create-project')
  assert.equal(created.ok, true, JSON.stringify(created))
  const project = created.project.path
  const draftDir = path.join(project, 'draft', 'novel')
  const write = (name, body) => fs.writeFileSync(path.join(draftDir, name), body, 'utf8')
  write('第1章-v1.md', '一章一版')
  write('第1章-v2.md', '一章二版')
  write('第2章-v1.md', '二章')
  write('第3章-v1.md', '三章')

  const abs = (n) => path.join(draftDir, n)
  const r1 = await post({ project, order: [abs('第3章-v1.md'), abs('第1章-v2.md'), abs('第2章-v1.md')] }, 'reorder')
  ok(r1.ok === true && r1.moved === 4, '重排受理（4 个文件改名）', r1)
  ok(fs.readFileSync(abs('第1章-v1.md'), 'utf8') === '三章', '新第1章 = 旧第3章')
  ok(fs.readFileSync(abs('第2章-v2.md'), 'utf8') === '一章二版', '新第2章-v2 = 旧第1章-v2（版本后缀保留）')
  ok(fs.readFileSync(abs('第3章-v1.md'), 'utf8') === '二章', '新第3章 = 旧第2章')
  const scan = (await get('outline', `&project=${encodeURIComponent(project)}`)).outline.rows.map((x) => x.name).join(',')
  ok(scan === '第1章-v1.md,第2章-v2.md,第3章-v1.md', '重排后大纲按新顺序读出（新第1章系列只含 v1）', scan)
  ok(!fs.readdirSync(draftDir).some((n) => n.includes('.reorder-')), '无遗留 tmp')

  ok((await post({ project, order: [abs('第1章-v1.md'), abs('第2章-v2.md')] }, 'reorder')).error === 'order-shape-invalid', '缺系列拒绝（数量不符）')
  ok((await post({ project, order: [abs('第1章-v2.md'), abs('第2章-v2.md'), abs('第3章-v1.md'), abs('第9章-v1.md')] }, 'reorder')).error === 'order-unknown-series', '未知系列拒绝')
  ok((await post({ project, order: [abs('第1章-v1.md'), abs('第1章-v1.md'), abs('第2章-v2.md'), abs('第3章-v1.md')] }, 'reorder')).error === 'order-duplicate-series', '重复系列拒绝')
  ok((await post({ project, order: '不是数组' }, 'reorder')).error === 'order-required', '非数组 order 拒绝')
  ok((await post({ project: path.join(temp, 'outside'), order: [] }, 'reorder')).error === 'invalid-project', '越界项目拒绝')

  // 遗留 tmp：再塞一个中间态文件，事务必须拒绝且不动原稿
  fs.writeFileSync(path.join(draftDir, '第2章-v1.md.reorder-旧事务.tmp'), '二章')
  const r5 = await post({ project, order: [abs('第2章-v2.md'), abs('第1章-v1.md'), abs('第3章-v1.md')] }, 'reorder')
  ok(r5.ok === false && r5.error.startsWith('reorder-leftovers'), '遗留 tmp 拒绝新事务（409 指路）', r5)
  ok(fs.readFileSync(abs('第1章-v1.md'), 'utf8') === '三章', '拒绝时原稿一个字没动')
  fs.unlinkSync(path.join(draftDir, '第2章-v1.md.reorder-旧事务.tmp'))
} finally {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
}

console.log(`WRITING_REORDER_OK ${passed} passed, 0 failed`)
