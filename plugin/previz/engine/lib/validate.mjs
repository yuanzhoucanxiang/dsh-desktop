/**
 * P0 数据校验：project / set / blocking / shots。
 *
 * 刻意不引第三方 JSON Schema 库：P0 只需要一个**可读、可测、报 JSON Pointer** 的校验器。
 * 后续字段稳定后可换成 ajv，但错误路径格式保持不变。
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadScenes } from './scenes.mjs'

export const ROLES = new Set(['BODY', 'PROP', 'WOOD', 'DARK', 'WALL', 'RELIEF', 'FLOOR', 'EXTRA', 'SCRN'])
export const SHOT_SIZES = new Set(['ELS', 'LS', 'FS', 'MLS', 'MS', 'MCU', 'CU', 'ECU', 'OTS', 'TWO', 'INSERT'])
export const SCREEN_DIRECTIONS = new Set(['left_to_right', 'right_to_left', 'toward_camera', 'away_from_camera', 'hold'])
export const AXIS_SIDES = new Set(['left', 'right'])
export const MOVES = new Set([
  'static', 'pan', 'tilt', 'dolly_in', 'dolly_out', 'truck', 'pedestal', 'crane', 'orbit', 'handheld', 'whip_pan', 'zoom',
])

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isStr = (v) => typeof v === 'string' && v.trim().length > 0

function err(list, p, message) {
  list.push({ path: p, message })
}

function checkObj(list, p, v) {
  if (!isObj(v)) {
    err(list, p, '必须是对象')
    return false
  }
  return true
}

function checkNum(list, p, v, min = -Infinity, max = Infinity) {
  if (!isNum(v)) {
    err(list, p, `必须是数字（收到 ${JSON.stringify(v)}）`)
    return false
  }
  if (v < min || v > max) {
    err(list, p, `必须在 [${min}, ${max}] 内（收到 ${v}）`)
    return false
  }
  return true
}

function checkStr(list, p, v) {
  if (!isStr(v)) {
    err(list, p, '必须是非空字符串')
    return false
  }
  return true
}

function checkPos(list, p, v) {
  if (!Array.isArray(v) || v.length !== 2 || !v.every(isNum)) {
    err(list, p, '必须是 [x, y] 两个数字')
    return false
  }
  return true
}

function checkVec3(list, p, v) {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) {
    err(list, p, '必须是 [x, y, z] 三个数字')
    return false
  }
  return true
}

function checkRect(list, p, v) {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(isNum)) {
    err(list, p, '必须是 [x0, z0, x1, z1] 四个数字')
    return false
  }
  if (!(v[2] > v[0]) || !(v[3] > v[1])) {
    err(list, p, 'rect 必须满足 x1 > x0 且 z1 > z0')
    return false
  }
  return true
}

export function validateProject(project) {
  const e = []
  if (!checkObj(e, 'project', project)) return e
  if (project.schema !== 'dsh.previz/project@1') err(e, 'project.schema', '必须是 dsh.previz/project@1')
  checkStr(e, 'project.id', project.id)
  checkStr(e, 'project.title', project.title)
  checkNum(e, 'project.fps', project.fps, 1, 120)
  checkStr(e, 'project.aspect', project.aspect)
  if (!isObj(project.defaults)) err(e, 'project.defaults', '必须是对象')
  else {
    if (project.defaults.lens_mm !== undefined) checkNum(e, 'project.defaults.lens_mm', project.defaults.lens_mm, 5, 300)
    if (project.defaults.sensor_mm !== undefined) checkNum(e, 'project.defaults.sensor_mm', project.defaults.sensor_mm, 8, 70)
    if (project.defaults.review_res !== undefined) {
      const r = project.defaults.review_res
      if (!Array.isArray(r) || r.length !== 2 || !r.every((n) => Number.isInteger(n) && n > 0)) {
        err(e, 'project.defaults.review_res', '必须是 [width, height] 两个正整数')
      }
    }
  }
  return e
}

export function validateSet(set, { project } = {}) {
  const e = []
  if (!checkObj(e, 'set', set)) return e
  if (set.schema !== 'dsh.previz/set@1') err(e, 'set.schema', '必须是 dsh.previz/set@1')
  checkStr(e, 'set.scene', set.scene)
  if (project?.id && set.scene && typeof set.scene !== 'string') err(e, 'set.scene', '必须是字符串')
  if (!isObj(set.bounds)) err(e, 'set.bounds', '必须是对象')
  else {
    checkNum(e, 'set.bounds.w', set.bounds.w, 0.1, 200)
    checkNum(e, 'set.bounds.d', set.bounds.d, 0.1, 200)
    checkNum(e, 'set.bounds.h', set.bounds.h, 0.1, 50)
  }
  if (!Array.isArray(set.elements) || set.elements.length === 0) {
    err(e, 'set.elements', '必须是非空数组')
  } else {
    const ids = new Set()
    set.elements.forEach((el, i) => {
      const p = `set.elements[${i}]`
      if (!checkObj(e, p, el)) return
      checkStr(e, `${p}.id`, el.id)
      if (el.id && ids.has(el.id)) err(e, `${p}.id`, `重复的 id: ${el.id}`)
      if (el.id) ids.add(el.id)
      if (!ROLES.has(el.role)) err(e, `${p}.role`, `未知 role: ${el.role}`)
      if (el.type === 'box') {
        checkVec3(e, `${p}.pos`, el.pos)
        checkVec3(e, `${p}.size`, el.size)
      } else if (el.type === 'wall') {
        checkPos(e, `${p}.from`, el.from)
        checkPos(e, `${p}.to`, el.to)
        checkNum(e, `${p}.height`, el.height, 0.1, 20)
        checkNum(e, `${p}.thickness`, el.thickness, 0.01, 2)
        if (el.openings !== undefined) {
          if (!Array.isArray(el.openings)) err(e, `${p}.openings`, '必须是数组')
          else el.openings.forEach((o, j) => {
            const op = `${p}.openings[${j}]`
            if (!checkObj(e, op, o)) return
            checkStr(e, `${op}.id`, o.id)
            checkRect(e, `${op}.rect`, o.rect)
          })
        }
      } else {
        err(e, `${p}.type`, `P0 只支持 box / wall（收到 ${el.type}）`)
      }
    })
  }
  if (set.props !== undefined) {
    if (!Array.isArray(set.props)) err(e, 'set.props', '必须是数组')
    else set.props.forEach((pr, i) => {
      const p = `set.props[${i}]`
      if (!checkObj(e, p, pr)) return
      checkStr(e, `${p}.id`, pr.id)
      if (!ROLES.has(pr.role)) err(e, `${p}.role`, `未知 role: ${pr.role}`)
      if (pr.type !== 'box') err(e, `${p}.type`, 'P0 道具只支持 box')
      checkVec3(e, `${p}.pos`, pr.pos)
      checkVec3(e, `${p}.size`, pr.size)
    })
  }
  return e
}

export function validateBlocking(blocking, { set } = {}) {
  const e = []
  if (!checkObj(e, 'blocking', blocking)) return e
  if (blocking.schema !== 'dsh.previz/blocking@1') err(e, 'blocking.schema', '必须是 dsh.previz/blocking@1')
  checkStr(e, 'blocking.scene', blocking.scene)
  if (set?.scene && blocking.scene && blocking.scene !== set.scene) err(e, 'blocking.scene', `与 set.scene 不一致（${blocking.scene} ≠ ${set.scene}）`)
  checkNum(e, 'blocking.duration', blocking.duration, 0.5, 600)
  if (!isObj(blocking.actors) || Object.keys(blocking.actors).length === 0) {
    err(e, 'blocking.actors', '必须是非空对象')
  } else {
    for (const [id, a] of Object.entries(blocking.actors)) {
      const p = `blocking.actors.${id}`
      if (!checkObj(e, p, a)) continue
      checkNum(e, `${p}.height`, a.height, 1.2, 2.2)
      if (!Array.isArray(a.keys) || a.keys.length === 0) {
        err(e, `${p}.keys`, '必须是非空数组')
        continue
      }
      a.keys.forEach((k, i) => {
        const kp = `${p}.keys[${i}]`
        if (!checkObj(e, kp, k)) return
        checkNum(e, `${kp}.t`, k.t, 0, blocking.duration)
        checkPos(e, `${kp}.pos`, k.pos)
        checkNum(e, `${kp}.facing`, k.facing, -720, 720)
        if (k.pose !== undefined) checkStr(e, `${kp}.pose`, k.pose)
        if (k.gait !== undefined && !['walk', 'run'].includes(k.gait)) err(e, `${kp}.gait`, '必须是 walk 或 run')
      })
    }
  }
  if (blocking.moves !== undefined) {
    if (!Array.isArray(blocking.moves)) err(e, 'blocking.moves', '必须是数组')
    else blocking.moves.forEach((m, i) => {
      const p = `blocking.moves[${i}]`
      if (!checkObj(e, p, m)) return
      if (!blocking.actors?.[m.actor]) err(e, `${p}.actor`, `未知 actor: ${m.actor}`)
      checkNum(e, `${p}.from`, m.from, 0, blocking.duration)
      checkNum(e, `${p}.to`, m.to, 0, blocking.duration)
      if (isNum(m.from) && isNum(m.to) && !(m.to > m.from)) err(e, `${p}.to`, 'to 必须大于 from')
      if (!Array.isArray(m.path) || m.path.length < 2) err(e, `${p}.path`, '至少两个路径点')
      else m.path.forEach((pt, j) => checkPos(e, `${p}.path[${j}]`, pt))
      checkNum(e, `${p}.speed`, m.speed, 0.1, 10)
    })
  }
  if (blocking.props !== undefined) {
    if (!Array.isArray(blocking.props)) err(e, 'blocking.props', '必须是数组')
    else blocking.props.forEach((pr, i) => {
      const p = `blocking.props[${i}]`
      if (!checkObj(e, p, pr)) return
      checkStr(e, `${p}.id`, pr.id)
      checkVec3(e, `${p}.size`, pr.size)
      if (pr.attach) {
        if (!blocking.actors?.[pr.attach.actor]) err(e, `${p}.attach.actor`, `未知 actor: ${pr.attach.actor}`)
        if (!['L', 'R'].includes(pr.attach.hand)) err(e, `${p}.attach.hand`, '必须是 L 或 R')
      }
    })
  }
  return e
}

export function validateShots(shots, { blocking, set, project } = {}) {
  const e = []
  if (!checkObj(e, 'shots', shots)) return e
  if (shots.schema !== 'dsh.previz/shots@1') err(e, 'shots.schema', '必须是 dsh.previz/shots@1')
  checkStr(e, 'shots.scene', shots.scene)
  if (blocking?.scene && shots.scene && shots.scene !== blocking.scene) err(e, 'shots.scene', `与 blocking.scene 不一致（${shots.scene} ≠ ${blocking.scene}）`)
  if (!Array.isArray(shots.shots) || shots.shots.length === 0) {
    err(e, 'shots.shots', '必须是非空数组')
    return e
  }
  const ids = new Set()
  let total = 0
  if (shots.axis !== undefined) {
    if (!isObj(shots.axis)) err(e, 'shots.axis', '必须是对象')
    else {
      const line = shots.axis.line
      if (!Array.isArray(line) || line.length !== 2) err(e, 'shots.axis.line', '必须是两个点 [[x,y],[x,y]]')
      else {
        checkPos(e, 'shots.axis.line[0]', line[0])
        checkPos(e, 'shots.axis.line[1]', line[1])
      }
      if (shots.axis.side !== undefined && !AXIS_SIDES.has(shots.axis.side)) err(e, 'shots.axis.side', '必须是 left 或 right')
      if (shots.axis.screen_direction !== undefined && !SCREEN_DIRECTIONS.has(shots.axis.screen_direction)) {
        err(e, 'shots.axis.screen_direction', `未知屏幕方向: ${shots.axis.screen_direction}`)
      }
    }
  }
  shots.shots.forEach((s, i) => {
    const p = `shots.shots[${i}]`
    if (!checkObj(e, p, s)) return
    checkStr(e, `${p}.id`, s.id)
    if (s.id && ids.has(s.id)) err(e, `${p}.id`, `重复的镜号: ${s.id}`)
    if (s.id) ids.add(s.id)
    // 镜号前缀应与场景 id 一致（S04-01 属于 S04）；否则渲染目录会 S04/S03-01，人和机器都会看错。
    if (isStr(s.id) && isStr(shots.scene) && /^([A-Za-z]+\d+)-/.test(s.id)) {
      const prefix = s.id.split('-')[0]
      if (prefix !== shots.scene) err(e, `${p}.id`, `镜号前缀 ${prefix} 与场景 ${shots.scene} 不一致`)
    }
    checkNum(e, `${p}.in`, s.in, 0, blocking?.duration ?? 600)
    checkNum(e, `${p}.out`, s.out, 0, blocking?.duration ?? 600)
    if (isNum(s.in) && isNum(s.out)) {
      if (!(s.out > s.in)) err(e, `${p}.out`, 'out 必须大于 in')
      total += Math.max(0, s.out - s.in)
    }
    if (!Array.isArray(s.subjects) || s.subjects.length === 0) err(e, `${p}.subjects`, '必须是非空数组')
    else s.subjects.forEach((id, j) => {
      const known = !!blocking?.actors?.[id] || (blocking?.props || []).some((x) => x.id === id)
      if (!known) err(e, `${p}.subjects[${j}]`, `未知主体: ${id}`)
    })
    if (!SHOT_SIZES.has(s.size)) err(e, `${p}.size`, `未知景别: ${s.size}`)
    checkNum(e, `${p}.lens_mm`, s.lens_mm, 5, 300)
    if (!isObj(s.framing)) err(e, `${p}.framing`, '必须是对象')
    else checkNum(e, `${p}.framing.fill`, s.framing.fill, 0.05, 1)
    if (!isObj(s.camera)) err(e, `${p}.camera`, '必须是对象')
    else {
      if (!['solve', 'explicit'].includes(s.camera.mode)) err(e, `${p}.camera.mode`, '必须是 solve 或 explicit')
      if (s.camera.azimuth_deg !== undefined) checkNum(e, `${p}.camera.azimuth_deg`, s.camera.azimuth_deg, -360, 360)
      if (s.camera.height !== undefined) checkNum(e, `${p}.camera.height`, s.camera.height, 0, 50)
    }
    if (s.move !== undefined) {
      if (!isObj(s.move) || !MOVES.has(s.move.type)) err(e, `${p}.move.type`, `未知运镜: ${s.move?.type}`)
    }
    if (s.transition !== undefined && !['cut', 'dissolve', 'fade', 'fade_in', 'fade_out'].includes(s.transition)) {
      err(e, `${p}.transition`, `未知转场: ${s.transition}`)
    }
    if (s.screen_direction !== undefined && !SCREEN_DIRECTIONS.has(s.screen_direction)) {
      err(e, `${p}.screen_direction`, `未知屏幕方向: ${s.screen_direction}`)
    }
    if (s.beat !== undefined) checkStr(e, `${p}.beat`, s.beat)
  })
  if (blocking?.duration && Math.abs(total - blocking.duration) > 1e-6) {
    err(e, 'shots.shots', `镜头总时长 ${total} 与 blocking.duration ${blocking.duration} 不一致`)
  }
  if (project?.defaults?.lens_mm) {
    // 只是提示：镜头可以覆盖默认值，不当作错误。
  }
  return e
}

export function validateSceneDir(dir, prefix = '') {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
  let project, set, blocking, shots
  const e = []
  const at = (p) => (prefix ? `${prefix}.${p}` : p)
  // project.json 在场景目录里是可选的：多场景项目用根目录的配置（由 validateAll 合并进来）。
  if (fs.existsSync(path.join(dir, 'project.json'))) {
    try {
      project = read('project.json')
      e.push(...validateProject(project).map((x) => ({ ...x, path: at(x.path) })))
    } catch (ex) {
      err(e, at('project.json'), `读取/解析失败: ${ex.message}`)
    }
  }
  try {
    set = read('set.json')
    e.push(...validateSet(set, { project }).map((x) => ({ ...x, path: at(x.path) })))
  } catch (ex) {
    err(e, at('set.json'), `读取/解析失败: ${ex.message}`)
  }
  try {
    blocking = read('blocking.json')
    e.push(...validateBlocking(blocking, { set }).map((x) => ({ ...x, path: at(x.path) })))
  } catch (ex) {
    err(e, at('blocking.json'), `读取/解析失败: ${ex.message}`)
  }
  try {
    shots = read('shots.json')
    e.push(...validateShots(shots, { blocking, set, project }).map((x) => ({ ...x, path: at(x.path) })))
  } catch (ex) {
    err(e, at('shots.json'), `读取/解析失败: ${ex.message}`)
  }
  return { ok: e.length === 0, errors: e, data: { project, set, blocking, shots } }
}

/** 校验项目：多场景读 scenes.json 逐场景校验；旧结构直接校验根目录。 */
export function validateAll(dir) {
  const root = path.resolve(dir)
  const manifest = path.join(root, 'scenes.json')
  if (!fs.existsSync(manifest)) {
    return { ...validateSceneDir(root), scenes: null }
  }
  const e = []
  let scenes = []
  try {
    scenes = loadScenes(root)
  } catch (ex) {
    err(e, 'scenes.json', ex.message)
    return { ok: false, errors: e, data: {}, scenes: null }
  }
  const data = {}
  // 项目级配置（fps/aspect/defaults）由根 project.json 提供，场景继承。
  // 之前把根 project.json 复制进场景目录，之后改根配置场景仍用旧副本——改成运行时合并，不落盘。
  let rootProject = null
  try {
    rootProject = JSON.parse(fs.readFileSync(path.join(root, 'project.json'), 'utf8'))
  } catch (ex) {
    err(e, 'project.json', `读取/解析失败: ${ex.message}`)
  }
  for (const scene of scenes) {
    const r = validateSceneDir(scene.dir, `scenes.${scene.id}`)
    e.push(...r.errors)
    // 场景目录自己带 project.json 时以它为覆盖，否则继承根配置
    const ownProject = r.data?.project
    if (rootProject && !ownProject) {
      r.data.project = { ...rootProject }
      scene.inheritsProject = true
    } else if (rootProject && ownProject) {
      r.data.project = { ...rootProject, ...ownProject }
    }
    data[scene.id] = r.data
  }
  return { ok: e.length === 0, errors: e, data, scenes, project: rootProject }
}
