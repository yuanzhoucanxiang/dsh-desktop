/**
 * P3 验收（方案 §4.4 的 D/M/C 组）：项目记忆最小完整操作、当轮上下文契约、引用与恢复候选。
 * 全部用真实 host 模块（project-memory / draft-checkpoints）+ 纯函数（context-builder / reference），
 * 只在临时 DSH_HOME 与临时作品目录里跑，不碰作者的真实稿件。
 *
 * 用法：node plugin/writing-mode/test/p3-memory-context.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import process from 'node:process'
import { readMemory, applyMemoryOp, injectableItems } from '../lib/project-memory.js'
import { readCheckpoint, writeCheckpoint, listCheckpoints } from '../lib/draft-checkpoints.js'
import {
  buildPreparedTurn,
  memoryHint,
  selectMemory,
  isInjectable,
  isPinnable,
  DEFAULT_MEMORY_BUDGET,
} from '../src/shared/context-builder.js'
import { makeReference, sameReference, referenceStatus, normalizeReference, contentFingerprint } from '../src/shared/reference.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-p3-'))
process.env.DSH_HOME = path.join(tmp, 'home')
fs.mkdirSync(process.env.DSH_HOME, { recursive: true })
const proj = path.join(tmp, '作品')
fs.mkdirSync(path.join(proj, 'state'), { recursive: true })
fs.writeFileSync(path.join(proj, 'project.md'), '# 作品\n')

let pass = 0
const ok = (name, fn) => {
  try {
    fn()
    pass++
    console.log('PASS', name)
  } catch (err) {
    console.error('FAIL', name, '\n  ', err.message)
    process.exitCode = 1
  }
}

/** 便捷：按 revision/etag 串起来的记忆操作。 */
function mem() {
  let state = readMemory(proj)
  return {
    get items() { return state.memory.items },
    get revision() { return state.memory.revision },
    op(body) {
      // 模拟界面调用：作者操作显式带 actor（界面里 memory 写入统一带 actor=author）
      state = applyMemoryOp(proj, { actor: body.actor || 'author', ...body, baseRevision: state.memory.revision, baseEtag: state.etag })
      return state
    },
  }
}

console.log('--- M组：备忘最小完整操作（§4.1）')

ok('M01 作者手工新增直接 confirmed，来源 author，可注入', () => {
  const m = mem()
  m.op({ op: 'add', item: { kind: 'fact', text: '主角叫林晚', status: 'confirmed', source: { kind: 'author' } } })
  const it = m.items[0]
  assert.equal(it.status, 'confirmed')
  assert.equal(it.source.kind, 'author')
  assert.equal(injectableItems({ items: m.items }).length, 1)
  const ch = readMemory(proj).memory.changes.at(-1)
  assert.equal(ch.actor, 'author', '审计要记下操作者')
})

ok('M02 助手消息"记为候选"：proposed + 真实来源，不编造 ID、不自动升级为事实', () => {
  const m = mem()
  m.op({
    op: 'add',
    item: {
      kind: 'preference',
      text: '语气克制，少用形容词',
      status: 'proposed',
      source: { kind: 'assistant', sessionId: 'sess-1', messageId: 'n7' },
    },
  })
  const it = m.items.at(-1)
  assert.equal(it.status, 'proposed')
  assert.deepEqual(
    { kind: it.source.kind, sessionId: it.source.sessionId, messageId: it.source.messageId },
    { kind: 'assistant', sessionId: 'sess-1', messageId: 'n7' },
    '来源要原样保留（messageId 就是原生节点键，不另造）'
  )
  assert.equal(isInjectable(it), false, '候选绝不自动注入')
})

ok('M03 编辑候选后仍是 proposed（改文字不等于确认）', () => {
  const m = mem()
  const it = m.items.find((x) => x.status === 'proposed')
  m.op({ op: 'update', id: it.id, item: { text: '语气克制，几乎不用形容词' } })
  const after = m.items.find((x) => x.id === it.id)
  assert.equal(after.status, 'proposed')
  assert.equal(after.text, '语气克制，几乎不用形容词')
})

ok('M04 确认候选：作者操作、审计 actor=author、原始来源保留', () => {
  const m = mem()
  const it = m.items.find((x) => x.status === 'proposed')
  m.op({ op: 'update', id: it.id, item: { status: 'confirmed' } })
  const after = m.items.find((x) => x.id === it.id)
  assert.equal(after.status, 'confirmed')
  assert.equal(after.source.kind, 'assistant', '来源仍是助手建议（另外记录是谁确认的）')
  const ch = readMemory(proj).memory.changes.at(-1)
  assert.equal(ch.op, 'update')
  assert.equal(ch.actor, 'author')
  assert.equal(ch.after.status, 'confirmed')
})

