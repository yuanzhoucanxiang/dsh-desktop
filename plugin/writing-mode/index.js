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
  updateConfig,
  storeError,
  normalizePrefs,
  effectiveRoots,
  resolveUnderRoots,
  scanTree,
  newDraftPath,
  readDoc,
  writeDoc,
  writeExportFile,
  createVersion,
  deleteDoc,
  findProjectRoot,
  resolveProjectDir,
  ensureCompanionPreset,
  prepareProjectTarget,
  isSafeTemplateRel,
  createTemplateFile,
  realOrNull,
  listProjectFiles,
} from './lib/store.js'
import { withFileLock } from './lib/file-lock.js'
import { COMPANION_PRESET } from './lib/companion-preset.js'
import { assist, recommend, runGates, ledgerSummary, outlineSummary } from './lib/domain.js'
import { latestOfSeries, naturalSortFiles, chapterTitle, safeBookTitle, compileBook } from './lib/compile.js'
import { renderArchiveHtml, docGroupOf, docGroupRank, docLabelOf, premiseOf } from './lib/archive-html.js'
import { seedBaseline, recordSave, projectStatsFor } from './lib/writing-stats.js'
import { reorderDraftSeries } from './lib/reorder.js'
import {
  readMemory,
  applyMemoryOp,
  injectableItems,
  memoryError,
  memoryApiPayload,
  getOperationReceipt,
  syncSettingProjection,
  quotaOf,
} from './lib/project-memory.js'
import {
  readSettingProjection,
  writeSettingProjection,
  renderSettingProjection,
  projectDirOf,
  hashText,
  PROJECTION_REL,
} from './lib/setting-projection.js'
import {
  readCheckpoint,
  writeCheckpoint,
  listCheckpoints,
  damagedCheckpointHash,
  recoverDamagedCheckpoint,
  checkpointMeta,
  MAX_DRAFT_LIST,
  listDraftLocks,
  listStaleDraftLocks,
} from './lib/draft-checkpoints.js'
import {
  claimCoordination,
  markCreatingCoordination,
  confirmCoordination,
  markUncertainCoordination,
  releaseCoordination,
  forgetCoordination,
  readCoordination,
  listCoordinationLocks,
  listStaleCoordinationLocks,
} from './lib/coordination.js'
import fs from 'node:fs'
import { relocationCandidates, recoverRelocation, relocationHistory } from './lib/project-recovery.js'
import { listTemplates, renderTemplate, renderStarter, PROJECT_RESOURCES } from './lib/templates.js'

/** 记录里的内部判定字段不进响应（结果单独放在 outcome）。 */
const stripOutcome = ({ _outcome, ...record }) => record

export const name = 'writing-mode'
/** webServer=文档库 API；llm=文字工具；agentDefaultModel=全局工具模型选择。 */
export const inject = ['webServer', 'llm', 'agentDefaultModel']

const API = '/api/writing-mode'

/** CONTRACT.md：HTTP body ≤ 1 MiB。按**字节**计，不是 UTF-16 字符数。导出供回归测试直接校验。 */
export const MAX_BODY_BYTES = 1024 * 1024

/**
 * V8：路由 × 方法白名单。
 * 原来只按 route 匹配、不看 method，于是 PUT/DELETE/PATCH 能绕过「仅 POST」的
 * application/json 门禁，而 project-recovery 在非 GET 方法下一律进**写**分支。
 * trustedRequest 把缺失的 sec-fetch-site 视为可信（本地非浏览器进程可直连），
 * 方法白名单是仅剩的一层，不能缺。
 */
export const ROUTE_METHODS = {
  '': ['GET'],
  config: ['GET'],
  list: ['GET'],
  tree: ['GET'],
  templates: ['GET'],
  get: ['GET'],
  'memory-operation': ['GET'],
  maintenance: ['GET', 'POST'],
  memory: ['GET', 'POST'],
  'setting-projection': ['GET', 'POST'],
  companion: ['GET', 'POST'],
  draft: ['GET', 'POST'],
  'world-draft': ['GET', 'POST'],
  'project-recovery': ['GET', 'POST'],
  coordination: ['GET', 'POST'],
  prefs: ['POST'],
  roots: ['POST'],
  save: ['POST'],
  version: ['POST'],
  delete: ['POST'],
  assist: ['POST'],
  gate: ['POST'],
  ledger: ['POST'],
  stats: ['GET'],
  outline: ['GET'],
  reorder: ['POST'],
  'create-project': ['POST'],
  'project-resource': ['POST'],
  compile: ['POST'],
  'archive-export': ['POST'],
  wiki: ['GET'],
}

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

/**
 * 档案页的数据组装：`archive-export`（落盘）与 `wiki`（当页面看）共用同一份口径，
 * 免得两个出口对「什么算已确认设定」「哪篇算当前版」各说各话。
 * 抛出的错误带 status/code，由调用方原样回给客户端——这里不决定「是文件还是页面」。
 */
