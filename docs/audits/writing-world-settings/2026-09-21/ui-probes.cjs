// Two real Electron renderers, same real Harness host/home/project. No model calls.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
const repo=path.resolve(__dirname,'../../../..')
let fixture=fs.readFileSync(path.join(repo,'scripts/verify-writing-native.cjs'),'utf8').replace(/\r\n/g,'\n')
fixture=fixture.replace("const repo = path.resolve(__dirname, '..')",`const repo=${JSON.stringify(repo)}`)
fixture=fixture.replace('let kernel, win, kernelOutput', 'let second; let kernel, win, kernelOutput')
const cut=fixture.indexOf("  await input('想听听你对她为什么不拆信的看法。')")
if(cut<0)throw Error('Bootstrap anchor changed')
fixture=fixture.slice(0,cut)+String.raw`
  second=new BrowserWindow({width:1500,height:1000,show:false,webPreferences:{backgroundThrottling:false}})
  const eval2=code=>second.webContents.executeJavaScript(code,true)
  async function wait2(code){const end=Date.now()+20000;while(Date.now()<end){if(await eval2(code))return;await sleep(75)}throw Error('Second window timeout: '+code+'\n'+await eval2('document.body.innerText'))}
  await second.loadURL('http://127.0.0.1:'+port)
  await wait2("!!document.getElementById('dsh-writing-mode-float')")
  await eval2("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='稍后配置')?.click()")
  await eval2("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='继续')?.click()")
  await sleep(300)
  await eval2("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='稍后配置')?.click()")
  await eval2("if(!document.querySelector('.dshWmRoot'))document.getElementById('dsh-writing-mode-float').click()")
  await wait2("!!document.querySelector('.dshWmItem')")
  await eval2("document.querySelector('.dshWmItem').click()")
  await wait2("!!document.querySelector('.dshWmChatInput')")

  const memoryFile=path.join(project,'state/writing-memory.json');
  const memory=()=>JSON.parse(fs.readFileSync(memoryFile,'utf8'));
  const click=(run,text)=>run('Array.from(document.querySelectorAll(".dshWmWorldPanel button")).find(e=>e.textContent==='+JSON.stringify(text)+')?.click()');
  const field=(run,key,text)=>run('(()=>{const e=document.querySelector("[data-world-field='+key+']");Object.getOwnPropertyDescriptor(e.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(text)+');e.dispatchEvent(new Event("input",{bubbles:true}));})()');

  const observations=[];
  await button('项目备忘');await waitFor('!!document.querySelector("[data-world-panel]")');await click(evaluate,'手动新建设定');await field(evaluate,'title','未决的钟声规则');await field(evaluate,'conclusion','钟声含义还待讨论');
  await evaluate('(()=>{const k=Object.keys(sessionStorage).find(k=>k.startsWith("dsh-world-drafts-v1:"));const d=JSON.parse(sessionStorage.getItem(k));d.drafts[0].modelMark="open";d.drafts[0].pending=true;sessionStorage.setItem(k,JSON.stringify(d));})()');
  await win.webContents.reload();await waitFor('!!document.getElementById("dsh-writing-mode-float")');await evaluate('if(!document.querySelector(".dshWmRoot"))document.getElementById("dsh-writing-mode-float").click()');await waitFor('!!document.querySelector(".dshWmItem")');await evaluate('document.querySelector(".dshWmItem").click()');await waitFor('!!document.querySelector(".dshWmChatInput")');await button('项目备忘');await waitFor('!!document.querySelector("[data-world-field=title]")');
  assert.ok(await evaluate('document.querySelector("[data-world-panel]").innerText.includes("仍待讨论")'));
  await click(evaluate,'存为候选');await waitFor('!!document.querySelector("[data-world-item]")');
  await eval2('Array.from(document.querySelectorAll("button")).find(e=>e.textContent==="项目备忘").click()');await wait2('!!document.querySelector("[data-world-item]")');await click(eval2,'打开候选');await wait2('!!document.querySelector("[data-world-field=title]")');
  const lostMark=!(await eval2('document.querySelector("[data-world-panel]").innerText.includes("仍待讨论")'));assert.ok(lostMark);observations.push({id:'D02',status:'REPRODUCED',issue:'Saved/reopened open candidate loses unresolved marker',stored:memory().items[0].setting});
  await click(evaluate,'手动新建设定');await field(evaluate,'title','关闭前唯一的新编辑');await field(evaluate,'conclusion','不能丢失的候选正文');
  let prevented=false;win.webContents.on('will-prevent-unload',()=>{prevented=true});win.close();await sleep(150);assert.ok(win.isDestroyed());
  win=new BrowserWindow({width:1500,height:1000,show:false,webPreferences:{backgroundThrottling:false}});await win.loadURL('http://127.0.0.1:'+port);await waitFor('!!document.getElementById("dsh-writing-mode-float")');await evaluate('if(!document.querySelector(".dshWmRoot"))document.getElementById("dsh-writing-mode-float").click()');await waitFor('!!document.querySelector(".dshWmItem")');await evaluate('document.querySelector(".dshWmItem").click()');await waitFor('!!document.querySelector(".dshWmChatInput")');await button('项目备忘');await waitFor('!!document.querySelector("[data-world-item]")');
  const returned=await evaluate('({editor:document.querySelector("[data-world-field=title]")?.value||null,cache:Object.keys(sessionStorage).filter(k=>k.startsWith("dsh-world-drafts-v1:"))})');assert.equal(returned.editor,null);assert.equal(prevented,false);assert.equal(memory().items.length,1);observations.push({id:'D01',status:'REPRODUCED',issue:'Closing actual BrowserWindow loses unsaved world candidate; saved candidate survives',prevented,returned});
  fs.writeFileSync(path.join(repo,'docs/audits/writing-world-settings/2026-09-21/ui-results.json'),JSON.stringify({temp,observations},null,2));console.log('AUDIT_UI_COMPLETE',JSON.stringify(observations));
}).catch(err=>{console.error(err);process.exitCode=1}).finally(async()=>{
 fs.writeFileSync(path.join(temp,'results.json'),JSON.stringify({passed:!process.exitCode,results,failures},null,2))
 if(second&&!second.isDestroyed())second.destroy()
 if(win&&!win.isDestroyed())win.destroy()
 if(kernel&&kernel.exitCode===null)kernel.kill()
 app.exit(process.exitCode||0)
})
`
const m=new Module(__filename,module);m.filename=__filename;m.paths=module.paths;m._compile(fixture,__filename)
