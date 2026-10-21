/**
 * 剧本文本 -> script.json -> storyboard.csv（P2 输入侧）。
 *
 * 不是 Fountain 全实现：只覆盖白模预演需要的「场景头 / 动作段 / 对白」。
 * 设计原则与 CSV 导入一致：缺省给默认值并记 assumption，不静默编造演员。
 */
import fs from 'node:fs'
import path from 'node:path'
import { ScreenwriterError } from './errors.mjs'

const SCENE_RE = /^(INT|EXT|INT\.\/EXT|EXT\.\/INT)[.\s]+(.+?)(?:\s+-\s+(.+))?$/i
const DIALOGUE_RE = /^([A-Za-z\u4e00-\u9fa5][\w\u4e00-\u9fa5 .·]{0,15})[：:]\s*(.+)$/
const TIME_MAP = {
  黄昏: 'dusk',
  傍晚: 'dusk',
  夜: 'night',
  夜晚: 'night',
  日: 'day',
  白天: 'day',
  晨: 'morning',
  清晨: 'morning',
}

function slugTime(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  return TIME_MAP[s] || s.toLowerCase()
}

export function parseAliases(text = '') {
  const map = {}
  for (const part of String(text).split(/[,;]/)) {
    const m = /^([^=:]+)[=:](.+)$/.exec(part.trim())
    if (m) map[m[1].trim()] = m[2].trim()
  }
  return map
}

function resolveActor(name, aliases, characters) {
  const n = String(name || '').trim()
  if (!n) return null
  const id = aliases[n] || aliases[n.toUpperCase()] || n
  characters.add(id)
  return id
}

