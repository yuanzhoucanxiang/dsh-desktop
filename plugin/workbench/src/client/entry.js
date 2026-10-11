/**
 * 工具台客户端入口（ESM 源码；构建经 esbuild 打包为 client.js 的 ModuleLoader 工厂体）。
 *
 * P0 只做三件事（docs/plans/workbench-layer-v1.md §8）：
 *   ① 建立模式注册表并作为服务 `workbench` 提供给模式（`ctx.reflect.provide`，
 *      与内核 sidebarRightTabs 的惯用法一致）
 *   ② 注册统一入口（sidebar.footer.action）+ 切换器浮层（shell.overlay）+ 设置段
 *   ③ 与 host 同步"当前模式"（状态权威在 host）
 *
 * 两模式（写作 / GIR）**本轮不接入**；它们照旧各自注册自己的入口，互不影响。
 *
 * 注意：本目录下不要再出现与 entry.js 只差大小写的文件名（Windows 文件系统不区分大小写，
 * 会把两个文件当成同一个——Entry.js 曾把本文件覆盖掉）。组件叫 FooterEntry.js。
 */
import * as react from 'react'
import { createRegistry } from './registry.js'
import { ensureCss } from './styles.js'
import { setRegistry } from './runtime.js'
import { fetchState, pushState } from './host-api.js'
import { T } from './copy.js'
import { WorkbenchEntry } from './FooterEntry.js'
import { WorkbenchChrome } from './Chrome.js'
import { WorkbenchSettings } from './Settings.js'

const __wbAlreadyLoaded = window.__dshWorkbenchLoaded === true
window.__dshWorkbenchLoaded = true

export const name = 'workbench'
export const inject = __wbAlreadyLoaded ? [] : ['slots']

let liveRegistry = null
let restoreTarget = null
let restored = false

export function apply(ctx) {
  if (__wbAlreadyLoaded) return
  ensureCss()

  const registry = createRegistry({
    onPersist: (patch) => {
      void pushState(patch)
    },
  })
  liveRegistry = registry
  setRegistry(registry)

  // ① 服务：模式用 ctx.inject(['workbench'], (scope) => scope.workbench.registerMode({...})) 接入。
  try {
    ctx.effect(() => ctx.reflect.provide('workbench', registry), 'workbench: service')
  } catch (err) {
    console.warn('[workbench] provide service failed:', err)
  }

  // ③ 从 host 恢复上次激活的模式。模式可能比工具台晚注册，所以注册表每次变化都再试一次。
  const tryRestore = () => {
    if (restored || !restoreTarget) return
    if (!registry.has(restoreTarget)) return
    restored = true
    registry.adopt(restoreTarget)
  }
  registry.subscribe(tryRestore)
  void fetchState().then((result) => {
    if (!result?.ok) return
    const id = result.state?.activeModeId || null
    if (!id) return
    restoreTarget = id
    tryRestore()
  })

  const register = (slot, options, Component, tag) => {
    try {
      ctx.effect(() => ctx.slots.inject(slot, () => ctx.slots.register(options, Component)), tag)
    } catch (err) {
      console.warn('[workbench] slot register failed:', slot, err)
    }
  }

  // ② 统一入口 / 切换器 / 设置段
  register('sidebar.footer.action', { name: 'sidebar.footer.action', id: 'workbench', order: 10, label: () => T.entry }, WorkbenchEntry, 'workbench: entry')
  register('shell.overlay', { name: 'shell.overlay', id: 'workbench', order: 10, label: () => T.entry }, WorkbenchChrome, 'workbench: switcher')
  register('settings.section', { name: 'settings.section', id: 'workbench', order: 45, label: () => T.settings }, WorkbenchSettings, 'workbench: settings')

  console.info('[workbench] client ready · entry + switcher + settings（P0：无模式接入）')
}

/** 测试钩子：让探针拿到活着的注册表（真实 Electron 验收脚本用）。 */
export function __workbenchRegistry() {
  return liveRegistry
}

export { createRegistry }
