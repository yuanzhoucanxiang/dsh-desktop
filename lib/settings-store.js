'use strict'

/**
 * 外壳设置持久化（零 Electron 依赖，纯 node 可测）。
 *
 * 职责与事故史（logs/2026-08-22.md ㉒）：
 *   · 应用运行中会把内存 settings 整体写回磁盘——"应用拥有设置真源"是固有设计，
 *     磁盘上的外部直改会被覆盖，这不属于本模块要修的；
 *   · 本模块负责的是写侧的正确性：原子替换（写一半崩溃不产生半截文件）、
 *     读侧容错（BOM / 半截 / 非法 JSON 一律回落默认，不丢进程）、以及默认值合并
 *     （新版本加了默认项，旧磁盘文件自动补全，而不是整文件作废）。
 */

const { writeJsonAtomic, readJsonSafe } = require('./atomic-file')

/**
 * @param {object} opts
 * @param {string} opts.file    settings.json 的绝对路径
 * @param {object} opts.defaults 默认设置（新项从这里补全）
 * @param {Function} [opts.migrate] (diskData) => diskData ｜ 磁盘结构迁移钩子（可省）
 * @returns {{ load():object, save(obj):string, file:string }}
 */
function createSettingsStore(opts) {
  const { file, defaults, migrate } = opts
  const mergeDefaults = (disk) => ({ ...(defaults || {}), ...(disk || {}) })

  /** 读磁盘合并默认；磁盘损坏/缺失时纯默认。 */
  function load() {
    const disk = readJsonSafe(file)
    if (!disk || typeof disk !== 'object') return { ...(defaults || {}) }
    const migrated = migrate ? migrate(disk) : disk
    return mergeDefaults(migrated)
  }

  /** 原子写整个设置对象。 */
  function save(obj) {
    return writeJsonAtomic(file, obj)
  }

  return { load, save, file }
}

module.exports = { createSettingsStore }
