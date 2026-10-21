/**
 * 取景反算（与 blender/previz_build.py 里的 Python 实现保持同一公式）。
 *
 * 约定：
 * - 16:9 画幅；`sensorWidthMm` 是水平传感器宽度（全画幅 36mm）。
 * - `fill` 是主体在画面高度中的占比（0..1）。
 * - `distance` 是相机到画面中心点的距离。
 *
 * 公式：sensor_h = sensor_w / (w/h)；d = H * f / (sensor_h * fill)
 * 该公式只保证「垂直高度」，不保证头/脚/留白；实际构图必须再用
 * `world_to_camera_view` 复核（见策划案 §7.4）。
 */

export function parseAspect(aspect) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(String(aspect ?? ''))
  if (!m) throw new Error(`invalid aspect: ${aspect}`)
  const w = Number(m[1])
  const h = Number(m[2])
  if (!(w > 0) || !(h > 0)) throw new Error(`invalid aspect: ${aspect}`)
  return { width: w, height: h, ratio: w / h }
}

export function sensorHeightMm(sensorWidthMm, aspect) {
  const { ratio } = parseAspect(aspect)
  return Number(sensorWidthMm) / ratio
}

export function solveDistance({ subjectHeightM, lensMm, sensorWidthMm = 36, aspect = '16:9', fill = 0.85 }) {
  const sh = sensorHeightMm(sensorWidthMm, aspect)
  if (!(subjectHeightM > 0)) throw new Error('subjectHeightM must be > 0')
  if (!(lensMm > 0)) throw new Error('lensMm must be > 0')
  if (!(fill > 0 && fill <= 1)) throw new Error('fill must be in (0, 1]')
  return (subjectHeightM * lensMm) / (sh * fill)
}

export function solveLens({ distanceM, subjectHeightM, sensorWidthMm = 36, aspect = '16:9', fill = 0.85 }) {
  const sh = sensorHeightMm(sensorWidthMm, aspect)
  if (!(distanceM > 0)) throw new Error('distanceM must be > 0')
  if (!(subjectHeightM > 0)) throw new Error('subjectHeightM must be > 0')
  if (!(fill > 0 && fill <= 1)) throw new Error('fill must be in (0, 1]')
  return (distanceM * sh * fill) / subjectHeightM
}

/** 由世界高度和距离算画面占比（与上面的公式互逆）。 */
export function fillAt({ distanceM, subjectHeightM, lensMm, sensorWidthMm = 36, aspect = '16:9' }) {
  const sh = sensorHeightMm(sensorWidthMm, aspect)
  return (subjectHeightM * lensMm) / (sh * distanceM)
}