function assembleArchiveModel(projectReal, prefs, titleOverride, extra) {
  const mem = readMemory(projectReal)
  if (mem?.error) throw storeError('memory-' + mem.error, 409)
  const items = mem?.memory?.items || []
  const isWorld = (it) => it.kind === 'fact' && it.setting?.type === 'world'
  const confirmed = items.filter((it) => it.status === 'confirmed')
  const settings = confirmed.filter(isWorld).map((it) => ({
    title: it.setting?.title || '',
    conclusion: it.setting?.conclusion || it.text || '',
    explanation: it.setting?.explanation || '',
    boundaries: it.setting?.boundaries || '',
    tags: it.setting?.tags || [],
    sources: it.setting?.sources || [],
    fromKind: it.source?.kind || 'author',
  }))
  const plainItems = confirmed.filter((it) => !isWorld(it)).map((it) => ({ kind: it.kind, text: it.text }))
  const outline = outlineSummary(projectReal)
  const statsFound = projectStatsFor(projectReal, { spanDays: 14 })
  const allFiles = listProjectFiles(projectReal)
  const docFiles = naturalSortFiles(latestOfSeries(allFiles.filter((f) => !f.rel.startsWith('draft/'))).latest)
    .sort((a, b) => docGroupRank(docGroupOf(a.rel)) - docGroupRank(docGroupOf(b.rel))
      || String(a.rel).localeCompare(String(b.rel), 'zh', { numeric: true }))
  const docs = []
  try {
    for (const f of docFiles) {
      docs.push({
        rel: f.rel,
        label: docLabelOf(f.rel, f.name),
        group: docGroupOf(f.rel),
        content: fs.readFileSync(f.abs, 'utf8'),
        markdown: /\.(md|markdown)$/i.test(f.name),
      })
    }
  } catch {
    // 扫描到读取之间文件被移走：如实报，不半成品
    throw storeError('source-changed', 409)
  }
  const bookTitle = safeBookTitle(String(titleOverride || '').trim() || path.basename(projectReal))
  if (!bookTitle) throw storeError('invalid-title', 400)
  const projectDoc = docs.find((d) => String(d.rel).toLowerCase() === 'project.md')
  const html = renderArchiveHtml({
    title: bookTitle,
    premise: premiseOf(projectDoc?.content || ''),
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    settings,
    proposedCount: items.filter((it) => it.status === 'proposed').length,
    plainItems,
    chapters: outline.rows.map((r) => ({ ...r, name: chapterTitle(r.name) })),
    stats: statsFound?.summary || null,
    dailyGoal: normalizePrefs(prefs).dailyGoal || 0,
    ledger: ledgerSummary(projectReal, outline.rows[0]?.abs),
    docs,
    ...(extra || {}),
  })
  return { html, bookTitle, counts: { settings: settings.length, docs: docs.length, chapters: outline.rows.length } }
}

/**
 * 档案页是「作者自己写的文字 + 我们的模板」拼出来的文档，CSP 把可执行性整个关掉：
 * 页面本来就没有脚本（导航全靠锚点与相对链接），这条头是第二道防线——稿子里的 <script>
 * 既已被转义，也绝不会被放行执行。样式必须 'unsafe-inline'（单文件自包含的代价）。
 */
const WIKI_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

/**
 * V1（P0）：按字节收集、最后一次性解码。
 *
 * 原写法 `data += String(chunk)` 对每个 chunk 单独做 UTF-8 解码，而 socket 的 chunk
 * 边界与字符边界无关：一个三字节汉字被切开时，两半各自解码失败变成 U+FFFD，
 * 而 JSON.parse 对 U+FFFD 完全合法——于是正文带着乱码一路静默写进手稿文件。
 * 实测：276KB / 92000 码点的中文正文 round-trip 后出现 7 个 U+FFFD。
 * 超限不再静默截断：返回 null 由调用方报错。
 */
export function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    let bytes = 0
    let failed = false
    req.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
      bytes += buf.length
      if (bytes > MAX_BODY_BYTES) {
        failed = true
        req.destroy()
        return
      }
      chunks.push(buf)
    })
    req.on('end', () => resolve(failed ? null : Buffer.concat(chunks).toString('utf8')))
    req.on('aborted', () => resolve(null))
    req.on('error', () => resolve(null))
  })
}

export async function readJsonBody(req) {
  const raw = await readBody(req)
  if (raw === null) return null
  try {
    const body = JSON.parse(raw || '{}')
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null
  } catch {
    return null
  }
}

/**
 * V6：草稿桶的项目身份必须用**规范路径**（resolveUnderRoots 已做过 realpath），
 * 不能用客户端原始串。否则记忆/协调/project-recovery 用规范身份写的桶，
 * UI 拿着原始串读不到（实测：库根经 junction/映射盘访问时恢复写了却永远不显示）。
 */
function draftBucket(rawProject, cfg, route) {
  const suffix = route === 'world-draft' ? '\0world' : ''
  const raw = String(rawProject ?? '')
  if (!raw) return { ok: true, bucket: suffix }
  const t = resolveUnderRoots(raw, effectiveRoots(cfg))
  if (!t) return { ok: false, error: 'path-outside-roots' }
  return { ok: true, bucket: t.abs + suffix }
}

