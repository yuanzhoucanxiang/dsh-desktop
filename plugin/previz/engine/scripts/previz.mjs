#!/usr/bin/env node
/**
 * 预演引擎的一等公民 CLI（不依赖工作台/Electron）。
 *
 *   previz info
 *   previz validate [project]
 *   previz build   [project] --out <dir>
 *   previz render  [project] --out <dir> [--pass review|plan|all]
 *   previz plan    [project] --out <dir>
 *   previz encode  <outDir> [--ffmpeg <path>]
 *   previz qc      <outDir>
 *   previz demo    [project] --out <dir> [--skip-render] [--skip-encode]
 *
 * 通用参数：--project <dir> --out <dir> --blender <path> --ffmpeg <path> --json --quiet
 */
import path from 'node:path'
import { PACKAGE_ROOT, burnIn, encodeOutputs, exportTimeline, probeEnvironment, runBlender, runDemo, runQcReport, validateAll } from '../lib/pipeline.mjs'
import { importStoryboard } from '../lib/storyboard.mjs'
import { listProjects, resolveProjectRef, scaffoldProject } from '../lib/projects.mjs'
const VALUE_FLAGS = new Set(['project', 'out', 'pass', 'blender', 'ffmpeg', 'font', 'file', 'scene', 'fps', 'title', 'root'])
const raw = process.argv.slice(2)
const command = raw.shift() || 'help'
const positional = []
for (let i = 0; i < raw.length; i++) {
  const a = raw[i]
  if (!a.startsWith('--')) {
    positional.push(a)
    continue
  }
  const name = a.slice(2)
  if (VALUE_FLAGS.has(name)) i++
}
const has = (name) => raw.includes(`--${name}`)
function arg(name, fallback) {
  const i = raw.indexOf(`--${name}`)
  return i >= 0 && raw[i + 1] ? raw[i + 1] : fallback
}
const json = has('json')
const quiet = has('quiet') || json
const log = quiet ? () => {} : (...a) => console.log(...a)
const fail = (msg, code = 1) => {
  if (json) console.log(JSON.stringify({ ok: false, error: msg }, null, 2))
  else console.error(`[previz] ${msg}`)
  process.exit(code)
}
const print = (obj) => {
  if (json) console.log(JSON.stringify(obj, null, 2))
}
const projectArg = arg('project', positional[0] || '')
const projectDir = projectArg
  ? (resolveProjectRef(projectArg) || path.resolve(projectArg))
  : path.join(PACKAGE_ROOT, 'fixtures/boutique')
const outDir = path.resolve(arg('out', command === 'encode' || command === 'qc' ? positional[0] || 'demo-out' : positional[1] || 'demo-out'))
const blender = arg('blender', undefined)
const ffmpeg = arg('ffmpeg', undefined)

function validateOrExit() {
  const v = validateAll(projectDir)
  if (!v.ok) {
    if (json) print({ ok: false, stage: 'validate', projectDir, errors: v.errors })
    else {
      console.error(`[previz] schema invalid (${v.errors.length} errors)`)
      for (const e of v.errors.slice(0, 30)) console.error(`  ${e.path}: ${e.message}`)
    }
    process.exit(1)
  }
  log(`[previz] schema OK: ${projectDir}`)
  return v
}

