const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),z=require('node:zlib')
const meta=JSON.parse(fs.readFileSync(path.join(__dirname,'preview.json'),'utf8'))
const rows=[]
for(const rel of fs.readdirSync(meta.source,{recursive:true}).filter(x=>x.endsWith('.md'))){
  const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
  rows.push({path:rel,sourceHash:hash(path.join(meta.source,rel)),copyHash:hash(path.join(meta.project,rel))})
}
const dir=path.join(meta.home,'sessions'),calls=[],toolResults=[]
for(const rel of fs.readdirSync(dir,{recursive:true}).filter(x=>x.endsWith('.zstd'))){
  const buf=fs.readFileSync(path.join(dir,rel));let offset=0,out=''
  while(offset<buf.length){const r=z.zstdDecompressSync(buf.subarray(offset),{info:true});out+=r.buffer.toString();if(!r.engine.bytesWritten)throw Error('Decoder stalled');offset+=r.engine.bytesWritten}
  for(const line of out.split('\n').filter(Boolean)){
    const event=JSON.parse(line),block=event.data?.chunk?.block
    if(event.type==='assistant/chunk'&&event.data?.chunk?.type==='block-end'&&block?.type==='tool-call')calls.push({id:block.id,name:block.name,args:JSON.parse(block.arguments)})
    if(event.type==='tool/result')for(const part of event.data.message.content||[])if(part.type==='tool-result')toolResults.push({id:part.toolCallId,isError:part.isError===true,preview:(part.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n').slice(0,450)})
  }
}
const evidence={createdAt:new Date().toISOString(),originalFiles:rows,allCopiesUnchanged:rows.every(x=>x.sourceHash===x.copyHash),calls,toolResults,memoryCreated:fs.existsSync(path.join(meta.project,'state/writing-memory.json'))}
fs.writeFileSync(path.join(__dirname,'evidence.json'),JSON.stringify(evidence,null,2))
const transcript=JSON.parse(fs.readFileSync(path.join(meta.base,'transcript.json'),'utf8'))
let text='# 赫尔帝国资料试用 · 两轮真实对话\n\n'
for(const turn of transcript){text+='## 提问\n\n'+turn.question+'\n\n## 最终回复\n\n'+turn.state.messages.filter(x=>x.kind.includes('is-assistant')).at(-1).text+'\n\n'}
fs.writeFileSync(path.join(__dirname,'conversation.md'),text)
console.log(JSON.stringify({files:rows.length,allCopiesUnchanged:evidence.allCopiesUnchanged,calls:calls.map(x=>x.name),toolErrors:toolResults.filter(x=>x.isError).length,memoryCreated:evidence.memoryCreated},null,2))
