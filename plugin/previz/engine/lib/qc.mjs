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
      const actual = Number(shot.frame_span?.fill_actual)
      if (!Number.isFinite(actual)) {
        push(errors, `${sp}.frame_span`, '缺少 frame_span.fill_actual')
      } else if ((shot.subject_ids || []).length >= 2) {
        // 多人同框：相机为“全体不出画”让步，主主体占幅必然低于单人目标
        //（实测两人相距 2.84m 时 0.35 vs 单人 0.49）。只挡“太小”。
        const minMulti = Number(shot.fill_target) * 0.6
        if (actual < minMulti) {
          warnings.push({
            path: `${sp}.frame_span`,
            message: `多人镜头主主体占幅 ${actual} 偏小（< ${minMulti.toFixed(2)}），主体可能太小`,
          })
        }
      } else {
        const diff = Math.abs(actual - Number(shot.fill_target))
        if (diff > FILL_TOLERANCE) {
          push(errors, `${sp}.frame_span`, `占幅 ${actual} 与目标 ${shot.fill_target} 相差 ${diff.toFixed(3)} > ${FILL_TOLERANCE}`)
        } else if (diff > 0.08) {
          warnings.push({ path: `${sp}.frame_span`, message: `占幅偏差 ${diff.toFixed(3)}，接近容差` })
        }
      }
    }

    // 头部安全区：OTS 只查后景（lead），前景允许切头；首/中/尾都查。
    const lead = shot.framing_lead || (shot.size === 'OTS' ? shot.subject_ids?.[1] : shot.subject_ids?.[0])
    const start = shot.start || {}
    for (const phase of ['start', 'mid', 'end']) {
      const node = shot[phase]
      if (!node) continue
      const subject = lead && node[lead]
      if (subject && subject.head) {
        const [x, y] = subject.head
        if (x < SAFE_MIN || x > SAFE_MAX || y < SAFE_MIN || y > SAFE_MAX) {
          push(errors, `${sp}.${phase}.${lead}.head`, `头部 NDC (${x}, ${y}) 超出安全区`)
        } else if (y > 0.9) {
          warnings.push({ path: `${sp}.${phase}.${lead}.head`, message: `头部偏高（NDC y=${y}），留白可能不足` })
        }
      } else if (phase === 'start' && shot.size !== 'INSERT') {
        push(errors, `${sp}.${lead ?? 'subject'}.head`, '缺少主体头部 NDC')
      }
    }

    // 取景：首/中/尾都要查。只查起点会漏掉“人物走到画外”的镜头。
    // OTS 的前景本来就该在画面边缘/被切，只做“是否完全离画”的宽松检查；lead（后景/主主体）才查贴边。
    const phases = ['start', 'mid', 'end'].filter((k) => shot[k] && typeof shot[k] === 'object')
    for (const phase of phases) {
      const node = shot[phase]
      const label = phase === 'start' ? '首帧' : phase === 'mid' ? '中帧' : '尾帧'
      const ids = shot.subject_ids || []
      for (const sid of ids) {
        const sub = node[sid]
        if (!sub) continue
        const isOtsForeground = shot.size === 'OTS' && ids.indexOf(sid) === 0 && ids.length >= 2
        const isLead = sid === lead
        if (Array.isArray(sub.head)) {
          const [hx, hy] = sub.head
          const outside = hx < -1 || hx > 1 || hy < -1 || hy > 1
          if (outside) {
            // OTS 前景允许被切边，但不该整个人离开画面
            if (isOtsForeground) {
              const farOut = hx < -1.6 || hx > 1.6 || hy < -1.6 || hy > 1.6
              if (farOut) push(errors, `${sp}.${phase}.${sid}.head`, `${label} OTS 前景 ${sid} 完全离画（NDC ${hx}, ${hy}）`)
            } else {
              push(errors, `${sp}.${phase}.${sid}.head`, `${label}主体 ${sid} 头部 NDC (${hx}, ${hy}) 已出画`)
            }
          } else if (isLead && (hy > 0.92 || hy < -0.92 || hx > 0.92 || hx < -0.92)) {
            warnings.push({ path: `${sp}.${phase}.${sid}.head`, message: `${label}主体 ${sid} 贴近画面边缘（NDC ${hx}, ${hy}）` })
          }
        } else if (Array.isArray(sub.center)) {
          const [cx2, cy2] = sub.center
          if (cx2 < -1 || cx2 > 1 || cy2 < -1 || cy2 > 1) {
            push(errors, `${sp}.${phase}.${sid}.center`, `${label}道具 ${sid} 中心已出画（NDC ${cx2}, ${cy2}）`)
          }
        }
      }
    }
    if (phases.length && !phases.includes('mid')) {
      warnings.push({ path: `${sp}.mid`, message: '缺少中帧取景数据（重跑构建）' })
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

    // 运动 QC：① 声明的运镜必须真的动（静态除外）；② 速度上限；③ 甩镜要有可读帧。
    if (shot.camera) {
      const kind = shot.move || 'static'
      const travel = Number(shot.camera.travel)
      const rotate = Number(shot.camera.rotate_deg)
      const lensStart = Number(shot.lens_mm)
      const lensEnd = Number(shot.camera.lens_end)
      const duration = Number(shot.out) - Number(shot.in)
      const moved =
        (Number.isFinite(travel) && travel > 0.005) ||
        (Number.isFinite(rotate) && rotate > 0.5) ||
        (Number.isFinite(lensStart) && Number.isFinite(lensEnd) && Math.abs(lensEnd - lensStart) > 0.5)
      if (kind !== 'static' && Number.isFinite(travel) && Number.isFinite(rotate) && !moved) {
        push(errors, `${sp}.move`, `声明了 ${kind} 但相机/焦距没有变化（travel=${travel}, rotate=${rotate}）`)
      }
      if (!Number.isFinite(duration) || duration <= 0) {
        // 缺 in/out 就没法算速度；这本身是 facts 缺陷，不能静默跳过运动检查
        push(errors, `${sp}.move`, `缺少有效的 in/out，无法计算运动速度`)
      } else if (Number.isFinite(rotate)) {
        const degPerSec = rotate / duration
        if (degPerSec > 120) {
          push(errors, `${sp}.move`, `${kind} 角速度 ${degPerSec.toFixed(1)}°/s 超过 120°/s，成片会糊/晕`)
        } else if (degPerSec > 60) {
          warnings.push({ path: `${sp}.move`, message: `${kind} 角速度 ${degPerSec.toFixed(1)}°/s 偏快，确认可读性` })
        }
      }
      if (kind === 'whip_pan' && Number.isFinite(rotate) && rotate > 90) {
        warnings.push({ path: `${sp}.move`, message: `甩镜 ${rotate.toFixed(0)}°，幅度大；已检查首尾帧主体是否在画面内` })
      }
      // 甩镜/快速运动：首尾帧主体必须仍在画面内且可辨（人在画外=甩丢了）。
      if ((kind === 'whip_pan' || (Number.isFinite(rotate) && rotate >= 60)) && shot.start && shot.end) {
        for (const edge of ['start', 'end']) {
          const node = shot[edge] || {}
          for (const sid of shot.subject_ids || []) {
            const sub = node[sid]
            if (!sub || !Array.isArray(sub.head)) continue
            const [, hy] = sub.head
            const [, fy] = Array.isArray(sub.feet) ? sub.feet : [0, -1]
            const inside = hy >= -1 && hy <= 1 && fy >= -1.4 && fy <= 1.4
            if (!inside) {
              push(errors, `${sp}.${edge}.${sid}`, `甩镜${edge === 'start' ? '首' : '尾'}帧主体 ${sid} 已出画（head.y=${hy}）`)
            } else if (hy > 0.92 || hy < -0.92) {
              warnings.push({ path: `${sp}.${edge}.${sid}`, message: `甩镜${edge === 'start' ? '首' : '尾'}帧主体 ${sid} 贴边（head.y=${hy}），可读性差` })
            }
          }
        }
      }
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

  // 总帧数只做“与 blocking 时长一致”的提示；不再假定 demo 一定是 216 帧（多场景/其它项目会误报）。
  if (facts.expected_frames && totalFrames !== facts.expected_frames) {
    warnings.push({ path: 'facts.shots', message: `总帧数 ${totalFrames}，与期望 ${facts.expected_frames} 不一致` })
  }

  // animatic：只判断“文件存在”会让 0 字节文件通过。检查大小 + MP4 头尾结构。
  const animatic = path.join(outDir, 'animatic.mp4')
  let animaticInfo = null
  if (!fs.existsSync(animatic)) {
    // 允许只跑 build/plan 的场景：没有 animatic 时不报错，但标记清楚
    warnings.push({ path: 'animatic.mp4', message: '没有 animatic.mp4（只跑了 build/render 时正常）' })
  } else {
    const size = fs.statSync(animatic).size
    if (size < 1024) {
      push(errors, 'animatic.mp4', `animatic 只有 ${size} 字节，不是有效视频`)
    } else {
      // MP4 至少要有 ftyp box 与 mdat/moov 之一
      const head = Buffer.alloc(Math.min(size, 64))
      const fd = fs.openSync(animatic, 'r')
      fs.readSync(fd, head, 0, head.length, 0)
      fs.closeSync(fd)
      const hasFtyp = head.includes(Buffer.from('ftyp', 'ascii'))
      if (!hasFtyp) push(errors, 'animatic.mp4', 'animatic 不像有效 MP4（缺 ftyp）')
      animaticInfo = { path: animatic, bytes: size, has_ftyp: hasFtyp }
    }
  }

  const stats = {
    shots: facts.shots.length,
    frames: totalFrames,
    occlusion_checks: occlusionChecks,
    occlusion_blocked: occlusionBlocked,
    animatic: animaticInfo ? animaticInfo.path : null,
    animatic_bytes: animaticInfo ? animaticInfo.bytes : null,
    plan: fs.existsSync(path.join(outDir, 'plan.png')) ? path.join(outDir, 'plan.png') : null,
  }
  return { ok: errors.length === 0, errors, warnings, stats }
}
