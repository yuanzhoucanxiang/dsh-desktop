/**
 * 工具台注册表单测（纯函数面，零 DOM / 零网络 / 零 Electron）。
 * 覆盖：注册与排序、重复 id、切换与互斥、关闭守卫（拒绝/抛错）、adopt 恢复、
 * 卸载、订阅广播、持久化回调。
 *
 * 跑法：node plugin/workbench/test/registry.mjs   （或 npm run test:workbench）
 */
import assert from 'node:assert/strict'
import { createRegistry } from '../src/client/registry.js'

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

test('空注册表：没有模式、没有激活、size=0', () => {
  const r = createRegistry()
  assert.deepEqual(r.list(), [])
  assert.equal(r.getActive(), null)
  assert.equal(r.size(), 0)
  assert.equal(r.has('writing'), false)
})

test('注册后按 order 排序，label thunk 每次重读', () => {
  const r = createRegistry()
  let text = '乙'
  r.registerMode({ id: 'b', order: 20, label: () => text })
  r.registerMode({ id: 'a', order: 10, label: '甲' })
  assert.deepEqual(r.list().map((m) => m.id), ['a', 'b'])
  assert.equal(r.list()[1].label, '乙')
  text = '乙（改名）'
  assert.equal(r.list()[1].label, '乙（改名）')
})

test('同 order 用 id 兜底排序（稳定，不靠注册先后）', () => {
  const r = createRegistry()
  r.registerMode({ id: 'z', order: 5, label: 'Z' })
  r.registerMode({ id: 'a', order: 5, label: 'A' })
  assert.deepEqual(r.list().map((m) => m.id), ['a', 'z'])
})

test('重复 id 抛错（配置事故要响）', () => {
  const r = createRegistry()
  r.registerMode({ id: 'writing', label: '写作' })
  assert.throws(() => r.registerMode({ id: 'writing', label: '写作2' }), /重复的模式 id/)
})

test('缺 id 抛错', () => {
  const r = createRegistry()
  assert.throws(() => r.registerMode({ label: '无 id' }), /id 必填/)
})

await testAsync('切换到未注册的模式：拒绝且状态不变', async () => {
  const r = createRegistry()
  r.registerMode({ id: 'writing', label: '写作' })
  const result = await r.setActive('gir')
  assert.equal(result.ok, false)
  assert.equal(result.error, 'unknown-mode')
  assert.equal(r.getActive(), null)
})

await testAsync('切换：onDeactivate/onActivate 收到 from/to/reason，持久化被调用', async () => {
  const events = []
  const persisted = []
  const r = createRegistry({ onPersist: (patch) => persisted.push(patch) })
  r.registerMode({ id: 'writing', label: '写作', onActivate: (e) => events.push(['on', 'writing', e]), onDeactivate: (e) => events.push(['off', 'writing', e]) })
  r.registerMode({ id: 'gir', label: 'GIR', onActivate: (e) => events.push(['on', 'gir', e]) })

  const first = await r.setActive('writing')
  assert.equal(first.ok, true)
  assert.equal(first.changed, true)
  assert.equal(r.getActive(), 'writing')
  assert.equal(events.length, 1)
  assert.equal(events[0][0], 'on')
  assert.equal(events[0][2].reason, 'switch')

  const second = await r.setActive('gir')
  assert.equal(second.ok, true)
  assert.equal(r.getActive(), 'gir')
  // 先 off(writing) 再 on(gir)
  assert.deepEqual(events.slice(1).map((e) => [e[0], e[1]]), [['off', 'writing'], ['on', 'gir']])
  assert.equal(events[1][2].to, 'gir')
  assert.equal(events[2][2].from, 'writing')
  assert.equal(events[2][2].fromLabel, '写作')
  assert.deepEqual(persisted, [{ activeModeId: 'writing' }, { activeModeId: 'gir' }])
})

