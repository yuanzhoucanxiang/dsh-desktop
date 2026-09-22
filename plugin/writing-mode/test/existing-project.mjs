import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { writeConfig, readConfig, effectiveRoots, scanTree, findProjectRoot, resolveProjectDir } from '../lib/store.js'
import { groupFiles } from '../src/client/features/library/grouping.js'
const base=fs.mkdtempSync(path.join(os.tmpdir(),'wm-existing-test-'))
process.env.DSH_HOME=path.join(base,'home')
const project=path.join(base,'作品'),outside=path.join(base,'outside')
for(const dir of ['00_设定','01_概念设计/地区甲','01_概念设计/地区乙','10_故事','.private','node_modules'])fs.mkdirSync(path.join(project,dir),{recursive:true})
for(const file of ['00_设定/档案.md','01_概念设计/地区甲/地点.md','01_概念设计/地区乙/地点.md','10_故事/主线.md','.private/secret.md','node_modules/hidden.md'])fs.writeFileSync(path.join(project,file),'原始材料')
fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'outside.md'),'不得进入')
fs.symlinkSync(outside,path.join(project,'越界'),process.platform==='win32'?'junction':'dir')
writeConfig({roots:[{path:project,kind:'project',label:'原作品'}],activeRoot:project})
let cfg=readConfig(),tree=scanTree(cfg)
assert.equal(cfg.roots[0].kind,'project');assert.equal(tree[0].projects.length,1)
const files=tree[0].projects[0].files
assert.equal(files.length,4);assert.ok(files.every(f=>!f.abs.includes('outside')))
assert.equal(fs.existsSync(path.join(project,'project.md')),false)
assert.equal(fs.existsSync(path.join(project,'state')),false)
console.log('PASS explicit attach persists without writing project marker/memory; custom folders visible; hidden/dependency/junction excluded')
for(const f of files){assert.equal(findProjectRoot(f.abs),project);assert.equal(resolveProjectDir(f.abs,effectiveRoots(cfg)),project)}
assert.equal(findProjectRoot(project),project);assert.equal(resolveProjectDir(project,effectiveRoots(cfg)),project)
assert.equal(resolveProjectDir(path.join(project,'越界/outside.md'),effectiveRoots(cfg)),null)
console.log('PASS root and all nested documents share canonical project; escaped path refused')
assert.deepEqual(groupFiles(files,'').filter(g=>g.key.includes('地区')).map(g=>g.key),['01_概念设计/地区甲','01_概念设计/地区乙'])
console.log('PASS same filenames in separate folders retain their complete directory labels')
const child=path.join(project,'01_概念设计');cfg.roots.push({path:child,kind:'project',label:'独立子项目'});writeConfig(cfg)
assert.equal(resolveProjectDir(path.join(child,'地区甲/地点.md'),effectiveRoots(readConfig())),child)
console.log('PASS explicitly attached nested project uses most specific root')
writeConfig({roots:[{path:project,kind:'library'}]});assert.equal(scanTree(readConfig())[0].projects.length,0)
console.log('PASS ordinary library mode does not silently promote folders into projects')
writeConfig({roots:[{path:project,kind:'project'}]});let deep=project;for(let i=0;i<14;i++){deep=path.join(deep,'deep');fs.mkdirSync(deep)}fs.writeFileSync(path.join(deep,'long.md'),'深层')
assert.ok(scanTree(readConfig())[0].projects[0].scanWarning)
console.log('PASS depth limit is reported, not silently treated as complete')
console.log('EXISTING_PROJECT_OK 6/6',base)
