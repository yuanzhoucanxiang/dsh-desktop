/**
 * 大纲视图批量口径（GET outline）端到端：与 compile.mjs 同脚手架（隔离 DSH_HOME + 真 HTTP）。
 * 口径：每 draft 系列只收当前版；字数去空白；钩子只认「章末钩子：」显式标记；
 * 门禁摘要只对 novel md / fountain 给出；structure.md 标题行透出；越界项目 400。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-outline-'))
process.env.DSH_HOME = path.join(temp, 'home')
const root = path.join(temp, 'library')
fs.mkdirSync(root, { recursive: true })

const store = await import('../lib/store.js')
const host = await import('../index.js')

let passed = 0
const ok = (cond, label, extra) => {
  assert.ok(cond, label + (extra === undefined ? '' : ' ' + JSON.stringify(extra)))
  passed++
  console.log('PASS', label)
}

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
  const created = await post({ title: '大纲测试', templateId: 'novel' }, 'create-project')
  assert.equal(created.ok, true, JSON.stringify(created))
  const project = created.project.path
  const draftDir = path.join(project, 'draft', 'novel')
  const write = (name, body) => fs.writeFileSync(path.join(draftDir, name), body, 'utf8')

  // 第1章两个版本（应只收 v2）；第2章带显式章末钩子；第10章验自然序
  write('第1章-v2.md', '第一章新版正文。')
  write('第2章-v1.md', '第二章正文。\n章末钩子：门外传来了第二遍敲门声。')
  write('第10章-v1.md', '第十章正文。')
  fs.mkdirSync(path.join(project, 'outline'), { recursive: true })
  fs.writeFileSync(path.join(project, 'outline', 'structure.md'), '# 第一幕\n## 起\n\n# 第二幕\n', 'utf8')

  const r = await get('outline', `&project=${encodeURIComponent(project)}`)
  ok(r.ok === true && r.outline && r.outline.project === project, 'GET outline 返回 ok', r.error)
  const rows = r.outline.rows || []
  ok(rows.length === 3, '三个 draft 系列各一行（第1章只收当前版 v2）', rows.map(x => x.name))
  ok(rows.map((x) => x.name).join(',') === '第1章-v2.md,第2章-v1.md,第10章-v1.md', '自然序：第2章 < 第10章')
  const row1 = rows.find((x) => x.name === '第1章-v2.md')
  ok(row1.chars === '第一章新版正文。'.replace(/\s+/g, '').length, '字数去空白口径', row1.chars)
  ok(row1.hook === '', '无显式钩子标记 → hook 为空（不拿末行凑数）', row1.hook)
  ok(row1.gate && row1.gate.pass === false && row1.gate.fail > 0, 'novel md 有门禁摘要（1800 字门槛不达标）', row1.gate)
  const row2 = rows.find((x) => x.name === '第2章-v1.md')
  ok(row2.hook === '门外传来了第二遍敲门声。', '显式章末钩子透出', row2.hook)
  ok(Array.isArray(r.outline.structure) && r.outline.structure.join('|') === '# 第一幕|## 起|# 第二幕', 'structure.md 标题行（含子级 #）', r.outline.structure)

  // 越界与散稿根
  ok((await get('outline', `&project=${encodeURIComponent(path.join(temp, 'outside'))}`)).error === 'invalid-project', '库根外项目 400 invalid-project')
  ok((await get('outline', `&project=${encodeURIComponent('')}`)).error === 'invalid-project', '空 project 400')
} finally {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
}

console.log(`WRITING_OUTLINE_OK ${passed} passed, 0 failed`)
