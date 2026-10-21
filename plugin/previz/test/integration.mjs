/**
 * host 路由端到端：起本地 HTTP → POST demo → 轮询 → 读 animatic Range → 路径穿越被拒。
 * 需要本机 Blender / ffmpeg；不可用时打印 SKIP 并退出 0（CI 无 Blender 不应红）。
 * 跑法：node plugin/previz/test/integration.mjs
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { apply } from '../index.js'

let handler = null
apply({
  effect: (fn) => {
    fn()
    return () => {}
  },
  webServer: {
    register: (route) => {
      handler = route.handler
      return () => {}
    },
  },
})
assert.equal(typeof handler, 'function', 'host 应注册 /api/previz 路由')

const server = http.createServer((req, res) => handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base = `http://127.0.0.1:${port}/api/previz`

async function get(route, init) {
  const res = await fetch(`${base}?route=${route}`, init)
  return { status: res.status, headers: res.headers, json: await res.json().catch(() => null) }
}

async function waitJob(timeoutMs = 90000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const s = await get('state')
    assert.equal(s.status, 200)
    if (s.json.job && ['done', 'failed', 'cancelled'].includes(s.json.job.state)) return s.json
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('demo timed out')
}

try {
  const s0 = await get('state')
  assert.equal(s0.status, 200)
  assert.equal(s0.json.ok, true)
  if (s0.json.runtime.state !== 'ready') {
    console.log(`PREVIZ_INTEGRATION_SKIP runtime=${s0.json.runtime.state}: ${s0.json.runtime.detail}`)
    process.exitCode = 0
  } else {
    const demo = await get('demo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(demo.status, 200)
    assert.equal(demo.json.ok, true, `demo 应启动：${JSON.stringify(demo.json)}`)
    const final = await waitJob()
    assert.equal(final.job.state, 'done', `demo 应完成：${final.job.error || ''}`)
    assert.ok(final.artifacts.some((a) => a.path === 'animatic.mp4'), '应有 animatic.mp4')
    assert.ok(final.artifacts.some((a) => a.path === 'plan.png'), '应有 plan.png')

    const range = await fetch(`${base}?route=artifact&path=animatic.mp4`, { headers: { range: 'bytes=0-99' } })
    assert.equal(range.status, 206, 'Range 应返回 206')
    assert.equal(range.headers.get('content-type'), 'video/mp4')
    assert.equal(range.headers.get('content-range', '').startsWith('bytes 0-99/'), true)
    assert.equal((await range.arrayBuffer()).byteLength, 100)

    const img = await fetch(`${base}?route=artifact&path=plan.png`)
    assert.equal(img.status, 200)
    assert.equal(img.headers.get('content-type'), 'image/png')

    const bad = await get('artifact&path=../escape.txt')
    assert.ok([403, 404].includes(bad.status), `路径穿越应被拒（实际 ${bad.status}）`)
    console.log(`PREVIZ_INTEGRATION_OK job=${final.job.id} artifacts=${final.artifacts.length}`)
  }
} finally {
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1500)
    server.close(() => {
      clearTimeout(timer)
      resolve()
    })
    try {
      server.closeAllConnections?.()
      server.closeIdleConnections?.()
    } catch {}
  })
}
