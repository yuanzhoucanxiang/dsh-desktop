const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto')
const repo=path.resolve(__dirname,'../../../../..')
const sha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim()
const pkg=path.join(os.tmpdir(),'wm-v2-release-0.1.39')
const hash=b=>crypto.createHash('sha256').update(b).digest('hex')
const files=['plugin/writing-mode/client.js']
const lineEnding=files.map(file=>{
  const work=fs.readFileSync(path.join(repo,file))
  const git=cp.execFileSync('git',['-c','core.autocrlf=true','cat-file','--filters','HEAD:'+file],{cwd:repo,maxBuffer:4e6})
  const packed=fs.readFileSync(path.join(pkg,'win-unpacked/resources',file))
  return {file,checkoutWithAutocrlfEqualsWork:git.equals(work),workEqualsPackage:work.equals(packed),sha256:hash(work)}
})
const missing=cp.spawnSync(process.execPath,['scripts/verify-writing-packaged.mjs','--json'],{cwd:repo,encoding:'utf8',env:{...process.env,WM_PKG:path.join(os.tmpdir(),'wm-missing-'+crypto.randomUUID())}})
const packageCheck=cp.spawnSync(process.execPath,['scripts/verify-writing-package.mjs','--package',pkg,'--json'],{cwd:repo,encoding:'utf8',env:{...process.env,DSH_HOME:path.join(os.tmpdir(),'wm-no-profile-'+crypto.randomUUID())}})
fs.writeFileSync(path.join(__dirname,'package-after.json'),packageCheck.stdout)
const result={sha,dirty:cp.execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim().split('\n'),releaseTag:cp.execFileSync('git',['rev-parse','v0.1.39^{commit}'],{cwd:repo,encoding:'utf8'}).trim(),setupSha256:hash(fs.readFileSync(path.join(pkg,'dsh-desktop-0.1.39-setup.exe'))),asarSha256:hash(fs.readFileSync(path.join(pkg,'win-unpacked/resources/app.asar'))),lineEnding,missingPackage:{exitCode:missing.status,result:JSON.parse(missing.stdout)},packageExit:packageCheck.status}
fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result,null,2))
process.exitCode=missing.status===1&&packageCheck.status===0&&lineEnding.every(x=>x.checkoutWithAutocrlfEqualsWork&&x.workEqualsPackage)?0:1
