const fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
let s=fs.readFileSync(path.join(__dirname,'ui-probes.cjs'),'utf8')
const anchor='return fetchOriginal(url,opts);'
if(!s.includes(anchor))throw Error('fetch anchor missing')
s=s.replace(anchor,String.raw`
      const response=await fetchOriginal(url,opts);
      if(new URL(url,location.href).searchParams.get('route')==='draft'&&opts?.method==='POST'&&JSON.parse(opts.body).windowId.includes('-before-adopt-')&&testChat.holdStash){
        testChat.holdStash=false;return new Promise(resolve=>{testChat.releaseStash=()=>resolve(response)});
      }
      return response;
`)
const cut=s.indexOf('const cut=fixture.indexOf(')
if(cut<0)throw Error('bootstrap anchor missing')
s=s.slice(0,cut)+[
  'const cut=fixture.indexOf("  await input(\'.dshWmChatInput\', \'她为什么不拆信？\')")',
  'if(cut<0)throw Error("fixture cut missing")',
  'fixture=fixture.slice(0,cut)+fs.readFileSync(path.join(__dirname,"adopt-race-body.txt"),"utf8")',
  'const m=new Module(__filename,module);m.filename=__filename;m.paths=module.paths;m._compile(fixture,__filename)'
].join('\n')
const m=new Module(__filename,module);m.filename=__filename;m.paths=module.paths;m._compile(s,__filename)
