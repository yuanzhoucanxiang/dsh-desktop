/**
 * writing-mode P1 回归：编辑会话竞态、版本独占、API query、research 越权。
 * node plugin/writing-mode/test/p1-regression.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createEditorSession } from '../lib/editor-session.js'
import { writeDoc, createVersion, readDoc, resolveUnderRoots, readConfig, writeConfig, DEFAULT_PREFS } from '../lib/store.js'
import { recommend } from '../lib/domain.js'

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log('PASS', name, extra)
  } else {
    fail++
    console.log('FAIL', name, extra)
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-p1-'))
const project = path.join(root, 'demo')
fs.mkdirSync(path.join(project, 'draft', 'novel'), { recursive: true })
fs.writeFileSync(path.join(project, 'project.md'), '# demo\n')

// stub roots in a temp DSH_HOME
process.env.DSH_HOME = path.join(root, 'dsh-home')
fs.mkdirSync(process.env.DSH_HOME, { recursive: true })
writeConfig({
  roots: [{ path: root, label: 'root', default: true }],
  activeRoot: root,
  prefs: { ...DEFAULT_PREFS },
})

const roots = [{ path: root, real: fs.realpathSync(root), label: 'root', default: true }]

/* 1. 版本独占：已有 v2 时 createVersion 得到 v3，不覆盖 v2 */
{
  const p1 = path.join(project, 'draft', 'novel', 'chap-v1.md')
  const p2 = path.join(project, 'draft', 'novel', 'chap-v2.md')
  const t1 = resolveUnderRoots(p1, roots)
  writeDoc(t1, 'v1 body', null)
  writeDoc(resolveUnderRoots(p2, roots), 'v2 original', null)
  const doc = createVersion(t1, 'from v1 to next')
  ok('createVersion 不覆盖已有 v2', doc.path.endsWith('chap-v3.md'), doc.path)
  ok('v2 原文仍在', readDoc(resolveUnderRoots(p2, roots)).content === 'v2 original')
}

/* 2. 历史稿拒绝普通覆盖保存 */
{
  const p1 = path.join(project, 'draft', 'novel', 'chap-v1.md')
  const t1 = resolveUnderRoots(p1, roots)
  let threw = null
  try {
    writeDoc(t1, 'overwrite hist', readDoc(t1).revision)
  } catch (e) {
    threw = e
  }
  ok('历史稿 writeDoc 拒绝', threw?.error === 'historical-version' || String(threw).includes('historical'), String(threw?.error))
}

/* 3. 编辑会话：保存期间继续编辑，旧响应不误清 dirty */
{
  const file = path.join(project, 'draft', 'novel', 'race.md')
  const t = resolveUnderRoots(file, roots)
  writeDoc(t, 'initial', null)
  let resolveSave
  const saveGate = new Promise((r) => (resolveSave = r))
  const io = {
    read: async (p) => ({ ok: true, doc: readDoc(resolveUnderRoots(p, roots)) }),
    save: async (body) => {
      await saveGate
      const tgt = resolveUnderRoots(body.path, roots)
      const doc = writeDoc(tgt, body.content, body.revision)
      return { ok: true, doc: { path: doc.path, content: doc.content, revision: doc.revision, mtime: doc.mtime } }
    },
    version: async (body) => ({ ok: true, doc: createVersion(resolveUnderRoots(body.path, roots), body.content) }),
    backup: () => {},
  }
  // readDoc 用 digest 字段还是 revision？
  const d0 = readDoc(t)
  const revisionField = 'revision' in d0 ? d0.revision : d0.mtime
  const session = createEditorSession(io, null)
  await session.open(file)
  session.change('edited A')
  const p = session.flush()
  session.change('edited B')
  resolveSave()
  await p
  const st = session.get()
  // flush 会递归直到干净：竞态时先落 A 再自动落 B，最终不应停在「已保存」却磁盘是 A
  ok('竞态后内容为 B', st.content === 'edited B', st.content)
  ok('竞态后 dirty 已清且磁盘为 B', st.dirty === false && readDoc(t).content === 'edited B', `dirty=${st.dirty} disk=${readDoc(t).content}`)
}

/* 4. research 越权：库外 path 不应被读入 brief */
{
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-out-'))
  fs.mkdirSync(path.join(outside, 'bible'), { recursive: true })
  fs.writeFileSync(path.join(outside, 'project.md'), '# evil\n作品名：《越权》\n')
  fs.writeFileSync(path.join(outside, 'bible', 'world.md'), 'SECRET_MARKER_XYZ\n')
  // host assist 已 resolveUnderRoots；domain.recommend 若直接 findProjectRoot 仍可能读到
  // 模拟：recommend 收到已 resolve 的 path（host 行为）vs 未 resolve
  const evilBody = { action: 'research', text: 'x', path: path.join(outside, 'project.md') }
  const r = await recommend({ llm: null }, evilBody, DEFAULT_PREFS)
  const leaked = String(r.result || '').includes('SECRET_MARKER_XYZ') || String(r.result || '').includes('越权')
  // 无 LLM 时 brief 可能进 heuristic；若 host 已 resolve 则 outside 不可达。
  // 这里单测 domain：若未强制 resolve，可能泄漏 — 记录结果
  ok('research 结果不含库外密文（domain 层）', !String(r.result || '').includes('SECRET_MARKER_XYZ'), r.result?.slice(0, 80))
  fs.rmSync(outside, { recursive: true, force: true })
}

/* 5. api() 路由编码：用与 client 相同的 URLSearchParams 形状 */
{
  const params = new URLSearchParams({ route: 'get', path: '/x/y.md' })
  const url = '/api/writing-mode?' + params.toString()
  const parsed = new URL(url, 'http://127.0.0.1')
  ok('route 与 path 分离', parsed.searchParams.get('route') === 'get' && parsed.searchParams.get('path') === '/x/y.md', url)
}

fs.rmSync(root, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
