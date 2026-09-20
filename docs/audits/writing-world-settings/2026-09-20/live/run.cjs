// Reuse the real-kernel bootstrap only. No fake model/transport responses.
// Reads the configured DeepSeek credential into the child environment, never
// copies credential files or logs secrets. All sessions/manuscripts are temporary.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const repo = path.resolve(__dirname, '../../../../..')
let fixture = fs.readFileSync(path.join(repo, 'scripts/verify-writing-native.cjs'), 'utf8').replace(/\r\n/g, '\n')
function replace(old, next) {
  if (!fixture.includes(old)) throw Error('Bootstrap anchor changed: ' + old.slice(0, 60))
  fixture = fixture.replace(old, next)
}
replace("const repo = path.resolve(__dirname, '..')", `const repo = ${JSON.stringify(repo)}`)
replace("const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-writing-native-'))", "const temp = process.env.WM_LIVE_RESUME || fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-writing-live-')); if(path.dirname(path.resolve(temp))!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith('dsh-writing-live-'))throw Error('Unsafe live temp path')")
replace("  fs.writeFileSync(path.join(home, 'writing-mode.json')", "  if(!process.env.WM_LIVE_RESUME) fs.writeFileSync(path.join(home, 'writing-mode.json')")
replace('  const patch = path.join(temp,', `
  const yaml = require(path.join(repo, 'runtime/node_modules/yaml'))
  const sourceHome = path.join(os.homedir(), '.dsh')
  const settings = yaml.parse(fs.readFileSync(path.join(sourceHome, 'settings.yaml'), 'utf8'))
  const credentials = yaml.parse(fs.readFileSync(path.join(sourceHome, '.credentials.yaml'), 'utf8'))
  const model = settings['agent-default-model']
  assert.equal(model.provider, 'deepseek-official', 'This acceptance runner only supports the configured official DeepSeek provider')
  const key = process.env.DEEPSEEK_API_KEY || credentials.refs?.DEEPSEEK_API_KEY
  assert.ok(key, 'No configured DeepSeek key; do not run with fake credentials')
  fs.writeFileSync(path.join(home, 'settings.yaml'), yaml.stringify({'agent-default-model':model}))
  console.log('LIVE_CONFIGURATION', JSON.stringify(model))
  console.log('LIVE_TEMP', temp)
  const patch = path.join(temp,`)
replace('env: { ...process.env, DSH_HOME: home }', 'env: { ...process.env, DSH_HOME: home, DEEPSEEK_API_KEY: key }')
// A configured key may skip the key onboarding dialog.
replace("  await waitFor(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='稍后配置')`)\n  await button('稍后配置')", "  await sleep(300); await button('稍后配置')")
replace("  await waitFor(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='继续'&&!e.disabled)`)\n  await button('继续')", "  if(!process.env.WM_LIVE_RESUME) await waitFor(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='继续'&&!e.disabled)`); await button('继续')")
const cut = fixture.indexOf("  await input('想听听你对她为什么不拆信的看法。')")
if (cut < 0) throw Error('Live scenario cut missing')
fixture = fixture.slice(0,cut)+fs.readFileSync(path.join(__dirname,'scenarios.txt'),'utf8');
const m=new Module(__filename,module);m.filename=__filename;m.paths=module.paths;m._compile(fixture,__filename);
