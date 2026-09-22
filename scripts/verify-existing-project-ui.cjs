const fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
const repo=path.resolve(__dirname,'..')
let fixture=fs.readFileSync(path.join(repo,'scripts/verify-writing-native.cjs'),'utf8').replace(/\r\n/g,'\n')
function rep(a,b){if(!fixture.includes(a))throw Error('Missing anchor '+a.slice(0,70));fixture=fixture.replace(a,b)}
rep("const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-writing-native-'))","fs.mkdirSync(path.join(os.tmpdir(),'dsh-preview'),{recursive:true}); const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-preview/existing-project-'))")
rep("const project = path.join(root, '灯塔来信')","const project = path.join(root, '赫尔帝国')")
rep("  fs.mkdirSync(path.dirname(doc), { recursive: true })",String.raw`
  fs.mkdirSync(root,{recursive:true});
  const sourceDirectory=process.env.WM_EXISTING_SOURCE || path.join(temp,'source-fixture');
  if(!process.env.WM_EXISTING_SOURCE){
    const names=['00_设定/设定档案.md','00_设定/设定总汇.md','01_概念设计/01_世界定调.md','10_故事/主线骨架.md',...Array.from({length:9},(_,i)=>'90_笔记/资料'+i+'.md')];
    for(const name of names){const f=path.join(sourceDirectory,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,'# '+(name.includes('设定档案')?'世界观设定档案':path.basename(name,'.md'))+'\n\n隔离测试资料');}
  }
  fs.cpSync(sourceDirectory,project,{recursive:true});
`)
rep("  fs.writeFileSync(doc, '灯塔的影子落在信封上。她没有拆开那封信。')",'')
rep("  fs.writeFileSync(path.join(project, 'project.md'), '作品名：灯塔来信')",'')
rep("roots: [{ path: root, default: true }], activeRoot: root","roots: [], activeRoot: null")
rep("  await waitFor(`!!document.querySelector('.dshWmItem')`)",String.raw`
  await button('打开已有');
  await waitFor('!!document.querySelector("input[aria-label=文件夹路径]")');
  await evaluate('(()=>{const e=document.querySelector("input[aria-label=文件夹路径]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(project)+');e.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await button('打开项目');
  await waitFor('document.querySelectorAll(".dshWmItem").length===13');
  assert.equal(fs.existsSync(path.join(project,'project.md')),false);
  results.push('UI attaches unmodified existing folder and shows all 13 original Markdown documents');
`)
rep(".value.includes('灯塔的影子')",".value.includes('世界观设定档案')")
const cut=fixture.indexOf("  await input('想听听你对她为什么不拆信的看法。')")
fixture=fixture.slice(0,cut)+String.raw`
  const req=(route,body,query='')=>evaluate('fetch("/api/writing-mode?route='+route+query+'",'+JSON.stringify(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})+').then(r=>r.json())');
  await input('资料接入测试，尚未发送');await button('会话设置 ↗');await waitFor('!document.querySelector(".dshWmRoot")');
  await evaluate('document.getElementById("dsh-writing-mode-float").click()');await waitFor('!!document.querySelector(".dshWmChatInput")');
  const first=await req('companion',null,'&path='+encodeURIComponent(path.join(project,'00_设定/设定档案.md')));
  await evaluate('Array.from(document.querySelectorAll(".dshWmItem")).find(e=>e.title==="10_故事/主线骨架.md").click()');
  await waitFor('document.querySelector(".dshWmEditor")?.value.includes("主线骨架")');
  const second=await req('companion',null,'&path='+encodeURIComponent(path.join(project,'10_故事/主线骨架.md')));
  assert.equal(first.project,project);assert.equal(second.project,project);assert.equal(second.sessionId,first.sessionId);assert.ok(first.sessionId);
  results.push('Different source folders share the same real native companion session');
  const memory=await req('memory',null,'&path='+encodeURIComponent(path.join(project,'10_故事/主线骨架.md')));
  assert.equal(memory.ok,true);assert.equal(fs.existsSync(path.join(project,'state/writing-memory.json')),false);
  results.push('Memory resolves to the project without creating confirmed facts or changing files');
  assert.equal((await req('prefs',{fontSize:18})).ok,true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home,'writing-mode.json'))).roots[0].kind,'project');
  const invalid=await req('roots',{mode:'add',kind:'project',path:path.join(temp,'missing')});assert.equal(invalid.ok,false);
  const invalidFile=await req('roots',{mode:'add',kind:'project',path:path.join(project,'00_设定/设定档案.md')});assert.equal(invalidFile.ok,false);
  await win.webContents.reload();await waitFor('!!document.getElementById("dsh-writing-mode-float")');
  await evaluate('if(!document.querySelector(".dshWmRoot"))document.getElementById("dsh-writing-mode-float").click()');
  await waitFor('document.querySelectorAll(".dshWmItem").length===13');
  await evaluate('Array.from(document.querySelectorAll(".dshWmItem")).find(e=>e.title==="01_概念设计/01_世界定调.md").click()');
  await waitFor('document.querySelector(".dshWmEditor")?.value.includes("世界定调")');
  await button('稍后配置');await sleep(300);await button('稍后配置');
  await sleep(1500);
  await waitFor('!!document.getElementById("dsh-writing-mode-float")');
  await evaluate('if(!document.querySelector(".dshWmRoot"))document.getElementById("dsh-writing-mode-float").click()');
  await waitFor('document.querySelectorAll(".dshWmItem").length===13');
  await evaluate('Array.from(document.querySelectorAll(".dshWmItem")).find(e=>e.title==="01_概念设计/01_世界定调.md").click()');
  await waitFor('document.querySelector(".dshWmEditor")?.value.includes("世界定调")');
  results.push('Configuration survives preference update and renderer restart; missing directories and file paths rejected');
  const crypto=require('node:crypto');const hashes=[];
  for(const rel of fs.readdirSync(sourceDirectory,{recursive:true}).filter(x=>x.endsWith('.md'))){const a=fs.readFileSync(path.join(sourceDirectory,rel)),b=fs.readFileSync(path.join(project,rel));assert.deepEqual(a,b);hashes.push({path:rel,sha256:crypto.createHash('sha256').update(a).digest('hex')})}
  results.push('13/13 original source copies remain byte-identical after opening and switching documents');
  if(process.env.WM_KEEP_PREVIEW==='1'){win.show();win.setTitle('已有项目接入 · 赫尔帝国 · 独立测试版');}
  await sleep(300);
  fs.writeFileSync(path.join(temp,'existing-project.png'),(await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(temp,'preview.json'),JSON.stringify({pid:process.pid,base:temp,home,project,port,sourceDirectory,keptRunning:process.env.WM_KEEP_PREVIEW==='1',results,hashes},null,2));
  console.log('EXISTING_UI_OK',JSON.stringify(results),temp);
}).catch(err=>{console.error(err);process.exitCode=1}).finally(()=>{
 fs.writeFileSync(path.join(temp,'kernel.log'),kernelOutput);fs.writeFileSync(path.join(temp,'results.json'),JSON.stringify({passed:!process.exitCode,results,failures},null,2));
 if(process.env.WM_KEEP_PREVIEW==='1'&&win&&!win.isDestroyed()){win.show();win.on('closed',()=>{if(kernel&&kernel.exitCode===null)kernel.kill();app.quit()})}
 else {if(win&&!win.isDestroyed())win.destroy();if(kernel&&kernel.exitCode===null)kernel.kill();app.exit(process.exitCode||0)}
});
`
const m=new Module(__filename,module);m.filename=__filename;m.paths=module.paths;m._compile(fixture,__filename)
