// Explicit visible preview: detached and left running for the author to close.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process')
const repo=path.resolve(__dirname,'../../../../..')
const yaml=require(path.join(repo,'runtime/node_modules/yaml'))
const source=path.join(os.tmpdir(),'dsh-writing-live-NPAeSL')
const base=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-preview','writing-reading-20260920-'))
const home=path.join(base,'home')
fs.mkdirSync(home,{recursive:true})
// Never copy profile/runtime links: a copied Windows fallback link can become
// a real directory, which the packaged kernel correctly refuses to replace.
for(const name of ['sessions','storages','writing-harness','writing-mode','.agent-presets','settings.yaml','writing-mode.json']) {
  const from=path.join(source,'home',name)
  if(fs.existsSync(from))fs.cpSync(from,path.join(home,name),{recursive:true})
}
const creds=yaml.parse(fs.readFileSync(path.join(os.homedir(),'.dsh/.credentials.yaml'),'utf8'))
const key=process.env.DEEPSEEK_API_KEY||creds.refs?.DEEPSEEK_API_KEY
if(!key)throw Error('Configured DeepSeek credential unavailable')
// Saved workspace identity intentionally stays at the original temporary story:
// copying/rewriting real Harness session records would invalidate the test history.
const exe=path.join(os.tmpdir(),'wm-reading-final-2026-09-20/win-unpacked/DeepSeek Harness Desktop.exe')
const app=cp.spawn(exe,[],{cwd:path.join(source,'library','灯塔来信'),detached:true,stdio:'ignore',windowsHide:true,env:{...process.env,DEEPSEEK_API_KEY:key,DSH_HOME:home,DSH_DESKTOP_HOME:home,DSH_DESKTOP_USER_DATA:path.join(base,'user-data'),LOCALAPPDATA:path.join(base,'localappdata')}})
app.on('error',e=>{console.error(e.message);process.exitCode=1})
app.unref()
const meta={pid:app.pid,exe,base,home,library:path.join(source,'library'),createdAt:new Date().toISOString(),keptRunning:true,credentialPersisted:false}
fs.writeFileSync(path.join(__dirname,'preview.json'),JSON.stringify(meta,null,2))
console.log(JSON.stringify(meta,null,2))
