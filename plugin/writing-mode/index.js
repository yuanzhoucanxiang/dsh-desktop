/**
 * Host half of @dsh-local/writing-mode.
 *
 * 职责：
 *  1. fenced API（loopback only）：库根配置 / 项目树 / 文稿 CRUD / AI 辅助；
 *  2. 库根用户可自定义（~/.dsh/writing-mode.json），路径 realpath 后必须落在根内；
 *  3. AI 辅助：有 dsh-llm 时调用，否则 501 由 client 降级「发送到会话」。
 *
 * UI 全在 client.js（shell.overlay）。内核零修改。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const name = 'writing-mode'
/** webServer=文档库 API；llm=辅助写作（缺 llm 时 apply 内降级，不拖垮插件树）。 */
export const inject = ['webServer', 'llm']

const API = '/api/writing-mode'
const CONFIG_NAME = 'writing-mode.json'
const TEXT_EXTS = new Set(['.md', '.markdown', '.fountain', '.txt'])
/** 项目内只扫这些子目录（对齐 writing-studio 契约），避免整盘递归。 */
const PROJECT_SUBDIRS = ['bible', 'outline', 'draft', 'state', 'reviews', 'draft/novel', 'draft/script']

const DEFAULT_PREFS = {
  fontSize: 17,
  lineHeight: 1.95,
  autoSaveMs: 800,
  autoGate: true,
  /** harness=跟会话默认模型；custom=设置里指定 */
  aiMode: 'harness',
  aiProvider: 'deepseek-official',
  aiModel: 'deepseek-v4-flash',
  aiApiKey: '',
}

function clamp(n, lo, hi, dflt) {
  const v = Number(n)
  if (!Number.isFinite(v)) return dflt
  return Math.min(hi, Math.max(lo, v))
}

function normalizePrefs(raw) {
  const r = (raw && typeof raw === 'object' ? raw : {}) || {}
  return {
    fontSize: clamp(r.fontSize, 12, 28, DEFAULT_PREFS.fontSize),
    lineHeight: clamp(r.lineHeight, 1.4, 2.6, DEFAULT_PREFS.lineHeight),
    autoSaveMs: clamp(r.autoSaveMs, 200, 5000, DEFAULT_PREFS.autoSaveMs),
    autoGate: r.autoGate === undefined ? DEFAULT_PREFS.autoGate : Boolean(r.autoGate),
    aiMode: r.aiMode === 'custom' ? 'custom' : 'harness',
    aiProvider: String(r.aiProvider || DEFAULT_PREFS.aiProvider).slice(0, 80),
    aiModel: String(r.aiModel || DEFAULT_PREFS.aiModel).slice(0, 80),
    aiApiKey: typeof r.aiApiKey === 'string' ? r.aiApiKey.slice(0, 200) : '',
  }
}

function configFile() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, CONFIG_NAME)
}

function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(), 'utf8'))
    const roots = Array.isArray(raw?.roots) ? raw.roots : []
    return {
      roots: roots
        .filter((r) => r && typeof r.path === 'string' && r.path.trim() !== '')
        .map((r) => ({
          path: String(r.path),
          label: String(r.label || path.basename(r.path) || r.path),
          default: Boolean(r.default),
        })),
      activeRoot: typeof raw?.activeRoot === 'string' ? raw.activeRoot : null,
      prefs: normalizePrefs(raw?.prefs),
    }
  } catch {
    return { roots: [], activeRoot: null, prefs: { ...DEFAULT_PREFS } }
  }
}

function writeConfig(cfg) {
  const file = configFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const out = {
    roots: cfg.roots || [],
    activeRoot: cfg.activeRoot ?? null,
    prefs: normalizePrefs(cfg.prefs),
  }
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8')
  return out
}

function isLoopbackRequest(req) {
  const addr = String(req?.socket?.remoteAddress ?? '')
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function writeJson(res, status, obj) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(obj))
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => {
      data += String(chunk)
      if (data.length > 4e6) req.destroy()
    })
    req.on('end', () => resolve(data))
    req.on('error', () => resolve(''))
  })
}

function realOrNull(p) {
  try {
    return fs.realpathSync(String(p))
  } catch {
    return null
  }
}

