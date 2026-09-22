const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module')
const repo=path.resolve(__dirname,'../../../../..')
const source='E:/BaiduNetdiskDownload/剧本创作'
let fixture=fs.readFileSync(path.join(repo,'scripts/verify-writing-native.cjs'),'utf8').replace(/\r\n/g,'\n')
function replace(a,b){if(!fixture.includes(a))throw Error('Missing bootstrap anchor: '+a.slice(0,70));fixture=fixture.replace(a,b)}
replace("const repo = path.resolve(__dirname, '..')",`const repo=${JSON.stringify(repo)}`)
replace("const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-writing-native-'))","fs.mkdirSync(path.join(os.tmpdir(),'dsh-preview'),{recursive:true}); const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-preview/hel-material-trial-'))")
replace("const project = path.join(root, '灯塔来信')","const project = path.join(root, '赫尔帝国')")
replace("  fs.writeFileSync(doc, '灯塔的影子落在信封上。她没有拆开那封信。')",`  fs.cpSync(${JSON.stringify(source)},project,{recursive:true}); fs.writeFileSync(doc,'赫尔帝国资料试用：原目录保留。此页只是测试入口，不是作品正文。')`)
replace("fs.writeFileSync(path.join(project, 'project.md'), '作品名：灯塔来信')","fs.writeFileSync(path.join(project, 'project.md'), '# 赫尔帝国资料试用\\n这是隔离副本。资料在00_设定、01_概念设计、10_故事、90_笔记。不要修改文件。来源效力与冲突应根据原文判断，不擅自确认。')")
replace(".value.includes('灯塔的影子')",".value.includes('赫尔帝国')")
const credStart=fs.readFileSync(path.join(repo,'docs/audits/writing-world-settings/2026-09-20/live/run.cjs'),'utf8')
// Reuse the already-reviewed credential bootstrap; secrets remain in child environment.
const injected=credStart.slice(credStart.indexOf("replace('  const patch = path.join(temp,', `")+"replace('  const patch = path.join(temp,', `".length,credStart.indexOf("`)\nreplace('env:"))
if(!injected.includes('const key ='))throw Error('Credential bootstrap anchor changed')
replace('  const patch = path.join(temp,',injected)
replace('env: { ...process.env, DSH_HOME: home }','env: { ...process.env, DSH_HOME: home, DEEPSEEK_API_KEY: key }')
replace("  await waitFor(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='稍后配置')`)\n  await button('稍后配置')","  await sleep(300); await button('稍后配置')")
replace('show: false','show: true')
const cut=fixture.indexOf("  await input('想听听你对她为什么不拆信的看法。')")
fixture=fixture.slice(0,cut)+String.raw`
  win.setTitle('赫尔帝国 · 隔离资料试用（请自行关窗）');
  const meta={pid:process.pid,kernelPid:kernel.pid,base:temp,project,home,port,source:'E:/BaiduNetdiskDownload/剧本创作',keptRunning:true};
  fs.writeFileSync(path.join(temp,'preview.json'),JSON.stringify(meta,null,2));
  fs.writeFileSync(path.join(repo,'docs/audits/writing-world-settings/2026-09-21/hel-trial/preview.json'),JSON.stringify(meta,null,2));
  console.log('PREVIEW_READY',temp);
  const transcript=[];
  async function turn(text){
    const before=await evaluate('document.querySelectorAll(".dshWmMessage.is-assistant").length');
    await input(text);await evaluate('document.querySelector(".dshWmSend").click()');
    const end=Date.now()+300000;let state;
    while(Date.now()<end){
      state=await evaluate('({messages:Array.from(document.querySelectorAll(".dshWmMessage")).map(e=>({kind:e.className,text:e.querySelector(".dshWmMessageText")?.innerText})),running:Array.from(document.querySelectorAll(".dshWmCompanion button")).some(e=>e.textContent==="停止"),errors:Array.from(document.querySelectorAll(".dshWmCompanionError")).map(e=>e.innerText)})');
      fs.writeFileSync(path.join(temp,'progress.json'),JSON.stringify(state,null,2));
      if(state.errors.length||state.messages.some(e=>e.kind.includes('is-error')))break;
      if(state.messages.filter(e=>e.kind.includes('is-assistant')).length>before&&!state.running){await sleep(800);break}
      await sleep(700);
    }
    transcript.push({question:text,state});fs.writeFileSync(path.join(temp,'transcript.json'),JSON.stringify(transcript,null,2));
    assert.equal(state.errors.length,0,JSON.stringify(state.errors));assert.ok(!state.running,'Model timeout');
    const answer=state.messages.filter(e=>e.kind.includes('is-assistant')).at(-1)?.text;assert.ok(answer);console.log('LIVE_RESPONSE',answer);return answer;
  }
  await turn('请实际使用读取工具查阅当前项目里的 00_设定/设定档案.md、00_设定/设定总汇.md、10_故事/主线骨架.md、90_笔记/Claude试稿(非正文).md。不要修改任何文件，不要写正文。这是一次资料协作试用：1. 洛宾为什么天赋出众却仍未封爵？档案中的早期经历与后来的修订应采用哪版？2. 格里夫能直接当成我已确认的正式角色吗？试稿能当成我的正文吗？3. 维尔斯是否知道启蒙者的最终命运？作者层面的真相能否直接写进他的内心？每题引用具体文件和原文短句，分清已经确定、尚未确定、你自己的推断。若不能读文件，请明说，别猜。');
  await turn('现在先只陪我推敲洛宾：不替我拍板、不写正文，提两个相互不同的“有功却未封爵”的可能解释，再指出每个会给他和维尔斯的关系带来什么变化。必须标为本轮新建议，不把建议说成档案已有事实。简短一点。');
  fs.writeFileSync(path.join(temp,'trial.png'),(await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(temp,'results.json'),JSON.stringify({completed:true,results,failures},null,2));
  console.log('TRIAL_COMPLETE',temp);
}).catch(err=>{console.error(err);fs.writeFileSync(path.join(temp,'trial-error.txt'),String(err));}).finally(()=>{
  fs.writeFileSync(path.join(temp,'kernel.log'),kernelOutput);
  // Visible trial remains alive. Only close its own kernel after the user closes its window.
  if(win&&!win.isDestroyed())win.on('closed',()=>{if(kernel&&kernel.exitCode===null)kernel.kill();app.quit()});
});
`
const m=new Module(__filename,module);m.filename=__filename;m.paths=module.paths;m._compile(fixture,__filename)
