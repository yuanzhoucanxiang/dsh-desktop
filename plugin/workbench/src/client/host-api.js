/**
 * 与 host 半的通话（同源 `/api/workbench`）。
 *
 * 状态权威在 host（文档 §7.2）：跨窗口一致、壳侧热键可读、多页面可读。
 * client 只做乐观更新 + 订阅；这里全部失败都**不抛**（工具台不因为状态文件坏了而瘫掉，
 * 但会把失败原样报给 UI，绝不假装成功）。
 */

const API = '/api/workbench'

async function call(method, { route, body } = {}) {
  const url = `${API}?route=${encodeURIComponent(route || 'state')}`
  try {
    const res = await fetch(url, {
      method,
      headers: method === 'GET' ? undefined : { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
    })
    const text = await res.text()
    let payload = null
    try {
      payload = JSON.parse(text || '{}')
    } catch {
      return { ok: false, error: 'bad-response', detail: text.slice(0, 200) }
    }
    if (!res.ok || payload?.ok !== true) {
      return { ok: false, status: res.status, error: payload?.error || `http-${res.status}`, backup: payload?.backup || null }
    }
    return { ok: true, state: payload.state }
  } catch (err) {
    return { ok: false, error: 'network', detail: String(err?.message || err) }
  }
}

export function fetchState() {
  return call('GET', { route: 'state' })
}

export function pushState(patch) {
  return call('POST', { route: 'state', body: patch })
}
