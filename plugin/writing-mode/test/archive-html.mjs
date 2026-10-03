/**
 * 作品档案导出（lib/archive-html.js）的纯函数验收。
 *
 * 为什么单独一套：导出页是**作者之外的人也会看到的东西**（分享、打印），转义与标记白名单
 * 是它的安全边界；Electron 门禁只能验最终产物，规则本身要在 node 里逐条钉住。
 * 另含一条防漂移断言：资料标签不得与客户端文档库那张表各说各话。
 *
 * 用法：node plugin/writing-mode/test/archive-html.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import {
  escapeHtml,
  inlineMarks,
  renderMarkdown,
  renderArchiveHtml,
  docGroupOf,
  docGroupRank,
  docLabelOf,
  premiseOf,
  buildRefResolver,
  ARCHIVE_HTML_VERSION,
} from '../lib/archive-html.js'
import { PROJECT_RESOURCES } from '../lib/templates.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const NUL = String.fromCharCode(0)
let pass = 0
const ok = (name, fn) => {
  try {
    fn()
    pass++
    console.log('PASS', name)
  } catch (err) {
    console.error('FAIL', name, '\n  ', err.message)
    process.exitCode = 1
  }
}

ok('A01 转义覆盖 & < > " 与单引号，并剔除 NUL（占位符不能被作者文字伪造）', () => {
  assert.equal(escapeHtml('<a href="x">&\u0027</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
  assert.equal(escapeHtml('a' + NUL + 'b'), 'ab')
})

ok('A02 行内码里的 ** 不会被当成粗体（先摘出再放回）', () => {
  const html = inlineMarks(escapeHtml('用 `a**b` 记号'))
  assert.ok(html.includes('<code>a**b</code>'), html)
  assert.ok(!html.includes('<strong>'), '代码片段内部不得再放标记：' + html)
})

ok('A03 链接只放行 http(s)：javascript: 与 data: 退化为纯文字', () => {
  const js = inlineMarks(escapeHtml('[点我](javascript:alert(1))'))
  assert.ok(!js.includes('<a'), js)
  assert.ok(js.includes('点我') && !js.includes('javascript:'), '文字保留、协议丢弃：' + js)
  const data = inlineMarks(escapeHtml('[x](data:text/html;base64,PHNjcmlwdD4=)'))
  assert.ok(!data.includes('<a'), data)
  const http = inlineMarks(escapeHtml('[看](https://example.org/a?b=1)'))
  assert.ok(http.includes('href="https://example.org/a?b=1"'), http)
  assert.ok(http.includes('rel="noopener noreferrer"') && http.includes('target="_blank"'), http)
})

ok('A04 [[文稿名]] 只渲染成标注，不生成可导航的东西', () => {
  const html = inlineMarks(escapeHtml('见 [[第3章-夜行]]'))
  assert.ok(html.includes('<span class="ref">第3章-夜行</span>'), html)
  assert.ok(!html.includes('<a') && !html.includes('href'), html)
})

ok('A05 块级：文稿标题从 h3 起（页面自己占 h1/h2），分隔线与引用照收', () => {
  const html = renderMarkdown('# 人物\n\n#### 林晚\n\n---\n\n> 送信人\n')
  assert.ok(html.includes('<h3>人物</h3>'), html)
  assert.ok(html.includes('<h6>林晚</h6>'), html)
  assert.ok(html.includes('<hr>'), html)
  assert.ok(html.includes('<blockquote>送信人</blockquote>'), html)
})

ok('A06 表格：表头 + 分隔行识别，正文单元格进 td', () => {
  const html = renderMarkdown('| 人物 | 立场 |\n| --- | --- |\n| 林晚 | 送信 |\n')
  assert.ok(html.includes('<th>人物</th>') && html.includes('<td>林晚</td>'), html)
  assert.ok(html.includes('tablewrap'), '表格外层要能横向滚动，不撑破版面')
  assert.ok(!html.includes('| --- |'), '分隔行不该漏进正文')
})

ok('A07 列表与段落：连续项成一组，段内换行变 br，认不出的语法当文字', () => {
  const html = renderMarkdown('- 一\n- 二\n\n1. 甲\n2. 乙\n\n普通\n两行\n')
  assert.ok(html.includes('<ul><li>一</li><li>二</li></ul>'), html)
  assert.ok(html.includes('<ol><li>甲</li><li>乙</li></ol>'), html)
  assert.ok(html.includes('<p>普通<br>两行</p>'), html)
  const odd = renderMarkdown('=== 不是标题\n\n<div>标签\n')
  assert.ok(odd.includes('<p>=== 不是标题</p>') && odd.includes('&lt;div&gt;'), '认不出就原样可读：' + odd)
})

ok('A08 资料分组与标签：与客户端文档库同一套名字，不出现第三张表', () => {
  assert.equal(docGroupOf('project.md'), '作品概览')
  assert.equal(docGroupOf('bible/characters.md'), '人物')
  assert.equal(docGroupOf('bible/world.md'), '世界与设定')
  assert.equal(docGroupOf('outline/foreshadow.md'), '故事规划')
  assert.equal(docGroupOf('state/character-state.md'), '创作跟踪')
  assert.equal(docGroupOf('reviews/评审-v1.md'), '评审')
  assert.equal(docGroupOf('notes/x.md'), '其他文档')
  assert.ok(docGroupRank('作品概览') < docGroupRank('资料') , '分组顺序稳定')
  assert.equal(docLabelOf('bible/characters.md', 'characters.md'), '人物档案')
  assert.equal(docLabelOf('bible/世界观整理.md', 'x'), '已确认设定（整理稿）')
  assert.equal(docLabelOf('notes/odd.md', 'odd.md'), 'odd.md', '契约外的文件退回文件名')
  // 防漂移：host 白名单里的标签必须与客户端 NAV_FILES 对同一个 rel 给同一个名字
  const client = fs.readFileSync(path.join(HERE, '../src/client/features/library/grouping.js'), 'utf8')
  const pairs = [...client.matchAll(/['"]([\w/\u4e00-\u9fa5.]+\.md)['"]\s*:\s*\[\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g)]
  assert.ok(pairs.length >= 8, '客户端标签表解析失败（改了写法就要同步改这条断言）')
  for (const [, rel, , label] of pairs) {
    const host = PROJECT_RESOURCES.find((item) => item[0] === rel)
    if (host) assert.equal(host[1], label, `资料标签漂移：${rel}`)
  }
})

ok('A09 一句话前提：优先取「一句话故事」小节，退回首段正文', () => {
  assert.equal(premiseOf('# 雾港\n\n## 一句话故事\n\n送信人发现禁令是为掩盖沉船。\n'), '送信人发现禁令是为掩盖沉船。')
  assert.equal(premiseOf('# 雾港\n\n直接一段前提。\n\n再来一段'), '直接一段前提。')
  assert.equal(premiseOf('# 只有标题\n'), '')
  assert.equal(premiseOf(''), '')
})

ok('A09b 空模板不冒充前提（真实作品上抓到「核心冲突：」被当成一句话）', () => {
  assert.equal(premiseOf('# 作品\n\n## 一句话故事\n\n核心冲突：\n\n## 想写的东西\n\n'), '', '光有标签没内容时宁可不显示')
  assert.equal(premiseOf('# 作品\n\n核心冲突：\n\n主角要在天亮前决定要不要拆开那封信。\n'),
    '主角要在天亮前决定要不要拆开那封信。', '跳过悬空标签，取下一段实文')
  assert.equal(premiseOf('# 作品\n\n## 一句话故事\n\n一句话：写不出\n'), '一句话：写不出')
})

const model = {
  title: '雾港',
  premise: '一封信决定所有人的去向。',
  generatedAt: '2026-10-02 20:00:00',
  settings: [{
    title: '夜行禁令', conclusion: '雾季入夜后港口停止民船出航。', explanation: '能见度差。',
    boundaries: '救援船可出航。', tags: ['港口'], fromKind: 'assistant',
    sources: [{ role: 'author', excerpt: '我们让禁令只在雾季生效' }],
  }],
  proposedCount: 2,
  plainItems: [{ kind: 'preference', text: '叙述贴着林晚。' }],
  chapters: [{ name: '第1章', chars: 1200, hook: '灯塔灭了', gate: { pass: false, fail: 2 } }],
  stats: { today: 800, streak: 3, corrupt: false },
  dailyGoal: 500,
  ledger: { timeline: ['雾季第一夜：禁令生效'], foreshadowOpen: 2, latestReview: '评审-v1.md', hook: '灯塔灭了' },
  docs: [{ rel: 'bible/characters.md', label: '人物档案', group: '人物', content: '# 人物\n\n**林晚**：送信人。', markdown: true },
    { rel: 'notes/odd.txt', label: 'odd.txt', group: '其他文档', content: '纯 <b>文本</b>', markdown: false }],
}

ok('A10 渲染整页：已确认设定、边界、出处、候选计数、进度与资料都在位', () => {
  const html = renderArchiveHtml(model)
  assert.ok(html.startsWith('<!doctype html>') && html.includes('<html lang="zh-CN"'), '自包含整页')
  assert.ok(html.includes('<title>雾港 · 作品档案</title>'), html.slice(0, 200))
  assert.ok(html.includes('generator" content="dsh-writing-mode archive ' + ARCHIVE_HTML_VERSION))
  assert.ok(html.includes('夜行禁令') && html.includes('救援船可出航'), '边界必须与结论同现')
  assert.ok(html.includes('我们让禁令只在雾季生效'), '出处可核对')
  assert.ok(html.includes('来自讨论'), '来源标注')
  assert.ok(html.includes('另有 2 条候选未确认'), '候选只计数不入档')
  assert.ok(html.includes('叙述贴着林晚'), '普通已确认备忘入列')
  assert.ok(html.includes('<b>800</b>') && html.includes('日目标 <b>500</b>') && html.includes('门禁 2'), '进度与门禁')
  assert.ok(html.includes('<strong>林晚</strong>'), '资料按 Markdown 渲染')
  assert.ok(html.includes('&lt;b&gt;文本&lt;/b&gt;'), '非 Markdown 资料按转义文本处理')
  assert.ok(html.includes('只读投影'), '页面自己说清定位')
})

ok('A11 空作品也出得来：没有设定/章节/资料时给的是说明，不是空白页', () => {
  const html = renderArchiveHtml({ title: '新作', settings: [], plainItems: [], chapters: [], docs: [], stats: null, ledger: null })
  assert.ok(html.includes('还没有已确认的设定'), html.slice(0, 400))
  assert.ok(html.includes('draft/ 下还没有正文'))
  assert.ok(html.includes('这个项目还没有设定集'))
  assert.ok(html.includes('bible/timeline.md 还没有条目'))
  assert.ok(!html.includes('undefined') && !html.includes('NaN'), '空值不该漏进页面文字')
})

ok('A12 稿件里的脚本在导出页只以文字出现，且样式随页走（不引外部资源）', () => {
  const html = renderArchiveHtml({
    title: 'T', docs: [{ rel: 'bible/world.md', label: 'W', group: '世界与设定', markdown: true,
      content: '<script>window.__pwned=1</script>\n\n<img src=x onerror="x">\n\n[坏](javascript:1)' }],
  })
  assert.ok(!/<script\s*>/i.test(html.replace(/<script><\/script>/g, '')), '不该有真 script 标签')
  assert.ok(!/<img\s/i.test(html), '不该有真 img 标签')
  assert.ok(html.includes('&lt;script&gt;'), '脚本以字面文字保留')
  assert.ok(!/src\s*=\s*["']https?:/i.test(html) && !/<link\b/i.test(html), '自包含：不引外部样式或脚本')
})

/* ---- 第三刀：目录与页内跳转 ---- */

