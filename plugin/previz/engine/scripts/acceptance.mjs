/**
 * 验收清单：把 `docs/能力边界与验收.md` 里写的命令逐条真跑一遍。
 *
 * 目的：文档不能只“看起来对”。任何一条命令改名/参数变了，这里必须红。
 * 跑法：node scripts/acceptance.mjs            （完整，含两次 Blender demo，约 30–60s）
 *       node scripts/acceptance.mjs --quick    （跳过 demo，只跑不渲染的检查）
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = path.join(root, 'scripts/previz.mjs')
const quick = process.argv.includes('--quick')
let pass = 0
const failures = []

function run(args, opts = {}) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: opts.timeout || 180000 })
}
function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`PASS ${name}`)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function tmp(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `previz-acc-${name}-`))
  return dir
}
function copyBase(dir) {
  for (const f of ['project.json', 'set.json', 'blocking.json']) {
    fs.copyFileSync(path.join(root, 'fixtures/boutique', f), path.join(dir, f))
  }
}

// 1. 不渲染的命令
const info = run(['info', '--json'])
check('info --json', info.status === 0 && JSON.parse(info.stdout).ok !== false, info.stderr.slice(0, 200))

const validate = run(['validate', 'fixtures/boutique'])
check('validate', validate.status === 0, validate.stderr.slice(0, 200))

const projects = run(['projects', '--json'])
let projectList = []
try {
  projectList = JSON.parse(projects.stdout).projects
} catch {}
check('projects --json', projects.status === 0 && Array.isArray(projectList) && projectList.some((p) => p.id === 'boutique'))

const outDir = path.join(root, 'demo-out')
if (!fs.existsSync(path.join(outDir, 'animatic.mp4'))) {
  check('demo-out 存在（先跑 demo）', false, '缺少 animatic.mp4')
} else {
  const exportRun = run(['export', outDir])
  check('export', exportRun.status === 0, exportRun.stderr.slice(0, 200))
  check('shots.csv 生成', fs.existsSync(path.join(outDir, 'shots.csv')))
  check('timeline.otio 生成', fs.existsSync(path.join(outDir, 'timeline.otio')))

  const qcRun = run(['qc', outDir])
  check('qc', qcRun.status === 0, qcRun.stderr.slice(0, 200))

  const burn = run(['burn-in', outDir])
  check('burn-in', burn.status === 0, burn.stderr.slice(0, 200))
}

// 2. 反例必须红
const badDir = tmp('bad')
const bad = run(['demo', 'fixtures/bad-occlusion', '--out', badDir, '--force'])
check('遮挡反例 EXIT=1', bad.status === 1)
// 不能只搜 "occlusion"：输入路径 fixtures/bad-occlusion 本身就含这个词，builder 坏了也会“通过”。
// 必须匹配 QC 的具体报文，并确认报的是被测主体。
const badText = bad.stderr + bad.stdout
check('遮挡反例报“被 … 挡住”', /被\s*\S+（(?:prop|set|actor)）挡住/.test(badText), badText.split(/\r?\n/).slice(-3).join(' '))
check('遮挡反例指向 S03-01 主体 LIN', /shots\.S03-01\.occlusion: 主体 LIN/.test(badText))

const draftDir = tmp('draft')
copyBase(draftDir)
fs.mkdirSync(path.join(draftDir, 'panels'))
fs.copyFileSync(path.join(root, 'demo-out/S03/S03-01/first.png'), path.join(draftDir, 'panels/p1.png'))
run(['panels', draftDir, '--scene', 'S03', '--subject', 'LIN'])
const draftImport = run(['import', path.join(draftDir, 'panels.draft.csv'), '--out', path.join(draftDir, 'x.json')])
check('draft import 被拒', draftImport.status === 1)
check('draft import 报 panels-confirm', /panels-confirm/.test(draftImport.stderr + draftImport.stdout))

// 3. 全链路（quick 模式跳过）
if (!quick) {
  const scriptDir = tmp('script')
  copyBase(scriptDir)
  fs.copyFileSync(path.join(root, 'fixtures/boutique/script.txt'), path.join(scriptDir, 'script.txt'))
  check('script', run(['script', path.join(scriptDir, 'script.txt'), '--scene', 'S03', '--alias', '林=LIN,周=ZHOU']).status === 0)
  check(
    'board --fit-blocking',
    run(['board', path.join(scriptDir, 'script.txt'), '--scene', 'S03', '--alias', '林=LIN,周=ZHOU', '--fit-blocking', path.join(scriptDir, 'blocking.json')]).status === 0,
  )
  check('import board', run(['import', path.join(scriptDir, 'storyboard.csv'), '--out', path.join(scriptDir, 'shots.json')]).status === 0)
  const scriptDemo = run(['demo', scriptDir, '--out', path.join(scriptDir, 'out'), '--force'])
  check('script → demo QC', scriptDemo.status === 0, scriptDemo.stderr.slice(0, 200))

  const panelDir = tmp('panels')
  copyBase(panelDir)
  fs.mkdirSync(path.join(panelDir, 'panels'))
  fs.copyFileSync(path.join(root, 'demo-out/S03/S03-01/first.png'), path.join(panelDir, 'panels/p1.png'))
  fs.copyFileSync(path.join(root, 'demo-out/S03/S03-02/first.png'), path.join(panelDir, 'panels/p2.png'))
  check('panels', run(['panels', panelDir, '--scene', 'S03', '--subject', 'LIN', '--duration', '4.5']).status === 0)
  check('panels-confirm', run(['panels-confirm', panelDir, '--by', 'acceptance']).status === 0)
  check('import confirmed', run(['import', path.join(panelDir, 'storyboard.csv'), '--out', path.join(panelDir, 'shots.json')]).status === 0)
  const panelDemo = run(['demo', panelDir, '--out', path.join(panelDir, 'out'), '--force'])
  check('panels → demo QC', panelDemo.status === 0, panelDemo.stderr.slice(0, 200))
}

console.log(`\nACCEPTANCE ${failures.length ? 'FAIL' : 'OK'} · ${pass} passed / ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
