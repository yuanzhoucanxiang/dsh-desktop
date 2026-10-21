/**
 * Host half of `@dsh-local/previz` — 外部工具型模式（Blender）的 P0 demo 后端。
 *
 * 职责：
 *   - 探测 Blender / ffmpeg（3s 有界、绝不抛、2s 缓存）
 *   - 启动 demo（构建 + 渲染 + 编码 + QC），维护一个内存任务
 *   - 列出产物句柄；按范围读取 animatic/图片（只允许 OUT 目录内）
 *   - 打开 GUI Blender（模式自己的 start()，工作台不代管进程）
 *
 * 不做什么：不常驻 Blender 服务、不跑任意 Python、不把外部 Web UI 塞进工作台。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readBody, trustedRequest, writeJson } from './lib/http.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ENGINE = path.join(__dirname, 'engine')
export const PROJECTS_ROOT = path.join(ENGINE, 'fixtures')
export const PROJECT = path.join(PROJECTS_ROOT, 'boutique')
export const API = '/api/previz'

/** 当前选中的项目；未选时回落到 boutique。 */
let currentProject = null

function projectMeta(dir) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'))
    return { id: String(meta.id || path.basename(dir)), title: String(meta.title || meta.id || path.basename(dir)), path: dir, fps: Number(meta.fps) || 24 }
  } catch {
    return null
  }
}

