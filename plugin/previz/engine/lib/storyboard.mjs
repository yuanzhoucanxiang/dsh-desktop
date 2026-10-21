/**
 * storyboard.csv → shots.json。
 *
 * 契约见 docs/策划案-v1.md §6.10：
 *   panel,scene,shot,beat,duration,size,angle,lens_mm,move,subject,action,dialogue,transition,image,notes
 *
 * 原则：
 * - 一行 → 一个 shot；in/out 按累计时长；
 * - 缺失字段用默认值，并记 `assumptions`（不静默编造）；
 * - 只写 shots.json，不碰 set/blocking（那需要人确认）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { ScreenwriterError } from './errors.mjs'

const DEFAULT_SIZE = 'MS'
const DEFAULT_ANGLE = 'eye'
const DEFAULT_LENS = 35
const DEFAULT_MOVE = 'static'
const DEFAULT_TRANSITION = 'cut'
const REQUIRED = ['panel', 'scene', 'shot', 'duration', 'subject']

/** RFC 4180：双引号包裹、`""` 转义、字段内可含逗号/换行。 */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const src = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (quoted) throw new ScreenwriterError('CSV 引号未闭合（RFC 4180）')
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''))
}

function num(v) {
  const s = String(v ?? '').trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

export function parseStoryboard(text, { fps = 24 } = {}) {
  const rows = parseCsv(text)
  if (rows.length < 2) throw new ScreenwriterError('CSV 至少需要表头 + 一行分镜')
  const header = rows[0].map((h) => h.trim())
  const errors = []
  for (const key of REQUIRED) {
    if (!header.includes(key)) errors.push({ path: `header.${key}`, message: `缺少必填列 ${key}` })
  }
  if (errors.length) return { ok: false, errors, shots: null, assumptions: [] }

  const assumptions = []
  const shots = []
  const takes = []
  let cursor = 0
  const scene = String(rows[1][header.indexOf('scene')] ?? '').trim()
  for (let r = 1; r < rows.length; r++) {
    const get = (name) => {
      const i = header.indexOf(name)
      return i >= 0 ? String(rows[r][i] ?? '').trim() : ''
    }
    const panel = get('panel')
    const line = `row[${r + 1}]`
    const duration = num(get('duration'))
    if (!Number.isFinite(duration) || duration <= 0) {
      errors.push({ path: `${line}.duration`, message: `duration 必须是正数（收到 ${JSON.stringify(get('duration'))}）` })
      continue
    }
    const shot = get('shot')
    if (!shot) {
      errors.push({ path: `${line}.shot`, message: 'shot 不能为空' })
      continue
    }
    const subjects = get('subject').split('+').map((s) => s.trim()).filter(Boolean)
    if (subjects.length === 0) {
      errors.push({ path: `${line}.subject`, message: 'subject 不能为空（多个用 +）' })
      continue
    }
    const out = Math.round((cursor + duration) * 1000) / 1000
    const size = get('size')
    if (!size) assumptions.push(`${shot}: size 缺省 ${DEFAULT_SIZE}`)
    const angle = get('angle')
    if (!angle) assumptions.push(`${shot}: angle 缺省 ${DEFAULT_ANGLE}`)
    const lens = num(get('lens_mm'))
    if (lens === null) assumptions.push(`${shot}: lens_mm 缺省 ${DEFAULT_LENS}`)
    else if (!Number.isFinite(lens)) errors.push({ path: `${line}.lens_mm`, message: 'lens_mm 必须是数字' })
    const move = get('move')
    if (!move) assumptions.push(`${shot}: move 缺省 ${DEFAULT_MOVE}`)
    const transition = get('transition')
    if (!transition) assumptions.push(`${shot}: transition 缺省 ${DEFAULT_TRANSITION}`)
    if (!get('beat')) assumptions.push(`${shot}: beat 缺省按累计时间推断（未填）`)

    const notes = get('notes')
    const camera = { mode: 'solve', azimuth_deg: 0, height: 1.5, target: 'subject_center' }
    // notes 里的 key=value 作为生成器/人工覆盖：azimuth_deg=..., height=...
    for (const m of notes.matchAll(/([a-z_]+)=(-?\d+(?:\.\d+)?)/g)) {
      if (m[1] === 'azimuth_deg' || m[1] === 'height') camera[m[1]] = Number(m[2])
    }
    shots.push({
      id: shot,
      panel: Number(panel) || shots.length + 1,
      beat: get('beat') || undefined,
      in: cursor,
      out,
      duration,
      subjects,
      size: size || DEFAULT_SIZE,
      angle: angle || DEFAULT_ANGLE,
      lens_mm: Number.isFinite(lens) && lens !== null ? lens : DEFAULT_LENS,
      camera,
      framing: { fill: size === 'INSERT' ? 0.6 : 0.7, headroom: size === 'INSERT' ? 0 : 0.07, look_room: 0.12 },
      move: { type: move || DEFAULT_MOVE },
      transition: transition || DEFAULT_TRANSITION,
      source: { action: get('action'), dialogue: get('dialogue'), image: get('image') || null, notes: notes || null },
    })
    takes.push({ panel, shot, duration })
    cursor = out
  }
  if (errors.length) return { ok: false, errors, shots: null, assumptions }
  const result = {
    schema: 'dsh.previz/shots@1',
    scene,
    shots: shots.map(({ duration: _d, panel: _p, source: _s, ...s }) => s),
    source: { format: 'storyboard.csv', imported_at: new Date().toISOString(), panels: takes },
  }
  return { ok: true, errors: [], shots: result, assumptions, fps }
}

export function importStoryboard(file, { outFile, fps = 24, log = console.log } = {}) {
  const src = path.resolve(file)
  if (!fs.existsSync(src)) throw new ScreenwriterError(`找不到 ${src}`)
  const parsed = parseStoryboard(fs.readFileSync(src, 'utf8'), { fps })
  if (!parsed.ok) {
    const err = new ScreenwriterError(`storyboard.csv 校验失败（${parsed.errors.length} 个错误）`)
    err.errors = parsed.errors
    throw err
  }
  const target = path.resolve(outFile || path.join(path.dirname(src), 'shots.json'))
  fs.writeFileSync(target, JSON.stringify(parsed.shots, null, 2), 'utf8')
  log(`[previz] imported ${parsed.shots.shots.length} shots -> ${path.relative(process.cwd(), target)}`)
  for (const a of parsed.assumptions) log(`[previz] assumption: ${a}`)
  return { outFile: target, shots: parsed.shots, assumptions: parsed.assumptions }
}
