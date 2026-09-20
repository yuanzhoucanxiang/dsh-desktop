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
fixture = fixture.slice(0, cut) + String.raw`
  const turns = process.env.WM_LIVE_RESUME ? JSON.parse(fs.readFileSync(path.join(temp,'transcript.json'),'utf8')) : []
  async function turn(message) {
    const before = await evaluate("document.querySelectorAll('.dshWmMessage.is-assistant').length")
    await input(message)
    await evaluate("document.querySelector('.dshWmSend').click()")
    const deadline = Date.now() + 150000
    let state
    while(Date.now() < deadline) {
      state = await evaluate("(()=>({messages:Array.from(document.querySelectorAll('.dshWmMessage')).map(e=>({kind:e.className,text:e.querySelector('.dshWmMessageText')?.innerText})),alerts:Array.from(document.querySelectorAll('.dshWmCompanionError')).map(e=>e.innerText),buttons:Array.from(document.querySelectorAll('.dshWmCompanion button')).map(e=>e.textContent),draft:document.querySelector('.dshWmChatInput')?.value}))()")
      const assistants = state.messages.filter(m=>m.kind.includes('is-assistant'))
      if (state.alerts.length || state.messages.some(m=>m.kind.includes('is-error'))) break
      if (assistants.length > before && !state.buttons.some(t=>t==='停止') && assistants.at(-1).text) { await sleep(1500); break }
      await sleep(300)
    }
    turns.push({message,state})
    fs.writeFileSync(path.join(temp,'transcript.json'), JSON.stringify(turns,null,2))
    fs.writeFileSync(path.join(temp,'live.png'), (await win.webContents.capturePage()).toPNG())
    console.log('LIVE_TURN', JSON.stringify(turns.at(-1)))
    assert.ok(state.messages.filter(m=>m.kind.includes('is-assistant')).length > before, 'No real assistant response')
    assert.equal(state.alerts.length,0,'Live send failed')
    assert.ok(!state.messages.some(m=>m.kind.includes('is-error')), 'Native model error')
    assert.ok(!state.buttons.some(t=>t==='停止'),'Model did not finish within test timeout')
  }
  if (!process.env.WM_LIVE_RESUME) {
  await turn('我在写灯塔来信。她收到一封信，却一直没拆。我还没想好为什么，想听听你的感觉。')
  await turn('不，我不想让她害怕坏消息。算了，这个先不解决。我们聊聊灯塔停电时那种突然的安静吧。')
  assert.equal(fs.readFileSync(doc,'utf8'),'灯塔的影子落在信封上。她没有拆开那封信。')
  const memoryFile = path.join(project,'state/writing-memory.json')
  const memory = fs.existsSync(memoryFile) ? JSON.parse(fs.readFileSync(memoryFile,'utf8')) : null
  assert.ok(!memory || !memory.items?.length,'Casual discussion must not silently become project memory')
  results.push('Two real conversational turns; original manuscript unchanged; no automatic confirmed memory')
  console.log('LIVE_SCENE_1_COMPLETE',temp)
  }
  if (process.env.WM_LIVE_RESUME) {
` + fs.readFileSync(path.join(__dirname,'live-followup-body.txt'),'utf8') + String.raw`
  }
}).catch(err => { console.error(err); process.exitCode = 1 }).finally(async () => {
  // Kernel output can include provider diagnostics: persist only test observations.
  fs.writeFileSync(path.join(temp,'results.json'),JSON.stringify({passed:!process.exitCode,results,failures},null,2))
  if(win&&!win.isDestroyed())win.destroy()
  if(kernel&&kernel.exitCode===null)kernel.kill()
  app.exit(process.exitCode||0)
})
`
const m = new Module(__filename, module); m.filename = __filename; m.paths = module.paths; m._compile(fixture, __filename)
