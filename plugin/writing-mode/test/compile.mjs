/**
 * 导出成书（compile）回归：纯函数 + 真实 HTTP 端到端。
 * 脚手架与 create-project-http.mjs 同：隔离 DSH_HOME + 真起 loopback HTTP。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-compile-'))
process.env.DSH_HOME = path.join(temp, 'home')
const root = path.join(temp, 'library')
fs.mkdirSync(root, { recursive: true })

const { versionOfName, seriesKeyOf, latestOfSeries, naturalSortFiles, chapterTitle, safeBookTitle, compileBook } = await import('../lib/compile.js')
const store = await import('../lib/store.js')
const host = await import('../index.js')

let passed = 0
const ok = (cond, label, extra) => {
  assert.ok(cond, label + (extra === undefined ? '' : ' ' + JSON.stringify(extra)))
  passed++
  console.log('PASS', label)
}

/* ── 纯函数 ─────────────────────────────────────────────── */

ok(versionOfName('第1章-v3.md') === 3 && versionOfName('plain.md') === null, 'versionOfName 解析 -vN / 无版本')
ok(seriesKeyOf('draft/novel/第1章-V2.md') === 'draft/novel/第1章.md', 'seriesKeyOf 抹掉 -vN 且小写')

{
  const f = (rel) => ({ rel, name: rel.split('/').pop() })
  const files = [f('draft/novel/第1章-v1.md'), f('draft/novel/第1章-v3.md'), f('draft/novel/第1章-v2.md'), f('draft/novel/序章.md')]
  const r = latestOfSeries(files)
  ok(r.latest.map((x) => x.name).join(',') === '第1章-v3.md,序章.md', 'latestOfSeries 每系列只留当前版、无版本文件保留')
  ok(r.skipped.map((x) => x.name).join(',') === '第1章-v1.md,第1章-v2.md', 'latestOfSeries 历史版进 skipped 且保序')
  const sorted = naturalSortFiles([f('draft/novel/第10章-v1.md'), f('draft/novel/第2章-v1.md'), f('draft/novel/第1章-v1.md')])
  ok(sorted.map((x) => x.name).join(',') === '第1章-v1.md,第2章-v1.md,第10章-v1.md', 'naturalSortFiles 数字自然序（第2章 < 第10章）')
}

ok(chapterTitle('第3章-夜行-v2.md') === '第3章-夜行' && chapterTitle('act1-v1.fountain') === 'act1', 'chapterTitle 去扩展名与 -vN')
ok(safeBookTitle('a/b:c') === 'abc' && safeBookTitle('..') === null && safeBookTitle('') === null && safeBookTitle('CON') === null, 'safeBookTitle 剔除非法字符并拒绝坏名')

