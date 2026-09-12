// Round 4: real production React/HTTP, stable native-shaped input, delayed transport.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
const repo=path.resolve(__dirname,'../../../..')
let fixture=fs.readFileSync(path.join(repo,'scripts/verify-writing-chat.cjs'),'utf8')
fixture=fixture.replace("const repo = path.resolve(__dirname, '..')",`const repo = ${JSON.stringify(repo)}`)
const old="const sessions={list,refresh:async()=>{},open:()=>{},binding:()=>({session}),provideInfo:()=>({hooks:{input:draftStore},props:{inputActions:{setDraft:text=>draftStore.set({draft:text})}}})};"
if(!fixture.includes(old))throw Error('fixture changed')
fixture=fixture.replace(old,"const info={hooks:{input:draftStore},props:{inputActions:{setDraft:text=>draftStore.set({draft:text})}}};const sessions={list,refresh:async()=>{},open:()=>{},binding:()=>({session}),provideInfo:()=>info};")
fixture=fixture.replace('window.testChat={calls:[],set:chatStore.set};',String.raw`
    window.testChat={calls:[],set:chatStore.set,posts:[],responses:[]};
    const originalFetch=window.fetch.bind(window);
    window.fetch=async function(url,opts){
      const route=new URL(url,location.href).searchParams.get('route');
      const isWrite=route==='draft'&&opts?.method==='POST';
      const run=async()=>{const r=await originalFetch(url,opts);if(isWrite)testChat.responses.push({status:r.status,data:await r.clone().json()});return r};
      if(isWrite){testChat.posts.push(JSON.parse(opts.body));if(testChat.holdNextWrite){testChat.holdNextWrite=false;return new Promise(resolve=>{testChat.releaseWrite=async()=>resolve(await run())})}}
      const response=await run();
      if(route==='draft'&&!opts?.method&&sessionStorage.getItem('review-hold-draft')==='1')return new Promise(resolve=>{testChat.releaseDraft=()=>resolve(response)});
      return response;
    };
`)
const cut=fixture.indexOf("  await input('.dshWmChatInput', '她为什么不拆信？')")
if(cut<0)throw Error('fixture start missing')
fixture=fixture.slice(0,cut)+String.raw`
  const results=[],record=(name,result,evidence)=>{results.push({name,result,evidence});console.log(result,name,JSON.stringify(evidence))}
  const draftHost=await import(pathToFileURL(path.join(repo,'plugin/writing-mode/lib/draft-checkpoints.js')))
  const windowId=await evaluate("sessionStorage.getItem('dsh-writing-window')")
  await sleep(150)
  await evaluate('testChat.holdNextWrite=true')
  await input('.dshWmChatInput','FIRST_KEYSTROKE')
  await waitFor('!!testChat.releaseWrite')
  await input('.dshWmChatInput','LATEST_KEYSTROKES')
  assert.equal(await evaluate('testChat.posts.length'),1)
  record('T03 outgoing writes are serialized','PASS',{})
  await evaluate('testChat.releaseWrite()')
  await waitFor('testChat.responses.length===2')
  const writes=await evaluate('testChat.posts'),responses=await evaluate('testChat.responses')
  assert.equal(responses[0].status,200);assert.equal(responses[1].status,409)
  assert.equal(draftHost.readCheckpoint(project,windowId).text,'FIRST_KEYSTROKE')
  assert.equal(await evaluate("document.querySelector('.dshWmChatInput').value"),'LATEST_KEYSTROKES')
  record('W02 queued latest input carries stale baseRev','REPRODUCED',{baseRevs:writes.map(w=>w.baseRev),statuses:responses.map(r=>r.status),disk:draftHost.readCheckpoint(project,windowId).text})
  await win.reload()
  await waitFor("document.querySelector('.dshWmChatInput')?.value==='FIRST_KEYSTROKE'")
  await evaluate("document.querySelector('.dshWmSend').click()")
  await waitFor('testChat.calls.length===1')
  await evaluate('testChat.resolve({ok:true,value:{accepted:true}})')
  await waitFor('testChat.responses.length>=2')
  assert.equal(await evaluate("document.querySelector('.dshWmChatInput').value"),'')
  await input('.dshWmChatInput','NEW_THOUGHT_AFTER_SEND')
  await waitFor('testChat.responses.length>=3')
  const after=await evaluate('testChat.responses')
  assert.equal(after.at(-1).status,409);assert.equal(draftHost.readCheckpoint(project,windowId),null)
  record('W03 successful send clears file then future draft writes fail','REPRODUCED',{statuses:after.map(r=>r.status),disk:null,visibleDraft:await evaluate("document.querySelector('.dshWmChatInput').value")})
  // Late recovery no longer writes the old cache, but its revision is discarded too.
  store.writeConfig({...store.readConfig(),companions:{}})
  draftHost.writeCheckpoint(project,windowId,{text:'OLD_CHECKPOINT',baseRev:0})
  await evaluate("sessionStorage.setItem('review-hold-draft','1')")
  await win.reload()
  await waitFor("!!document.querySelector('.dshWmChatInput')&&!!testChat.releaseDraft")
  await input('.dshWmChatInput','NEW_DURING_RECOVERY')
  await waitFor('testChat.responses.length===1')
  await evaluate('testChat.releaseDraft()');await sleep(100)
  assert.equal(await evaluate("document.querySelector('.dshWmChatInput').value"),'NEW_DURING_RECOVERY')
  record('T02 late recovery preserves visible input','PASS',{})
  await evaluate("document.querySelector('.dshWmEditor').setSelectionRange(0,2)")
  await button('＋ 引用稿件 / 选区')
  await waitFor('testChat.responses.length===2')
  const late=await evaluate('({posts:testChat.posts,responses:testChat.responses})')
  assert.ok(late.posts.every(p=>p.text==='NEW_DURING_RECOVERY'))
  assert.ok(late.responses.every(r=>r.status===409))
  record('W02 recovery edits retain text but never obtain server revision','REPRODUCED',{baseRevs:late.posts.map(p=>p.baseRev),statuses:late.responses.map(r=>r.status),disk:draftHost.readCheckpoint(project,windowId).text})
  fs.writeFileSync(path.join(temp,'review4-ui.json'),JSON.stringify({reviewedCommit:'606f21f',results,consoleErrors:errors},null,2));console.log('REVIEW4_UI_EVIDENCE',temp)
}).catch(err=>{console.error(err);process.exitCode=1}).finally(async()=>{
  if(win&&!win.isDestroyed())win.destroy();if(server)await new Promise(r=>server.close(r));app.exit(process.exitCode||0)
})
`
const compiled=new Module(__filename,module);compiled.filename=__filename;compiled.paths=module.paths;compiled._compile(fixture,__filename)
