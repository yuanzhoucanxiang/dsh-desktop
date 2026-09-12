// Round 3: production renderer + HTTP, stable native-shaped store, controlled fetch delays.
// PASS confirms a repair; REPRODUCED confirms an outstanding defect. No model calls.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
const repo=path.resolve(__dirname,'../../../..')
let fixture=fs.readFileSync(path.join(repo,'scripts/verify-writing-chat.cjs'),'utf8')
fixture=fixture.replace("const repo = path.resolve(__dirname, '..')",`const repo = ${JSON.stringify(repo)}`)
const old="const sessions={list,refresh:async()=>{},open:()=>{},binding:()=>({session}),provideInfo:()=>({hooks:{input:draftStore},props:{inputActions:{setDraft:text=>draftStore.set({draft:text})}}})};"
if(!fixture.includes(old))throw Error('fixture changed')
fixture=fixture.replace(old,"const info={hooks:{input:draftStore},props:{inputActions:{setDraft:text=>draftStore.set({draft:text})}}};const sessions={list,refresh:async()=>{},open:()=>{},binding:()=>({session}),provideInfo:()=>info};")
fixture=fixture.replace('window.testChat={calls:[],set:chatStore.set};',String.raw`
    window.testChat={calls:[],set:chatStore.set,draftRejects:0};
    const originalFetch=window.fetch.bind(window);
    window.fetch=async function(url,opts){
      const route=new URL(url,location.href).searchParams.get('route');
      if(route==='memory'&&!opts?.method&&testChat.failMemory)return new Response(JSON.stringify({ok:false,error:'corrupt-memory'}),{status:500});
      if(route==='draft'&&opts?.method==='POST'&&testChat.failDraft){testChat.draftRejects++;return new Response(JSON.stringify({ok:false,error:'reference-too-large'}),{status:413})}
      if(route==='draft'&&opts?.method==='POST'&&testChat.holdNextWrite){
        testChat.holdNextWrite=false;
        return new Promise(resolve=>{testChat.releaseWrite=async()=>resolve(await originalFetch(url,opts))})
      }
      const response=await originalFetch(url,opts);
      if(route==='draft'&&!opts?.method&&sessionStorage.getItem('review-hold-draft')==='1'){
        return new Promise(resolve=>{testChat.releaseDraft=()=>resolve(response)})
      }
      return response;
    };
`)
const cut=fixture.indexOf("  await input('.dshWmChatInput', '她为什么不拆信？')")
if(cut<0)throw Error('fixture start missing')
fixture=fixture.slice(0,cut)+String.raw`
  const results=[]
  const record=(name,result,evidence)=>{results.push({name,result,evidence});console.log(result,name,JSON.stringify(evidence))}
  const mem=await import(pathToFileURL(path.join(repo,'plugin/writing-mode/lib/project-memory.js')))
  const draftHost=await import(pathToFileURL(path.join(repo,'plugin/writing-mode/lib/draft-checkpoints.js')))
  await button('项目备忘')
  await waitFor("!!document.querySelector('.dshWmMemory input')")
  // Wait for initial etag hydration; fast submission during loading is a separate UI gap.
  await sleep(250)
  await input('.dshWmMemory input','MEMORY_CONFIRMED')
  await button('记下')
  await waitFor("document.querySelector('.dshWmMemoryList').innerText.includes('MEMORY_CONFIRMED')")
  await input('.dshWmChatInput','继续讨论')
  await evaluate("document.querySelector('.dshWmSend').click()")
  await waitFor('testChat.calls.length===1')
  const sent=await evaluate('testChat.calls[0].content[0].text')
  assert.ok(sent.includes('MEMORY_CONFIRMED'))
  record('F02 actual send includes confirmed memory','PASS',{sent})
  await evaluate("testChat.resolve({ok:false,error:{message:'fixture failure'}})")
  await waitFor("!document.querySelector('.dshWmSend').disabled")
  await input('.dshWmChatInput','UNSENT_BEFORE_REFRESH')
  await evaluate("document.querySelector('.dshWmEditor').setSelectionRange(0,3)")
  await button('＋ 引用稿件 / 选区')
  const windowId=await evaluate("sessionStorage.getItem('dsh-writing-window')")
  const deadline=Date.now()+5000
  while(true){const c=draftHost.readCheckpoint(project,windowId);if(c?.text==='UNSENT_BEFORE_REFRESH'&&c?.reference?.text.endsWith('第一章'))break;if(Date.now()>deadline)throw Error('checkpoint not persisted');await sleep(25)}
  await win.reload()
  await waitFor("document.querySelector('.dshWmChatInput')?.value==='UNSENT_BEFORE_REFRESH'&&!!document.querySelector('.dshWmReference')")
  record('F03 ordinary bound refresh restores both','PASS',{})
  await button('项目备忘')
  await waitFor("document.querySelector('.dshWmMemoryList')?.innerText.includes('MEMORY_CONFIRMED')")
  await input('.dshWmMemory input','IME_TEST')
  await evaluate("document.querySelector('.dshWmMemory input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}))")
  await sleep(150)
  assert.equal(mem.readMemory(project).memory.items.some(i=>i.text==='IME_TEST'),false)
  record('F10 IME Enter does not create fact','PASS',{})
  const memFile=path.join(project,'state/writing-memory.json')
  const memBytes=fs.readFileSync(memFile)
  fs.writeFileSync(memFile,'{broken fixture JSON')
  await input('.dshWmChatInput','MEMORY_FAILURE_SEND')
  await evaluate("document.querySelector('.dshWmSend').click()")
  await waitFor('testChat.calls.length===1')
  const fallback=await evaluate('testChat.calls[0].content[0].text')
  assert.equal(fallback.includes('MEMORY_CONFIRMED'),false)
  await waitFor("document.querySelector('.dshWmCompanionError')?.textContent.includes('本次未带入已确认设定')")
  record('N05 warning shown but no author choice before prompt','PARTIAL',{sent:fallback,visibleError:true,authorChoice:false})
  fs.writeFileSync(memFile,memBytes)
  await evaluate("testChat.resolve({ok:true,value:{accepted:true}})")
  await waitFor("document.querySelector('.dshWmChatInput').value===''")
  await evaluate('testChat.failDraft=true')
  await input('.dshWmChatInput','NEW_NOT_CHECKPOINTED')
  await waitFor('testChat.draftRejects>0')
  await waitFor("document.querySelector('.dshWmCompanionError')?.textContent.includes('草稿未能保存：reference-too-large')")
  record('N06 checkpoint HTTP 413 shown','PASS',{rejects:await evaluate('testChat.draftRejects'),visibleError:true})
  // Unbound companion: delay a real GET response with a prior saved checkpoint.
  // Author enters new text while recovery is pending; then release old response.
  const config=store.readConfig();store.writeConfig({...config,companions:{}})
  draftHost.writeCheckpoint(project,windowId,{text:'OLD_CHECKPOINT',reference:null})
  await evaluate("sessionStorage.setItem('review-hold-draft','1')")
  await win.reload()
  await waitFor("!!document.querySelector('.dshWmChatInput')&&!!testChat.releaseDraft")
  await input('.dshWmChatInput','NEW_TYPED_WHILE_RECOVERING')
  assert.equal(await evaluate("document.querySelector('.dshWmChatInput').value"),'NEW_TYPED_WHILE_RECOVERING')
  async function diskText(expected){const end=Date.now()+5000;while(draftHost.readCheckpoint(project,windowId)?.text!==expected){if(Date.now()>end)throw Error('disk text not '+expected);await sleep(20)}}
  await diskText('NEW_TYPED_WHILE_RECOVERING')
  await evaluate('testChat.releaseDraft()')
  await sleep(150)
  assert.equal(await evaluate("document.querySelector('.dshWmChatInput').value"),'NEW_TYPED_WHILE_RECOVERING')
  record('N07 immediate UI keeps new typing','PASS',{})
  await evaluate("document.querySelector('.dshWmEditor').setSelectionRange(0,2)")
  await button('＋ 引用稿件 / 选区')
  await diskText('OLD_CHECKPOINT')
  assert.equal(await evaluate("document.querySelector('.dshWmChatInput').value"),'NEW_TYPED_WHILE_RECOVERING')
  await evaluate("sessionStorage.removeItem('review-hold-draft')")
  await win.reload()
  await waitFor("document.querySelector('.dshWmChatInput')?.value==='OLD_CHECKPOINT'")
  record('T02 late recovery poisons cache; adding reference persists old text','REPRODUCED',{newText:'NEW_TYPED_WHILE_RECOVERING',restored:await evaluate("document.querySelector('.dshWmChatInput').value")})
  await evaluate('testChat.holdNextWrite=true')
  await input('.dshWmChatInput','OLDER_POST')
  await waitFor('!!testChat.releaseWrite')
  await input('.dshWmChatInput','LATEST_POST')
  await diskText('LATEST_POST')
  await evaluate('testChat.releaseWrite()')
  await diskText('OLDER_POST')
  assert.equal(await evaluate("document.querySelector('.dshWmChatInput').value"),'LATEST_POST')
  await win.reload()
  await waitFor("document.querySelector('.dshWmChatInput')?.value==='OLDER_POST'")
  record('T03 delayed old POST overwrites saved newer draft','REPRODUCED',{latest:'LATEST_POST',restored:await evaluate("document.querySelector('.dshWmChatInput').value")})
  fs.writeFileSync(path.join(temp,'review3-ui.json'),JSON.stringify({reviewedCommit:'b66d194',results,consoleErrors:errors},null,2))
  console.log('REVIEW3_UI_EVIDENCE',temp)
}).catch(err=>{console.error(err);process.exitCode=1}).finally(async()=>{
  if(win&&!win.isDestroyed())win.destroy()
  if(server)await new Promise(r=>server.close(r))
  app.exit(process.exitCode||0)
})
`
const compiled=new Module(__filename,module);compiled.filename=__filename;compiled.paths=module.paths;compiled._compile(fixture,__filename)
