/**
 * 预演引擎的共享 pipeline —— CLI / Node API / 工作台 host 都走这一份，避免三套逻辑。
 *
 * 直接调用示例：
 *   import { runDemo, runBlender, encodeOutputs, runQcReport, probeEnvironment } from './lib/pipeline.mjs'
 *   await runDemo({ projectDir, outDir })
 *
 * 不依赖 Electron / 工作台；只依赖 Blender、ffmpeg 与本地文件。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validateAll } from './validate.mjs'
import { runQc } from './qc.mjs'
import { exportTimeline } from './export.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PACKAGE_ROOT = path.dirname(__dirname)
export const BUILDER = path.join(PACKAGE_ROOT, 'blender', 'previz_build.py')
export const CACHE_FILE = '.previz-cache.json'

/** 输入 JSON + builder 的 SHA-256；任何一方变了就缓存失效。 */
export function projectFingerprint(projectDir, extra = '') {
  const h = crypto.createHash('sha256')
  for (const name of ['project.json', 'set.json', 'blocking.json', 'shots.json']) {
    h.update(name)
    h.update(fs.readFileSync(path.join(projectDir, name)))
  }
  h.update(fs.readFileSync(BUILDER))
  // QC/校验器变了也要重跑，否则“改了检查但命中旧缓存”会假装通过。
  for (const rel of ['lib/qc.mjs', 'lib/validate.mjs']) h.update(fs.readFileSync(path.join(PACKAGE_ROOT, rel)))
  h.update(String(extra))
  return h.digest('hex')
}

/** 缓存命中前确认全套产物都在；缺帧/缺静帧一律当 miss，交给 QC 前先重跑。 */
function outputsComplete(outDir) {
  try {
    const facts = JSON.parse(fs.readFileSync(path.join(outDir, 'facts.json'), 'utf8'))
    if (!fs.existsSync(path.join(outDir, 'animatic.mp4'))) return false
    const scene = facts.scene || 'S03'
    for (const shot of facts.shots || []) {
      const review = path.join(outDir, scene, shot.id, 'review')
      const pngs = fs.existsSync(review) ? fs.readdirSync(review).filter((f) => /^f_\d+\.png$/.test(f)) : []
      if (pngs.length !== shot.frames) return false
      for (const name of ['first.png', 'mid.png', 'last.png']) {
        if (!fs.existsSync(path.join(outDir, scene, shot.id, name))) return false
      }
    }
    return true
  } catch {
    return false
  }
}

/**
 * 逐镜指纹：只把这一镜“能看到/受影响”的输入算进去——
 * 镜头定义、它引用的演员 keys/moves、相关的 props、set、builder。
 * 其它镜头的改动不影响本镜，从而可以只重渲脏镜。
 */
export function shotFingerprints(projectDir) {
  const read = (n) => JSON.parse(fs.readFileSync(path.join(projectDir, n), 'utf8'))
  const set = read('set.json')
  const blocking = read('blocking.json')
  const shots = read('shots.json')
  // 全局摄影设置也进指纹：改 fps/sensor/aspect 会改变所有镜头的画面
  let project = {}
  try {
    project = read('project.json')
  } catch {
    project = {}
  }
  const builderHash = crypto.createHash('sha256').update(fs.readFileSync(BUILDER)).digest('hex')
  const shared = {
    set,
    duration: blocking.duration,
    builder: builderHash,
    camera_globals: {
      fps: project.fps,
      defaults: project.defaults,
      resolution: project.resolution,
      aspect: project.aspect,
    },
  }
  const out = {}
  for (const shot of shots.shots || []) {
    const h = crypto.createHash('sha256')
    h.update(JSON.stringify(shared))
    h.update(JSON.stringify(shot))

    // 参与本镜的人物集合：声明主体 + 手持道具的所有者 + 该道具的 attach 演员。
    // 之前只收 shot.subjects，导致“演员手持道具、主体写的是道具”时，演员走位改了镜头不失效。
    const owners = new Set()
    const relatedProps = []
    for (const p of blocking.props || []) {
      const isSubject = (shot.subjects || []).includes(p.id)
      const owner = p.attach?.actor
      if (!isSubject && !owner) continue
      relatedProps.push(p)
      if (owner) owners.add(owner)
    }
    for (const id of shot.subjects || []) {
      if (blocking.actors?.[id]) owners.add(id)
    }
    // 主体是道具、但道具挂在某人手上：该演员的走位/姿态必须进指纹
    const actors = {}
    for (const id of owners) {
      if (blocking.actors?.[id]) actors[id] = blocking.actors[id]
    }
    h.update(JSON.stringify([...owners].sort()))
    h.update(JSON.stringify(actors))
    h.update(JSON.stringify((blocking.moves || []).filter((m) => owners.has(m.actor))))
    h.update(JSON.stringify(relatedProps))
    out[shot.id] = h.digest('hex')
  }
  return out
}