ok('M05 编辑已确认条目：新 revision + before/after 轨迹', () => {
  const m = mem()
  const it = m.items.find((x) => x.status === 'confirmed' && x.kind === 'fact')
  const revBefore = m.revision
  m.op({ op: 'update', id: it.id, item: { text: '主角叫林晚（女，26 岁）' } })
  assert.ok(m.revision > revBefore, 'revision 必须递增')
  const ch = readMemory(proj).memory.changes.at(-1)
  assert.equal(ch.before.text, '主角叫林晚')
  assert.equal(ch.after.text, '主角叫林晚（女，26 岁）')
})

ok('M06 撤回/已解决保留条目与历史，且不再自动注入；恢复产生新 revision 不回退', () => {
  const m = mem()
  m.op({ op: 'add', item: { kind: 'open-question', text: '她为什么不拆信？', status: 'confirmed', source: { kind: 'author' } } })
  const q = m.items.at(-1)
  assert.equal(isInjectable(q), false, '待定问题即便确认也不是默认事实')
  assert.equal(isPinnable(q), true, '但作者可以明确带上它')
  m.op({ op: 'resolve', id: q.id })
  assert.equal(m.items.find((x) => x.id === q.id).status, 'resolved')
  const revAfterResolve = m.revision
  // 历史恢复：拿一条更早的 after 文本恢复
  const target = m.items.find((x) => x.kind === 'fact' && x.status === 'confirmed')
  m.op({ op: 'update', id: target.id, item: { text: '主角叫林晚（再改一次）' } })
  const hist = readMemory(proj).memory.changes.filter((c) => c.id === target.id && c.before)
  assert.ok(hist.length >= 2, '多次编辑要留下可恢复的历史')
  m.op({ op: 'restore', id: target.id, item: { text: hist[0].before.text, status: 'confirmed' } })
  assert.equal(m.items.find((x) => x.id === target.id).text, hist[0].before.text)
  assert.ok(m.revision > revAfterResolve, '恢复也要产生新 revision')
  assert.equal(m.items.length, readMemory(proj).memory.items.length, '恢复不新增条目')
})

ok('M07 冲突（etag 过期）被拒绝且不写坏数据', () => {
  const m = mem()
  const stale = readMemory(proj)
  m.op({ op: 'add', item: { kind: 'fact', text: '后面加的', status: 'confirmed' } })
  assert.throws(
    () => applyMemoryOp(proj, { op: 'add', item: { kind: 'fact', text: '过期的写入', status: 'confirmed' }, baseRevision: stale.memory.revision, baseEtag: stale.etag }),
    /etag-conflict|revision-conflict/
  )
  assert.equal(m.items.some((x) => x.text === '过期的写入'), false)
})

console.log('--- C组：当轮上下文（§4.2）')

const sampleItems = [
  { id: 'a', kind: 'fact', status: 'confirmed', text: '主角叫林晚', source: { kind: 'author' } },
  { id: 'b', kind: 'preference', status: 'confirmed', text: '语气克制', source: { kind: 'assistant', messageId: 'n3' } },
  { id: 'c', kind: 'fact', status: 'proposed', text: '她可能是左撇子', source: { kind: 'assistant', messageId: 'n4' } },
  { id: 'd', kind: 'open-question', status: 'confirmed', text: '她为什么不拆信？', source: { kind: 'author' } },
  { id: 'e', kind: 'fact', status: 'retracted', text: '旧设定：她已婚', source: { kind: 'author' } },
  { id: 'f', kind: 'fact', status: 'resolved', text: '旧疑问', source: { kind: 'author' } },
]

ok('C01 默认开启参考，只带 confirmed 的设定/偏好；候选/撤回/已解决/待定都不自动进', () => {
  const turn = buildPreparedTurn({ message: '这一章怎么开头？', memoryItems: sampleItems, projectKey: 'p' })
  assert.equal(turn.includeMemory, true)
  assert.deepEqual(turn.selectedMemory.map((s) => s.id), ['a', 'b'])
  assert.equal(turn.body.includes('她可能是左撇子'), false)
  assert.equal(turn.body.includes('旧设定'), false)
  assert.equal(turn.body.includes('她为什么不拆信'), false)
  assert.match(turn.body, /【项目备忘 · 作者已确认/)
})

