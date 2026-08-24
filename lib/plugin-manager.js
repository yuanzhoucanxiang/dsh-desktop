'use strict'

/**
 * 插件管理核心（零 Electron 依赖，可用普通 node 直接跑/测）。
 *
 * 背景：内核 web UI 对插件只有只读清单（pluginInventory 仅 list()，无启停 RPC），
 * 「设置→模组注入」页又因注册签名不兼容当前内核而崩溃空白——用户在桌面上没有任何
 * 按钮式的插件停用手段。本模块在外壳侧补齐：写 profile 的 cordis.patch.yml
 * （`- id: <entryId>` + `disabled: true`），内核 boot 时的 watchUserPatches 会热重载
 * 该文件、事务性重放补丁层，免重启生效（dsh-app-boot: "hot-reloaded on long-lived
 * surfaces"）。内核零修改。
 *
 * 关键语义（对齐 @deepseek-ai/dsh-app-boot applyEntryPatches）：
 *   · patch 条目按 `id` 精确匹配 loader entry；非 insert 条目做字段覆盖，后写的键胜出；
 *   · 带 name 的补丁会做 name 一致性校验，不匹配整条跳过——所以管理块只写 id+disabled；
 *   · 生效的禁用态 = 文件中「最后一条」对该 id 设了 disabled 的条目。
 *
 * 写入策略（保手工内容）：行级手术。解析器记录每个顶层条目的行区间与 disabled 键行号；
 * 禁用 = 就地翻 true 或追加两行管理块；启用 = 把 true 原地翻 false（**不删块**——实测
 * 内核对「补丁被移除」不会热回退已生效的 override，显式 false 才能即时生效，见下）。
 * 解析不了的文件一律拒绝写入（宁可不给开关也不毁手工编辑）。
 */

const fs = require('node:fs')
const path = require('node:path')
const { writeFileAtomic, backupFile } = require('./atomic-file')

/** 去引号 + 掐尾部注释（# 前须有空白，避免误伤 url/# 片段类值）。 */
function readScalar(raw) {
  let s = String(raw).trim()
  if (s.startsWith('#')) return { value: '', commentOnly: true }
  // 找引号外的 " #" 注释起点
  let inQuote = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuote) {
      if (c === inQuote) inQuote = null
    } else if (c === "'" || c === '"') {
      inQuote = c
    } else if (c === '#' && i > 0 && /\s/.test(s[i - 1])) {
      s = s.slice(0, i)
      break
    }
  }
  s = s.trim()
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    if (s.length >= 2) return { value: s.slice(1, -1) }
  }
  return { value: s }
}

const INDENT_OF = (line) => {
  const m = line.match(/^ */)
  return m ? m[0].length : 0
}
const isBlankOrComment = (line) => line.trim() === '' || line.trimStart().startsWith('#')

/**
 * 解析 cordis.patch.yml（patch-list 子集；结构看不懂就报错，绝不猜）。
 * @returns {{ok:boolean, error:string, entries:Array, emptyFlowListLine:number}}
 *   entries[]: { startLine, endLine, id, insert, unsupported,
 *                disabledLine, disabledValue }   行号均为 lines 下标（0 起）
 */