await testAsync('重复切到同一个模式：changed=false，不触发钩子', async () => {
  const calls = []
  const r = createRegistry()
  r.registerMode({ id: 'writing', label: '写作', onActivate: () => calls.push('on') })
  await r.setActive('writing')
  const again = await r.setActive('writing')
  assert.equal(again.ok, true)
  assert.equal(again.changed, false)
  assert.equal(calls.length, 1)
})

await testAsync('互斥：任何时刻只有一个 active', async () => {
  const r = createRegistry()
  r.registerMode({ id: 'a', label: 'A' })
  r.registerMode({ id: 'b', label: 'B' })
  await r.setActive('a')
  assert.deepEqual(r.list().filter((m) => m.active).map((m) => m.id), ['a'])
  await r.setActive('b')
  assert.deepEqual(r.list().filter((m) => m.active).map((m) => m.id), ['b'])
  assert.equal(r.list().length, 2)
})

await testAsync('关闭守卫拒绝：不切换，error=deactivate-refused', async () => {
  const r = createRegistry()
  r.registerMode({ id: 'writing', label: '写作', canDeactivate: () => false })
  r.registerMode({ id: 'gir', label: 'GIR' })
  await r.setActive('writing')
  const result = await r.setActive('gir')
  assert.equal(result.ok, false)
  assert.equal(result.error, 'deactivate-refused')
  assert.equal(r.getActive(), 'writing')
})

await testAsync('关闭守卫抛错：按拒绝处理（绝不"因为守卫坏了就放行"）', async () => {
  const r = createRegistry()
  r.registerMode({ id: 'writing', label: '写作', canDeactivate: () => { throw new Error('守卫炸了') } })
  r.registerMode({ id: 'gir', label: 'GIR' })
  await r.setActive('writing')
  const result = await r.setActive('gir')
  assert.equal(result.ok, false)
  assert.equal(result.error, 'deactivate-refused')
  assert.equal(r.getActive(), 'writing')
})

await testAsync('关闭守卫异步放行：允许切换', async () => {
  const r = createRegistry()
  r.registerMode({ id: 'writing', label: '写作', canDeactivate: async () => true })
  r.registerMode({ id: 'gir', label: 'GIR' })
  await r.setActive('writing')
  const result = await r.setActive('gir')
  assert.equal(result.ok, true)
  assert.equal(r.getActive(), 'gir')
})

await testAsync('退出到内核界面（null）同样要过守卫：被拒就不退', async () => {
  let guard = 0
  const r = createRegistry()
  r.registerMode({ id: 'writing', label: '写作', canDeactivate: () => { guard++; return false } })
  await r.setActive('writing')
  const refused = await r.setActive(null, 'exit')
  assert.equal(refused.ok, false)
  assert.equal(refused.error, 'deactivate-refused')
  assert.equal(r.getActive(), 'writing')
  assert.equal(guard, 1) // 从"有模式"退出到 null 仍要过守卫
})

await testAsync('守卫放行时才能退出到内核界面', async () => {
  const r = createRegistry()
  r.registerMode({ id: 'writing', label: '写作', canDeactivate: () => true })
  await r.setActive('writing')
  const result = await r.setActive(null, 'exit')
  assert.equal(result.ok, true)
  assert.equal(r.getActive(), null)
})

await testAsync('adopt（启动恢复）：不走守卫、不写回 host', async () => {
  const persisted = []
  let guard = 0
  const r = createRegistry({ onPersist: (p) => persisted.push(p) })
  r.registerMode({ id: 'writing', label: '写作', canDeactivate: () => { guard++; return false } })
  const result = r.adopt('writing')
  assert.equal(result.ok, true)
  assert.equal(r.getActive(), 'writing')
  assert.equal(guard, 0)
  assert.deepEqual(persisted, [])
  // 未注册的 id 恢复不了
  const miss = r.adopt('gir')
  assert.equal(miss.ok, false)
  assert.equal(miss.error, 'unknown-mode')
})