/** 根列表（realpath；不存在的根保留原路径但标 missing）。 */
function effectiveRoots(cfg) {
  const out = []
  const seen = new Set()
  for (const r of cfg.roots) {
    const real = realOrNull(r.path)
    const key = (real || r.path).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...r, real, missing: real === null })
  }
  return out
}

/** 目标路径必须落在某个库根内，否则 null。 */
function resolveUnderRoots(filePath, roots) {
  const raw = path.resolve(String(filePath))
  const real = realOrNull(raw)
  if (real === null) {
    // 尚不存在的文件：用父目录 realpath 再拼
    const parent = realOrNull(path.dirname(raw))
    if (parent === null) return null
    const joined = path.join(parent, path.basename(raw))
    for (const r of roots) {
      if (!r.real) continue
      const rel = path.relative(r.real, joined)
      if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        return { abs: joined, root: r.path, rel: path.relative(r.real, joined) }
      }
    }
    return null
  }
  for (const r of roots) {
    if (!r.real) continue
    const rel = path.relative(r.real, real)
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      return { abs: real, root: r.path, rel }
    }
  }
  return null
}

function listProjectFiles(projectDir) {
  const files = []
  const seen = new Set()
  const pushFile = (abs) => {
    let real
    try {
      real = fs.realpathSync(abs)
    } catch {
      real = abs
    }
    const key = real.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    const st = fs.statSync(abs)
    if (!st.isFile()) return
    const ext = path.extname(abs).toLowerCase()
    if (!TEXT_EXTS.has(ext)) return
    let chars = 0
    try {
      chars = fs.readFileSync(abs, 'utf8').length
    } catch {}
    files.push({
      abs: real,
      name: path.basename(abs),
      rel: path.relative(projectDir, real).split(path.sep).join('/'),
      mtime: st.mtimeMs,
      chars,
      ext,
    })
  }
  const walk = (dir, depth) => {
    if (depth > 4) return
    let ents
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of ents) {
      if (ent.name.startsWith('.')) continue
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        walk(full, depth + 1)
      } else if (ent.isFile()) {
        pushFile(full)
      }
    }
  }
  try {
    for (const ent of fs.readdirSync(projectDir, { withFileTypes: true })) {
      if (ent.isFile() && TEXT_EXTS.has(path.extname(ent.name).toLowerCase())) {
        pushFile(path.join(projectDir, ent.name))
      }
    }
    // 只扫顶层契约目录；draft 递归已覆盖 draft/novel、draft/script
    // （此前再扫子路径会把同一文件列两次）
    for (const sub of ['bible', 'outline', 'draft', 'state', 'reviews']) {
      const d = path.join(projectDir, sub)
      if (fs.existsSync(d)) walk(d, 1)
    }
  } catch {}
  files.sort((a, b) => a.rel.localeCompare(b.rel, 'zh'))
  return files
}

function scanTree(cfg) {
  const roots = effectiveRoots(cfg)
  const active = cfg.activeRoot
  const tree = roots.map((r) => {
    const projects = []
    if (r.real) {
      try {
        const ents = fs.readdirSync(r.real, { withFileTypes: true })
        // 根自身若含 project.md，也算一个项目
        if (fs.existsSync(path.join(r.real, 'project.md'))) {
          projects.push({
            name: path.basename(r.real),
            path: r.real,
            isRootProject: true,
            files: listProjectFiles(r.real),
          })
        }
        for (const ent of ents) {
          if (!ent.isDirectory() || ent.name.startsWith('.')) continue
          const dir = path.join(r.real, ent.name)
          if (!fs.existsSync(path.join(dir, 'project.md'))) continue
          projects.push({
            name: ent.name,
            path: dir,
            isRootProject: false,
            files: listProjectFiles(dir),
          })
        }
      } catch {}
    }
    projects.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    return {
      path: r.path,
      label: r.label,
      default: r.default,
      missing: r.missing,
      real: r.real,
      active: active !== null ? path.resolve(active).toLowerCase() === path.resolve(r.path).toLowerCase() : r.default,
      projects,
    }
  })
  return tree
}

function newDraftPath(rootPath, title) {
  const safe = String(title || '未命名').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40) || '未命名'
  const stamp = Date.now().toString(36)
  return path.join(rootPath, `${safe}-${stamp}.md`)
}