function parsePatchList(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const entries = []
  let emptyFlowListLine = -1

  const structural = lines.map((l) => ({ raw: l, indent: INDENT_OF(l), blank: isBlankOrComment(l) }))

  // 顶层空列表特例：去掉注释/空白后只剩 "[]" / "[" "]" 一类的流式空表
  const meaningful = lines.filter((l) => !isBlankOrComment(l))
  if (meaningful.length === 1 && meaningful[0].trim() === '[]') {
    emptyFlowListLine = lines.indexOf(meaningful[0])
    return { ok: true, error: '', entries, emptyFlowListLine }
  }

  for (let i = 0; i < lines.length; i++) {
    const cur = structural[i]
    if (cur.blank) continue
    // 只接受顶层 "- " 开头的条目起始行
    if (cur.indent !== 0 || !cur.raw.trimStart().startsWith('- ')) continue

    const entry = { startLine: i, endLine: i, id: undefined, insert: false, unsupported: false, disabledLine: -1, disabledValue: undefined }
    const firstTrim = cur.raw.trimStart().slice(2) // 去掉 "- "
    const contIndent = cur.indent + 2 + firstTrim.match(/^ */)[0].length

    // 首行要么 "- key: value"，要么 "- insert:"
    const m = firstTrim.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!m) return fail(i, '无法识别的条目起始行')
    const [, firstKey, firstVal] = m

    if (firstKey === 'insert' && firstVal.trim() === '') {
      entry.insert = true
      // 跳过嵌套列表块（比首行缩进更深的连续行）
      let j = i + 1
      for (; j < lines.length; j++) {
        const l = structural[j]
        if (l.blank) continue
        if (l.indent > cur.indent) continue
        break
      }
      entry.endLine = j - 1
      // 收尾吸收紧随的注释/空行归前一条目？不——保持它们为分隔符（endLine 停在最后一个结构行）
      entries.push(entry)
      i = j - 1
      continue
    }

    // 普通条目：首键可能是 id/name/disabled/config/…；后续键在 contIndent 缩进上
    let lastKeyEmptyValue = firstVal.trim() === '' // 块引入键（如 config:）才允许更深缩进的续块
    if (firstKey === 'id') {
      const sc = readScalar(firstVal)
      if (sc.commentOnly) return fail(i, 'id 值缺失')
      entry.id = sc.value
      if (/^!!/.test(firstVal.trim())) entry.unsupported = true
    } else if (firstKey === 'disabled') {
      setDisabled(entry, i, firstVal.trim())
    } else if (firstKey === 'name' && /^!!/.test(firstVal.trim())) {
      entry.unsupported = true
    } else if (!(firstKey === 'insert' || /^[A-Za-z_][\w-]*:(\s*\{\})?$/.test(firstTrim.trim()) || firstVal.trim() === '')) {
      // 未知键且带内联值：仍可跳过，但标记为不可切换形态
      entry.unsupported = true
    }

    // 逐个续键
    let j = i + 1
    for (; j < lines.length; j++) {
      const l = structural[j]
      if (l.blank) continue
      if (l.indent === 0 && l.raw.trimStart().startsWith('- ')) break // 下一条目
      if (l.indent === contIndent) {
        const km = l.raw.trim().match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
        if (!km) return fail(j, '无法识别的键行')
        const [, key, val] = km
        if (key === 'id') {
          const sc = readScalar(val)
          entry.id = sc.value
          if (/^!!/.test(val.trim())) entry.unsupported = true
        } else if (key === 'disabled') {
          setDisabled(entry, j, val.trim())
        } else if (/^!!/.test(val.trim())) {
          entry.unsupported = true
        }
        lastKeyEmptyValue = val.trim() === ''
        entry.endLine = j
        continue
      }
      if (l.indent > contIndent) {
        if (!lastKeyEmptyValue) return fail(j, '意外缩进（上一键已带值，不允许更深缩进）')
        continue // 空值键下的复杂值块（config 展开等）：整段 opaque 跳过
      }
      return fail(j, '意外的缩进')
    }
    entries.push(entry)
    i = j - 1
  }
  return { ok: true, error: '', entries, emptyFlowListLine }

  function fail(lineNo, why) {
    return { ok: false, error: `第 ${lineNo + 1} 行：${why}`, entries: [], emptyFlowListLine: -1 }
  }
  function setDisabled(entry, lineIdx, rawVal) {
    if (/^!!/.test(rawVal)) { entry.unsupported = true; entry.disabledLine = lineIdx; entry.disabledValue = rawVal; return }
    const sc = readScalar(rawVal)
    entry.disabledLine = lineIdx
    entry.disabledValue = sc.value === 'true' ? true : sc.value === 'false' ? false : sc.value
  }
}

/** 生效禁用态：最后一条对该 id 设了 disabled 的条目说了算；没有 → false。 */
function effectiveDisabled(entries, id) {
  let v = false
  for (const e of entries) if (e.id === id && e.disabledValue !== undefined) v = e.disabledValue === true
  return v
}

/** 是否存在会阻碍安全切换的形态（!!js 表达式等）。 */
function hasUnsupportedFor(entries, id) {
  return entries.some((e) => e.id === id && e.unsupported)
}

/**
 * 从插件的 dsh.bundle.patch 文本提取它自己插入的 entry id 列表
 * （`- insert:` 块内的 `- id:`；顶层 config 覆盖条目不算插件自己的行）。
 */
function entryIdsFromBundlePatch(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const ids = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)-\s+insert:\s*$/)
    if (!m) continue
    const baseIndent = m[1].length
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]
      if (l.trim() === '' || l.trimStart().startsWith('#')) continue
      const ind = INDENT_OF(l)
      if (ind <= baseIndent) break
      const idm = l.trim().match(/^-\s+id:\s*(.+)$/)
      if (idm) {
        const sc = readScalar(idm[1])
        if (sc.value && !ids.includes(sc.value)) ids.push(sc.value)
      }
    }
  }
  return ids
}

/** 读某插件包的 bundle patch 并提取 entryIds；读不到/未声明 → []。 */
function entryIdsForPackage(nodeModulesDir, name) {
  const pkgFile = path.join(nodeModulesDir, name, 'package.json')
  let pkg
  try {
    pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
  } catch {
    return []
  }
  const rel = pkg && pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch
  if (!rel || typeof rel !== 'string') return []
  try {
    return entryIdsFromBundlePatch(fs.readFileSync(path.join(nodeModulesDir, name, rel), 'utf8'))
  } catch {
    return []
  }
}