const navModel = {
  title: '雾港',
  settings: [{ title: '夜行禁令', conclusion: '入夜封港。' }, { title: '铜钥', conclusion: '开电报室。' }],
  plainItems: [],
  chapters: [{ name: '第1章-夜行', chars: 10 }, { name: '第2章-v2', chars: 20 }],
  docs: [{ rel: 'bible/characters.md', label: '人物档案', group: '人物', markdown: true,
    content: '详见 [[characters.md]] 与 [[第1章-夜行]]，还有 [[不存在的东西]]。\n' },
    { rel: 'outline/foreshadow.md', label: '伏笔与回收', group: '故事规划', markdown: true, content: '见 [[foreshadow]]。' }],
  stats: { today: 0, streak: 0 },
  ledger: { timeline: [], foreshadowOpen: 0 },
}

ok('B01 目录里每个链接都指到页内真实锚点，每个条目锚点也都进了目录', () => {
  const html = renderArchiveHtml(navModel)
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1])
  const hrefs = [...html.matchAll(/<a[^>]*href="(#[^"]+)"/g)].map((m) => m[1].slice(1))
  assert.ok(ids.length > 0 && hrefs.length > 0, '页面应有锚点与目录链接')
  for (const target of hrefs) assert.ok(ids.includes(target), '目录指向不存在的锚点：#' + target)
  for (const id of ids) {
    if (id.startsWith('set-') || id.startsWith('ch-') || id.startsWith('doc-')) {
      assert.ok(hrefs.includes(id), '条目锚点没被目录引用：' + id)
    }
  }
  assert.equal(new Set(ids).size, ids.length, '锚点 id 必须唯一')
})

