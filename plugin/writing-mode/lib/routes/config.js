/**
 * 库根与配置域路由（'' / config / list / tree / prefs / roots）。
 * 从 index.js 原样搬出，行为不变；ctx = { req, res, url, cfg }。
 */
import fs from 'node:fs'
import path from 'node:path'
import { readConfig, updateConfig, storeError, normalizePrefs, effectiveRoots, scanTree } from '../store.js'
import { writeJson, readJsonBody } from '../http.js'

export function publicPrefs(prefs) {
  const { aiApiKey, ...rest } = prefs
  return { ...rest, aiKeyConfigured: Boolean(aiApiKey) }
}
export function publicConfig(cfg) { return { ...cfg, prefs: publicPrefs(cfg.prefs) } }

/** GET '' / config / list：配置 + 库根 + 文档树一次给全（client 启动的第一口）。 */
export async function getConfigList({ req, res, cfg }) {
  const roots = effectiveRoots(cfg)
  writeJson(res, 200, {
    ok: true,
    config: publicConfig(cfg),
    prefs: publicPrefs(cfg.prefs),
    // V2：损坏不得静默降级成「没有库根」，否则作者只看到一个空列表
    configError: cfg.__damaged ? (cfg.configError || 'corrupt-config') : null,
    configBackup: cfg.configBackup || null,
    roots: roots.map((r) => ({
      path: r.path,
      label: r.label,
      default: r.default,
      kind: r.kind,
      missing: r.missing,
    })),
    tree: scanTree(cfg),
  })
}

/** GET tree：只要文档树。 */
export async function getTree({ res, cfg }) {
  writeJson(res, 200, { ok: true, tree: scanTree(cfg) })
}

/** POST prefs：设置补丁（V2：读-改-写在同一个锁内完成）。 */
export async function postPrefs({ req, res }) {
  const parsed = await readJsonBody(req)
  if (parsed === null) {
    writeJson(res, 400, { ok: false, error: 'invalid-json' })
    return
  }
  try {
    // V2：读-改-写在同一个锁内完成。两个窗口同时操作（一个绑伙伴会话、
    // 一个改字号）原本必丢一次更新，因为三条写配置的路由各自 readConfig→writeConfig。
    const out = updateConfig((cur) => ({ ...cur, prefs: normalizePrefs({ ...cur.prefs, ...parsed }) }))
    writeJson(res, 200, { ok: true, prefs: publicPrefs(out.prefs), revision: out.revision })
  } catch (err) {
    writeJson(res, err.status || 500, { ok: false, error: String(err?.code || err?.message || err) })
  }
}

/** POST roots：库根增删/激活/整表替换。 */
export async function postRoots({ req, res }) {
  const parsed = await readJsonBody(req)
  if (parsed === null) {
    writeJson(res, 400, { ok: false, error: 'invalid-json' })
    return
  }
  const mode = String(parsed?.mode || 'set')
  if (!['set', 'add', 'remove', 'activate'].includes(mode)) {
    writeJson(res, 400, { ok: false, error: 'bad-mode' })
    return
  }
  if (mode === 'add' && (typeof parsed.path !== 'string' || !path.isAbsolute(parsed.path))) {
    writeJson(res, 400, { ok: false, error: 'bad-path' })
    return
  }
  try {
    // V2：整段读-改-写进锁；校验也在锁内重做，避免按陈旧的 roots 判定成员关系
    const out = updateConfig((cur) => {
      const next = { ...cur }
      if (mode === 'set') {
        const roots = Array.isArray(parsed.roots) ? parsed.roots : []
        next.roots = roots
          .filter((r) => r && typeof r.path === 'string')
          .map((r) => ({
            path: path.resolve(String(r.path)),
            label: String(r.label || path.basename(String(r.path)) || r.path),
            default: Boolean(r.default),
            kind: r.kind === 'project' ? 'project' : (cur.roots.find(old => path.resolve(old.path) === path.resolve(r.path))?.kind || 'library'),
          }))
        next.activeRoot =
          typeof parsed.activeRoot === 'string' && parsed.activeRoot !== ''
            ? path.resolve(parsed.activeRoot)
            : null
      } else if (mode === 'add') {
        const p = path.resolve(parsed.path)
        if (parsed.kind !== undefined && !['project', 'library'].includes(parsed.kind)) throw storeError('bad-root-kind', 400)
        if (parsed.kind === 'project' && (!fs.existsSync(p) || !fs.statSync(p).isDirectory())) throw storeError('project-directory-missing', 400)
        if (parsed.kind === 'project') next.roots = next.roots.map(r => path.resolve(r.path).toLowerCase() === p.toLowerCase() ? { ...r, kind: 'project' } : r)
        if (!next.roots.some((r) => path.resolve(r.path).toLowerCase() === p.toLowerCase())) {
          next.roots = [...next.roots, {
            path: p,
            label: String(parsed?.label || path.basename(p) || p),
            default: next.roots.length === 0,
            kind: parsed.kind === 'project' ? 'project' : 'library',
          }]
        }
        if (parsed?.active === true || next.activeRoot === null) next.activeRoot = p
      } else if (mode === 'remove') {
        const p = path.resolve(String(parsed?.path || ''))
        next.roots = next.roots.filter((r) => path.resolve(r.path).toLowerCase() !== p.toLowerCase())
        if (next.activeRoot && path.resolve(next.activeRoot).toLowerCase() === p.toLowerCase()) {
          next.activeRoot = next.roots[0] ? next.roots[0].path : null
        }
      } else {
        const p = path.resolve(String(parsed?.path || ''))
        if (!next.roots.some((r) => path.resolve(r.path).toLowerCase() === p.toLowerCase())) {
          throw storeError('unknown-root', 400)
        }
        next.activeRoot = p
      }
      return next
    })
    writeJson(res, 200, { ok: true, config: publicConfig(out), tree: scanTree(out), revision: out.revision })
  } catch (err) {
    writeJson(res, err.status || 500, { ok: false, error: String(err?.code || err?.message || err) })
  }
}
