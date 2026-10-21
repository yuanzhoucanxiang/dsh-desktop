/**
 * 客户端共享状态：宿主快照 + 轮询 + 选中的产物 + 工作台是否在场。
 *
 * 轮询是**模式自己的事**（工作台不替模式轮询）：2.5s 一次 state，任务变化时通知
 * `jobs.subscribe`，产物变化时通知 `artifacts` 的读取方（列表由 last 快照提供）。
 */
import { api } from './api.js'

let last = null
let timer = null
let polling = false
const stateSubs = new Set()
const jobSubs = new Set()
const artifactSubs = new Set()
const runtimeSubs = new Set()

let workbenchPresent = false
const wbSubs = new Set()

let workbenchService = null
let activeModeId = null
const activeSubs = new Set()

let ui = { open: false, selected: null }
const uiSubs = new Set()

export function getLast() {
  return last
}

export function getUi() {
  return ui
}

export function setUi(patch) {
  ui = { ...ui, ...patch }
  for (const fn of [...uiSubs]) {
    try {
      fn()
    } catch {}
  }
}

export function subscribeUi(fn) {
  uiSubs.add(fn)
  return () => uiSubs.delete(fn)
}

export function subscribeState(fn) {
  stateSubs.add(fn)
  return () => stateSubs.delete(fn)
}

export function subscribeJobs(fn) {
  jobSubs.add(fn)
  return () => jobSubs.delete(fn)
}

export function subscribeArtifacts(fn) {
  artifactSubs.add(fn)
  return () => artifactSubs.delete(fn)
}

export function subscribeRuntime(fn) {
  runtimeSubs.add(fn)
  return () => runtimeSubs.delete(fn)
}

export function isWorkbenchPresent() {
  return workbenchPresent
}

export function setWorkbenchPresent(value) {
  const next = !!value
  if (workbenchPresent === next) return
  workbenchPresent = next
  for (const fn of [...wbSubs]) {
    try {
      fn()
    } catch {}
  }
}

export function subscribeWorkbench(fn) {
  wbSubs.add(fn)
  return () => wbSubs.delete(fn)
}

/** 接上工作台服务；订阅 active，供“进入模式”时渲染自己的全屏 overlay。 */
export function setWorkbenchService(wb) {
  workbenchService = wb || null
  activeModeId = workbenchService?.getActive?.() || null
  if (workbenchService?.subscribe) {
    try {
      workbenchService.subscribe(() => {
        const next = workbenchService.getActive?.() || null
        if (next === activeModeId) return
        activeModeId = next
        for (const fn of [...activeSubs]) {
          try {
            fn()
          } catch {}
        }
      })
    } catch (err) {
      console.warn('[previz] workbench subscribe failed:', err)
    }
  }
}

export function getActiveModeId() {
  return activeModeId
}

export function subscribeActive(fn) {
  activeSubs.add(fn)
  return () => activeSubs.delete(fn)
}

/** 从模式内退出：有工作台就走工作台的退出（会过守卫），否则关自己的 overlay。 */
export function exitPreviz() {
  if (workbenchService?.setActive) {
    return workbenchService.setActive(null, 'exit')
  }
  setUi({ open: false })
  return { ok: true }
}

function notify(set) {
  for (const fn of [...set]) {
    try {
      fn()
    } catch (err) {
      console.warn('[previz] subscriber failed:', err)
    }
  }
}

export async function refresh() {
  const next = await api('state')
  if (!next || next.ok === false) return next
  const prev = last
  last = next
  notify(stateSubs)
  if (prev?.job?.state !== next.job?.state || prev?.job?.progress !== next.job?.progress) notify(jobSubs)
  if ((prev?.artifacts?.length || 0) !== (next.artifacts?.length || 0)) notify(artifactSubs)
  if (prev?.runtime?.state !== next.runtime?.state) notify(runtimeSubs)
  return next
}

export function startPolling() {
  if (polling) return () => {}
  polling = true
  let stopped = false
  const tick = async () => {
    if (stopped) return
    await refresh()
    if (!stopped) timer = setTimeout(tick, 2500)
  }
  void tick()
  return () => {
    stopped = true
    polling = false
    if (timer) clearTimeout(timer)
    timer = null
  }
}
