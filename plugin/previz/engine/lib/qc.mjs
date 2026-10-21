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
  const scene = facts.scene || 'S03'

  let totalFrames = 0
  let occlusionChecks = 0
  let occlusionBlocked = 0
  for (const shot of facts.shots) {
    const sp = `shots.${shot.id}`
    if (!(shot.frames > 0)) push(errors, `${sp}.frames`, '帧数必须 > 0')
    totalFrames += shot.frames || 0

    const dir = path.join(outDir, scene, shot.id, 'review')
    if (!fs.existsSync(dir)) {
      push(errors, `${sp}.review`, `缺少渲染目录 ${dir}`)
    } else {
      const pngs = fs.readdirSync(dir).filter((f) => /^f_\d+\.png$/.test(f))
      if (pngs.length !== shot.frames) push(errors, `${sp}.review`, `渲染帧数 ${pngs.length} ≠ facts.frames ${shot.frames}`)
      for (const name of ['first.png', 'mid.png', 'last.png']) {
        if (!fs.existsSync(path.join(outDir, scene, shot.id, name))) {
          push(errors, `${sp}.${name}`, `缺少 ${name}`)
        }
      }
    }

    // P1：脚部接触 + 脚掌俯仰（heel-to-toe 允许 ±25°，但不能翻到不物理）
    if (Array.isArray(shot.feet)) {
      for (const f of shot.feet) {
        if (!Number.isFinite(f.min_z)) {
          push(errors, `${sp}.feet`, `主体 ${f.subject} 的脚部 z 不是数字`)
        } else if (f.min_z < -0.02 || f.min_z > 0.03) {
          push(errors, `${sp}.feet`, `主体 ${f.subject} 在帧 ${f.frame} 最低脚 z=${f.min_z}，不在 [-0.02, 0.03]`)
        }
        if (Number.isFinite(f.pitch_deg) && Math.abs(f.pitch_deg) > 25) {
          push(errors, `${sp}.feet`, `主体 ${f.subject} 在帧 ${f.frame} 脚掌俯仰 ${f.pitch_deg}°，超出 ±25°`)
        }
      }
    } else {
      warnings.push({ path: `${sp}.feet`, message: '缺少脚部接触 facts（重跑构建）' })
    }

    // P1：滑步。按支撑脚（最低脚）连续段算 world 漂移；> 6cm 判滑步。
    if (Array.isArray(shot.foot_plant)) {
      let run = null
      const runs = []
      for (const p of shot.foot_plant) {
        if (!run || run.side !== p.side || run.subject !== p.subject) {
          if (run) runs.push(run)
          run = { subject: p.subject, side: p.side, f0: p.frame, x0: p.x, y0: p.y, f1: p.frame, x1: p.x, y1: p.y }
        } else {
          run.f1 = p.frame
          run.x1 = p.x
          run.y1 = p.y
        }
      }
      if (run) runs.push(run)
      for (const r of runs) {
        const drift = Math.hypot(r.x1 - r.x0, r.y1 - r.y0)
        if (drift > 0.06) {
          push(errors, `${sp}.foot_plant`, `主体 ${r.subject} 支撑脚 ${r.side} 在帧 ${r.f0}-${r.f1} 漂移 ${drift.toFixed(3)}m > 0.06m`)
        }
      }
    } else {
      warnings.push({ path: `${sp}.foot_plant`, message: '缺少滑步测量 facts（重跑构建）' })
    }

    // P1：滑步。按支撑脚（最低脚）连续段算 world 漂移；> 6cm 判滑步。
    if (Array.isArray(shot.foot_plant)) {
      let run = null
      const runs = []
      for (const p of shot.foot_plant) {
        if (!run || run.side !== p.side || run.subject !== p.subject) {
          if (run) runs.push(run)
          run = { subject: p.subject, side: p.side, f0: p.frame, x0: p.x, y0: p.y, f1: p.frame, x1: p.x, y1: p.y }
        } else {
          run.f1 = p.frame
          run.x1 = p.x
          run.y1 = p.y
        }
      }
      if (run) runs.push(run)
      for (const r of runs) {
        const drift = Math.hypot(r.x1 - r.x0, r.y1 - r.y0)
        if (drift > 0.06) {
          push(errors, `${sp}.foot_plant`, `主体 ${r.subject} 支撑脚 ${r.side} 在帧 ${r.f0}-${r.f1} 漂移 ${drift.toFixed(3)}m > 0.06m`)
        }
      }
    } else {
      warnings.push({ path: `${sp}.foot_plant`, message: '缺少滑步测量 facts（重跑构建）' })
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

    // P1：越轴（相机在轴线哪一侧；OTS 前景挡后景不算越轴）
    if (shot.axis && shot.axis.ok === false) {
      push(errors, `${sp}.axis`, `相机在轴线的 ${shot.axis.start_side}/${shot.axis.end_side}，期望 ${shot.axis.expected}`)
    }

    // P1：屏幕方向（只检查显式声明的镜头）
    if (shot.screen && shot.screen.direction) {
      if (shot.screen.ok === false) {
        push(errors, `${sp}.screen`, `屏幕方向 ${shot.screen.direction} 不成立（dx=${shot.screen.dx}, dz=${shot.screen.dz}）`)
      } else if (shot.screen.ok !== true) {
        warnings.push({ path: `${sp}.screen`, message: '缺少可判定的屏幕方向数据' })
      }
    }

    // P1：遮挡。自身身体/自身道具不算；OTS 的前景演员挡后景标 allowed=true。
    if (Array.isArray(shot.occlusion)) {
      for (const o of shot.occlusion) {
        occlusionChecks++
        if (o.visible === false && !o.allowed) {
          occlusionBlocked++
          push(errors, `${sp}.occlusion`, `主体 ${o.subject} 在帧 ${o.frame} 被 ${o.blocker}（${o.blocker_kind}）挡住`)
        }
      }
    } else {
      warnings.push({ path: `${sp}.occlusion`, message: '缺少遮挡 facts（重跑构建）' })
    }
  }

  // 总时长/帧数（fixture 是 9s@24fps=216）
  if (totalFrames !== 216) warnings.push({ path: 'facts.shots', message: `总帧数 ${totalFrames}，demo 预期 216` })

  const animatic = path.join(outDir, 'animatic.mp4')
  const stats = {
    shots: facts.shots.length,
    frames: totalFrames,
    occlusion_checks: occlusionChecks,
    occlusion_blocked: occlusionBlocked,
    animatic: fs.existsSync(animatic) ? animatic : null,
    plan: fs.existsSync(path.join(outDir, 'plan.png')) ? path.join(outDir, 'plan.png') : null,
  }
  return { ok: errors.length === 0, errors, warnings, stats }
}
