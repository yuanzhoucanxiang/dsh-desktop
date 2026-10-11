/**
 * 工具台 HTTP 公共层（host 半）。
 *
 * 口径与 plugin/writing-mode/lib/http.js 一致（环回 + 可信 Host/Origin + 路由×方法白名单 +
 * 按字节收 body），但**不 import 对方的实现**——两个插件各自独立发布到 profile，
 * 跨插件相对 import 会让任一方单独安装时解析失败。抽公共包是 mode-kit 阶段的事（见
 * docs/plans/workbench-layer-v1.md §5.2），在那之前宁可重复这 60 行。
 */

export const MAX_BODY_BYTES = 1 << 20 // 1 MiB（工具台只存模式 id 与最近项，远小于此）

/** 路由 × 方法白名单：未登记的路由 404，白名单外的方法 405。 */
export const ROUTE_METHODS = {
  state: ['GET', 'POST'],
}

/** 环回对端判定以 socket 地址为准（dsh web 只应绑定 127.0.0.1）。 */
export function isLoopback(req) {
  const addr = String(req?.socket?.remoteAddress ?? '')
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function hostHeader(req) {
  return String(req?.headers?.host ?? '').trim().toLowerCase()
}

/** Host 必须是回环（含端口），否则可能是 DNS rebinding 打进来的。 */
function trustedHost(req) {
  const host = hostHeader(req)
  if (!host) return true // 本地非浏览器进程（curl 直连）可能不带 Host
  const bare = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  return bare === '127.0.0.1' || bare === 'localhost' || bare === '::1' || bare === '[::1]'
}

/** Origin 若带，必须与 Host 同源。 */
function trustedOrigin(req) {
  const origin = String(req?.headers?.origin ?? '').trim()
  if (!origin) return true
  try {
    return new URL(origin).host.toLowerCase() === hostHeader(req)
  } catch {
    return false
  }
}

/**
 * 可信请求：环回 + 可信 Host + 非跨站 + Origin 同源。
 * 缺失 sec-fetch-site 视为可信（本地非浏览器进程可直连，写操作由方法白名单与 JSON 要求兜底）。
 */
export function trustedRequest(req) {
  if (!isLoopback(req)) return false
  if (!trustedHost(req) || !trustedOrigin(req)) return false
  const site = String(req?.headers?.['sec-fetch-site'] ?? '').toLowerCase()
  if (site === 'cross-site') return false
  return true
}

export function writeJson(res, status, obj) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(obj))
}

/**
 * 按字节收集请求体后一次性 UTF-8 解码（逐 chunk 解码会把跨 chunk 的多字节字符
 * 变成 U+FFFD 并静默写进状态文件）。超限返回 null。
 */
export function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve) => {
    const chunks = []
    let bytes = 0
    let failed = false
    req.on('data', (chunk) => {
      if (failed) return
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
      bytes += buf.length
      if (bytes > limit) {
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
