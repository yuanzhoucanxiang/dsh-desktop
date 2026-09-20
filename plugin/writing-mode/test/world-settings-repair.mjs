import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readMemory, applyMemoryOp, syncSettingProjection, injectableItems } from '../lib/project-memory.js'
import { writeSettingProjection, PROJECTION_NOTE, PROJECTION_REL } from '../lib/setting-projection.js'
import { parseOrganizeResult } from '../lib/world-setting.js'
import { organizeWorld } from '../src/client/services/world-organizer.js'

if (process.argv[2] === '--worker') {
  try { syncSettingProjection(process.argv[3], JSON.parse(process.argv[4])); console.log('SYNC_OK') }
  catch (e) { console.log('SYNC_REJECTED:' + e.code) }
} else {
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'world-repair-protocol-'))
let count = 0
const project = label => { const dir = path.join(base,label); fs.mkdirSync(path.join(dir,'state'),{recursive:true}); fs.writeFileSync(path.join(dir,'project.md'),'fixture'); return dir }
const setting = { type:'world',title:'夜航',conclusion:'禁止民船夜航',explanation:'说明\n保持换行',boundaries:'救援船例外',sources:[] }
const tokens = p => { const r=readMemory(p);return {baseRevision:r.memory.revision,baseEtag:r.etag} }
const req = (p,overrides={}) => ({op:'confirm-setting',...tokens(p),operationId:crypto.randomUUID(),item:{setting},clientSchemaVersion:2,...overrides})
const test = async(name,fn)=>{await fn();count++;console.log('PASS',name)}
await test('Rejected stale or invalid writes leave schema1 bytes unchanged',()=>{
 const p=project('migration'),file=path.join(p,'state/writing-memory.json');fs.writeFileSync(file,JSON.stringify({schemaVersion:1,revision:3,items:[],changes:[]}));const before=fs.readFileSync(file)
 assert.throws(()=>applyMemoryOp(p,{...req(p),baseRevision:99}),/revision-conflict/);assert.deepEqual(fs.readFileSync(file),before)
 assert.throws(()=>applyMemoryOp(p,req(p,{item:{setting:{...setting,title:''}}})),/empty-title/);assert.deepEqual(fs.readFileSync(file),before)
 applyMemoryOp(p,req(p));assert.equal(readMemory(p).memory.schemaVersion,2)
 assert.deepEqual(fs.readFileSync(path.join(p,'state/backups',fs.readdirSync(path.join(p,'state/backups'))[0])),before)
})
await test('Host canonical identity rejects altered body even with unchanged client hash',()=>{
 const p=project('idem'),r=req(p,{operationId:'one',requestHash:'untrusted'});applyMemoryOp(p,r)
 assert.equal(applyMemoryOp(p,{...r,baseRevision:0}).replay,true)
 assert.throws(()=>applyMemoryOp(p,{...r,item:{setting:{...setting,conclusion:'opposite'}}}),/operation-conflict/)
 assert.throws(()=>applyMemoryOp(p,{...r,op:'save-setting-candidate'}),/operation-conflict/)
 assert.equal(readMemory(p).memory.items.length,1)
})
await test('Confirmed record stays live during a proposed edit; explicit revision updates history',()=>{
 const p=project('revision'),created=applyMemoryOp(p,req(p)),id=created.receipt.itemId
 assert.throws(()=>applyMemoryOp(p,req(p,{op:'save-setting-candidate',id})),/confirmed-edit-requires-confirmation/)
 assert.equal(injectableItems(readMemory(p).memory).length,1)
 const changed=applyMemoryOp(p,req(p,{id,item:{setting:{...setting,conclusion:'作者确认新规则'}}}))
 assert.equal(changed.memory.items[0].itemRevision,2);assert.equal(changed.memory.changes.at(-1).before.setting.conclusion,setting.conclusion)
 applyMemoryOp(p,req(p,{op:'retract-setting',id,item:undefined}));assert.equal(injectableItems(readMemory(p).memory).length,0)
})
await test('Unmanaged handwritten file cannot be claimed by a marker or empty content',()=>{
 for(const [i,text] of [PROJECTION_NOTE+'\n珍贵手稿',''].entries()){
 const p=project('manual'+i);fs.mkdirSync(path.join(p,'bible'));const f=path.join(p,PROJECTION_REL);fs.writeFileSync(f,text)
 assert.throws(()=>writeSettingProjection(p,'GENERATED'),/projection-conflict/);assert.equal(fs.readFileSync(f,'utf8'),text)
 }
})
await test('Migration backup and projection backup junction escapes are refused',()=>{
 for(const type of ['backups','projection-backups']){
 const p=project(type),outside=path.join(base,'outside-'+type);fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(p,'state',type),'junction')
 if(type==='backups'){
 const file=path.join(p,'state/writing-memory.json');fs.writeFileSync(file,JSON.stringify({schemaVersion:1,revision:0,items:[],changes:[]}));const before=fs.readFileSync(file)
 assert.throws(()=>applyMemoryOp(p,req(p)),/projection-path-escape/);assert.deepEqual(fs.readFileSync(file),before)
 }else{
 applyMemoryOp(p,req(p));syncSettingProjection(p,tokens(p));applyMemoryOp(p,req(p,{item:{setting:{...setting,title:'二'}}}));assert.throws(()=>syncSettingProjection(p,tokens(p)),/projection-path-escape/)
 }
 assert.deepEqual(fs.readdirSync(outside),[])
 }
})
await test('Projection mark failure after file write recovers from durable intent',()=>{
 const p=project('crash');applyMemoryOp(p,req(p));let writes=0
 const original=fs.renameSync
 fs.renameSync=(from,to)=>{if(to===path.join(p,'state/writing-memory.json')&&++writes===2)throw Object.assign(new Error('injected mark failure'),{code:'EIO'});return original(from,to)}
 try { assert.throws(()=>syncSettingProjection(p,tokens(p)),/injected/) } finally { fs.renameSync=original }
 assert.ok(readMemory(p).memory.projection.intent?.hash)
 const before=fs.readFileSync(path.join(p,PROJECTION_REL));const result=syncSettingProjection(p,tokens(p))
 assert.equal(result.unchanged,true);assert.equal(result.projection.status,'synced');assert.deepEqual(fs.readFileSync(path.join(p,PROJECTION_REL)),before)
})
await test('Concurrent independent processes cannot commit stale projection metadata',async()=>{
 const p=project('concurrent');applyMemoryOp(p,req(p));const token=JSON.stringify(tokens(p));
 const worker=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--worker',p,token],{windowsHide:true});let out='';child.stdout.on('data',s=>out+=s);child.on('error',reject);child.on('exit',code=>code?reject(Error('worker '+code)):resolve(out))})
 const results=await Promise.all([worker(),worker()]);assert.equal(results.filter(x=>x.includes('SYNC_OK')).length,1);assert.equal(results.filter(x=>x.includes('SYNC_REJECTED')).length,1)
 assert.equal(readMemory(p).memory.projection.status,'synced')
})
await test('Forged model provenance never enters parsed candidates',()=>{
 const r=parseOrganizeResult({settings:[{...setting,sources:[{role:'author',messageId:'FAKE',excerpt:'approved'}]}]});assert.deepEqual(r.settings[0].sources,[])
})
function fakeHandle(send) {
 let snap={status:'ready',sessionId:'s',projectKey:'p',messages:[{key:'source',kind:'user',text:'真实原文'}],running:false,queue:[],pending:[]};const listeners=new Set()
 return {getSnapshot:()=>snap,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f)},send,emit:next=>{snap={...snap,...next};for(const f of listeners)f()}}
}
await test('Rejected organization does not adopt old JSON; uncertain is not retried',async()=>{
 for(const result of ['rejected','uncertain']){
 let calls=0;const handle=fakeHandle(async()=>{calls++;return {result,code:'fixture'}})
 await assert.rejects(organizeWorld({handle,selected:[{id:'source',text:'真实原文'}]}));assert.equal(calls,1)
 }
})
await test('Organization freezes sources, ignores old answers, waits for matching final turn',async()=>{
 let body,accepted;const handle=fakeHandle(req=>{body=req.body;return new Promise(r=>accepted=r)});const selected=[{id:'source',text:'真实原文'}]
 const waiting=organizeWorld({handle,selected});while(!accepted)await new Promise(r=>setTimeout(r,1))
 selected[0].text='被后来的选择改变';accepted({result:'accepted'})
 handle.emit({messages:[{key:'source',kind:'user',text:'真实原文'},{key:'old',kind:'assistant',text:'旧结果'}]})
 await new Promise(r=>setTimeout(r,5))
 handle.emit({messages:[{key:'source',kind:'user',text:'真实原文'},{key:'author',kind:'user',text:body},{key:'new',kind:'assistant',text:'新结果'}],running:false})
 const result=await waiting;assert.equal(result.text,'新结果');assert.equal(result.sources[0].excerpt,'真实原文');assert.match(result.sources[0].snapshotHash,/^[0-9a-f]{64}$/)
})
console.log('WORLD_REPAIR_PROTOCOL_OK',count,base)
}