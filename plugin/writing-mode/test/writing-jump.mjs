/**
 * 伙伴↔文档链接回归：[[文稿名]] 跳回的纯函数层 + world 设定「正文提及」判定。
 * 跳转安全边界（与 jump.js 注释一致）：点击制、库内解析、编造名解析不到。
 */
import assert from 'node:assert/strict'

const jump = await import('../src/client/features/companion/jump.js')
const world = await import('../lib/world-setting.js')

let passed = 0
const ok = (cond, label, extra) => {
  assert.ok(cond, label + (extra === undefined ? '' : ' ' + JSON.stringify(extra)))
  passed++
  console.log('PASS', label)
}

const FILES = [
  { name: '第1章-v1.md', rel: 'draft/novel/第1章-v1.md', abs: 'X:\\作品\\draft\\novel\\第1章-v1.md' },
  { name: '第1章-v2.md', rel: 'draft/novel/第1章-v2.md', abs: 'X:\\作品\\draft\\novel\\第1章-v2.md' },
  { name: '第2章.md', rel: 'draft/novel/第2章.md', abs: 'X:\\作品\\draft\\novel\\第2章.md' },
  { name: '世界观整理.md', rel: 'bible/世界观整理.md', abs: 'X:\\作品\\bible\\世界观整理.md' },
]

/* ── rewriteJumpLinks / parseJumpHref ───────────────────── */

const rewritten = jump.rewriteJumpLinks('见 [[第1章-v2.md]] 与 [[世界观整理]]，不要用[单括号]。')
ok(rewritten.includes('[第1章-v2.md](dsh-wm-jump:%E7%AC%AC1%E7%AB%A0-v2.md)'), '[[名]] → 协议链接且 encodeURIComponent')
ok(!rewritten.includes('[[世界观整理]]') && rewritten.includes('[世界观整理](dsh-wm-jump:'), '中文未编码字符也被重写')
ok(jump.rewriteJumpLinks('普通文本保持原样') === '普通文本保持原样', '无 [[名]] 原样返回')
ok(jump.rewriteJumpLinks(null) === '', 'null 输入返回空串')

ok(jump.parseJumpHref('dsh-wm-jump:%E7%AC%AC1%E7%AB%A0-v2.md') === '第1章-v2.md', 'parseJumpHref 解码')
ok(jump.parseJumpHref('https://example.com') === null, '非协议 href 返回 null')
ok(jump.parseJumpHref('dsh-wm-jump:%E4%B8%AD') === '中', '解码中文')
ok(jump.parseJumpHref('dsh-wm-jump:%') === null, '坏编码不抛错返回 null')

/* ── resolveFileByName ──────────────────────────────────── */

ok(jump.resolveFileByName(FILES, '第1章-v2.md')?.name === '第1章-v2.md', '文件名全等命中（含版本）')
ok(jump.resolveFileByName(FILES, '第1章.md')?.name === '第1章-v2.md', '抹掉 -vN 的题名命中且多版本取最新')
ok(jump.resolveFileByName(FILES, '第1章')?.name === '第1章-v2.md', '无扩展名前缀命中且取最新')
ok(jump.resolveFileByName(FILES, '世界观整理.md')?.name === '世界观整理.md', '跨目录命中 bible 稿')
ok(jump.resolveFileByName(FILES, '第9章.md') === null, '编造的文件名解析不到返回 null')
ok(jump.resolveFileByName(FILES, '') === null, '空名返回 null')
ok(jump.resolveFileByName([], '第1章.md') === null, '空清单返回 null')
ok(jump.resolveFileByName(FILES, '第1章-V2.MD')?.name === '第1章-v2.md', '大小写不敏感')

/* ── worldSettingMentioned（与 rank 同口径）──────────────── */

const item = (setting, status = 'confirmed') => ({ id: 'w1', kind: 'fact', status, setting: { type: 'world', ...setting } })
ok(world.worldSettingMentioned(item({ title: '夜行禁令', tags: ['律法'] }), '林晚为什么违反夜行禁令？'), '标题命中')
ok(world.worldSettingMentioned(item({ title: '夜行禁令', tags: ['律法'] }), '这条律法怎么用？'), '标签命中')
ok(!world.worldSettingMentioned(item({ title: '夜行禁令' }), '今晚没有月亮'), '未提及返回 false')
ok(!world.worldSettingMentioned(item({ title: '夜行禁令' }, 'candidate'), '夜行禁令'), '候选态不算提及')
ok(!world.worldSettingMentioned(null, '夜行禁令'), '坏条目返回 false')

console.log(`WRITING_JUMP_OK ${passed} passed, 0 failed`)
