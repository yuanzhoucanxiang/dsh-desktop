/**
 * writing-mode domain：门禁、台账、AI 路由与补全。
 * 见 CONTRACT.md。不碰 HTTP / cordis 注入细节（ctx 作参数传入）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { findProjectRoot, readTextOrNull, listProjectFiles, effectiveRoots, readConfig } from './store.js'
import { loadKnowledgeFromRoot, searchKnowledge, formatKnowledgeHits } from './knowledge.js'
import { extractSearchQueries, webResearch, formatWebHits } from './websearch.js'

/* ── 门禁（与 E:\剧本\验证 的 check-*.mjs 同口径）── */
const WEAK_ADVERBS = ['微微', '淡淡', '缓缓', '轻轻', '悄然', '默默']
const CLICHES = [
  '不禁', '仿佛', '宛如', '宛若', '映入眼帘', '心中暗道', '暗自思忖',
  '沉声道', '淡淡地说', '缓缓说道', '脸色一变', '身形一顿',
  '嘴角微扬', '勾起一抹弧度', '不由自主', '情不自禁',
  '只见', '此时此刻', '目光如炬', '目光深邃',
]
const META_WORDS = ['卷一', '前文', '后文', '本章']

export function checkNovelGates(raw) {
  const cjk = (raw.match(/[一-鿿]/g) ?? []).length
  const dashes = (raw.match(/—/g) ?? []).length
  const negation =
    (raw.match(/不是[^。！？\n]{0,30}而是/g) ?? []).length +
    (raw.match(/并非[^。！？\n]{0,30}而是/g) ?? []).length
  const weakHits = WEAK_ADVERBS.map((w) => [w, raw.split(w).length - 1])
  const weakTotal = weakHits.reduce((s, [, c]) => s + c, 0)
  const per1000 = cjk === 0 ? 0 : (weakTotal / cjk) * 1000
  const clicheHits = CLICHES.map((w) => [w, raw.split(w).length - 1]).filter(([, c]) => c > 0)
  const metaHits = META_WORDS.map((w) => [w, raw.split(w).length - 1]).filter(([, c]) => c > 0)
  const lines = raw.split(/\r?\n/)
  let hookLine = ''
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim() !== '') {
      hookLine = lines[i].trim()
      break
    }
  }
  const hasHook = /^章末钩子[:：]/.test(hookLine)
  const asciiQuotes = (raw.match(/"/g) ?? []).length
  const rows = []
  const push = (ok, label, detail) => rows.push({ ok, label, detail })
  push(cjk >= 1800 && cjk <= 3200, '字数', `CJK=${cjk}（1800-3200）`)
  push(dashes <= 20, '破折号', `—×${dashes}（≤20）`)
  push(negation <= 2, '先否定后转折', `${negation}（≤2）`)
  push(per1000 <= 3, '弱化副词', `${weakTotal} / 千字 ${per1000.toFixed(2)}（≤3）`)
  push(metaHits.length === 0, '元话语禁令', metaHits.length ? metaHits.map(([w, c]) => `${w}×${c}`).join(' ') : '无')
  push(hasHook, '章末钩子落栏', hasHook ? hookLine.slice(0, 28) : `末行：${hookLine.slice(0, 28) || '空'}`)
  push(asciiQuotes === 0, '引号规范', `ASCII ${asciiQuotes}（=0）`)
  const fail = rows.filter((r) => !r.ok).length
  return { kind: 'novel', rows, pass: fail === 0, fail, extra: { cjk, clicheHits: clicheHits.map(([w, c]) => `${w}×${c}`) } }
}

export function checkFountainGates(raw) {
  const lines = raw.split(/\r?\n/)
  const SCENE = /^(\s*)(INT|EXT|INT\.?\/EXT|I\/E)[.．]?\s+|^(内景|外景|内外景)\s*[：: ]/
  const TRANSITION = /(CUT TO:|SMASH CUT:|FADE IN:|FADE OUT\.?|DISSOLVE TO:)\s*$/i
  let sceneCount = 0
  let transitionCount = 0
  let characterCues = 0
  let forcedCues = 0
  let dialogueLines = 0
  const quotedDialogue = []
  const bareNames = []
  let mode = 'action'
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (trimmed === '') {
      mode = 'action'
      continue
    }
    if (/^#{1,3}\s+\S/.test(trimmed)) { mode = 'action'; continue }
    if (SCENE.test(trimmed)) {
      sceneCount += 1
      mode = 'action'
      continue
    }
    if (TRANSITION.test(trimmed)) {
      transitionCount += 1
      mode = 'action'
      continue
    }
    if (mode === 'dialogue') {
      if (/^\(.*\)$/.test(trimmed)) continue
      dialogueLines += 1
      if (/[「」“”『』"]/.test(trimmed)) quotedDialogue.push(i + 1)
      continue
    }
    if (trimmed.startsWith('@')) {
      characterCues += 1
      forcedCues += 1
      mode = 'dialogue'
      continue
    }
    if (/^[A-Z][A-Z0-9 .'\-]{1,40}$/.test(trimmed)) {
      characterCues += 1
      mode = 'dialogue'
      continue
    }
    if (
      /^[一-鿿]{2,4}$/.test(trimmed) &&
      i + 1 < lines.length &&
      lines[i + 1].trim() !== '' &&
      !SCENE.test(lines[i + 1].trim())
    ) {
      bareNames.push(`${i + 1}:${trimmed}`)
    }
  }
  const rows = []
  const push = (ok, label, detail) => rows.push({ ok, label, detail })
  push(sceneCount >= 1, '场景标题', `${sceneCount} 个`)
  push(characterCues >= 1, '角色提示行', `${characterCues}（@ ${forcedCues}）`)
  push(dialogueLines >= 1, '对白行', `${dialogueLines} 行`)
  push(transitionCount >= 1, '转场', `${transitionCount} 个`)
  push(quotedDialogue.length === 0, '对白不加引号', quotedDialogue.length ? `第 ${quotedDialogue.slice(0, 5).join(',')} 行` : '无')
  push(bareNames.length === 0, '中文角色用 @', bareNames.length ? bareNames.slice(0, 5).join(' ') : '无裸名')
  push(!raw.includes('"'), 'ASCII 引号', '全文不得含英文双引号')
  const fail = rows.filter((r) => !r.ok).length
  return { kind: 'fountain', rows, pass: fail === 0, fail, extra: { scenes: sceneCount, dialogueLines } }
}

export function runGates(filePath, content) {
  const ext = path.extname(String(filePath || '')).toLowerCase()
  if (ext === '.fountain') return checkFountainGates(content)
  if ((ext === '.md' || ext === '.markdown') && /[\\/]draft[\\/]novel[\\/]/i.test(filePath)) return checkNovelGates(content)
  return { kind: 'none', rows: [], pass: true, fail: 0, extra: {} }
}

export function ledgerSummary(projectDir, activePath) {
  const out = {
    project: projectDir,
    timeline: [],
    foreshadowOpen: null,
    hook: null,
    latestReview: null,
    latestDraft: null,
  }
  const timeline = readTextOrNull(path.join(projectDir, 'bible', 'timeline.md'))
  if (timeline) {
    const lines = timeline
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('|---') && !/^\|\s*时间/.test(l))
    out.timeline = lines.slice(-5)
  }
  const foreshadow = readTextOrNull(path.join(projectDir, 'outline', 'foreshadow.md'))
  if (foreshadow) {
    out.foreshadowOpen = foreshadow.split(/\r?\n/).filter((l) => /未兑现|未回收/.test(l)).length
  }
  const files = listProjectFiles(projectDir)
  const seriesKey = (p) => p.replace(/-v\d+(\.[^.]+)$/i, '$1').toLowerCase()
  const groups = new Map()
  for (const f of files.filter(f => f.rel.startsWith('draft/'))) {
    const v = Number(f.name.match(/-v(\d+)\.[^.]+$/i)?.[1] || 0)
    const key = seriesKey(f.abs)
    if (!groups.has(key) || v > groups.get(key).v) groups.set(key, { ...f, path: f.abs, v })
  }
  const newest = groups.get(seriesKey(activePath || '')) || [...groups.values()].sort((a, b) => b.mtime - a.mtime)[0]
  if (newest) {
    out.latestDraft = { path: newest.path, name: newest.name }
    const text = readTextOrNull(newest.path) || ''
    const m = text.match(/章末钩子[:：]\s*(.+)$/m)
    if (m) out.hook = m[1].trim()
    else {
      const last = [...text.split(/\r?\n/)].reverse().find((l) => l.trim())
      if (last) out.hook = last.trim().slice(0, 80)
    }
  }
  const revs = files
    .filter((f) => f.rel.startsWith('reviews/'))
    .map((f) => {
      const v = Number(f.name.match(/-v(\d+)\.md$/i)?.[1] || 0)
      return { ...f, score: v * 1e12 + f.mtime }
    })
    .sort((a, b) => b.score - a.score)
  if (revs[0]) out.latestReview = revs[0].name
  return out
}

export function projectContextBrief(projectDir) {
  if (!projectDir) return ''
  const parts = []
  for (const rel of ['project.md', 'bible/world.md', 'bible/characters.md', 'outline/structure.md']) {
    const t = readTextOrNull(path.join(projectDir, rel))
    if (t) parts.push(`### ${rel}\n${t.slice(0, 1800)}`)
  }
  return parts.join('\n\n').slice(0, 5000)
}

export function heuristicRecommend(text, brief) {
  const raw = String(text || '')
  const cjk = raw.match(/[一-鿿]{2,4}/g) || []
  const freq = new Map()
  for (const w of cjk) freq.set(w, (freq.get(w) || 0) + 1)
  const stop = new Set([
    '一个', '我们', '他们', '自己', '什么', '这个', '那个', '就是', '可以', '没有',
    '但是', '因为', '所以', '然后', '如果', '这样', '那样', '开始', '已经', '还是',
    '不是', '怎么', '这么', '那么', '一直', '现在', '时候', '出来', '过去', '回来',
  ])
  const names = [...freq.entries()]
    .filter(([w, c]) => c >= 2 && !stop.has(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w)
  const places = (raw.match(/[一-鿿]{2,6}(?:路|街|巷|站|港|岛|山|湖|城|镇|村|院|隧道|下穿|服务区|医院|大学)/g) || []).slice(0, 5)
  const times = (raw.match(/\d{2,4}\s*年|\d{1,2}\s*月|\d{1,2}\s*[日号]|凌晨|黄昏|午夜|七年前|十年前/g) || []).slice(0, 5)
  const anchors = []
  if (brief) {
    for (const line of String(brief).split(/\r?\n/)) {
      if (/^(作品名|形态|题材类型|风格基调|一句话前提)[:：]/.test(line.trim())) {
        anchors.push(line.trim().replace(/\s+/g, ' ').slice(0, 80))
      }
    }
  }
  const lines = []
  lines.push('【灵感 · 本地启发式】未接通模型；有 LLM 时会结合圣经设定生成更贴项目的建议。')
  if (anchors.length) {
    lines.push('')
    lines.push('## 项目锚点')
    for (const a of anchors) lines.push(`- ${a}`)
  }
  lines.push('')
  lines.push('## 专有名词（建议查证或加深设定）')
  if (names.length) for (const n of names) lines.push(`- **${n}**：查同名历史/职业/文化含义，避免与常识冲突`)
  else lines.push('- （文本过短或专名不明显）选中更多正文再试')
  lines.push('')
  lines.push('## 地点与场景')
  if (places.length) for (const p of places) lines.push(`- **${p}**：查真实地理/建筑尺度/夜间可达性，保证物理可信`)
  else lines.push('- 补一个具体地点（街道/医院/车站），便于查地图与氛围参考')
  lines.push('')
  lines.push('## 时间与时代')
  if (times.length) for (const t of times) lines.push(`- **${t}**：对齐服饰、通信工具、交通与物价水平`)
  else lines.push('- 明确故事年份，再查当年新闻与生活细节')
  lines.push('')
  lines.push('## 灵感提示（可直接开写）')
  lines.push('- 把「异常现象」写成可观察的三个细节，而不是解释规则')
  lines.push('- 给主角一个与主线冲突的私人习惯（吃、路、称呼）')
  lines.push('- 用一件旧物（票据/钥匙/录音）承接上一章钩子')
  lines.push('- 查 1–2 篇同题材短评或民俗笔记，只取一个冷门事实嵌入')
  lines.push('')
  lines.push('## 可发送到会话的深挖指令')
  lines.push('```')
  lines.push(
    '请作为资料助理：围绕当前文稿，列出 6–8 条「可查证」的资料方向（历史事件/职业规范/地理/民俗/科技），每条给出查证关键词与若无法核实应如何虚构。不要改写正文。'
  )
  lines.push('```')
  return lines.join('\n')
}

export function resolveAiRoute(ctx, prefs) {
  if (prefs.aiMode === 'custom' && prefs.aiProvider && prefs.aiModel) {
    return {
      provider: prefs.aiProvider,
      model: prefs.aiModel,
      apiKey: prefs.aiApiKey || undefined,
      source: 'custom',
    }
  }
  try {
    const defaults = ctx.agentDefaultModel || (typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : undefined)
    const cfg = defaults?.currentSelection?.()
    if (cfg?.provider && cfg?.model) {
      return { provider: cfg.provider, model: cfg.model, source: 'default' }
    }
  } catch {}
  return {
    provider: prefs.aiProvider || 'deepseek-official',
    model: prefs.aiModel || 'deepseek-v4-flash',
    source: 'default',
  }
}

function makeUserMessage(text, plugin) {
  return Object.freeze({
    id: `writing-mode-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: [{ type: 'text', text: String(text || '') }],
    source: { kind: 'plugin', plugin },
  })
}

export async function chatComplete(ctx, { system, userText, route, maxTokens = 2048, temperature }) {
  const face = ctx.llm || (typeof ctx.get === 'function' ? ctx.get('llm') : undefined)
  if (!face || typeof face.stream !== 'function') return { ok: false, error: 'llm-unavailable' }
  if (!route?.provider || !route?.model) return { ok: false, error: 'no-model-route' }
  const options = {
    provider: route.provider,
    model: route.model,
    messages: [makeUserMessage(userText, '@dsh-local/writing-mode')],
    maxTokens,
  }
  if (system) options.system = system
  if (temperature !== undefined) options.temperature = temperature
  if (route.apiKey) options.apiKey = route.apiKey
  try {
    let out = ''
    const blocks = new Map()
    let finish
    for await (const chunk of face.stream(options)) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
        blocks.set(chunk.index || 0, (blocks.get(chunk.index || 0) || '') + chunk.text)
        out = [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, text]) => text).join('')
        if (out.length > 24000) break
      } else if (chunk?.type === 'block-end' && chunk.block?.type === 'text') {
        blocks.set(chunk.index || 0, chunk.block.text)
        out = [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, text]) => text).join('')
      } else if (chunk?.type === 'finish') {
        finish = chunk.reason
      } else if (typeof chunk === 'string') {
        out += chunk
      } else if (chunk?.delta) {
        out += String(chunk.delta)
      }
    }
    if (finish?.kind === 'error' || finish?.kind === 'aborted') {
      return { ok: false, error: finish.failure?.message || finish.kind }
    }
    if (!out.trim()) return { ok: false, error: 'empty-completion' }
    return { ok: true, text: out.trim(), route: { provider: route.provider, model: route.model } }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

export async function recommend(ctx, body, prefs) {
  const text = String(body?.text || '').slice(0, 8000)
  const style = body?.style === 'spark' ? 'spark' : 'research'
  let projectDir = null
  if (body?.path) {
    try {
      projectDir = findProjectRoot(String(body.path))
    } catch {}
  }
  const brief = projectContextBrief(projectDir)

  // 1) 优先联网查证（中文维基等；失败不挡）
  const queries = extractSearchQueries(text, brief, 4)
  let webHits = []
  try {
    webHits = await webResearch(queries, 3, 6)
  } catch {
    webHits = []
  }
  const webBlock = formatWebHits(webHits)
    ? `\n【已查到的公开资料（请据此写，勿编造相反事实）】\n${formatWebHits(webHits)}\n`
    : ''

  // 2) 本地笔记仅作旁注（可选，弱匹配直接丢掉）
  const extraK = []
  try {
    for (const r of effectiveRoots(readConfig())) {
      if (r.real) extraK.push(...loadKnowledgeFromRoot(r.real))
    }
  } catch {}
  const hits = searchKnowledge(text + ' ' + (brief || ''), extraK, 2)
  const knowledgeBlock = formatKnowledgeHits(hits)
    ? `\n【旁注·写作经验（非事实）】\n${formatKnowledgeHits(hits)}\n`
    : ''

  const role =
    style === 'spark'
      ? '你是创作伙伴，口吻自然，不要教科书腔。给能直接开写的灵感：具体画面、冲突变体、冷门细节。别堆术语。'
      : '你是资料助理。结合已查到的公开资料，整理仍值得深挖的方向与检索词；没有资料的部分明确说「待查」，不要把猜测写成史实。'

  const prompt = [
    role,
    '用中文 Markdown，不要套话。建议结构（可改）：先两三句点出文稿里最值得查的东西，再列可执行的下一步。',
    webBlock,
    knowledgeBlock,
    brief ? `\n【项目】\n${brief}` : '',
    `\n【文稿片段】\n${text || '（空）'}`,
    webHits.length
      ? '\n请围绕上述公开资料展开；补检索词时给出中英文关键词。'
      : '\n联网暂时没查到结果：请给具体检索词与替代查证路径，不要虚构百科条目。',
    '\n控制在 300–600 字。',
  ].join('\n')

  const route = resolveAiRoute(ctx, prefs)
  const r = await chatComplete(ctx, {
    system: '中文输出，简洁具体，避免「首先/其次/综上」。',
    userText: prompt,
    route,
    maxTokens: 1200,
  })

  const meta = {
    web: webHits.map((h) => h.title),
    knowledge: hits.map((h) => h.title),
    queries,
  }
  if (!r.ok) {
    // 无 LLM：有网页结果就直接展示，否则本地启发式
    let fallback
    if (webHits.length) {
      fallback =
        '【联网查到的公开资料】\n' +
        formatWebHits(webHits) +
        (knowledgeBlock ? '\n\n' + knowledgeBlock.trim() : '') +
        '\n\n【建议检索词】\n' +
        queries.map((q) => `- ${q}`).join('\n')
    } else {
      fallback =
        (knowledgeBlock ? knowledgeBlock.trim() + '\n\n' : '') + heuristicRecommend(text, brief)
    }
    return { ok: true, status: 200, result: fallback, fallback: true, error: r.error, ...meta }
  }
  return { ok: true, status: 200, result: r.text, fallback: false, model: r.route, ...meta }
}

export async function assist(ctx, body, prefs) {
  const action = String(body.action || 'polish')
  const text = String(body.text || '').slice(0, 12000)
  const instruction =
    body.instruction ||
    ({
      polish: '润色下列文本：保持原意与篇幅量级，提升可读性与节奏，不要编造事实。',
      continue: '续写下列文本：风格一致，自然衔接，续写 150–300 字，不要重复已有句子。',
      outline: '为下列文本生成简洁大纲（Markdown 列表，层级不超过三级）。',
      compress: '压缩下列文本到约一半长度，保留关键论点与结论。',
      expand: '扩写下列文本：补足论证与例子，篇幅约 1.5–2 倍，保持语气。',
    }[action] || '改进下列文本。')
  const prompt = `${instruction}\n\n---\n${text}\n---\n\n只输出处理后的正文，不要解释。`
  const route = resolveAiRoute(ctx, prefs)
  const r = await chatComplete(ctx, {
    system: '你是中文写作助手，严格按指令输出，不要闲聊。',
    userText: prompt,
    route,
    maxTokens: 2048,
  })
  if (!r.ok) return { ok: false, status: r.error === 'llm-unavailable' ? 501 : 502, error: r.error }
  return { ok: true, status: 200, result: r.text, model: r.route }
}
