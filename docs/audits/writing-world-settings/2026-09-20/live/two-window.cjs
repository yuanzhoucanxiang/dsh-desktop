// Two real Electron renderers, same real Harness host/home/project. No model calls.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
const repo=path.resolve(__dirname,'../../../../..')
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
  await button('项目备忘');await waitFor('!!document.querySelector("[data-world-panel]")');
  await click(evaluate,'手动新建设定');await field(evaluate,'title','双窗口禁航');await field(evaluate,'conclusion','原始规则');await click(evaluate,'确认设定');await waitFor('document.querySelector("[data-world-notice]").textContent.includes("可读稿已同步")');
  await eval2('Array.from(document.querySelectorAll("button")).find(e=>e.textContent==="项目备忘").click()');await wait2('!!document.querySelector("[data-world-item]")');
  await click(eval2,'编辑设定');await field(eval2,'conclusion','窗口二未保存的修订');await field(evaluate,'conclusion','窗口一先保存的规则');await click(evaluate,'确认修改');await waitFor('document.querySelector("[data-world-notice]").textContent.includes("可读稿已同步")');
  await click(eval2,'确认修改');await wait2('document.querySelector("[data-world-panel]").innerText.includes("保存冲突")');
  assert.equal(memory().items[0].setting.conclusion,'窗口一先保存的规则');assert.equal(await eval2('document.querySelector("[data-world-field=conclusion]").value'),'窗口二未保存的修订');
  results.push('Two real renderers: stale save visibly conflicts, first saved value and second local draft both retained');
  await click(eval2,'已比较，保留本地修订');await click(eval2,'确认修改');await wait2('document.querySelector("[data-world-notice]").textContent.includes("可读稿已同步")');
  assert.equal(memory().items[0].setting.conclusion,'窗口二未保存的修订');assert.ok(memory().changes.some(c=>c.before?.setting?.conclusion==='窗口一先保存的规则'));
  await click(evaluate,'重新读取设定');await waitFor('document.querySelector("[data-world-item]").innerText.includes("窗口二未保存的修订")');
  results.push('Explicit comparison/reconfirmation creates a revision; first window reload sees second saved version and history retains first');
  win.showInactive();second.showInactive();await sleep(250);fs.writeFileSync(path.join(temp,'two-window.png'),(await second.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(temp,'memory.json'),JSON.stringify(memory(),null,2));console.log('WORLD_TWO_WINDOW_OK',temp,JSON.stringify(results));
}).catch(err=>{console.error(err);process.exitCode=1}).finally(async()=>{
 fs.writeFileSync(path.join(temp,'results.json'),JSON.stringify({passed:!process.exitCode,results,failures},null,2))
 if(second&&!second.isDestroyed())second.destroy()
 if(win&&!win.isDestroyed())win.destroy()
 if(kernel&&kernel.exitCode===null)kernel.kill()
 app.exit(process.exitCode||0)
})
`
const m=new Module(__filename,module);m.filename=__filename;m.paths=module.paths;m._compile(fixture,__filename)
