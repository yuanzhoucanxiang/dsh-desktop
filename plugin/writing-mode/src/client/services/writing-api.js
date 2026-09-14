/**
 * 写作模式 HTTP 客户端：统一 route/query 编码与超时，错误归一化为 {ok:false,error}。
 * 只依赖 fetch；不依赖 React / DOM / Harness 服务。
 */
export const API = '/api/writing-mode'

export async function api(route, opts, query) {
  const params = new URLSearchParams({ route, ...query })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), route === 'assist' ? 90000 : 15000)
  try {
    const res = await fetch(`${API}?${params}`, { ...opts, signal: controller.signal })
    return await res.json().catch(() => ({ ok: false, error: 'invalid-response' }))
  } finally { clearTimeout(timer) }
}
