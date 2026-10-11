/**
 * mode-kit 门禁：导出面 + 结构边界。
 *
 * 1. **导出面漂移**：`packages/mode-kit/src/index.js` 的公开导出必须与期望集合一致；
 *    写作模式的四个 shim（`plugin/writing-mode/src/client/adapters/harness/*.js`）必须**逐名**
 *    再导出同一批名字——审计探针与单测都按老路径 import，少一个名字就会在别的门禁里炸。
 * 2. **结构边界**：库源码里**不允许**出现指向包外的 import（尤其不许反向依赖某个宿主插件，
 *    例如写作模式的 services/writing-api.js——抽库时正是这一条把 coordination-client 的
 *    默认 import 逼成了必填参数）。所有 import 必须是包内相对路径且真实存在。
 *
 * 跑法：node packages/mode-kit/test/exports.mjs   （npm run test:mode-kit）
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..')
const KIT = path.join(REPO, 'packages', 'mode-kit')
const SHIM = path.join(REPO, 'plugin', 'writing-mode', 'src', 'client', 'adapters', 'harness')

let passed = 0
let failed = 0
async function test(name, fn) {
  try {
    await fn()
    passed++
  } catch (err) {
    failed++
    console.error(`FAIL ${name}\n  ${err?.message || err}`)
  }
}

const EXPECTED = {
  adapter: ['PEER_WAIT', 'adapterError', 'newOperationToken', 'createHarnessAdapter'],
  projection: ['textOf', 'stripInjectedBlocks', 'projectChat', 'turnBaseline', 'turnEvidence', 'createSnapshotCache'],
  identity: ['canonicalProjectKey', 'projectIdentityOf'],
  'coordination-client': ['httpCoordination'],
}
const ALL = Object.values(EXPECTED).flat().sort()

await test('barrel 导出面 = 期望集合（多一个少一个都算漂移）', async () => {
  const mod = await import(pathToFileURL(path.join(KIT, 'src', 'index.js')).href)
  assert.deepEqual(Object.keys(mod).sort(), ALL)
})

for (const [file, names] of Object.entries(EXPECTED)) {
  await test(`${file}.js shim 逐名再导出`, async () => {
    const mod = await import(pathToFileURL(path.join(SHIM, `${file}.js`)).href)
    assert.deepEqual(Object.keys(mod).sort(), [...names].sort())
  })
}

await test('shim 与库是同一份实现（函数引用相等，不是各自复制了一份）', async () => {
  const kit = await import(pathToFileURL(path.join(KIT, 'src', 'harness', 'adapter.js')).href)
  const shim = await import(pathToFileURL(path.join(SHIM, 'adapter.js')).href)
  assert.equal(shim.createHarnessAdapter, kit.createHarnessAdapter)
  assert.equal(shim.newOperationToken, kit.newOperationToken)
})

await test('结构边界：库内所有 import 都是包内相对路径且真实存在', () => {
  const offenders = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(p)
        continue
      }
      if (!e.name.endsWith('.js')) continue
      const text = fs.readFileSync(p, 'utf8')
      for (const m of text.matchAll(/^\s*(?:import|export)[^'"\n]*from\s*['"]([^'"]+)['"]/gm)) {
        const spec = m[1]
        if (!spec.startsWith('.')) {
          offenders.push(`${path.relative(REPO, p)} → 裸包名 "${spec}"（库不得依赖外部包/宿主插件）`)
          continue
        }
        const target = path.resolve(path.dirname(p), spec)
        if (!fs.existsSync(target)) offenders.push(`${path.relative(REPO, p)} → "${spec}" 解析不到`)
        if (!target.startsWith(KIT)) offenders.push(`${path.relative(REPO, p)} → "${spec}" 逃出了包边界`)
      }
    }
  }
  walk(path.join(KIT, 'src'))
  assert.deepEqual(offenders, [])
})

await test('coordination-client 的 api 是必填（不再偷偷默认到某个插件）', async () => {
  const { httpCoordination } = await import(pathToFileURL(path.join(KIT, 'src', 'harness', 'coordination-client.js')).href)
  assert.throws(() => httpCoordination(), /api 必填/)
})

console.log(`MODE_KIT_OK ${passed} passed / ${failed} failed`)
if (failed > 0) process.exit(1)