{
  const withOwn = compileBook([{ title: '第1章', content: '# 第1章 夜行\r\n\r\n正文甲\r\n' }], { format: 'markdown', title: '书', date: 'D', titles: true })
  ok(withOwn.text.includes('# 书\n') && (withOwn.text.match(/^# 第1章/gm) || []).length === 1, '章自带标题时不重复插入')
  ok(!withOwn.text.includes('\r'), '导出统一 LF（原稿 CRLF 不进成片）')
  const noOwn = compileBook([{ title: '第2章', content: '正文乙' }], { format: 'markdown', title: '书', date: 'D', titles: true })
  ok(noOwn.text.includes('# 第2章\n\n正文乙'), '无标题章节补插文件名标题')
  const noTitles = compileBook([{ title: '第2章', content: '正文乙' }], { format: 'markdown', title: '书', date: 'D', titles: false })
  ok(!noTitles.text.includes('# 第2章'), 'titles=false 不插标题')
  const sc = compileBook([{ title: 'a', content: 'INT. 甲 - 日' }, { title: 'b', content: 'EXT. 乙 - 夜' }], { format: 'fountain', title: '本', date: 'D' })
  ok(sc.text.startsWith('Title: 本\n') && sc.text.includes('\n\n===\n\n') && !sc.text.includes('# a'), 'fountain 题页 + 分页符 + 不插 Markdown 标题')
  ok(sc.chars === 'INT. 甲 - 日EXT. 乙 - 夜'.replace(/\s+/g, '').length, 'chars 去空白计字')
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

try {
  // 轻量建项 → project.md + draft/novel/第1章-v1.md
  const created = await post({ title: '成书测试', templateId: 'novel' }, 'create-project')
  assert.equal(created.ok, true, JSON.stringify(created))
  const project = created.project.path
  const draftDir = path.join(project, 'draft', 'novel')
  const write = (name, body) => fs.writeFileSync(path.join(draftDir, name), body, 'utf8')
  write('第1章-v2.md', '第一章正文新版，写于v2。')
  write('第2章-v1.md', '# 第2章 自带标题\n\n第二章正文。')
  write('第10章-v1.md', '第十章正文。')

  const r1 = await post({ path: project })
  ok(r1.ok === true && r1.doc.path.endsWith(`${path.sep}成书测试-v1.md`), '默认导出：输出到项目根 <书名>-v1.md', r1.doc && r1.doc.path)
  const text1 = fs.readFileSync(r1.doc.path, 'utf8')
  const posA = text1.indexOf('第一章正文新版')
  const posB = text1.indexOf('第二章正文。')
  const posC = text1.indexOf('第十章正文。')
  ok(posA > -1 && posB > posA && posC > posB, '章节顺序 = 文档树自然序（1 < 2 < 10）')
  ok(!text1.includes('draft/novel/第1章-v1') && !text1.includes('# 第1章\n\n\n') && text1.includes('第一章正文新版，写于v2。'), '每系列只收当前版（v2 进、v1 不进）')
  ok(r1.stats.files === 3 && r1.stats.skipped.join(',') === 'draft/novel/第1章-v1.md', 'stats 报告篇数与被略过的历史版')
  ok(text1.includes('共 3 篇') && text1.startsWith('# 成书测试'), '书头含书名与篇数')
  ok((text1.match(/^# 第2章 自带标题/gm) || []).length === 1 && text1.includes('# 第1章\n\n第一章正文新版'), '自带标题不重复、无标题补插')
  ok(text1.endsWith('\n') && !text1.includes('\uFFFD'), '成片结尾换行且无乱码')

  const r2 = await post({ path: project })
  ok(r2.ok === true && r2.doc.path.endsWith(`${path.sep}成书测试-v2.md`), '再次导出递增 -v2')
  ok(fs.readFileSync(r1.doc.path, 'utf8') === text1, '已有成片绝不覆盖')
  ok(r2.stats.files === 3, '成片自身不进默认候选（仍在项目根、非 draft/）')

  const r3 = await post({ path: project, include: ['draft/novel/第10章-v1.md', 'draft/novel/第2章-v1.md'], title: '选篇' })
  const text3 = fs.readFileSync(r3.doc.path, 'utf8')
  ok(text3.indexOf('第十章正文。') < text3.indexOf('第二章正文。'), 'include 显式清单：顺序即章节顺序')
  const r4 = await post({ path: project, include: ['draft/novel/第1章-v1.md'], title: '历史版' })
  const text4 = r4.ok ? fs.readFileSync(r4.doc.path, 'utf8') : ''
  ok(r4.ok === true && text4.includes('# 第1章') && !text4.includes('第一章正文新版'), 'include 允许显式收历史版（v1 模板内容进、v2 正文不进）')

  ok((await post({ path: project, include: [] })).error === 'empty-include', '空 include 拒绝')
  ok((await post({ path: project, include: ['../outside.md'] })).error === 'bad-include', 'include 越界拒绝')
  ok((await post({ path: project, include: ['draft/novel/没有这章.md'] })).error === 'unknown-include', 'include 未知文件拒绝')
  ok((await post({ path: path.join(temp, 'elsewhere'), title: 'x' })).error === 'path-outside-roots', '库根外路径拒绝')
  ok((await post({ path: project, title: '..' })).error === 'invalid-title', '坏书名拒绝')

  // fountain 项目端到端
  fs.mkdirSync(path.join(project, 'draft', 'script'), { recursive: true })
  fs.writeFileSync(path.join(project, 'draft', 'script', '第1集-v1.fountain'), 'INT. 客栈 - 日\n\n张三坐下。', 'utf8')
  fs.writeFileSync(path.join(project, 'draft', 'script', '第2集-v1.fountain'), 'EXT. 官道 - 夜\n\n马蹄声。', 'utf8')
  ok((await post({ path: project })).error === 'mixed-formats', '混合格式的默认候选拒绝并如实报')
  const rf = await post({ path: project, include: ['draft/script/第1集-v1.fountain', 'draft/script/第2集-v1.fountain'], title: '剧本选篇' })
  const textF = fs.readFileSync(rf.doc.path, 'utf8')
  ok(rf.doc.path.endsWith('.fountain') && textF.startsWith('Title: 剧本选篇') && textF.includes('==='), 'fountain 端到端：题页 + 分页')

  const get = await fetch(`${base}?route=compile`)
  ok(get.status === 405, 'GET compile 被方法白名单拒（405）')
} finally {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
}

console.log(`COMPILE_OK ${passed} passed, 0 failed`)
