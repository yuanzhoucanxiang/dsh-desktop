'use strict'

/* 插件管理核心（plugin-manager）单测。
 * 跑法：node lib/plugin-manager.test.js（纯 node，零 Electron 依赖）。
 * 覆盖：真实 bundle patch 形状的 id 提取、patch 清单解析、生效禁用态（后写胜出）、
 *        行级手术切换的各类路径，以及「看不懂就拒写」的保护行为。 */

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parsePatchList, effectiveDisabled, entryIdsFromBundlePatch, setEntryDisabled } = require('./plugin-manager')

let passed = 0
function t(name, fn) {
  fn()
  passed++
  console.log(`PASS ${name}`)
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugmgr-'))
const p = (n) => path.join(root, n)

// ── entryIdsFromBundlePatch ──────────────────────────────────────────────────

t('insert 块提取：palis 单条目', () => {
  const ids = entryIdsFromBundlePatch([
    '# 头注释',
    '- insert:',
    "    - id: palis-theme-panel",
    "      name: '@dsh-local/palis-theme-panel'",
    '      config: {}',
    '',
  ].join('\n'))
  assert.deepEqual(ids, ['palis-theme-panel'])
})

t('insert 提取：顶层 config 覆盖不算插件行（auto-mode 形状）', () => {
  const ids = entryIdsFromBundlePatch([
    '- id: permission',
    '  config:',
    '    presets:',
    '      read-only:',
    '        sandbox: read-only',
    '',
    '- insert:',
    '    - id: auto-permission-mode',
    "      name: '@nanmicoder/dsh-auto-mode'",
    '      config: {}',
  ].join('\n'))
  assert.deepEqual(ids, ['auto-permission-mode'])
})

t('insert 提取：多条目去重保序 + 引号剥离 + 注释行跳过', () => {
  const ids = entryIdsFromBundlePatch([
    '- insert:',
    "    - id: 'a-first'   # 首条",
    '    - id: b-second',
    '    # 纯注释',
    "    - id: 'a-first'",
    '    - name: no-id-here',
  ].join('\n'))
  assert.deepEqual(ids, ['a-first', 'b-second'])
})

t('insert 提取：无 insert 块 → 空', () => {
  assert.deepEqual(entryIdsFromBundlePatch('- id: x\n  disabled: true\n'), [])
})

// ── parsePatchList ───────────────────────────────────────────────────────────

t('解析：模板空表 []', () => {
  const r = parsePatchList('# 模板头注释\n# 第二行\n[]\n')
  assert.equal(r.ok, true)
  assert.equal(r.entries.length, 0)
  assert.ok(r.emptyFlowListLine >= 0)
})

t('解析：混合文件（config 展开块 + insert 嵌套）', () => {
  const r = parsePatchList([
    '- id: permission',
    '  config:',
    '    presets:',
    '      read-only:',
    '        sandbox: read-only',
    '        approval: ask',
    '',
    "- insert:",
    "    - id: auto-permission-mode",
    "      name: '@nanmicoder/dsh-auto-mode'",
    '      config: {}',
    '',
  ].join('\n'))
  assert.equal(r.ok, true, r.error)
  assert.equal(r.entries.length, 2)
  assert.equal(r.entries[0].id, 'permission')
  assert.equal(r.entries[0].insert, false)
  assert.equal(r.entries[1].insert, true)
})

t('解析：disabled 标量与引号值；!!js 记为 unsupported', () => {
  const r = parsePatchList([
    "- id: 'quoted-id'",
    '  disabled: true',
    '- id: expr-id',
    '  disabled: !!js process.env.X',
  ].join('\n'))
  assert.equal(r.ok, true, r.error)
  assert.equal(r.entries[0].id, 'quoted-id')
  assert.equal(r.entries[0].disabledValue, true)
  assert.equal(r.entries[1].unsupported, true)
})

t('解析失败：非法缩进拒绝', () => {
  const r = parsePatchList('- id: a\n   bad-indent: x\n  disabled: true\n')
  assert.equal(r.ok, false)
  assert.match(r.error, /第 2 行/)
})

// ── effectiveDisabled ────────────────────────────────────────────────────────

t('生效禁用态：最后一条说了算', () => {
  const r = parsePatchList('- id: x\n  disabled: true\n- id: y\n  disabled: true\n- id: x\n  disabled: false\n')
  assert.equal(effectiveDisabled(r.entries, 'x'), false)
  assert.equal(effectiveDisabled(r.entries, 'y'), true)
  assert.equal(effectiveDisabled(r.entries, 'z'), false)
})

// ── setEntryDisabled ─────────────────────────────────────────────────────────

t('禁用：模板 [] 文件原位替换为管理块', () => {
  const f = p('tpl.yml')
  fs.writeFileSync(f, '# Your patch layer:\n# a top-level YAML array.\n[]\n')
  const r = setEntryDisabled(f, 'palis-theme-panel', true)
  assert.equal(r.ok, true, r.error)
  const raw = fs.readFileSync(f, 'utf8')
  assert.match(raw, /^# Your patch layer:/m) // 头注释保留
  assert.ok(!raw.includes('[]'))
  assert.match(raw, /# 由 dsh-desktop 插件管理写入\n- id: palis-theme-panel\n  disabled: true\n$/)
})

t('启用：管理块翻 false 保留（不删块——内核热重载不回退删补丁），其余内容逐字保留', () => {
  const f = p('rm.yml')
  fs.writeFileSync(f, [
    '# 头注释保留',
    '- id: keep-cfg',
    '  config:',
    '    a: 1',
    '# 由 dsh-desktop 插件管理写入',
    '- id: palis-theme-panel',
    '  disabled: true',
  ].join('\n') + '\n')
  const before = fs.readFileSync(f, 'utf8').split('\n').slice(0, 4).join('\n')
  const r = setEntryDisabled(f, 'palis-theme-panel', false)
  assert.equal(r.ok, true, r.error)
  const raw = fs.readFileSync(f, 'utf8')
  assert.match(raw, /- id: palis-theme-panel\n  disabled: false/)
  assert.equal(raw.split('\n').slice(0, 4).join('\n'), before)
  assert.equal(parsePatchList(raw).entries.length, 2)
})

t('禁用→再启用 往返幂等（同一块反复翻 true/false）', () => {
  const f = p('rt.yml')
  fs.writeFileSync(f, '[]\n')
  assert.equal(setEntryDisabled(f, 'x-plugin', true).ok, true)
  const afterOn = fs.readFileSync(f, 'utf8')
  assert.equal(setEntryDisabled(f, 'x-plugin', true).changed, false) // 重复禁用不再改
  assert.equal(setEntryDisabled(f, 'x-plugin', false).ok, true)
  const afterOff = fs.readFileSync(f, 'utf8')
  assert.match(afterOff, /- id: x-plugin\n  disabled: false/) // 块保留，翻 false
  assert.notEqual(afterOff, afterOn)
  assert.equal(setEntryDisabled(f, 'x-plugin', false).changed, false)
  // 再禁用：就地把 false 翻回 true，不追加第二条
  assert.equal(setEntryDisabled(f, 'x-plugin', true).ok, true)
  const raw = fs.readFileSync(f, 'utf8')
  assert.equal(raw.match(/- id: x-plugin/g).length, 1)
  assert.match(raw, /disabled: true/)
})

t('禁用：已有用户条目（无 disabled 键）就地补一行，不动其它键', () => {
  const f = p('merge.yml')
  fs.writeFileSync(f, "- id: my-plugin\n  config: {}\n- insert:\n    - id: other\n")
  const r = setEntryDisabled(f, 'my-plugin', true)
  assert.equal(r.ok, true, r.error)
  const raw = fs.readFileSync(f, 'utf8')
  assert.match(raw, /- id: my-plugin\n  disabled: true\n  config: \{\}/)
  assert.match(raw, /- insert:/)
  const st = parsePatchList(raw)
  assert.equal(effectiveDisabled(st.entries, 'my-plugin'), true)
})

t('禁用：用户已写 disabled:false → 原地翻 true（不追加重复条目）', () => {
  const f = p('flip.yml')
  fs.writeFileSync(f, '- id: u1\n  disabled: false\n')
  assert.equal(setEntryDisabled(f, 'u1', true).ok, true)
  const raw = fs.readFileSync(f, 'utf8')
  assert.match(raw, /disabled: true/)
  assert.equal(raw.match(/- id: u1/g).length, 1)
})

t('启用：用户手工写的复杂禁用块翻 false 而非删除', () => {
  const f = p('userblk.yml')
  fs.writeFileSync(f, '# 用户手写\n- id: u2\n  name: some-pkg\n  disabled: true\n')
  const r = setEntryDisabled(f, 'u2', false)
  assert.equal(r.ok, true, r.error)
  const raw = fs.readFileSync(f, 'utf8')
  assert.match(raw, /disabled: false/)
  assert.match(raw, /name: some-pkg/) // 结构保留
  assert.equal(parsePatchList(raw).entries[0].disabledValue, false)
})

t('保护：解析不了的手工内容拒写', () => {
  const f = p('bad.yml')
  fs.writeFileSync(f, '- id: a\n   bad-indent: x\n')
  const r = setEntryDisabled(f, 'a', true)
  assert.equal(r.ok, false)
  assert.match(r.error, /拒绝修改/)
})

t('保护：!!js 表达式条目拒切', () => {
  const f = p('expr.yml')
  fs.writeFileSync(f, '- id: e1\n  disabled: !!js env.X\n')
  const r = setEntryDisabled(f, 'e1', false)
  assert.equal(r.ok, false)
  assert.match(r.error, /表达式/)
})

t('文件不存在：禁用=新建；启用=无操作', () => {
  const f1 = p('new.yml')
  const r1 = setEntryDisabled(f1, 'n1', true)
  assert.equal(r1.ok, true, r1.error)
  assert.match(fs.readFileSync(f1, 'utf8'), /- id: n1\n  disabled: true/)
  const f2 = p('absent.yml')
  const r2 = setEntryDisabled(f2, 'n2', false)
  assert.equal(r2.ok, true)
  assert.equal(r2.changed, false)
  assert.equal(fs.existsSync(f2), false)
})

t('多插件共存：互不干扰', () => {
  const f = p('multi.yml')
  fs.writeFileSync(f, '[]\n')
  setEntryDisabled(f, 'p1', true)
  setEntryDisabled(f, 'p2', true)
  setEntryDisabled(f, 'p3', true)
  let st = parsePatchList(fs.readFileSync(f, 'utf8'))
  assert.deepEqual(st.entries.map((e) => e.id), ['p1', 'p2', 'p3'])
  setEntryDisabled(f, 'p2', false)
  st = parsePatchList(fs.readFileSync(f, 'utf8'))
  assert.deepEqual(st.entries.map((e) => e.id), ['p1', 'p2', 'p3']) // 启用后块保留为 false
  assert.equal(st.entries.find((e) => e.id === 'p2').disabledValue, false)
  assert.equal(effectiveDisabled(st.entries, 'p1'), true)
  assert.equal(effectiveDisabled(st.entries, 'p3'), true)
})

console.log(`\n${passed} tests passed`)
