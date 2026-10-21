/**
 * 逐镜交接包（handoff）——确定性导出器。
 *
 * 职责边界（按 Codex 交接建议 v2 §5，方案 C）：
 *   本模块只做**事实骨架**：镜号、时窗、画幅、主体、运镜全定义、起终状态、检查状态、源指纹与过期标记。
 *   **不生成导演语义**（镜头目的、表演意图、视频提示词正文）——那些以显式 TODO 占位留给 Agent 填。
 *
 * 真相来源：shots.json / blocking.json / set.json / project.json 是真相；facts.json 只是构建测量。
 * 所以这里**读完整 shots.json**（facts 里的 move 只有类型字符串，不足以描述 path/feel/follow/response）。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { shotFingerprints } from './pipeline.mjs'
import { loadScenes } from './scenes.mjs'

export const HANDOFF_SCHEMA = 'dsh.previz/handoff@1'

const SEMANTIC_TODO = '<!-- TODO(agent): %s -->'

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function sha256File(file) {
  if (!fs.existsSync(file)) return null
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/** 源指纹：四个真相文件 + facts（如果有）。用于判断交接包是否过期。 */
export function sourceFingerprint(projectDir, outDir) {
  const p = path.resolve(projectDir)
  const o = path.resolve(outDir)
  return {
    project: sha256File(path.join(p, 'project.json')),
    set: sha256File(path.join(p, 'set.json')),
    blocking: sha256File(path.join(p, 'blocking.json')),
    shots: sha256File(path.join(p, 'shots.json')),
    facts: sha256File(path.join(o, 'facts.json')),
  }
}

/** 运镜的完整定义（不是只 type）。没写的字段也要能如实说"默认值"。 */
export function describeMove(move) {
  const m = move || { type: 'static' }
  const out = { type: m.type || 'static' }
  if (m.path) out.path = m.path
  if (m.ease) out.ease = m.ease
  for (const k of ['from', 'to', 'degrees', 'meters', 'dolly', 'hz', 'seed', 'roll_degrees', 'stride_hz', 'follow_speed']) {
    if (m[k] !== undefined) out[k] = m[k]
  }
  if (m.feel) out.feel = typeof m.feel === 'string' ? { type: m.feel } : { ...m.feel }
  return out
}

/** 操作响应参数（位置/瞄准分离的滞后与限速）。 */
export function describeResponse(camera) {
  const r = (camera || {}).response
  if (!r) return null
  return { ...r }
}

/** 跟拍配置。 */
export function describeFollow(camera) {
  const f = (camera || {}).follow
  return f ? { ...f } : null
}

/** 从 facts 里取某镜的测量（可能不存在）。 */
export function factsFor(facts, shotId) {
  if (!facts || !Array.isArray(facts.shots)) return null
  return facts.shots.find((s) => s.id === shotId) || null
}

/** 首/尾状态：位置、朝向、是否可见、脚部接触。从 facts 抽，缺失就标缺。 */
export function edgeState(shotFacts, tag) {
  if (!shotFacts || !shotFacts[tag]) return { available: false, reason: 'facts 缺少该时刻采样' }
  const node = shotFacts[tag]
  const subjects = {}
  for (const [k, v] of Object.entries(node)) {
    if (k === 'frame') continue
    subjects[k] = v
  }
  const occ = (shotFacts.occlusion || []).filter((o) => o.tag === tag).map((o) => ({
    subject: o.subject,
    visible: o.visible,
    blocker: o.blocker,
    blocker_kind: o.blocker_kind,
    allowed: o.allowed,
  }))
  const feet = (shotFacts.feet || []).filter((f) => f.tag === tag).map((f) => ({
    subject: f.subject,
    min_z: f.min_z,
    pitch_deg: f.pitch_deg,
  }))
  return { available: true, frame: node.frame, subjects, occlusion: occ, feet }
}

/** 媒体引用：只报真实存在的文件，不写不存在的路径。 */
export function mediaFor(outDir, scene, shotId) {
  const dir = path.join(path.resolve(outDir), scene, shotId)
  const candidates = {
    first: path.join(dir, 'first.png'),
    mid: path.join(dir, 'mid.png'),
    last: path.join(dir, 'last.png'),
    video: path.join(dir, `${shotId}.mp4`),
    review_dir: path.join(dir, 'review'),
  }
  const out = {}
  for (const [k, p] of Object.entries(candidates)) {
    if (fs.existsSync(p)) out[k] = path.relative(path.resolve(outDir), p).split(path.sep).join('/')
  }
  if (out.review_dir && fs.statSync(candidates.review_dir).isDirectory()) {
    const frames = fs.readdirSync(candidates.review_dir).filter((f) => /^f_\d+\.png$/.test(f))
    out.review_frames = frames.length
    if (!frames.length) delete out.review_dir
  } else {
    delete out.review_dir
  }
  return out
}

