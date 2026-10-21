import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// 参照校准：两部分
//   A) 场景对照（shake-calib 三段，验证"设定值 → 实测值"的对应关系）
//   B) 预设对照（同一段调度 × 四个响应预设，验证预设之间的差异方向与量级）
// 这是"可校准"，不是"已用实拍标定"——拿到实拍参照后，把参照值填进对照列即可判断该往哪调。
const root = process.env.PREVIZ_ROOT || 'E:/Deepseek harness/blender-previz'
const blender = process.env.PREVIZ_BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe'
const outRoot = path.join(os.tmpdir(), 'previz-calib')

function runCli(args) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/previz.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
  })
}

function measureBlends(dir) {
  const probe = spawnSync(
    blender,
    ['-b', '--factory-startup', '--python', path.join(root, 'spikes/measure-handheld.py'), '--', '--dir', dir],
    { cwd: root, encoding: 'utf8' },
  )
  const line = String(probe.stdout || '')
    .split(/\r?\n/)
    .find((l) => l.startsWith('HANDHELD '))
  if (!line) {
    throw new Error(`未能取到测量结果：${String(probe.stderr || probe.stdout || '').slice(-600)}`)
  }
  return JSON.parse(line.slice('HANDHELD '.length))
}

// ---------- A) 三段场景对照 ----------
const EXPECTED = {
  'A-idle': { hz: 1.6, degrees: 0.4, roll: 0.25, kind: 'handheld' },
  'B-walk-turn-stop': { hz: 0.6, degrees: 0.12, roll: 0.1, kind: 'steadicam' },
  'C-sudden-turn': { hz: 1.6, degrees: 0.35, roll: 0.25, kind: 'handheld' },
}

const sceneRows = []
for (const id of Object.keys(EXPECTED)) {
  const dir = path.join(root, 'fixtures/shake-calib', id)
  const out = path.join(outRoot, id)
  const r = runCli(['render', dir, '--out', out, '--pass', 'plan'])
  if (r.status !== 0) {
    console.error(`构建失败 ${id}:`, (r.stderr || '').slice(-500))
    process.exit(1)
  }
}

// ---------- B) 预设对照 ----------
// 固定用 B 场景的调度（行走→转弯→停），只换 camera.response.preset。
const PRESET_BASE = 'B-walk-turn-stop'
const PRESETS = ['steadicam', 'handheld_quiet', 'handheld_walk', 'handheld_run']
const presetDir = path.join(os.tmpdir(), 'previz-calib-presets')
fs.rmSync(presetDir, { recursive: true, force: true })

const baseShots = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/shake-calib', PRESET_BASE, 'shots.json'), 'utf8'))
for (const preset of PRESETS) {
  const dir = path.join(presetDir, preset)
  fs.mkdirSync(dir, { recursive: true })
  for (const f of ['project.json', 'set.json', 'blocking.json']) {
    fs.copyFileSync(path.join(root, 'fixtures/shake-calib', PRESET_BASE, f), path.join(dir, f))
  }
  const shots = JSON.parse(JSON.stringify(baseShots))
  shots.shots[0].camera.response = { preset }
  // 去掉场景自带的手持噪声，避免与响应层混在一起（只测“操作响应”）
  shots.shots[0].move = { type: 'static' }
  fs.writeFileSync(path.join(dir, 'shots.json'), JSON.stringify(shots, null, 2), 'utf8')
  const r = runCli(['render', dir, '--out', path.join(dir, 'out'), '--pass', 'plan'])
  if (r.status !== 0) {
    console.error(`预设构建失败 ${preset}:`, (r.stderr || '').slice(-500))
    process.exit(1)
  }
}

// ---------- 测量 ----------
const sceneMetrics = measureBlends(outRoot)
const presetMetrics = measureBlends(presetDir)

// 预设对照需要位置速度/加速度（衡量“稳不稳”），measure-handheld 已给手持分量，
// 这里再补一版：从 .blend 读位置速度/加速度。
const presetProbe = spawnSync(
  blender,
  ['-b', '--factory-startup', '--python', path.join(root, 'spikes/measure-camera-feel.py'), '--', '--dir', presetDir],
  { cwd: root, encoding: 'utf8' },
)
const pLine = String(presetProbe.stdout || '')
  .split(/\r?\n/)
  .find((l) => l.startsWith('FEEL_METRICS '))
const presetFeel = pLine ? JSON.parse(pLine.slice('FEEL_METRICS '.length)) : []

const sceneReport = sceneMetrics
  .map((row) => {
    const id = row.blend.replace(/\.blend$/, '')
    const exp = EXPECTED[id]
    if (!exp) return null
    return {
      场景: id,
      类型: exp.kind,
      设定Hz: exp.hz,
      实测Hz: row.handheld_hz,
      Hz偏差: Number((row.handheld_hz - exp.hz).toFixed(2)),
      手持幅度均值_m: row.handheld_dev_mean_m,
      手持幅度峰值_m: row.handheld_dev_max_m,
      设定横滚_deg: exp.roll,
      实测横滚_deg: row.true_roll_abs_max_deg,
      行程_m: row.travel_m,
    }
  })
  .filter(Boolean)

const presetReport = presetFeel
  .map((feel) => {
    // blend 在 <preset>/out/ 下，文件名是项目 id；预设名要从祖父目录取。
    // 之前用 basename 反推，四个预设全同名（全是 B-walk-turn-stop），表格完全看不出差异。
    const parts = String(feel.blend_path || '').split(/[\\/]/).filter(Boolean)
    const preset = parts.length >= 3 ? parts[parts.length - 3] : feel.blend.replace(/\.blend$/, '')
    const row =
      presetMetrics.find((m) => {
        const mp = String(m.blend_path || '').split(/[\\/]/).filter(Boolean)
        return mp.length >= 3 && mp[mp.length - 3] === preset
      }) || {}
    return {
      预设: preset,
      位置峰值速度: feel.pos_max_speed ?? null,
      位置均值速度: feel.pos_mean_speed ?? null,
      位置峰值加速度: feel.pos_max_accel ?? null,
      // 这批 fixture 是 move:static + 纯 response，没有手持噪声，
      // 所以"手持分量"在这里量的是响应滞后，不是抖动——用构图滞后区间更有意义。
      构图滞后区间_m: feel.dist_to_aim_range ?? null,
      行程_m: feel.travel_m ?? null,
      帧数: row.frames ?? null,
    }
  })
  .sort((a, b) => (a.位置峰值加速度 ?? 0) - (b.位置峰值加速度 ?? 0))

fs.mkdirSync(outRoot, { recursive: true })
fs.writeFileSync(path.join(outRoot, 'calibration-report.json'), JSON.stringify(sceneReport, null, 2), 'utf8')
fs.writeFileSync(path.join(presetDir, 'preset-report.json'), JSON.stringify(presetReport, null, 2), 'utf8')

console.log('=== A) 三段场景：设定值 vs 实测值 ===')
console.log(JSON.stringify(sceneReport, null, 2))
console.log('\n=== B) 四预设：同一调度（行走→转弯→停）===')
console.log(JSON.stringify(presetReport, null, 2))
console.log(`\n报告：${path.join(outRoot, 'calibration-report.json')}`)
console.log(`预设报告：${path.join(presetDir, 'preset-report.json')}`)