function readShotCache(outDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(outDir, '.previz-shots.json'), 'utf8'))
  } catch {
    return {}
  }
}

function shotOutputsComplete(outDir, facts, shotId) {
  try {
    const shot = (facts.shots || []).find((s) => s.id === shotId)
    if (!shot) return false
    const scene = facts.scene || 'S03'
    const review = path.join(outDir, scene, shotId, 'review')
    const pngs = fs.existsSync(review) ? fs.readdirSync(review).filter((f) => /^f_\d+\.png$/.test(f)) : []
    return pngs.length === shot.frames
  } catch {
    return false
  }
}

/** 对比逐镜指纹，返回需要重渲的镜号。 */
export function dirtyShots(projectDir, outDir) {
  const current = shotFingerprints(projectDir)
  const cache = readShotCache(outDir)
  let facts = null
  try {
    facts = JSON.parse(fs.readFileSync(path.join(outDir, 'facts.json'), 'utf8'))
  } catch {
    facts = null
  }
  const dirty = []
  for (const [id, fp] of Object.entries(current)) {
    if (cache[id] !== fp || !facts || !shotOutputsComplete(outDir, facts, id)) dirty.push(id)
  }
  return { current, dirty, cache, facts }
}

const BLENDER_CANDIDATES = [
  () => process.env.PREVIZ_BLENDER,
  () => 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
  () => 'C:/Program Files/Blender Foundation/Blender 5.3/blender.exe',
  () => 'blender',
]

const FFMPEG_CANDIDATES = [() => process.env.PREVIZ_FFMPEG, () => 'ffmpeg']

function commandWorks(cmd, argv) {
  try {
    const r = spawnSync(cmd, argv, { encoding: 'utf8', timeout: 3000, windowsHide: true })
    return r.status === 0 ? String(r.stdout || '') : null
  } catch {
    return null
  }
}

export function findBlender(explicit) {
  const candidates = [() => explicit, ...BLENDER_CANDIDATES].filter(Boolean)
  for (const get of candidates) {
    let c = null
    try {
      c = get()
    } catch {
      c = null
    }
    if (!c) continue
    if (c === 'blender') {
      if (commandWorks('blender', ['--version']) !== null) return 'blender'
      continue
    }
    if (fs.existsSync(c)) return c
  }
  return null
}

export function findFfmpeg(explicit) {
  const candidates = [() => explicit, ...FFMPEG_CANDIDATES].filter(Boolean)
  for (const get of candidates) {
    let c = null
    try {
      c = get()
    } catch {
      c = null
    }
    if (!c) continue
    if (commandWorks(c, ['-version']) !== null) return c
  }
  return null
}

export function versionOf(cmd, args, regex) {
  const out = commandWorks(cmd, args)
  if (out === null) return null
  const m = regex.exec(out)
  return m ? m[1] : 'unknown'
}