export function listProjects() {
  if (!fs.existsSync(PROJECTS_ROOT)) return []
  const out = []
  for (const entry of fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(PROJECTS_ROOT, entry.name)
    const meta = projectMeta(dir)
    if (!meta || meta.fixture) continue
    const missing = ['set.json', 'blocking.json', 'shots.json'].filter((f) => !fs.existsSync(path.join(dir, f)))
    out.push({ ...meta, valid: missing.length === 0, missing })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function activeProject() {
  if (currentProject && fs.existsSync(path.join(currentProject, 'project.json'))) return currentProject
  const first = listProjects().find((p) => p.valid)
  return first ? first.path : PROJECT
}

export function outDirFor(dir) {
  return path.join(os.tmpdir(), 'dsh-previz-runs', path.basename(dir))
}

export const OUT = outDirFor(PROJECT)

export const name = 'previz'
export const inject = ['webServer']

const BLENDER_CANDIDATES = [
  () => process.env.PREVIZ_BLENDER,
  () => 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
  () => 'C:/Program Files/Blender Foundation/Blender 5.3/blender.exe',
  () => 'blender',
]

let probeCache = null
let probeCacheAt = 0
let job = null
let child = null
let seq = 0

function now() {
  return Date.now()
}

function findExecutable(candidates) {
  for (const get of candidates) {
    let candidate = null
    try {
      candidate = get()
    } catch {
      candidate = null
    }
    if (!candidate) continue
    if (candidate === 'blender' || candidate === 'ffmpeg') {
      const r = spawnSync(candidate, candidate === 'blender' ? ['--version'] : ['-version'], {
        encoding: 'utf8',
        timeout: 1500,
        windowsHide: true,
      })
      if (r.status === 0) return candidate
      continue
    }
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function versionOfBlender(exe) {
  const r = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 1500, windowsHide: true })
  if (r.status !== 0) return null
  const m = /Blender\s+([^\s]+)/.exec(String(r.stdout || ''))
  return m ? m[1] : 'unknown'
}

function versionOfFfmpeg(exe) {
  const r = spawnSync(exe, ['-version'], { encoding: 'utf8', timeout: 1500, windowsHide: true })
  if (r.status !== 0) return null
  const m = /ffmpeg version\s+([^\s]+)/.exec(String(r.stdout || ''))
  return m ? m[1] : 'unknown'
}

/**
 * 后端探测：3 秒内有界、绝不抛。Blender 不是常驻服务，所以这里只验“可执行 + 版本”，
 * 不验“端口有人应答”。缓存在 2 秒内复用，避免 UI 每秒刷新都 spawn 一次。
 */
export function probeRuntime(force = false) {
  if (!force && probeCache && now() - probeCacheAt < 2000) return probeCache
  let result
  try {
    const blender = findExecutable(BLENDER_CANDIDATES)
    if (!blender) {
      result = { state: 'down', detail: '找不到 Blender（设置 PREVIZ_BLENDER 或安装 Blender 5.2）', version: null }
    } else {
      const bv = versionOfBlender(blender)
      if (!bv) {
        result = { state: 'error', detail: `Blender 存在但版本检查失败：${blender}`, version: null }
      } else {
        const ffmpeg = findExecutable([() => process.env.PREVIZ_FFMPEG, () => 'ffmpeg'])
        if (!ffmpeg) {
          result = { state: 'down', detail: '找不到 ffmpeg（编码 animatic 需要；安装后重试）', version: bv }
        } else {
          const fv = versionOfFfmpeg(ffmpeg)
          if (!fv) {
            result = { state: 'error', detail: `ffmpeg 存在但版本检查失败：${ffmpeg}`, version: bv }
          } else {
            result = { state: 'ready', detail: `Blender ${bv} · ffmpeg ${fv}`, version: bv }
          }
        }
      }
    }
    result._paths = {
      blender: blender ? (blender === 'blender' ? 'blender' : blender) : null,
      ffmpeg: (() => {
        const f = findExecutable([() => process.env.PREVIZ_FFMPEG, () => 'ffmpeg'])
        return f
      })(),
    }
  } catch (err) {
    result = { state: 'error', detail: String(err?.message || err), version: null, _paths: { blender: null, ffmpeg: null } }
  }
  probeCache = result
  probeCacheAt = now()
  return result
}

function publicProbe(p) {
  return { state: p.state, detail: p.detail, version: p.version }
}

function publicJob() {
  if (!job) return null
  return {
    id: job.id,
    label: job.label,
    progress: job.progress,
    state: job.state,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
    error: job.error || null,
    logTail: job.logTail.slice(-30),
  }
}

function appendLog(line) {
  if (!job) return
  const text = String(line || '').trim()
  if (!text) return
  job.logTail.push(text)
  if (job.logTail.length > 100) job.logTail.shift()
  if (/render S03-01/.test(text)) job.progress = 0.2
  else if (/render S03-02/.test(text)) job.progress = 0.45
  else if (/render S03-03/.test(text)) job.progress = 0.7
  else if (/animatic ->/.test(text)) job.progress = 0.9
  else if (/QC OK/.test(text)) job.progress = 0.99
}

/** 启动一次 demo；可选项目 id/路径；同一时间只允许一个任务。 */
export function startDemo(ref) {
  const p = probeRuntime(true)
  if (p.state !== 'ready') {
    return { ok: false, error: 'runtime-down', detail: p.detail }
  }
  if (job && (job.state === 'running' || job.state === 'queued')) {
    return { ok: false, error: 'busy', detail: '已有任务在跑' }
  }
  let projectDir = activeProject()
  if (ref) {
    const abs = path.resolve(String(ref))
    const hit = fs.existsSync(path.join(abs, 'project.json')) ? abs : listProjects().find((x) => x.id === ref)
    if (!hit) return { ok: false, error: 'project-not-found', detail: `找不到项目 ${ref}` }
    projectDir = typeof hit === 'string' ? hit : hit.path
  }
  currentProject = projectDir
  const outDir = outDirFor(projectDir)
  fs.mkdirSync(outDir, { recursive: true })
  const id = `job-${Date.now()}-${++seq}`
  job = {
    id,
    label: '构建 + 渲染 + 编码 + QC',
    progress: 0.02,
    state: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    project: path.basename(projectDir),
    logTail: [],
  }
  const script = path.join(ENGINE, 'scripts/run-demo.mjs')
  const args = [script, '--project', projectDir, '--out', outDir]
  try {
    child = spawn(process.execPath, args, {
      cwd: ENGINE,
      env: {
        ...process.env,
        PREVIZ_BLENDER: p._paths?.blender || process.env.PREVIZ_BLENDER || '',
        PREVIZ_FFMPEG: p._paths?.ffmpeg || process.env.PREVIZ_FFMPEG || '',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    job.state = 'failed'
    job.error = String(err?.message || err)
    child = null
    return { ok: false, error: 'spawn-failed', detail: job.error }
  }
  const onData = (buf) => {
    for (const line of String(buf).split(/\r?\n/)) appendLog(line)
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.on('error', (err) => {
    if (!job) return
    job.state = 'failed'
    job.error = String(err?.message || err)
    job.finishedAt = new Date().toISOString()
    child = null
  })
  child.on('exit', (code) => {
    if (!job) return
    if (job.state === 'cancelled') {
      job.finishedAt = new Date().toISOString()
      child = null
      return
    }
    job.state = code === 0 && fs.existsSync(path.join(outDir, 'animatic.mp4')) ? 'done' : 'failed'
    job.exitCode = code
    job.finishedAt = new Date().toISOString()
    if (job.state === 'done') job.progress = 1
    else job.error = job.error || `run-demo exited ${code}`
    child = null
  })
  return { ok: true, job: publicJob() }
}

/** 取消：只杀自己 spawn 的进程树（Windows 用 taskkill /T），绝不按进程名杀。 */
export function cancelJob() {
  if (!child || !job) return { ok: false, error: 'no-job', detail: '没有在跑的任务' }
  const pid = child.pid
  job.state = 'cancelled'
  job.finishedAt = new Date().toISOString()
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000 })
    } else {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        process.kill(pid, 'SIGTERM')
      }
    }
  } catch (err) {
    job.error = String(err?.message || err)
  }
  child = null
  return { ok: true, job: publicJob() }
}

/** 打开 GUI Blender（模式自己的 start；工作台不代管）。 */
export function openBlender() {
  const p = probeRuntime(true)
  if (p.state !== 'ready' || !p._paths?.blender) {
    return { ok: false, error: 'runtime-down', detail: p.detail }
  }
  const dir = activeProject()
  const blend = path.join(outDirFor(dir), `${path.basename(dir)}.blend`)
  const args = fs.existsSync(blend) ? [blend] : []
  try {
    const gui = spawn(p._paths.blender, args, { detached: true, stdio: 'ignore', windowsHide: false })
    gui.unref()
    return { ok: true, detail: fs.existsSync(blend) ? `已打开 ${path.basename(blend)}` : '已打开 Blender' }
  } catch (err) {
    return { ok: false, error: 'spawn-failed', detail: String(err?.message || err) }
  }
}

export function listArtifacts(projectDir = activeProject()) {
  const base = outDirFor(projectDir)
  const out = []
  const add = (rel, kind, title) => {
    const abs = path.join(base, rel)
    if (!fs.existsSync(abs)) return
    const st = fs.statSync(abs)
    if (!st.isFile()) return
    out.push({ mode: 'previz', kind, id: rel, path: rel.replace(/\\/g, '/'), title, at: st.mtime.toISOString() })
  }
  add('animatic.mp4', 'animatic', 'animatic.mp4')
  add('animatic_burnin.mp4', 'animatic', 'animatic_burnin.mp4（烧字）')
  add('plan.png', 'image', '俯视平面图')
  add('contact_sheet.png', 'image', '3×3 接触表')
  add('qc_report.json', 'report', 'QC 报告')
  add('facts.json', 'data', 'facts.json')
  add('shots.csv', 'data', 'shots.csv')
  add('timeline.otio', 'data', 'timeline.otio')
  for (const shot of ['S03-01', 'S03-02', 'S03-03']) {
    add(path.join('S03', shot, `${shot}.mp4`), 'shot', `${shot}.mp4`)
  }
  return out
}

export function safeResolveOut(rel, projectDir = activeProject()) {
  if (typeof rel !== 'string' || !rel) return null
  const base = outDirFor(projectDir)
  const abs = path.resolve(base, rel)
  const relPath = path.relative(base, abs)
  if (!relPath || relPath.startsWith('..') || path.isAbsolute(relPath)) return null
  return abs
}

const MIME = {
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.blend': 'application/octet-stream',
}

function serveFile(req, res, rel) {
  const abs = safeResolveOut(rel)
  if (!abs || !fs.existsSync(abs)) {
    writeJson(res, 404, { ok: false, error: 'artifact-not-found' })
    return
  }
  const st = fs.statSync(abs)
  if (!st.isFile()) {
    writeJson(res, 403, { ok: false, error: 'not-a-file' })
    return
  }
  const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream'
  const range = String(req.headers.range || '')
  const m = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (m) {
    let start = m[1] ? Number(m[1]) : 0
    let end = m[2] ? Number(m[2]) : st.size - 1
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= st.size) {
      res.statusCode = 416
      res.setHeader('content-range', `bytes */${st.size}`)
      res.end()
      return
    }
    start = Math.max(0, start)
    end = Math.min(end, st.size - 1)
    res.statusCode = 206
    res.setHeader('content-range', `bytes ${start}-${end}/${st.size}`)
    res.setHeader('accept-ranges', 'bytes')
    res.setHeader('content-length', String(end - start + 1))
    res.setHeader('content-type', type)
    res.setHeader('cache-control', 'no-store')
    fs.createReadStream(abs, { start, end }).pipe(res)
    return
  }
  res.statusCode = 200
  res.setHeader('content-type', type)
  res.setHeader('content-length', String(st.size))
  res.setHeader('accept-ranges', 'bytes')
  res.setHeader('cache-control', 'no-store')
  fs.createReadStream(abs).pipe(res)
}