await testAsync('卸载激活中的模式：active 归零 + onDeactivate(reason=unregistered)', async () => {
  const events = []
  const r = createRegistry()
  const dispose = r.registerMode({ id: 'writing', label: '写作', onDeactivate: (e) => events.push(e) })
  await r.setActive('writing')
  dispose()
  assert.equal(r.getActive(), null)
  assert.equal(r.size(), 0)
  assert.equal(events.length, 1)
  assert.equal(events[0].reason, 'unregistered')
  // disposer 幂等：再调一次不再触发
  dispose()
  assert.equal(events.length, 1)
})

await testAsync('订阅广播：切换/注册/卸载都通知，disposer 之后不再通知', async () => {
  let hits = 0
  const r = createRegistry()
  const off = r.subscribe(() => hits++)
  r.registerMode({ id: 'a', label: 'A' })
  assert.equal(hits, 1)
  await r.setActive('a')
  assert.equal(hits, 2)
  off()
  r.registerMode({ id: 'b', label: 'B' })
  assert.equal(hits, 2)
})

test('mount 只接受 overlay/panel，缺省 overlay', () => {
  const r = createRegistry()
  r.registerMode({ id: 'a', label: 'A', mount: 'nonsense' })
  r.registerMode({ id: 'b', label: 'B', mount: 'panel' })
  assert.equal(r.list()[0].mount, 'overlay')
  assert.equal(r.list()[1].mount, 'panel')
})

test('对外视图不带内部钩子（只有 UI 需要的字段）', () => {
  const r = createRegistry()
  r.registerMode({ id: 'a', label: 'A', onActivate: () => {}, canDeactivate: () => true })
  const view = r.list()[0]
  assert.deepEqual(Object.keys(view).sort(), ['active', 'hasContext', 'hasDock', 'id', 'label', 'mount', 'order'])
})

test('辅助坞（L2）：dockViewOf 只认带 view 的声明；list() 如实标 hasDock', () => {
  const r = createRegistry()
  r.registerMode({ id: 'plain', label: '没有坞' })
  assert.equal(r.dockViewOf('plain'), null)
  assert.equal(r.dockViewOf('nope'), null)
  assert.equal(r.list()[0].hasDock, false)

  const View = () => null
  r.registerMode({ id: 'writing', label: '写作', dock: { label: () => '写作', view: View, order: 50 } })
  const dock = r.dockViewOf('writing')
  assert.equal(dock.id, 'writing')
  assert.equal(dock.label, '写作')
  assert.equal(dock.order, 50)
  assert.equal(dock.view, View, '坞视图必须是同一个组件引用（不是复制）')
  assert.equal(r.list().find((m) => m.id === 'writing').hasDock, true)

  // 声明里没有 view 的不算坞（避免注册了一个点开是空白的坞）
  r.registerMode({ id: 'halfbaked', label: '半个', dock: { label: 'x' } })
  assert.equal(r.dockViewOf('halfbaked'), null)
  assert.equal(r.list().find((m) => m.id === 'halfbaked').hasDock, false)
})

// ── L1：上下文 + 一键交接 ────────────────────────────────────────────────

test('contextOf：没报上下文返回 null；报了就把 mode 一起带上；get 抛错也不炸', () => {
  const r = createRegistry()
  r.registerMode({ id: 'plain', label: '没有上下文' })
  assert.equal(r.contextOf('plain'), null)
  assert.equal(r.contextOf('nope'), null)

  r.registerMode({ id: 'writing', label: '写作', context: { get: () => ({ title: '归乡记 · 第2章', project: 'E:/novel' }) } })
  assert.deepEqual(r.contextOf('writing'), { title: '归乡记 · 第2章', project: 'E:/novel', mode: 'writing' })

  r.registerMode({ id: 'boom', label: '坏的', context: { get: () => { throw new Error('读不到') } } })
  assert.equal(r.contextOf('boom'), null)
})

