/**
 * 工具台 host 单测：状态文件语义 + `/api/workbench` 路由语义。
 * 覆盖：空状态 / 读改写 / revision 冲突 / 损坏保护（备份 + 拒绝回写）/ 最近项合并 /
 * 403·404·405·413·415·400·409 各错误路径。
 *
 * 跑法：node plugin/workbench/test/host-state.mjs   （或 npm run test:workbench）
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-workbench-test-'))
process.env.DSH_HOME = tempHome
delete process.env.DSH_DESKTOP_HOME

const state = await import('../lib/state.js')
const host = await import('../index.js')

const FILE = state.stateFile()
assert.equal(FILE, path.join(tempHome, 'workbench.json'))

let passed = 0
let failed = 0
function test(name, fn) {
  try {
    fn()
    passed++
  } catch (err) {
    failed++
    console.error(`FAIL ${name}\n  ${err?.message || err}`)
  }
}
async function testAsync(name, fn) {
  try {
    await fn()
    passed++
  } catch (err) {
    failed++
    console.error(`FAIL ${name}\n  ${err?.message || err}`)
  }
}
function reset() {
  try {
    fs.rmSync(FILE, { force: true })
  } catch {}
  for (const f of fs.readdirSync(tempHome)) {
    if (f.startsWith('workbench.json.damaged-')) fs.rmSync(path.join(tempHome, f), { force: true })
  }
}

// ── 状态文件 ──────────────────────────────────────────────────────────────

test('缺文件 = 空状态（只有 ENOENT 才算不存在）', () => {
  reset()
  const s = state.readState()
  assert.equal(s.__missing, true)
  assert.equal(s.__damaged, undefined)
  assert.equal(s.version, 1)
  assert.equal(s.revision, 0)
  assert.equal(s.activeModeId, null)
  assert.deepEqual(s.recent, [])
})

test('写-读回环：revision 单调递增，文件是 JSON', () => {
  reset()
  const first = state.updateState({ activeModeId: 'writing' })
  assert.equal(first.revision, 1)
  assert.equal(first.activeModeId, 'writing')
  const second = state.updateState({ activeModeId: 'gir' })
  assert.equal(second.revision, 2)
  const back = state.readState()
  assert.equal(back.revision, 2)
  assert.equal(back.activeModeId, 'gir')
  assert.equal(back.__damaged, undefined)
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(FILE, 'utf8')))
})

test('baseRevision 不匹配 → revision-conflict（乐观并发）', () => {
  reset()
  state.updateState({ activeModeId: 'writing' })
  assert.throws(
    () => state.updateState({ activeModeId: 'gir', baseRevision: 0 }),
    (err) => err.code === 'revision-conflict' && err.revision === 1,
  )
  const ok = state.updateState({ activeModeId: 'gir', baseRevision: 1 })
  assert.equal(ok.revision, 2)
})

test('损坏 JSON：如实报错 + 保留原件副本，且不覆盖原件', () => {
  reset()
  const garbage = '{ this is not json'
  fs.writeFileSync(FILE, garbage, 'utf8')
  const s = state.readState()
  assert.equal(s.__damaged, true)
  assert.equal(s.configError, 'corrupt-config')
  assert.equal(s.activeModeId, null)
  assert.ok(s.configBackup, '应留下损坏副本')
  assert.equal(fs.readFileSync(s.configBackup, 'utf8'), garbage)
  assert.equal(fs.readFileSync(FILE, 'utf8'), garbage, '原件不得被改动')
})

test('损坏后拒绝回写（config-damaged-refused），原件字节不动', () => {
  reset()
  const garbage = '[1,2,3]'
  fs.writeFileSync(FILE, garbage, 'utf8')
  assert.throws(
    () => state.updateState({ activeModeId: 'writing' }),
    (err) => err.code === 'config-damaged-refused',
  )
  assert.equal(fs.readFileSync(FILE, 'utf8'), garbage)
})

test('非对象 JSON（数组/字符串）也按损坏处理', () => {
  reset()
  for (const raw of ['[1,2,3]', '"just a string"', 'null', '42']) {
    fs.writeFileSync(FILE, raw, 'utf8')
    const s = state.readState()
    assert.equal(s.__damaged, true, `${raw} 应判损坏`)
  }
})

test('最近项：同 id 去重上浮、超上限丢最旧', () => {
  const base = []
  let list = state.mergeRecent(base, { modeId: 'writing', id: 'p1', title: '甲', at: 1 })
  list = state.mergeRecent(list, { modeId: 'gir', id: 'p2', title: '乙', at: 2 })
  list = state.mergeRecent(list, { modeId: 'writing', id: 'p1', title: '甲（新）', at: 3 })
  assert.equal(list.length, 2)
  assert.equal(list[0].id, 'p1')
  assert.equal(list[0].title, '甲（新）')
  assert.equal(list[0].at, 3)
  let many = []
  for (let i = 0; i < 20; i++) many = state.mergeRecent(many, { modeId: 'writing', id: `p${i}`, at: i })
  assert.equal(many.length, state.MAX_RECENT)
  assert.equal(many[0].id, 'p19')
})

// ── HTTP 路由 ─────────────────────────────────────────────────────────────

let handler = null
host.apply({
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
assert.equal(typeof handler, 'function', 'apply 应注册 /api/workbench')

async function call({ method = 'GET', route = 'state', body = null, headers = {}, ip = '127.0.0.1' } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = `/api/workbench?route=${encodeURIComponent(route)}`
  req.socket = { remoteAddress: ip }
  req.headers = { host: '127.0.0.1:41234', ...headers }
  if (body !== null && !req.headers['content-type']) req.headers['content-type'] = 'application/json'
  req.destroy = () => {}
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(k, v) {
      this.headers[String(k).toLowerCase()] = v
    },
    end(text) {
      this.body = text ?? ''
    },
  }
  const pending = handler(req, res)
  if (body !== null) {
    setImmediate(() => {
      req.emit('data', Buffer.from(body, 'utf8'))
      req.emit('end')
    })
  }
  await pending
  let json = null
  try {
    json = JSON.parse(res.body || '{}')
  } catch {}
  return { status: res.statusCode, json, headers: res.headers }
}

await testAsync('非回环对端 → 403', async () => {
  reset()
  const r = await call({ ip: '10.0.0.7' })
  assert.equal(r.status, 403)
  assert.equal(r.json.error, 'forbidden')
})

await testAsync('跨站（sec-fetch-site: cross-site）→ 403', async () => {
  const r = await call({ headers: { 'sec-fetch-site': 'cross-site' } })
  assert.equal(r.status, 403)
})

await testAsync('未知 route → 404', async () => {
  const r = await call({ route: 'nope' })
  assert.equal(r.status, 404)
  assert.equal(r.json.error, 'unknown-route')
})

await testAsync('方法不在白名单（PUT）→ 405', async () => {
  const r = await call({ method: 'PUT' })
  assert.equal(r.status, 405)
  assert.equal(r.json.error, 'method-not-allowed')
})

await testAsync('POST 非 JSON content-type → 415', async () => {
  const r = await call({ method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } })
  assert.equal(r.status, 415)
  assert.equal(r.json.error, 'json-required')
})

await testAsync('声明长度超限 → 413（先于读体）', async () => {
  const r = await call({ method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(host.MAX_BODY_BYTES + 1) } })
  assert.equal(r.status, 413)
  assert.equal(r.json.error, 'body-too-large')
})

await testAsync('GET 空状态 → 200 + 默认值', async () => {
  reset()
  const r = await call()
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.state.activeModeId, null)
  assert.equal(r.json.state.revision, 0)
  assert.equal(r.headers['cache-control'], 'no-store')
})

await testAsync('POST 非法 JSON → 400', async () => {
  const r = await call({ method: 'POST', body: '{oops' })
  assert.equal(r.status, 400)
  assert.equal(r.json.error, 'invalid-json')
})

await testAsync('POST 空 patch → 400', async () => {
  const r = await call({ method: 'POST', body: '{}' })
  assert.equal(r.status, 400)
  assert.equal(r.json.error, 'empty-patch')
})

await testAsync('POST 正常 → 200 且 revision 递增，GET 能读回', async () => {
  reset()
  const write = await call({ method: 'POST', body: JSON.stringify({ activeModeId: 'writing' }) })
  assert.equal(write.status, 200)
  assert.equal(write.json.state.activeModeId, 'writing')
  assert.equal(write.json.state.revision, 1)
  const read = await call()
  assert.equal(read.json.state.activeModeId, 'writing')
  assert.equal(read.json.state.revision, 1)
})

await testAsync('POST baseRevision 过期 → 409 revision-conflict', async () => {
  reset()
  await call({ method: 'POST', body: JSON.stringify({ activeModeId: 'writing' }) })
  const stale = await call({ method: 'POST', body: JSON.stringify({ activeModeId: 'gir', baseRevision: 0 }) })
  assert.equal(stale.status, 409)
  assert.equal(stale.json.error, 'revision-conflict')
  assert.equal(stale.json.revision, 1)
})

await testAsync('状态文件损坏：GET → 409 且带备份路径；POST → 409 拒绝', async () => {
  reset()
  fs.writeFileSync(FILE, 'not json at all', 'utf8')
  const read = await call()
  assert.equal(read.status, 409)
  assert.equal(read.json.error, 'corrupt-config')
  assert.ok(read.json.backup, '应回备份路径')
  const write = await call({ method: 'POST', body: JSON.stringify({ activeModeId: 'writing' }) })
  assert.equal(write.status, 409)
  assert.equal(write.json.error, 'config-damaged-refused')
  assert.equal(fs.readFileSync(FILE, 'utf8'), 'not json at all')
})

await testAsync('内部字段不出网（__damaged/__missing 不泄漏）', async () => {
  reset()
  const r = await call()
  assert.equal(Object.prototype.hasOwnProperty.call(r.json.state, '__missing'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(r.json.state, '__damaged'), false)
})

console.log(`WORKBENCH_HOST_OK ${passed} passed / ${failed} failed`)
if (failed > 0) process.exit(1)
