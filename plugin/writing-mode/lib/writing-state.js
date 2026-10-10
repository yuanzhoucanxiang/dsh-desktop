/**
 * 写作模式状态 + 实时文本体检（纯函数，2026-10-10）。
 *
 * 两个目的：
 *   1. **实时检测文本**：`textHealth(text)` 对当前稿件做零依赖、零网络的体检
 *      （长句/重复词/副词密度/「的」堆叠/段落过长/对白引号/标点连打…），
 *      给状态条与写作伙伴用。它是**启发式**，只报"值得看一眼"的位置，不做改写。
 *   2. **写作模式状态**：`writingStateBlock(...)` 把"作者此刻在写什么、光标在哪、
 *      有没有未保存改动、今天写了多少、成稿检查过没过、体检发现什么"整理成一段
 *      紧凑的事实块，随消息一起送给写作伙伴——让 agent 真的知道现场，而不是靠猜。
 *
 * 本模块不碰 DOM / React / fetch / fs：node 侧可直接断言（test/writing-state.mjs）。
 */

/** 句末标点（中英）+ 引号闭合后的句号。 */
const SENTENCE_END = /[。！？!?；;…]+[”」』）)]*/g
const ADVERBS = ['很', '非常', '十分', '特别', '真正', '确实', '极其', '格外', '异常', '相当', '几乎', '简直']
const WEAK_OPENERS = ['他', '她', '它', '我', '你', '他们', '我们', '这', '那']

const SEVERITY_WEIGHT = { high: 6, warn: 3, info: 1 }

/** 切句：保留每句在原文中的起始偏移，便于回指。 */
export function splitSentences(text) {
  const src = String(text || '')
  const out = []
  let start = 0
  SENTENCE_END.lastIndex = 0
  let m
  while ((m = SENTENCE_END.exec(src)) !== null) {
    const end = m.index + m[0].length
    const chunk = src.slice(start, end)
    if (chunk.trim()) out.push({ at: start, text: chunk.trim() })
    start = end
  }
  const tail = src.slice(start)
  if (tail.trim()) out.push({ at: start, text: tail.trim() })
  return out
}

const countChar = (text, ch) => String(text).split(ch).length - 1
const excerpt = (text, at, len = 34) => String(text).slice(Math.max(0, at), Math.max(0, at) + len).replace(/\s+/g, ' ')

/**
 * 实时文本体检。
 * @param {string} text 当前稿件全文
 * @param {{maxSentence?: number, maxParagraph?: number}} [opts]
 * @returns {{metrics: object, issues: Array, score: number, brief: string}}
 *   issues[].kind 是稳定标识（UI/门禁都按它断言），at 是原文偏移。
 */