/** 解析纯文本剧本；返回 {script, warnings, characters}。 */
export function parseScript(text, { title = null, beatSeconds = 3.0, aliases = {}, sceneId = null } = {}) {
  const lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  const warnings = []
  const characters = new Set()
  let docTitle = title
  let scene = null
  let beat = null
  let cursor = 0
  const scenes = []

  const flushBeat = () => {
    if (!beat) return
    if (!beat.summary && beat.dialogue.length) {
      beat.summary = beat.dialogue.map((d) => `${d.who}：${d.text}`).join('；')
    }
    if (beat.summary || beat.dialogue.length) {
      beat.range = [cursor, cursor + beat.duration]
      cursor = beat.range[1]
      scene.beats.push(beat)
    }
    beat = null
  }
  const flushScene = () => {
    flushBeat()
    if (scene) scenes.push(scene)
    scene = null
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (/^#{1,3}\s+/.test(line) && !/^(INT|EXT)[.\s]/i.test(line)) {
      const h = line.replace(/^#{1,3}\s+/, '').trim()
      if (!docTitle) docTitle = h
      continue
    }
    const heading = SCENE_RE.exec(line)
    if (heading) {
      flushScene()
      const idx = scenes.length + 1
      scene = {
        id: sceneId ? String(sceneId) : `S${String(idx).padStart(2, '0')}`,
        heading: line,
        location: String(heading[2] || '').trim(),
        time_of_day: slugTime(heading[3]),
        beats: [],
      }
      continue
    }
    // 场景头之前的内容：当作标题/忽略
    if (!scene) {
      if (!docTitle) docTitle = line
      else warnings.push(`场景头之前的内容已忽略：${line.slice(0, 40)}`)
      continue
    }
    const dialogue = DIALOGUE_RE.exec(line)
    if (dialogue) {
      const who = resolveActor(dialogue[1], aliases, characters)
      if (!beat) beat = { id: `B${scene.beats.length + 1}`, summary: '', actors: [], dialogue: [], duration: beatSeconds }
      if (!beat.actors.includes(who)) beat.actors.push(who)
      beat.dialogue.push({ who, text: dialogue[2].trim() })
      continue
    }
    if (/^[（(].*[)）]$/.test(line)) {
      if (beat) beat.dialogue.push({ who: null, text: line })
      continue
    }
    // 新动作段：如果当前 beat 已经有对白，就切；否则把连续动作并进同一 beat。
    if (beat && beat.dialogue.length) flushBeat()
    if (!beat) beat = { id: `B${scene.beats.length + 1}`, summary: '', actors: [], dialogue: [], duration: beatSeconds }
    if (beat.summary) beat.summary += ` ${line}`
    else beat.summary = line
    // 动作里提到角色（按 alias 匹配）也计入 actors
    for (const [alias, id] of Object.entries(aliases)) {
      if (line.includes(alias) && !beat.actors.includes(id)) {
        beat.actors.push(id)
        characters.add(id)
      }
    }
  }
  flushScene()

  if (!scenes.length) throw new ScreenwriterError('没有找到场景头（需要 INT. / EXT. 开头）')
  for (const s of scenes) {
    for (const b of s.beats) {
      if (!b.actors.length) {
        warnings.push(`${s.id}/${b.id} 没有识别到角色；请用 --alias 或对白行“角色：台词”`)
      }
    }
  }
  return {
    script: {
      schema: 'dsh.previz/script@1',
      title: docTitle || '未命名',
      scenes,
    },
    warnings,
    characters: [...characters],
  }
}

function csvCell(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** script.json -> storyboard.csv（一行一镜；景别/镜头/运镜用默认值）。 */
/**
 * 根据 blocking 里主体位置给一个“朝房间内”的机位方位角：
 * 取主体均值点，相机放在均值点背离场景中心的一侧，再朝主体看。
 */
function azimuthTowardSubjects(blocking, subjectIds) {
  if (!blocking?.actors) return 0
  const pts = subjectIds.map((id) => blocking.actors[id]?.keys?.[0]?.pos).filter(Boolean)
  if (!pts.length) return 0
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length
  const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length
  // 多人同框：相机要垂直于“主体连线”，否则两人横向铺开时侧边的人会出画。
  // 取连线方向 (dx, dy)，相机方向取其法线 (-dy, dx) 或 (dy, -dx)，选朝向场景中心的那侧。
  if (pts.length >= 2) {
    let lx = pts[1][0] - pts[0][0]
    let ly = pts[1][1] - pts[0][1]
    const len = Math.hypot(lx, ly)
    if (len > 1e-6) {
      lx /= len
      ly /= len
      // 法线两条，选让相机更靠近场景中心（0,0）的那条
      let nx = -ly
      let ny = lx
      const toCenter = (x, y) => Math.hypot(cx + x, cy + y)
      if (toCenter(-nx, -ny) < toCenter(nx, ny)) {
        nx = -nx
        ny = -ny
      }
      // direction = (sin az, -cos az) 应等于 (nx, ny)
      return Math.round((Math.atan2(nx, -ny) * 180) / Math.PI)
    }
  }
  // 单人：把相机放在场景中心一侧
  const dx = cx - 0
  const dy = cy - 0
  if (Math.hypot(dx, dy) < 1e-6) return 0
  return Math.round((Math.atan2(-dx, dy) * 180) / Math.PI)
}

export function storyboardFromScript(script, { size = null, angle = 'eye', lens = 35, move = 'static', fitDuration = null, blocking = null } = {}) {
  const rows = [
    ['panel', 'scene', 'shot', 'beat', 'duration', 'size', 'angle', 'lens_mm', 'move', 'subject', 'action', 'dialogue', 'transition', 'image', 'notes'],
  ]
  let panel = 0
  for (const scene of script.scenes) {
    const totalBeats = scene.beats.length || 1
    const perBeat = Number.isFinite(fitDuration) && fitDuration > 0 ? fitDuration / totalBeats : null
    scene.beats.forEach((beat, i) => {
      panel++
      if (!beat.actors || !beat.actors.length) {
        throw new ScreenwriterError(`${scene.id}/${beat.id} 没有角色，无法生成分镜表`)
      }
      const duration = perBeat ? perBeat : Number(beat.duration)
      const dialogue = (beat.dialogue || []).map((d) => (d.who ? `${d.who}：${d.text}` : d.text)).join('；')
      // 多人同框默认 TWO；OTS 需要明确的过肩关系，不由草案猜。
      const autoSize = beat.actors.length >= 2 ? 'TWO' : 'MS'
      rows.push([
        panel,
        scene.id,
        `${scene.id}-${String(i + 1).padStart(2, '0')}`,
        beat.id,
        duration.toFixed(2),
        size || autoSize,
        angle,
        lens,
        move,
        beat.actors.join('+'),
        beat.summary || '',
        dialogue,
        'cut',
        '',
        // 默认跟拍第一主角：static 相机在多秒走位里会把人甩出画。
        `azimuth_deg=${azimuthTowardSubjects(blocking, beat.actors)}; follow=${beat.actors[0]}`,
      ])
    })
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
}

export function parseScriptFile(file, opts = {}) {
  const src = path.resolve(file)
  if (!fs.existsSync(src)) throw new ScreenwriterError(`找不到 ${src}`)
  return parseScript(fs.readFileSync(src, 'utf8'), opts)
}

export function writeScript(file, { outFile, log = console.log, ...opts } = {}) {
  const { script, warnings, characters } = parseScriptFile(file, opts)
  const target = path.resolve(outFile || path.join(path.dirname(path.resolve(file)), 'script.json'))
  fs.writeFileSync(target, JSON.stringify(script, null, 2), 'utf8')
  log(`[previz] script -> ${path.relative(process.cwd(), target)}`)
  for (const w of warnings) log(`[previz] warning: ${w}`)
  return { outFile: target, script, warnings, characters }
}

export function writeStoryboard(file, { outFile, log = console.log, ...opts } = {}) {
  const { script, warnings, characters } = parseScriptFile(file, opts)
  const csv = storyboardFromScript(script, opts)
  const target = path.resolve(outFile || path.join(path.dirname(path.resolve(file)), 'storyboard.csv'))
  fs.writeFileSync(target, csv, 'utf8')
  log(`[previz] storyboard -> ${path.relative(process.cwd(), target)}`)
  for (const w of warnings) log(`[previz] warning: ${w}`)
  return { outFile: target, csv, script, warnings, characters }
}