/** 单镜事实骨架。 */
export function buildShotEntry({ project, set, blocking, shots, facts, outDir, shot, scene }) {
  const measured = factsFor(facts, shot.id)
  const actorIds = Object.keys(blocking.actors || {})
  const props = (blocking.props || []).filter((p) => (shot.subjects || []).includes(p.id))
  const moves = (blocking.moves || []).filter((m) => (shot.subjects || []).includes(m.actor))

  return {
    scene: scene || shots.scene || 'S01',
    id: shot.id,
    beat: shot.beat ?? null,
    // 时间：同时保留场景时间窗与镜头内时长
    timing: {
      scene_window_s: [shot.in, shot.out],
      duration_s: Number((shot.out - shot.in).toFixed(3)),
      frames: measured ? measured.frames : null,
      fps: project.fps || 24,
    },
    frame: { aspect: project.aspect || '16:9', size: shot.size, lens_mm: shot.lens_mm },
    subjects: shot.subjects || [],
    framing: shot.framing || null,
    // 运镜全定义（不是只 type）
    move: describeMove(shot.move),
    follow: describeFollow(shot.camera),
    response: describeResponse(shot.camera),
    // 世界侧可用对象（供 Agent 写"画面左侧的人"时参考）
    blocking: {
      actors: actorIds.filter((a) => (shot.subjects || []).includes(a)),
      props: props.map((p) => ({ id: p.id, attach: p.attach || null, from: p.from, to: p.to })),
      moves: moves.map((m) => ({ actor: m.actor, from: m.from, to: m.to, path: m.path || null })),
    },
    // 首/尾状态
    start: edgeState(measured, 'start'),
    end: edgeState(measured, 'end'),
    // 检查结果（原样搬运，不重新判定）
    checks: measured
      ? {
          fill_actual: measured.frame_span?.fill_actual ?? null,
          fill_target: measured.fill_target ?? null,
          screen: measured.screen || null,
          axis: measured.axis || null,
          occlusion_blocked: (measured.occlusion || []).filter((o) => o.visible === false && !o.allowed).length,
        }
      : null,
    media: mediaFor(outDir, scene || shots.scene || 'S01', shot.id),
    // 语义字段：这里是方案 C 的边界——只留占位，不猜
    semantic: {
      purpose: null,
      performance: null,
      video_prompt: null,
      keyframe_prompt: null,
      status: 'pending',
    },
  }
}

