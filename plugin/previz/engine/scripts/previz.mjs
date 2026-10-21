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
import fs from 'node:fs'
import path from 'node:path'
import { PACKAGE_ROOT, burnIn, encodeOutputs, exportTimeline, probeEnvironment, runBlender, runDemo, runQcReport, validateAll } from '../lib/pipeline.mjs'
import { importStoryboard } from '../lib/storyboard.mjs'
import { parseAliases, writeScript, writeStoryboard } from '../lib/script.mjs'
import { confirmPanelDraft, writePanelDraft } from '../lib/panels.mjs'
import { checkStale, exportHandoff } from '../lib/handoff.mjs'
import { listProjects, resolveProjectRef, scaffoldProject } from '../lib/projects.mjs'
const VALUE_FLAGS = new Set(['project', 'out', 'pass', 'blender', 'ffmpeg', 'font', 'file', 'scene', 'fps', 'title', 'root', 'alias', 'beat', 'size', 'angle', 'lens', 'move', 'fit-blocking', 'only', 'subject', 'duration', 'by', 'blur', 'blur-frames'])
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
// 这些命令的第一个位置参数就是 outDir（不接 project 位置参数）
const OUTDIR_FIRST = new Set(['encode', 'qc', 'export', 'handoff', 'handoff-check'])
// OUTDIR_FIRST 的命令：位置参数归 outDir；项目只能通过 --project 指定
const projectArg = arg('project', OUTDIR_FIRST.has(command) ? '' : positional[0] || '')
const projectDir = projectArg
  ? (resolveProjectRef(projectArg) || path.resolve(projectArg))
  : path.join(PACKAGE_ROOT, 'fixtures/boutique')
