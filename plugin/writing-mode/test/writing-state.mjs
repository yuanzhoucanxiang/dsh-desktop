/**
 * 实时文本体检 + 写作模式状态块的纯函数测试（2026-10-10）。
 * 隔离：不碰真实稿件、不起 HTTP、不读 ~/.dsh。
 */
import { textHealth, textHealthBrief, splitSentences, writingStateBlock } from '../lib/writing-state.js'

let pass = 0
const failures = []
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failures.push(name); console.log('FAIL ' + name + '  [' + detail + ']') }
}

// ── 切句与偏移 ────────────────────────────────────────────────────────
{
  const src = '第一句。第二句！第三句？'
  const s = splitSentences(src)
  ok('切句：三段', s.length === 3, JSON.stringify(s.map((x) => x.text)))
  ok('切句：偏移指回原文', s[1].at === 4 && src.slice(s[1].at, s[1].at + 3) === '第二句', String(s[1].at))
}

// ── 干净文本不误报 ────────────────────────────────────────────────────
{
  const clean = '雪停了。他站在门口，没有动。远处传来一声闷响，像是冰面裂开。'
  const h = textHealth(clean)
  ok('干净文本：0 问题', h.issues.length === 0, JSON.stringify(h.issues.map((i) => i.kind)))
  ok('干净文本：brief 是"通过"', /体检 ✓/.test(textHealthBrief(h)), h.brief)
  ok('干净文本：score=100', h.score === 100, String(h.score))
  ok('指标：字数/句数/段数', h.metrics.chars === clean.length && h.metrics.sentences === 3 && h.metrics.paragraphs === 1, JSON.stringify(h.metrics))
}

// ── 长句 ──────────────────────────────────────────────────────────────
{
  const long = '他想起那年冬天在车站等车的时候天还没有亮路灯照着雪地上的一串脚印一直延伸到看不见的地方而他就那样站着等着风把帽子吹歪了也没有伸手去扶一句话也没有说。'
  const h = textHealth(long)
  const kinds = h.issues.map((i) => i.kind)
  ok('长句：报出来', kinds.includes('sentence-long') || kinds.includes('sentence-too-long'), JSON.stringify(kinds))
  const it = h.issues.find((i) => i.kind.startsWith('sentence-')) || {}
  ok('长句：位置在正文范围内', Number.isInteger(it.at) && it.at >= 0 && it.at < long.length, String(it.at))
  ok('长句：hint 带字数', /\d+ 字一句/.test(String(it.hint)), String(it.hint))
}

// ── 副词密度 ──────────────────────────────────────────────────────────
{
  const adv = '他非常生气。她十分难过。天很黑，路特别滑，风极其冷，夜格外静，声音相当远，事情确实难，心里简直乱。'
  const h = textHealth(adv)
  ok('副词密度：报出来', h.issues.some((i) => i.kind === 'adverb-heavy'), JSON.stringify(h.issues.map((i) => i.kind)))
  ok('副词指标：计数 > 0', h.metrics.adverbs >= 8, String(h.metrics.adverbs))
}

// ── 「的」堆叠 ────────────────────────────────────────────────────────
{
  const de = '这是他的那本旧书的封面的颜色的问题的所在。'
  const h = textHealth(de)
  const it = h.issues.find((i) => i.kind === 'de-stack')
  ok('「的」堆叠：报出来', Boolean(it), JSON.stringify(h.issues.map((i) => i.kind)))
  ok('「的」堆叠：计数正确', it && it.count >= 5, String(it && it.count))
}

// ── 句内重复词 ────────────────────────────────────────────────────────
{
  const rep = '灯光灯光灯光下，他看清了那张脸。'
  const h = textHealth(rep)
  ok('重复词：报出来', h.issues.some((i) => i.kind === 'word-repeat'), JSON.stringify(h.issues.map((i) => i.kind)))
}

// ── 引号不成对 ────────────────────────────────────────────────────────
{
  const q = '「你来了。\n他说完就转身走了。'
  const h = textHealth(q)
  ok('引号不成对：报出来', h.issues.some((i) => i.kind === 'quote-unbalanced'), JSON.stringify(h.issues.map((i) => i.kind)))
}

// ── 段落过长 / 标点连打 / 空行 ────────────────────────────────────────
{
  const para = '字'.repeat(320)
  ok('段落过长：报出来', textHealth(para).issues.some((i) => i.kind === 'paragraph-long'))
  ok('标点连打：报出来', textHealth('他走了。。。').issues.some((i) => i.kind === 'punctuation-run'))
  ok('空行过多：报出来', textHealth('甲\n\n\n\n乙').issues.some((i) => i.kind === 'blank-run'))
}

