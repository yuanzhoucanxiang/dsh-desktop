// Hermetic behavior regression: real HTTP + store, production browser controller.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { apply } from '../plugin/writing-mode/index.js'
import * as store from '../plugin/writing-mode/lib/store.js'
import * as domain from '../plugin/writing-mode/lib/domain.js'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-writing-regression-'))
process.env.DSH_HOME = path.join(home, 'home')
const root = path.join(home, 'library')
const project = path.join(root, '中文项目')
fs.mkdirSync(path.join(project, 'draft/novel'), { recursive: true })
fs.writeFileSync(path.join(project, 'project.md'), '作品名：测试项目')
store.writeConfig({ roots: [{ path: root, default: true }], activeRoot: root, prefs: { ...store.DEFAULT_PREFS, aiApiKey: 'fixture-secret' } })
let handler
apply({ effect: f => f(), webServer: { register: r => { handler = r.handler; return () => {} } } })
const server = http.createServer((req, res) => handler(req, res).catch(err => { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: err.message })) }))
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let client
const sandbox = {
  URLSearchParams, AbortController, setTimeout, clearTimeout, crypto: globalThis.crypto,
  localStorage: { getItem: () => null }, navigator: { language: 'zh-CN' },
  fetch: (url, opts) => fetch(origin + url, opts), console,
  window: { __ModuleLoader__: { load: m => { client = m.factory(() => ({})) } } },
}
vm.runInNewContext(fs.readFileSync(path.join(repo, 'plugin/writing-mode/client.js'), 'utf8'), sandbox)
const post = (route, body) => client.api(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const read = p => client.api('get', undefined, { path: p })
const baseIo = { read, save: body => post('save', body), version: body => post('version', body) }
const create = async (name, content) => {
  const p = path.join(project, 'draft/novel', name)
  const response = await post('save', { path: p, content, revision: null })
  assert.equal(response.ok, true, JSON.stringify(response))
  return response.doc
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const results = []
async function test(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log('PASS', name) }
  catch (err) { results.push({ name, pass: false, error: err.stack }); console.error('FAIL', name, err); }
}
try {
  await test('真实 HTTP：中文、空格、& 路径正确读取；配置不回传 Key', async () => {
    const doc = await create('场景 & 中文-v1.md', '原稿')
    assert.equal((await read(doc.path)).doc.content, '原稿')
    const cfg = await client.api('config')
    assert.equal(JSON.stringify(cfg).includes('fixture-secret'), false)
    assert.equal(cfg.prefs.aiKeyConfigured, true)
  })
  await test('保存期间继续输入：两次写入排队，最终字节和已保存状态一致', async () => {
    const doc = await create('慢保存-v1.md', '初稿')
    const entered = deferred(), release = deferred()
    let calls = 0
    const editor = client.createEditorSession({ ...baseIo, save: async body => { calls++; if (calls === 1) { entered.resolve(); await release.promise } return baseIo.save(body) } })
    await editor.open(doc.path); editor.change('第一次编辑')
    const saving = editor.flush(); await entered.promise
    editor.change('保存期间的第二次编辑'); release.resolve()
    assert.equal(await saving, true)
    assert.equal(calls, 2)
    assert.equal(fs.readFileSync(doc.path, 'utf8'), '保存期间的第二次编辑')
    assert.equal(editor.get().dirty, false)
  })
  await test('快速 A→B→C：B 的迟到响应不能覆盖 C', async () => {
    const a = await create('切换A-v1.md', 'A'), b = await create('切换B-v1.md', 'B'), c = await create('切换C-v1.md', 'C')
    const entered = deferred(), release = deferred()
    const editor = client.createEditorSession({ ...baseIo, read: async p => { if (p === b.path) { entered.resolve(); await release.promise } return read(p) } })
    await editor.open(a.path); editor.change('保存A')
    const opening = editor.open(b.path); await entered.promise
    await editor.open(c.path); release.resolve(); await opening
    assert.equal(editor.get().path, c.path); assert.equal(editor.get().content, 'C')
    assert.equal(fs.readFileSync(a.path, 'utf8'), '保存A')
    assert.equal(fs.readFileSync(b.path, 'utf8'), 'B')
  })
  await test('读取失败保留原文和目标；编辑后关闭先保存', async () => {
    const doc = await create('读取失败-v1.md', '原文')
    const editor = client.createEditorSession(baseIo)
    await editor.open(doc.path)
    assert.equal(await editor.open(path.join(root, '不存在.md')), false)
    assert.equal(editor.get().path, doc.path); assert.equal(editor.get().content, '原文')
    editor.change('关闭前未保存'); assert.equal(await editor.close(), true)
    assert.equal(fs.readFileSync(doc.path, 'utf8'), '关闭前未保存')
  })
  await test('外部修改冲突阻止覆盖和切换；当前文字可另存新版', async () => {
    const doc = await create('外部冲突-v1.md', '初稿')
    let backup
    const editor = client.createEditorSession({ ...baseIo, backup: d => { backup = d } })
    await editor.open(doc.path); editor.change('编辑器新文字')
    fs.writeFileSync(doc.path, '外部新文字')
    assert.equal(await editor.close(), false)
    assert.equal(await editor.open(path.join(root, '任意.md')), false)
    assert.equal(backup.content, '编辑器新文字')
    assert.equal(fs.readFileSync(doc.path, 'utf8'), '外部新文字')
    assert.equal(await editor.version(), true)
    assert.equal(fs.readFileSync(editor.get().path, 'utf8'), '编辑器新文字')
    assert.equal(fs.readFileSync(doc.path, 'utf8'), '外部新文字')
  })
  await test('v1 另存跳过已有 v2，历史稿禁止覆盖；不同项目编号独立', async () => {
    const v1 = await create('版本-v1.md', '旧稿1'), v2 = await create('版本-v2.md', '旧稿2')
    const v3 = await post('version', { path: v1.path, content: '新稿3' })
    assert.equal(v3.ok, true); assert.equal(path.basename(v3.doc.path), '版本-v3.md')
    assert.equal(fs.readFileSync(v2.path, 'utf8'), '旧稿2')
    assert.equal((await post('save', { path: v1.path, revision: v1.revision, content: '破坏' })).error, 'historical-version')
    const other = path.join(root, 'other.md')
    assert.equal((await post('save', { path: other, content: '新稿', revision: null })).ok, true)
    assert.equal(path.basename((await post('version', { path: other, content: '另项目' })).doc.path), 'other-v2.md')
  })
  await test('缺版本条件及空 revision 不能覆盖已有文件', async () => {
    const doc = await create('条件写-v1.md', '不得覆盖')
    assert.equal((await post('save', { path: doc.path, content: '坏' })).error, 'revision-required')
    assert.equal((await post('save', { path: doc.path, revision: null, content: '坏' })).error, 'document-conflict')
    assert.equal(fs.readFileSync(doc.path, 'utf8'), '不得覆盖')
  })
  await test('新建独立文稿保存后可从树中找回', async () => {
    const editor = client.createEditorSession(baseIo)
    assert.equal(await editor.create(root, '独立文稿'), true)
    const tree = (await client.api('tree')).tree
    assert.equal(tree.flatMap(r => r.projects.flatMap(p => p.files)).some(f => f.abs === editor.get().path), true)
  })
  await test('关闭前草稿恢复：保留基线，外部冲突不会自动覆盖', async () => {
    const doc = await create('恢复-v1.md', '原版')
    const recovered = { path: doc.path, revision: doc.revision, content: '恢复文字' }
    fs.writeFileSync(doc.path, '外部修改')
    const editor = client.createEditorSession(baseIo, recovered)
    await editor.open(doc.path)
    assert.equal(editor.get().content, '恢复文字'); assert.equal(editor.get().dirty, true)
    assert.equal(await editor.flush(), false)
    assert.equal(fs.readFileSync(doc.path, 'utf8'), '外部修改')
  })
  await test('路径越界、伪造 Origin/Host、text/plain 写请求均拒绝', async () => {
    const outside = path.join(home, 'outside'); fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'project.md'), '作品名：OUTSIDE')
    const attempt = await post('assist', { action: 'research', path: path.join(outside, 'draft.md') })
    assert.equal(attempt.error, 'path-outside-roots')
    assert.equal((await read(path.join(outside, 'project.md'))).ok, false)
    for (const headers of [{ origin: 'https://audit.invalid', 'content-type': 'application/json' }, { 'content-type': 'text/plain' }, { host: 'audit.invalid', 'content-type': 'application/json' }]) {
      const status = await new Promise((resolve, reject) => {
        const req = http.request(origin + '/api/writing-mode?route=roots', { method: 'POST', headers }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
        req.on('error', reject)
        req.end(JSON.stringify({ mode: 'set', roots: [] }))
      })
      assert.equal([403,415].includes(status), true, JSON.stringify({ headers, status }))
    }
    assert.equal(store.readConfig().roots.length, 1)
  })
  await test('junction 外部目录不进入树、台账或 AI 摘要', async () => {
    const external = path.join(home, 'external-bible'); fs.mkdirSync(external)
    fs.writeFileSync(path.join(external, 'world.md'), 'SECRET-SENTINEL')
    fs.writeFileSync(path.join(external, 'timeline.md'), 'SECRET-SENTINEL')
    fs.symlinkSync(external, path.join(project, 'bible'), process.platform === 'win32' ? 'junction' : 'dir')
    assert.equal(store.listProjectFiles(project).some(f => f.abs.startsWith(external)), false)
    assert.equal(domain.projectContextBrief(project).includes('SECRET-SENTINEL'), false)
    assert.equal(JSON.stringify(domain.ledgerSummary(project)).includes('SECRET-SENTINEL'), false)
  })
  await test('原子替换失败保留原字节并清理临时文件', async () => {
    const doc = await create('原子失败-v1.md', '原稿完整')
    const original = fs.renameSync
    fs.renameSync = () => { throw Object.assign(new Error('locked'), { code: 'EPERM' }) }
    try { assert.throws(() => store.writeDoc({ abs: doc.path }, '新稿', doc.revision), /locked/) }
    finally { fs.renameSync = original }
    assert.equal(fs.readFileSync(doc.path, 'utf8'), '原稿完整')
    assert.equal(fs.readdirSync(path.dirname(doc.path)).some(n => n.endsWith('.tmp')), false)
  })
  await test('门禁只检查适用稿件；Fountain 引号不漏过；台账最高版本不由 mtime 逆转', async () => {
    assert.equal(domain.runGates(path.join(project, 'project.md'), '立项').kind, 'none')
    assert.equal(domain.checkFountainGates('INT. ROOM - DAY\n\n@小王\n"你好"\n\nCUT TO:').pass, false)
    const v1 = await create('台账-v1.md', '旧'), v2 = await create('台账-v2.md', '新')
    fs.utimesSync(v1.path, new Date(), new Date(Date.now() + 5000))
    assert.equal(domain.ledgerSummary(project, v1.path).latestDraft.path, v2.path)
  })
  await test('Harness 默认使用全局模型；多个文本块完整保留', async () => {
    const route = domain.resolveAiRoute({ agentDefaultModel: { currentSelection: () => ({ provider: 'expected', model: 'global' }) }, sessions: { list: () => { throw Error('must not inspect other sessions') } } }, store.DEFAULT_PREFS)
    assert.equal(route.provider, 'expected')
    const result = await domain.chatComplete({ llm: { async *stream() {
      yield { type: 'text-delta', index: 0, text: '甲' }; yield { type: 'block-end', index: 0, block: { type: 'text', text: '甲' } }
      yield { type: 'text-delta', index: 1, text: '乙' }; yield { type: 'block-end', index: 1, block: { type: 'text', text: '乙' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } } }, { userText: 'test', route })
    assert.equal(result.text, '甲乙')
  })
  await test('原生伙伴：项目隔离、重进复用、预设持久化且不覆盖自定义', async () => {
    const doc = await create('伙伴-v1.md', '稿件')
    const byId = {}, drafts = {}, opened = []
    let creates = 0, selections = 0, submissions = 0
    const sessions = {
      refresh: async () => {}, list: { getSnapshot: () => ({ byId }) },
      create: async opts => {
        assert.equal(opts.workspaceId, 'workspace-test'); assert.equal('reuseWorkspaceBlank' in opts, false)
        const id = 'companion-' + ++creates; byId[id] = { id }; drafts[id] = ''; return id
      },
      open: id => opened.push(id), noteAgentPreset: () => {},
      provideInfo: id => ({ hooks: { input: { getSnapshot: () => ({ draft: drafts[id] }) } }, props: { inputActions: { setDraft: text => { drafts[id] = text }, submit: () => submissions++ } } }),
    }
    const connection = { agentPresets: { select: async ({ agentPreset }) => { selections++; assert.equal(agentPreset, 'writing-companion'); return { result: { ok: true, value: { agentPreset } } } } } }
    const workspaces = { create: async ({ path: dir }) => { assert.ok(path.isAbsolute(dir)); return { workspaceId: 'workspace-test' } } }
    const first = await client.ensureCompanionSession(sessions, doc.path, () => true, connection, workspaces)
    client.appendCompanionDraft(sessions, first.sessionId, '我已有的想法')
    client.appendCompanionDraft(sessions, first.sessionId, '选区快照')
    const second = await client.ensureCompanionSession(sessions, path.join(project, 'project.md'), () => true, connection, workspaces)
    assert.equal(first.sessionId, second.sessionId); assert.equal(creates, 1); assert.equal(selections, 1)
    assert.match(drafts[first.sessionId], /我已有的想法\n\n选区快照$/); assert.equal(submissions, 0)
    const presetFile = path.join(path.dirname(store.configFile()), '.agent-presets/writing-companion/agent.cordis.yml')
    assert.match(fs.readFileSync(presetFile, 'utf8'), /不强制阶段/)
    fs.appendFileSync(presetFile, '\n# customized\n')
    await post('companion', { path: doc.path, prepare: true })
    assert.match(fs.readFileSync(presetFile, 'utf8'), /# customized/)
    await post('prefs', { fontSize: 18 })
    assert.equal((await client.api('companion', undefined, { path: doc.path })).sessionId, first.sessionId)
    assert.equal((await post('companion', { path: os.tmpdir(), prepare: true })).ok, false)
    const before = opened.length
    assert.equal(await client.ensureCompanionSession(sessions, doc.path, () => false, connection, workspaces), null)
    assert.equal(opened.length, before)
    const secondProject = path.join(root, '另一部作品')
    fs.mkdirSync(secondProject, { recursive: true })
    const otherDoc = path.join(secondProject, 'project.md'); fs.writeFileSync(otherDoc, '另一部作品')
    let stillCurrent = true
    const entered = deferred(), release = deferred()
    const originalCreate = sessions.create
    sessions.create = async opts => { entered.resolve(); await release.promise; return originalCreate(opts) }
    const connecting = client.ensureCompanionSession(sessions, otherDoc, () => stillCurrent, connection, workspaces)
    await entered.promise; stillCurrent = false; release.resolve()
    assert.equal(await connecting, null); assert.equal(opened.length, before)
    const other = await client.api('companion', undefined, { path: otherDoc })
    assert.notEqual(other.sessionId, first.sessionId)
    assert.equal((await client.api('companion', undefined, { path: doc.path })).sessionId, first.sessionId)
    assert.equal(drafts[other.sessionId], '')
  })
  await test('伙伴或外部编辑：干净稿刷新，未保存稿保留并提示冲突', async () => {
    const doc = await create('外部刷新-v1.md', '初稿')
    const editor = client.createEditorSession(baseIo)
    await editor.open(doc.path)
    fs.writeFileSync(doc.path, '外部改稿')
    await editor.refresh(); assert.equal(editor.get().content, '外部改稿')
    editor.change('正在输入')
    fs.writeFileSync(doc.path, '外部再改')
    await editor.refresh(); assert.equal(editor.get().content, '正在输入'); assert.equal(editor.get().status, 'error')
    assert.equal(await editor.flush(), false)
    assert.equal(fs.readFileSync(doc.path, 'utf8'), '外部再改')
  })
} finally {
  await new Promise(resolve => server.close(resolve))
  fs.writeFileSync(path.join(home, 'results.json'), JSON.stringify(results, null, 2))
}
console.log(`RESULT ${results.filter(r => r.pass).length}/${results.length} report=${path.join(home, 'results.json')}`)
process.exitCode = results.every(r => r.pass) ? 0 : 1
