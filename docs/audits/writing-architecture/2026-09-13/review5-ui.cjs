// Round 5: real production React/HTTP, stable native-shaped input, delayed transport.
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
  assert.equal(responses[0].status,200);assert.equal(responses[1].status,200)
  assert.equal(draftHost.readCheckpoint(project,windowId).text,'LATEST_KEYSTROKES')
  assert.equal(await evaluate("document.querySelector('.dshWmChatInput').value"),'LATEST_KEYSTROKES')
  record('W02 queued latest input uses confirmed server revision','PASS',{baseRevs:writes.map(w=>w.baseRev),statuses:responses.map(r=>r.status),disk:draftHost.readCheckpoint(project,windowId).text})
  await win.reload()
  await waitFor("document.querySelector('.dshWmChatInput')?.value==='LATEST_KEYSTROKES'")
  await evaluate("document.querySelector('.dshWmSend').click()")
  await waitFor('testChat.calls.length===1')
  await evaluate('testChat.resolve({ok:true,value:{accepted:true}})')
  await waitFor('testChat.responses.length>=1')
  assert.equal(await evaluate("document.querySelector('.dshWmChatInput').value"),'')
  await input('.dshWmChatInput','NEW_THOUGHT_AFTER_SEND')
  await waitFor('testChat.responses.length>=2')
  const after=await evaluate('testChat.responses')
  assert.equal(after.at(-1).status,200);assert.equal(draftHost.readCheckpoint(project,windowId).text,'NEW_THOUGHT_AFTER_SEND')
  record('W03 send then next draft saves','PASS',{statuses:after.map(r=>r.status),disk:draftHost.readCheckpoint(project,windowId).text})
  // Late recovery no longer writes the old cache, but its revision is discarded too.
  store.writeConfig({...store.readConfig(),companions:{}})
  draftHost.writeCheckpoint(project,windowId,{text:'OLD_CHECKPOINT',baseRev:draftHost.readCheckpoint(project,windowId).rev})
  await evaluate("sessionStorage.setItem('review-hold-draft','1')")
  await win.reload()
  await waitFor("!!document.querySelector('.dshWmChatInput')&&!!testChat.releaseDraft")
  await input('.dshWmChatInput','NEW_DURING_RECOVERY')
  assert.equal(await evaluate('testChat.posts.length'),0)
  await evaluate('testChat.releaseDraft()');await waitFor('testChat.responses.length===1')
  assert.equal(await evaluate("document.querySelector('.dshWmChatInput').value"),'NEW_DURING_RECOVERY')
  record('T02 late recovery preserves visible input','PASS',{})
  await evaluate("document.querySelector('.dshWmEditor').setSelectionRange(0,2)")
  await button('＋ 引用稿件 / 选区')
  await waitFor('testChat.responses.length===2')
  const late=await evaluate('({posts:testChat.posts,responses:testChat.responses})')
  assert.ok(late.posts.every(p=>p.text==='NEW_DURING_RECOVERY'))
  assert.ok(late.responses.every(r=>r.status===200))
  record('W02 recovery defers writes and flushes latest edits','PASS',{baseRevs:late.posts.map(p=>p.baseRev),statuses:late.responses.map(r=>r.status),disk:draftHost.readCheckpoint(project,windowId).text})
  // Restore without editing during GET: visible recovered content must also become cache state.
  await evaluate("sessionStorage.removeItem('review-hold-draft')")
  await win.reload()
  await waitFor("document.querySelector('.dshWmChatInput')?.value==='NEW_DURING_RECOVERY'&&!!document.querySelector('.dshWmReference')")
  await evaluate("document.querySelector('[aria-label=\"移除稿件引用\"]').click()")
  await waitFor('testChat.responses.length===1')
  assert.equal(await evaluate("document.querySelector('.dshWmChatInput').value"),'NEW_DURING_RECOVERY')
  assert.equal(draftHost.readCheckpoint(project,windowId).text,'')
  record('R01 restored text is missing from cache; removing reference erases it','REPRODUCED',{visible:'NEW_DURING_RECOVERY',disk:draftHost.readCheckpoint(project,windowId)})
  // An explicit empty edit during recovery is a mutation and must be checkpointed too.
  draftHost.writeCheckpoint(project,windowId,{text:'OLD_TO_REMOVE',baseRev:draftHost.readCheckpoint(project,windowId).rev})
  await evaluate("sessionStorage.setItem('review-hold-draft','1')")
  await win.reload()
  await waitFor("!!document.querySelector('.dshWmChatInput')&&!!testChat.releaseDraft")
  await input('.dshWmChatInput','TEMP_THOUGHT')
  await input('.dshWmChatInput','')
  assert.equal(await evaluate('testChat.posts.length'),0)
  await evaluate('testChat.releaseDraft()');await sleep(150)
  assert.equal(await evaluate("document.querySelector('.dshWmChatInput').value"),'')
  assert.equal(await evaluate('testChat.posts.length'),0)
  assert.equal(draftHost.readCheckpoint(project,windowId).text,'OLD_TO_REMOVE')
  await evaluate("sessionStorage.removeItem('review-hold-draft')")
  await win.reload()
  await waitFor("document.querySelector('.dshWmChatInput')?.value==='OLD_TO_REMOVE'")
  record('R02 empty edit during recovery is not flushed and old draft returns','REPRODUCED',{afterReload:await evaluate("document.querySelector('.dshWmChatInput').value")})
  // A second writer updates the same checkpoint bucket after both local edits.
  await evaluate('testChat.holdNextWrite=true')
  await input('.dshWmChatInput','LOCAL_BEFORE_CONFLICT')
  await waitFor('!!testChat.releaseWrite')
  await input('.dshWmChatInput','LOCAL_QUEUED_BEFORE_REMOTE')
  const remote=draftHost.writeCheckpoint(project,windowId,{text:'NEWER_OTHER_WRITER',baseRev:draftHost.readCheckpoint(project,windowId).rev})
  await evaluate('testChat.releaseWrite()')
  await waitFor('testChat.responses.length===2')
  const conflictResponses=await evaluate('testChat.responses')
  assert.equal(conflictResponses[0].status,409);assert.equal(conflictResponses[1].status,200)
  assert.equal(draftHost.readCheckpoint(project,windowId).text,'LOCAL_QUEUED_BEFORE_REMOTE')
  record('R03 conflict refresh silently authorizes next queued overwrite of other writer','REPRODUCED',{statuses:conflictResponses.map(r=>r.status),remoteRev:remote.checkpoint.rev,finalText:draftHost.readCheckpoint(project,windowId).text})
  fs.writeFileSync(path.join(temp,'review5-ui.json'),JSON.stringify({reviewedImplementation:'53223df',head:'b642ad4',results,consoleErrors:errors},null,2));console.log('REVIEW5_UI_EVIDENCE',temp)
}).catch(err=>{console.error(err);process.exitCode=1}).finally(async()=>{
  if(win&&!win.isDestroyed())win.destroy();if(server)await new Promise(r=>server.close(r));app.exit(process.exitCode||0)
})
`
const compiled=new Module(__filename,module);compiled.filename=__filename;compiled.paths=module.paths;compiled._compile(fixture,__filename)
