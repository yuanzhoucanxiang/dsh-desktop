/**
 * 会话域路由（draft / world-draft / coordination / companion / assist）。
 * 从 index.js 原样搬出，行为不变；ctx = { req, res, url, route, cfg, hostCtx, ensurePresetRegistered }。
 * - hostCtx：cordis 插件上下文（assist/companion 的 llm 路由与 settings 事件要用）。
 * - ensurePresetRegistered：index.js 生命周期里的 preset 注册 promise（0.1.7 起自举注册）。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  readConfig, updateConfig, effectiveRoots, resolveUnderRoots, resolveProjectDir, findProjectRoot,
  ensureCompanionPreset,
} from '../store.js'
import {
  readCheckpoint, writeCheckpoint, listCheckpoints, damagedCheckpointHash,
  recoverDamagedCheckpoint, checkpointMeta, MAX_DRAFT_LIST,
} from '../draft-checkpoints.js'
import {
  claimCoordination, markCreatingCoordination, confirmCoordination, markUncertainCoordination,
  releaseCoordination, forgetCoordination, readCoordination,
} from '../coordination.js'
import { recommend, assist } from '../domain.js'
import { writeJson, readJsonBody } from '../http.js'
import { companionProjectOf } from './helpers.js'

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

/** GET draft / world-draft：本窗口 checkpoint + 其他窗口元数据列表（V7：只给元数据，带上限）。 */
export async function getDraft({ req, res, url, route, cfg }) {
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
}

/** POST draft / world-draft：写 checkpoint（坏 checkpoint 可显式恢复）。 */
export async function postDraft({ req, res, route, cfg }) {
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
}

/**
 * GET/POST companion：写作伙伴绑定。
 * GET 查项目会话绑定；POST sessionId=绑定；POST prepare=true = 安装缺失的本地预设并向内核 registry 自举注册
 * （0.1.7 起内核不扫 ~/.dsh/.agent-presets），返回 preset 与 registered；保留已有自定义。
 */
export async function companionRoute({ req, res, url, cfg, hostCtx, ensurePresetRegistered }) {
  const body = req.method === 'POST' ? await readJsonBody(req) : { path: url.searchParams.get('path') }
  cfg = readConfig()
  const target = body && resolveUnderRoots(body.path, effectiveRoots(cfg))
  if (!target || !fs.existsSync(target.abs)) return writeJson(res, 400, { ok: false, error: 'bad-path' })
  // 与 coordination 共用同一套身份判定（裸库根 → 库根本身），两条路由不许再分裂。
  const project = companionProjectOf(body.path, effectiveRoots(cfg))
  const key = process.platform === 'win32' ? project.toLowerCase() : project
  if (req.method === 'POST' && body.prepare === true) {
    try {
      const preset = ensureCompanionPreset()
      // 0.1.7：文件落盘之外还要向 registry 自举注册（幂等，见 index.js 生命周期）。
      const reg = await ensurePresetRegistered()
      // Native preset pickers refresh their roster/current label on this
      // public notification; installing files alone does not notify them.
      hostCtx.emit?.('settings/document-updated', 'agent-presets')
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

/** POST assist：文字工具（Harness llm / 自定义 provider；llm 缺席 501 降级）。 */
export async function postAssist({ req, res, cfg, hostCtx }) {
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
    const r = await recommend(hostCtx, parsed, cfg.prefs)
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
  const r = await assist(hostCtx, parsed, cfg.prefs)
  writeJson(
    res,
    r.status,
    r.ok ? { ok: true, result: r.result } : { ok: false, error: r.error }
  )
}

/** 记录里的内部判定字段不进响应（结果单独放在 outcome）。 */
const stripOutcome = ({ _outcome, ...record }) => record

/**
 * GET/POST coordination：会话创建协调（方案 P2 §3.2）：预留 / 创建中 / 已绑定 / 不确定。
 * 项目身份用**作品的规范路径**（与记忆同源：resolveUnderRoots + resolveProjectDir），
 * 因此协调记录天然按作品分桶，且跨窗口/跨进程看到同一份记录。
 */
/**
 * 项目身份判定统一收在 helpers.companionProjectOf（2026-10-10：修「切换工作区后
 * 写作助手无法启用 / 协调服务不可用」——裸库根在 coordination 眼里曾经不是项目）。
 */
export async function coordinationRoute({ req, res, url, cfg }) {
  const resolveProjectKey = (rawPath) => {
    const roots = effectiveRoots(cfg)
    const proj = companionProjectOf(rawPath, roots)
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
}
