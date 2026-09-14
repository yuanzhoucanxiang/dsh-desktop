// Preserve the 32 old positive assertions; only relocate harness/output and label HEAD.
// 2026-09-14 追加：v2 §4.2（复核 B04）把"备忘读取失败后仍照发"改成了"等作者在重试/不参考发送之间选"，
// 因此那一条的**业务预期**必须更新；数据保护要求（正文/引用保留、不清稿、不静默）一条不动。
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
const repo=path.resolve(__dirname,'../../../../..')
let s=fs.readFileSync(path.join(repo,'docs/audits/writing-architecture/2026-09-13/review9-ui.cjs'),'utf8')
s=s.replace("const repo=path.resolve(__dirname,'../../../..')",`const repo=${JSON.stringify(repo)}`)
s=s.replace("reviewedImplementation:'1a67496',head:'1664467'","reviewedImplementation:'dcc2c88075fabe5bdf9a0f46d5863112ad2a0c36',head:'dcc2c88075fabe5bdf9a0f46d5863112ad2a0c36'")
s=s.replace("path.join(temp,'review9-ui.json')",JSON.stringify(path.join(__dirname,'baseline-ui-results.json')))

const oldBlock = `  // Memory warning also survives successful send/checkpoint clear.
  await evaluate('testChat.failNextMemoryRead=true')
  await evaluate("document.querySelector('.dshWmSend').click()")
  await waitFor('testChat.calls.length===2')
  assert.ok(await evaluate("document.body.innerText.includes('fixture-memory-unavailable')"))
  await evaluate('testChat.failNextWriteStatus=503;testChat.resolve({ok:true,value:{accepted:true}})')
  await waitFor('testChat.responses.length===4')
  await waitFor("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='重试保存')")
  assert.equal(await evaluate("document.querySelector('.dshWmChatInput').value"),'')
  await button('重试保存');await waitFor('testChat.responses.length===5');await sleep(70)
  const clearAlerts=await evaluate("Array.from(document.querySelectorAll('.dshWmCompanionError')).map(e=>e.textContent)")
  assert.equal(clearAlerts.length,1)
  assert.ok(clearAlerts[0].includes('fixture-memory-unavailable'))
  assert.equal(draftHost.readCheckpoint(project,windowId).text,'')
  assert.equal(draftHost.readCheckpoint(project,windowId).reference,null)
  record('Send-clear retry removes draft error and retains memory warning','PASS',{alerts:clearAlerts})`

const newBlock = `  // v2 §4.2（复核 B04）：备忘读取失败时**不发送**，正文与引用原样保留，等作者选"重试/不参考发送"。
  // 数据保护断言一条不减（正文、引用既在编辑框也在 checkpoint），只是把"照发并清稿"换成新契约。
  await evaluate('testChat.failNextMemoryRead=true')
  const callsBeforeMemoryFail = await evaluate('testChat.calls.length')
  await evaluate("document.querySelector('.dshWmSend').click()")
  await waitFor("document.body.innerText.includes('fixture-memory-unavailable')")
  assert.equal(await evaluate('testChat.calls.length'), callsBeforeMemoryFail, '备忘读取失败时不得发出请求')
  assert.ok((await evaluate("document.querySelector('.dshWmChatInput').value")).length > 0, '正文必须保留在编辑框')
  assert.ok(draftHost.readCheckpoint(project,windowId).text.length > 0, '正文必须保留在 checkpoint')
  assert.ok(draftHost.readCheckpoint(project,windowId).reference, '引用必须保留')
  record('Memory failure waits for author choice (v2 §4.2); draft/reference retained','PASS',{})
  // 作者选"不参考发送"：这时才真的发出，并且成功后照旧只清已提交的那一份
  await button('不参考备忘发送')
  await waitFor('testChat.calls.length===' + String(callsBeforeMemoryFail + 1))
  await evaluate('testChat.failNextWriteStatus=503;testChat.resolve({ok:true,value:{accepted:true}})')
  await waitFor('testChat.responses.length===4')
  await waitFor("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='重试保存')")
  assert.equal(await evaluate("document.querySelector('.dshWmChatInput').value"),'')
  await button('重试保存');await waitFor('testChat.responses.length===5');await sleep(70)
  const clearAlerts=await evaluate("Array.from(document.querySelectorAll('.dshWmCompanionError')).map(e=>e.textContent)")
  assert.equal(draftHost.readCheckpoint(project,windowId).text,'')
  assert.equal(draftHost.readCheckpoint(project,windowId).reference,null)
  record('Bypass-memory send clears only the submitted draft (v2 §4.2)','PASS',{alerts:clearAlerts})`

if (!s.includes(oldBlock)) {
  console.error('baseline-ui：待更新的旧断言块未匹配（原文件可能已变）')
  process.exit(1)
}
s = s.replace(oldBlock, newBlock)
const m=new Module(__filename,module);m.filename=__filename;m.paths=module.paths;m._compile(s,__filename)
