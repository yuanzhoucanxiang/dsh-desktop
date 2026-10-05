/**
 * 路由守卫小助手（2026-10-05 后端整治阶段二）：
 * 「读 JSON body → 400 invalid-json」「解析路径 → 400 path-outside-roots」「解析项目 → 400 invalid-project」
 * 这三种样板在 routes/* 里重复了 ~30 处，每处手写都是一次漏掉 400 的机会。
 * 约定：返回 null = 响应已写出（400），调用方直接 return；
 * 语义与原手写分支逐字节一致（错误码、状态码、响应顺序都不变）。
 */
import { effectiveRoots, resolveUnderRoots, resolveProjectDir } from '../store.js'
import { readJsonBody, writeJson } from '../http.js'

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

/** 解析项目目录（resolveProjectDir）；失败自己回 400 invalid-project，返回 null 表示已响应。 */
export function projectUnder({ res, cfg }, rawPath) {
  const project = resolveProjectDir(rawPath, effectiveRoots(cfg))
  if (!project) writeJson(res, 400, { ok: false, error: 'invalid-project' })
  return project
}