export function textHealth(text, opts = {}) {
  const src = String(text || '')
  const maxSentence = Number(opts.maxSentence) > 0 ? Number(opts.maxSentence) : 60
  const maxParagraph = Number(opts.maxParagraph) > 0 ? Number(opts.maxParagraph) : 300
  const issues = []
  const push = (kind, severity, at, hint, extra) => issues.push({ kind, severity, at, excerpt: excerpt(src, at), hint, ...(extra || {}) })

  const sentences = splitSentences(src)
  const paragraphs = src.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)

  // 1) 长句：中文写作里最容易读累的地方
  let maxLen = 0
  for (const s of sentences) {
    const len = s.text.replace(/\s+/g, '').length
    if (len > maxLen) maxLen = len
    if (len > maxSentence) {
      push(len > 100 ? 'sentence-too-long' : 'sentence-long', len > 100 ? 'warn' : 'info', s.at,
        `${len} 字一句；考虑在转折处断成两句`, { length: len })
    }
  }

  // 2) 段落过长
  for (const p of paragraphs) {
    const len = p.replace(/\s+/g, '').length
    if (len > maxParagraph) {
      push('paragraph-long', 'info', src.indexOf(p), `${len} 字一段；长段落读者容易跳读`, { length: len })
    }
  }

  // 3) 副词密度（全篇）
  const adverbHits = []
  for (const word of ADVERBS) {
    let i = src.indexOf(word)
    while (i >= 0 && adverbHits.length < 200) {
      adverbHits.push({ word, at: i })
      i = src.indexOf(word, i + word.length)
    }
  }
  const chars = src.replace(/\s+/g, '').length
  const adverbPer1000 = chars ? (adverbHits.length * 1000) / chars : 0
  if (adverbHits.length >= 8 && adverbPer1000 > 4) {
    push('adverb-heavy', 'warn', adverbHits[0].at,
      `全文「${adverbHits[0].word}」这类程度副词 ${adverbHits.length} 处（每千字 ${adverbPer1000.toFixed(1)} 处）；删掉一半往往更有力`)
  }

  // 4) 「的」堆叠（按句）
  for (const s of sentences) {
    const n = countChar(s.text, '的')
    if (n >= 5) push('de-stack', 'info', s.at, `这一句有 ${n} 个「的」；合并修饰语会更利落`, { count: n })
  }

  // 5) 句内重复词（2 字实词重复 3 次以上，跳过"的/了/是"这类功能词）
  for (const s of sentences) {
    const freq = new Map()
    for (const w of s.text.match(/[\u4e00-\u9fff]{2}/g) || []) {
      if (/^(的|了|是|在|和|与|就|都|也|还|被|把|着|过|有|不|一|这|那|他|她|它|我|你)/.test(w)) continue
      freq.set(w, (freq.get(w) || 0) + 1)
    }
    const worst = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]
    if (worst && worst[1] >= 3) push('word-repeat', 'info', s.at, `「${worst[0]}」在一句里出现 ${worst[1]} 次`, { word: worst[0], count: worst[1] })
  }

  // 6) 连续段落同一起手（排比失控）
  const openers = paragraphs.map((p) => p.slice(0, 2))
  for (let i = 2; i < openers.length; i++) {
    if (openers[i] && openers[i] === openers[i - 1] && openers[i] === openers[i - 2] && WEAK_OPENERS.includes(openers[i][0])) {
      push('same-opening', 'info', src.indexOf(paragraphs[i]), `连续三段都以「${openers[i]}」开头`, { opener: openers[i] })
      break
    }
  }

  // 7) 对白引号：一行里出现中文引号开合不成对
  const dialogueLines = src.split(/\r?\n/).filter((l) => /[「“"]/.test(l))
  for (const line of dialogueLines) {
    const open = countChar(line, '「') + countChar(line, '“')
    const close = countChar(line, '」') + countChar(line, '”')
    if (open !== close) {
      push('quote-unbalanced', 'warn', src.indexOf(line), '这一行的引号开合不成对', { open, close })
    }
  }

  // 8) 标点连打（省略号/破折号之外）
  const runMatch = src.match(/([，。！？、；：])\1{2,}/)
  if (runMatch) push('punctuation-run', 'info', src.indexOf(runMatch[0]), `「${runMatch[0]}」标点连打`)

  // 9) 连续空行过多
  const gap = src.match(/\n{4,}/)
  if (gap) push('blank-run', 'info', src.indexOf(gap[0]), '连续多个空行；排版交给样式即可')

  const weight = issues.reduce((sum, it) => sum + (SEVERITY_WEIGHT[it.severity] || 1), 0)
  const score = Math.max(0, 100 - weight)
  const high = issues.filter((i) => i.severity === 'warn').length
  const brief = issues.length === 0
    ? '体检 ✓ 没有明显问题'
    : `体检 ${issues.length} 处提示${high ? `（${high} 处较明显）` : ''}`
  return {
    metrics: {
      chars,
      sentences: sentences.length,
      paragraphs: paragraphs.length,
      avgSentence: sentences.length ? Math.round((chars / sentences.length) * 10) / 10 : 0,
      maxSentence: maxLen,
      adverbs: adverbHits.length,
      dialogueLines: dialogueLines.length,
    },
    issues,
    score,
    brief,
  }
}

/** 一行摘要（状态条/提示用）。 */
export function textHealthBrief(health) {
  return health && health.brief ? health.brief : ''
}

/**
 * 写作模式状态块：随消息一起送给写作伙伴的事实（作者在面板里看不到这一段）。
 * 只写**确定的事实**；缺哪一项就不写哪一项，绝不用默认值假装知道。
 * @param {object} s
 * @returns {string} 空串表示没有任何可用事实（调用方就不加这一段）
 */
export function writingStateBlock(s = {}) {
  const lines = []
  const project = String(s.projectLabel || s.project || '').trim()
  const file = String(s.fileLabel || s.filePath || '').trim()
  if (project) lines.push(`- 作品：${project}`)
  if (file) lines.push(`- 正在写：${file}`)
  const cursor = Number(s.cursorChars)
  if (Number.isFinite(cursor) && cursor >= 0) lines.push(`- 光标：第 ${cursor} 字处`)
  if (s.selectionChars > 0) lines.push(`- 选区：${s.selectionChars} 字`)
  if (typeof s.dirty === 'boolean') lines.push(`- 未保存改动：${s.dirty ? '有' : '无'}`)
  if (s.focus) lines.push('- 专注模式：开')
  if (Number.isFinite(Number(s.todayChars))) {
    lines.push(`- 今日净增：${s.todayChars >= 0 ? '+' : ''}${s.todayChars} 字${Number(s.dailyGoal) > 0 ? ` / 目标 ${s.dailyGoal}` : ''}`)
  }
  if (s.gate && s.gate.kind && s.gate.kind !== 'none') {
    lines.push(`- 成稿检查（${s.gate.kind}）：${s.gate.pass ? '全部通过' : `${s.gate.fail} 项未达标`}`)
  }
  if (s.health && Array.isArray(s.health.issues)) {
    lines.push(`- 实时体检：${s.health.brief || textHealthBrief(s.health)}`)
    const top = s.health.issues.slice(0, 3)
    for (const it of top) lines.push(`  · ${it.hint}（「${it.excerpt}…」）`)
  }
  if (s.paragraph) {
    const p = String(s.paragraph).replace(/\s+/g, ' ').slice(0, 240)
    if (p) lines.push(`- 当前段落：${p}${String(s.paragraph).length > 240 ? '…' : ''}`)
  }
  if (!lines.length) return ''
  return [
    '【写作模式状态】（系统自动附带的事实，作者看不到这一段）',
    ...lines,
    '以上是作者此刻的真实状态：请据此回答，不要臆造文件、进度或未列出的内容。',
  ].join('\n')
}
