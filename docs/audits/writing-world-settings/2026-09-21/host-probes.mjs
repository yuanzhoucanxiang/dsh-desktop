import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { writeCheckpoint, readCheckpoint, listCheckpoints } from '../../../../plugin/writing-mode/lib/draft-checkpoints.js'
import { readMemory, applyMemoryOp, emptyEtag } from '../../../../plugin/writing-mode/lib/project-memory.js'
import { recordPath, claimCoordination, confirmCoordination, readCoordination } from '../../../../plugin/writing-mode/lib/coordination.js'
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wm-audit-0921-'))
process.env.DSH_HOME=path.join(temp,'home')
const project=path.join(temp,'before');fs.mkdirSync(project,{recursive:true});fs.writeFileSync(path.join(project,'project.md'),'Audit')
const observations=[]
writeCheckpoint(project,'corrupt',{baseRev:0,text:'original draft'})
const dir=path.join(process.env.DSH_HOME,'writing-mode/drafts')
const file=path.join(dir,fs.readdirSync(dir)[0]);fs.writeFileSync(file,'{"schemaVersion":2,"text":"original draft"')
assert.equal(readCheckpoint(project,'corrupt'),null)
const write=writeCheckpoint(project,'corrupt',{baseRev:0,text:'new draft'})
assert.equal(write.checkpoint.text,'new draft')
observations.push({id:'D03',status:'REPRODUCED',issue:'Corrupt checkpoint read returns null; baseRev=0 overwrites damaged original without backup',file,remainingFiles:fs.readdirSync(dir)})
writeCheckpoint(project,'move',{baseRev:0,text:'unsent before move'})
applyMemoryOp(project,{op:'confirm-setting',baseRevision:0,baseEtag:emptyEtag(),operationId:'move-test',clientSchemaVersion:2,item:{kind:'fact',setting:{title:'rule',conclusion:'saved rule'}}})
claimCoordination({projectKey:project,operationToken:'move-session'})
confirmCoordination({projectKey:project,operationToken:'move-session',sessionId:'session-before-move'})
const oldRecord=readCoordination(project)
const moved=path.join(temp,'after');fs.renameSync(project,moved)
assert.equal(readMemory(moved).memory.items[0].setting.conclusion,'saved rule')
assert.equal(listCheckpoints(moved).length,0)
assert.equal(readCheckpoint(moved,'move'),null)
assert.ok(fs.existsSync(recordPath(project)))
const newRecord=readCoordination(moved)
observations.push({id:'D04',status:'REPRODUCED',issue:'Project directory move preserves memory but disconnects path-keyed checkpoints and session coordination; old files still exist',memoryPreserved:true,oldDrafts:listCheckpoints(project).length,newDrafts:listCheckpoints(moved).length,oldSession:oldRecord.sessionId,newSession:newRecord.sessionId})
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'host-results.json'),JSON.stringify({temp,observations},null,2))
console.log(JSON.stringify(observations,null,2))
