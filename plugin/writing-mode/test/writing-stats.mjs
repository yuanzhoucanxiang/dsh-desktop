/**
 * 码字统计（writing-stats）回归：纯函数 + 真实 HTTP 端到端。
 * 脚手架与 compile.mjs 同：隔离 DSH_HOME + 真起 loopback HTTP。
 *
 * 记账口径（实现与测试共同钉住）：
 * - 首见稿件只播种基线、不计增量（老项目首存不虚增）；
 * - 净增 = 本次 CJK − 上次记录，负数记 0；
 * - 打开（GET get）即播种；save/version 成功后记账；compile 不记账；
 * - stats 只读返回今日净增/连击/近 14 天/日更目标。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-stats-'))
process.env.DSH_HOME = path.join(temp, 'home')
const root = path.join(temp, 'library')
fs.mkdirSync(root, { recursive: true })

const stats = await import('../lib/writing-stats.js')
const store = await import('../lib/store.js')
const host = await import('../index.js')

let passed = 0
const ok = (cond, label, extra) => {
  assert.ok(cond, label + (extra === undefined ? '' : ' ' + JSON.stringify(extra)))
  passed++
  console.log('PASS', label)
}

const NOON = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0)

/* ── 纯函数 ─────────────────────────────────────────────── */

ok(stats.cjkCount('你好 world 世界') === 4, 'cjkCount 只数 CJK')
ok(stats.todayKey(NOON(2026, 10, 2)) === '2026-10-02', 'todayKey 本地日期零填充')

