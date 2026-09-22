const fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
let source=fs.readFileSync(path.join(__dirname,'verify-writing-ui.cjs'),'utf8').replace(/\r\n/g,'\n')
source=source.replace("const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-writing-ui-'))","fs.mkdirSync(path.join(os.tmpdir(),'dsh-preview'),{recursive:true}); const temp = fs.mkdtempSync(path.join(os.tmpdir(),'dsh-preview/writing-navigation-'))")
source=source.replace("  let handler", "  const templates = await import(pathToFileURL(path.join(repo, 'plugin/writing-mode/lib/templates.js')))\n  for(const f of templates.renderTemplate('novel','演示项目','').files){if(f.rel.endsWith('.gitkeep'))continue;const dest=path.join(project,f.rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,f.body)}\n  let handler")
source=source.replace('.length===3', '.length===11')
source=source.replace("  await sleep(250)", `
  const summaries=await evaluate('Array.from(document.querySelectorAll(".dshWmProj summary")).map(e=>e.textContent)');
  assert(summaries.includes('人物'));assert(summaries.includes('世界与设定'));
  assert.equal(await evaluate('Array.from(document.querySelectorAll("details")).find(e=>e.querySelector("summary")?.textContent==="人物").open'),false);
  await input('.dshWmSearch','人物档案');
  await waitFor('Array.from(document.querySelectorAll(".dshWmItemTitle")).some(e=>e.textContent==="人物档案")');
  await input('.dshWmSearch','');
  await button('文件视图');
  assert(await evaluate('Array.from(document.querySelectorAll(".dshWmItemTitle")).some(e=>e.textContent==="characters.md")'));
  await button('作品导航');
  console.log('NAVIGATION_OK Chinese labels, collapsed materials, search and raw view');
  await button('新建项目');
  await input('input[placeholder="项目名"]','轻量新故事');
  await input('input[placeholder="一句话前提"]','一封尚未寄出的信');
  await button('创建');
  await waitFor('document.querySelector(".dshWmEditor")?.value.includes("一封尚未寄出的信")');
  const starterPath=path.join(root,'轻量新故事');
  assert.equal(fs.existsSync(path.join(starterPath,'bible')),false);
  assert.equal(fs.existsSync(path.join(starterPath,'draft/novel/第1章-v1.md')),true);
  await evaluate('(()=>{const p=Array.from(document.querySelectorAll(".dshWmProj")).find(e=>e.querySelector(".dshWmProjToggle")?.textContent.includes("轻量新故事"));const s=p.querySelector("select[aria-label=按需添加资料]");s.value="bible/characters.md";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await waitFor('document.querySelector(".dshWmDocName")?.textContent.includes("characters")');
  assert.equal(fs.existsSync(path.join(starterPath,'bible/characters.md')),true);
  assert.equal(fs.existsSync(path.join(starterPath,'bible/world.md')),false);
  console.log('STARTER_UI_OK new project opens overview; one resource added without generating others');
  if(process.env.WM_KEEP_PREVIEW==='1'){win.setTitle('轻量新项目 · 隔离预览');win.show()}
  await sleep(250)`)
source=source.replace("  if (win && !win.isDestroyed()) win.destroy()", "  if(process.env.WM_KEEP_PREVIEW==='1'&&!process.exitCode){win.on('closed',()=>{server.close();app.quit()});return}\n  if (win && !win.isDestroyed()) win.destroy()")
const m=new Module(__filename,module);m.filename=__filename;m.paths=module.paths;m._compile(source,__filename)
