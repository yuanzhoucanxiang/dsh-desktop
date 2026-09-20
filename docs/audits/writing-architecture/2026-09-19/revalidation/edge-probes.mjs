// Actual production modules; every file is created under a unique TEMP root.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createRequire} from 'node:module'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {execFileSync} from 'node:child_process'
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../../../../..')
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wm-review2-edge-'))
process.env.DSH_HOME=path.join(temp,'home')
const {createHarnessAdapter}=await import(pathToFileURL(path.join(repo,'plugin/writing-mode/src/client/adapters/harness/adapter.js')))
const host=await import(pathToFileURL(path.join(repo,'plugin/writing-mode/lib/coordination.js')))
const req=createRequire(path.join(repo,'package.json')),sync=req('./lib/plugin-sync')
const results=[]
async function probe(id,fn){try{const e=await fn();results.push({id,status:e.ok?'PASS':'FAIL',evidence:e})}catch(e){results.push({id,status:'ERROR',error:e.stack})}console.log(JSON.stringify(results.at(-1)))}

await probe('N02-unknown-created-session-must-not-be-recreated',async()=>{
 const project=path.join(temp,'project'),sessionsMap=new Map();let creates=0,workspaces=0
 const sessions={list:{getSnapshot:()=>({byId:Object.fromEntries([...sessionsMap.keys()].map(k=>[k,{}]))})},binding:id=>({session:sessionsMap.get(id)}),provideInfo:()=>null,refresh:async()=>{},open:()=>{},noteAgentPreset:()=>{},create:async()=>{
   const id='s'+(++creates);sessionsMap.set(id,{getSnapshot:()=>({chat:{nodes:new Map(),order:[]}})})
   if(creates===1)throw Error('Created on server but response was lost')
   return id
 }}
 const coordination={read:async()=>({ok:true,record:host.readCoordination(project)}),forget:async b=>host.forgetCoordination({...b,projectKey:project})}
 for(const [op,fn] of Object.entries({claim:host.claimCoordination,creating:host.markCreatingCoordination,confirm:host.confirmCoordination,uncertain:host.markUncertainCoordination,release:host.releaseCoordination}))coordination[op]=async b=>{const r=fn({...b,projectKey:project});return {ok:true,outcome:r._outcome,record:r}}
 const adapter=createHarnessAdapter({sessions,coordination,api:async()=>({ok:true,project,sessionId:null,preset:'p'}),workspaces:{create:async()=>({workspaceId:'w'+(++workspaces)})},connection:{agentPresets:{select:async()=>({result:{ok:true}})}}})
 const handle=await adapter.connect(project,'initial')
 const before=handle.getSnapshot(),after=await handle.recover()
 return {ok:creates===1,before:{status:before.status,sessionId:before.sessionId,record:before.record},after:{status:after.status,sessionId:after.sessionId},creates,workspaces,liveIds:[...sessionsMap.keys()]}
})

await probe('N04-other-new-message-is-not-current-acceptance',async()=>{
 const chat={nodes:new Map(),order:[]}
 const session={getSnapshot:()=>({chat}),prompt:async()=>{
   chat.order.push('other-window-turn');chat.nodes.set('other-window-turn',{kind:'user',data:{content:[{type:'text',text:'不要继续旧方案，我们重新讨论人物动机。'}]}})
   return {ok:false,error:{code:'busy',message:'This request was rejected'}}
 }}
 const sessions={list:{getSnapshot:()=>({byId:{s:{}}})},binding:()=>({session}),provideInfo:()=>null}
 const result=await createHarnessAdapter({sessions}).attach('C:/fixture/project','s').send({message:'继续',body:'继续'})
 return {ok:result.result==='rejected',result,newOtherMessage:'不要继续旧方案，我们重新讨论人物动机。'}
})

await probe('N05-profile-root-junction-must-be-rejected',async()=>{
 const src=path.join(temp,'src'),outside=path.join(temp,'outside'),dest=path.join(temp,'profile-plugin')
 fs.mkdirSync(src);fs.mkdirSync(outside);fs.writeFileSync(path.join(src,'package.json'),'{}');fs.writeFileSync(path.join(src,'note.js'),'PLUGIN CONTENT')
 fs.writeFileSync(path.join(outside,'note.js'),'AUTHOR ORIGINAL');fs.symlinkSync(outside,dest,'junction')
 const result=sync.syncPluginDir({srcDir:src,destDir:dest})
 const after=fs.readFileSync(path.join(outside,'note.js'),'utf8')
 return {ok:after==='AUTHOR ORIGINAL',after,result}
})
fs.writeFileSync(path.join(here,'edge-results.json'),JSON.stringify({sha:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),temp,results},null,2)+'\n')
process.exitCode=results.some(r=>r.status!=='PASS')?1:0
