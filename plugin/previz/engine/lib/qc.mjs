/**
 * P0 质检：读 facts.json + 渲染目录，检查取景、地板、帧数、必要文件。
 * 只报可计算的问题；艺术判断留给人。
 */
import fs from 'node:fs'
import path from 'node:path'

const SAFE_MIN = 0.02
const SAFE_MAX = 0.98
const FILL_TOLERANCE = 0.12

function push(list, p, message) {
  list.push({ path: p, message })
}

export function runQc({ outDir }) {
  const errors = []
  const warnings = []
  const factsPath = path.join(outDir, 'facts.json')
  if (!fs.existsSync(factsPath)) {
    return { ok: false, errors: [{ path: 'facts.json', message: '不存在；先跑构建' }], warnings, stats: null }
  }
  const facts = JSON.parse(fs.readFileSync(factsPath, 'utf8'))
  if (!Array.isArray(facts.shots) || facts.shots.length === 0) {
    push(errors, 'facts.shots', '没有镜头')
    return { ok: false, errors, warnings, stats: null }
  }

  let totalFrames = 0
  for (const shot of facts.shots) {
    const sp = `shots.${shot.id}`
    if (!(shot.frames > 0)) push(errors, `${sp}.frames`, '帧数必须 > 0')
    totalFrames += shot.frames || 0

    const dir = path.join(outDir, 'S03', shot.id, 'review')
    if (!fs.existsSync(dir)) {
      push(errors, `${sp}.review`, `缺少渲染目录 ${dir}`)
    } else {
      const pngs = fs.readdirSync(dir).filter((f) => /^f_\d+\.png$/.test(f))
      if (pngs.length !== shot.frames) push(errors, `${sp}.review`, `渲染帧数 ${pngs.length} ≠ facts.frames ${shot.frames}`)
      for (const name of ['first.png', 'mid.png', 'last.png']) {
        if (!fs.existsSync(path.join(outDir, 'S03', shot.id, name))) {
          push(errors, `${sp}.${name}`, `缺少 ${name}`)
        }
      }
    }

    if (!(shot.camera && Number.isFinite(shot.camera.distance) && shot.camera.distance > 0.3)) {
      push(errors, `${sp}.camera.distance`, '相机距离必须 > 0.3m')
    }

    if (shot.fill_check) {
      const diff = Math.abs(Number(shot.frame_span?.fill_actual) - Number(shot.fill_target))
      if (!Number.isFinite(diff)) {
        push(errors, `${sp}.frame_span`, '缺少 frame_span.fill_actual')
      } else if (diff > FILL_TOLERANCE) {
        push(errors, `${sp}.frame_span`, `占幅 ${shot.frame_span.fill_actual} 与目标 ${shot.fill_target} 相差 ${diff.toFixed(3)} > ${FILL_TOLERANCE}`)
      } else if (diff > 0.08) {
        warnings.push({ path: `${sp}.frame_span`, message: `占幅偏差 ${diff.toFixed(3)}，接近容差` })
      }
    }

    // 头部安全区：OTS 只查后景（lead），前景允许切头
    const lead = shot.framing_lead || (shot.size === 'OTS' ? shot.subject_ids?.[1] : shot.subject_ids?.[0])
    const start = shot.start || {}
    const subject = lead && start[lead]
    if (subject && subject.head) {
      const [x, y] = subject.head
      if (x < SAFE_MIN || x > SAFE_MAX || y < SAFE_MIN || y > SAFE_MAX) {
        push(errors, `${sp}.${lead}.head`, `头部 NDC (${x}, ${y}) 超出安全区`)
      } else if (y > 0.9) {
        warnings.push({ path: `${sp}.${lead}.head`, message: `头部偏高（NDC y=${y}），留白可能不足` })
      }
    } else if (shot.size !== 'INSERT') {
      push(errors, `${sp}.${lead ?? 'subject'}.head`, '缺少主体头部 NDC')
    }

    // 地板接触
    for (const [id, v] of Object.entries(start)) {
      if (id === 'frame') continue
      if (v && v.floor_z !== undefined && Math.abs(v.floor_z) > 0.02) {
        push(errors, `${sp}.${id}.floor_z`, `脚底不在地面（${v.floor_z}）`)
      }
    }
  }

  // 总时长/帧数（fixture 是 9s@24fps=216）
  if (totalFrames !== 216) warnings.push({ path: 'facts.shots', message: `总帧数 ${totalFrames}，demo 预期 216` })

  const animatic = path.join(outDir, 'animatic.mp4')
  const stats = {
    shots: facts.shots.length,
    frames: totalFrames,
    animatic: fs.existsSync(animatic) ? animatic : null,
    plan: fs.existsSync(path.join(outDir, 'plan.png')) ? path.join(outDir, 'plan.png') : null,
  }
  return { ok: errors.length === 0, errors, warnings, stats }
}
