const fs=require('fs'),path=require('path'),{spawn}=require('child_process'),net=require('net'),assert=require('assert/strict');
(async()=>{
const out=process.argv[2],delay=ms=>new Promise(r=>setTimeout(r,ms));
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const child=spawn(path.join(out,'win-unpacked/DeepSeek Harness Desktop.exe'),['--ui-smoke','--remote-debugging-port='+port],{cwd:out,windowsHide:true,env:{...process.env,DSH_HOME:path.join(out,'smoke-home'),DSH_DESKTOP_HOME:path.join(out,'smoke-home'),DSH_DESKTOP_USER_DATA:path.join(out,'ui-theme-proof-data'),LOCALAPPDATA:path.join(out,'smoke-local')},stdio:['ignore','pipe','pipe']});
let stdout='',stderr='',ws,seq=0;child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const pending=new Map();let seenOn=false,seenOff=false,last;
const until=Date.now()+60000;
while(child.exitCode===null&&Date.now()<until){
try{
 if(!ws){const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();const target=targets.find(t=>t.type==='page'&&t.url.startsWith('http://127.0.0.1'));if(!target){await delay(100);continue}ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}})}
 const id=++seq;const response=new Promise(r=>pending.set(id,r));ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression:'({on:document.documentElement.hasAttribute("data-palis-theme"),bg:getComputedStyle(document.body).getPropertyValue("--dsw-alias-bg-base").trim(),crt:!!document.querySelector(".palis-crt-sweep")})',returnByValue:true}}));const result=await Promise.race([response,delay(1000).then(()=>({}))]);last=result.result?.result?.value;
 if(last?.on&&last.bg==='#0a0a0a'&&last.crt)seenOn=true;
 if(seenOn&&last&&!last.on&&!last.crt)seenOff=true;
}catch{}
await delay(100);
}
ws?.close();
const result={seenOn,seenOff,last,exitCode:child.exitCode,stdout};fs.writeFileSync(path.join(out,'theme-proof.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(out,'theme-proof.stderr.log'),stderr);console.log(JSON.stringify(result));
assert.ok(seenOn,'current body token and CRT selector must render');assert.ok(seenOff,'theme and CRT must clear');assert.ok(stdout.includes('UI_SMOKE_FAIL: kernel token overridden to #0a0a0a | crt overlay mounted'),'only the two obsolete original assertions may fail');
console.log('PACKAGED_THEME_CURRENT_CONTRACT_OK');
})().catch(e=>{console.error(e);process.exitCode=1});
