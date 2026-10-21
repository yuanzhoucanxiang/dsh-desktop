import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { validateAll } from '../lib/validate.mjs'
import { runQc } from '../lib/qc.mjs'

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const projectDir = path.resolve(arg('project', 'fixtures/boutique'))
const outDir = path.resolve(arg('out', 'demo-out'))
const skipRender = args.includes('--skip-render')
const skipEncode = args.includes('--skip-encode')

function findBlender() {
  const candidates = [
    process.env.PREVIZ_BLENDER,
    'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
    'C:/Program Files/Blender Foundation/Blender 5.3/blender.exe',
    'blender',
  ].filter(Boolean)
  for (const c of candidates) {
    if (c === 'blender') {
      const r = spawnSync('blender', ['--version'], { encoding: 'utf8' })
      if (r.status === 0) return 'blender'
      continue
    }
    if (fs.existsSync(c)) return c
  }
  return null
}

function findFfmpeg() {
  const candidates = [process.env.PREVIZ_FFMPEG, 'ffmpeg'].filter(Boolean)
  for (const c of candidates) {
    const r = spawnSync(c, ['-version'], { encoding: 'utf8' })
    if (r.status === 0) return c
  }
  return null
}

function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
  if (r.status !== 0) {
    const tail = String(r.stderr || r.stdout || '').split(/\r?\n/).slice(-40).join('\n')
    throw new Error(`${path.basename(cmd)} exited ${r.status}\n${tail}`)
  }
  return r
}

function encode(outDir) {
  const ffmpeg = findFfmpeg()
  if (!ffmpeg) {
    console.warn('[previz] ffmpeg 不在 PATH 上：跳过编码，PNG 序列仍可用')
    return { encoded: false, reason: 'ffmpeg-not-found' }
  }
  const facts = JSON.parse(fs.readFileSync(path.join(outDir, 'facts.json'), 'utf8'))
  const files = []
  for (const shot of facts.shots) {
    const dir = path.join(outDir, 'S03', shot.id, 'review')
    const mp4 = path.join(outDir, 'S03', shot.id, `${shot.id}.mp4`)
    const start = shot.start.frame
    run(ffmpeg, [
      '-y',
      '-framerate', String(facts.fps),
      '-start_number', String(start),
      '-i', path.join(dir, 'f_%04d.png'),
      '-frames:v', String(shot.frames),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      mp4,
    ])
    files.push(mp4)
    console.log(`[previz] encoded ${path.relative(process.cwd(), mp4)}`)
  }
  const list = path.join(outDir, 'concat.txt')
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n') + '\n', 'utf8')
  const animatic = path.join(outDir, 'animatic.mp4')
  run(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', animatic])
  console.log(`[previz] animatic -> ${path.relative(process.cwd(), animatic)}`)

  // 3×3 接触表：每镜首/中/尾（render_shot 已复制成 first/mid/last.png）
  const stills = []
  for (const shot of facts.shots) {
    const dir = path.join(outDir, 'S03', shot.id)
    stills.push(path.join(dir, 'first.png'), path.join(dir, 'mid.png'), path.join(dir, 'last.png'))
  }
  if (stills.every((f) => fs.existsSync(f))) {
    const sheet = path.join(outDir, 'contact_sheet.png')
    const args = ['-y']
    for (const f of stills) args.push('-i', f)
    args.push(
      '-filter_complex',
      '[0:v][1:v][2:v]hstack=inputs=3[r0];[3:v][4:v][5:v]hstack=inputs=3[r1];[6:v][7:v][8:v]hstack=inputs=3[r2];[r0][r1][r2]vstack=inputs=3[out]',
      '-map', '[out]', '-frames:v', '1', sheet,
    )
    run(ffmpeg, args)
    console.log(`[previz] contact sheet -> ${path.relative(process.cwd(), sheet)}`)
  } else {
    console.warn('[previz] 缺少 first/mid/last 静帧，跳过接触表')
  }
  return { encoded: true, animatic }
}

const validation = validateAll(projectDir)
if (!validation.ok) {
  console.error(`[previz] schema invalid (${validation.errors.length} errors)`)
  for (const e of validation.errors.slice(0, 20)) console.error(`  ${e.path}: ${e.message}`)
  process.exit(1)
}
console.log(`[previz] schema OK: ${projectDir}`)

if (!skipRender) {
  const blender = findBlender()
  if (!blender) {
    console.error('[previz] 找不到 Blender。设置 PREVIZ_BLENDER 或安装 Blender 5.2。')
    process.exit(1)
  }
  console.log(`[previz] blender: ${blender}`)
  const blenderArgs = [
    '-b', '--factory-startup',
    '--python', path.resolve('blender/previz_build.py'),
    '--python-exit-code', '2',
    '--',
    '--project', projectDir,
    '--out', outDir,
    '--mode', 'all',
  ]
  const r = run(blender, blenderArgs)
  const lines = String(r.stdout || '').split(/\r?\n/).filter(Boolean)
  for (const line of lines.slice(-8)) console.log(`[blender] ${line}`)
}

if (!skipEncode) encode(outDir)

const qc = runQc({ outDir })
fs.writeFileSync(path.join(outDir, 'qc_report.json'), JSON.stringify(qc, null, 2), 'utf8')
if (qc.errors.length) {
  console.error(`[previz] QC FAILED (${qc.errors.length} errors)`)
  for (const e of qc.errors.slice(0, 20)) console.error(`  ${e.path}: ${e.message}`)
  process.exit(1)
}
console.log(`[previz] QC OK · shots=${qc.stats.shots} frames=${qc.stats.frames}`)
for (const w of qc.warnings) console.warn(`  WARN ${w.path}: ${w.message}`)
console.log(`[previz] out: ${outDir}`)
