// 诊断：为什么设定 hz 与实测 hz 系统性偏高 ~15%？
// 假设：handheld_noise 的第二层是 1.37× 基频（非谐波），
// 自相关在两个不谐的分量之间找折中周期，于是带偏主频。
// 这里用数值实验对比 1.37× 与 2×（谐波）两种设计。
const fps = 24

function noise(tSec, freqHz, seed, octaves = 2, ratio = 1.37) {
  let total = 0
  let amp = 1
  let norm = 0
  const f = Math.max(0.05, freqHz)
  for (let i = 0; i < Math.max(1, octaves); i++) {
    const ph = seed * (0.7 + 0.6 * i) + i * 1.9
    total += amp * Math.sin(2 * Math.PI * f * tSec * (1 + (ratio - 1) * i) + ph)
    norm += amp
    amp *= 0.55
  }
  return total / Math.max(norm, 1e-6)
}

// 与 builder/spikes 相同的归一化自相关
function autocorrHz(series, fps) {
  const n = series.length
  if (n < 16) return 0
  const mean = series.reduce((a, b) => a + b, 0) / n
  const s = series.map((v) => v - mean)
  const energy = s.reduce((a, v) => a + v * v, 0)
  if (energy <= 1e-12) return 0
  const minLag = Math.max(2, Math.floor(fps / 5))
  const maxLag = Math.min(Math.floor(n / 2), Math.floor(fps / 0.35))
  if (maxLag <= minLag + 1) return 0
  const r = {}
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0
    for (let i = 0; i < n - lag; i++) acc += s[i] * s[i + lag]
    r[lag] = acc / energy
  }
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (r[lag] > r[lag - 1] && r[lag] >= r[lag + 1] && r[lag] > 0.05) return fps / lag
  }
  let best = minLag
  for (const k of Object.keys(r)) if (r[k] > r[best]) best = Number(k)
  return fps / best
}

const seconds = 6
const n = seconds * fps
const cases = [1.15, 1.9, 2.6]

for (const ratio of [1.37, 2.0]) {
  console.log(`\n--- 第二层比例 = ${ratio}× ---`)
  for (const hz of cases) {
    const s = []
    for (let i = 0; i < n; i++) s.push(noise(i / fps, hz, 1.0, 2, ratio))
    const got = autocorrHz(s, fps)
    console.log(`设定 ${hz}Hz -> 实测 ${got.toFixed(2)}Hz  偏差 ${((got / hz - 1) * 100).toFixed(0)}%`)
  }
}
