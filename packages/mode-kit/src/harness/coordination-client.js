/**
 * 协调协议的 HTTP 客户端（host 侧实现见各模式自己的路由，如 writing-mode 的 lib/coordination.js）。
 * 只做协议编解码；不做任何本地判定——本地判定一律以 host 记录为准。
 *
 * 抽到 mode-kit 时去掉了原先对 `services/writing-api.js` 的默认依赖：`api` 改为**必填**，
 * 由各模式注入自己的 HTTP 入口（写作模式传 writing-api 的 api，GIR 接入时传自己的）。
 * 这样本文件不再属于任何模式（原先那个默认 import 会让库反向依赖宿主插件，抽出来就解析不到）。
 */

const JSON_POST = { method: 'POST', headers: { 'content-type': 'application/json' } }

export function httpCoordination(api) {
  if (typeof api !== 'function') throw new Error('httpCoordination: api 必填（由模式注入自己的 HTTP 入口）')
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
