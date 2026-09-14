// Launch the actual new packaged executable, isolated, --smoke, with debugger attached
// before main.js. Catch startup exceptions in THIS CHILD to avoid an OS error dialog.
// No process enumeration, no interaction with any user app.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto')
const repo=path.resolve(__dirname,'../../../../..')
const base=fs.readFileSync(path.join(os.tmpdir(),'wm-v2-review-package-path.txt'),'utf8').trim()
const unpacked=path.join(base,'win-unpacked')
const asar=path.join(unpacked,'resources','app.asar')
const exe=path.join(unpacked,'DeepSeek Harness Desktop.exe')
const archive=require(path.join(repo,'node_modules/@electron/asar'))
const files=archive.listPackage(asar).map(p=>p.replace(/\\/g,'/'))
const envRoot=fs.mkdtempSync(path.join(os.tmpdir(),'wm-v2-packaged-smoke-'))
const env={...process.env,DSH_HOME:path.join(envRoot,'home'),DSH_DESKTOP_HOME:path.join(envRoot,'desktop-home'),DSH_DESKTOP_USER_DATA:path.join(envRoot,'user-data'),LOCALAPPDATA:path.join(envRoot,'localappdata')}
delete env.ELECTRON_RUN_AS_NODE
let log='',ws,hookInstalled=false,timedOut=false
const child=cp.spawn(exe,['--inspect-brk=127.0.0.1:0','--smoke'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']})
let attached=false
const inflight=new Map();let seq=0
function rpc(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;inflight.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}
function output(data){
  const s=data.toString();log+=s;process.stdout.write(s)
  if (/SMOKE_OK/.test(s)) { try { ws?.close() } catch {} } // Let Node exit after successful smoke.
  const match=log.match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/)
  if(match&&!attached){
    attached=true;ws=new WebSocket(match[0])
    ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&inflight.has(m.id)){const p=inflight.get(m.id);inflight.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}})
    ws.addEventListener('open',async()=>{
      try {
        const r=await rpc('Runtime.evaluate',{expression:"process.removeAllListeners('uncaughtException');process.on('uncaughtException',e=>{console.error('WM_PACKAGED_STARTUP_ERROR '+e.stack);process.exit(41)});'hook-installed'",returnByValue:true})
        if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails))
        hookInstalled=true
        await rpc('Runtime.runIfWaitingForDebugger')
      }catch(e){console.error('INSPECTOR_ERROR',e)}
    })
  }
}
child.stdout.on('data',output);child.stderr.on('data',output)
const timer=setTimeout(()=>{timedOut=true;child.kill()},60000) // Only our own isolated child.
child.on('exit',(code,signal)=>{
  clearTimeout(timer);try{ws?.close()}catch{}
  const result={commit:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),exe,asar,envRoot,pid:child.pid,hookInstalled,code,signal,timedOut,asarSha256:crypto.createHash('sha256').update(fs.readFileSync(asar)).digest('hex'),mainPresent:files.includes('/main.js'),pluginSyncPresent:files.includes('/lib/plugin-sync.js'),log}
  fs.writeFileSync(path.join(__dirname,'package-results.json'),JSON.stringify(result,null,2)+'\n')
  console.log(JSON.stringify({...result,log:undefined}))
  process.exit(code===0?0:1)
})