await test('context.subscribe：模式推上下文时工具台会广播（UI 跟着动）', async () => {
  let hits = 0
  let ctx = { title: '甲' }
  const listeners = new Set()
  const r = createRegistry()
  const off = r.subscribe(() => hits++)
  r.registerMode({ id: 'writing', label: '写作', context: { get: () => ctx, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) } } })
  const before = hits
  ctx = { title: '乙' }
  for (const fn of listeners) fn()
  assert.equal(hits, before + 1, '上下文变化应触发一次广播')
  assert.equal(r.contextOf('writing').title, '乙')
  off()
  // 注销时解绑：不再有人听
  r.list()
  assert.equal(listeners.size, 1)
})

await test('handoff：目标没注册 → unknown-mode，什么都不发生', async () => {
  const r = createRegistry()
  r.registerMode({ id: 'writing', label: '写作' })
  const result = await r.handoff('gir', { text: '一段' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'unknown-mode')
  assert.equal(r.getActive(), null)
  assert.equal(r.lastHandoff(), null)
})

await test('handoff：先切过去再交付，载荷规范化（from/kind/title/refs 上限）', async () => {
  const seen = []
  const r = createRegistry({ now: () => 1234 })
  r.registerMode({ id: 'writing', label: '写作' })
  r.registerMode({ id: 'gir', label: 'GIR', onHandoff: (payload) => seen.push(payload) })
  await r.setActive('writing')
  const result = await r.handoff('gir', { text: '主体靠左', title: '第2章', refs: Array.from({ length: 30 }, (_, i) => `r${i}`) })
  assert.equal(result.ok, true)
  assert.equal(result.delivered, true)
  assert.equal(r.getActive(), 'gir', '交接要先把目标切到前台')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].from, 'writing', 'from 默认取发送方（当前模式）')
  assert.equal(seen[0].kind, 'text')
  assert.equal(seen[0].title, '第2章')
  assert.equal(seen[0].text, '主体靠左')
  assert.equal(seen[0].refs.length, 20, 'refs 上限 20')
  assert.equal(seen[0].at, 1234)
  assert.equal(r.lastHandoff().delivered, true)
  assert.equal(r.lastHandoff().to, 'gir')
})

await test('handoff：目标没有接收端 → 如实 delivered:false（不假装送到）', async () => {
  const r = createRegistry()
  r.registerMode({ id: 'writing', label: '写作' })
  r.registerMode({ id: 'gir', label: 'GIR' })
  const result = await r.handoff('gir', { text: 'x' })
  assert.equal(result.ok, true)
  assert.equal(result.delivered, false)
  assert.equal(r.getActive(), 'gir')
  assert.equal(r.lastHandoff().delivered, false)
})

await test('handoff：被当前模式的关闭守卫拦下 → 不切也不交付', async () => {
  const seen = []
  const r = createRegistry()
  r.registerMode({ id: 'writing', label: '写作', canDeactivate: () => false })
  r.registerMode({ id: 'gir', label: 'GIR', onHandoff: (p) => seen.push(p) })
  await r.setActive('writing')
  const result = await r.handoff('gir', { text: 'x' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'deactivate-refused')
  assert.equal(r.getActive(), 'writing')
  assert.deepEqual(seen, [], '被拦下时目标不该收到任何东西')
})

await test('handoff：接收端抛错 → delivered 仍为 true（调用过），但错误被记下来不炸', async () => {
  const r = createRegistry()
  r.registerMode({ id: 'writing', label: '写作' })
  r.registerMode({ id: 'gir', label: 'GIR', onHandoff: () => { throw new Error('接收端炸了') } })
  const result = await r.handoff('gir', { text: 'x' })
  assert.equal(result.ok, true)
  assert.equal(result.delivered, false, '抛错不算成功交付')
  assert.equal(r.lastHandoff().delivered, false)
})

console.log(`WORKBENCH_REGISTRY_OK ${passed} passed / ${failed} failed`)
if (failed > 0) process.exit(1)
