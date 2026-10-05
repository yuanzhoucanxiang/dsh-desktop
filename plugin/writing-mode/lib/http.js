/**
 * writing-mode host 的 HTTP 公共层（从 index.js 原样搬出，行为不变）：
 * 环回判定 / 请求可信判定 / 路由×方法白名单 / body 收集与 JSON 解析 / JSON 响应。
 *
 * 归位说明（2026-10-05 后端整治阶段一）：index.js 原是 1400 行 god module，
 * 公共层 + 31 条路由挤在一个 handler 闭包里；现在公共层归本模块，
 * 路由按域拆进 lib/routes/*，index.js 只留插件生命周期 + 中间件 + 分发表。
 * hardening 探针的源码形状断言已同步改指向（V1 读Body / V8 白名单等）。
 */

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

export function isLoopbackRequest(req) {
  const addr = String(req?.socket?.remoteAddress ?? '')
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

export function trustedRequest(req) {
  if (!isLoopbackRequest(req)) return false
  try {
    const origin = new URL(`http://${req.headers.host}`)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) return false
    if (req.headers.origin && req.headers.origin !== origin.origin) return false
    return !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])
  } catch { return false }
}

export function writeJson(res, status, obj) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(obj))
}

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
