// Independent negative probes: actual production modules, temporary data only.
// Exit 1 means at least one product invariant is violated.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../../..')
const req = createRequire(path.join(repo, 'package.json'))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-v2-review-'))
process.env.DSH_HOME = path.join(temp, 'home')
const { createHarnessAdapter } = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/src/client/adapters/harness/adapter.js')))
const { buildPreparedTurn } = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/src/shared/context-builder.js')))
const host = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/lib/coordination.js')))
const drafts = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/lib/draft-checkpoints.js')))
const { makeReference, sameReference, referenceStatus } = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/src/shared/reference.js')))
const sync = req('./lib/plugin-sync.js')
const results = []
async function probe(id, run) {
  try { const evidence = await run(); results.push({id, status:'PASS', evidence}) }
  catch (err) { results.push({id, status:'FAIL', error:err.message, evidence:err.evidence}) }
  console.log(JSON.stringify(results.at(-1)))
}
function check(condition, evidence, message) {
  if (!condition) throw Object.assign(new Error(message), { evidence })
  return evidence
}

await probe('B02-historical-memory-prefix-is-not-current-acceptance', async () => {
  const memoryItems = [{id:'m',kind:'fact',status:'confirmed',text:'共同设定'.repeat(40)}]
  const old = buildPreparedTurn({message:'上一轮问题',memoryItems})
  const fresh = buildPreparedTurn({message:'这一轮全新问题',memoryItems})
  const chat = {order:['old'],nodes:new Map([['old',{kind:'user',data:{content:[{type:'text',text:old.body}]}}]])}
  let calls=0
  const session={getSnapshot:()=>({chat}),prompt:async()=>{calls++;return {ok:false,error:{code:'busy',message:'NOT ACCEPTED'}}}}
  const sessions={list:{getSnapshot:()=>({byId:{s:{}}})},binding:()=>({session}),provideInfo:()=>null}
  const a=createHarnessAdapter({sessions}).attach('C:/fixture/project','s')
  const result=await a.send(fresh)
  return check(result.result==='rejected',{result,calls,nodeCount:chat.order.length,messagesDiffer:old.message!==fresh.message},'明确拒绝的新问题被旧备忘前缀误判为 accepted')
})

await probe('B03-continue-link-keeps-existing-session', async () => {
  const project=path.join(temp,'recover-project')
  let creates=0, savedBinding=null
  const stores=new Map()
  const sessions={
    list:{getSnapshot:()=>({byId:Object.fromEntries([...stores.keys()].map(k=>[k,{}]))})},
    refresh:async()=>{}, open:()=>{}, noteAgentPreset:()=>{},
    binding:id=>({session:stores.get(id)}), provideInfo:()=>null,
    create:async()=>{const id='s'+(++creates);stores.set(id,{getSnapshot:()=>({chat:{order:[],nodes:new Map()}})});return id},
  }
  let breakConfirm=true
  const coordination={
    read:async()=>({ok:true,record:host.readCoordination(project)}),
    claim:async b=>{const r=host.claimCoordination({...b,projectKey:project});return {ok:true,outcome:r._outcome,record:r}},
    creating:async b=>{const r=host.markCreatingCoordination({...b,projectKey:project});return {ok:true,outcome:r._outcome,record:r}},
    confirm:async b=>{if(breakConfirm) {breakConfirm=false;return {ok:true,outcome:'stale-token',record:host.readCoordination(project)}} const r=host.confirmCoordination({...b,projectKey:project});return {ok:true,outcome:r._outcome,record:r}},
    uncertain:async b=>({ok:true,record:host.markUncertainCoordination({...b,projectKey:project})}),
    release:async b=>({ok:true,record:host.releaseCoordination({...b,projectKey:project})}),
    forget:async()=>host.forgetCoordination({projectKey:project}),
  }
  const api=async(route,opts)=>{const b=opts?.body?JSON.parse(opts.body):{};if(b.sessionId)savedBinding=b.sessionId;return {ok:true,project,sessionId:savedBinding,preset:'fixture'}}
  const adapter=createHarnessAdapter({sessions,coordination,api,workspaces:{create:async()=>({workspaceId:'w'})},connection:{agentPresets:{select:async()=>({result:{ok:true}})}}})
  const h=await adapter.connect(project,'first')
  const before=h.getSnapshot()
  assert.equal(before.status,'uncertain')
  const firstMissingIdentity = !h.projectPath || !h.projectKey
  // A returned new handle is missing identity; also test a reopened durable uncertain record.
  host.markUncertainCoordination({projectKey:project,operationToken:'first',sessionId:before.sessionId,workspaceId:'w'})
  const reopened=await adapter.connect(project,'reopen')
  const after=await reopened.recover()
  return check(!firstMissingIdentity&&creates===1&&after.sessionId===before.sessionId,{firstMissingIdentity,before:before.sessionId,after:after.sessionId,creates,liveSessions:[...stores.keys()]},'首次恢复缺身份；重入后继续关联丢弃已知会话并另建')
})

