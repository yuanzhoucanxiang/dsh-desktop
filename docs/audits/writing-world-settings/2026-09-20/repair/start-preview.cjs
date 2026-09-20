// Visible isolated preview for writing-world-settings (left running; user closes).
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const cp = require('node:child_process')

const repo = path.resolve(__dirname, '../../../../..')
const pkgRoot = path.join(os.tmpdir(), 'wm-world-repaired-final-20260920')
const exe = path.join(pkgRoot, 'win-unpacked', 'DeepSeek Harness Desktop.exe')
if (!fs.existsSync(exe)) {
  console.error('missing exe', exe)
  process.exit(1)
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-preview', 'writing-world-repaired-20260920-'))
const home = path.join(base, 'home')
const desktopHome = path.join(base, 'desktop-home')
const userData = path.join(base, 'user-data')
const localAppData = path.join(base, 'localappdata')
const library = path.join(base, 'library')
const project = path.join(library, '雾港夜航')
for (const d of [home, desktopHome, userData, localAppData, path.join(project, 'state'), path.join(project, 'bible'), path.join(project, 'draft', 'novel')]) {
  fs.mkdirSync(d, { recursive: true })
}

// Seed writing-mode.json library root (isolated)
fs.writeFileSync(
  path.join(home, 'writing-mode.json'),
  JSON.stringify(
    {
      roots: [{ path: library, label: '预览库', default: true }],
      activeRoot: library,
      prefs: { fontSize: 17, lineHeight: 1.95, autoSaveMs: 800, autoGate: true, aiMode: 'harness' },
    },
    null,
    2
  )
)
fs.writeFileSync(
  path.join(desktopHome, 'writing-mode.json'),
  fs.readFileSync(path.join(home, 'writing-mode.json'))
)

fs.writeFileSync(
  path.join(project, 'project.md'),
  `# 立项书

作品名：雾港夜航
形态：小说（长篇连载）
一句话前提：雾季禁航令下，年轻引航员必须在规则与救命之间选择。
核心冲突：公共安全规则 vs 具体生命的代价
`
)
fs.writeFileSync(
  path.join(project, 'bible', 'world.md'),
  `# 世界观

## 世界规则

（讨论后由「整理为设定」写入 bible/世界观整理.md）
`
)

fs.writeFileSync(path.join(project, 'draft', 'novel', '雾港夜航-v1.md'), '# 雾港夜航\n\n雾季的第三晚，港口响起了不该响起的钟声。\n')

// Optional credentials for real-model chat (do not persist secrets in preview meta)
let key = process.env.DEEPSEEK_API_KEY || ''
try {
  const yaml = require(path.join(repo, 'runtime/node_modules/yaml'))
  const creds = yaml.parse(fs.readFileSync(path.join(os.homedir(), '.dsh/.credentials.yaml'), 'utf8'))
  key = key || creds.refs?.DEEPSEEK_API_KEY || ''
} catch {}

const env = {
  ...process.env,
  DSH_HOME: home,
  DSH_DESKTOP_HOME: desktopHome,
  DSH_DESKTOP_USER_DATA: userData,
  LOCALAPPDATA: localAppData,
}
if (key) env.DEEPSEEK_API_KEY = key

const app = cp.spawn(exe, [], {
  cwd: project,
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
  env,
})
app.on('error', (e) => {
  console.error(e.message)
  process.exitCode = 1
})
app.unref()

const meta = {
  pid: app.pid,
  exe,
  packageRoot: pkgRoot,
  base,
  home,
  desktopHome,
  userData,
  localAppData,
  library,
  project,
  repoHead: (() => {
    try {
      return cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
    } catch {
      return null
    }
  })(),
  version: require(path.join(repo, 'package.json')).version,
  createdAt: new Date().toISOString(),
  keptRunning: true,
  credentialPersisted: false,
  trialSteps: [
    '打开写作模式，库根应指向预览库',
    '打开项目「雾港夜航」',
    '在写作伙伴中聊世界观（如雾季禁航）',
    '勾选消息 →「选入整理」→「整理为设定」',
    '编辑候选 →「确认设定」',
    '查看 bible/世界观整理.md 与项目备忘',
    '改设定后再聊，确认默认注入为结论+边界',
    '刷新或另一窗口验证不丢设定',
  ],
}
fs.writeFileSync(path.join(__dirname, 'preview.json'), JSON.stringify(meta, null, 2))
console.log(JSON.stringify(meta, null, 2))
