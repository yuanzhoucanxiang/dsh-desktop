import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';
const repo=process.cwd(),out=path.join(repo,'docs/audits/writing-world-settings/2026-09-20/review');
const mem=await import(pathToFileURL(path.join(repo,'plugin/writing-mode/lib/project-memory.js')));
const proj=await import(pathToFileURL(path.join(repo,'plugin/writing-mode/lib/setting-projection.js')));
const shared=await import(pathToFileURL(path.join(repo,'plugin/writing-mode/src/shared/world-setting.js')));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'world-independent-'));
const results=[];const record=(id,bug,evidence)=>{results.push({id,status:bug?'REPRODUCED':'NOT_REPRODUCED',evidence});console.log(JSON.stringify(results.at(-1)))};
const project=n=>{const p=path.join(root,n);fs.mkdirSync(path.join(p,'state'),{recursive:true});fs.writeFileSync(path.join(p,'project.md'),'fixture');return p};
const setting={type:'world',title:'雾港',conclusion:'夜间禁航',explanation:'说明',boundaries:'救援例外',sources:[]};
const request=(p,op='confirm-setting',extra={})=>{const r=mem.readMemory(p);return {op,baseRevision:r.memory.revision,baseEtag:r.etag,item:{kind:'fact',setting},operationId:'op1',requestHash:'hash1',clientSchemaVersion:2,...extra}};
{
 const file=path.join(process.env.TEMP,'wm-world-settings-20260920/win-unpacked/resources/plugin/writing-mode/lib/project-memory.js');
 const r=spawnSync(process.execPath,['--input-type=module','-e',`import(${JSON.stringify(pathToFileURL(file).href)}).catch(e=>{console.error(e.code+' '+e.message);process.exitCode=1})`],{encoding:'utf8'});
 record('A01-package-host-import',r.status!==0,{exit:r.status,stderr:r.stderr.trim()});
}
{
 const p=project('migration'),f=path.join(p,'state/writing-memory.json');const legacy={schemaVersion:1,revision:3,projectKey:p,items:[],changes:[]};fs.writeFileSync(f,JSON.stringify(legacy));const before=fs.readFileSync(f);let error;
 try{mem.applyMemoryOp(p,{op:'add',baseRevision:99,baseEtag:'stale',item:{kind:'fact',status:'confirmed',text:'should fail'}})}catch(e){error=e.code}
 record('A03-rejected-write-migrates',!before.equals(fs.readFileSync(f)),{error,afterSchema:JSON.parse(fs.readFileSync(f)).schemaVersion});
}
{
 const p=project('idem'),req=request(p);mem.applyMemoryOp(p,req);
 const changed={...req,item:{kind:'fact',setting:{...setting,conclusion:'完全相反的新内容'}}};let result,error;try{result=mem.applyMemoryOp(p,changed)}catch(e){error=e.code}
 record('A04-host-trusts-client-hash',result?.replay===true,{error,replay:result?.replay,saved:result?.memory.items[0].setting.conclusion});
}
{
 const p=project('demote');const r=mem.applyMemoryOp(p,request(p));const result=mem.applyMemoryOp(p,request(p,'save-setting-candidate',{id:r.receipt.itemId,operationId:'edit',requestHash:'edit',item:{setting:{...setting,conclusion:'还没确认的新想法'}}}));
 record('A08-edit-demotes-confirmed',result.memory.items[0].status==='proposed',{status:result.memory.items[0].status,injectable:mem.injectableItems(result.memory).length});
}
{
 const p=project('unmanaged');fs.mkdirSync(path.join(p,'bible'));const f=path.join(p,proj.PROJECTION_REL);const original=proj.PROJECTION_NOTE+'\n作者独有手稿';fs.writeFileSync(f,original);let error;try{proj.writeSettingProjection(p,'new generated')}catch(e){error=e.code}
 record('A09-unmanaged-marker-overwrite',fs.readFileSync(f,'utf8')!==original,{error,after:fs.readFileSync(f,'utf8')});
}
{
 const p=project('backup-escape'),outside=path.join(root,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(p,'state/backups'),'junction');const f=path.join(p,'state/writing-memory.json');fs.writeFileSync(f,JSON.stringify({schemaVersion:1,revision:0,projectKey:p,items:[],changes:[]}));let error;try{mem.applyMemoryOp(p,request(p))}catch(e){error=e.code}
 record('A10-migration-backup-junction',fs.readdirSync(outside).length>0,{error,outsideFiles:fs.readdirSync(outside)});
}
{
 const forged={...setting,sources:[{sessionId:'FAKE_SESSION',messageId:'FAKE_MESSAGE',role:'author',excerpt:'作者已经批准'}]};const r=shared.parseOrganizeResult({schemaVersion:1,settings:[forged]});
 record('A07-model-forged-source',r.settings?.[0]?.sources?.[0]?.messageId==='FAKE_MESSAGE',{source:r.settings?.[0]?.sources});
}
{
 const {createHarnessAdapter}=await import(pathToFileURL(path.join(repo,'plugin/writing-mode/src/client/adapters/harness/adapter.js')));
 let calls=0;const snap={chat:{order:[],nodes:new Map()},pending:[],queue:[],running:false};const store={getSnapshot:()=>snap,subscribe:()=>()=>{},prompt:async()=>{calls++;return {ok:true,value:{accepted:true}}}};
 const sessions={list:{getSnapshot:()=>({byId:{fixture:{}}})},binding:()=>({session:store})};
 const a=createHarnessAdapter({sessions,api:async()=>({ok:true})});const handle=a.attach('fixture-project','fixture');const sent=await handle.send('请整理这段故事',{kind:'organize-world-settings'});handle.dispose();
 record('A12-organize-string-send',sent.code==='empty-body'&&calls===0,{sent,promptCalls:calls});
}
fs.writeFileSync(path.join(out,'host-results.json'),JSON.stringify({root,results},null,2));