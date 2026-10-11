/**
 * 章节上下文（2026-10-11）：写作伙伴要能回答"这一章该收什么、上一章留了什么、谁在场"，
 * 而不是只看到一段正文。
 *
 * 纯读：不写任何文件；只用作品里已有的结构（outline/structure.md、draft/ 版本、
 * outline/foreshadow.md、bible/characters.md），与写作台展示的口径同源（复用
 * domain.outlineSummary / ledgerSummary，避免两套算法给出不同答案）。
 *
 * 输出既给模型（summary 一行 + 结构化字段），也给 UI（章节定位）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { outlineSummary } from './domain.js'

/** 版本号归一：`第1章-v2.md` 与 `第1章.md` 是同一"章"的系列。 */
function seriesKey(p) {
  return String(p || '').replace(/\\/g, '/').replace(/-v\d+(\.[^.]+)$/i, '$1').toLowerCase()
}

function readTextOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/** bible/characters.md 里的小节标题（`## 林默` / `### 林默`）当人物名。 */
function characterNames(projectDir) {
  const text = readTextOrNull(path.join(projectDir, 'bible', 'characters.md'))
  if (!text) return []
  const names = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^#{2,4}\s+(.+?)\s*$/.exec(line.trim())
    if (!m) continue
    const name = m[1].replace(/[（(].*$/, '').trim()
    if (name && name.length <= 12 && !/人物|角色|设定|目录|一览|关系/.test(name)) names.push(name)
  }
  return [...new Set(names)]
}

/**
 * 当前稿件的章节上下文。
 * @param {string} projectDir 作品目录（规范路径）
 * @param {string} filePath 正在写的稿件绝对路径（可为空：退化成"最新一章"）
 * @param {{ text?: string }} [opts] 传 text 就用内存里的正文（未保存的改动也算），否则读盘
 * @returns {object|null} null = 作品里没有可用的章节结构
 */
export function chapterContext(projectDir, filePath, opts = {}) {
  if (!projectDir) return null
  let outline
  try {
    outline = outlineSummary(projectDir)
  } catch {
    return null
  }
  const rows = Array.isArray(outline?.rows) ? outline.rows : []
  if (!rows.length) return null

  const want = seriesKey(filePath)
  let idx = want ? rows.findIndex((r) => seriesKey(r.abs) === want) : -1
  if (idx < 0) idx = rows.length - 1 // 没有正在写的稿：按"最新一章"给上下文
  const row = rows[idx]

  const text = typeof opts.text === 'string' ? opts.text : (readTextOrNull(row.abs) || '')
  const label = String(row.name || '').replace(/-v\d+(\.[^.]+)$/i, '$1').replace(/\.[^.]+$/, '')
  // 大纲相关行：自己读 structure.md 并按"含本章标签/第N章"过滤**任意行**。
  // （outlineSummary.structure 只保留 `#` 标题行，真实作品里章节多写在列表项里，会漏。）
  const structureText = readTextOrNull(path.join(projectDir, 'outline', 'structure.md')) || ''
  const structure = structureText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && (l.includes(label) || l.includes(`第${idx + 1}章`)))
    .slice(0, 3)

  // 章末钩子自己从正文里取（`章末钩子：xxx`），逐章读盘；取不到再用 outlineSummary 的结果。
  const hookOf = (r) => {
    if (!r) return ''
    const t = readTextOrNull(r.abs) || ''
    const m = /章末钩子[:：]\s*(.+)$/m.exec(t)
    return m ? m[1].trim().slice(0, 80) : ''
  }

  // 伏笔计数自己数（只认"未兑现/未回收"），不依赖别的模块的字段名，避免口径漂移。
  const foreshadowText = readTextOrNull(path.join(projectDir, 'outline', 'foreshadow.md'))
  const foreshadowOpen = foreshadowText
    ? foreshadowText.split(/\r?\n/).filter((l) => /未兑现|未回收/.test(l)).length
    : null

  const present = characterNames(projectDir).filter((n) => text.includes(n)).slice(0, 8)
  const hook = hookOf(row) || row.hook || ''

  const bits = [`第 ${idx + 1}/${rows.length} 章「${label}」`]
  if (rows[idx - 1]) bits.push(`上一章：${String(rows[idx - 1].name).replace(/\.[^.]+$/, '')}`)
  if (rows[idx + 1]) bits.push(`下一章：${String(rows[idx + 1].name).replace(/\.[^.]+$/, '')}`)
  if (hook) bits.push(`本章钩子：${hook}`)
  if (foreshadowOpen) bits.push(`未兑现伏笔 ${foreshadowOpen} 条`)
  if (present.length) bits.push(`本章在场：${present.join('、')}`)
  if (row.gate && row.gate.pass === false) bits.push(`成稿检查 ${row.gate.fail} 项未达标`)

  return {
    project: projectDir,
    file: row.abs,
    index: idx + 1,
    total: rows.length,
    label,
    chars: row.chars,
    prev: rows[idx - 1] ? { name: rows[idx - 1].name, hook: hookOf(rows[idx - 1]) } : null,
    next: rows[idx + 1] ? { name: rows[idx + 1].name, hook: hookOf(rows[idx + 1]) } : null,
    hook,
    structure,
    foreshadowOpen,
    characters: present,
    gate: row.gate || null,
    summary: bits.join('；'),
  }
}

/**
 * 把章节上下文并进"写作模式状态块"的行（客户端已有状态块，这里只补几行）。
 * @returns {string[]} 0~4 行，调用方可直接追加
 */
export function chapterContextLines(ctx) {
  if (!ctx) return []
  const lines = [`- 章节定位：${ctx.summary}`]
  if (ctx.structure.length) lines.push(`- 大纲相关：${ctx.structure.map((s) => s.replace(/^[#\s\-*+>]+/, '')).join(' / ')}`)
  if (ctx.prev?.hook) lines.push(`- 上一章钩子：${ctx.prev.hook}`)
  return lines
}
