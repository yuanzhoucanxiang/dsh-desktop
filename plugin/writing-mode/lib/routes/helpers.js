/**
 * 路由守卫小助手（2026-10-05 后端整治阶段二）：
 * 「读 JSON body → 400 invalid-json」「解析路径 → 400 path-outside-roots」「解析项目 → 400 invalid-project」
 * 这三种样板在 routes/* 里重复了 ~30 处，每处手写都是一次漏掉 400 的机会。
 * 约定：返回 null = 响应已写出（400），调用方直接 return；
 * 语义与原手写分支逐字节一致（错误码、状态码、响应顺序都不变）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { effectiveRoots, resolveUnderRoots, resolveProjectDir } from '../store.js'
import { readJsonBody, writeJson } from '../http.js'

/**
 * 写作伙伴/项目域统一的**项目身份**（2026-10-10）。
 *
 * 为什么要收在一处：`companion` 与 `coordination` 曾经各判各的——前者对"没有 project.md
 * 的库根"退回库根本身，后者走 `resolveProjectDir`（裸库根不是项目）→ 400。结果作者从
 * 设置里切到一个没有 project.md 的工作区后，伙伴面板直接报「协调服务不可用」。
 * 规则：① 必须是库内路径；② 能解析到项目目录就用它；③ 否则（裸库根/普通文件夹）用该
 * 目录本身；④ 指向文件时用其所在目录。返回 null = 越界，调用方自己回 400。
 */
export function companionProjectOf(rawPath, roots = effectiveRoots()) {
  const target = resolveUnderRoots(rawPath, roots)
  if (!target) return null
  const proj = resolveProjectDir(target.abs, roots)
  if (proj) return proj
  try {
    return fs.statSync(target.abs).isDirectory() ? target.abs : path.dirname(target.abs)
  } catch {
    return null
  }
}

/** 读 JSON body；坏 body 自己回 400 invalid-json，返回 null 表示已响应。 */
export async function readParsed({ req, res }) {
  const parsed = await readJsonBody(req)
  if (parsed === null) writeJson(res, 400, { ok: false, error: 'invalid-json' })
  return parsed
}

/** 解析库内路径（resolveUnderRoots）；越界自己回 400 path-outside-roots，返回 null 表示已响应。 */
export function targetUnder({ res, cfg }, rawPath) {
  const target = resolveUnderRoots(rawPath, effectiveRoots(cfg))
  if (target === null) writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
  return target
}

/**
 * 解析项目目录；失败自己回 400 invalid-project，返回 null 表示已响应。
 * 2026-10-10：改用 companionProjectOf —— 与伙伴/协调同一套判定，让"没有 project.md 的
 * 库根"也能用备忘/草稿等按项目分桶的能力（此前会 invalid-project，与伙伴能否绑定不一致）。
 */
export function projectUnder({ res, cfg }, rawPath) {
  const project = companionProjectOf(rawPath, effectiveRoots(cfg))
  if (!project) writeJson(res, 400, { ok: false, error: 'invalid-project' })
  return project
}
