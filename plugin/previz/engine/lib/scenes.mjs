/**
 * 多场景项目：`<project>/scenes.json` + `<project>/scenes/<sceneId>/{set,blocking,shots}.json`。
 *
 * 兼容旧结构（单场景，文件在项目根）。新结构优先；没有任何 scenes.json 时退回旧结构。
 * 每个场景独立构建/渲染/QC，产物落在 `<out>/<sceneId>/`，最后拼一条跨场景 animatic。
 */
import fs from 'node:fs'
import path from 'node:path'

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** 返回 [{id, dir, set, blocking, shots}]；旧结构返回单元素。 */
export function loadScenes(projectDir) {
  const root = path.resolve(projectDir)
  const manifestPath = path.join(root, 'scenes.json')
  if (!fs.existsSync(manifestPath)) {
    const needed = ['set.json', 'blocking.json', 'shots.json']
    const missing = needed.filter((f) => !fs.existsSync(path.join(root, f)))
    if (missing.length) throw new Error(`缺少 ${missing.join(', ')}（或提供 scenes.json 走多场景）`)
    return [{ id: readJson(path.join(root, 'shots.json')).scene || 'S01', dir: root, legacy: true }]
  }
  const manifest = readJson(manifestPath)
  if (!Array.isArray(manifest.scenes) || !manifest.scenes.length) throw new Error('scenes.json 里 scenes 必须是非空数组')
  const out = []
  for (const entry of manifest.scenes) {
    const id = String(entry.id || '').trim()
    if (!id) throw new Error('scenes.json 里有场景缺 id')
    const dir = path.join(root, entry.dir || path.join('scenes', id))
    for (const f of ['set.json', 'blocking.json', 'shots.json']) {
      if (!fs.existsSync(path.join(dir, f))) throw new Error(`场景 ${id} 缺 ${f}（${dir}）`)
    }
    const shots = readJson(path.join(dir, 'shots.json'))
    if (shots.scene && shots.scene !== id) throw new Error(`场景 ${id} 的 shots.json.scene 是 ${shots.scene}，不一致`)
    out.push({ id, dir, title: entry.title || id })
  }
  return out
}

export function isMultiScene(projectDir) {
  return fs.existsSync(path.join(path.resolve(projectDir), 'scenes.json'))
}
