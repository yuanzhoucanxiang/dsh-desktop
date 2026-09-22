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
  await waitFor('document.querySelector("[data-world-journal]").innerText.includes("已保留")');
  await evaluate('(()=>{const k=Object.keys(sessionStorage).find(k=>k.startsWith("dsh-world-drafts-v1:"));const d=JSON.parse(sessionStorage.getItem(k));d.drafts[0].modelMark="open";d.drafts[0].pending=true;sessionStorage.setItem(k,JSON.stringify(d));})()');
  await win.webContents.reload();await waitFor('!!document.getElementById("dsh-writing-mode-float")');await evaluate('if(!document.querySelector(".dshWmRoot"))document.getElementById("dsh-writing-mode-float").click()');await waitFor('!!document.querySelector(".dshWmItem")');await evaluate('document.querySelector(".dshWmItem").click()');await waitFor('!!document.querySelector(".dshWmChatInput")');await button('项目备忘');await waitFor('!!document.querySelector("[data-world-field=title]")');
  assert.ok(await evaluate('document.querySelector("[data-world-panel]").innerText.includes("仍待讨论")'));
  await click(evaluate,'存为候选');await waitFor('!!document.querySelector("[data-world-item]")');
  await eval2('Array.from(document.querySelectorAll("button")).find(e=>e.textContent==="项目备忘").click()');await wait2('!!document.querySelector("[data-world-item]")');await click(eval2,'打开候选');await wait2('!!document.querySelector("[data-world-field=title]")');
  const lostMark=!(await eval2('document.querySelector("[data-world-panel]").innerText.includes("仍待讨论")'));assert.equal(lostMark,false);observations.push({id:'D02',status:'PASS',issue:'Saved/reopened open candidate preserves unresolved marker',stored:memory().items[0].setting});
  await click(evaluate,'手动新建设定');await field(evaluate,'title','关闭前唯一的新编辑');await field(evaluate,'conclusion','不能丢失的候选正文');
  await waitFor('document.querySelector("[data-world-journal]").innerText.includes("已保留")');
  await evaluate('localStorage.clear();sessionStorage.clear()'); // simulate losing browser origin storage: host recovery must suffice
  let prevented=false;win.webContents.on('will-prevent-unload',()=>{prevented=true});win.close();await sleep(150);assert.ok(win.isDestroyed());
  win=new BrowserWindow({width:1500,height:1000,show:false,webPreferences:{backgroundThrottling:false}});await win.loadURL('http://127.0.0.1:'+port);await button('稍后配置');await sleep(500);await button('稍后配置');await waitFor('!!document.getElementById("dsh-writing-mode-float")');await evaluate('if(!document.querySelector(".dshWmRoot"))document.getElementById("dsh-writing-mode-float").click()');await waitFor('!!document.querySelector(".dshWmItem")');await evaluate('document.querySelector(".dshWmItem").click()');await waitFor('!!document.querySelector(".dshWmChatInput")');await sleep(500);await button('项目备忘');await waitFor('!!document.querySelector("[data-world-item]")');
  const returned=await evaluate('({editor:document.querySelector("[data-world-field=title]")?.value||null,cache:Object.keys(sessionStorage).filter(k=>k.startsWith("dsh-world-drafts-v1:"))})');assert.equal(returned.editor,null);assert.equal(prevented,false);assert.equal(memory().items.length,1);
  await waitFor('Array.from(document.querySelectorAll("[data-world-panel] button")).some(b=>b.textContent==="恢复这份编辑")');
  await click(evaluate,'恢复这份编辑');await waitFor('document.querySelector("[data-world-panel]").innerText.includes("关闭前唯一的新编辑")');
  assert.ok(await evaluate('Object.values(JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(k=>k.startsWith("dsh-world-drafts-v1:"))))).some(v=>Array.isArray(v)&&v.some(d=>d.conclusion==="不能丢失的候选正文"))'));
  observations.push({id:'D01',status:'PASS',issue:'Actual window close: host restores candidate after clearing browser cache; saved item survives',prevented,returned});

  await input('损坏前的聊天草稿');
  const windowId=await evaluate('sessionStorage.getItem("dsh-writing-window")');
  await waitFor('fetch("/api/writing-mode?route=draft&project="+encodeURIComponent('+JSON.stringify(project)+')+"&window="+encodeURIComponent('+JSON.stringify(windowId)+')).then(r=>r.json()).then(r=>r.checkpoint?.text==="损坏前的聊天草稿")');
  const draftDir=path.join(home,'writing-mode/drafts');
  const damagedFile=fs.readdirSync(draftDir).filter(n=>n.endsWith('.json')).map(n=>path.join(draftDir,n)).find(f=>{const d=JSON.parse(fs.readFileSync(f,'utf8'));return d.project===project&&d.windowId===windowId});
  const damaged='{"schemaVersion":2,"text":"损坏前内容"';fs.writeFileSync(damagedFile,damaged);
  await input('损坏后的新编辑');await waitFor('document.body.innerText.includes("保留损坏副本并保存当前草稿")');
  assert.equal(fs.readFileSync(damagedFile,'utf8'),damaged);
  await evaluate('(()=>{window.confirm=()=>true;return true})()');await button('保留损坏副本并保存当前草稿');
  await waitFor('document.body.innerText.includes("损坏副本已保留")');assert.equal(JSON.parse(fs.readFileSync(damagedFile,'utf8')).text,'损坏后的新编辑');
  assert.ok(fs.readdirSync(draftDir).filter(n=>n.endsWith('.bak')).some(n=>fs.readFileSync(path.join(draftDir,n),'utf8')===damaged));
  observations.push({id:'D03',status:'PASS',issue:'Real HTTP/UI corrupt-draft protection and explicit exact-byte backup recovery'});
  process.env.DSH_HOME=home;
  const draftHost=await import(require('node:url').pathToFileURL(path.join(repo,'plugin/writing-mode/lib/draft-checkpoints.js')));
  const coordHost=await import(require('node:url').pathToFileURL(path.join(repo,'plugin/writing-mode/lib/coordination.js')));
  const oldLoc=path.join(root,'待迁移旧位置');fs.mkdirSync(oldLoc);fs.writeFileSync(path.join(oldLoc,'project.md'),'test');
  draftHost.writeCheckpoint(oldLoc,'old-window',{baseRev:0,text:'移动前未发送草稿'});
  draftHost.writeCheckpoint(oldLoc+String.fromCharCode(0)+'world','old-window',{baseRev:0,text:JSON.stringify({version:1,drafts:[{id:'moved-draft',title:'移动前的设定编辑',conclusion:'保留移动前文字',dirty:true}]})});
  coordHost.claimCoordination({projectKey:oldLoc,operationToken:'old-location'});coordHost.confirmCoordination({projectKey:oldLoc,operationToken:'old-location',sessionId:'history-session'});
  fs.renameSync(oldLoc,oldLoc+'-moved');await click(evaluate,'查找可恢复编辑');
  await evaluate('Array.from(document.querySelectorAll("[data-world-panel] summary")).find(e=>e.textContent.includes("项目移动后的恢复"))?.click()');
  await waitFor('document.querySelector("[data-world-panel]").innerText.includes("导入旧位置草稿")');
  await click(evaluate,'导入旧位置草稿');await waitFor('document.querySelector("[data-world-notice]").textContent.includes("旧位置草稿已导入")');
  await waitFor('Array.from(document.querySelectorAll("[data-world-panel] button")).some(b=>b.textContent==="恢复这份编辑"&&b.parentElement.textContent.includes("移动前的设定编辑"))');
  await evaluate('Array.from(document.querySelectorAll("[data-world-panel] button")).find(b=>b.textContent==="恢复这份编辑"&&b.parentElement.textContent.includes("移动前的设定编辑")).click()');
  assert.equal(await evaluate('document.querySelector("[data-world-field=conclusion]").value'),'保留移动前文字');
  assert.ok(draftHost.listCheckpoints(project).some(c=>c.text==='移动前未发送草稿'));
  assert.ok(await evaluate('document.querySelector("[data-world-panel]").textContent.includes("查看旧位置会话")'));
  observations.push({id:'D04',status:'PASS',issue:'Real recovery UI imports independent chat/world buckets and exposes historical session without rebinding'});
  win.showInactive();await sleep(250);fs.writeFileSync(path.join(repo,'docs/audits/writing-world-settings/2026-09-21/repair-ui.png'),(await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(repo,'docs/audits/writing-world-settings/2026-09-21/repair-ui-results.json'),JSON.stringify({temp,observations},null,2));console.log('AUDIT_UI_COMPLETE',JSON.stringify(observations));
}).catch(err=>{console.error(err);process.exitCode=1}).finally(async()=>{
 fs.writeFileSync(path.join(temp,'results.json'),JSON.stringify({passed:!process.exitCode,results,failures},null,2))
 if(second&&!second.isDestroyed())second.destroy()
 if(win&&!win.isDestroyed())win.destroy()
 if(kernel&&kernel.exitCode===null)kernel.kill()
 app.exit(process.exitCode||0)
})
`
const m=new Module(__filename,module);m.filename=__filename;m.paths=module.paths;m._compile(fixture,__filename)
