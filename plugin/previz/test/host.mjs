/**
 * host 半纯函数/探测测试（不启动 Electron、不跑 Blender demo）。
 * 跑法：node plugin/previz/test/host.mjs
 */
import assert from 'node:assert/strict'
import { API, apply, cancelJob, listArtifacts, listProjects, probeRuntime, safeResolveOut, state } from '../index.js'

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

test('safeResolveOut：拒绝 .. / 绝对路径 / 空，接受 OUT 内相对路径', () => {
  assert.equal(safeResolveOut('../x'), null)
  assert.equal(safeResolveOut('..\\x'), null)
  assert.equal(safeResolveOut('C:/Windows/win.ini'), null)
  assert.equal(safeResolveOut(''), null)
  assert.equal(safeResolveOut('.'), null)
  const ok = safeResolveOut('animatic.mp4')
  assert.ok(ok && ok.endsWith('animatic.mp4'))
})

test('probeRuntime：有界、不抛、状态合法', () => {
  const r = probeRuntime(true)
  assert.ok(['ready', 'down', 'error'].includes(r.state), `unexpected state ${r.state}`)
  assert.equal(typeof r.detail, 'string')
  if (r.state === 'ready') assert.ok(r.version, 'ready 时应带 version')
})

test('state：形状稳定（runtime/project/job/artifacts）', () => {
  const s = state()
  assert.equal(s.ok, true)
  assert.ok(s.runtime && typeof s.runtime.state === 'string')
  assert.equal(s.project.id, 'boutique')
  assert.ok(Array.isArray(s.artifacts))
  assert.ok('job' in s)
})

test('listArtifacts：返回数组，元素有 mode/kind/id/path', () => {
  const list = listArtifacts()
  assert.ok(Array.isArray(list))
  for (const a of list) {
    assert.equal(a.mode, 'previz')
    assert.ok(a.id && a.path && a.kind)
  }
})

test('listProjects：至少一个可用项目，反例 fixture 不出现', () => {
  const list = listProjects()
  assert.ok(list.length >= 1)
  assert.ok(list.some((p) => p.id === 'boutique' && p.valid))
  assert.ok(!list.some((p) => p.id === 'bad-occlusion'), 'fixture 不应出现在可选项目里')
})

test('state：project/projects 一致', () => {
  const s = state()
  assert.ok(s.projects.some((p) => p.id === s.project.id))
  assert.equal(s.project.path.endsWith(s.project.id), true)
})

test('cancelJob：没有任务时如实 no-job', () => {
  assert.deepEqual(cancelJob(), { ok: false, error: 'no-job', detail: '没有在跑的任务' })
})

test('apply：向 webServer 注册 /api/previz 精确路由', () => {
  const routes = []
  const ctx = {
    effect: (fn) => {
      fn()
      return () => {}
    },
    webServer: {
      register: (route) => {
        routes.push(route)
        return () => {}
      },
    },
  }
  apply(ctx)
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'exact')
  assert.equal(routes[0].path, API)
  assert.equal(typeof routes[0].handler, 'function')
})

console.log(`PREVIZ_HOST_OK ${passed} passed / ${failed} failed`)
if (failed > 0) process.exit(1)
