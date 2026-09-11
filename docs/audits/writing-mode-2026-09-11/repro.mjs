import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(import.meta.dirname, '../../..');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-writing-audit-'));
process.env.DSH_HOME = path.join(base, 'home');
const store = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/lib/store.js')));
const domain = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/lib/domain.js')));
const host = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/index.js')));
const root = path.join(base, 'library');
const project = path.join(root, 'project');
fs.mkdirSync(path.join(project, 'draft/novel'), { recursive: true });
fs.writeFileSync(path.join(project, 'project.md'), '作品名：隔离测试\n');
store.writeConfig({roots:[{path:root,default:true}],activeRoot:root,prefs:store.DEFAULT_PREFS});
let handler;
host.apply({effect:f=>f(),webServer:{register:r=>{handler=r.handler;return ()=>{};}}});
async function request(url, options={}) {
  const req = new EventEmitter();
  Object.assign(req,{url,method:options.method || 'GET',headers:options.headers || {},socket:{remoteAddress:'127.0.0.1'}});
  let data;
  const res = {statusCode:200,setHeader(){},end(s){data=JSON.parse(s);}};
  const running = handler(req,res);
  if(req.method==='POST') { req.emit('data',options.body || '{}'); req.emit('end'); }
  await running;
  return {status:res.statusCode,data};
}
const post = (route,body,headers)=>request('/api/writing-mode?route='+route,{method:'POST',headers,body:JSON.stringify(body)});
const results = [];
function record(name, reproduced, evidence) { results.push({name,reproduced,evidence}); }
const source = fs.readFileSync(path.join(repo,'plugin/writing-mode/client.js'),'utf8');
const apiSource = source.slice(source.indexOf('    async function api('),source.indexOf('    function applyBodyAttr('));
let capturedUrl;
const sandbox = {API:'/api/writing-mode',encodeURIComponent,fetch:async(url,opts)=>{capturedUrl=url;const r=await request(url,opts);return {json:async()=>r.data};}};
vm.createContext(sandbox); vm.runInContext(apiSource+'\nglobalThis.clientApi=api;',sandbox);
const a = path.join(project,'draft/novel/第1章-v1.md');
fs.writeFileSync(a,'稿件A');
const opened = await sandbox.clientApi('get&path='+encodeURIComponent(a));
const good = await request('/api/writing-mode?route=get&path='+encodeURIComponent(a));
record('read-route-encoded-as-one-value',opened.error==='unknown-route' && good.data.doc.content==='稿件A',{capturedUrl,actual:opened,controlStatus:good.status});

const b=path.join(project,'draft/novel/第1章-v2.md'); fs.writeFileSync(b,'已有v2');
const nextSource=source.slice(source.indexOf('      function nextVersionPath('),source.indexOf('      async function saveAsNewVersion('));
vm.runInContext(nextSource+'\nglobalThis.nextPath=nextVersionPath;',sandbox);
const next=sandbox.nextPath(a); const saved=await post('save',{path:next,content:'v1另存覆盖'});
record('save-new-version-overwrites-existing',saved.status===200 && fs.readFileSync(b,'utf8')==='v1另存覆盖',{target:next,status:saved.status});

const loose=await post('save',{title:'新建独立文稿',content:'独立文稿'});
const tree=store.scanTree(store.readConfig());
const listed=tree.flatMap(r=>r.projects.flatMap(p=>p.files)).some(f=>f.abs===loose.data.doc.path);
record('new-root-document-not-listed',fs.existsSync(loose.data.doc.path)&&!listed,{path:loose.data.doc.path,listed});

const outside=path.join(base,'outside-project'); fs.mkdirSync(outside,{recursive:true});
fs.writeFileSync(path.join(outside,'project.md'),'作品名：OUTSIDE_ROOT_SENTINEL\n');
const escaped=await post('assist',{action:'research',path:path.join(outside,'draft.md'),text:''});
record('research-reads-outside-library',escaped.status===200 && escaped.data.result.includes('OUTSIDE_ROOT_SENTINEL'),{status:escaped.status,sentinelReturned:escaped.data.result.includes('OUTSIDE_ROOT_SENTINEL')});

