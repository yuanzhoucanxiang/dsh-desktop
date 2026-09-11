/**
 * Host half of @dsh-local/writing-mode — cordis 插件入口 + HTTP 分发。
 *
 * 分层（见 CONTRACT.md）：
 *   lib/store.js   库根 / 扫描 / 读写 / 路径安全
 *   lib/domain.js  门禁 / 台账 / AI 路由与补全
 *   本文件          inject + /api/writing-mode 路由
 */
import path from 'node:path'
import {
  readConfig,
  writeConfig,
  normalizePrefs,
  effectiveRoots,
  resolveUnderRoots,
  scanTree,
  newDraftPath,
  readDoc,
  writeDoc,
  createVersion,
  deleteDoc,
  findProjectRoot,
} from './lib/store.js'
import { assist, recommend, runGates, ledgerSummary } from './lib/domain.js'
import fs from 'node:fs'
import { listTemplates, renderTemplate } from './lib/templates.js'

export const name = 'writing-mode'
/** webServer=文档库 API；llm=辅助写作（缺 llm 时 assist 501，不拖垮插件树）。 */
export const inject = ['webServer', 'llm', 'agentDefaultModel']

const API = '/api/writing-mode'

function isLoopbackRequest(req) {
  const addr = String(req?.socket?.remoteAddress ?? '')
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function trustedRequest(req) {
  if (!isLoopbackRequest(req)) return false
  try {
    const origin = new URL(`http://${req.headers.host}`)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) return false
    if (req.headers.origin && req.headers.origin !== origin.origin) return false
    return !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])
  } catch { return false }
}

function publicPrefs(prefs) {
  const { aiApiKey, ...rest } = prefs
  return { ...rest, aiKeyConfigured: Boolean(aiApiKey) }
}
function publicConfig(cfg) { return { ...cfg, prefs: publicPrefs(cfg.prefs) } }

function writeJson(res, status, obj) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(obj))
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => {
      data += String(chunk)
      if (data.length > 4e6) req.destroy()
    })
    req.on('end', () => resolve(data))
    req.on('aborted', () => resolve(''))
    req.on('error', () => resolve(''))
  })
}

async function readJsonBody(req) {
  try {
    const body = JSON.parse((await readBody(req)) || '{}')
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null
  } catch {
    return null
  }
}