ok('B02 [[名]] 在导出页里解析成页内跳转，解析不到就退回不可导航的标注', () => {
  const html = renderArchiveHtml(navModel)
  assert.ok(/<a class="ref" href="#doc-1">characters\.md<\/a>/.test(html), '精确文件名 → 资料锚点')
  assert.ok(/<a class="ref" href="#ch-1">第1章-夜行<\/a>/.test(html), '章节也能跳')
  assert.ok(/<a class="ref" href="#doc-2">foreshadow<\/a>/.test(html), '无扩展名走前缀匹配')
  assert.ok(/<span class="ref">不存在的东西<\/span>/.test(html), '解析不到不得生成链接')
})

ok('B03 解析规则：大小写不敏感、抹 -vN 取最新、作者文字进不了 href', () => {
  const refs = buildRefResolver(navModel)
  assert.equal(refs('CHARACTERS.MD'), '#doc-1')
  assert.equal(refs('第2章'), '#ch-2', '没带版本号的题名应能命中 -v2')
  assert.equal(refs('第2章-v2'), '#ch-2')
  assert.equal(refs(''), '')
  assert.equal(refs('javascript:alert(1)'), '')
  assert.equal(refs('../../etc/passwd'), '')
  const hostile = renderArchiveHtml({ title: 'T', docs: [{ rel: 'bible/a.md', label: 'a', group: '世界与设定', markdown: true,
    content: '[[a.md" onmouseover="x]]' }], settings: [], plainItems: [], chapters: [], ledger: null, stats: null })
  // 作者写的引号只能以 &quot; 出现在文字里；任何开始标签里都不该出现 onmouseover 属性
  assert.ok(hostile.includes('a.md&quot; onmouseover=&quot;x'), '恶意文字应原样转义保留')
  assert.ok(!/<[a-z][^>]*\sonmouseover\s*=/i.test(hostile), '标注文字不得逃进属性：' + hostile)
  assert.ok(!/<a[^>]*href="[^"]*"/.test(hostile.match(/<span class="ref">[^<]*onmouseover[^<]*/)?.[0] || ''), '不应为它生成链接')
})