await probe('B05-sync-junction-does-not-write-outside-profile', async () => {
  const src=path.join(temp,'src'),dest=path.join(temp,'dest'),outside=path.join(temp,'outside')
  fs.mkdirSync(path.join(src,'lib'),{recursive:true});fs.mkdirSync(dest);fs.mkdirSync(outside)
  fs.writeFileSync(path.join(src,'package.json'),'{}')
  fs.writeFileSync(path.join(src,'runtime-manifest.json'),JSON.stringify({root:'plugin/writing-mode',entry:['plugin/writing-mode/package.json'],files:['plugin/writing-mode/lib/owned.js']}))
  fs.writeFileSync(path.join(src,'lib','owned.js'),'NEW PLUGIN')
  fs.writeFileSync(path.join(outside,'owned.js'),'USER DATA')
  fs.symlinkSync(outside,path.join(dest,'lib'),'junction')
  const result=sync.syncPluginDir({srcDir:src,destDir:dest})
  const content=fs.readFileSync(path.join(outside,'owned.js'),'utf8')
  return check(content==='USER DATA',{result,outsideContent:content},'profile 下的 junction 使同步改写插件目录外文件')
})

await probe('B05-managed-record-traversal-does-not-delete-outside', async () => {
  const src=path.join(temp,'src2'),dest=path.join(temp,'dest2'),victim=path.join(temp,'outside-note.txt')
  fs.mkdirSync(src);fs.mkdirSync(dest);fs.writeFileSync(path.join(src,'package.json'),'{}')
  fs.writeFileSync(victim,'OUTSIDE AUTHOR FILE')
  fs.writeFileSync(path.join(dest,sync.RECORD_NAME),JSON.stringify({files:{'../outside-note.txt':sync.sha256(victim)}}))
  const result=sync.syncPluginDir({srcDir:src,destDir:dest})
  return check(fs.existsSync(victim),{result,victimExists:fs.existsSync(victim)},'未校验的旧受管清单可删除插件目录外文件')
})

await probe('B08-reference-fingerprint-survives-checkpoint', async () => {
  const project=path.join(temp,'reference-project')
  const reference=makeReference({label:'未保存选区',excerpt:'片段',path:'C:/fixture/story.md',revision:'disk-r1',start:2,end:4,dirty:true})
  drafts.writeCheckpoint(project,'w',{text:'正文',reference,baseRev:0})
  const after=drafts.readCheckpoint(project,'w').reference
  const afterStatus=referenceStatus(after,{path:reference.path,revision:reference.revision})
  return check(after.snapshotFingerprint===reference.snapshotFingerprint,{before:reference,after,afterStatus},'checkpoint 未保存引用快照指纹，恢复后未保存快照被判成 current')
})

await probe('B08-distinct-legacy-references-are-not-equal', async () => {
  const same=sameReference({label:'旧稿 A',text:'A'},{label:'旧稿 B',text:'B'})
  return check(!same,{same},'来源字段缺失的不同旧引用被视为同一引用')
})

await probe('C02-unicode-budget-counts-codepoints', async () => {
  const text='😀'.repeat(3500)
  const turn=buildPreparedTurn({message:'hi',memoryItems:[{id:'emoji',kind:'fact',status:'confirmed',text}]})
  return check(turn.selectedMemory.length===1,{codePoints:[...text].length,utf16Units:text.length,omissions:turn.omissions},'6000 Unicode 字符预算实际使用 UTF-16 长度')
})
fs.writeFileSync(path.join(here,'probes-results.json'),JSON.stringify({commit:'0e111510d107f6851aaf080d4a7a8fb65b9e7dc2',temp,results},null,2)+'\n')
process.exitCode=results.some(r=>r.status==='FAIL')?1:0
