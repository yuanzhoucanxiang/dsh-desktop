/**
 * 写作模式 ↔ 工具台 桥接单测（纯逻辑，零 DOM / 零 React / 零 Electron）。
 *
 * 覆盖：未装工具台时完全不动（降级）；装了时注册描述正确；激活/失活落模式状态；
 * 关闭守卫（允许/拒绝/抛错）语义；模式自己开关时回灌工具台；卸载后让位还原。
 *
 * 跑法：node plugin/writing-mode/test/workbench-bridge.mjs
 */
import assert from 'node:assert/strict'
import {
  bindWorkbench,
  hasWorkbench,
  subscribeWorkbench,
  __workbenchService,
} from '../src/client/adapters/workbench-bridge.js'
import {
  askCloseGuard,
  commitModeActive,
  getModeActive,
  setCloseGuard,
  setModeActive,
} from '../src/client/state/mode-store.js'

let passed = 0
let failed = 0
async function test(name, fn) {
  try {
    await fn()
    passed++
  } catch (err) {
    failed++
    console.error(`FAIL ${name}\n  ${err?.message || err}`)
  } finally {
    // 每个用例后复位：桥接与模式状态都不能泄漏到下一个用例
    setCloseGuard(null)
    commitModeActive(false)
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function fakeService() {
  const calls = { registerMode: [], setActive: [], disposed: 0 }
  let active = null
  return {
    calls,
    registerMode(descriptor) {
      calls.registerMode.push(descriptor)
      return () => {
        calls.disposed++
      }
    },
    getActive: () => active,
    async setActive(id, reason) {
      calls.setActive.push([id, reason])
      active = id
      return { ok: true, changed: true, active: id }
    },
  }
}

function fakeCtx(service) {
  const state = { cleanup: null, injected: 0 }
  return {
    state,
    inject(deps, cb) {
      state.injected++
      assert.deepEqual(deps, ['workbench'], '只注入 workbench 一个可选服务')
      if (service) state.cleanup = cb({ workbench: service })
      return () => {
        if (typeof state.cleanup === 'function') state.cleanup()
      }
    },
  }
}

await test('没有 ctx / 没有 inject：不炸，也不认为装了工具台', async () => {
  assert.equal(bindWorkbench(undefined), undefined)
  assert.equal(bindWorkbench({}), undefined)
  assert.equal(hasWorkbench(), false)
})

await test('服务缺席（回调不触发）：降级，hasWorkbench 保持 false', async () => {
  const ctx = fakeCtx(null)
  bindWorkbench(ctx)
  assert.equal(ctx.state.injected, 1)
  assert.equal(hasWorkbench(), false)
  assert.equal(__workbenchService(), null)
})

await test('服务出现：注册描述正确（id/label/order/mount）', async () => {
  const service = fakeService()
  const ctx = fakeCtx(service)
  bindWorkbench(ctx)
  assert.equal(hasWorkbench(), true)
  assert.equal(service.calls.registerMode.length, 1)
  const desc = service.calls.registerMode[0]
  assert.equal(desc.id, 'writing')
  assert.equal(desc.order, 20)
  assert.equal(desc.mount, 'overlay')
  assert.equal(desc.label(), '写作模式')
  assert.equal(typeof desc.canDeactivate, 'function')
  assert.equal(typeof desc.onActivate, 'function')
  assert.equal(typeof desc.onDeactivate, 'function')
  ctx.state.cleanup?.()
})

await test('订阅：工具台出现/消失都通知', async () => {
  const service = fakeService()
  const ctx = fakeCtx(service)
  let hits = 0
  const off = subscribeWorkbench(() => hits++)
  bindWorkbench(ctx)
  assert.equal(hits, 1, '出现时应通知一次（入口让位）')
  ctx.state.cleanup?.()
  assert.equal(hits, 2, '消失时应通知一次（入口还原）')
  off()
  assert.equal(hasWorkbench(), false)
})

await test('onActivate/onDeactivate 落模式状态（进/出写作台）', async () => {
  const service = fakeService()
  const ctx = fakeCtx(service)
  bindWorkbench(ctx)
  const desc = service.calls.registerMode[0]
  assert.equal(getModeActive(), false)
  desc.onActivate({ reason: 'switch' })
  assert.equal(getModeActive(), true, 'onActivate 应进入写作台')
  desc.onDeactivate({ reason: 'switch' })
  assert.equal(getModeActive(), false, 'onDeactivate 应退出写作台')
  ctx.state.cleanup?.()
})

await test('关闭守卫：无守卫=允许；返回 false=拒绝；抛错=按拒绝', async () => {
  const service = fakeService()
  const ctx = fakeCtx(service)
  bindWorkbench(ctx)
  const desc = service.calls.registerMode[0]

  setCloseGuard(null)
  assert.equal(await desc.canDeactivate(), true, '没有守卫时应允许')

  setCloseGuard(async () => true)
  assert.equal(await desc.canDeactivate(), true)

  setCloseGuard(async () => false)
  assert.equal(await desc.canDeactivate(), false, '守卫拒绝必须如实返回 false')

  setCloseGuard(async () => {
    throw new Error('守卫炸了')
  })
  assert.equal(await desc.canDeactivate(), false, '守卫抛错按拒绝处理（绝不放行）')
  ctx.state.cleanup?.()
})

await test('本地退出路径仍过守卫：拒绝时留在写作台，允许时退出', async () => {
  setCloseGuard(async () => false)
  commitModeActive(true)
  setModeActive(false)
  await tick()
  assert.equal(getModeActive(), true, '守卫拒绝时不得退出')

  setCloseGuard(async () => true)
  setModeActive(false)
  await tick()
  assert.equal(getModeActive(), false, '守卫允许时应退出')
})

await test('askCloseGuard 是纯判定：问它不改状态', async () => {
  let asked = 0
  setCloseGuard(async () => {
    asked++
    return true
  })
  commitModeActive(true)
  assert.equal(await askCloseGuard(), true)
  assert.equal(asked, 1)
  assert.equal(getModeActive(), true, 'askCloseGuard 不得自己改状态')
})

await test('模式自己开的（设置页/热键）：回灌工具台，避免两套状态分叉', async () => {
  const service = fakeService()
  const ctx = fakeCtx(service)
  bindWorkbench(ctx)
  assert.equal(service.calls.setActive.length, 0)

  commitModeActive(true) // 绕过工具台直接开
  await tick()
  assert.deepEqual(service.calls.setActive, [['writing', 'mode-local']])

  commitModeActive(false) // 绕过工具台直接关
  await tick()
  assert.deepEqual(service.calls.setActive, [
    ['writing', 'mode-local'],
    [null, 'mode-local'],
  ])
  ctx.state.cleanup?.()
})

await test('工具台自己切换时不回声（防循环）', async () => {
  const service = fakeService()
  const ctx = fakeCtx(service)
  bindWorkbench(ctx)
  const desc = service.calls.registerMode[0]
  // 工具台把 active 设成 writing 再调 onActivate —— 桥接不得再回灌一次
  await service.setActive('writing', 'switch')
  desc.onActivate({ reason: 'switch' })
  await tick()
  assert.deepEqual(service.calls.setActive, [['writing', 'switch']], '只应有工具台自己那一次')
  ctx.state.cleanup?.()
})

await test('工具台卸载：注销模式 + 让位还原', async () => {
  const service = fakeService()
  const ctx = fakeCtx(service)
  bindWorkbench(ctx)
  assert.equal(hasWorkbench(), true)
  ctx.state.cleanup?.()
  assert.equal(hasWorkbench(), false, '卸载后应回到降级状态')
  assert.equal(service.calls.disposed, 1, '应注销注册的模式')
  assert.equal(__workbenchService(), null)
})

console.log(`WORKBENCH_BRIDGE_OK ${passed} passed / ${failed} failed`)
if (failed > 0) process.exit(1)
