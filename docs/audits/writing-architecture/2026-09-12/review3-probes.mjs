// Round 3: production HTTP/storage + controlled independent-process schedules.
// PASS = verified fixed scope. REPRODUCED = remaining defect. TEMP data only.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import assert from 'node:assert/strict'
import {spawn,spawnSync} from 'node:child_process'
import {fileURLToPath,pathToFileURL} from 'node:url'
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..')
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wm-review3-'))
process.env.DSH_HOME=path.join(temp,'home')
const load=p=>import(pathToFileURL(path.join(repo,p)))
const memory=await load('plugin/writing-mode/lib/project-memory.js'), store=await load('plugin/writing-mode/lib/store.js')
const root=path.join(temp,'library'),project=path.join(root,'A')
fs.mkdirSync(project,{recursive:true});fs.writeFileSync(path.join(project,'project.md'),'# A')
const cfg={roots:[{path:root,default:true}],activeRoot:root,prefs:store.DEFAULT_PREFS};store.writeConfig(cfg)
let handler;(await load('plugin/writing-mode/index.js')).apply({effect:f=>f(),webServer:{register:r=>{handler=r.handler}}})
const server=http.createServer((req,res)=>handler(req,res).catch(e=>{res.statusCode=500;res.end(JSON.stringify({error:e.message}))}))
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const origin=`http://127.0.0.1:${server.address().port}`
const api=async(args,post=false)=>{const r=await fetch(origin+'/api/writing-mode?'+new URLSearchParams({route:'memory',...(post?{}:args)}),post?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)}:undefined);return {status:r.status,data:await r.json()}}
const results=[],sleep=ms=>new Promise(r=>setTimeout(r,ms))
async function check(name,result,fn){try{const evidence=await fn();results.push({name,result,evidence});console.log(result,name,JSON.stringify(evidence))}catch(e){results.push({name,result:'PROBE_ERROR',error:e.stack});console.error('PROBE_ERROR',name,e)}}
async function ready(f){const end=Date.now()+8000;while(!fs.existsSync(f)){if(Date.now()>end)throw Error('barrier not ready: '+f);await sleep(20)}}
const worker=path.join(temp,'worker.mjs')
fs.writeFileSync(worker,`import fs from 'node:fs';import path from 'node:path';import {applyMemoryOp} from ${JSON.stringify(pathToFileURL(path.join(repo,'plugin/writing-mode/lib/project-memory.js')).href)};
const [p,mode,id,rev,etag]=process.argv.slice(2);const file=path.join(p,'state/writing-memory.json'),lock=file+'.lock';
const read=fs.readFileSync,stat=fs.statSync;let blocked=false;
function barrier(){fs.writeFileSync(path.join(p,id+'.ready'),'1');const end=Date.now()+40000;while(!fs.existsSync(path.join(p,id+'.release'))){if(Date.now()>end)throw Error('barrier timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20)}}
fs.readFileSync=function(f,...args){const value=read.call(this,f,...args);if(mode==='holder'&&String(f)===file&&!blocked){blocked=true;barrier()}return value};
fs.statSync=function(f,...args){const value=stat.call(this,f,...args);if(mode==='reclaimer'&&String(f)===lock&&!blocked){blocked=true;barrier()}return value};
try{const result=applyMemoryOp(p,{op:'add',baseRevision:Number(rev),baseEtag:etag,item:{text:id}});console.log(JSON.stringify({ok:true,revision:result.memory.revision,texts:result.memory.items.map(i=>i.text)}))}catch(e){console.log(JSON.stringify({ok:false,error:e.message,status:e.status}));process.exitCode=2}`)
function child(p,mode,id,revision,etag){const c=spawn(process.execPath,[worker,p,mode,id,String(revision),etag]);let out='',err='';c.stdout.on('data',b=>{out+=b});c.stderr.on('data',b=>{err+=b});const done=new Promise(r=>c.on('close',code=>r({code,out,err})));return {c,done}}
function fixture(name){const p=path.join(root,name);fs.mkdirSync(p);const initial=memory.applyMemoryOp(p,{op:'add',baseRevision:0,baseEtag:memory.emptyEtag(),item:{text:'base'}});return {p,initial}}
try{
 await check('N01 GET/POST reject outside junction','PASS',async()=>{
   const p=path.join(root,'links'),outside=path.join(temp,'outside');fs.mkdirSync(p);fs.mkdirSync(outside);fs.writeFileSync(path.join(p,'project.md'),'# links')
   const bytes=JSON.stringify({schemaVersion:1,revision:1,items:[{id:'1',kind:'fact',status:'confirmed',text:'OUTSIDE'}],changes:[]});fs.writeFileSync(path.join(outside,'writing-memory.json'),bytes);fs.symlinkSync(outside,path.join(p,'state'),'junction')
   const get=await api({path:p}),post=await api({path:p,op:'add',baseRevision:0,baseEtag:memory.emptyEtag(),item:{text:'new'}},true)
   assert.equal(get.status,400);assert.equal(post.status,400);assert.ok(!JSON.stringify(get).includes('OUTSIDE'));assert.equal(fs.readFileSync(path.join(outside,'writing-memory.json'),'utf8'),bytes)
   return {get:get.status,post:post.status,bytesPreserved:true}
 })
 await check('N02 first-create race and null/empty tokens','PASS',async()=>{
   const empty=await api({path:project});assert.equal(empty.data.memory.revision,0);assert.equal(empty.data.etag,memory.emptyEtag())
   const bodies=[{baseRevision:null,baseEtag:''},{baseRevision:0},{baseEtag:empty.data.etag}]
   for(const tokens of bodies)assert.equal((await api({path:project,op:'add',item:{text:'invalid'},...tokens},true)).status,428)
   const p=path.join(root,'first-create');fs.mkdirSync(p)
   const contenders=await Promise.all([child(p,'normal','first',0,empty.data.etag).done,child(p,'normal','second',0,empty.data.etag).done])
   assert.deepEqual(contenders.map(c=>c.code).sort(),[0,2]);assert.ok(contenders.some(c=>c.out.includes('revision-conflict')))
   return {invalidStatus:428,contenders}
 })
 await check('N03 library root equals project root','PASS',async()=>{
   store.writeConfig({...cfg,roots:[{path:project,default:true}],activeRoot:project})
   try{const get=await api({path:project});const post=await api({path:project,op:'add',baseRevision:get.data.memory.revision,baseEtag:get.data.etag,item:{text:'ROOT_OK'}},true);assert.equal(post.status,200);return {status:post.status}}finally{store.writeConfig(cfg)}
 })
 await check('Supplied 10/10 in disposable repo copy','PASS',async()=>{
   const target=path.join(temp,'copy');fs.mkdirSync(target);fs.cpSync(path.join(repo,'plugin/writing-mode'),path.join(target,'plugin/writing-mode'),{recursive:true});fs.mkdirSync(path.join(target,'scripts'))
   for(const s of ['build-writing-client.mjs','verify-writing-build.mjs'])fs.copyFileSync(path.join(repo,'scripts',s),path.join(target,'scripts',s));fs.copyFileSync(path.join(repo,'package.json'),path.join(target,'package.json'))
   const run=spawnSync(process.execPath,['plugin/writing-mode/test/review-f01-f06.mjs'],{cwd:target,encoding:'utf8'});assert.equal(run.status,0,run.stdout+run.stderr);return {exit:run.status,output:run.stdout}
 })
 await check('N04 observed live holder older than 10s is not stolen','PASS',async()=>{
   const {p,initial}=fixture('live-lock');const first=child(p,'holder','alive',1,initial.etag)
   try{await ready(path.join(p,'alive.ready'));await sleep(10500);assert.equal(first.c.exitCode,null)
     assert.throws(()=>memory.applyMemoryOp(p,{op:'add',baseRevision:1,baseEtag:initial.etag,item:{text:'other'}}),e=>e.message==='lock-timeout'&&e.status===503)
     fs.writeFileSync(path.join(p,'alive.release'),'1');const holder=await first.done;assert.equal(holder.code,0,holder.err);return {otherStatus:503,holder}
   }finally{fs.writeFileSync(path.join(p,'alive.release'),'1');await first.done}
 })
 await check('T01 stale-lock reclaim uses old owner and deletes replacement live lock','REPRODUCED',async()=>{
   const {p,initial}=fixture('reclaim-race'),lock=path.join(p,'state/writing-memory.json.lock')
   const dead=spawnSync(process.execPath,['-e','process.stdout.write(String(process.pid))'],{encoding:'utf8'});assert.equal(dead.status,0)
   fs.writeFileSync(lock,dead.stdout+':dead-fixture');const aged=new Date(Date.now()-20000);fs.utimesSync(lock,aged,aged)
   // This is an intentionally aged fixture owned by a process that has exited.
   const a=child(p,'reclaimer','reclaimerA',1,initial.etag);let b
   try{
     await ready(path.join(p,'reclaimerA.ready'))
     b=child(p,'holder','holderB',1,initial.etag);await ready(path.join(p,'holderB.ready'))
     assert.ok(fs.readFileSync(lock,'utf8').startsWith(String(b.c.pid)+':'));assert.equal(b.c.exitCode,null)
     fs.writeFileSync(path.join(p,'reclaimerA.release'),'1');const ra=await a.done;assert.equal(ra.code,0,ra.out+ra.err)
     fs.writeFileSync(path.join(p,'holderB.release'),'1');const rb=await b.done;assert.equal(rb.code,0,rb.out+rb.err)
     const final=memory.readMemory(p).memory;assert.equal(final.items.some(i=>i.text==='reclaimerA'),false)
     return {a:ra,b:rb,finalTexts:final.items.map(i=>i.text)}
   }finally{fs.writeFileSync(path.join(p,'reclaimerA.release'),'1');fs.writeFileSync(path.join(p,'holderB.release'),'1');await a.done;if(b)await b.done}
 })
}finally{await new Promise(r=>server.close(r));fs.writeFileSync(path.join(temp,'results.json'),JSON.stringify({reviewedCommit:'b66d194',results},null,2));console.log('EVIDENCE',temp)}
process.exitCode=results.some(r=>r.result==='PROBE_ERROR')?1:0
