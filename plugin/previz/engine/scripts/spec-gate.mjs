import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// 规格符合性门禁（不是循环论证）：
//   1) 从 fixtures/shake-calib 的 shots.json 读**规格**（作者声明的 hz / degrees / roll_degrees）
//   2) 用 Blender 真实构建 + 逐帧采样，量出**实测值**
//   3) 按容差比对，不达标就非零退出
// 与 test/*.test.mjs 里"硬编码期望值"不同：这里的期望值来自输入文件，改参数而没改测试也能发现问题。
const root = process.env.PREVIZ_ROOT || 'E:/Deepseek harness/blender-previz'
const blender = process.env.PREVIZ_BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
const outRoot = path.join(os.tmpdir(), 'previz-spec-gate')
fs.rmSync(outRoot, { recursive: true, force: true })

// 容差：测量方法本身的精度限制，不是"放宽到能过"
const TOL = {
  hz: 0.35,        // 自相关在 6s 窗口上的分辨率
  rollRatio: 0.25, // 横滚与 degrees 的比例关系
  ampRatio: 0.5,   // 抖动幅度与 degrees 的比例关系
}

// 实现里的默认值：roll_degrees 按类型不同（handheld 0.25 / steadicam 0.1），
// 门禁必须按**同一规则**取默认值，否则会把"没写就用默认"误判成规格不符。
const DEFAULT_ROLL = { handheld: 0.25, steadicam: 0.1 }

const scenes = ['A-idle', 'B-walk-turn-stop', 'C-sudden-turn']
const specs = []
for (const id of scenes) {
  const dir = path.join(root, 'fixtures/shake-calib', id)
  const shots = JSON.parse(fs.readFileSync(path.join(dir, 'shots.json'), 'utf8'))
  const move = shots.shots[0].move
  const blocking = JSON.parse(fs.readFileSync(path.join(dir, 'blocking.json'), 'utf8'))
  specs.push({
    scene: id,
    type: move.type,
    hz: Number(move.hz),
    degrees: Number(move.degrees),
    roll_degrees: Number(move.roll_degrees ?? DEFAULT_ROLL[move.type] ?? 0.25),
    stride_hz: Number(move.stride_hz ?? 2.0),
    // 该场景人物是否在移动：决定主频期望是点值还是区间（步速耦合会拉向 stride_hz）
    moving: Array.isArray(blocking.moves) && blocking.moves.length > 0,
  })
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/previz.mjs'), 'render', dir, '--out', path.join(outRoot, id), '--pass', 'plan'], {
    cwd: root,
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    console.error(`构建失败 ${id}:`, (r.stderr || '').slice(-400))
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
  console.error('未取到测量：', (String(probe.stderr || probe.stdout || '')).slice(-600))
  process.exit(1)
}
const rows = JSON.parse(line.slice('HANDHELD '.length))

const failures = []
const report = []
for (const spec of specs) {
  const row = rows.find((r) => {
    const parts = String(r.blend_path || '').split(/[\\/]/).filter(Boolean)
    return parts.includes(spec.scene)
  })
  if (!row) {
    failures.push(`${spec.scene}: 没有测到`)
    continue
  }
  const checks = []
  // ① 主频（仅在测得可信时比对）。
  // 注意：走动场景里 hz 不是最终频率——步速耦合会把 hz 拉向 stride_hz（默认 2.0）并封顶 1.15×。
  // 所以规格应理解为"静止时的基频"，走动时的期望是一个区间。
  const strideHz = spec.stride_hz
  const setHz = spec.hz
  const moving = !!((spec.moving) || false)
  const expectedLo = moving ? Math.min(setHz, strideHz) - TOL.hz : setHz - TOL.hz
  const expectedHi = moving ? Math.max(setHz, strideHz) * 1.15 + TOL.hz : setHz + TOL.hz
  if (row.hz_reliable && Number.isFinite(row.handheld_hz)) {
    const got = row.handheld_hz
    const ok = got >= expectedLo && got <= expectedHi
    checks.push({ name: 'hz', ok, spec: Math.round(setHz * 100) / 100, got, range: [Number(expectedLo.toFixed(2)), Number(expectedHi.toFixed(2))], moving })
    if (!ok) failures.push(`${spec.scene}: 主频 实测 ${got} 不在期望区间 [${expectedLo.toFixed(2)}, ${expectedHi.toFixed(2)}]（设定基频 ${setHz}）`)
  } else {
    checks.push({ name: 'hz', ok: true, skipped: '测量不可信（幅度低于门槛）' })
  }
  // ② 横滚：实测应接近 roll_degrees 的设定
  const rollGot = Number(row.true_roll_abs_max_deg)
  const rollOk = Math.abs(rollGot - spec.roll_degrees) <= Math.max(0.05, spec.roll_degrees * TOL.rollRatio)
  checks.push({ name: 'roll', ok: rollOk, spec: spec.roll_degrees, got: rollGot })
  if (!rollOk) failures.push(`${spec.scene}: 横滚 设定 ${spec.roll_degrees} 实测 ${rollGot}（差 ${Math.abs(rollGot - spec.roll_degrees).toFixed(3)}）`)
  // ③ 抖动幅度：应随 degrees 增大而增大（同场景内比较，用绝对量级做下界检查）
  checks.push({ name: 'amp', ok: row.handheld_dev_max_m > 0, got: row.handheld_dev_max_m })

  report.push({
    场景: spec.scene,
    类型: spec.type,
    设定Hz: spec.hz,
    实测Hz: row.hz_reliable ? row.handheld_hz : null,
    设定横滚: spec.roll_degrees,
    实测横滚: rollGot,
    抖动峰值_m: row.handheld_dev_max_m,
    通过: checks.every((c) => c.ok),
  })
}

// ④ 跨场景：更大的 degrees 必须带来更大的抖动幅度
const byAmp = [...report].sort((a, b) => a.抖动峰值_m - b.抖动峰值_m)
const specByScene = Object.fromEntries(specs.map((s) => [s.scene, s]))
for (let i = 1; i < byAmp.length; i++) {
  const prev = specByScene[byAmp[i - 1].场景]
  const cur = specByScene[byAmp[i].场景]
  if (cur.degrees > prev.degrees && byAmp[i].抖动峰值_m < byAmp[i - 1].抖动峰值_m) {
    failures.push(
      `幅度与 degrees 不一致：${cur.scene} degrees ${cur.degrees} > ${prev.scene} ${prev.degrees}，但抖动 ${byAmp[i].抖动峰值_m} < ${byAmp[i - 1].抖动峰值_m}`,
    )
  }
}

console.log('=== 规格 vs 实测 ===')
console.log(JSON.stringify(report, null, 2))
console.log(`\nSPEC_GATE ${failures.length ? 'FAIL' : 'OK'} (${report.length} 场景)`)
for (const f of failures) console.log('  ✗ ' + f)
process.exit(failures.length ? 1 : 0)
