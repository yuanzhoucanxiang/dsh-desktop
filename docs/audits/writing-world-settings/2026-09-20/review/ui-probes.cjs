const fs=require('fs'),path=require('path'),Module=require('module');const repo=process.cwd();
let fixture=fs.readFileSync(path.join(repo,'scripts/verify-writing-chat.cjs'),'utf8').replace(/\r\n/g,'\n');
const cut=fixture.indexOf("  await input('.dshWmChatInput', '她为什么不拆信？')");if(cut<0)throw Error('fixture changed');
fixture=fixture.slice(0,cut)+String.raw`
  await button('项目备忘');
  await waitFor("!!document.querySelector('.dshWmWorldPanel')");
  const result=await evaluate("(()=>{const p=document.querySelector('.dshWmWorldPanel');return {html:p.outerHTML,text:p.textContent,buttons:p.querySelectorAll('button').length,children:p.childElementCount}})()");
  const evidence={id:'A02-empty-world-panel',status:result.buttons===0?'REPRODUCED':'NOT_REPRODUCED',result,errors};
  fs.writeFileSync(path.join(repo,'docs/audits/writing-world-settings/2026-09-20/review/ui-results.json'),JSON.stringify(evidence,null,2));
  fs.writeFileSync(path.join(repo,'docs/audits/writing-world-settings/2026-09-20/review/empty-panel.png'),(await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify(evidence));
}).catch(err=>{console.error(err);process.exitCode=1}).finally(async()=>{if(win&&!win.isDestroyed())win.destroy();if(server)await new Promise(r=>server.close(r));app.exit(process.exitCode||0)});
`;
const m=new Module(path.join(repo,'scripts/world-independent-ui.cjs'),module);m.filename=path.join(repo,'scripts/world-independent-ui.cjs');m.paths=Module._nodeModulePaths(path.join(repo,'scripts'));m._compile(fixture,m.filename);