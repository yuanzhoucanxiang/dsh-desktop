const API = '/api/previz'

export async function api(route, body) {
  const url = `${API}?route=${encodeURIComponent(route)}`
  const init = body === undefined
    ? { method: 'GET' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  let res
  try {
    res = await fetch(url, init)
  } catch (err) {
    return { ok: false, error: 'network', detail: String(err?.message || err) }
  }
  let json = null
  try {
    json = await res.json()
  } catch {
    return { ok: false, error: `http-${res.status}` }
  }
  if (!res.ok && json && json.ok === undefined) return { ok: false, error: `http-${res.status}`, detail: json.error }
  return json
}

export function artifactUrl(rel) {
  return `${API}?route=artifact&path=${encodeURIComponent(String(rel || ''))}`
}

/** 切换当前项目（host 会把它写进 currentProject）。 */
export function selectProject(id) {
  return api('project', { id })
}