ok('C02 作者固定优先（按作者顺序），其余确定性补齐；待定问题只在作者勾选时带入并单独标识', () => {
  const turn = buildPreparedTurn({ message: 'm', memoryItems: sampleItems, pinnedMemoryIds: ['d', 'b'], projectKey: 'p' })
  assert.deepEqual(turn.selectedMemory.map((s) => `${s.id}:${s.reason}`), ['d:author-pinned', 'b:author-pinned', 'a:auto'])
  assert.match(turn.body, /\[待定问题\] 她为什么不拆信？/, '待定问题要单独标识，不混进默认事实')
  // 同一份输入重复构建结果一致（确定性）
  const again = buildPreparedTurn({ message: 'm', memoryItems: sampleItems, pinnedMemoryIds: ['d', 'b'], projectKey: 'p' })
  assert.deepEqual(again.selectedMemory.map((s) => s.id), turn.selectedMemory.map((s) => s.id))
  // 固定一个已撤回的条目：不带入，并如实报告原因
  const withRetracted = buildPreparedTurn({ message: 'm', memoryItems: sampleItems, pinnedMemoryIds: ['e'], projectKey: 'p' })
  assert.equal(withRetracted.selectedMemory.some((s) => s.id === 'e'), false)
  assert.equal(withRetracted.omissions.find((o) => o.id === 'e').reason, 'not-injectable')
})

ok('C03 预算按 Unicode 字符数生效：超出的省略并计数；作者正文与引用不受预算影响', () => {
  const big = Array.from({ length: 40 }, (_, i) => ({
    id: 'big' + i,
    kind: 'fact',
    status: 'confirmed',
    text: '设定'.repeat(80) + i, // 每条约 161 字
  }))
  const longMessage = '正'.repeat(9000)
  const turn = buildPreparedTurn({ message: longMessage, memoryItems: big, projectKey: 'p' })
  assert.ok(turn.charsUsed <= DEFAULT_MEMORY_BUDGET, `自动部分必须守住预算（实测 ${turn.charsUsed}）`)
  assert.ok(turn.omittedCount > 0, '应该有因长度被省略的条目')
  assert.equal(turn.body.endsWith(longMessage), true, '作者正文不能因为备忘预算被截断')
  assert.equal(turn.message.length, 9000)
  const ref = makeReference({ label: '稿件 · a.md · 10 字', excerpt: '稿'.repeat(50), path: '/x/a.md', revision: 'r1' })
  const withRef = buildPreparedTurn({ message: 'm', reference: ref, memoryItems: big, projectKey: 'p' })
  assert.equal(withRef.body.includes('稿'.repeat(50)), true, '显式引用的稿件不受自动预算截断')
})

ok('C04 preparedTurn 不可变（含嵌套），并带上核对用字段', () => {
  const turn = buildPreparedTurn({
    message: 'm',
    memoryItems: sampleItems,
    pinnedMemoryIds: ['a'],
    projectKey: 'proj/作品',
    operationId: 'op-1',
    memoryRevision: 7,
    memoryEtag: 'etag-7',
  })
  assert.equal(Object.isFrozen(turn), true)
  assert.equal(Object.isFrozen(turn.selectedMemory), true)
  assert.equal(Object.isFrozen(turn.selectedMemory[0]), true)
  assert.equal(Object.isFrozen(turn.omissions), true)
  assert.equal(turn.projectKey, 'proj/作品')
  assert.equal(turn.operationId, 'op-1')
  assert.equal(turn.memoryRevision, 7)
  assert.equal(turn.memoryEtag, 'etag-7')
  assert.equal(turn.selectedMemory[0].source.kind, 'author')
  assert.equal(Object.isFrozen(turn.selectedMemory[0].source), true)
  // 冻结后改备忘不影响已冻结的这次请求
  const before = turn.body
  sampleItems[0].text = '改成别的主角'
  assert.equal(turn.body, before)
})

ok('C05 关闭本次参考：正文与引用照常，明文不含备忘', () => {
  const turn = buildPreparedTurn({ message: 'm', memoryItems: sampleItems, includeMemory: false, projectKey: 'p' })
  assert.equal(turn.includeMemory, false)
  assert.equal(turn.selectedMemory.length, 0)
  assert.equal(turn.body.includes('项目备忘'), false)
  assert.equal(turn.body.includes('m'), true)
})

