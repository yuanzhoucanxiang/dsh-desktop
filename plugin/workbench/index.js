/**
 * Host half of @dsh-local/workbench — cordis 插件入口 + `/api/workbench` 分发。
 *
 * 职责（P0，见 docs/plans/workbench-layer-v1.md §6.2）：
 *   ① 状态权威：当前激活模式、最近打开（跨窗口/壳侧热键的唯一读点）
 *   ② 模式探测：P0 先不做（内核 `pluginManager` remote face 的可注入性未验证，见文档 R9）
 *   ③ 为将来壳侧热键/通知提供读接口
 *
 * 不注册任何工具、不碰内核代码、不 import 其它插件的实现（各自独立发布到 profile）。
 */
import { MAX_BODY_BYTES, ROUTE_METHODS, readBody, trustedRequest, writeJson } from './lib/http.js'
import { readState, updateState } from './lib/state.js'

// 兼容面：回归测试与后续路由直接取这些符号（口径同 lib/http.js）。
export { MAX_BODY_BYTES, ROUTE_METHODS, readBody, trustedRequest, writeJson } from './lib/http.js'
export { readState, updateState, stateFile, defaultState, mergeRecent } from './lib/state.js'

export const name = 'workbench'
/** webServer=状态路由。P0 只用这一个服务（settings 由 client 侧 settings.section 承担）。 */
export const inject = ['webServer']

const API = '/api/workbench'

/** 状态相关的错误码 → HTTP 状态（与 CONTRACT 的错误码表同风格）。 */
const STATE_ERROR_STATUS = {
  'revision-conflict': 409,
  'config-damaged-refused': 409,
  'config-read-failed': 409,
}

export function apply(ctx) {
  const c = ctx
  if (!c || !c.webServer || typeof c.webServer.register !== 'function') {
    console.warn('[workbench] webServer unavailable, host API disabled')
    return
  }
  ctx.effect(
    () =>
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
          const declared = Number(req.headers['content-length'])
          if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
            writeJson(res, 413, { ok: false, error: 'body-too-large', maxBytes: MAX_BODY_BYTES })
            return
          }
          try {
            if (req.method === 'GET') {
              const state = readState()
              if (state.__damaged) {
                writeJson(res, 409, {
                  ok: false,
                  error: state.configError || 'corrupt-config',
                  backup: state.configBackup || null,
                  detail: state.configDetail || null,
                  hint: '状态文件已损坏，原件已保留且未被覆盖；恢复 workbench.json 后才能再改。',
                })
                return
              }
              writeJson(res, 200, { ok: true, state: publicState(state) })
              return
            }
            const raw = await readBody(req)
            if (raw === null) {
              writeJson(res, 413, { ok: false, error: 'body-too-large', maxBytes: MAX_BODY_BYTES })
              return
            }
            let body = null
            try {
              body = JSON.parse(raw || '{}')
            } catch {
              writeJson(res, 400, { ok: false, error: 'invalid-json' })
              return
            }
            if (!body || typeof body !== 'object' || Array.isArray(body)) {
              writeJson(res, 400, { ok: false, error: 'invalid-json' })
              return
            }
            const patch = {}
            if ('activeModeId' in body) patch.activeModeId = body.activeModeId
            if ('recent' in body) patch.recent = body.recent
            if ('baseRevision' in body) patch.baseRevision = body.baseRevision
            if (Object.keys(patch).length === 0) {
              writeJson(res, 400, { ok: false, error: 'empty-patch' })
              return
            }
            const state = updateState(patch)
            writeJson(res, 200, { ok: true, state: publicState(state) })
          } catch (err) {
            const code = String(err?.code || 'internal-error')
            const status = STATE_ERROR_STATUS[code] || 500
            writeJson(res, status, {
              ok: false,
              error: code,
              revision: Number.isFinite(err?.revision) ? err.revision : undefined,
              backup: err?.backup || undefined,
              detail: code === 'internal-error' ? String(err?.message || err) : undefined,
            })
          }
        },
      }),
    'workbench: /api/workbench route',
  )
}

/** 对外只暴露契约字段（内部 `__damaged` 等诊断标记不出网）。 */
function publicState(state) {
  return {
    version: state.version,
    revision: state.revision,
    activeModeId: state.activeModeId,
    recent: state.recent,
  }
}
