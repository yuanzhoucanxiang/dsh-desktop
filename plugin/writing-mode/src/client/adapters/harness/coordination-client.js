/**
 * 协调协议的 HTTP 客户端（host 侧实现见 plugin/writing-mode/lib/coordination.js）。
 * 只依赖 services/writing-api 的 api()；不做任何本地判定——本地判定一律以 host 记录为准。
 */
import { api as defaultApi } from '../../services/writing-api.js'

const JSON_POST = { method: 'POST', headers: { 'content-type': 'application/json' } }

export function httpCoordination(api = defaultApi) {
  const post = async (op, body) => {
    const res = await api('coordination', { ...JSON_POST, body: JSON.stringify({ op, ...body }) })
    return {
      ok: Boolean(res?.ok),
      outcome: res?.outcome || null,
      record: res?.record || null,
      error: res?.error || null,
    }
  }
  return {
    claim: (body) => post('claim', body),
    creating: (body) => post('creating', body),
    confirm: (body) => post('confirm', body),
    uncertain: (body) => post('uncertain', body),
    release: (body) => post('release', body),
    forget: (body) => post('forget', body),
    read: async (body) => {
      const res = await api('coordination', undefined, { path: body.path })
      return { ok: Boolean(res?.ok), record: res?.record || null, error: res?.error || null }
    },
  }
}