export function probeEnvironment({ blender, ffmpeg } = {}) {
  const b = findBlender(blender)
  const f = findFfmpeg(ffmpeg)
  return {
    ok: !!b && !!f,
    node: process.version,
    cwd: process.cwd(),
    blender: b ? { path: b, version: versionOf(b, ['--version'], /Blender\s+([^\s]+)/) } : null,
    ffmpeg: f ? { path: f, version: versionOf(f, ['-version'], /ffmpeg version\s+([^\s]+)/) } : null,
    missing: [!b ? 'blender' : null, !f ? 'ffmpeg' : null].filter(Boolean),
  }
}

export function runCommand(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...opts })
  if (r.error) throw r.error
  if (r.status !== 0) {
    const tail = String(r.stderr || r.stdout || '').split(/\r?\n/).slice(-40).join('\n')
    throw new Error(`${path.basename(cmd)} exited ${r.status}\n${tail}`)
  }
  return r
}

/** 构建 / 渲染 / 平面图：直接调 Blender headless。only=只渲这些镜号。 */
export function runBlender({ projectDir, outDir, mode = 'all', only = null, blender, log = console.log } = {}) {
  const resolvedProject = path.resolve(projectDir || path.join(PACKAGE_ROOT, 'fixtures/boutique'))
  const resolvedOut = path.resolve(outDir || 'demo-out')
  if (!['build', 'render', 'plan', 'all'].includes(mode)) throw new Error(`unknown mode: ${mode}`)
  const exe = findBlender(blender)
  if (!exe) throw new Error('找不到 Blender（设置 PREVIZ_BLENDER 或安装 Blender 5.2）')
  fs.mkdirSync(resolvedOut, { recursive: true })
  log(`[previz] blender: ${exe}`)
  const args = [
    '-b', '--factory-startup',
    // --python-exit-code 必须排在 --python 之前；放后面 Blender 不认，脚本异常会被当成退出 0
    '--python-exit-code', '2',
    '--python', BUILDER,
    '--',
    '--project', resolvedProject,
    '--out', resolvedOut,
    '--mode', mode,
  ]
  if (only && only.length) args.push('--only', only.join(','))
  const r = runCommand(exe, args, { cwd: PACKAGE_ROOT })
  const lines = String(r.stdout || '').split(/\r?\n/).filter(Boolean)
  for (const line of lines.slice(-10)) log(`[blender] ${line}`)
  // 构建成功必须看到 PREVIZ_DONE；没有它说明脚本中途异常，不能当成功
  const done = lines.some((l) => l.startsWith('PREVIZ_DONE '))
  if (!done) {
    throw new Error(`Blender 构建未完成（没有 PREVIZ_DONE）：\n${String(r.stderr || r.stdout || '').split(/\r?\n/).slice(-25).join('\n')}`)
  }
  return { ok: true, projectDir: resolvedProject, outDir: resolvedOut, mode, only: only || [], stdout: r.stdout, stderr: r.stderr }
}

/** PNG 序列 → 每镜 mp4 → animatic → 3×3 接触表。 */
/**
 * 运动模糊：Blender 的 Workbench 没有 motion blur，EEVEE 在 `-b` 单帧渲染下实测也不生效
 * （开关前后像素差 0.000000）。所以用 ffmpeg 的时间混合做后处理：
 *   tmix=frames=N 对连续帧做加权平均，快速摇/甩时产生拖尾。
 * 只对“动得快”的镜头开，静态镜头开了只会变糊。
 */
export function motionBlurFilter(mode, frames, fps, shot) {
  if (!mode || mode === 'off') return null
  if (mode === 'auto') {
    const rotate = Number(shot?.camera?.rotate_deg) || 0
    const travel = Number(shot?.camera?.travel) || 0
    const dur = Math.max((Number(shot?.out) || 0) - (Number(shot?.in) || 0), 1)
    // 只在明显快速运动时启用：>45°/s 或 >1.2 m/s
    const fast = rotate / dur > 45 || travel / dur > 1.2
    if (!fast) return null
  }
  const raw = Math.round(Number(frames))
  const n = Math.max(2, Math.min(8, Number.isFinite(raw) ? raw : 3))
  // tmix 会把亮度平均掉，用 eq 轻微提亮补偿
  return `tmix=frames=${n},eq=brightness=0.02`
}