{
  const proj = path.join(temp, 'proj-pure')
  fs.mkdirSync(path.join(proj, 'state'), { recursive: true })
  const doc = path.join(proj, 'draft', 'novel', '第1章.md')
  fs.mkdirSync(path.dirname(doc), { recursive: true })

  const base400 = '已有三千字' + '一二三四五六七八九十'.repeat(300)
  ok(stats.seedBaseline(proj, doc, base400) === true, '首见播种返回 true')
  ok(stats.readStats(proj).files['draft/novel/第1章.md'] === stats.cjkCount(base400), '播种写入基线（无版本后缀相对小写键）')
  ok(stats.seedBaseline(proj, doc, '改动后的文本') === false, '已见再播种是 no-op 返回 false')

  const base300 = '已有三千字' + '一二三四五六七八九十'.repeat(300) + '续'.repeat(1000)
  const r1 = stats.recordSave(proj, doc, base300, NOON(2026, 10, 2))
  ok(r1.delta === 1000 && r1.today === 1000, '净增 = 新 CJK − 基线', r1)

  const r2 = stats.recordSave(proj, doc, '删到只剩十个字', NOON(2026, 10, 2))
  ok(r2.delta === 0 && r2.today === 1000, '大删减不倒扣（delta=0，今日不回吐）', r2)

  stats.recordSave(proj, doc, '删到只剩十个字' + '又'.repeat(30), NOON(2026, 10, 3))
  const s = stats.statsSummary(proj, { now: NOON(2026, 10, 3) })
  ok(s.today === 30 && s.days.length === 14, '跨日翻页：10-3 净增 30 记新账；窗口 14 天', s.today)
  ok(s.days[s.days.length - 1].day === '2026-10-03' && s.days[0].day === '2026-09-20', 'days 首尾日期正确（旧→新）')
  ok(s.streak === 2, '连续两天有产出 → 连击 2', s.streak)

  const s4 = stats.statsSummary(proj, { now: NOON(2026, 10, 5) })
  ok(s4.today === 0 && s4.streak === 0, '隔两天未写连击清零', s4.streak)

  // 今天还没写：连击保留到昨天
  const p2 = path.join(temp, 'proj-pure2')
  fs.mkdirSync(p2, { recursive: true })
  const d2 = path.join(p2, 'a.md')
  stats.seedBaseline(p2, d2, '')
  stats.recordSave(p2, d2, '昨天写的', NOON(2026, 10, 4))
  const s5 = stats.statsSummary(p2, { now: NOON(2026, 10, 5) })
  ok(s5.today === 0 && s5.streak === 1, '今天未写不清零：连击算到昨天', s5.streak)

  // 坏 JSON 容错
  fs.writeFileSync(stats.statsPath(proj), '{oops', 'utf8')
  const s6 = stats.statsSummary(proj, { now: NOON(2026, 10, 5) })
  ok(s6.today === 0 && s6.corrupt === true, '坏 JSON 按空账本起步并标记 corrupt')
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
  const created = await post({ title: '码字统计', templateId: 'novel' }, 'create-project')
  assert.equal(created.ok, true, JSON.stringify(created))
  const project = created.project.path
  const doc = path.join(project, 'draft', 'novel', '第1章-v1.md')

  // 模板里 v1 有内容：GET 打开 → 播种基线（不计今日）
  const opened = await get('get', `&path=${encodeURIComponent(doc)}`)
  ok(opened.ok === true && typeof opened.doc.content === 'string', 'GET get 打开成功', opened.error)
  let st = await get('stats', `&path=${encodeURIComponent(doc)}`)
  ok(st.ok === true && st.stats && st.stats.today === 0 && st.dailyGoal === 0, '打开后今日为 0（只播种不记账）且目标默认 0', st.stats)

  // 保存：净增 = 新增片段的 CJK 数（程序化期望，不手数）
  const add1 = '新写的五百字' + '甲乙丙丁'.repeat(125)
  const c1 = opened.doc.content + add1
  const sv1 = await post({ path: doc, content: c1, revision: opened.doc.revision }, 'save')
  assert.equal(sv1.ok, true, JSON.stringify(sv1))
  st = await get('stats', `&path=${encodeURIComponent(doc)}`)
  ok(st.stats.today === stats.cjkCount(add1), '保存后今日 = 新增片段 CJK 数', st.stats)

  // 再保存：净增第二个片段
  const add2 = '又写了三十个字呀呀'
  const sv2 = await post({ path: doc, content: c1 + add2, revision: sv1.doc.revision }, 'save')
  st = await get('stats', `&path=${encodeURIComponent(doc)}`)
  ok(st.ok && st.stats.today === stats.cjkCount(add1) + stats.cjkCount(add2), '第二次保存累计净增', st.stats?.today)

  // 另存新版：新文件首见 → 播种不虚增
  const ver = await post({ path: doc, content: c1 + add2, revision: sv2.doc.revision }, 'version')
  assert.equal(ver.ok, true, JSON.stringify(ver))
  st = await get('stats', `&path=${encodeURIComponent(ver.doc.path)}`)
  ok(st.ok && st.stats.today === stats.cjkCount(add1) + stats.cjkCount(add2), '另存新版（新路径首见）不把整章算成今日', st.stats?.today)

  // 目标经 prefs 持久化并回读
  const pf = await post({ dailyGoal: 2000 }, 'prefs')
  ok(pf.ok === true && pf.prefs.dailyGoal === 2000, 'prefs 接受 dailyGoal')
  st = await get('stats', `&path=${encodeURIComponent(doc)}`)
  ok(st.dailyGoal === 2000, 'stats 回读 dailyGoal')

  // 越界与散稿
  ok((await get('stats', `&path=${encodeURIComponent(path.join(temp, 'outside.md'))}`)).error === 'path-outside-roots', '库根外 stats 拒绝')
  const loose = path.join(root, '散稿.md')
  fs.writeFileSync(loose, '随便', 'utf8')
  const stLoose = await get('stats', `&path=${encodeURIComponent(loose)}`)
  ok(stLoose.ok === true && stLoose.stats === null, '项目外散稿 stats 返回 null（不记账）')

  // save 后 status 里的台账不踩：确认普通 save 响应仍带 doc
  ok(sv2.doc.path === doc && typeof sv2.doc.revision === 'string', 'save 响应形状未变（path/revision）')
} finally {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
}

console.log(`WRITING_STATS_OK ${passed} passed, 0 failed`)