ok('B04 打印时藏目录（纸上没有可点的链接）', () => {
  const html = renderArchiveHtml(navModel)
  assert.ok(/@media print\{[^}]*\.toc[^}]*display:none/.test(html), '主目录应有打印隐藏规则')
  assert.ok(/@media print\{[^}]*\.docToc/.test(html), '篇内小目录同样该在纸上藏掉')
  assert.ok(html.includes('class="toc"'), '目录本体在页上')
})

/* ---- 第四刀：每篇资料的篇内小目录 ---- */

const longDocs = [
  { rel: 'bible/world.md', label: '世界观', group: '世界与设定', markdown: true,
    content: '# 世界\n\n## 港口\n\n雾季封港。\n\n### 细则\n\n救援船例外。\n\n## 势力\n\n港务所。\n' },
  { rel: 'bible/timeline.md', label: '时间线', group: '世界与设定', markdown: true, content: '# 时间线\n\n只有一级标题。\n' },
  { rel: 'notes/odd.txt', label: '杂记', group: '其他文档', markdown: false, content: '纯文本没有标题\n' },
]
const longModel = { title: '长', settings: [], plainItems: [], chapters: [], stats: null, ledger: null, docs: longDocs }

ok('C01 标题 ≥2 的篇给篇内小目录，链接指向该篇自己的标题锚点', () => {
  const html = renderArchiveHtml(longModel)
  const toc = /<nav class="docToc"[\s\S]*?<\/nav>/.exec(html)
  assert.ok(toc, '应出现篇内小目录')
  const hrefs = [...toc[0].matchAll(/href="#(doc-\d+-h-\d+)"/g)].map((m) => m[1])
  assert.deepEqual(hrefs, ['doc-1-h-1', 'doc-1-h-2', 'doc-1-h-3', 'doc-1-h-4'], '顺序 = 标题出现顺序（含顶级 #），且带篇号前缀：' + hrefs)
  const ids = [...html.matchAll(/id="(doc-1-h-\d+)"/g)].map((m) => m[1])
  assert.deepEqual(ids, hrefs, '小目录每条都要有对应锚点')
  assert.ok(html.includes('<h4 id="doc-1-h-2">港口</h4>'), '标题按层级出锚点')
  assert.ok(html.includes('lv4') && html.includes('lv5'), '深浅标题在目录里分级显示')
})

ok('C02 只有一个标题 / 纯文本的篇不给小目录（不给噪音）', () => {
  const html = renderArchiveHtml(longModel)
  const tocs = [...html.matchAll(/<nav class="docToc"/g)].length
  assert.equal(tocs, 1, '三篇里只有一篇该有小目录')
  // 标题仍带锚点（无害，且将来可做深链），但不为它单列一条目录
  assert.ok(html.includes('<h3 id="doc-2-h-1">时间线</h3>') && !html.includes('doc-2-h-2'), '单标题篇不建小目录')
})

