// Independent second review. PASS = repaired scenario; REPRODUCED = remaining defect.
// Does not mutate production source or user data. Artifacts stay in TEMP.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-review2-'))
process.env.DSH_HOME = path.join(temp, 'home')
const root = path.join(temp, 'library')
const a = path.join(root, 'A'), b = path.join(root, 'B')
for (const p of [a,b]) { fs.mkdirSync(p, { recursive:true }); fs.writeFileSync(path.join(p,'project.md'),'# fixture') }
const load = p => import(pathToFileURL(path.join(repo,p)))
const store = await load('plugin/writing-mode/lib/store.js')
const memory = await load('plugin/writing-mode/lib/project-memory.js')
const drafts = await load('plugin/writing-mode/lib/draft-checkpoints.js')
const cfg = { roots:[{path:root,default:true}], activeRoot:root, prefs:store.DEFAULT_PREFS }
store.writeConfig(cfg)
let handler
;(await load('plugin/writing-mode/index.js')).apply({effect:f=>f(),webServer:{register:r=>{handler=r.handler}}})
const server=http.createServer((req,res)=>handler(req,res).catch(e=>{res.statusCode=500;res.end(JSON.stringify({error:e.message}))}))
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const origin=`http://127.0.0.1:${server.address().port}`
const api=async (route,args,post=false)=>{
  const r=await fetch(origin+'/api/writing-mode?'+new URLSearchParams({route,...(post?{}:args)}),post?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)}:undefined)
  return {status:r.status,data:await r.json()}
}
const results=[]
async function check(name,expected,fn){try{const evidence=await fn();results.push({name,result:expected,evidence});console.log(expected,name,JSON.stringify(evidence))}catch(e){results.push({name,result:'PROBE_ERROR',error:e.stack});console.error('PROBE_ERROR',name,e)}}
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
try{
  await check('F01 sibling projects', 'PASS', async()=>{
    const x=await api('memory',{path:a,op:'add',item:{text:'A_ONLY',status:'confirmed'}},true)
    const y=await api('memory',{path:b})
    assert.equal(x.data.project,a);assert.equal(y.data.memory.items.length,0)
    return {aProject:x.data.project,bItems:y.data.memory.items.length}
  })
  await check('F02 default budget in generated bundle','PASS',async()=>{
    let client
    const src=fs.readFileSync(path.join(repo,'plugin/writing-mode/client.js'),'utf8').replace('exports.createEditorSession = createEditorSession','exports.createEditorSession = createEditorSession; exports.prepared = buildPreparedTurn')
    vm.runInNewContext(src,{window:{__ModuleLoader__:{load:m=>{client=m.factory(()=>({}))}}},localStorage:{getItem:()=>null},navigator:{language:'zh-CN'},console})
    const p=client.prepared({message:'hello',memoryRevision:42,memoryItems:[{id:'a',kind:'fact',status:'confirmed',text:'SENTINEL'}]})
    assert.equal(p.budget,6000);assert.ok(p.body.includes('SENTINEL'))
    return {budget:p.budget,memoryRevisionRetained:p.memoryRevision??null}
  })
  await check('F06 malformed object preserves exact bytes','PASS',async()=>{
    fs.mkdirSync(path.join(b,'state'));const f=path.join(b,'state/writing-memory.json')
    const bytes=Buffer.from(JSON.stringify({schemaVersion:1,revision:8,items:{old:'KEEP'},changes:[]}));fs.writeFileSync(f,bytes)
    assert.throws(()=>memory.applyMemoryOp(b,{op:'add',item:{text:'new'}}),/bad-memory/)
    assert.ok(fs.readFileSync(f).equals(bytes));return {unchanged:true}
  })
  await check('F07 text/source history and F08 oversize rejection','PASS',async()=>{
    const first=memory.readMemory(a)
    const changed=memory.applyMemoryOp(a,{op:'update',baseEtag:first.etag,id:first.memory.items[0].id,item:{text:'NEW',source:{kind:'assistant',sessionId:'s',messageId:'m'}}})
    assert.ok(JSON.stringify(changed.memory.changes).includes('A_ONLY'))
    assert.equal(changed.memory.items[0].source.messageId,'m')
    assert.throws(()=>drafts.writeCheckpoint(a,'w',{text:'hi',reference:{text:'x'.repeat(drafts.MAX_REF+1)}}),e=>e.status===413)
    return {beforeTextRetained:true,sourceRetained:true,oversizeStatus:413}
  })
  await check('F09 and supplied 9 checks run in disposable repo copy','PASS',async()=>{
    const target=path.join(temp,'repo-copy');fs.mkdirSync(target)
    fs.cpSync(path.join(repo,'plugin/writing-mode'),path.join(target,'plugin/writing-mode'),{recursive:true})
    fs.mkdirSync(path.join(target,'scripts'))
    for(const s of ['build-writing-client.mjs','verify-writing-build.mjs'])fs.copyFileSync(path.join(repo,'scripts',s),path.join(target,'scripts',s))
    fs.copyFileSync(path.join(repo,'package.json'),path.join(target,'package.json'))
    const run=spawnSync(process.execPath,['plugin/writing-mode/test/review-f01-f06.mjs'],{cwd:target,encoding:'utf8'})
    assert.equal(run.status,0,run.stdout+run.stderr)
    fs.writeFileSync(path.join(temp,'supplied-f-tests.txt'),run.stdout+run.stderr)
    return {exit:run.status,output:run.stdout}
  })
  await check('N01 GET reads through state junction despite POST guard','REPRODUCED',async()=>{
    const p=path.join(root,'link-project'),outside=path.join(temp,'outside')
    fs.mkdirSync(p);fs.writeFileSync(path.join(p,'project.md'),'# link');fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside,'writing-memory.json'),JSON.stringify({schemaVersion:1,revision:1,projectKey:'outside',items:[{id:'secret',kind:'fact',status:'confirmed',text:'OUTSIDE_SENTINEL'}],changes:[]}))
    fs.symlinkSync(outside,path.join(p,'state'),'junction')
    const read=await api('memory',{path:p})
    const write=await api('memory',{path:p,op:'add',baseEtag:read.data.etag,item:{text:'new'}},true)
    assert.equal(read.status,200);assert.equal(read.data.memory.items[0].text,'OUTSIDE_SENTINEL');assert.equal(write.status,400)
    return {readStatus:read.status,leaked:read.data.memory.items[0].text,writeStatus:write.status}
  })
  await check('N02 empty/null optimistic tokens bypass required validation','REPRODUCED',async()=>{
    const r=await api('memory',{path:a,op:'add',baseRevision:null,baseEtag:'',item:{text:'NO_VALID_TOKEN'}},true)
    assert.equal(r.status,200);return {status:r.status,revision:r.data.memory.revision}
  })
  await check('N03 library root itself is a project but cannot write','REPRODUCED',async()=>{
    store.writeConfig({...cfg,roots:[{path:a,default:true}],activeRoot:a})
    try{
      const read=await api('memory',{path:a})
      const write=await api('memory',{path:a,op:'add',baseRevision:read.data.memory.revision,baseEtag:read.data.etag,item:{text:'root project'}},true)
      assert.equal(read.status,200);assert.equal(write.status,400);assert.equal(write.data.error,'path-outside-roots')
      return {read:read.status,write:write.status,error:write.data.error}
    }finally{store.writeConfig(cfg)}
  })
  await check('N04 live holder older than 10 seconds is stolen; committed edit lost','REPRODUCED',async()=>{
    const p=path.join(root,'locking');fs.mkdirSync(p)
    const base=memory.applyMemoryOp(p,{op:'add',item:{text:'base'}})
    const worker=path.join(temp,'holder.mjs')
    fs.writeFileSync(worker,`import fs from 'node:fs';import path from 'node:path';import {applyMemoryOp} from ${JSON.stringify(pathToFileURL(path.join(repo,'plugin/writing-mode/lib/project-memory.js')).href)};
      const [p,etag]=process.argv.slice(2);const read=fs.readFileSync;
      fs.readFileSync=function(f,...args){const bytes=read.call(this,f,...args);if(String(f)===path.join(p,'state/writing-memory.json')){fs.writeFileSync(path.join(p,'ready'),'1');const deadline=Date.now()+25000;while(!fs.existsSync(path.join(p,'release'))){if(Date.now()>deadline)throw Error('barrier timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20)}}return bytes};
      console.log(JSON.stringify(applyMemoryOp(p,{op:'add',baseRevision:1,baseEtag:etag,item:{text:'holder'}}).memory.items.map(i=>i.text)));`)
    const child=spawn(process.execPath,[worker,p,base.etag]);let output='',error=''
    child.stdout.on('data',b=>{output+=b});child.stderr.on('data',b=>{error+=b})
    const done=new Promise(r=>child.on('close',code=>r(code)))
    try{
      const deadline=Date.now()+5000;while(!fs.existsSync(path.join(p,'ready'))){if(Date.now()>deadline)throw Error('worker not ready');await sleep(20)}
      await sleep(10500) // Actual elapsed lock age; holder is still alive with fd open.
      assert.equal(child.exitCode,null)
      const other=memory.applyMemoryOp(p,{op:'add',baseRevision:1,baseEtag:base.etag,item:{text:'other'}})
      fs.writeFileSync(path.join(p,'release'),'1')
      assert.equal(await done,0,error)
      const final=memory.readMemory(p).memory
      assert.ok(other.memory.items.some(i=>i.text==='other'));assert.equal(final.items.some(i=>i.text==='other'),false)
      return {bothSucceeded:true,otherRevision:other.memory.revision,holderOutput:output,finalTexts:final.items.map(i=>i.text)}
    }finally{fs.writeFileSync(path.join(p,'release'),'1');await done}
  })
}finally{
  await new Promise(r=>server.close(r))
  fs.writeFileSync(path.join(temp,'results.json'),JSON.stringify({reviewedCommit:'ca57547',results},null,2));console.log('EVIDENCE',temp)
}
process.exitCode=results.some(r=>r.result==='PROBE_ERROR')?1:0