const outDir = path.resolve(arg('out', OUTDIR_FIRST.has(command) ? positional[0] || 'demo-out' : positional[1] || 'demo-out'))
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
  previz script  <script.txt> [--out <script.json>] [--title <标题>] [--alias "林=LIN,周=ZHOU"] [--scene S03]
  previz board   <script.txt> [--out <storyboard.csv>] [--title <标题>] [--alias "林=LIN,周=ZHOU"] [--scene S03] [--fit-blocking blocking.json]
  previz panels  [project] [--scene S03] [--subject LIN] [--duration 3] [--size MS]
  previz panels-confirm [project] [--by <名字>]
  previz projects [--json]
  previz project new <id> [--title <标题>] [--root <root>]
  previz burn-in <outDir> [--font <path>]
  previz demo    [project] --out <dir> [--skip-render] [--skip-encode] [--burn-in] [--force] [--only S03-02]

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
    const result = runBlender({ projectDir, outDir, mode, only: (arg('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean), blender, log })
    if (json) print({ ok: true, projectDir, outDir, mode })
    else console.log(`[previz] done mode=${mode} out=${outDir}`)
    process.exit(0)
  }

  if (command === 'encode') {
    const result = encodeOutputs(outDir, { ffmpeg, log, required: true, blurMode: arg('blur', 'off'), blurFrames: Number(arg('blur-frames', '3')) })
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

  // 逐镜交接包（handoff）：确定性事实骨架 + 语义占位（方案 C）
  if (command === 'handoff' || command === 'handoff-check') {
    try {
      if (command === 'handoff') {
        const r = exportHandoff({ projectDir, outDir, log })
        if (json) print({ ok: true, dir: r.dir, shots: r.manifest.shots.length, pending: r.manifest.pending })
        else {
          console.log(`[previz] 交接包目录：${r.dir}`)
          if (r.manifest.pending.length) {
            console.log(`[previz] 待补 ${r.manifest.pending.length} 项：`)
            for (const p of r.manifest.pending.slice(0, 12)) console.log(`  - ${p}`)
          }
          console.log('[previz] 语义提示词正文仍需 Agent 按方案 C 补写（当前 semantic: pending）。')
        }
        process.exit(0)
      }
      const r = checkStale({ projectDir, outDir })
      if (json) print(r)
      else if (!r.exists) console.error(`[previz] ${r.reason}`)
      else if (r.stale) {
        console.error(`[previz] 交接包已过期：${r.changed.join(', ')} 变了，请重新跑 previz handoff`)
      } else console.log('[previz] 交接包与当前源数据一致（未过期）')
      process.exit(r.exists && !r.stale ? 0 : 1)
    } catch (err) {
      if (json) print({ ok: false, error: err.message })
      else console.error(`[previz] ${err.message}`)
      process.exit(1)
    }
  }

  if (command === 'panels' || command === 'panels-confirm') {
    try {
      if (command === 'panels') {
        const r = writePanelDraft(projectDir, {
          scene: arg('scene', 'S01'),
          subject: arg('subject', 'SUBJECT'),
          duration: Number(arg('duration', '3')),
          size: arg('size', 'MS'),
        })
        if (json) print({ ok: true, out: r.out, panels: r.rows.length, missingSize: r.missingSize })
        else {
          console.log(`[previz] panels -> ${path.relative(process.cwd(), r.out)}（${r.rows.length} 张）`)
          if (r.missingSize) console.log(`[previz] ${r.missingSize} 张读不出尺寸（仍入选，notes 标 unknown-size）`)
          console.log('[previz] 这是草案（status=draft）：确认前不能当输入。核对后跑 previz panels-confirm。')
        }
        process.exit(0)
      }
      const r = confirmPanelDraft(projectDir, { confirmedBy: arg('by', 'human'), log })
      if (json) print({ ok: true, out: r.out, rows: r.rows })
      process.exit(0)
    } catch (err) {
      if (json) print({ ok: false, error: err.message })
      else console.error(`[previz] ${err.message}`)
      process.exit(1)
    }
  }

  if (command === 'script' || command === 'board') {
    const file = arg('file', positional[0])
    if (!file) fail(`用法：previz ${command} <script.txt> [--out <path>] [--title <标题>] [--alias "林=LIN,周=ZHOU"]`, 2)
    const shared = {
      title: arg('title', undefined),
      aliases: parseAliases(arg('alias', '')),
      sceneId: arg('scene', undefined),
      size: arg('size', undefined),
      angle: arg('angle', 'eye'),
      lens: Number(arg('lens', '35')),
      move: arg('move', 'static'),
      log,
    }
    try {
      const fitBlocking = arg('fit-blocking', undefined)
      let fitDuration = null
      let blocking = null
      if (fitBlocking && command === 'board') {
        blocking = JSON.parse(fs.readFileSync(path.resolve(fitBlocking), 'utf8'))
        fitDuration = Number(blocking.duration)
        if (!Number.isFinite(fitDuration) || fitDuration <= 0) fail(`${fitBlocking} 里没有有效的 duration`, 2)
      }
      const result = command === 'script'
        ? writeScript(file, { ...shared, outFile: arg('out', undefined) })
        : writeStoryboard(file, { ...shared, fitDuration, blocking, outFile: arg('out', undefined) })
      if (json) print({ ok: true, outFile: result.outFile, warnings: result.warnings })
      else if (command === 'script') {
        const s = result.script
        console.log(`[previz] ${s.title} · ${s.scenes.length} 场 · ${s.scenes.reduce((a, x) => a + x.beats.length, 0)} beats · 角色 ${result.characters.join(', ') || '（无）'}`)
      } else {
        const s = result.script
        const beats = s.scenes.reduce((a, x) => a + x.beats.length, 0)
        console.log(`[previz] ${s.title} · ${beats} 镜草案 · 角色 ${result.characters.join(', ') || '（无）'}`)
        console.log('[previz] 这是草案：景别/机位是默认值，跑 build 前请先核对；scene id/时长需与 set/blocking 对齐。')
      }
      process.exit(0)
    } catch (err) {
      if (json) print({ ok: false, error: err.message })
      else console.error(`[previz] ${err.message}`)
      process.exit(1)
    }
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
      only: (arg('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean),
      blurMode: arg('blur', 'off'),
      blurFrames: Number(arg('blur-frames', '3')),
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
