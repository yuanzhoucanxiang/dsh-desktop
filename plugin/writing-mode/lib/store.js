/**
 * writing-mode store：库根配置、路径安全、项目扫描、文稿读写。
 * 见 CONTRACT.md。不含 llm / 门禁业务。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'

export const CONFIG_NAME = 'writing-mode.json'
export const TEXT_EXTS = new Set(['.md', '.markdown', '.fountain', '.txt'])
export const PROJECT_SCAN_DIRS = ['bible', 'outline', 'draft', 'state', 'reviews']

export const DEFAULT_PREFS = {
  fontSize: 17,
  lineHeight: 1.95,
  autoSaveMs: 800,
  autoGate: true,
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

export function normalizePrefs(raw) {
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

export function configFile() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, CONFIG_NAME)
}

// A local, editable preset, based on the pinned kernel's standard tool set.
// Never replace a user's existing customization.
export function ensureCompanionPreset() {
  const id = 'writing-companion'
  const file = path.join(path.dirname(configFile()), '.agent-presets', id, 'agent.cordis.yml')
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    try { atomicWrite(file, fs.readFileSync(new URL('./companion.cordis.yml', import.meta.url), 'utf8'), { exclusive: true }) }
    catch (err) { if (err.code !== 'EEXIST') throw err }
  }
  const metadata = path.join(path.dirname(file), 'preset.yml')
  if (!fs.existsSync(metadata)) {
    try { atomicWrite(metadata, 'name: 写作伙伴\ndescription: 与作者持续交流，按需使用工具与项目资料。\n', { exclusive: true }) }
    catch (err) { if (err.code !== 'EEXIST') throw err }
  }
  return id
}

export function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(), 'utf8').replace(/^\uFEFF/, ''))
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
      companions: raw?.companions && typeof raw.companions === 'object' && !Array.isArray(raw.companions) ? raw.companions : {},
    }
  } catch {
    return { roots: [], activeRoot: null, prefs: { ...DEFAULT_PREFS } }
  }
}

export function writeConfig(cfg) {
  const file = configFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const out = {
    roots: cfg.roots || [],
    activeRoot: cfg.activeRoot ?? null,
    prefs: normalizePrefs(cfg.prefs),
    companions: cfg.companions || {},
  }
  atomicWrite(file, JSON.stringify(out, null, 2))
  return out
}

export function realOrNull(p) {
  try {
    return fs.realpathSync(String(p))
  } catch {
    return null
  }
}

export function effectiveRoots(cfg) {
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

export function resolveUnderRoots(filePath, roots) {
  if (typeof filePath !== 'string' || !filePath.trim() || !path.isAbsolute(filePath)) return null
  const raw = path.resolve(String(filePath))
  const real = realOrNull(raw)
  if (real === null) {
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

export function listProjectFiles(projectDir, shallow = false) {
  const files = []
  const scope = [{ path: projectDir, real: realOrNull(projectDir) }]
  const seen = new Set()
  const pushFile = (abs) => {
    if (!resolveUnderRoots(abs, scope)) return
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
    if (!resolveUnderRoots(dir, scope)) return
    let ents
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of ents) {
      if (ent.name.startsWith('.')) continue
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(full, depth + 1)
      else if (ent.isFile()) pushFile(full)
    }
  }
  try {
    for (const ent of fs.readdirSync(projectDir, { withFileTypes: true })) {
      if (ent.isFile() && TEXT_EXTS.has(path.extname(ent.name).toLowerCase())) {
        pushFile(path.join(projectDir, ent.name))
      }
    }
    for (const sub of shallow ? [] : PROJECT_SCAN_DIRS) {
      const d = path.join(projectDir, sub)
      if (fs.existsSync(d)) walk(d, 1)
    }
  } catch {}
  files.sort((a, b) => a.rel.localeCompare(b.rel, 'zh'))
  return files
}

export function scanTree(cfg) {
  const roots = effectiveRoots(cfg)
  const active = cfg.activeRoot
  return roots.map((r) => {
    const projects = []
    if (r.real) {
      try {
        const ents = fs.readdirSync(r.real, { withFileTypes: true })
        if (fs.existsSync(path.join(r.real, 'project.md'))) {
          projects.push({
            name: path.basename(r.real),
            path: r.real,
            isRootProject: true,
            files: listProjectFiles(r.real),
          })
        } else {
          const files = listProjectFiles(r.real, true)
          if (files.length) projects.push({ name: '独立文稿', path: r.real, isLoose: true, files })
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
      active:
        active !== null
          ? path.resolve(active).toLowerCase() === path.resolve(r.path).toLowerCase()
          : r.default,
      projects,
    }
  })
}

export function newDraftPath(rootPath, title) {
  const safe = String(title || '未命名').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40) || '未命名'
  const stamp = Date.now().toString(36)
  return path.join(rootPath, `${safe}-${stamp}.md`)
}

export function readTextOrNull(p) {
  try {
    const target = resolveUnderRoots(p, effectiveRoots(readConfig()))
    return target ? readDoc(target).content : null
  } catch {
    return null
  }
}

export function findProjectRoot(absPath) {
  const roots = effectiveRoots(readConfig())
  let dir = path.dirname(path.resolve(String(absPath || '')))
  for (let i = 0; i < 8; i++) {
    if (!resolveUnderRoots(dir, roots)) return null
    if (readTextOrNull(path.join(dir, 'project.md')) !== null) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

export function readDoc(target) {
  assertTextTarget(target)
  const bytes = fs.readFileSync(target.abs)
  const text = bytes.toString('utf8')
  const st = fs.statSync(target.abs)
  return { path: target.abs, content: text, mtime: st.mtimeMs, chars: text.length, revision: digest(bytes) }
}

export function storeError(code, status = 400) {
  return Object.assign(new Error(code), { status })
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex') }

function assertTextTarget(target) {
  if (!target || !TEXT_EXTS.has(path.extname(target.abs).toLowerCase())) throw storeError('unsupported-file-type')
}

// Same-directory replace; never delete the original as a Windows rename fallback.
function atomicWrite(file, body, { exclusive = false, beforeCommit = () => {} } = {}) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`)
  let fd
  try {
    fd = fs.openSync(temp, 'wx', 0o600)
    fs.writeFileSync(fd, body, 'utf8')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    beforeCommit()
    if (exclusive) fs.linkSync(temp, file)
    else fs.renameSync(temp, file)
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    try { fs.unlinkSync(temp) } catch {}
  }
}

export function writeDoc(target, content, revision) {
  assertTextTarget(target)
  if (revision === undefined) throw storeError('revision-required', 428)
  const currentName = path.basename(target.abs).match(/^(.*)-v(\d+)(\.[^.]+)$/i)
  if (revision !== null && currentName && fs.readdirSync(path.dirname(target.abs)).some(name => {
    const match = name.match(/^(.*)-v(\d+)(\.[^.]+)$/i)
    return match && match[1].toLowerCase() === currentName[1].toLowerCase() && match[3].toLowerCase() === currentName[3].toLowerCase() && Number(match[2]) > Number(currentName[2])
  })) throw storeError('historical-version', 409)
  const body = String(content ?? '')
  const check = () => {
    let current = null
    try { current = digest(fs.readFileSync(target.abs)) } catch (err) { if (err.code !== 'ENOENT') throw err }
    if (current !== revision) throw storeError('document-conflict', 409)
  }
  check()
  try { atomicWrite(target.abs, body, { exclusive: revision === null, beforeCommit: check }) }
  catch (err) { if (err.code === 'EEXIST') throw storeError('document-conflict', 409); throw err }
  return readDoc(target)
}

export function createVersion(target, content) {
  assertTextTarget(target)
  const dir = path.dirname(target.abs)
  const ext = path.extname(target.abs)
  const stem = path.basename(target.abs, ext).replace(/-v\d+$/i, '')
  const versions = fs.readdirSync(dir).map((name) => {
    if (path.extname(name).toLowerCase() !== ext.toLowerCase()) return 0
    const match = path.basename(name, path.extname(name)).match(/^(.*)-v(\d+)$/i)
    return match && match[1].toLowerCase() === stem.toLowerCase() ? Number(match[2]) : 0
  })
  let version = Math.max(1, ...versions) + 1
  for (let tries = 0; tries < 100; tries++, version++) {
    const next = { ...target, abs: path.join(dir, `${stem}-v${version}${ext}`) }
    try { return writeDoc(next, content, null) }
    catch (err) { if (err.status !== 409) throw err }
  }
  throw storeError('version-conflict', 409)
}

export function deleteDoc(target, revision) {
  if (revision === undefined) throw storeError('revision-required', 428)
  if (readDoc(target).revision !== revision) throw storeError('document-conflict', 409)
  fs.unlinkSync(target.abs)
}