function fmt(v) {
  if (v === null || v === undefined) return '—'
  if (Array.isArray(v)) return `[${v.map((x) => (typeof x === 'number' ? Number(x.toFixed(3)) : x)).join(', ')}]`
  if (typeof v === 'number') return Number(v.toFixed(3))
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** 单镜 handoff.md 正文。事实填满，语义留 TODO。 */
export function renderShotMarkdown(entry, { projectTitle } = {}) {
  const L = []
  L.push(`# ${entry.scene} / ${entry.id}`)
  L.push('')
  L.push(`> 由确定性导出器生成（事实骨架）。带 <TODO(agent)> 的段落需要 Agent 补充，未补即视为**未完成**。`)
  L.push('')
  L.push('## 来源与状态')
  L.push('')
  L.push(`- 项目：${fmt(projectTitle)}`)
  L.push(`- 镜头内时长 / fps / 帧数 / 画幅：${entry.timing.duration_s}s / ${entry.timing.fps} / ${entry.timing.frames ?? '—'} / ${entry.frame.aspect}`)
  L.push(`- 场景时间窗：${entry.timing.scene_window_s[0]}s → ${entry.timing.scene_window_s[1]}s`)
  L.push(`- 景别 / 焦距：${entry.frame.size} / ${entry.frame.lens_mm}mm`)
  L.push(`- 预演 QC：${entry.checks ? (entry.checks.occlusion_blocked > 0 ? '未通过（遮挡）' : '见 qc_report.json') : '未运行'}`)
  L.push(`- 提示词核对：${entry.semantic.status}`)
  L.push(`- 视觉核对：未查看`)
  L.push(`- 目标后端与通路：未指定`)
  L.push(`- 实际生成验证：未运行`)
  L.push(`- 用户选用：未确认`)
  L.push('')
  L.push('## 参考与职责')
  L.push('')
  const m = entry.media
  const files = Object.entries(m).filter(([k]) => k !== 'review_frames')
  if (files.length) {
    for (const [k, v] of files) L.push(`- ${k}：\`${v}\``)
  } else {
    L.push('- （没有找到本镜媒体文件；请先跑 render）')
  }
  L.push(`- 负责内容：${SEMANTIC_TODO.replace('%s', '本镜各媒体的用途（构图/动作/运镜/外观）')}`)
  L.push(`- 禁止继承内容：${SEMANTIC_TODO.replace('%s', '哪些不应被视频模型继承（如代理配色、描边）')}`)
  L.push('')
  L.push('## 本镜内容')
  L.push('')
  L.push(`- 主体：${entry.subjects.join(', ') || '—'}`)
  L.push(`- 运镜：${fmt(entry.move)}`)
  if (entry.move.feel) L.push(`- 质感层（谁端机）：${fmt(entry.move.feel)}`)
  if (entry.follow) L.push(`- 跟拍：${fmt(entry.follow)}`)
  if (entry.response) L.push(`- 操作响应：${fmt(entry.response)}`)
  L.push(`- 镜头目的：${SEMANTIC_TODO.replace('%s', '一句话说明这个镜头要传达什么')}`)
  L.push(`- 动作阶段与时间：${SEMANTIC_TODO.replace('%s', '按秒分段描述动作顺序')}`)
  L.push('')
  L.push('### 起始状态')
  L.push('')
  if (entry.start.available) {
    L.push(`- 帧 ${entry.start.frame}`)
    for (const [sid, v] of Object.entries(entry.start.subjects)) {
      L.push(`  - ${sid}：head ${fmt(v.head)}，feet ${fmt(v.feet)}`)
    }
    if (entry.start.feet.length) L.push(`- 脚部：${entry.start.feet.map((f) => `${f.subject} min_z=${fmt(f.min_z)} pitch=${fmt(f.pitch_deg)}°`).join('；')}`)
    if (entry.start.occlusion.length) {
      L.push(`- 可见性：${entry.start.occlusion.map((o) => `${o.subject} ${o.visible ? '可见' : `被 ${o.blocker} 挡`}`).join('；')}`)
    }
  } else {
    L.push(`- 缺少测量：${entry.start.reason}`)
  }
  L.push('')
  L.push('### 结束状态')
  L.push('')
  if (entry.end.available) {
    L.push(`- 帧 ${entry.end.frame}`)
    for (const [sid, v] of Object.entries(entry.end.subjects)) {
      L.push(`  - ${sid}：head ${fmt(v.head)}，feet ${fmt(v.feet)}`)
    }
    if (entry.end.feet.length) L.push(`- 脚部：${entry.end.feet.map((f) => `${f.subject} min_z=${fmt(f.min_z)} pitch=${fmt(f.pitch_deg)}°`).join('；')}`)
  } else {
    L.push(`- 缺少测量：${entry.end.reason}`)
  }
  L.push(`- 与下一镜接口：${SEMANTIC_TODO.replace('%s', '本镜结束状态如何接上下一镜（或说明有意省略）')}`)
  L.push('')
  L.push('## 表达边界')
  L.push('')
  L.push(`- 预演已表达：见上方「起始状态 / 结束状态」与媒体引用（这些是真实测量与真实文件）`)
  L.push(`- 仅文字补充：${SEMANTIC_TODO.replace('%s', '预演没演出来、只能靠文字说的内容')}`)
  L.push(`- 待补、冲突与临时决定：${SEMANTIC_TODO.replace('%s', '缺少的资产/设计/后端能力')}`)
  L.push('')
  L.push('## 视频提示词')
  L.push('')
  L.push('> 方案 C：正文由 Agent 依据上方事实撰写；导出器不代写。')
  L.push('')
  L.push(SEMANTIC_TODO.replace('%s', '写本镜视频提示词（主体动作、相机路径与质感、结束状态）'))
  L.push('')
  L.push('## 关键帧提示词（按需）')
  L.push('')
  L.push(SEMANTIC_TODO.replace('%s', '需要外观转换时写；已有对齐画面则直接引用'))
  L.push('')
  L.push('## 回验要点')
  L.push('')
  const checks = []
  if (entry.checks) {
    if (entry.checks.screen && entry.checks.screen.direction) {
      checks.push(`屏幕方向 ${entry.checks.screen.direction}（${entry.checks.screen.ok ? '成立' : '不成立'}）`)
    }
    if (entry.checks.axis) checks.push(`轴线 ${entry.checks.axis.expected || '未声明'}（${entry.checks.axis.ok ? '成立' : '越轴'}）`)
    checks.push(`占幅 ${fmt(entry.checks.fill_actual)} / 目标 ${fmt(entry.checks.fill_target)}`)
    checks.push(`遮挡阻断 ${entry.checks.occlusion_blocked} 次`)
  }
  L.push(checks.length ? `- 已有测量：${checks.join('；')}` : '- 没有测量数据（只跑了 build/plan）')
  L.push(`- 需人工/Agent 补：${SEMANTIC_TODO.replace('%s', '本镜最重要的动作、接触、身份检查点')}`)
  L.push('')
  return L.join('\n')
}

/** 总体索引 index.md。 */
export function renderIndexMarkdown(manifest) {
  const L = []
  L.push(`# 逐镜交接包 · ${manifest.project.title}`)
  L.push('')
  L.push(`> schema \`${manifest.schema}\` · 生成于 ${manifest.generated_at}`)
  L.push('> 这是**事实骨架**：语义提示词由 Agent 按方案 C 补写。未补的镜头 `semantic: pending`。')
  L.push('')
  L.push('## 总览')
  L.push('')
  L.push(`- 场景数：${manifest.scenes.length}`)
  L.push(`- 镜头数：${manifest.shots.length}`)
  L.push(`- 有测量（facts）的镜头：${manifest.shots.filter((s) => s.facts_available).length} / ${manifest.shots.length}`)
  L.push(`- 提示词已完成：${manifest.shots.filter((s) => s.semantic_status !== 'pending').length} / ${manifest.shots.length}`)
  L.push('')
  L.push('## 镜头清单')
  L.push('')
  L.push('| 场景 | 镜号 | 时长 | 景别 | 运镜 | 质感 | facts | 提示词 | 文件 |')
  L.push('|---|---|---|---|---|---|---|---|---|')
  for (const s of manifest.shots) {
    L.push(
      `| ${s.scene} | ${s.id} | ${s.duration_s}s | ${s.size} | ${s.move_type} | ${s.feel_type || '—'} | ${s.facts_available ? '✓' : '缺'} | ${s.semantic_status} | [handoff.md](${s.handoff_path}) |`,
    )
  }
  L.push('')
  if (manifest.pending.length) {
    L.push('## 总体待补')
    L.push('')
    for (const p of manifest.pending) L.push(`- ${p}`)
    L.push('')
  }
  L.push('## 状态口径')
  L.push('')
  L.push('- `facts: 缺` 表示没跑过构建/渲染，起终状态与检查项不可用。')
  L.push('- `semantic: pending` 表示提示词正文尚未由 Agent 补写；此时**不得**当作可提交方案。')
  L.push('- 过期判定见 `manifest.json` 的 `sources`；源文件变了但没重新导出的，下次导出会标 stale。')
  L.push('')
  return L.join('\n')
}

/**
 * 导出整个项目的逐镜交接包。
 * 支持单场景（根目录三 JSON）与多场景（scenes.json + scenes/<id>/），复用 lib/scenes.mjs。
 * 不复制 shots.json 的内容到 manifest（避免成为第二套真相），只记指纹与状态。
 */
export function exportHandoff({ projectDir, outDir, log = console.log } = {}) {
  const p = path.resolve(projectDir)
  const o = path.resolve(outDir)
  const project = readJson(path.join(p, 'project.json'))

  const handoffDir = path.join(o, 'handoff')
  fs.mkdirSync(handoffDir, { recursive: true })

  // 多场景与单场景统一走 loadScenes（单场景会返回一个 legacy 元素）
  let sceneDirs
  try {
    sceneDirs = loadScenes(p)
  } catch (err) {
    throw new Error(`无法加载场景：${err.message}`)
  }

  const entries = []
  const manifestShots = []
  const missingFacts = []

  for (const sceneInfo of sceneDirs) {
    const dir = sceneInfo.dir
    const set = readJson(path.join(dir, 'set.json'))
    const blocking = readJson(path.join(dir, 'blocking.json'))
    const shots = readJson(path.join(dir, 'shots.json'))
    const scene = sceneInfo.id || shots.scene || 'S01'

    // facts 与媒体都在 <out>/<scene>/ 下
    const factsPath = path.join(o, scene, 'facts.json')
    const facts = fs.existsSync(factsPath) ? readJson(factsPath) : null
    if (!facts) missingFacts.push(scene)

    let fingerprints = {}
    try {
      fingerprints = shotFingerprints(dir)
    } catch {
      fingerprints = {}
    }

    for (const shot of shots.shots || []) {
      const entry = buildShotEntry({ project, set, blocking, shots, facts, outDir: path.join(o, scene), shot, scene })
      // mediaFor 收到的是 <out>/<scene>，所以返回的路径已带 scene 前缀
      entry.media = mediaFor(o, scene, shot.id)
      entries.push(entry)
      const shotDir = path.join(handoffDir, scene, shot.id)
      fs.mkdirSync(shotDir, { recursive: true })
      fs.writeFileSync(path.join(shotDir, 'handoff.md'), renderShotMarkdown(entry, { projectTitle: project.title }), 'utf8')
      manifestShots.push({
        scene,
        id: shot.id,
        in: shot.in,
        out: shot.out,
        duration_s: entry.timing.duration_s,
        size: shot.size,
        move_type: entry.move.type,
        feel_type: entry.move.feel ? entry.move.feel.type || entry.move.feel.preset || null : null,
        facts_available: entry.checks !== null,
        semantic_status: entry.semantic.status,
        shot_fingerprint: fingerprints[shot.id] || null,
        handoff_path: `${scene}/${shot.id}/handoff.md`,
        media: entry.media,
      })
    }
  }

  const pending = []
  for (const sc of missingFacts) {
    pending.push(`${sc}：没有 facts.json，起终状态/遮挡/脚部/屏幕方向不可用（先跑 build/render）`)
  }
  for (const s of manifestShots) {
    const missing = []
    if (!s.facts_available) missing.push('facts')
    if (!s.media.video) missing.push('逐镜视频')
    if (!s.media.first) missing.push('首帧')
    if (!s.media.last) missing.push('尾帧')
    if (missing.length) pending.push(`${s.scene}/${s.id}：缺少 ${missing.join(' / ')}`)
  }
  pending.push('所有镜头的语义提示词正文待 Agent 补写（方案 C）')
  if (!project.title) pending.push('项目缺少 title')

  const sources = sourceFingerprint(p, o)
  const manifest = {
    schema: HANDOFF_SCHEMA,
    generated_at: new Date().toISOString(),
    project: { id: project.id, title: project.title, fps: project.fps || 24, aspect: project.aspect || '16:9' },
    // 不复制场景真相，只记来源指纹
    sources,
    shots: manifestShots,
    scenes: [...new Set(manifestShots.map((s) => s.scene))],
    multi_scene: sceneDirs.length > 1,
    pending,
  }

  fs.writeFileSync(path.join(handoffDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  fs.writeFileSync(path.join(handoffDir, 'index.md'), renderIndexMarkdown(manifest), 'utf8')

  log(
    `[previz] handoff -> ${path.relative(process.cwd(), handoffDir)}（${manifestShots.length} 镜 / ${manifest.scenes.length} 场景${manifest.multi_scene ? '，多场景' : ''}）`,
  )
  return { ok: true, dir: handoffDir, manifest, entries }
}

/**
 * 过期检查：比对当前源指纹与 manifest 里记录的是否一致。
 * 返回每个镜头是否 stale，以及整体结论。
 */
export function checkStale({ projectDir, outDir }) {
  const p = path.resolve(projectDir)
  const o = path.resolve(outDir)
  const manifestPath = path.join(o, 'handoff', 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    return { exists: false, reason: '没有 handoff/manifest.json（先跑 previz handoff）' }
  }
  const manifest = readJson(manifestPath)
  const now = sourceFingerprint(p, o)
  const changed = []
  for (const k of Object.keys(now)) {
    if ((manifest.sources || {})[k] !== now[k]) changed.push(k)
  }
  return { exists: true, stale: changed.length > 0, changed, manifest }
}