export function apply(ctx) {
  const c = ctx
  if (!c || !c.webServer || typeof c.webServer.register !== 'function') {
    console.warn('[writing-mode] webServer unavailable, host API disabled')
    return
  }
  // CXR01（2026-09-22 独立复核，P1）：启动时**只诊断、不清扫**。
  // 原先这里会把持有者进程已消失的残留锁改名隔离。复核证明这是不安全的：
  // check-then-rename 无法原子化，复核之后、改名之前若有写入者取得了该锁，
  // 就会把**那把活锁**移走，于是两个写入方临界区重叠、静默覆写。
  // 而内核启动完全可能与另一个进程（另一个桌面实例/另一个内核）的写入并发，所以这里同样不安全。
  // 改为只把确切路径打进日志并暴露给 maintenance 接口，由作者关闭应用后手动删除。
  // 代价：崩溃留下的残留锁会卡着那个桶（每次保存快速报 lock-stale）直到手动处理——
  // 宁可一个桶暂时不可写，也不要两个写入方重叠。
  try {
    const stale = [...listStaleDraftLocks(), ...listStaleCoordinationLocks()]
    if (stale.length) {
      console.warn(`[writing-mode] 发现 ${stale.length} 个残留锁（持有进程已退出）；出于互斥安全不会自动移动，请关闭桌面版后手动删除：${stale.map((r) => r.path).join(', ')}`)
    }
  } catch (err) {
    console.warn(`[writing-mode] 残留锁诊断失败（不阻止启动）：${err?.message || err}`)
  }
  // 0.1.7 起内核不再扫 ~/.dsh/.agent-presets：写作伙伴 preset 改为向 registry 自举注册。
  // 判据 = registry 同时暴露 register/composeFrom；旧内核没有该服务 → 跳过（走旧 select 路）。
  // Duplicate 视为已成功（幂等）；其它失败重置 promise，prepare 路由里可重试。
  let presetRegistration = null
  const ensurePresetRegistered = () => {
    if (presetRegistration) return presetRegistration
    const registry = typeof c.get === 'function' ? c.get('agentPresets') : null
    if (!registry || typeof registry.register !== 'function' || typeof registry.composeFrom !== 'function') {
      presetRegistration = Promise.resolve(null)
      return presetRegistration
    }
    presetRegistration = Promise.resolve()
      .then(() => registry.register(JSON.parse(JSON.stringify(COMPANION_PRESET))))
      .then((unregister) => ({ unregister }))
      .catch((err) => {
        if (/Duplicate agent preset/.test(String(err?.message || err))) return { unregister: null }
        presetRegistration = null
        throw err
      })
    return presetRegistration
  }
  // 抢先注册（fire-and-forget），插件卸载时回收；失败只告警，prepare 路由会再试。
  ctx.effect(() => {
    let unregister = null
    let settled = false
    ensurePresetRegistered()
      .then((reg) => { if (settled) reg?.unregister?.(); else unregister = reg?.unregister || null })
      .catch((err) => console.warn(`[writing-mode] 写作伙伴 preset 注册失败（建伙伴会话时会重试）：${err?.message || err}`))
    return () => { settled = true; unregister?.() }
  })
  ctx.effect(() =>
    c.webServer.register({
      kind: 'exact',
      path: API,
      handler: async (req, res) => {
        if (!trustedRequest(req)) {
          writeJson(res, 403, { ok: false, error: 'forbidden' })
          return
        }
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        const route = url.searchParams.get('route') || ''
        // V8：方法白名单先于一切业务分支
        const allowed = Object.prototype.hasOwnProperty.call(ROUTE_METHODS, route) ? ROUTE_METHODS[route] : null
        if (!allowed) {
          writeJson(res, 404, { ok: false, error: 'unknown-route' })
          return
        }
        if (!allowed.includes(req.method)) {
          writeJson(res, 405, { ok: false, error: 'method-not-allowed', allowed })
          return
        }
        if (req.method !== 'GET' && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
          writeJson(res, 415, { ok: false, error: 'json-required' })
          return
        }
        // V1：声明长度超限直接 413（流式兵底在 readBody 里，走到那里只能给 400）
        const declared = Number(req.headers['content-length'])
        if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
          writeJson(res, 413, { ok: false, error: 'body-too-large', maxBytes: MAX_BODY_BYTES })
          return
        }
        let cfg = readConfig()
        // V2：配置损坏时不再假装成「首次使用」：写接口一律拒，读接口如实报出来
        if (cfg.__damaged && req.method !== 'GET') {
          writeJson(res, 409, {
            ok: false,
            error: cfg.configError || 'corrupt-config',
            backup: cfg.configBackup || null,
            hint: '配置文件已损坏，原件已保留且未被覆盖；恢复 writing-mode.json 后才能再改设置。',
          })
          return
        }

        if (req.method === 'GET' && (route === 'config' || route === 'list' || route === '')) {
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
          return
        }

        if ((req.method === 'GET' || req.method === 'POST') && route === 'companion') {
          const body = req.method === 'POST' ? await readJsonBody(req) : { path: url.searchParams.get('path') }
          cfg = readConfig()
          const target = body && resolveUnderRoots(body.path, effectiveRoots(cfg))
          if (!target || !fs.existsSync(target.abs)) return writeJson(res, 400, { ok: false, error: 'bad-path' })
          const directory = fs.statSync(target.abs).isDirectory()
          const project = findProjectRoot(directory ? path.join(target.abs, 'project.md') : target.abs) || (directory ? target.abs : path.dirname(target.abs))
          const key = process.platform === 'win32' ? project.toLowerCase() : project
          if (req.method === 'POST' && body.prepare === true) {
            try {
              const preset = ensureCompanionPreset()
              // 0.1.7：文件落盘之外还要向 registry 自举注册（幂等，见上）。
              const reg = await ensurePresetRegistered()
              // Native preset pickers refresh their roster/current label on this
              // public notification; installing files alone does not notify them.
              c.emit?.('settings/document-updated', 'agent-presets')
              return writeJson(res, 200, { ok: true, preset, registered: Boolean(reg) })
            }
            catch (err) { return writeJson(res, 500, { ok: false, error: String(err.message) }) }
          }
          if (req.method === 'POST') {
            if (typeof body.sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(body.sessionId)) return writeJson(res, 400, { ok: false, error: 'bad-session-id' })
            // V2：绑定放进锁内的读-改-写，不再与并发的 prefs / roots 互相覆盖
            try {
              const out = updateConfig((cur) => ({ ...cur, companions: { ...(cur.companions || {}), [key]: body.sessionId } }))
              return writeJson(res, 200, { ok: true, project, sessionId: out.companions?.[key] || null, revision: out.revision })
            } catch (err) {
              return writeJson(res, err.status || 500, { ok: false, error: String(err?.code || err?.message || err) })
            }
          }
          return writeJson(res, 200, { ok: true, project, sessionId: cfg.companions?.[key] || null })
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
          try {
            // V2：读-改-写在同一个锁内完成。两个窗口同时操作（一个绑伙伴会话、
            // 一个改字号）原本必丢一次更新，因为三条写配置的路由各自 readConfig→writeConfig。
            const out = updateConfig((cur) => ({ ...cur, prefs: normalizePrefs({ ...cur.prefs, ...parsed }) }))
            writeJson(res, 200, { ok: true, prefs: publicPrefs(out.prefs), revision: out.revision })
          } catch (err) {
            writeJson(res, err.status || 500, { ok: false, error: String(err?.code || err?.message || err) })
          }
          return
        }

        if (req.method === 'POST' && route === 'roots') {
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
          return
        }

        if (req.method === 'GET' && route === 'get') {
          const target = resolveUnderRoots(url.searchParams.get('path') || '', effectiveRoots(cfg))
          if (target === null) {
            writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
            return
          }
          try {
            const doc = readDoc(target)
            // 打开即播种码字基线：首见稿件只记当前字数、不计增量（防老项目首存虚增）。
            try {
              const proj = findProjectRoot(target.abs)
              if (proj) seedBaseline(proj, target.abs, doc.content)
            } catch {}
            writeJson(res, 200, { ok: true, doc })
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
            // 码字记账在保存成功之后：host 侧权威；version（另存新版）走同一条口径，
            // 新路径首见自动按播种处理，不会把整章存量算成今日净增。
            try {
              const proj = findProjectRoot(doc.path || target)
              if (proj) recordSave(proj, doc.path || target, doc.content ?? parsed.content)
            } catch {}
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

        /**
         * 导出成书：把项目里各章的**当前版**按文档树顺序拼成一份完整书稿，
         * 独占创建在项目根（<书名>-vN.<ext>，可见于文档树；原稿一律只读不动）。
         * body: { path（项目内任意路径）, include?（rel 数组，顺序即章节顺序）, title?, titles? }
         * include 省略时默认收 draft/ 下的文本文件，并按系列只取最新版。
         */
        if (req.method === 'POST' && route === 'compile') {
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
          const found = resolveProjectDir(target.abs, roots)
          const projectReal = found && realOrNull(found)
          if (!projectReal) {
            writeJson(res, 400, { ok: false, error: 'no-project' })
            return
          }
          const scope = [{ path: projectReal, real: projectReal }]
          const files = listProjectFiles(projectReal)
          const byRel = new Map(files.map((f) => [f.rel.toLowerCase(), f]))
          let selected = []
          let skipped = []
          const include = Array.isArray(parsed?.include) ? parsed.include : null
          if (include) {
            if (include.length === 0) {
              writeJson(res, 400, { ok: false, error: 'empty-include' })
              return
            }
            const seenAbs = new Set()
            for (const item of include) {
              const rel = String(item || '').replaceAll('\\', '/')
              if (!isSafeTemplateRel(rel)) {
                writeJson(res, 400, { ok: false, error: 'bad-include', rel: String(item ?? '') })
                return
              }
              const inProject = resolveUnderRoots(path.join(projectReal, ...rel.split('/')), scope)
              const f = inProject ? byRel.get(rel.toLowerCase()) : null
              if (!f) {
                writeJson(res, 400, { ok: false, error: 'unknown-include', rel })
                return
              }
              if (seenAbs.has(f.abs.toLowerCase())) continue
              seenAbs.add(f.abs.toLowerCase())
              selected.push(f)
            }
          } else {
            const drafts = files.filter((f) => f.rel.startsWith('draft/'))
            if (drafts.length === 0) {
              writeJson(res, 400, { ok: false, error: 'no-drafts' })
              return
            }
            const r = latestOfSeries(drafts)
            selected = naturalSortFiles(r.latest)
            skipped = r.skipped.map((f) => f.rel)
          }
          const exts = [...new Set(selected.map((f) => f.ext.toLowerCase()))]
          if (exts.length > 1) {
            writeJson(res, 400, { ok: false, error: 'mixed-formats', exts })
            return
          }
          const ext = exts[0]
          const format = ext === '.fountain' ? 'fountain' : 'markdown'
          const bookTitle = safeBookTitle(parsed?.title ?? path.basename(projectReal))
          if (!bookTitle) {
            writeJson(res, 400, { ok: false, error: 'invalid-title' })
            return
          }
          let entries
          try {
            entries = selected.map((f) => ({ title: chapterTitle(f.name), content: fs.readFileSync(f.abs, 'utf8') }))
          } catch {
            // 扫描到读取之间文件被移走/改名：如实报，不写半成品
            writeJson(res, 409, { ok: false, error: 'source-changed' })
            return
          }
          const date = new Date().toLocaleString('zh-CN', { hour12: false })
          const book = compileBook(entries, { format, title: bookTitle, date, titles: parsed?.titles !== false })
          try {
            let doc = null
            for (let n = 1; n <= 100 && !doc; n++) {
              const out = resolveUnderRoots(path.join(projectReal, `${bookTitle}-v${n}${ext}`), scope)
              try {
                doc = writeDoc(out, book.text, null) // 独占创建：已存在就试下一个编号，绝不覆盖
              } catch (err) {
                if (err.status !== 409) throw err
              }
            }
            if (!doc) throw storeError('version-conflict', 409)
            writeJson(res, 200, {
              ok: true,
              doc: { path: doc.path, chars: doc.chars, revision: doc.revision },
              stats: { files: book.files, chars: book.chars, skipped },
            })
          } catch (err) {
            writeJson(res, err.status || 500, { ok: false, error: String(err?.message || err) })
          }
          return
        }

        /**
         * 导出作品档案（HTML）：与档案面板同一口径的**只读投影**，自包含单文件，便于分享与打印。
         * 独占创建在项目根（<书名>-档案-vN.html，绝不覆盖）；.html 不在 TEXT_EXTS 里，
         * 所以档案页不会混进文档库、也不参与成书候选；与 compile 一样不记码字账。
         * body: { path（项目内任意路径）, title?（书名，默认取目录名） }
         */
        if (req.method === 'POST' && route === 'archive-export') {
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
          const found = resolveProjectDir(target.abs, roots)
          const projectReal = found && realOrNull(found)
          if (!projectReal) {
            writeJson(res, 400, { ok: false, error: 'no-project' })
            return
          }
          let built
          try {
            built = assembleArchiveModel(projectReal, cfg.prefs, parsed?.title)
          } catch (err) {
            writeJson(res, err.status || 500, { ok: false, error: String(err?.message || err) })
            return
          }
          const { html, bookTitle, counts } = built
          try {
            const scope = [{ path: projectReal, real: projectReal }]
            let written = null
            for (let n = 1; n <= 100 && !written; n++) {
              const out = resolveUnderRoots(path.join(projectReal, `${bookTitle}-档案-v${n}.html`), scope)
              try {
                written = writeExportFile(out, html) // 独占创建：已存在就试下一个编号，绝不覆盖
              } catch (err) {
                if (err.status !== 409) throw err
              }
            }
            if (!written) throw storeError('version-conflict', 409)
            writeJson(res, 200, {
              ok: true,
              doc: { path: written.path, bytes: written.bytes },
              stats: counts,
            })
          } catch (err) {
            writeJson(res, err.status || 500, { ok: false, error: String(err?.message || err) })
          }
          return
        }

        /**
         * 作品档案页（HTML 文档，只读）：与 archive-export 同一份组装口径，但**不落盘**。
         * 它是「档案作为一个页面」的地址——独立窗口（shell:open-wiki）或浏览器直接打开都走这里。
         * 每次请求现算、明确不缓存（缓存里的设定是过期的，比没有更糟）；CSP 关掉脚本/图片/连接，
         * 作者稿子里的东西只能当文字看。query: path（项目内任意路径）
         */
        if (req.method === 'GET' && route === 'wiki') {
          const roots = effectiveRoots(cfg)
          const target = resolveUnderRoots(url.searchParams.get('path') || '', roots)
          if (target === null) {
            writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
            return
          }
          const found = resolveProjectDir(target.abs, roots)
          const projectReal = found && realOrNull(found)
          if (!projectReal) {
            writeJson(res, 400, { ok: false, error: 'no-project' })
            return
          }
          try {
            // 切换器只列**真能渲染的作品**：scanTree 会把库根本身（根目录下的散稿）也算成
            // 一个条目，那种路径 resolveProjectDir 给不出结果，点了就是死链（实测撞到过）。
            // 两道闸都要有：resolveProjectDir 为 null 时**不能**把空串交给 realOrNull
            // （Windows 上 realpathSync('') 会返回进程 cwd，于是链接能指到仓库目录去）；
            // 解析出来的目录还必须仍在库根内，越界一律不列。
            // 名单沿用 scanTree 而不是另写一套目录扫描——「库里有哪些作品」只该有一处说法；
            // 代价是每次开页多走一遍目录，而档案页是作者点开才算、不轮询。
            const seen = new Set()
            const projects = []
            for (const r of scanTree(cfg)) {
              for (const p of (r.projects || [])) {
                const dir = resolveProjectDir(p.path, roots)
                const resolved = dir ? realOrNull(dir) : null
                if (!resolved || resolveUnderRoots(resolved, roots) === null) continue
                const key = resolved.toLowerCase()
                if (seen.has(key)) continue
                seen.add(key)
                projects.push({ path: resolved, name: p.name, rootLabel: r.label || '' })
              }
            }
            const { html } = assembleArchiveModel(projectReal, cfg.prefs, '', { projects, currentPath: projectReal })
            res.statusCode = 200
            res.setHeader('content-type', 'text/html; charset=utf-8')
            res.setHeader('content-security-policy', WIKI_CSP)
            res.setHeader('x-content-type-options', 'nosniff')
            res.setHeader('cache-control', 'no-store')
            res.end(html)
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

        // 码字统计：按任意库内稿件路径解析作品，返回今日净增/连击/近 14 天与目标。
        // 只读不记账；记账只在 save/version 成功后发生。
        if (req.method === 'GET' && route === 'stats') {
          const roots = effectiveRoots(cfg)
          const target = resolveUnderRoots(url.searchParams.get('path') || '', roots)
          if (target === null) {
            writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
            return
          }
          const found = projectStatsFor(target.abs, { spanDays: 14 })
          if (!found) {
            writeJson(res, 200, { ok: true, stats: null })
            return
          }
          if (resolveUnderRoots(found.projectDir, roots) === null) {
            writeJson(res, 400, { ok: false, error: 'project-outside-roots' })
            return
          }
          writeJson(res, 200, { ok: true, stats: found.summary, dailyGoal: normalizePrefs(cfg.prefs).dailyGoal || 0 })
          return
        }

        // 大纲视图批量口径（只读）：每章当前版字数/钩子/门禁 + structure.md 标题行
        if (req.method === 'GET' && route === 'outline') {
          const roots = effectiveRoots(cfg)
          const project = resolveProjectDir(url.searchParams.get('project') || '', roots)
          if (!project) {
            writeJson(res, 400, { ok: false, error: 'invalid-project' })
            return
          }
          writeJson(res, 200, { ok: true, outline: outlineSummary(project) })
          return
        }

        // 章节重排序（卡片拖拽）：把期望顺序落实为 draft/ 内的重命名事务。
        // 项目级锁互斥；期望顺序与现有系列一一对应才受理；绝不覆盖既有文件。
        if (req.method === 'POST' && route === 'reorder') {
          const parsed = await readJsonBody(req)
          if (parsed === null) {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          const roots = effectiveRoots(cfg)
          const project = resolveProjectDir(parsed?.project || '', roots)
          if (!project) {
            writeJson(res, 400, { ok: false, error: 'invalid-project' })
            return
          }
          if (!Array.isArray(parsed?.order)) {
            writeJson(res, 400, { ok: false, error: 'order-required' })
            return
          }
          try {
            const result = withFileLock(path.join(project, 'state', '.reorder.lock'), () => reorderDraftSeries(project, parsed.order))
            writeJson(res, 200, { ok: true, ...result })
          } catch (err) {
            const code = String(err?.code || err?.message || err)
            const status = code === 'reorder-collision' || code === 'reorder-leftovers' || code === 'reorder-tmp-exists' || code.startsWith('reorder-leftovers')
              ? 409
              : code.startsWith('order-') ? 400 : (err?.status || 500)
            writeJson(res, status, { ok: false, error: code })
          }
          return
        }

        if (req.method === 'GET' && route === 'templates') {
          writeJson(res, 200, { ok: true, templates: listTemplates() })
          return
        }

        if (req.method === 'POST' && route === 'project-resource') {
          const body = await readJsonBody(req)
          const roots = effectiveRoots(cfg)
          const project = body && resolveProjectDir(body.path, roots)
          if (!project || !PROJECT_RESOURCES.some(([rel]) => rel === body.resource)) {
            writeJson(res, 400, { ok: false, error: 'invalid-project-resource' }); return
          }
          try {
            const marker = fs.existsSync(path.join(project, 'project.md')) ? readDoc(resolveUnderRoots(path.join(project, 'project.md'), roots)).content : ''
            const templateId = marker.includes('短剧') ? 'shortdrama' : /电影|剧集/.test(marker) ? 'screenplay' : 'novel'
            const file = renderTemplate(templateId, path.basename(project), '').files.find(f => f.rel === body.resource)
            const created = createTemplateFile(project, file, roots)
            writeJson(res, 200, { ok: true, path: created })
          } catch (err) {
            writeJson(res, err.code === 'EEXIST' ? 409 : 400, { ok: false, error: err.code === 'EEXIST' ? 'resource-exists' : String(err.code || err.message) })
          }
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
          const tmpl = (parsed.fullTemplate === true ? renderTemplate : renderStarter)(parsed.templateId || 'novel', title, premise)
          const roots = effectiveRoots(cfg)
          const rootPath =
            (typeof parsed.root === 'string' && parsed.root) ||
            cfg.activeRoot ||
            (roots.find((r) => r.real) || {}).real
          if (!rootPath) {
            writeJson(res, 400, { ok: false, error: 'no-root' })
            return
          }
          const prepared = prepareProjectTarget(rootPath, title, roots)
          if (!prepared.ok) {
            const status = prepared.error === 'project-exists' || prepared.error === 'directory-not-empty' ? 409 : 400
            writeJson(res, status, {
              ok: false,
              error: prepared.error,
              ...(prepared.path ? { path: prepared.path } : {}),
            })
            return
          }
          const { dirName, target } = prepared
          const written = []
          try {
            // Validate the entire template before creating anything. New parents
            // must then be materialized one level at a time: resolveUnderRoots
            // deliberately only accepts a missing leaf under an existing parent.
            const files = tmpl.files.filter(f => f.rel && !f.rel.endsWith('.gitkeep'))
            if (files.some(f => !isSafeTemplateRel(f.rel))) {
              writeJson(res, 500, { ok: false, error: 'template-path-unsafe' })
              return
            }
            fs.mkdirSync(target.abs, { recursive: true })
            for (const f of files) {
              createTemplateFile(target.abs, f, roots)
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

        if (req.method === 'GET' && route === 'memory') {
          const roots = effectiveRoots(cfg)
          const raw = url.searchParams.get('path') || ''
          const target = resolveUnderRoots(raw, roots)
          const proj = target ? resolveProjectDir(target.abs, roots) : null
          if (!proj) {
            writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
            return
          }
          try {
            const payload = memoryApiPayload(proj, {
              libraryRoots: roots.map((r) => r.real).filter(Boolean),
            })
            writeJson(res, 200, payload)
          } catch (err) {
            writeJson(res, err.status || 500, { ok: false, error: String(err?.code || err?.message || err) })
          }
          return
        }

        if (req.method === 'POST' && route === 'memory') {
          const parsed = await readJsonBody(req)
          if (parsed === null) {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          const roots = effectiveRoots(cfg)
          const target = resolveUnderRoots(parsed?.path || '', roots)
          const proj = target ? resolveProjectDir(target.abs, roots) : null
          if (!proj) {
            writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
            return
          }
          try {
            if (parsed.op === 'update-projection') throw memoryError('projection-operation-private', 400)
            const r = applyMemoryOp(
              proj,
              {
                op: parsed.op,
                baseRevision: parsed.baseRevision,
                baseEtag: parsed.baseEtag,
                id: parsed.id,
                item: parsed.item,
                actor: parsed.actor,
                operationId: parsed.operationId,
                requestHash: parsed.requestHash,
                clientSchemaVersion: parsed.clientSchemaVersion,
              },
              { libraryRoots: roots.map((r) => r.real).filter(Boolean) }
            )
            writeJson(res, 200, {
              ok: true,
              project: proj,
              memory: r.memory,
              etag: r.etag,
              injectable: injectableItems(r.memory),
              schemaVersion: r.memory.schemaVersion,
              projection: r.memory.projection || null,
              receipt: r.receipt || null,
              replay: Boolean(r.replay),
              // V9：每次写回都带上配额用量，让 UI 能在撞墙前提醒并提供归档入口
              quota: r.quota || quotaOf(r.memory),
              archived: r.archived || null,
            })
          } catch (err) {
            writeJson(res, err.status || 500, { ok: false, error: String(err?.code || err?.message || err) })
          }
          return
        }

        if (req.method === 'GET' && route === 'memory-operation') {
          const roots = effectiveRoots(cfg)
          const raw = url.searchParams.get('path') || ''
          const operationId = url.searchParams.get('operationId') || ''
          const target = resolveUnderRoots(raw, roots)
          const proj = target ? resolveProjectDir(target.abs, roots) : null
          if (!proj || !operationId) {
            writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
            return
          }
          try {
            const { memory } = readMemory(proj, {
              libraryRoots: roots.map((r) => r.real).filter(Boolean),
            })
            const receipt = getOperationReceipt(memory, operationId)
            if (!receipt) {
              writeJson(res, 200, { ok: true, found: false, receipt: null })
              return
            }
            writeJson(res, 200, { ok: true, found: true, receipt, revision: memory.revision })
          } catch (err) {
            writeJson(res, err.status || 500, { ok: false, error: String(err?.code || err?.message || err) })
          }
          return
        }

        if ((req.method === 'POST' || req.method === 'GET') && route === 'setting-projection') {
          const parsed = req.method === 'POST' ? await readJsonBody(req) : { path: url.searchParams.get('path') }
          if (!parsed) { writeJson(res, 400, { ok: false, error: 'invalid-json' }); return }
          const roots = effectiveRoots(cfg)
          const target = resolveUnderRoots(parsed.path || '', roots)
          const proj = target ? resolveProjectDir(target.abs, roots) : null
          if (!proj) { writeJson(res, 400, { ok: false, error: 'path-outside-roots' }); return }
          try {
            const opts = { libraryRoots: roots.map(r => r.real).filter(Boolean) }
            if (req.method === 'GET') {
              const current = readMemory(proj, opts)
              const disk = readSettingProjection(proj)
              const proposed = renderSettingProjection(current.memory.items, { sourceRevision: current.memory.revision, projectKey: proj })
              writeJson(res, 200, { ok: true, ...disk, proposed, projection: current.memory.projection, revision: current.memory.revision, etag: current.etag })
            } else {
              if (parsed.targetPath && parsed.targetPath !== PROJECTION_REL) throw memoryError('projection-path-fixed', 409)
              writeJson(res, 200, syncSettingProjection(proj, parsed, opts))
            }
          } catch (err) {
            writeJson(res, err.status || 500, { ok: false, error: String(err.code || err.message || err) })
          }
          return
        }

        if (req.method === 'GET' && (route === 'draft' || route === 'world-draft')) {
          const windowId = url.searchParams.get('window') || 'default'
          const resolved = draftBucket(url.searchParams.get('project') || '', cfg, route)
          if (!resolved.ok) {
            writeJson(res, 400, { ok: false, error: resolved.error })
            return
          }
          try {
            const checkpoint = readCheckpoint(resolved.bucket, windowId)
            const all = listCheckpoints(resolved.bucket)
            // V7：列表只给元数据 + 摘要（世界观桶额外给标题汇总），并恢复上限。
            // 正文按 windowId 单独取——旧写法把每个桶的全文一起返回（单桶上限 500KB），
            // 响应体会随历史窗口数无界增长。
            writeJson(res, 200, {
              ok: true,
              checkpoint,
              checkpoints: all.slice(0, MAX_DRAFT_LIST).map((c) => checkpointMeta(c, { world: route === 'world-draft' })),
              total: all.length,
              truncated: all.length > MAX_DRAFT_LIST,
            })
          } catch (err) {
            writeJson(res, err.status || 500, { ok: false, error: err.code || 'draft-read-failed', damagedHash: damagedCheckpointHash(resolved.bucket, windowId) })
          }
          return
        }

        if (req.method === 'POST' && (route === 'draft' || route === 'world-draft')) {
          const parsed = await readJsonBody(req)
          if (parsed === null) {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          const windowId = String(parsed.windowId || 'default')
          const resolved = draftBucket(parsed.project || '', cfg, route)
          if (!resolved.ok) {
            writeJson(res, 400, { ok: false, error: resolved.error })
            return
          }
          try {
            const write = parsed.recoverDamaged === true ? (p, w, d) => recoverDamagedCheckpoint(p, w, d, parsed.expectedHash) : writeCheckpoint
            const r = write(resolved.bucket, windowId, {
              text: parsed.text,
              reference: parsed.reference,
              baseRev: parsed.baseRev,
            })
            writeJson(res, 200, r)
          } catch (err) {
            writeJson(res, err.status || 500, { ok: false, error: String(err?.code || err?.message || err) })
          }
          return
        }

        // V4/V9：维护入口——锁诊断（**只读**）+ 当前作品的配额用量。
        // CXR01 之后这里不再移动任何锁：内核在跑就意味着可能有写入者，
        // 而在线移动他人的锁无法保证互斥。
        if (route === 'maintenance') {
          if (req.method === 'GET') {
            const rawPath = url.searchParams.get('path') || ''
            let quota = null
            let memoryErrorCode = null
            if (rawPath) {
              const roots = effectiveRoots(cfg)
              const t = resolveUnderRoots(rawPath, roots)
              const proj = t ? resolveProjectDir(t.abs, roots) : null
              if (proj) {
                try {
                  quota = quotaOf(readMemory(proj, { libraryRoots: roots.map((r) => r.real).filter(Boolean) }).memory)
                } catch (err) {
                  memoryErrorCode = String(err?.code || err?.message || err)
                }
              }
            }
            writeJson(res, 200, {
              ok: true,
              locks: { drafts: listDraftLocks(), coordination: listCoordinationLocks() },
              quota,
              memoryError: memoryErrorCode,
            })
            return
          }
          const parsed = await readJsonBody(req)
          if (parsed === null) {
            writeJson(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          if (parsed.action === 'clear-stale-locks') {
            // CXR01（P1）：这个动作**不再移动任何锁**，改为拒绝 + 只读诊断 + 可操作指引。
            // 理由：复核之后、改名之前可能有写入者取得该锁，移走它就造成两个写入方临界区重叠；
            // 而本接口跑在内核里，“没有任何写入者”无法被证明。自动隔离只能走离线维护。
            try {
              const drafts = listDraftLocks()
              const coordination = listCoordinationLocks()
              const stale = [...drafts, ...coordination].filter((r) => r.dead)
              writeJson(res, 409, {
                ok: false,
                error: 'stale-lock-clear-refused-online',
                reason: '在线移动他人的锁无法保证互斥（复核与改名之间可能有写入者取得该锁），会把活锁移走造成临界区重叠。',
                stale,
                instruction: stale.length
                  ? `请关闭 DeepSeek Harness Desktop（确认没有正在保存的写入），再手动删除这些锁文件：${stale.map((r) => r.path).join('; ')}`
                  : '当前没有残留锁。列出的锁若 alive=true 属于正在写入的进程，不要删。',
                locks: { drafts, coordination },
              })
            } catch (err) {
              writeJson(res, err.status || 500, { ok: false, error: String(err?.code || err?.message || err) })
            }
            return
          }
          writeJson(res, 400, { ok: false, error: 'unknown-action' })
          return
        }

        if (route === 'project-recovery') {
          const body = req.method === 'POST' ? await readJsonBody(req) : { path: url.searchParams.get('path') }
          const roots = effectiveRoots(cfg)
          const t = body && resolveUnderRoots(body.path, roots)
          const proj = t && resolveProjectDir(t.abs, roots)
          if (!proj) return writeJson(res, 400, { ok: false, error: 'bad-path' })
          try {
            if (req.method === 'GET') return writeJson(res, 200, { ok: true, candidates: relocationCandidates(proj, cfg.companions), histories: relocationHistory(proj) })
            const result = recoverRelocation(proj, body.oldPath, body.token, cfg.companions, { confirmUnrelated: body.confirmUnrelated === true })
            return writeJson(res, 200, { ok: true, ...result })
          } catch (err) { return writeJson(res, err.status || 500, { ok: false, error: err.code || err.message }) }
        }

        // ── 会话创建协调（方案 P2 §3.2）：预留 / 创建中 / 已绑定 / 不确定 ──
        // 项目身份用**作品的规范路径**（与记忆同源：resolveUnderRoots + resolveProjectDir），
        // 因此协调记录天然按作品分桶，且跨窗口/跨进程看到同一份记录。
        if (route === 'coordination') {
          const resolveProjectKey = (rawPath) => {
            const roots = effectiveRoots(cfg)
            const target = resolveUnderRoots(rawPath, roots)
            const proj = target ? resolveProjectDir(target.abs, roots) : null
            return proj ? { proj, roots } : null
          }
          try {
            if (req.method === 'GET') {
              const resolved = resolveProjectKey(url.searchParams.get('path') || '')
              if (!resolved) {
                writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
                return
              }
              const record = readCoordination(resolved.proj)
              writeJson(res, 200, { ok: true, project: resolved.proj, record })
              return
            }
            const parsed = await readJsonBody(req)
            if (parsed === null) {
              writeJson(res, 400, { ok: false, error: 'invalid-json' })
              return
            }
            console.error('[wm-debug-host] claim path=', JSON.stringify(parsed && parsed.path), 'roots=', JSON.stringify(effectiveRoots(cfg)).slice(0,200));
            const resolved = resolveProjectKey(parsed?.path || '')
            if (!resolved) {
              writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
              return
            }
            const projectKey = resolved.proj
            const base = { path: parsed.path, projectKey, operationToken: parsed.operationToken }
            const op = String(parsed.op || '')
            if (op === 'claim') {
              const r = claimCoordination({ ...base, owner: parsed.owner })
              writeJson(res, 200, { ok: true, outcome: r._outcome, record: stripOutcome(r) })
              return
            }
            if (op === 'creating') {
              const r = markCreatingCoordination(base)
              writeJson(res, 200, { ok: true, outcome: r._outcome, record: stripOutcome(r) })
              return
            }
            if (op === 'confirm') {
              const r = confirmCoordination({ ...base, sessionId: parsed.sessionId, workspaceId: parsed.workspaceId, bindingVersion: parsed.bindingVersion })
              writeJson(res, 200, { ok: true, outcome: r._outcome, record: stripOutcome(r) })
              return
            }
            if (op === 'uncertain') {
              const r = markUncertainCoordination({ ...base, workspaceId: parsed.workspaceId, sessionId: parsed.sessionId, reason: parsed.reason })
              writeJson(res, 200, { ok: true, outcome: r._outcome, record: stripOutcome(r) })
              return
            }
            if (op === 'release') {
              const r = releaseCoordination(base)
              writeJson(res, 200, { ok: true, outcome: r._outcome, record: stripOutcome(r) })
              return
            }
            if (op === 'forget') {
              // B03：删除要带条件（token / 记录版本），由客户端把它看到的那份传回来
              const r = forgetCoordination({
                projectKey,
                operationToken: parsed.operationToken ?? null,
                expectedVersion: Number.isInteger(parsed.expectedVersion) ? parsed.expectedVersion : null,
                force: parsed.force === true,
              })
              writeJson(res, r.ok ? 200 : 409, { ok: r.ok, ...r })
              return
            }
            writeJson(res, 400, { ok: false, error: 'unknown-op' })
          } catch (err) {
            writeJson(res, err.status || 500, { ok: false, error: String(err?.code || err?.message || err) })
          }
          return
        }

        writeJson(res, 404, { ok: false, error: 'unknown-route' })
      },
    })
  )
}