export function state() {
  const p = probeRuntime(false)
  const dir = activeProject()
  const meta = projectMeta(dir) || { id: path.basename(dir), title: path.basename(dir), fps: 24 }
  return {
    ok: true,
    runtime: publicProbe(p),
    project: { ...meta, path: dir },
    projects: listProjects(),
    out: outDirFor(dir),
    job: publicJob(),
    artifacts: listArtifacts(dir),
  }
}

const ROUTE_METHODS = {
  state: ['GET'],
  probe: ['POST'],
  demo: ['POST'],
  cancel: ['POST'],
  'open-blender': ['POST'],
  project: ['POST'],
  artifact: ['GET'],
}

async function handler(req, res) {
  if (!trustedRequest(req)) {
    writeJson(res, 403, { ok: false, error: 'forbidden' })
    return
  }
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const route = url.searchParams.get('route') || ''
  const allowed = Object.prototype.hasOwnProperty.call(ROUTE_METHODS, route) ? ROUTE_METHODS[route] : null
  if (!allowed) {
    writeJson(res, 404, { ok: false, error: 'unknown-route' })
    return
  }
  if (!allowed.includes(req.method)) {
    writeJson(res, 405, { ok: false, error: 'method-not-allowed', allowed })
    return
  }
  if (route === 'artifact') {
    serveFile(req, res, url.searchParams.get('path') || '')
    return
  }
  if (req.method === 'POST') {
    const raw = await readBody(req, 1 << 20)
    if (raw === null) {
      writeJson(res, 413, { ok: false, error: 'body-too-large' })
      return
    }
    if (raw && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      writeJson(res, 415, { ok: false, error: 'json-required' })
      return
    }
    if (route === 'project') {
      try {
        const body = raw ? JSON.parse(raw) : {}
        const hit = listProjects().find((x) => x.id === body.id)
        if (!hit) return writeJson(res, 404, { ok: false, error: 'project-not-found' })
        currentProject = hit.path
        return writeJson(res, 200, { ok: true, project: { ...hit } })
      } catch {
        return writeJson(res, 400, { ok: false, error: 'bad-json' })
      }
    }
  }
  if (route === 'state') return writeJson(res, 200, state())
  if (route === 'probe') return writeJson(res, 200, { ok: true, runtime: publicProbe(probeRuntime(true)) })
  if (route === 'demo') return writeJson(res, 200, startDemo(url.searchParams.get('project') || undefined))
  if (route === 'cancel') return writeJson(res, 200, cancelJob())
  if (route === 'open-blender') return writeJson(res, 200, openBlender())
  writeJson(res, 404, { ok: false, error: 'unknown-route' })
}

export function apply(ctx) {
  if (!ctx?.webServer || typeof ctx.webServer.register !== 'function') {
    console.warn('[previz] webServer unavailable, host API disabled')
    return
  }
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: API,
        handler,
      }),
    'previz: /api/previz route',
  )
}