ok('C03 锚点序号按篇独立，作者标题文字进不了 id', () => {
  const hostile = { title: 'H', settings: [], plainItems: [], chapters: [], stats: null, ledger: null,
    docs: [{ rel: 'bible/a.md', label: 'a', group: '世界与设定', markdown: true,
      content: '# a" id="x onclick="y\n\n## 第二段\n' },
      { rel: 'bible/b.md', label: 'b', group: '世界与设定', markdown: true, content: '# b\n\n## 另一段\n' }]}
  const html = renderArchiveHtml(hostile)
  assert.ok(html.includes('id="doc-1-h-1"') && html.includes('id="doc-2-h-1"'), '每篇各自从 h-1 起编号')
  // 查属性只能查标签内部：全文正则会把转义后的正文文字也当成属性命中（假阳性）
  const tags = html.match(/<[^>]+>/g) || []
  assert.ok(!tags.some((t) => /\sid="x"/.test(t)), '作者写的 id 不该逃进属性：' + tags.find((t) => /\sid="x"/.test(t)))
  assert.ok(!tags.some((t) => /\sonclick\s*=/.test(t)), '作者写的事件属性不该逃进标签：' + tags.find((t) => /\sonclick\s*=/.test(t)))
  assert.ok(html.includes('a&quot; id=&quot;x onclick=&quot;y'), '恶意标题以字面文字保留')
})

ok('D01 作品切换器：只有一部作品时不给，多部时当前这部不是链接', () => {
  const single = renderArchiveHtml({ ...longModel, projects: [{ path: 'E:/x/A', name: 'A' }], currentPath: 'E:/x/A' })
  assert.ok(!single.includes('class="switcher"'), '一部作品不该给切换器')
  const many = renderArchiveHtml({ ...longModel,
    projects: [{ path: 'E:/x/A', name: '甲', rootLabel: '剧本' }, { path: 'E:/x/B', name: '乙' }],
    currentPath: 'e:/x/a' })
  const bar = /class="switcher"[\s\S]*?<\/nav>/.exec(many)
  assert.ok(bar, '两部作品应给切换器')
  assert.ok(bar[0].includes('<span class="is-current">甲 · 剧本</span>'), '当前这部只显示、不给链接（点了也是自己）')
  assert.ok(bar[0].includes('<a href="?route=wiki&amp;path=E%3A%2Fx%2FB">乙</a>'), '另一部给同源相对链接：' + bar[0])
})

ok('D02 切换器不需要任何脚本：整页 0 个 script，链接同源相对', () => {
  const html = renderArchiveHtml({ ...longModel,
    projects: [{ path: 'E:/x/A', name: '甲' }, { path: 'E:/x/B', name: '乙' }], currentPath: 'E:/x/A' })
  assert.equal((html.match(/<script[\s>]/gi) || []).length, 0, '整页不该有脚本')
  const bar = /class="switcher"[\s\S]*?<\/nav>/.exec(html)[0]
  assert.ok(!/<form|\sonchange=|\sonsubmit=/.test(bar), '不该依赖表单或事件属性：' + bar)
  assert.ok(!/href="(https?:|file:|dsh-app:)/.test(bar), '切换链接必须同源相对')
  assert.ok(/@media print\{[^}]*\.switcher[^}]*display:none/.test(html), '打印时藏切换器')
})

ok('D03 导出页不带切换器；作品路径与名字里的引号逃不出属性', () => {
  const exported = renderArchiveHtml(longModel)
  assert.ok(!exported.includes('class="switcher"'), '导出是单部作品的快照，不是入口')
  const hostile = renderArchiveHtml({ ...longModel,
    projects: [{ path: 'E:/x/" onload="x', name: '"><script>alert(1)</script>' }, { path: 'E:/x/B', name: '乙' }],
    currentPath: 'E:/x/B' })
  const bar = /class="switcher"[\s\S]*?<\/nav>/.exec(hostile)[0]
  const link = /<a href="([^"]*)">/.exec(bar)
  assert.ok(link, '应有切换链接')
  assert.ok(!link[1].includes('"'), 'href 里不该有裸引号（会被提前闭合）：' + link[1])
  assert.ok(!/<script[\s>]/.test(hostile), '作品名里的脚本标签只能以文字出现')
  assert.ok(hostile.includes('&quot;&gt;&lt;script&gt;'), '作品名以转义文字保留')
})

console.log(`\n作品档案导出: ${pass} 项通过`)