export function encodeOutputs(outDir, { ffmpeg, log = console.log, required = false, blurMode = 'off', blurFrames = 3 } = {}) {
  const resolvedOut = path.resolve(outDir || 'demo-out')
  const exe = findFfmpeg(ffmpeg)
  if (!exe) {
    if (required) throw new Error('找不到 ffmpeg（设置 PREVIZ_FFMPEG 或放进 PATH）')
    log('[previz] ffmpeg 不在 PATH 上：跳过编码，PNG 序列仍可用')
    return { encoded: false, reason: 'ffmpeg-not-found' }
  }
  const factsPath = path.join(resolvedOut, 'facts.json')
  if (!fs.existsSync(factsPath)) throw new Error(`缺少 ${factsPath}；先跑 build/render`)
  const facts = JSON.parse(fs.readFileSync(factsPath, 'utf8'))
  const scene = facts.scene || 'S03'
  const files = []
  for (const shot of facts.shots) {
    const dir = path.join(resolvedOut, scene, shot.id, 'review')
    const mp4 = path.join(resolvedOut, scene, shot.id, `${shot.id}.mp4`)
    const start = shot.start.frame
    const firstFrame = path.join(dir, `f_${String(start).padStart(4, '0')}.png`)
    if (!fs.existsSync(firstFrame)) {
      throw new Error(`缺少渲染帧：${firstFrame}（先跑 previz render --pass review，或 previz demo）`)
    }
    const extra = motionBlurFilter(blurMode, blurFrames, facts.fps, shot)
    runCommand(exe, [
      '-y',
      '-framerate', String(facts.fps),
      '-start_number', String(start),
      '-i', path.join(dir, 'f_%04d.png'),
      '-frames:v', String(shot.frames),
      ...(extra ? ['-vf', extra] : []),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      mp4,
    ])
    files.push(mp4)
    log(`[previz] encoded ${path.relative(process.cwd(), mp4)}`)
  }
  const list = path.join(resolvedOut, 'concat.txt')
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n') + '\n', 'utf8')
  const animatic = path.join(resolvedOut, 'animatic.mp4')
  runCommand(exe, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', animatic])
  log(`[previz] animatic -> ${path.relative(process.cwd(), animatic)}`)

  const stills = []
  for (const shot of facts.shots) {
    const dir = path.join(resolvedOut, scene, shot.id)
    stills.push(path.join(dir, 'first.png'), path.join(dir, 'mid.png'), path.join(dir, 'last.png'))
  }
  if (stills.every((f) => fs.existsSync(f))) {
    // 按实际镜头数布局：每镜一行 × 3 格；不足 3 镜时补黑格，避免硬编码 9 个输入越界。
    const cols = 3
    const rows = Math.max(1, facts.shots.length)
    const sheet = path.join(resolvedOut, 'contact_sheet.png')
    const fontPath = findFont()
    const args = ['-y']
    for (const f of stills) args.push('-i', f)
    const layout = [] // [row, col, inputIndex, label]
    facts.shots.forEach((shot, row) => {
      for (const [col, phase] of [[0, 'first'], [1, 'mid'], [2, 'last']]) {
        layout.push([row, col, row * 3 + col, `${shot.id} ${phase}`])
      }
    })
    const inputs = facts.shots.length * 3
    const filters = []
    for (let r = 0; r < rows; r++) {
      const cells = [0, 1, 2].map((c) => {
        const idx = r * 3 + c
        if (idx < inputs) return `[${idx}:v]`
        return `color=c=black:s=640x360:d=1[pad${r}${c}]`
      })
      filters.push(`${cells.join('')}hstack=inputs=3[r${r}]`)
    }
    filters.push(`${Array.from({ length: rows }, (_, r) => `[r${r}]`).join('')}vstack=inputs=${rows}[out]`)
    let filter = filters.join(';')
    // vstack 最少要 2 个输入；只有一行时直接把它当 out。
    filter = rows === 1 ? filter.replace(`[r0]vstack=inputs=1[out]`, '[r0]null[out]') : filter
    if (fontPath) {
      const escFont = fontPath.replace(/\\/g, '/').replace(/:/g, '\\:')
      const labels = layout.map(([r, c, _idx, label]) =>
        `drawtext=fontfile='${escFont}':text='${label}':x=${r === 0 ? `${c}*w/${cols}` : `${c}*w/${cols}`}+8:y=${r}*h/${rows}+8:fontsize=14:fontcolor=white:box=1:boxcolor=black@0.55`,
      )
      filter = `${filter};[out]${labels.join(',')}[labeled]`
      args.push('-filter_complex', filter, '-map', '[labeled]', '-frames:v', '1', sheet)
    } else {
      args.push('-filter_complex', filter, '-map', '[out]', '-frames:v', '1', sheet)
    }
    runCommand(exe, args)
    log(`[previz] contact sheet -> ${path.relative(process.cwd(), sheet)}`)
  } else {
    log('[previz] 缺少 first/mid/last 静帧，跳过接触表')
  }
  return { encoded: true, animatic, contactSheet: path.join(resolvedOut, 'contact_sheet.png') }
}

export function findFont(explicit) {
  const candidates = [
    explicit,
    process.env.PREVIZ_FONT,
    'C:/Windows/Fonts/segoeui.ttf',
    'C:/Windows/Fonts/arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }
  return null
}

export function timecode(seconds, fps) {
  const total = Math.max(0, Math.round(Number(seconds) * Number(fps)))
  const f = total % fps
  const s = Math.floor(total / fps) % 60
  const m = Math.floor(total / (fps * 60)) % 60
  const h = Math.floor(total / (fps * 3600))
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(h)}.${pad(m)}.${pad(s)}.${pad(f)}`
}

/** 烧字：每镜 mp4 上烧镜号/起始时间码/起始帧，再拼成 animatic_burnin.mp4。 */
export function burnIn(outDir, { ffmpeg, font, log = console.log } = {}) {
  const resolvedOut = path.resolve(outDir || 'demo-out')
  const exe = findFfmpeg(ffmpeg)
  if (!exe) throw new Error('找不到 ffmpeg（烧字需要）')
  const fontPath = findFont(font)
  if (!fontPath) throw new Error('找不到字体（设置 PREVIZ_FONT 或安装 Segoe UI / Arial / DejaVu）')
  const factsPath = path.join(resolvedOut, 'facts.json')
  if (!fs.existsSync(factsPath)) throw new Error(`缺少 ${factsPath}；先跑 build/render/encode`)
  const facts = JSON.parse(fs.readFileSync(factsPath, 'utf8'))
  const scene = facts.scene || 'S03'
  const fps = facts.fps || 24
  const dir = path.join(resolvedOut, 'burnin')
  fs.mkdirSync(dir, { recursive: true })
  const files = []
  const escFont = fontPath.replace(/\\/g, '/').replace(/:/g, '\\:')
  for (const shot of facts.shots) {
    const mp4 = path.join(resolvedOut, scene, shot.id, `${shot.id}.mp4`)
    if (!fs.existsSync(mp4)) throw new Error(`缺少 ${mp4}；先跑 encode`)
    const start = shot.start?.frame ?? Math.round(Number(shot.in) * fps) + 1
    const label = `${shot.id}  TC ${timecode(shot.in, fps)}  F${String(start).padStart(4, '0')}`
    const burned = path.join(dir, `${shot.id}.mp4`)
    const vf = [
      `drawtext=fontfile='${escFont}':text='${label}':x=16:y=16:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.55`,
      `drawtext=fontfile='${escFont}':text='%{pts\\:hms}':x=16:y=h-36:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.45`,
      `drawtext=fontfile='${escFont}':text='F %{eif\\:n+${start}\\:d}':x=w-tw-16:y=h-36:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.45`,
    ].join(',')
    runCommand(exe, [
      '-y', '-i', mp4, '-vf', vf,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', burned,
    ])
    files.push(burned)
    log(`[previz] burnin ${path.relative(process.cwd(), burned)}`)
  }
  const list = path.join(dir, 'concat.txt')
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n') + '\n', 'utf8')
  const out = path.join(resolvedOut, 'animatic_burnin.mp4')
  runCommand(exe, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out])
  log(`[previz] burnin animatic -> ${path.relative(process.cwd(), out)}`)
  return { burned: true, animatic: out, font: fontPath }
}

/** 跑 QC 并写 qc_report.json；返回 runQc 的结果。 */
export function runQcReport(outDir) {
  const resolvedOut = path.resolve(outDir || 'demo-out')
  const qc = runQc({ outDir: resolvedOut })
  fs.writeFileSync(path.join(resolvedOut, 'qc_report.json'), JSON.stringify(qc, null, 2), 'utf8')
  return qc
}

/**
 * 一条命令：校验 → Blender 构建/渲染/平面图 → 编码 → QC。
 * 多场景项目逐场景跑，最后拼跨场景 animatic。
 * 不抛异常给“业务失败”（validate/qc），由调用方决定退出码；只有环境/进程错误才抛。
 */
export function runDemo({ projectDir = path.join(PACKAGE_ROOT, 'fixtures/boutique'), outDir = 'demo-out', blender, ffmpeg, skipRender = false, skipEncode = false, burnIn: doBurnIn = false, font, force = false, only = null, blurMode = 'off', blurFrames = 3, log = console.log } = {}) {
  const resolvedProject = path.resolve(projectDir)
  const resolvedOut = path.resolve(outDir)
  const validation = validateAll(resolvedProject)
  if (!validation.ok) {
    return { ok: false, stage: 'validate', projectDir: resolvedProject, errors: validation.errors }
  }
  log(`[previz] schema OK: ${resolvedProject}`)
  if (validation.scenes) {
    return runMultiScene({ projectDir: resolvedProject, outDir: resolvedOut, scenes: validation.scenes, blender, ffmpeg, skipRender, skipEncode, blurMode, blurFrames, log })
  }

  const useCache = !skipRender && !skipEncode && !force && !(only && only.length)
  const fingerprint = useCache ? projectFingerprint(resolvedProject, doBurnIn ? 'burnin' : '') : null
  const cachePath = path.join(resolvedOut, CACHE_FILE)
  let cache = null
  try {
    cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
  } catch {
    cache = null
  }
  const cached = useCache && cache?.fingerprint === fingerprint && cache?.animatic && fs.existsSync(path.join(resolvedOut, 'animatic.mp4')) && outputsComplete(resolvedOut)
  if (cached) {
    log(`[previz] cache hit (${fingerprint.slice(0, 12)})`)
    let burned = null
    if (doBurnIn && !fs.existsSync(path.join(resolvedOut, 'animatic_burnin.mp4'))) {
      burned = burnIn(resolvedOut, { ffmpeg, font, log })
    }
    const qc = runQcReport(resolvedOut)
    return { ok: qc.ok, stage: qc.ok ? 'done' : 'qc', projectDir: resolvedProject, outDir: resolvedOut, cache: 'hit', burnIn: burned, qc, exports: qc.ok ? exportTimeline(resolvedOut, { log }) : null }
  }
  if (useCache) log(`[previz] cache miss (${fingerprint.slice(0, 12)})`)

  let rendered = null
  let dirty = null
  if (!skipRender) {
    if (only && only.length) {
      rendered = only
      log(`[previz] render only: ${only.join(', ')}`)
    } else {
      const plan = dirtyShots(resolvedProject, resolvedOut)
      dirty = plan.dirty
      if (dirty.length && dirty.length < Object.keys(plan.current).length) {
        log(`[previz] dirty shots: ${dirty.join(', ')}（其余复用已有帧）`)
      }
      rendered = dirty.length ? dirty : null
    }
    runBlender({ projectDir: resolvedProject, outDir: resolvedOut, mode: 'all', only: rendered, blender, log })
  }
  let encoded = null
  if (!skipEncode) encoded = encodeOutputs(resolvedOut, { ffmpeg, log, blurMode, blurFrames })
  let burned = null
  if (doBurnIn) burned = burnIn(resolvedOut, { ffmpeg, font, log })
  const qc = runQcReport(resolvedOut)
  if (useCache && qc.ok) {
    const fps = JSON.parse(fs.readFileSync(path.join(resolvedOut, 'facts.json'), 'utf8')).fps || 24
    fs.writeFileSync(path.join(resolvedOut, '.previz-shots.json'), JSON.stringify(shotFingerprints(resolvedProject), null, 2), 'utf8')
    fs.writeFileSync(
      cachePath,
      JSON.stringify({ version: 1, fingerprint, at: new Date().toISOString(), animatic: path.join(resolvedOut, 'animatic.mp4') }, null, 2),
      'utf8',
    )
  }
  return { ok: qc.ok, stage: qc.ok ? 'done' : 'qc', projectDir: resolvedProject, outDir: resolvedOut, cache: 'miss', encoded, burnIn: burned, qc, exports: qc.ok ? exportTimeline(resolvedOut, { log }) : null }
}

/**
 * 多场景：每个场景独立构建/渲染/编码/QC，产物在 `<out>/<sceneId>/`；
 * 最后把各场景 animatic 拼成 `<out>/animatic.mp4`，QC 汇总。
 */
export function runMultiScene({ projectDir, outDir, scenes, blender, ffmpeg, skipRender = false, skipEncode = false, blurMode = 'off', blurFrames = 3, log = console.log }) {
  const results = []
  for (const scene of scenes) {
    log(`[previz] scene ${scene.id} …`)
    const sceneOut = path.join(outDir, scene.id)
    if (!skipRender) runBlender({ projectDir: scene.dir, outDir: sceneOut, mode: 'all', blender, log })
    if (!skipEncode) encodeOutputs(sceneOut, { ffmpeg, log, blurMode, blurFrames })
    const qc = runQcReport(sceneOut)
    results.push({ id: scene.id, out: sceneOut, qc })
    if (!qc.ok) {
      return { ok: false, stage: 'qc', projectDir, outDir, scenes: results, qc }
    }
  }
  let animatic = null
  if (!skipEncode && results.length > 1) {
    const exe = findFfmpeg()
    if (exe) {
      const list = path.join(outDir, 'scenes-concat.txt')
      fs.writeFileSync(list, results.map((r) => `file '${path.join(r.out, 'animatic.mp4').replace(/\\/g, '/')}'`).join('\n') + '\n', 'utf8')
      animatic = path.join(outDir, 'animatic.mp4')
      runCommand(exe, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', animatic])
      log(`[previz] multi-scene animatic -> ${path.relative(process.cwd(), animatic)}`)
    }
  } else if (results.length === 1) {
    animatic = path.join(results[0].out, 'animatic.mp4')
  }
  const shots = results.reduce((a, r) => a + (r.qc.stats?.shots || 0), 0)
  const frames = results.reduce((a, r) => a + (r.qc.stats?.frames || 0), 0)
  const qc = { ok: results.every((r) => r.qc.ok), errors: results.flatMap((r) => r.qc.errors.map((e) => ({ ...e, path: `${r.id}.${e.path}` }))), warnings: results.flatMap((r) => r.qc.warnings.map((w) => ({ ...w, path: `${r.id}.${w.path}` }))), stats: { shots, frames, scenes: results.length, animatic } }
  fs.writeFileSync(path.join(outDir, 'qc_report.json'), JSON.stringify(qc, null, 2), 'utf8')
  return { ok: qc.ok, stage: qc.ok ? 'done' : 'qc', projectDir, outDir, scenes: results, qc, animatic }
}

export { validateAll, runQc, exportTimeline }