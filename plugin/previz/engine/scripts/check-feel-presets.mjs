import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// 验证 move.feel 的四个质感预设：同一路径（dolly_in）+ 不同抖动预设，
// 应当只有"抖动分量"不同，路径骨架不变。
const root = 'E:/Deepseek harness/blender-previz'
const blender = process.env.PREVIZ_BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
const outRoot = path.join(os.tmpdir(), 'previz-feel-presets')
fs.rmSync(outRoot, { recursive: true, force: true })

const PRESETS = ['steadicam', 'handheld_quiet', 'handheld_walk', 'handheld_run']
const base = 'fixtures/shake-calib/A-idle'

for (const preset of PRESETS) {
  const dir = path.join(outRoot, preset)
  fs.mkdirSync(dir, { recursive: true })
  for (const f of ['project.json', 'set.json', 'blocking.json']) {
    fs.copyFileSync(path.join(root, base, f), path.join(dir, f))
  }
  const shots = JSON.parse(fs.readFileSync(path.join(root, base, 'shots.json'), 'utf8'))
  shots.shots[0].move = { type: 'dolly_in', from: 1.0, to: 0.85, feel: { preset } }
  shots.shots[0].camera.follow = undefined
  fs.writeFileSync(path.join(dir, 'shots.json'), JSON.stringify(shots, null, 2), 'utf8')
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/previz.mjs'), 'render', dir, '--out', path.join(dir, 'out'), '--pass', 'plan'], {
    cwd: root,
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    console.error(`构建失败 ${preset}:`, (r.stderr || '').slice(-400))
    process.exit(1)
  }
}

const probe = spawnSync(
  blender,
  ['-b', '--factory-startup', '--python', path.join(root, 'spikes/measure-handheld.py'), '--', '--dir', outRoot],
  { cwd: root, encoding: 'utf8' },
)
const line = String(probe.stdout || '')
  .split(/\r?\n/)
  .find((l) => l.startsWith('HANDHELD '))
if (!line) {
  console.error('未取到测量：', (probe.stderr || '').slice(-600))
  process.exit(1)
}
const rows = JSON.parse(line.slice('HANDHELD '.length))

const report = rows
  .map((r) => {
    const parts = String(r.blend_path || '').split(/[\\/]/).filter(Boolean)
    const preset = parts.length >= 3 ? parts[parts.length - 3] : r.blend
    return {
      预设: preset,
      抖动幅度均值_m: r.handheld_dev_mean_m,
      抖动幅度峰值_m: r.handheld_dev_max_m,
      抖动主频_Hz: r.handheld_hz,
      主频置信度: r.hz_confidence,
      主频可信: r.hz_reliable,
      真横滚_deg: r.true_roll_abs_max_deg,
      行程_m: r.travel_m,
    }
  })
  .sort((a, b) => a.抖动幅度峰值_m - b.抖动幅度峰值_m)

fs.writeFileSync(path.join(outRoot, 'feel-preset-report.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify(report, null, 2))
