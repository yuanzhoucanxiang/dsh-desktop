import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// 参照校准的可执行流程：
//   1) 用 fixtures/shake-calib 的三个场景构建 .blend（同一场景/焦段，只换调度）
//   2) 从 .blend 抽相机轨迹，量出手持分量（幅度/主频）与真横滚
//   3) 与"设定值"对照，输出偏差表
// 这是"可校准"，不是"已用实拍标定"——拿到实拍参照后，把 REFERENCE 换成实测值即可。
const root = 'E:/Deepseek harness/blender-previz'
const blender = process.env.PREVIZ_BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
const outRoot = path.join(os.tmpdir(), 'previz-calib')

// 三个场景的"设定值"（来自 shots.json 的 move 参数）
const EXPECTED = {
  'A-idle': { hz: 1.6, degrees: 0.4, roll: 0.25, kind: 'handheld' },
  'B-walk-turn-stop': { hz: 0.6, degrees: 0.12, roll: 0.1, kind: 'steadicam' },
  'C-sudden-turn': { hz: 1.6, degrees: 0.35, roll: 0.25, kind: 'handheld' },
}

const scenes = Object.keys(EXPECTED)
for (const id of scenes) {
  const dir = path.join(root, 'fixtures/shake-calib', id)
  const out = path.join(outRoot, id)
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/previz.mjs'), 'render', dir, '--out', out, '--pass', 'plan'], {
    cwd: root,
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    console.error(`构建失败 ${id}:`, (r.stderr || '').slice(-500))
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
  console.error('未能取到测量结果：', (probe.stderr || '').slice(-800))
  process.exit(1)
}
const rows = JSON.parse(line.slice('HANDHELD '.length))

const report = []
for (const row of rows) {
  const id = row.blend.replace(/\.blend$/, '')
  const exp = EXPECTED[id]
  if (!exp) continue
  report.push({
    场景: id,
    类型: exp.kind,
    设定Hz: exp.hz,
    实测Hz: row.handheld_hz,
    Hz偏差: Number((row.handheld_hz - exp.hz).toFixed(2)),
    手持幅度均值_m: row.handheld_dev_mean_m,
    手持幅度峰值_m: row.handheld_dev_max_m,
    真横滚_deg: row.true_roll_abs_max_deg,
    设定横滚_deg: exp.roll,
    行程_m: row.travel_m,
  })
}

fs.writeFileSync(path.join(outRoot, 'calibration-report.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify(report, null, 2))
console.log(`\n报告：${path.join(outRoot, 'calibration-report.json')}`)