try {
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(`previz —— Blender 白模预演引擎（直接调用，不需要工作台）

  previz info
  previz validate [project]
  previz build   [project] --out <dir>
  previz render  [project] --out <dir> [--pass review|plan|all]
  previz plan    [project] --out <dir>
  previz encode  <outDir> [--ffmpeg <path>]
  previz qc      <outDir>
  previz export  <outDir>
  previz import  <storyboard.csv> [--out <shots.json>] [--scene <id>] [--fps 24]
  previz projects [--json]
  previz project new <id> [--title <标题>] [--root <root>]
  previz burn-in <outDir> [--font <path>]
  previz demo    [project] --out <dir> [--skip-render] [--skip-encode] [--burn-in] [--force]

通用：--project <dir> --out <dir> --blender <path> --ffmpeg <path> --font <path> --json --quiet
--force 绕过输入指纹缓存，强制重跑构建/渲染。
默认 project=fixtures/boutique  out=demo-out`)
    process.exit(0)
  }

  if (command === 'info') {
    const info = probeEnvironment({ blender, ffmpeg })
    if (json) print(info)
    else {
      console.log(`Blender : ${info.blender ? `${info.blender.version}  ${info.blender.path}` : '未找到'}`)
      console.log(`ffmpeg  : ${info.ffmpeg ? `${info.ffmpeg.version}  ${info.ffmpeg.path}` : '未找到'}`)
      console.log(`Node    : ${info.node}`)
      console.log(`cwd     : ${info.cwd}`)
      if (info.missing.length) console.log(`缺少    : ${info.missing.join(', ')}（用 --blender / --ffmpeg 或环境变量指定）`)
    }
    process.exit(0)
  }

  if (command === 'validate') {
    const v = validateAll(projectDir)
    if (json) print({ ok: v.ok, projectDir, errors: v.errors })
    else if (v.ok) console.log(`VALID ${projectDir}`)
    else {
      console.error(`INVALID ${projectDir} (${v.errors.length} errors)`)
      for (const e of v.errors.slice(0, 30)) console.error(`  ${e.path}: ${e.message}`)
    }
    process.exit(v.ok ? 0 : 1)
  }

  if (command === 'build' || command === 'render' || command === 'plan') {
    validateOrExit()
    const pass = arg('pass', 'review')
    const mode = command === 'build' ? 'build' : command === 'plan' ? 'plan' : pass === 'all' ? 'all' : pass === 'plan' ? 'plan' : 'render'
    const result = runBlender({ projectDir, outDir, mode, blender, log })
    if (json) print({ ok: true, projectDir, outDir, mode })
    else console.log(`[previz] done mode=${mode} out=${outDir}`)
    process.exit(0)
  }

  if (command === 'encode') {
    const result = encodeOutputs(outDir, { ffmpeg, log, required: true })
    if (json) print({ ok: true, outDir, ...result })
    process.exit(0)
  }

  if (command === 'burn-in') {
    const result = burnIn(outDir, { ffmpeg, font: arg('font', undefined), log })
    if (json) print({ ok: true, outDir, ...result })
    process.exit(0)
  }

  if (command === 'export') {
    const result = exportTimeline(outDir, { log })
    if (json) print({ ok: true, outDir, ...result })
    process.exit(0)
  }

  if (command === 'projects') {
    const list = listProjects()
    if (json) print({ ok: true, projects: list })
    else {
      if (!list.length) console.log('（没有项目；用 previz project new <id> 建一个）')
      for (const p of list) console.log(`${p.valid ? '✓' : '✗'} ${p.id}  ${p.title}  ${p.fps}fps  ${p.path}${p.valid ? '' : `  缺: ${p.missing.join(',')}`}`)
    }
    process.exit(0)
  }

  if (command === 'project') {
    const sub = raw[0]
    if (sub !== 'new') fail('用法：previz project new <id> [--title <标题>] [--root <root>]', 2)
    const id = arg('project', positional[1] || '')
    if (!id) fail('用法：previz project new <id> [--title <标题>] [--root <root>]', 2)
    try {
      const dest = scaffoldProject({ root: arg('root', undefined), id, title: arg('title', undefined) })
      if (json) print({ ok: true, project: dest })
      else console.log(`[previz] created ${dest}`)
      process.exit(0)
    } catch (err) {
      fail(err.message)
    }
  }

  if (command === 'import') {
    const file = arg('file', positional[0])
    if (!file) fail('用法：previz import <storyboard.csv> [--out shots.json]', 2)
    try {
      const result = importStoryboard(file, {
        outFile: arg('out', undefined),
        fps: Number(arg('fps', '24')),
        log,
      })
      if (json) print({ ok: true, outFile: result.outFile, assumptions: result.assumptions, shots: result.shots.shots.length })
      process.exit(0)
    } catch (err) {
      if (json) print({ ok: false, error: err.message, errors: err.errors || [] })
      else {
        console.error(`[previz] ${err.message}`)
        for (const e of err.errors || []) console.error(`  ${e.path}: ${e.message}`)
      }
      process.exit(1)
    }
  }

  if (command === 'qc') {
    const qc = runQcReport(outDir)
    if (json) print(qc)
    else {
      if (qc.ok) console.log(`QC OK · shots=${qc.stats?.shots ?? '?'} frames=${qc.stats?.frames ?? '?'}`)
      else {
        console.error(`QC FAILED (${qc.errors.length} errors)`)
        for (const e of qc.errors.slice(0, 30)) console.error(`  ${e.path}: ${e.message}`)
      }
      for (const w of qc.warnings || []) console.warn(`  WARN ${w.path}: ${w.message}`)
    }
    process.exit(qc.ok ? 0 : 1)
  }

  if (command === 'demo') {
    const result = runDemo({
      projectDir,
      outDir,
      blender,
      ffmpeg,
      skipRender: has('skip-render'),
      skipEncode: has('skip-encode'),
      burnIn: has('burn-in'),
      font: arg('font', undefined),
      force: has('force'),
      log,
    })
    if (json) print(result)
    else if (result.stage === 'validate') {
      console.error(`[previz] schema invalid (${result.errors.length} errors)`)
      for (const e of result.errors.slice(0, 30)) console.error(`  ${e.path}: ${e.message}`)
    } else if (!result.ok) {
      console.error(`[previz] QC FAILED (${result.qc.errors.length} errors)`)
      for (const e of result.qc.errors.slice(0, 30)) console.error(`  ${e.path}: ${e.message}`)
    } else {
      console.log(`[previz] QC OK · shots=${result.qc.stats.shots} frames=${result.qc.stats.frames}`)
      for (const w of result.qc.warnings) console.warn(`  WARN ${w.path}: ${w.message}`)
      console.log(`[previz] out: ${result.outDir}`)
    }
    process.exit(result.ok ? 0 : 1)
  }

  fail(`unknown command: ${command}（用 previz help）`, 2)
} catch (err) {
  fail(err?.message || String(err), 1)
}