// ── 阈值可调 ──────────────────────────────────────────────────────────
{
  const text = '这是一句刚好二十个字左右的普通句子用来测试阈值。'
  const loose = textHealth(text, { maxSentence: 200 })
  const tight = textHealth(text, { maxSentence: 5 })
  ok('阈值可调：宽松不报', !loose.issues.some((i) => i.kind.startsWith('sentence-')), JSON.stringify(loose.issues.map((i) => i.kind)))
  ok('阈值可调：收紧就报', tight.issues.some((i) => i.kind.startsWith('sentence-')), JSON.stringify(tight.issues.map((i) => i.kind)))
}

// ── 状态块：只写事实，缺项不编 ────────────────────────────────────────
{
  ok('状态块：什么都没有 → 空串', writingStateBlock({}) === '', JSON.stringify(writingStateBlock({})))
  const block = writingStateBlock({
    projectLabel: '归乡记',
    fileLabel: '正文/第一章 归乡.md',
    cursorChars: 340,
    selectionChars: 0,
    dirty: true,
    focus: false,
    todayChars: 320,
    dailyGoal: 1000,
    gate: { kind: 'novel', pass: false, fail: 2 },
    health: textHealth('他非常生气。她十分难过。天很黑，路特别滑，风极其冷，夜格外静，声音相当远，事情确实难，心里简直乱。'),
    paragraph: '雪停了。他站在门口。',
  })
  ok('状态块：带标题与"作者看不到"声明', /【写作模式状态】/.test(block) && /作者看不到/.test(block), block.split('\n')[0])
  ok('状态块：作品/文件/光标/未保存', /作品：归乡记/.test(block) && /正在写：正文\/第一章 归乡\.md/.test(block) && /光标：第 340 字处/.test(block) && /未保存改动：有/.test(block))
  ok('状态块：今日净增带目标', /今日净增：\+320 字 \/ 目标 1000/.test(block))
  ok('状态块：成稿检查未通过', /成稿检查（novel）：2 项未达标/.test(block))
  ok('状态块：带实时体检摘要与最多 3 条', /实时体检：/.test(block) && (block.match(/^ {2}· /gm) || []).length <= 3)
  ok('状态块：带当前段落', /当前段落：雪停了/.test(block))
  ok('状态块：结尾有"不要臆造"约束', /不要臆造/.test(block))
  ok('状态块：没选区就不提选区', !/选区/.test(block))
  const partial = writingStateBlock({ project: 'X', dirty: false })
  ok('状态块：缺项不编（只有作品与未保存）', /作品：X/.test(partial) && /未保存改动：无/.test(partial) && !/光标|今日|体检/.test(partial), JSON.stringify(partial.split('\n').slice(1, -1)))
}

// ── 注入到准备回合：只进 body（模型看到），不进 message（面板显示）─────
{
  const { buildPreparedTurn } = await import('../src/shared/context-builder.js')
  const block = writingStateBlock({ projectLabel: '归乡记', fileLabel: '正文/第一章.md', dirty: false })
  const turn = buildPreparedTurn({ message: '这段节奏对吗？', stateBlock: block, memoryItems: [], includeMemory: false, projectKey: '/x' })
  ok('注入：body 带状态块', turn.body.includes('【写作模式状态】') && turn.body.includes('作品：归乡记'), turn.body.slice(0, 40))
  ok('注入：作者消息仍在 body 里', turn.body.includes('这段节奏对吗？'))
  ok('注入：message 字段不含状态块（面板只显示作者那句话）', turn.message === '这段节奏对吗？' && !turn.message.includes('写作模式状态'), turn.message)
  ok('注入：状态块排在作者消息之前', turn.body.indexOf('【写作模式状态】') < turn.body.indexOf('这段节奏对吗？'))
  ok('注入：stateBlock 随回合回传（便于诊断）', turn.stateBlock === block)
  const none = buildPreparedTurn({ message: 'hi', memoryItems: [], includeMemory: false })
  ok('注入：没有状态块时不加这一段', !none.body.includes('【写作模式状态】'), none.body)
}

console.log(`\n${failures.length ? 'WRITING_STATE_FAIL' : 'WRITING_STATE_OK'} ${pass} passed, ${failures.length} failed`)
if (failures.length) console.log('失败项：' + failures.join(' | '))
process.exit(failures.length ? 1 : 0)