const md=domain.runGates(path.join(project,'bible/world.md'),'世界规则：日落后禁止通行。');
record('bible-treated-as-novel-chapter',md.kind==='novel'&&!md.pass,{kind:md.kind,failures:md.rows.filter(r=>!r.ok)});
const fq='INT. ROOM - DAY\n\n@小王\n"你好"\n\nCUT TO:\n';
const fqGate=domain.runGates('act1-v1.fountain',fq);
record('fountain-ascii-quotes-pass',fqGate.pass,{gate:fqGate});
const divergent='INT. ROOM - DAY\n\n@小王\n# 新章\n“动作描述。”\n\nCUT TO:\n';
const divFile=path.join(base,'divergent.fountain'); fs.writeFileSync(divFile,divergent);
const cli=spawnSync(process.execPath,['E:/剧本/验证/check-fountain.mjs',divFile],{encoding:'utf8'});
const ui=domain.checkFountainGates(divergent);
record('fountain-cli-host-disagreement',cli.stdout.includes('FAIL  对白行')&&ui.rows.find(r=>r.label==='对白行').ok,{cli:cli.stdout,host:ui});

const timestamp=new Date('2020-01-01'); fs.utimesSync(b,timestamp,timestamp); fs.utimesSync(a,new Date(),new Date());
const ledger=domain.ledgerSummary(project);
record('ledger-picks-old-version-by-mtime',ledger.latestDraft.path===a,{latestDraft:ledger.latestDraft});

const selected=domain.resolveAiRoute({sessions:{list:()=>[{requestHeader:()=>({config:{provider:'active-provider',model:'active-model'}})},{requestHeader:()=>({config:{provider:'unrelated-provider',model:'unrelated-model'}})}]}},store.DEFAULT_PREFS);
record('model-route-uses-last-created-session',selected.provider==='unrelated-provider',selected);

const cross=await post('save',{path:a,content:'跨Origin测试'}, {'origin':'https://audit.invalid','content-type':'text/plain'});
record('host-accepts-cross-origin-plain-post',cross.status===200 && fs.readFileSync(a,'utf8')==='跨Origin测试',{status:cross.status,note:'Direct handler probe; no browser exploit attempted.'});

const multiblock=await domain.chatComplete({llm:{async *stream(){yield {type:'text-delta',index:0,text:'第一段'};yield {type:'block-end',index:0,block:{type:'text',text:'第一段'}};yield {type:'text-delta',index:1,text:'第二段'};yield {type:'block-end',index:1,block:{type:'text',text:'第二段'}};yield {type:'finish',reason:{kind:'stop'}};}}},{system:'',userText:'test',route:{provider:'mock',model:'mock'}});
record('multi-text-block-keeps-only-last',multiblock.text==='第二段',multiblock);

// Run the actual persist callback body with a delayed response and a newer edit.
const persistBody=source.slice(source.indexOf('        if (!filePath) return',source.indexOf('const persist =')),source.indexOf('      }, [filePath, content, refreshTree])'));
let completeSave; const pending=new Promise(r=>completeSave=r); let dirty=true; let saveState='idle'; let liveContent='编辑后的新内容';
const race={filePath:a,content:'请求发出时旧内容',api:()=>pending,setSaveState:s=>saveState=s,setFilePath:()=>{},setDirty:v=>dirty=v,refreshTree:()=>{},getPrefs:()=>({autoGate:false}),runGateRef:{current:()=>{}}};
vm.createContext(race); vm.runInContext('globalThis.persist=async()=>{'+persistBody+'}',race);
const inFlight=race.persist(); completeSave({ok:true,doc:{path:a}}); await inFlight;
record('save-response-clears-newer-dirty-edit',dirty===false&&liveContent!==race.content,{sent:race.content,currentEditor:liveContent,dirty,saveState,note:'Extracted production callback with deferred API response; not a browser E2E.'});

console.log(JSON.stringify({base,reproduced:results.filter(r=>r.reproduced).length,total:results.length,results},null,2));
fs.writeFileSync(path.join(base,'results.json'),JSON.stringify({base,results},null,2));