export function apply(ctx) {
  const c = ctx
  if (!c || !c.webServer || typeof c.webServer.register !== 'function') {
    console.warn('[writing-mode] webServer unavailable, host API disabled')
    return
  }
  ctx.effect(() =>
    c.webServer.register({
      kind: 'exact',
      path: API,
      handler: async (req, res) => {
        if (!trustedRequest(req)) {
          writeJson(res, 403, { ok: false, error: 'forbidden' })
          return
        }
        if (req.method === 'POST' && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
          writeJson(res, 415, { ok: false, error: 'json-required' })
          return
        }
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        const route = url.searchParams.get('route') || ''
        let cfg = readConfig()

        if (req.method === 'GET' && (route === 'config' || route === 'list' || route === '')) {
          const roots = effectiveRoots(cfg)
          writeJson(res, 200, {
            ok: true,
            config: publicConfig(cfg),
            prefs: publicPrefs(cfg.prefs),
            roots: roots.map((r) => ({
              path: r.path,
              label: r.label,
              default: r.default,
              missing: r.missing,
            })),
            tree: scanTree(cfg),
          })
          return
        }

        if (req.method === 'GET' && route === 'tree') {
          writeJson(res, 200, { ok: true, tree: scanTree(cfg) })
          return
        }

        if (req.method === 'POST' && route === 'prefs') {
          const parsed = await readJsonBody(req)
          if (parsed === null) {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          cfg = readConfig()
          cfg.prefs = normalizePrefs({ ...cfg.prefs, ...parsed })
          try {
            writeConfig(cfg)
          } catch (err) {
            writeJson(res, 500, { ok: false, error: String(err?.message || err) })
            return
          }
          writeJson(res, 200, { ok: true, prefs: publicPrefs(cfg.prefs) })
          return
        }

        if (req.method === 'POST' && route === 'roots') {
          const parsed = await readJsonBody(req)
          if (parsed === null) {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          const mode = String(parsed?.mode || 'set')
          cfg = readConfig()
          if (mode === 'set') {
            const roots = Array.isArray(parsed.roots) ? parsed.roots : []
            cfg = {
              roots: roots
                .filter((r) => r && typeof r.path === 'string')
                .map((r) => ({
                  path: path.resolve(String(r.path)),
                  label: String(r.label || path.basename(String(r.path)) || r.path),
                  default: Boolean(r.default),
                })),
              activeRoot:
                typeof parsed.activeRoot === 'string' && parsed.activeRoot !== ''
                  ? path.resolve(parsed.activeRoot)
                  : null,
              prefs: cfg.prefs,
            }
          } else if (mode === 'add') {
            if (typeof parsed.path !== 'string' || !path.isAbsolute(parsed.path)) {
              writeJson(res, 400, { ok: false, error: 'bad-path' })
              return
            }
            const p = path.resolve(parsed.path)
            if (!cfg.roots.some((r) => path.resolve(r.path).toLowerCase() === p.toLowerCase())) {
              cfg.roots.push({
                path: p,
                label: String(parsed?.label || path.basename(p) || p),
                default: cfg.roots.length === 0,
              })
            }
            if (parsed?.active === true || cfg.activeRoot === null) cfg.activeRoot = p
          } else if (mode === 'remove') {
            const p = path.resolve(String(parsed?.path || ''))
            cfg.roots = cfg.roots.filter((r) => path.resolve(r.path).toLowerCase() !== p.toLowerCase())
            if (cfg.activeRoot && path.resolve(cfg.activeRoot).toLowerCase() === p.toLowerCase()) {
              cfg.activeRoot = cfg.roots[0] ? cfg.roots[0].path : null
            }
          } else if (mode === 'activate') {
            const p = path.resolve(String(parsed?.path || ''))
            if (!cfg.roots.some((r) => path.resolve(r.path).toLowerCase() === p.toLowerCase())) {
              writeJson(res, 400, { ok: false, error: 'unknown-root' })
              return
            }
            cfg.activeRoot = p
          } else {
            writeJson(res, 400, { ok: false, error: 'bad-mode' })
            return
          }
          try {
            writeConfig(cfg)
          } catch (err) {
            writeJson(res, 500, { ok: false, error: String(err?.message || err) })
            return
          }
          writeJson(res, 200, { ok: true, config: publicConfig(cfg), tree: scanTree(cfg) })
          return
        }

        if (req.method === 'GET' && route === 'get') {
          const target = resolveUnderRoots(url.searchParams.get('path') || '', effectiveRoots(cfg))
          if (target === null) {
            writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
            return
          }
          try {
            writeJson(res, 200, { ok: true, doc: readDoc(target) })
          } catch (err) {
            writeJson(res, 404, { ok: false, error: String(err?.message || err) })
          }
          return
        }

        if (req.method === 'POST' && (route === 'save' || route === 'version')) {
          const parsed = await readJsonBody(req)
          if (parsed === null) {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          const roots = effectiveRoots(cfg)
          let targetPath = parsed?.path
          if (!targetPath && route === 'save') {
            const rootPath =
              (typeof parsed?.root === 'string' && parsed.root) ||
              cfg.activeRoot ||
              (roots.find((r) => r.real) || {}).real
            if (!rootPath) {
              writeJson(res, 400, { ok: false, error: 'no-root' })
              return
            }
            targetPath = newDraftPath(rootPath, parsed?.title)
          }
          const target = resolveUnderRoots(targetPath, roots)
          if (target === null) {
            writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
            return
          }
          try {
            const doc = route === 'version'
              ? createVersion(target, parsed.content)
              : writeDoc(target, parsed.content, parsed.revision)
            writeJson(res, 200, { ok: true, doc })
          } catch (err) {
            writeJson(res, err.status || 500, { ok: false, error: String(err?.message || err) })
          }
          return
        }

        if (req.method === 'POST' && route === 'delete') {
          const parsed = await readJsonBody(req)
          if (parsed === null) {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          const target = resolveUnderRoots(parsed?.path || '', effectiveRoots(cfg))
          if (target === null) {
            writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
            return
          }
          try {
            deleteDoc(target, parsed.revision)
            writeJson(res, 200, { ok: true })
          } catch (err) {
            writeJson(res, err.status || 500, { ok: false, error: String(err?.message || err) })
          }
          return
        }

        if (req.method === 'POST' && route === 'assist') {
          const parsed = await readJsonBody(req)
          if (parsed === null) {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          if (parsed.path) {
            const target = resolveUnderRoots(parsed.path, effectiveRoots(cfg))
            if (!target) {
              writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
              return
            }
            parsed.path = target.abs
          }
          if (parsed?.action === 'research' || parsed?.action === 'spark') {
            const r = await recommend(ctx, parsed, cfg.prefs)
            writeJson(res, r.status, {
              ok: true,
              result: r.result,
              fallback: Boolean(r.fallback),
              knowledge: r.knowledge || [],
              web: r.web || [],
              queries: r.queries || [],
            })
            return
          }
          const r = await assist(ctx, parsed, cfg.prefs)
          writeJson(
            res,
            r.status,
            r.ok ? { ok: true, result: r.result } : { ok: false, error: r.error }
          )
          return
        }

        if (req.method === 'POST' && route === 'gate') {
          const parsed = await readJsonBody(req)
          if (parsed === null) {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          let content = parsed?.content
          let filePath = parsed?.path || ''
          if (typeof content !== 'string') {
            if (!filePath) {
              writeJson(res, 400, { ok: false, error: 'need-content-or-path' })
              return
            }
            const target = resolveUnderRoots(filePath, effectiveRoots(cfg))
            if (target === null) {
              writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
              return
            }
            try {
              const doc = readDoc(target)
              content = doc.content
              filePath = doc.path
            } catch (err) {
              writeJson(res, 404, { ok: false, error: String(err?.message || err) })
              return
            }
          }
          writeJson(res, 200, { ok: true, gate: runGates(filePath, content), path: filePath })
          return
        }

        if (req.method === 'POST' && route === 'ledger') {
          const parsed = await readJsonBody(req)
          if (parsed === null) {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          const roots = effectiveRoots(cfg)
          const target = resolveUnderRoots(parsed?.path || '', roots)
          if (target === null) {
            writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
            return
          }
          const proj = findProjectRoot(target.abs)
          if (!proj) {
            writeJson(res, 200, { ok: true, ledger: null })
            return
          }
          if (resolveUnderRoots(proj, roots) === null) {
            writeJson(res, 400, { ok: false, error: 'project-outside-roots' })
            return
          }
          writeJson(res, 200, { ok: true, ledger: ledgerSummary(proj, target.abs) })
          return
        }

        if (req.method === 'GET' && route === 'templates') {
          writeJson(res, 200, { ok: true, templates: listTemplates() })
          return
        }

        if (req.method === 'POST' && route === 'create-project') {
          const parsed = await readJsonBody(req)
          if (parsed === null) {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          const title = String(parsed.title || '').trim() || '未命名项目'
          const premise = String(parsed.premise || '').trim()
          const tmpl = renderTemplate(parsed.templateId || 'novel', title, premise)
          // 项目目录名：去掉非法路径字符
          const dirName = title.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40) || '未命名项目'
          const roots = effectiveRoots(cfg)
          const rootPath =
            (typeof parsed.root === 'string' && parsed.root) ||
            cfg.activeRoot ||
            (roots.find((r) => r.real) || {}).real
          if (!rootPath) {
            writeJson(res, 400, { ok: false, error: 'no-root' })
            return
          }
          const projectAbs = path.join(rootPath, dirName)
          if (fs.existsSync(path.join(projectAbs, 'project.md'))) {
            writeJson(res, 409, { ok: false, error: 'project-exists', path: projectAbs })
            return
          }
          const target = resolveUnderRoots(projectAbs, roots)
          if (target === null) {
            writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
            return
          }
          const written = []
          try {
            for (const f of tmpl.files) {
              if (!f.rel || f.rel.endsWith('.gitkeep')) continue
              const abs = path.join(target.abs, ...f.rel.split('/'))
              fs.mkdirSync(path.dirname(abs), { recursive: true })
              fs.writeFileSync(abs, f.body, 'utf8')
              written.push(f.rel)
            }
          } catch (err) {
            writeJson(res, 500, { ok: false, error: String(err?.message || err) })
            return
          }
          writeJson(res, 200, {
            ok: true,
            project: { name: dirName, path: target.abs, template: tmpl.id, files: written },
            tree: scanTree(cfg),
          })
          return
        }

        writeJson(res, 404, { ok: false, error: 'unknown-route' })
      },
    })
  )
}
