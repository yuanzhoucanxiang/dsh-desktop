// Actual shipped client.js + React + production HTTP host in a hidden test window.
// Reuse only test bootstrapping; no copied production state machine.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
const repo=path.resolve(__dirname,'../../../../..')
let fixture=fs.readFileSync(path.join(repo,'scripts/verify-writing-chat.cjs'),'utf8')
function replace(old,next){if(!fixture.includes(old))throw Error('fixture anchor changed: '+old.slice(0,70));fixture=fixture.replace(old,next)}
replace("const repo = path.resolve(__dirname, '..')",`const repo = ${JSON.stringify(repo)}`)
replace("process.env.DSH_HOME = path.join(temp, 'home')", "process.env.DSH_HOME = path.join(temp, 'home');process.env.DSH_DESKTOP_HOME=process.env.DSH_HOME;process.env.LOCALAPPDATA=path.join(temp,'localappdata')")
replace('  let handler', `  const draftHost = await import(pathToFileURL(path.join(repo,'plugin/writing-mode/lib/draft-checkpoints.js')))
  draftHost.writeCheckpoint(project,'other-window',{text:'OTHER_WINDOW_CANDIDATE',reference:null,baseRev:0})
  let handler`)
replace('window.testChat={calls:[],set:chatStore.set};',String.raw`
    window.testChat={calls:[],set:chatStore.set};
    const fetchOriginal=window.fetch.bind(window);
    window.fetch=async(url,opts)=>{
      if(new URL(url,location.href).searchParams.get('route')==='memory'&&!opts?.method&&testChat.failMemory){
        testChat.failMemory=false;return new Response(JSON.stringify({ok:false,error:'fixture-memory-503'}),{status:503});
      }
      return fetchOriginal(url,opts);
    };
`)
const cut=fixture.indexOf("  await input('.dshWmChatInput', '她为什么不拆信？')")
if(cut<0)throw Error('fixture cut changed')
fixture=fixture.slice(0,cut)+String.raw`
  const results=[]
  function record(id,passed,evidence){const r={id,status:passed?'PASS':'FAIL',evidence};results.push(r);console.log(JSON.stringify(r))}
  await waitFor("!!document.querySelector('[data-wm-draft-adopt]')")
  await sleep(200)
  const windowId=await evaluate("sessionStorage.getItem('dsh-writing-window')")
  await input('.dshWmChatInput','AUTHOR_ORIGINAL_UNIQUE_DRAFT')
  await evaluate("document.querySelector('.dshWmEditor').setSelectionRange(0,3)")
  await button('＋ 引用稿件 / 选区')
  await sleep(500)
  assert.equal(draftHost.readCheckpoint(project,windowId).text,'AUTHOR_ORIGINAL_UNIQUE_DRAFT')
  await evaluate("document.querySelector('[data-wm-draft-adopt]').click()")
  await waitFor("document.querySelector('.dshWmChatInput').value==='OTHER_WINDOW_CANDIDATE'")
  await sleep(500)
  const disk=draftHost.listCheckpoints(project)
  const visibleRef=await evaluate("document.querySelector('.dshWmReference')?.textContent||''")
  record('B06-adopt-keeps-recoverable-original',disk.some(d=>d.text==='AUTHOR_ORIGINAL_UNIQUE_DRAFT'),{disk:disk.map(d=>({windowId:d.windowId,text:d.text,reference:d.reference})),visibleRef})
  record('B06-adopt-null-reference-clears-old-source',draftHost.readCheckpoint(project,windowId).reference===null,{reference:draftHost.readCheckpoint(project,windowId).reference,visibleRef})

  await input('.dshWmChatInput','PRESERVE_UNTIL_AUTHOR_CHOICE')
  await evaluate("testChat.failMemory=true;document.querySelector('.dshWmSend').click()")
  await waitFor("testChat.calls.length>0 || document.body.innerText.includes('fixture-memory-503')")
  if(await evaluate('testChat.calls.length>0'))await evaluate('testChat.resolve({ok:true})')
  await waitFor("!document.querySelector('.dshWmSend').disabled || document.querySelector('.dshWmChatInput').value===''")
  await sleep(250)
  const memoryCalls=await evaluate('testChat.calls.length')
  record('B04-memory-failure-waits-for-explicit-choice',memoryCalls===0,{calls:memoryCalls,input:await evaluate("document.querySelector('.dshWmChatInput').value"),alerts:await evaluate("Array.from(document.querySelectorAll('[role=alert]')).map(x=>x.textContent)")})

  const memory=await import(pathToFileURL(path.join(repo,'plugin/writing-mode/lib/project-memory.js')))
  const m=memory.readMemory(project)
  memory.applyMemoryOp(project,{op:'add',baseRevision:m.memory.revision,baseEtag:m.etag,item:{kind:'fact',status:'confirmed',text:'共同设定'.repeat(40),source:{kind:'author'}}})
  const {buildPreparedTurn}=await import(pathToFileURL(path.join(repo,'plugin/writing-mode/src/shared/context-builder.js')))
  const oldBody=buildPreparedTurn({message:'旧问题',memoryItems:memory.readMemory(project).memory.items}).body
  await evaluate('testChat.set({chat:{order:["old"],nodes:new Map([["old",{kind:"user",data:{content:[{type:"text",text:'+JSON.stringify(oldBody)+'}]}}]])},pending:[],queue:[],running:false})')
  await input('.dshWmChatInput','ENTIRELY_NEW_REJECTED_QUESTION')
  await evaluate("document.querySelector('.dshWmSend').click()")
  await waitFor('testChat.calls.length==='+String(memoryCalls+1))
  await evaluate('testChat.resolve({ok:false,error:{code:"busy",message:"REJECTED_BY_KERNEL"}})')
  await sleep(500)
  const after=await evaluate("document.querySelector('.dshWmChatInput').value")
  record('B02-rejected-turn-retains-visible-and-disk-draft',after==='ENTIRELY_NEW_REJECTED_QUESTION',{after,disk:draftHost.readCheckpoint(project,windowId).text,calls:await evaluate('testChat.calls.length')})
  fs.writeFileSync(path.join(repo,'docs/audits/writing-architecture/2026-09-19/revalidation/ui-results.json'),JSON.stringify({commit:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),temp,results,rendererErrors:errors},null,2)+'\n')
  if(results.some(r=>r.status==='FAIL'))process.exitCode=1
}).catch(err=>{console.error(err);process.exitCode=1}).finally(async()=>{
  if(win&&!win.isDestroyed())win.destroy()
  if(server)await new Promise(resolve=>server.close(resolve))
  app.exit(process.exitCode||0)
})
`
const m=new Module(__filename,module);m.filename=__filename;m.paths=module.paths;m._compile(fixture,__filename)
