// Real built client + React + writing host; fixture replaces only native chat.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
const repo=path.resolve(__dirname,'..')
let fixture=fs.readFileSync(path.join(__dirname,'verify-writing-chat.cjs'),'utf8').replace(/\r\n/g,'\n')
const cut=fixture.indexOf("  await input('.dshWmChatInput', '她为什么不拆信？')")
if(cut<0)throw Error('Reading test bootstrap changed')
fixture=fixture.slice(0,cut)+String.raw`
  const results=[]
  const markdown='# 灯塔停电以后\n\n**先听声音**，再看见暗。\n\n> 她还没决定拆开那封信。\n\n- 风声\n- 海浪\n\n[参考资料](https://example.org/story)\n\n| 状态 | 内容 |\n| --- | --- |\n| 已确认 | 灯塔停电 |\n\n'+'~~~text\n'+('long_unbroken_line_'.repeat(35))+'\n~~~\n\n[坏链接](javascript:alert(1))\n\n[文件](file:///C:/private.txt)\n\n<img src="https://example.invalid/raw.png" onerror="window.readingAttack=1">\n\n![参考图片](https://example.invalid/picture.png)'
  const externalRequests=[]
  win.webContents.session.webRequest.onBeforeRequest({urls:['https://example.invalid/*']},(details,callback)=>{externalRequests.push(details.url);callback({cancel:true})})
  async function showText(text,running=false){
    await evaluate('testChat.set({chat:{order:["author","answer"],nodes:new Map([["author",{kind:"user",data:{content:[{type:"text",text:"作者原文：**不要改动**"}]}}],["answer",{kind:"assistant-step",data:{blocks:[{kind:"text",text:'+JSON.stringify(text)+'}]}}]])},running:'+running+',pending:[],queue:[]})')
    await waitFor("!!document.querySelector('.dshWmMarkdown')")
  }
  await showText('先听见 **风',true)
  assert.ok(await evaluate("document.querySelector('.dshWmMarkdown').innerText.includes('先听见')"))
  await showText(markdown)
  await waitFor("!!document.querySelector('.dshWmMarkdown table')")
  const dom=await evaluate("(()=>{const el=document.querySelector('.dshWmMarkdown');return {strong:el.querySelector('strong')?.textContent,quote:el.querySelector('blockquote')?.textContent,list:el.querySelectorAll('li').length,table:el.querySelectorAll('tbody tr').length,code:el.querySelector('pre code')?.textContent,links:Array.from(el.querySelectorAll('a')).map(a=>({href:a.getAttribute('href'),target:a.target,rel:a.rel})),images:el.querySelectorAll('img').length,scripts:el.querySelectorAll('script').length,attack:!!window.readingAttack,author:document.querySelector('.is-user .dshWmMessageText').textContent}})()")
  assert.equal(dom.strong,'先听声音');assert.ok(dom.quote.includes('她还没决定'));assert.equal(dom.list,2);assert.equal(dom.table,1)
  assert.ok(dom.code.includes('long_unbroken_line_'));assert.equal(dom.author,'作者原文：**不要改动**')
  assert.ok(dom.links.every(l=>/^https?:\/\//.test(l.href)&&l.target==='_blank'&&l.rel.includes('noopener')))
  assert.equal(dom.images,0);assert.equal(dom.scripts,0);assert.equal(dom.attack,false);assert.equal(externalRequests.length,0)
  results.push({id:'markdown-and-streaming',status:'PASS',dom})
  await evaluate("document.querySelector('[data-wm-candidate]').click()")
  await waitFor("!!document.querySelector('[data-wm-memory-save=candidate]')")
  assert.equal(await evaluate("document.querySelector('.dshWmMemoryCompose textarea').value"),markdown)
  await input('.dshWmMemoryCompose textarea',markdown+'\n\n作者补充：暂不定稿。')
  await waitFor("document.querySelector('[data-wm-memory-save=candidate]')?.disabled===false")
  await button('存为候选')
  await waitFor("!!document.querySelector('[data-status=proposed]')")
  const item=JSON.parse(fs.readFileSync(path.join(project,'state/writing-memory.json'),'utf8')).items[0]
  assert.equal(item.text,markdown+'\n\n作者补充：暂不定稿。')
  assert.equal(item.source.kind,'assistant')
  await button('收起备忘')
  results.push({id:'candidate-uses-original-markdown',status:'PASS'})
  const geometry=[]
  for(const width of [1500,1280,980]){
    win.setContentSize(width,900);await sleep(200)
    const g=await evaluate("(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,bottom:r.bottom}};const side=document.querySelector('.dshWmSide.is-ai');return {viewport:innerWidth,side:rect('.dshWmSide.is-ai'),compose:rect('.dshWmCompose'),message:rect('.dshWmMarkdown'),scrollWidth:side.scrollWidth,clientWidth:side.clientWidth}})()")
    assert.ok(g.side.right<=g.viewport+1&&g.compose.left>=g.side.left&&g.compose.right<=g.side.right+1,JSON.stringify(g))
    assert.ok(g.message.right<=g.side.right+1&&g.scrollWidth<=g.clientWidth+1,JSON.stringify(g))
    geometry.push(g)
    await evaluate("document.querySelector('.dshWmConversation').scrollTop=0")
    fs.writeFileSync(path.join(temp,'reading-'+width+'.png'),(await win.webContents.capturePage()).toPNG())
  }
  // Long history with a new streaming tail: no clipping and no loss of old text.
  await evaluate('testChat.set({chat:{order:Array.from({length:100},(_,i)=>"m"+i),nodes:new Map(Array.from({length:100},(_,i)=>["m"+i,{kind:"assistant-step",data:{blocks:[{kind:"text",text:"第 "+i+" 轮：**灯塔**\\n\\n"+"一段关于风和海的讨论。".repeat(30)}]}}]))},running:false,pending:[],queue:[]})')
  await waitFor("document.querySelectorAll('.dshWmMarkdown').length>0")
  await sleep(300)
  assert.ok(await evaluate("document.querySelector('.dshWmConversation').scrollHeight>document.querySelector('.dshWmConversation').clientHeight"))
  results.push({id:'narrow-column-and-long-history',status:'PASS',geometry})
  assert.equal(errors.length,0,errors.join('\n'))
  fs.writeFileSync(path.join(temp,'reading-results.json'),JSON.stringify({results,externalRequests},null,2))
  console.log('WRITING_READING_OK',temp,JSON.stringify(results))
}).catch(err=>{console.error(err);process.exitCode=1}).finally(async()=>{
 if(win&&!win.isDestroyed())win.destroy()
 if(server)await new Promise(resolve=>server.close(resolve))
 app.exit(process.exitCode||0)
})
`
const m=new Module(__filename,module);m.filename=__filename;m.paths=module.paths;m._compile(fixture,__filename)
