import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { quarantineStaleLock, withFileLock } from '../../../../plugin/writing-mode/lib/file-lock.js'
import { relocationCandidates, recoverRelocation } from '../../../../plugin/writing-mode/lib/project-recovery.js'
import { writeCheckpoint, readCheckpoint, listCheckpoints } from '../../../../plugin/writing-mode/lib/draft-checkpoints.js'
const base=fs.mkdtempSync(path.join(os.tmpdir(),'codex-handoff-review-'))
process.env.DSH_HOME=path.join(base,'home')
const results=[]
// Deterministic scheduler seam: pause sweeper B immediately before rename.
// Sweeper A removes the dead lock, then writer W acquires it before B resumes.
const file=path.join(base,'record.json'),lock=file+'.lock'
let dead=2147483646
assert.throws(()=>process.kill(dead,0))
fs.writeFileSync(lock,dead+':dead-owner')
const rename=fs.renameSync
let entered=0,overlap=false,movedOwner=null
fs.renameSync=function(from,to){
  if(from!==lock)return rename(from,to)
  fs.unlinkSync(lock) // the earlier sweeper completed
  return withFileLock(file,()=>{
    entered++
    const result=rename(from,to) // later sweeper moves the NEW live lock
    movedOwner=fs.readFileSync(to,'utf8')
    withFileLock(file,()=>{overlap=entered===1})
    entered--
    return result
  })
}
let quarantined
try {quarantined=quarantineStaleLock(file)}finally{fs.renameSync=rename}
assert.ok(quarantined);assert.ok(overlap);assert.ok(movedOwner.startsWith(process.pid+':'))
results.push({id:'CXR01',status:'REPRODUCED',overlap,movedLiveOwner:true,method:'deterministic scheduling seam immediately before rename, no production source edits'})

const old=path.join(base,'作品A'),target=path.join(base,'作品B')
fs.mkdirSync(path.join(old,'draft'),{recursive:true});fs.mkdirSync(path.join(target,'draft'),{recursive:true})
fs.writeFileSync(path.join(old,'draft','第一章.md'),'完全不同的A');fs.writeFileSync(path.join(target,'draft','第一章.md'),'完全不同的B')
writeCheckpoint(old,'writer',{baseRev:0,text:'A的秘密草稿',reference:{path:path.join(old,'draft','第一章.md'),text:'完全不同的A'}})
fs.renameSync(old,old+'-moved')
const candidate=relocationCandidates(target).find(c=>c.oldPath===old)
assert.equal(candidate.importable,true);assert.equal(candidate.relation,'manuscript-reference')
const imported=recoverRelocation(target,old,candidate.token)
assert.ok(listCheckpoints(target).some(c=>c.text==='A的秘密草稿'))
results.push({id:'CXR02',status:'REPRODUCED',relation:candidate.relation,importable:candidate.importable,copied:imported.copied,explicitUnrelatedConfirmation:false})

const p=path.join(base,'trailing')+path.sep,w='legacy-window'
const oldKey=createHash('sha256').update(p.replace(/\\/g,'/').toLowerCase()+'\n'+w).digest('hex').slice(0,32)
fs.writeFileSync(path.join(process.env.DSH_HOME,'writing-mode/drafts',oldKey+'.json'),JSON.stringify({schemaVersion:2,project:p,windowId:w,text:'legacy tail slash',reference:null,rev:1,updatedAt:new Date().toISOString()}))
const listed=listCheckpoints(p).some(c=>c.windowId===w),loaded=readCheckpoint(p,w)
assert.ok(listed);assert.equal(loaded.text,'legacy tail slash')
results.push({id:'CXR03',status:'NOT_REPRODUCED',listed,legacyBucket:loaded.legacyBucket,issue:'legacy trailing-separator bucket remains readable'})
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'handoff-probes-results.json'),JSON.stringify({base,results},null,2))
console.log(JSON.stringify({base,results},null,2))