/* ── 量化门禁（与 E:\剧本\验证 的 check-gates / check-fountain 同口径）── */
const WEAK_ADVERBS = ['微微', '淡淡', '缓缓', '轻轻', '悄然', '默默']
const CLICHES = [
  '不禁', '仿佛', '宛如', '宛若', '映入眼帘', '心中暗道', '暗自思忖',
  '沉声道', '淡淡地说', '缓缓说道', '脸色一变', '身形一顿',
  '嘴角微扬', '勾起一抹弧度', '不由自主', '情不自禁',
  '只见', '此时此刻', '目光如炬', '目光深邃',
]
const META_WORDS = ['卷一', '前文', '后文', '本章']

function checkNovelGates(raw) {
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

function checkFountainGates(raw) {
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
      if (/[「」“”]/.test(trimmed)) quotedDialogue.push(i + 1)
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
  const fail = rows.filter((r) => !r.ok).length
  return { kind: 'fountain', rows, pass: fail === 0, fail, extra: { scenes: sceneCount, dialogueLines } }
}

function runGates(filePath, content) {
  const ext = path.extname(String(filePath || '')).toLowerCase()
  if (ext === '.fountain') return checkFountainGates(content)
  if (ext === '.md' || ext === '.markdown') return checkNovelGates(content)
  return { kind: 'none', rows: [], pass: true, fail: 0, extra: {} }
}

/** 从任意文件路径上溯到含 project.md 的项目根；找不到返回 null。 */
function findProjectRoot(absPath) {
  let dir = path.dirname(path.resolve(String(absPath || '')))
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'project.md'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function readTextOrNull(p) {
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

/**
 * 台账速览：时间线尾条 / 伏笔未兑现数 / 当前稿钩子 / 最新评审。
 * 只读 project 契约路径，失败字段为 null，不抛错。
 */
function ledgerSummary(projectDir) {
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
    const open = foreshadow.split(/\r?\n/).filter((l) => /未兑现|未回收/.test(l)).length
    out.foreshadowOpen = open
  }
  // 最新 draft
  const draftRoot = path.join(projectDir, 'draft')
  let newest = null
  const walkDraft = (dir, depth) => {
    if (depth > 3) return
    let ents
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of ents) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) walkDraft(full, depth + 1)
      else if (ent.isFile() && /\.(md|fountain)$/i.test(ent.name)) {
        try {
          const st = fs.statSync(full)
          if (!newest || st.mtimeMs > newest.mtime) {
            newest = { path: full, name: ent.name, mtime: st.mtimeMs }
          }
        } catch {}
      }
    }
  }
  if (fs.existsSync(draftRoot)) walkDraft(draftRoot, 0)
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
  const reviewsDir = path.join(projectDir, 'reviews')
  try {
    const revs = fs
      .readdirSync(reviewsDir)
      .filter((n) => n.endsWith('.md'))
      .map((n) => {
        const st = fs.statSync(path.join(reviewsDir, n))
        return { name: n, mtime: st.mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
    if (revs[0]) out.latestReview = revs[0].name
  } catch {}
  return out
}

/** 从项目圣经拼「设定摘要」给推荐用（截断防爆 token）。 */
function projectContextBrief(projectDir) {
  if (!projectDir) return ''
  const parts = []
  for (const rel of ['project.md', 'bible/world.md', 'bible/characters.md', 'outline/structure.md']) {
    const t = readTextOrNull(path.join(projectDir, rel))
    if (t) parts.push(`### ${rel}\n${t.slice(0, 1800)}`)
  }
  return parts.join('\n\n').slice(0, 5000)
}

/** 无 LLM 时的本地启发式：抽专有名词与题材线索，生成可执行的检索提示。 */
function heuristicRecommend(text, brief) {
  const raw = String(text || '')
  // 名词只从当前文稿抽，避免圣经/立项等元词污染
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
  // 从 project 摘要取「作品名/形态/题材」三行做锚点
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
    `请作为资料助理：围绕当前文稿，列出 6–8 条「可查证」的资料方向（历史事件/职业规范/地理/民俗/科技），每条给出查证关键词与若无法核实应如何虚构。不要改写正文。`
  )
  lines.push('```')
  return lines.join('\n')
}

/**
 * 资料搜寻 / 灵感推荐。
 * body: { text, path?, style?: 'research'|'spark' }
 */
async function recommend(ctx, body, prefs) {
  const text = String(body?.text || '').slice(0, 8000)
  const style = body?.style === 'spark' ? 'spark' : 'research'
  let projectDir = null
  if (body?.path) {
    try {
      projectDir = findProjectRoot(String(body.path))
    } catch {}
  }
  const brief = projectContextBrief(projectDir)

  const role =
    style === 'spark'
      ? '你是创作灵感顾问。给出可直接开写的灵感点、冲突变体、意象与冷门细节，不要写成资料清单。'
      : '你是资料调研助理。输出「可查证」的资料方向：历史/地理/职业规范/民俗/科技；每条含查证关键词与无法核实时的安全虚构建议。禁止把具体史实编造成真。'
  const prompt = [
    role,
    '用中文 Markdown，分「专有名词」「地点场景」「时间时代」「灵感/资料条目」「可执行下一步」。',
    brief ? `\n【项目设定摘要】\n${brief}` : '',
    `\n【当前文稿片段】\n${text || '（空，请给通用但可套用的检索框架）'}`,
    '\n控制在 400–800 字，条目用短列表。',
  ].join('\n')

  const route = resolveAiRoute(ctx, prefs)
  const r = await chatComplete(ctx, {
    system: '你是中文创作资料助理，只输出 Markdown 正文。',
    userText: prompt,
    route,
    maxTokens: 1200,
  })
  if (!r.ok) {
    return { ok: true, status: 200, result: heuristicRecommend(text, brief), fallback: true, error: r.error }
  }
  return { ok: true, status: 200, result: r.text, fallback: false, model: r.route }
}

/** 解析当前应使用的 provider/model：prefs.custom 优先，否则 harness 默认路由。 */
function resolveAiRoute(ctx, prefs) {
  if (prefs.aiMode === 'custom' && prefs.aiProvider && prefs.aiModel) {
    return {
      provider: prefs.aiProvider,
      model: prefs.aiModel,
      apiKey: prefs.aiApiKey || undefined,
      source: 'custom',
    }
  }
  // harness：跟会话默认（requestHeader），否则 deepseek-official 公开默认模型
  try {
    const sessions =
      ctx.sessions || (typeof ctx.get === 'function' ? ctx.get('sessions') : undefined)
    if (sessions && typeof sessions.list === 'function') {
      const list = sessions.list()
      // 最近有 requestHeader 的会话
      for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i]
        const cfg = s?.requestHeader?.()?.config
        if (cfg?.provider && cfg?.model) {
          return { provider: cfg.provider, model: cfg.model, source: 'session' }
        }
      }
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

/**
 * 走内核 ctx.llm.stream 的一次补全。
 * 返回 { ok, text, error? }
 */
async function chatComplete(ctx, { system, userText, route, maxTokens = 2048, temperature }) {
  const face = ctx.llm || (typeof ctx.get === 'function' ? ctx.get('llm') : undefined)
  if (!face || typeof face.stream !== 'function') {
    return { ok: false, error: 'llm-unavailable' }
  }
  if (!route?.provider || !route?.model) {
    return { ok: false, error: 'no-model-route' }
  }
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
    let finish
    for await (const chunk of face.stream(options)) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
        out += chunk.text
        if (out.length > 24000) break
      } else if (chunk?.type === 'block-end' && chunk.block?.type === 'text') {
        out = chunk.block.text
      } else if (chunk?.type === 'finish') {
        finish = chunk.reason
      }
      // 旧式兼容（非 StreamChunk 协议）
      else if (typeof chunk === 'string') {
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

async function assist(ctx, body, prefs) {
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

export function apply(ctx) {
  const c = ctx
  // 防御：webServer 缺席时本插件降级为 no-op，绝不拖垮整个插件树
  if (!c || !c.webServer || typeof c.webServer.register !== 'function') {
    console.warn('[writing-mode] webServer unavailable, host API disabled')
    return
  }
  ctx.effect(() =>
    c.webServer.register({
      kind: 'exact',
      path: API,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { ok: false, error: 'forbidden' })
          return
        }
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        const route = url.searchParams.get('route') || ''
        let cfg = readConfig()

        if (req.method === 'GET' && (route === 'config' || route === 'list' || route === '')) {
          const roots = effectiveRoots(cfg)
          writeJson(res, 200, {
            ok: true,
            config: { roots: cfg.roots, activeRoot: cfg.activeRoot, prefs: cfg.prefs },
            prefs: cfg.prefs,
            roots: roots.map((r) => ({ path: r.path, label: r.label, default: r.default, missing: r.missing })),
            tree: scanTree(cfg),
          })
          return
        }

        if (req.method === 'GET' && route === 'tree') {
          writeJson(res, 200, { ok: true, tree: scanTree(cfg) })
          return
        }

        if (req.method === 'POST' && route === 'prefs') {
          let parsed
          try {
            parsed = JSON.parse((await readBody(req)) || '{}')
          } catch {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          cfg.prefs = normalizePrefs({ ...cfg.prefs, ...parsed })
          try {
            writeConfig(cfg)
          } catch (err) {
            writeJson(res, 500, { ok: false, error: String(err?.message || err) })
            return
          }
          writeJson(res, 200, { ok: true, prefs: cfg.prefs })
          return
        }

        if (req.method === 'POST' && route === 'roots') {
          let parsed
          try {
            parsed = JSON.parse((await readBody(req)) || '{}')
          } catch {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          const mode = String(parsed?.mode || 'set')
          if (mode === 'set') {
            const roots = Array.isArray(parsed.roots) ? parsed.roots : []
            cfg = {
              roots: roots
                .filter((r) => r && typeof r.path === 'string')
                .map((r) => ({
                  path: path.resolve(String(r.path)),
                  label: String(r.label || path.basename(String(r.path)) || r.path),
                  default: Boolean(r.default),
                })),
              activeRoot:
                typeof parsed.activeRoot === 'string' && parsed.activeRoot !== ''
                  ? path.resolve(parsed.activeRoot)
                  : null,
              prefs: cfg.prefs,
            }
          } else if (mode === 'add') {
            const p = path.resolve(String(parsed?.path || ''))
            if (!p) {
              writeJson(res, 400, { ok: false, error: 'bad-path' })
              return
            }
            if (!cfg.roots.some((r) => path.resolve(r.path).toLowerCase() === p.toLowerCase())) {
              cfg.roots.push({
                path: p,
                label: String(parsed?.label || path.basename(p) || p),
                default: cfg.roots.length === 0,
              })
            }
            if (parsed?.active === true || cfg.activeRoot === null) cfg.activeRoot = p
          } else if (mode === 'remove') {
            const p = path.resolve(String(parsed?.path || ''))
            cfg.roots = cfg.roots.filter((r) => path.resolve(r.path).toLowerCase() !== p.toLowerCase())
            if (cfg.activeRoot && path.resolve(cfg.activeRoot).toLowerCase() === p.toLowerCase()) {
              cfg.activeRoot = cfg.roots[0] ? cfg.roots[0].path : null
            }
          } else if (mode === 'activate') {
            const p = path.resolve(String(parsed?.path || ''))
            if (!cfg.roots.some((r) => path.resolve(r.path).toLowerCase() === p.toLowerCase())) {
              writeJson(res, 400, { ok: false, error: 'unknown-root' })
              return
            }
            cfg.activeRoot = p
          } else {
            writeJson(res, 400, { ok: false, error: 'bad-mode' })
            return
          }
          try {
            writeConfig(cfg)
          } catch (err) {
            writeJson(res, 500, { ok: false, error: String(err?.message || err) })
            return
          }
          writeJson(res, 200, { ok: true, config: cfg, tree: scanTree(cfg) })
          return
        }

        if (req.method === 'GET' && route === 'get') {
          const roots = effectiveRoots(cfg)
          const target = resolveUnderRoots(url.searchParams.get('path') || '', roots)
          if (target === null) {
            writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
            return
          }
          try {
            const text = fs.readFileSync(target.abs, 'utf8')
            const st = fs.statSync(target.abs)
            writeJson(res, 200, {
              ok: true,
              doc: { path: target.abs, content: text, mtime: st.mtimeMs, chars: text.length },
            })
          } catch (err) {
            writeJson(res, 404, { ok: false, error: String(err?.message || err) })
          }
          return
        }

        if (req.method === 'POST' && route === 'save') {
          let parsed
          try {
            parsed = JSON.parse((await readBody(req)) || '{}')
          } catch {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          const roots = effectiveRoots(cfg)
          let targetPath = parsed?.path
          if (!targetPath) {
            const rootPath =
              (typeof parsed?.root === 'string' && parsed.root) ||
              cfg.activeRoot ||
              (roots.find((r) => r.real) || {}).real
            if (!rootPath) {
              writeJson(res, 400, { ok: false, error: 'no-root' })
              return
            }
            targetPath = newDraftPath(rootPath, parsed?.title)
          }
          const target = resolveUnderRoots(targetPath, roots)
          if (target === null) {
            writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
            return
          }
          const body = String(parsed?.content ?? '')
          try {
            fs.mkdirSync(path.dirname(target.abs), { recursive: true })
            fs.writeFileSync(target.abs, body, 'utf8')
            writeJson(res, 200, {
              ok: true,
              doc: { path: target.abs, content: body, mtime: Date.now(), chars: body.length },
            })
          } catch (err) {
            writeJson(res, 500, { ok: false, error: String(err?.message || err) })
          }
          return
        }

        if (req.method === 'POST' && route === 'delete') {
          let parsed
          try {
            parsed = JSON.parse((await readBody(req)) || '{}')
          } catch {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          const roots = effectiveRoots(cfg)
          const target = resolveUnderRoots(parsed?.path || '', roots)
          if (target === null) {
            writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
            return
          }
          try {
            fs.rmSync(target.abs, { force: true })
            writeJson(res, 200, { ok: true })
          } catch (err) {
            writeJson(res, 500, { ok: false, error: String(err?.message || err) })
          }
          return
        }

        if (req.method === 'POST' && route === 'assist') {
          let parsed
          try {
            parsed = JSON.parse((await readBody(req)) || '{}')
          } catch {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          if (parsed?.action === 'research' || parsed?.action === 'spark') {
            const r = await recommend(ctx, parsed, cfg.prefs)
            writeJson(res, r.status, {
              ok: true,
              result: r.result,
              fallback: Boolean(r.fallback),
            })
            return
          }
          const r = await assist(ctx, parsed, cfg.prefs)
          writeJson(res, r.status, r.ok ? { ok: true, result: r.result } : { ok: false, error: r.error })
          return
        }

        if (req.method === 'POST' && route === 'gate') {
          let parsed
          try {
            parsed = JSON.parse((await readBody(req)) || '{}')
          } catch {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          let content = parsed?.content
          let filePath = parsed?.path || ''
          if (typeof content !== 'string' || content === '') {
            if (!filePath) {
              writeJson(res, 400, { ok: false, error: 'need-content-or-path' })
              return
            }
            const roots = effectiveRoots(cfg)
            const target = resolveUnderRoots(filePath, roots)
            if (target === null) {
              writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
              return
            }
            try {
              content = fs.readFileSync(target.abs, 'utf8')
              filePath = target.abs
            } catch (err) {
              writeJson(res, 404, { ok: false, error: String(err?.message || err) })
              return
            }
          }
          const result = runGates(filePath, content)
          writeJson(res, 200, { ok: true, gate: result, path: filePath })
          return
        }

        if (req.method === 'POST' && route === 'ledger') {
          let parsed
          try {
            parsed = JSON.parse((await readBody(req)) || '{}')
          } catch {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          const roots = effectiveRoots(cfg)
          const target = resolveUnderRoots(parsed?.path || '', roots)
          if (target === null) {
            writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
            return
          }
          const proj = findProjectRoot(target.abs)
          if (!proj) {
            writeJson(res, 200, { ok: true, ledger: null })
            return
          }
          // 项目根也必须在库内
          if (resolveUnderRoots(proj, roots) === null) {
            writeJson(res, 400, { ok: false, error: 'project-outside-roots' })
            return
          }
          writeJson(res, 200, { ok: true, ledger: ledgerSummary(proj) })
          return
        }

        writeJson(res, 404, { ok: false, error: 'unknown-route' })
      },
    })
  )
}
