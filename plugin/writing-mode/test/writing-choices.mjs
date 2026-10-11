/**
 * 「【选择】」块解析回归（2026-10-11）。
 *
 * 这条通道的判据是**宁可漏、不可错**：解析不出来就当普通文字。所以断言分两类——
 * 认得出的（marker + ≥2 条选项、块在末尾、正文被摘掉）与必须认不出的（没有 marker、
 * 只有一条、正文里本来就有的普通列表、marker 后面跟的不是选项）。
 */
import assert from 'node:assert/strict'

const c = await import('../src/client/features/companion/choices.js')

let passed = 0
const ok = (cond, label, extra) => {
  assert.ok(cond, label + (extra === undefined ? '' : ' ' + JSON.stringify(extra)))
  passed++
  console.log('PASS', label)
}

const REPLY = [
  '这段我读着有两个方向。',
  '',
  '一个是把镜头压低，让处刑台像墙一样压过来；',
  '另一个是拉远，让人小得像账面上的一行。',
  '',
  '【选择】',
  '- 压低镜头，写压迫',
  '- 拉远，写渺小',
  '- 两个都试，各写一段',
].join('\n')

/* ── 认得出的 ───────────────────────────────────────────── */

const parsed = c.parseChoiceBlock(REPLY)
ok(parsed !== null, 'marker + 三条选项：认得出')
ok(parsed.options.length === 3, '三条选项都在')
ok(parsed.options[0] === '压低镜头，写压迫', '选项文案原样保留')
ok(!parsed.body.includes(c.CHOICE_MARKER), '正文里不再含 marker（不重复显示）')
ok(!parsed.body.includes('压低镜头，写压迫'), '正文里不再含选项行')
ok(parsed.body.endsWith('让人小得像账面上的一行。'), '正文保留到块之前')

ok(c.parseChoiceBlock('【选择】\n- 甲\n- 乙').options.length === 2, '两条选项也成立（最少两条）')
ok(c.parseChoiceBlock('【选择】\n\n- 甲\n\n- 乙').options.length === 2, 'marker 与选项之间的空行跳过')
ok(c.parseChoiceBlock('【选择】\n* 甲\n* 乙').options.length === 2, '「* 」写法也认')

const capped = c.parseChoiceBlock('【选择】\n- 1\n- 2\n- 3\n- 4\n- 5\n- 6\n- 7')
ok(capped.options.length === c.CHOICE_MAX, '超过上限截断到 CHOICE_MAX')

const mid = c.parseChoiceBlock('【选择】\n- 旧\n- 旧二\n\n后面又说了别的\n\n【选择】\n- 新\n- 新二')
ok(mid.options[0] === '新', '取**最后一个** marker（选项块按约定在末尾）')

/* ── 必须认不出的 ───────────────────────────────────────── */

ok(c.parseChoiceBlock('就是一段普通回复，没有任何标记') === null, '没有 marker：null')
ok(c.parseChoiceBlock('') === null, '空文本：null')
ok(c.parseChoiceBlock(null) === null, 'null 输入：null')
ok(c.parseChoiceBlock('我列一下要点：\n- 第一点\n- 第二点\n- 第三点') === null, '正文里本来就有的普通列表：不误判')
ok(c.parseChoiceBlock('【选择】\n- 只有一个') === null, '只有一条选项：不画（一条不构成选择）')
ok(c.parseChoiceBlock('【选择】\n这条没以短横开头\n- 甲\n- 乙') === null, 'marker 后紧跟非选项行：不认')
ok(c.parseChoiceBlock('【选择】 后面还有字\n- 甲\n- 乙') === null, 'marker 行不独占：不认（避免误伤正文）')

const trailing = c.parseChoiceBlock('【选择】\n- 甲\n- 乙\n\n这里又接了一段解释')
ok(trailing !== null && trailing.options.length === 2, '选项块后面接别的段落：选项照收')
ok(trailing.body === '', '正文取到 marker 为止（前面的内容为空）')

/* ── 点选后发出去的话 ───────────────────────────────────── */

ok(c.choiceMessage('  压低镜头，写压迫  ') === '压低镜头，写压迫', '标签去掉首尾空白')
ok(c.choiceMessage(null) === '', 'null 标签给空串（调用方据此不发）')

console.log(`WRITING_CHOICES_OK ${passed}/${passed}`)