ok('C06 提示条数量与实际可自动参考条数一致', () => {
  assert.equal(memoryHint(sampleItems), '参考项目备忘 · 2 条')
  assert.equal(memoryHint([sampleItems[2]]), null, '只有候选时不该提示"参考"')
  const { selected } = selectMemory(sampleItems, [], DEFAULT_MEMORY_BUDGET)
  assert.equal(selected.length, 2)
})

console.log('--- D组：引用与恢复候选（§4.3）')

ok('D01 引用身份用结构相等（path/revision/选区/指纹），正文不同不改变身份', () => {
  const a = makeReference({ label: 'L', excerpt: '一二三', path: '/x/a.md', revision: 'r1', start: 0, end: 3 })
  const b = makeReference({ label: '别的名', excerpt: '一二三', path: '/x/a.md', revision: 'r1', start: 0, end: 3 })
  const c = makeReference({ label: 'L', excerpt: '一二三', path: '/x/a.md', revision: 'r2', start: 0, end: 3 })
  const d = makeReference({ label: 'L', excerpt: '一二三', path: '/x/a.md', revision: 'r1', start: 1, end: 3 })
  assert.equal(sameReference(a, b), true, 'label 不参与身份')
  assert.equal(sameReference(a, c), false, 'revision 参与身份')
  assert.equal(sameReference(a, d), false, '选区参与身份')
  assert.equal(sameReference(a, null), false)
})

ok('D02 源稿状态：current / stale / unsaved / unknown（源稿没打开时不谎报）', () => {
  const ref = makeReference({ label: 'L', excerpt: '文字', path: '/x/a.md', revision: 'r1' })
  assert.equal(referenceStatus(ref, { path: '/x/a.md', revision: 'r1' }), 'current')
  assert.equal(referenceStatus(ref, { path: '/x/a.md', revision: 'r2' }), 'stale')
  assert.equal(referenceStatus(ref, { path: '/x/b.md', revision: 'r1' }), 'unknown')
  assert.equal(referenceStatus(ref, null), 'unknown')
  const unsaved = makeReference({ label: 'L', excerpt: '文字', path: '/x/a.md', revision: 'r1', dirty: true })
  assert.equal(referenceStatus(unsaved, { path: '/x/a.md', revision: 'r1' }), 'unsaved')
  assert.equal(contentFingerprint('文字'), contentFingerprint('文字'))
  assert.notEqual(contentFingerprint('文字'), contentFingerprint('文字 '))
})

ok('D03 旧 checkpoint 的 {label,text} 引用按原样兼容：缺的来源字段保持 null，不猜测', () => {
  const legacy = normalizeReference({ label: '选区 · 第1章 · 20 字', text: '旧引用正文' })
  assert.equal(legacy.text, '旧引用正文')
  assert.equal(legacy.path, null)
  assert.equal(legacy.revision, null)
  assert.equal(legacy.selection, null)
  assert.equal(legacy.legacy, true)
  assert.equal(normalizeReference(null), null)
})

ok('D04 恢复候选：其他窗口的非空草稿列为候选，不含本窗口；采用是显式写回而非合并', () => {
  const other = 'win-other'
  writeCheckpoint(proj, other, { text: '另一个窗口写的想法', reference: null, baseRev: 0 })
  writeCheckpoint(proj, 'win-empty', { text: '', reference: null, baseRev: 0 })
  const all = listCheckpoints(proj)
  assert.equal(all.some((c) => c.windowId === other && c.text === '另一个窗口写的想法'), true)
  assert.ok(all.every((c) => typeof c.updatedAt === 'string' && c.windowId), '候选要带窗口与时间标记')
  // 客户端过滤规则：排除本窗口与空草稿
  const mine = 'win-mine'
  writeCheckpoint(proj, mine, { text: '我自己写的', reference: null, baseRev: 0 })
  const candidates = listCheckpoints(proj).filter((c) => c.windowId !== mine && String(c.text || '').trim())
  assert.deepEqual(candidates.map((c) => c.windowId), [other])
  // "采用"= 把候选文本写进当前窗口的 checkpoint，绝不是两段文字拼接
  const adopted = writeCheckpoint(proj, mine, { text: candidates[0].text, reference: null, baseRev: readCheckpoint(proj, mine).rev })
  assert.equal(adopted.checkpoint.text, '另一个窗口写的想法')
  assert.equal(adopted.checkpoint.text.includes('我自己写的'), false, '不得自动合并两份草稿')
})

console.log(`\nP3 记忆/上下文/引用: ${pass} 项通过`)
fs.rmSync(tmp, { recursive: true, force: true })
