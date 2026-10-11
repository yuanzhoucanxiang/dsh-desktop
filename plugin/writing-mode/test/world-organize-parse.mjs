/**
 * 「整理为设定」解析器测试（2026-10-11）：真机实测发现模型常把 JSON 夹在解释里且不带围栏，
 * 原实现直接判失败 → 一条候选都落不了库。这里钉住宽容抽取的边界。
 */
import { parseOrganizeResult, extractFirstJsonObject } from '../lib/world-setting.js'

let pass = 0
const failures = []
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failures.push(name); console.log('FAIL ' + name + '  [' + detail + ']') }
}

const payload = JSON.stringify({ schemaVersion: 1, settings: [{ title: '钟声', conclusion: '钟声是伏笔', mark: 'open' }], notes: '' })

// ── 抽取器本身 ────────────────────────────────────────────────────────
{
  ok('抽取：纯 JSON', extractFirstJsonObject('{"a":1}') === '{"a":1}')
  ok('抽取：夹在散文里', extractFirstJsonObject('好的，结果如下：\n{"a":1}\n希望有帮助') === '{"a":1}')
  ok('抽取：字符串里的花括号不干扰', extractFirstJsonObject('{"a":"} { 不是结构"}') === '{"a":"} { 不是结构"}')
  ok('抽取：转义引号不干扰', extractFirstJsonObject('{"a":"他说\\"}\\"了"}') === '{"a":"他说\\"}\\"了"}')
  ok('抽取：嵌套对象', extractFirstJsonObject('前言 {"a":{"b":2}} 后记') === '{"a":{"b":2}}')
  ok('抽取：没有对象 → null', extractFirstJsonObject('只有散文，没有结构') === null)
  ok('抽取：只有左括号未闭合 → null', extractFirstJsonObject('{"a":1') === null)
}

// ── 解析结果 ──────────────────────────────────────────────────────────
{
  const a = parseOrganizeResult(payload)
  ok('整段 JSON：解析成功', a.ok === true && a.settings.length === 1 && a.settings[0].title === '钟声', JSON.stringify(a).slice(0, 90))

  const b = parseOrganizeResult('```json\n' + payload + '\n```')
  ok('围栏 JSON：解析成功', b.ok === true && b.settings.length === 1)

  const c = parseOrganizeResult('我整理了一下：\n\n' + payload + '\n\n需要我再补充吗？')
  ok('散文 + JSON（无围栏）：解析成功 ← 本次修复', c.ok === true && c.settings.length === 1 && c.settings[0].title === '钟声', JSON.stringify(c).slice(0, 90))

  const d = parseOrganizeResult(payload + '\n以上。')
  ok('JSON + 尾随散文：解析成功', d.ok === true && d.settings.length === 1)

  const e = parseOrganizeResult('这次没有可整理的设定，都是闲聊。')
  ok('纯散文：如实判失败', e.ok === false && e.error === 'organize-parse-failed', JSON.stringify(e))

  const f = parseOrganizeResult(JSON.stringify({ schemaVersion: 2, settings: [] }))
  ok('schemaVersion 2：明确拒绝', f.ok === false && f.error === 'organize-schema-unsupported', JSON.stringify(f))

  const g = parseOrganizeResult(JSON.stringify({ schemaVersion: 1, notes: '没有结构' }))
  ok('缺 settings/items：shape-invalid', g.ok === false && g.error === 'organize-shape-invalid', JSON.stringify(g))

  const h = parseOrganizeResult(JSON.stringify({ schemaVersion: 1, settings: [{ title: '', conclusion: '' }] }))
  ok('条目缺 title/conclusion：被拒但整体不崩', h.ok === true && h.settings.length === 0 && (h.rejected || []).length === 1, JSON.stringify(h).slice(0, 110))

  const i = parseOrganizeResult(JSON.stringify({ schemaVersion: 1, settings: [{ title: '甲', conclusion: '乙', confirmed: true, targetPath: '/etc/passwd' }] }))
  ok('模型不能自带 confirmed/targetPath 作为权威', i.ok === true && i.settings[0].status !== 'confirmed' && !('targetPath' in i.settings[0]), JSON.stringify(i.settings[0]).slice(0, 120))
}

console.log(`\n${failures.length ? 'ORGANIZE_PARSE_FAIL' : 'ORGANIZE_PARSE_OK'} ${pass} passed, ${failures.length} failed`)
if (failures.length) console.log('失败项：' + failures.join(' | '))
process.exit(failures.length ? 1 : 0)