/**
 * 切换一个 entry id 的禁用态（行级手术，不改其它行）。
 * @param {string} file      cordis.patch.yml 绝对路径（不存在视为空表）
 * @param {string} id        目标 entry id
 * @param {boolean} disable  true=禁用 false=启用
 * @returns {{ok:boolean, error:string, changed:boolean}}
 */
function setEntryDisabled(file, id, disable) {
  let text = null
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    if (err.code !== 'ENOENT') return { ok: false, error: `读取失败：${err.message}`, changed: false }
  }

  if (text === null || text.trim() === '') {
    if (!disable) return { ok: true, error: '', changed: false } // 启用一个本就没禁用的东西
    const block = `# 由 dsh-desktop 插件管理写入\n- id: ${id}\n  disabled: true\n`
    try {
      writeFileAtomic(file, block)
      return { ok: true, error: '', changed: true }
    } catch (err) {
      return { ok: false, error: `写入失败：${err.message}`, changed: false }
    }
  }

  const parsed = parsePatchList(text)
  if (!parsed.ok) return { ok: false, error: `文件含无法解析的手工内容（${parsed.error}），已拒绝修改`, changed: false }
  if (hasUnsupportedFor(parsed.entries, id)) {
    return { ok: false, error: '该 id 存在表达式或复杂条目，为保护手工编辑已拒绝切换', changed: false }
  }
  if (!disable && !effectiveDisabled(parsed.entries, id)) {
    return { ok: true, error: '', changed: false }
  }
  if (disable && effectiveDisabled(parsed.entries, id)) {
    return { ok: true, error: '', changed: false } // 已是禁用态：幂等，不重复写
  }

  const lines = text.split(/\r?\n/)
  let changed = false

  if (disable) {
    // 最后一条带 disabled 键的匹配条目就地翻 true；否则最后一条普通匹配条目补一行；否则追加管理块
    const matching = parsed.entries.filter((e) => !e.insert && e.id === id)
    const withKey = [...matching].reverse().find((e) => e.disabledLine >= 0)
    if (withKey) {
      const indent = (lines[withKey.disabledLine].match(/^ */) || [''])[0]
      lines[withKey.disabledLine] = `${indent}disabled: true`
      changed = true
    } else {
      const plain = [...matching].reverse().find((e) => !e.insert && !e.unsupported)
      if (plain) {
        const idLine = lines[plain.startLine]
        const indent = (idLine.match(/^ */) || [''])[0] + '  '
        lines.splice(plain.startLine + 1, 0, `${indent}disabled: true`)
        changed = true
      } else {
        appendBlock(lines, parsed, `- id: ${id}\n  disabled: true`)
        changed = true
      }
    }
  } else {
    // 启用 = 把 true 原地翻 false，**绝不删块**。实测内核 watchUserPatches 热重载
    // 对「补丁被移除、列表回到 []」不会回退已生效的 override（禁用能热上、
    // 删块不能热撤），而显式 disabled:false 是真实内容变更 + 语义覆盖，秒级生效。
    // 从后往前翻，行号不失效。
    const targets = parsed.entries.filter((e) => !e.insert && e.id === id && e.disabledValue === true).sort((a, b) => b.startLine - a.startLine)
    for (const e of targets) {
      const indent = (lines[e.disabledLine].match(/^ */) || [''])[0]
      lines[e.disabledLine] = `${indent}disabled: false`
      changed = true
    }
  }

  if (!changed) return { ok: true, error: '', changed: false }
  try {
    backupFile(file)
    writeFileAtomic(file, lines.join('\n').replace(/\n*$/, '\n'))
    return { ok: true, error: '', changed: true }
  } catch (err) {
    return { ok: false, error: `写入失败：${err.message}`, changed: false }
  }
}

/** 把管理块追加到顶层列表末尾（空流式表 `[]` 则原位替换该行）。 */
function appendBlock(lines, parsed, blockText) {
  if (parsed.emptyFlowListLine >= 0) {
    lines.splice(parsed.emptyFlowListLine, 1, '# 由 dsh-desktop 插件管理写入', ...blockText.split('\n'))
    return
  }
  // 找最后一个顶层条目的结束行；没有条目就放文件末尾
  let at = lines.length
  if (parsed.entries.length) {
    at = Math.max(...parsed.entries.map((e) => e.endLine)) + 1
    // 跳过紧随的空行，贴着列表尾巴插
    while (at < lines.length && lines[at].trim() === '') at++
  } else {
    while (at > 0 && lines[at - 1].trim() === '') at--
  }
  lines.splice(at, 0, '# 由 dsh-desktop 插件管理写入', ...blockText.split('\n'))
}

module.exports = { parsePatchList, effectiveDisabled, entryIdsFromBundlePatch, entryIdsForPackage, setEntryDisabled }
