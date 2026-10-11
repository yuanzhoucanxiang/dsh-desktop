/**
 * 章节上下文测试（2026-10-11）：隔离 DSH_HOME + %TEMP% 作品目录，不碰真实稿件。
 * 覆盖：章节定位/前后章/钩子/伏笔计数/在场人物/大纲相关行/未保存正文优先/空作品退化。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chapterContext, chapterContextLines } from '../lib/chapter-context.js'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-chapter-'))
process.env.DSH_HOME = path.join(temp, 'home')
fs.mkdirSync(process.env.DSH_HOME, { recursive: true })

let pass = 0
const failures = []
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failures.push(name); console.log('FAIL ' + name + '  [' + detail + ']') }
}

const proj = path.join(temp, '长篇')
const w = (rel, text) => {
  const abs = path.join(proj, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, text)
  return abs
}
w('project.md', '# 长篇\n\n一句话：一个关于回家的故事。\n')
w('outline/structure.md', '# 结构\n\n## 第一部\n- 第1章：归乡\n- 第2章：旧屋\n- 第3章：雪夜\n')
w('outline/foreshadow.md', '| 伏笔 | 状态 |\n|---|---|\n| 钟声 | 未兑现 |\n| 旧照片 | 未兑现 |\n| 信 | 已回收 |\n')
w('bible/characters.md', '# 人物\n\n## 林默\n主角。\n\n## 母亲\n\n## 老周\n')
const ch1 = w('draft/novel/第1章-v1.md', '# 第1章 归乡\n\n林默下了车。\n\n章末钩子：钟声从远处传来。\n')
const ch2 = w('draft/novel/第2章-v1.md', '# 第2章 旧屋\n\n母亲在门口等着。\n\n章末钩子：门后有人。\n')
w('draft/novel/第3章-v1.md', '# 第3章 雪夜\n\n雪还在下。\n\n章末钩子：灯灭了。\n')

// ── 定位到第 2 章 ─────────────────────────────────────────────────────
{
  const ctx = chapterContext(proj, ch2)
  ok('章节定位：第 2/3 章', ctx && ctx.index === 2 && ctx.total === 3, JSON.stringify({ i: ctx?.index, t: ctx?.total }))
  ok('章节名去掉版本号与扩展名', ctx && ctx.label === '第2章', String(ctx?.label))
  ok('上一章有名字与钩子', ctx && ctx.prev && ctx.prev.name === '第1章-v1.md' && /钟声/.test(ctx.prev.hook), JSON.stringify(ctx?.prev))
  ok('下一章为第 3 章', ctx && ctx.next && /第3章/.test(ctx.next.name), JSON.stringify(ctx?.next?.name))
  ok('本章钩子（章末钩子优先）', ctx && /门后有人/.test(ctx.hook), String(ctx?.hook))
  ok('未兑现伏笔计数 = 2（"已回收"不算）', ctx && ctx.foreshadowOpen === 2, String(ctx?.foreshadowOpen))
  ok('在场人物：只列正文里真出现的', ctx && ctx.characters.includes('母亲') && !ctx.characters.includes('老周') && !ctx.characters.includes('林默'), JSON.stringify(ctx?.characters))
  ok('大纲相关行命中本章', ctx && ctx.structure.some((s) => s.includes('第2章')), JSON.stringify(ctx?.structure))
  ok('summary 一行含定位/钩子/伏笔/在场', ctx && /第 2\/3 章/.test(ctx.summary) && /门后有人/.test(ctx.summary) && /未兑现伏笔 2 条/.test(ctx.summary) && /母亲/.test(ctx.summary), String(ctx?.summary))
  ok('chapterContextLines 产出可注入的行', chapterContextLines(ctx).length >= 1 && /章节定位/.test(chapterContextLines(ctx)[0]), JSON.stringify(chapterContextLines(ctx)))
}

// ── 用内存正文（未保存的改动也算）────────────────────────────────────
{
  const ctx = chapterContext(proj, ch1, { text: '# 第1章\n\n林默和老周在雪里站着。\n' })
  ok('未保存正文优先：在场人物跟着内存文本走', ctx && ctx.characters.includes('老周') && ctx.characters.includes('林默') && !ctx.characters.includes('母亲'), JSON.stringify(ctx?.characters))
}

// ── 没有正在写的稿：退化成最新一章 ──────────────────────────────────
{
  const ctx = chapterContext(proj, '')
  ok('无稿件时退化到最后一章', ctx && ctx.index === 3 && /第3章/.test(ctx.label), JSON.stringify({ i: ctx?.index, l: ctx?.label }))
}

// ── 没有章节结构的作品 → null（不编造）───────────────────────────────
{
  const bare = path.join(temp, '空作品')
  fs.mkdirSync(bare, { recursive: true })
  fs.writeFileSync(path.join(bare, 'project.md'), '# 空作品\n')
  const ctx = chapterContext(bare, path.join(bare, 'project.md'))
  ok('没有章节结构 → null（调用方就不注入）', ctx === null, JSON.stringify(ctx))
  ok('chapterContextLines(null) → 空数组', Array.isArray(chapterContextLines(null)) && chapterContextLines(null).length === 0)
}

console.log(`\n${failures.length ? 'CHAPTER_CONTEXT_FAIL' : 'CHAPTER_CONTEXT_OK'} ${pass} passed, ${failures.length} failed`)
if (failures.length) console.log('失败项：' + failures.join(' | '))
process.exit(failures.length ? 1 : 0)
