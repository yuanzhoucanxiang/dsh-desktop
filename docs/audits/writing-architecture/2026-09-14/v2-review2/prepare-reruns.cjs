// Relocate existing probes only: retain assertions and preserve pre-existing evidence.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process')
const repo=path.resolve(__dirname,'../../../../..')
const old=path.join(__dirname,'../v2-review')
const sha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim()
for(const file of ['probes.mjs','ui-probes.cjs','baseline-ui.cjs','package-probe.cjs']){
  let s=fs.readFileSync(path.join(old,file),'utf8')
  s=s.replaceAll('95b138d427f445e933e69811f8a775ce968ffe28',sha)
    .replaceAll("reviewedImplementation:'95b138d',head:'95b138d'",`reviewedImplementation:'${sha}',head:'${sha}'`)
    .replaceAll('2026-09-14/v2-review/ui-results.json','2026-09-14/v2-review2/ui-results.json')
  fs.writeFileSync(path.join(__dirname,file),s)
}
console.log('Relocated probes for',sha)
