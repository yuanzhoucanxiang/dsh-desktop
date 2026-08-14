'use strict'
// review-bridge 回退引擎单测：用合成事件流 + 临时文件验证
// edit / write(含 Created file) / str_replace_editor 的逆操作正确性。
// 用法：node test/review-revert-test.js
const assert = require('node:assert')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const mod = require('../plugin/review-bridge.js').__test
const { reverseChange, parseReadText, stateBeforeMutation } = mod

const tmp = path.join(os.tmpdir(), 'rb-test-' + Date.now())
const FILE = path.join(tmp, 'a.txt')

let seq = 1
const mkCall = (name, args, callId) => ({ type: 'tool/call', seq: seq++, data: { turn: 1, step: 1, callId: callId || 'c' + seq, name, arguments: args } })
const mkResult = (callId, text) => ({ type: 'tool/result', seq: seq++, data: { message: { source: { callId }, content: [{ type: 'text', text }] } } })
const mkReadCall = (callId, filePath) => mkCall('read', { file_path: filePath }, callId)
const mkReadResult = (callId, body) => mkResult(callId, `<path>${FILE}</path>\n<type>file</type>\n<content>\n${body}\n</content>`)

async function main() {
  await fsp.mkdir(tmp, { recursive: true })
  const readText = (text) => {
    const lines = text.split('\n')
    const numbered = lines.map((l, i) => `${i + 1}: ${l}`).join('\n')
    return `${numbered}\n(End of file - total ${lines.length} lines)`
  }

  // ── 1. edit 回退：new→old ──
  const original = 'line1\nline2\nline3\n'
  await fsp.writeFile(FILE, 'line1\nline2-CHANGED\nline3\n', 'utf8')
  let events = [mkCall('edit', { file_path: FILE, old_string: 'line2', new_string: 'line2-CHANGED' })]
  let r = await reverseChange(events, tmp, 0, events[0])
  assert.ok(r.ok, 'edit revert ok')
  assert.strictEqual(await fsp.readFile(FILE, 'utf8'), original, 'edit revert restores old')

  // ── 2. edit 幂等：文件已回到 old 状态 ──
  r = await reverseChange(events, tmp, 0, events[0])
  assert.ok(r.ok, 'edit revert idempotent')
  assert.strictEqual(await fsp.readFile(FILE, 'utf8'), original, 'idempotent keeps old')

  // ── 3. edit 冲突：当前文件两者都不含 ──
  await fsp.writeFile(FILE, 'completely different\n', 'utf8')
  r = await reverseChange(events, tmp, 0, events[0])
  assert.ok(!r.ok, 'edit revert conflict fails')
  assert.match(r.error, /不一致/, 'conflict error message')
  assert.strictEqual(await fsp.readFile(FILE, 'utf8'), 'completely different\n', 'conflict leaves file untouched')

  // ── 4. edit replace_all 回退 ──
  await fsp.writeFile(FILE, 'x A x A x\n', 'utf8')
  events = [mkCall('edit', { file_path: FILE, old_string: 'A', new_string: 'B', replace_all: true })]
  r = await reverseChange(events, tmp, 0, events[0])
  assert.ok(r.ok, 'replace_all revert ok')
  assert.strictEqual(await fsp.readFile(FILE, 'utf8'), 'x A x A x\n', 'replace_all restores all')

  // ── 5. write 回退（有先前 read 记录）──
  await fsp.writeFile(FILE, original, 'utf8')
  const rid = 'read1'
  events = [mkReadCall(rid, FILE), mkReadResult(rid, readText(original)), mkCall('write', { file_path: FILE, content: 'NEW CONTENT\n' }, 'w1'), mkResult('w1', `Wrote contents to ${FILE}.`)]
  await fsp.writeFile(FILE, 'NEW CONTENT\n', 'utf8')
  r = await reverseChange(events, tmp, 2, events[2])
  assert.ok(r.ok, 'write revert ok: ' + JSON.stringify(r))
  assert.strictEqual(await fsp.readFile(FILE, 'utf8'), original, 'write restore pre-state')

  // ── 6. write 无先前状态 → 报错 ──
  await fsp.writeFile(FILE, 'NEW CONTENT\n', 'utf8')
  events = [mkCall('write', { file_path: FILE, content: 'NEW CONTENT\n' }, 'w2'), mkResult('w2', `Wrote contents to ${FILE}.`)]
  r = await reverseChange(events, tmp, 0, events[0])
  assert.ok(!r.ok, 'write without prior state fails')
  assert.match(r.error, /无法从会话日志重建/, 'write error message')

  // ── 7. write Created file → 删除 ──
  const NEWF = path.join(tmp, 'new.txt')
  events = [mkCall('write', { file_path: NEWF, content: 'hi\n' }, 'w3'), mkResult('w3', `Created file ${NEWF}.`)]
  await fsp.writeFile(NEWF, 'hi\n', 'utf8')
  r = await reverseChange(events, tmp, 0, events[0])
  assert.ok(r.ok, 'created-file revert ok')
  await assert.rejects(fsp.access(NEWF), 'created file deleted')

  // ── 8. str_replace_editor 回退 ──
  await fsp.writeFile(FILE, 'AAA BBB CCC\n', 'utf8')
  events = [mkCall('str_replace_editor', { command: 'str_replace', path: FILE, old_str: 'BBB', new_str: 'XXX' }, 's1'), mkResult('s1', 'File updated.')]
  r = await reverseChange(events, tmp, 0, events[0])
  assert.ok(r.ok, 'str_replace revert ok')
  assert.strictEqual(await fsp.readFile(FILE, 'utf8'), 'AAA BBB CCC\n', 'str_replace restores old_str')

  // ── 9. str_replace_editor 非 str_replace 命令 → 报错 ──
  events = [mkCall('str_replace_editor', { command: 'view', path: FILE }, 's2')]
  r = await reverseChange(events, tmp, 0, events[0])
  assert.ok(!r.ok, 'non-str_replace fails')
  assert.match(r.error, /仅支持回退 str_replace/, 'command error message')

  // ── 10. parseReadText / stateBeforeMutation 边界 ──
  assert.strictEqual(parseReadText('garbage'), null, 'parseReadText garbage null')
  const rt = await fsp.readFile(FILE, 'utf8')
  const full = `<path>${FILE}</path>\n<type>file</type>\n<content>\n${readText(rt)}\n</content>`
  assert.strictEqual(parseReadText(full), rt, 'parseReadText round-trips')
  const st = stateBeforeMutation([mkReadCall('r9', FILE), mkReadResult('r9', readText(rt)), mkCall('edit', { file_path: FILE, old_string: 'A', new_string: 'B' }, 'e9')], tmp, FILE, 2)
  assert.strictEqual(st.kind, 'content', 'stateBeforeMutation finds read state')
  assert.strictEqual(st.content, rt, 'stateBeforeMutation content correct')

  await fsp.rm(tmp, { recursive: true, force: true })
  console.log('ALL 10 REVERT TESTS PASSED')
}

main().catch((err) => {
  console.error('TEST FAILED:', err)
  process.exit(1)
})
