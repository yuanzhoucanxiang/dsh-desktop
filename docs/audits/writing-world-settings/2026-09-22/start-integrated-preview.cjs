// Visible final-package preview. Source materials are copied; user closes the app.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), cp = require('node:child_process')
const repo = path.resolve(__dirname, '../../../../..')
const packageRoot = path.join(os.tmpdir(), 'wm-existing-integrated-20260922')
const exe = path.join(packageRoot, 'win-unpacked', 'DeepSeek Harness Desktop.exe')
if (!fs.existsSync(exe)) throw Error('Build the integrated package first')
const source = 'E:/BaiduNetdiskDownload/剧本创作'
fs.mkdirSync(path.join(os.tmpdir(), 'dsh-preview'), { recursive: true })
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-preview', 'writing-integrated-'))
const home = path.join(base, 'home'), desktopHome = path.join(base, 'desktop-home'), userData = path.join(base, 'user-data'), localAppData = path.join(base, 'localappdata'), project = path.join(base, '赫尔帝国')
for (const dir of [home, desktopHome, userData, localAppData]) fs.mkdirSync(dir, { recursive: true })
fs.cpSync(source, project, { recursive: true })
const config = JSON.stringify({ roots: [{ path: project, label: '赫尔帝国 · 隔离副本', kind: 'project', default: true }], activeRoot: project, prefs: { fontSize: 17, lineHeight: 1.95, autoSaveMs: 800, aiMode: 'harness' } }, null, 2)
for (const dir of [home, desktopHome]) fs.writeFileSync(path.join(dir, 'writing-mode.json'), config)
let key = process.env.DEEPSEEK_API_KEY || ''
try {
  const yaml = require(path.join(repo, 'runtime/node_modules/yaml'))
  key ||= yaml.parse(fs.readFileSync(path.join(os.homedir(), '.dsh/.credentials.yaml'), 'utf8')).refs?.DEEPSEEK_API_KEY || ''
} catch {}
const env = { ...process.env, DSH_HOME: home, DSH_DESKTOP_HOME: desktopHome, DSH_DESKTOP_USER_DATA: userData, LOCALAPPDATA: localAppData }
if (key) env.DEEPSEEK_API_KEY = key
const child = cp.spawn(exe, [], { cwd: project, env, detached: true, stdio: 'ignore', windowsHide: true })
child.on('error', err => { console.error(err); process.exitCode = 1 }); child.unref()
const meta = { pid: child.pid, exe, packageRoot, base, home, desktopHome, userData, project, source, keptRunning: true, createdAt: new Date().toISOString(), credentialPersisted: false }
fs.writeFileSync(path.join(__dirname, 'integrated-preview.json'), JSON.stringify(meta, null, 2))
fs.writeFileSync(path.join(base, 'preview.json'), JSON.stringify(meta, null, 2))
console.log(JSON.stringify(meta, null, 2))
