/**
 * 项目注册表（纯 Node）：扫描 root 下的项目目录，按 id 解析，创建 starter。
 * 默认 root = <package>/fixtures；可用 PREVIZ_PROJECTS 覆盖。
 * `project.json.fixture === true` 的目录（如 bad-occlusion）不列出，避免污染“可选项目”。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMultiScene, loadScenes } from './scenes.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PACKAGE_ROOT = path.dirname(__dirname)
export const DEFAULT_PROJECTS_ROOT = path.join(PACKAGE_ROOT, 'fixtures')
export const STARTER = path.join(PACKAGE_ROOT, 'fixtures', 'boutique')

export function projectsRoot(env = process.env) {
  return path.resolve(env.PREVIZ_PROJECTS || DEFAULT_PROJECTS_ROOT)
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function readProjectMeta(dir) {
  const meta = readJson(path.join(dir, 'project.json'))
  if (!meta) return null
  return {
    id: String(meta.id || path.basename(dir)),
    title: String(meta.title || meta.id || path.basename(dir)),
    aspect: meta.aspect || '16:9',
    fps: Number(meta.fps) || 24,
    fixture: meta.fixture === true,
    path: dir,
  }
}

export function listProjects(root = projectsRoot()) {
  if (!fs.existsSync(root)) return []
  const out = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(root, entry.name)
    const meta = readProjectMeta(dir)
    if (!meta || meta.fixture) continue
    // 单场景：根目录三个 JSON；多场景：scenes.json + 场景目录。
    // 之前只查根目录，导致多场景项目在列表里永远 valid:false，UI 不可选。
    let missing = []
    let scenes = null
    if (isMultiScene(dir)) {
      try {
        scenes = loadScenes(dir).map((s) => s.id)
      } catch (err) {
        missing = [`scenes: ${err.message}`]
      }
    } else {
      missing = ['set.json', 'blocking.json', 'shots.json'].filter((f) => !fs.existsSync(path.join(dir, f)))
    }
    out.push({ ...meta, multiScene: scenes !== null, scenes, valid: missing.length === 0, missing })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

/** 支持绝对/相对路径，或 root 下的 project id。 */
export function resolveProjectRef(ref, root = projectsRoot()) {
  if (!ref) {
    const first = listProjects(root).find((p) => p.valid)
    return first ? first.path : null
  }
  const abs = path.resolve(ref)
  if (fs.existsSync(path.join(abs, 'project.json'))) return abs
  const hit = listProjects(root).find((p) => p.id === ref || path.basename(p.path) === ref)
  return hit ? hit.path : null
}

export function scaffoldProject({ root = projectsRoot(), id, title, from = STARTER } = {}) {
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('project id 只能包含字母/数字/._-')
  const dest = path.join(path.resolve(root), id)
  if (fs.existsSync(dest)) throw new Error(`项目已存在：${dest}`)
  if (!fs.existsSync(path.join(from, 'project.json'))) throw new Error(`starter 不存在：${from}`)
  fs.mkdirSync(dest, { recursive: true })
  for (const f of ['project.json', 'set.json', 'blocking.json', 'shots.json', 'storyboard.csv']) {
    const src = path.join(from, f)
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dest, f))
  }
  const metaPath = path.join(dest, 'project.json')
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  meta.id = id
  meta.title = title || meta.title || id
  meta.fixture = false
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8')
  return dest
}
