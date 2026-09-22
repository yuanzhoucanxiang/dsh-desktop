import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-create-http-'))
process.env.DSH_HOME = path.join(temp, 'home')
const root = path.join(temp, 'library')
fs.mkdirSync(root, { recursive: true })
const store = await import('../lib/store.js')
const host = await import('../index.js')
const { listTemplates, renderTemplate } = await import('../lib/templates.js')
store.writeConfig({ roots: [{ path: root }], activeRoot: root })
let handler
host.apply({ effect: f => f(), webServer: { register: r => { handler = r.handler; return () => {} } } })
const server = http.createServer((req, res) => handler(req, res))
await new Promise(r => server.listen(0, '127.0.0.1', r))
const post = async (body, route = 'create-project') => (await fetch(`http://127.0.0.1:${server.address().port}/api/writing-mode?route=${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()
try {
  for (const t of listTemplates()) {
    const title = '新作品-' + t.id
    const result = await post({ title, templateId: t.id, premise: '保留中文前提', fullTemplate: true })
    assert.equal(result.ok, true, JSON.stringify(result))
    for (const f of renderTemplate(t.id, title, '保留中文前提').files.filter(f => !f.rel.endsWith('.gitkeep'))) assert.equal(fs.readFileSync(path.join(root, title, f.rel), 'utf8'), f.body)
    assert.equal((await post({ title, templateId: t.id })).error, 'project-exists')
    console.log('PASS full HTTP create + all template bytes + duplicate refusal', t.id)
  }
  const starter = await post({ title: '轻量作品' })
  assert.equal(starter.ok, true)
  assert.deepEqual(starter.project.files, ['project.md', 'draft/novel/第1章-v1.md'])
  const project = starter.project.path
  assert.equal(fs.existsSync(path.join(project, 'bible')), false)
  const resource = await post({ path: project, resource: 'bible/characters.md' }, 'project-resource')
  assert.equal(resource.ok, true, JSON.stringify(resource))
  fs.writeFileSync(resource.path, '作者编辑')
  assert.equal((await post({ path: project, resource: 'bible/characters.md' }, 'project-resource')).error, 'resource-exists')
  assert.equal(fs.readFileSync(resource.path, 'utf8'), '作者编辑')
  assert.equal((await post({ path: project, resource: '../outside.md' }, 'project-resource')).ok, false)
  const outside = path.join(temp, 'outside'); fs.mkdirSync(outside)
  fs.symlinkSync(outside, path.join(project, 'outline'), 'junction')
  assert.equal((await post({ path: project, resource: 'outline/structure.md' }, 'project-resource')).ok, false)
  assert.deepEqual(fs.readdirSync(outside), [])
  console.log('PASS lightweight creation, on-demand resources, no overwrite or junction escape')
  fs.mkdirSync(path.join(root, '已有资料'))
  fs.writeFileSync(path.join(root, '已有资料', '原文.md'), '保留')
  assert.equal((await post({ title: '已有资料' })).error, 'directory-not-empty')
  assert.equal(fs.readFileSync(path.join(root, '已有资料', '原文.md'), 'utf8'), '保留')
  assert.equal((await post({ title: '..' })).ok, false)
  console.log('PASS existing content and invalid name protected')
} finally { server.closeAllConnections(); await new Promise(r => server.close(r)) }
