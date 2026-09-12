// Reuse the existing isolated Electron fixture scaffolding, without modifying the
// production client. Stable provideInfo matches the pinned native runtime.
// Run: node_modules/.bin/electron.cmd docs/audits/writing-architecture/2026-09-12/review-ui.cjs
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const repo = path.resolve(__dirname, '../../../..')
let fixture = fs.readFileSync(path.join(repo, 'scripts/verify-writing-chat.cjs'), 'utf8')
fixture = fixture.replace("const repo = path.resolve(__dirname, '..')", `const repo = ${JSON.stringify(repo)}`)
const oldSessions = "const sessions={list,refresh:async()=>{},open:()=>{},binding:()=>({session}),provideInfo:()=>({hooks:{input:draftStore},props:{inputActions:{setDraft:text=>draftStore.set({draft:text})}}})};"
if (!fixture.includes(oldSessions)) throw new Error('fixture changed; inspect before reuse')
fixture = fixture.replace(oldSessions, "const info={hooks:{input:draftStore},props:{inputActions:{setDraft:text=>draftStore.set({draft:text})}}}; const sessions={list,refresh:async()=>{},open:()=>{},binding:()=>({session}),provideInfo:()=>info};")
const cut = fixture.indexOf("  await input('.dshWmChatInput', '她为什么不拆信？')")
if (cut < 0) throw new Error('fixture changed; missing start anchor')
fixture = fixture.slice(0, cut) + String.raw`
  const findings = []
  const record = (name, evidence) => { findings.push({ name, reproduced: true, evidence }); console.log('REPRODUCED', name, JSON.stringify(evidence)) }
  const memStore = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/lib/project-memory.js')))
  const draftStoreHost = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/lib/draft-checkpoints.js')))
  await button('项目备忘')
  await waitFor("!!document.querySelector('.dshWmMemory input')")
  await input('.dshWmMemory input', 'MEMORY_SENTINEL_CONFIRMED')
  await button('记下')
  await waitFor("document.querySelector('.dshWmMemoryList').innerText.includes('MEMORY_SENTINEL_CONFIRMED')")
  assert.equal(memStore.readMemory(root).memory.items[0].status, 'confirmed')
  // Also seed the correct project location, so the prompt check does not depend
  // on the separate UI-directory resolution defect.
  memStore.applyMemoryOp(project, { op: 'add', item: { text: 'MEMORY_SENTINEL_CONFIRMED', status: 'confirmed' } })
  await input('.dshWmChatInput', '继续讨论')
  await evaluate("document.querySelector('.dshWmSend').click()")
  await waitFor('testChat.calls.length===1')
  const sent = await evaluate('testChat.calls[0].content[0].text')
  assert.equal(sent.includes('MEMORY_SENTINEL_CONFIRMED'), false)
  record('UI1 confirmed memory absent from actual prompt', { sent })
  await evaluate("testChat.resolve({ok:false,error:{message:'fixture preserve draft'}})")
  await waitFor("!document.querySelector('.dshWmSend').disabled")
  await input('.dshWmChatInput', 'UNSENT_DRAFT_SENTINEL')
  await evaluate("document.querySelector('.dshWmEditor').setSelectionRange(0,3)")
  await button('＋ 引用稿件 / 选区')
  const windowId = await evaluate("sessionStorage.getItem('dsh-writing-window')")
  const until = Date.now() + 5000
  let checkpoint
  do {
    checkpoint = draftStoreHost.readCheckpoint(project, windowId)
    if (checkpoint?.text === 'UNSENT_DRAFT_SENTINEL' && checkpoint?.reference?.text.endsWith('第一章')) break
    await sleep(30)
  } while (Date.now() < until)
  assert.equal(checkpoint?.text, 'UNSENT_DRAFT_SENTINEL')
  assert.ok(checkpoint?.reference?.text.endsWith('第一章'))
  await win.reload()
  await waitFor("!!document.querySelector('.dshWmChatInput')")
  await sleep(350)
  const restored = await evaluate("({draft:document.querySelector('.dshWmChatInput').value,reference:!!document.querySelector('.dshWmReference')})")
  assert.equal(restored.draft, '')
  assert.equal(restored.reference, false)
  assert.equal(draftStoreHost.readCheckpoint(project, windowId).text, 'UNSENT_DRAFT_SENTINEL')
  record('UI2 bound-session reload ignores existing checkpoint and reference', { checkpointText: checkpoint.text, checkpointReference: checkpoint.reference.text, restored })
  await button('项目备忘')
  await waitFor("document.querySelector('.dshWmMemoryList')?.innerText.includes('MEMORY_SENTINEL_CONFIRMED')")
  await input('.dshWmMemory input', 'IME_CANDIDATE')
  await evaluate("document.querySelector('.dshWmMemory input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}))")
  await waitFor("document.querySelector('.dshWmMemoryList').innerText.includes('IME_CANDIDATE')")
  const imeItem = memStore.readMemory(root).memory.items.find(i => i.text === 'IME_CANDIDATE')
  assert.equal(imeItem.status, 'confirmed')
  record('UI3 IME composing Enter creates confirmed fact', { status: imeItem.status })
  fs.writeFileSync(path.join(temp, 'review-ui.json'), JSON.stringify({ reviewedCommit: 'cb99ae7', fixture: 'real React/client/HTTP; stable native-shaped store; no model', findings, consoleErrors: errors }, null, 2))
  fs.writeFileSync(path.join(temp, 'review-ui.png'), (await win.webContents.capturePage()).toPNG())
  console.log('REVIEW_UI_EVIDENCE', temp)
}).catch(err => { console.error(err); process.exitCode = 1 }).finally(async () => {
  if (win && !win.isDestroyed()) win.destroy()
  if (server) await new Promise(resolve => server.close(resolve))
  app.exit(process.exitCode || 0)
})
`
const compiled = new Module(__filename, module)
compiled.filename = __filename
compiled.paths = module.paths
compiled._compile(fixture, __filename)
