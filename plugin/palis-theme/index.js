/**
 * Host half of the built-in PALIS theme plugin.
 *
 * Job: keep the current theme in memory and expose it over HTTP so both the
 * desktop shell (which pushes the user's skin choice) and the browser client
 * (which polls and applies it to the whole kernel Web UI) agree on one value.
 *
 * Design notes:
 * - This plugin only manages a tiny piece of state. All visual work happens in
 *   client.js, which styles the kernel UI through its own design tokens
 *   (--dsw-alias-*) plus a self-contained stylesheet -- it does NOT scrape or
 *   rearrange kernel DOM, and it does not depend on compiled hash class names.
 * - The shell pushes { theme: 'palis' | '' } after boot and on every skin
 *   change; the client polls GET /api/palis-theme (2s) so it also recovers
 *   after page reloads without any push channel.
 */

export const name = 'palis-theme'
export const inject = ['webServer']

const ROUTE = '/api/palis-theme'

let current = ''

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 1e6) req.destroy() // 1MB cap, defensive
    })
    req.on('end', () => resolve(data))
    req.on('error', () => resolve(''))
  })
}

function writeJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(body))
  res.end(body)
}

export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE,
        handler: async (req, res) => {
          try {
            if (req.method === 'POST') {
              const body = JSON.parse((await readBody(req)) || '{}')
              const next = typeof body.theme === 'string' ? body.theme.trim() : ''
              current = next === 'palis' ? 'palis' : ''
              writeJson(res, 200, { ok: true, theme: current })
              return
            }
            writeJson(res, 200, { ok: true, theme: current })
          } catch (err) {
            writeJson(res, 500, { ok: false, error: err?.message ?? String(err) })
          }
        }
      }),
    'palis-theme: theme route'
  )
}
