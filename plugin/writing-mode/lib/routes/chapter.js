/**
 * 章节上下文路由（2026-10-11）：`route=chapter-context`。
 *
 * GET ?path=<稿件>  → 该稿件在作品里的章节定位（第几章/共几章、前后章、章末钩子、
 * 未兑现伏笔数、本章在场人物、大纲相关行），外加**可直接注入提示词的 lines**。
 * 写作伙伴发送时会带上它，所以伙伴能回答"这章该收什么、上一章留了什么、谁在场"。
 *
 * 只读；身份判定与 companion/coordination 同源（helpers.companionProjectOf），
 * 保证"伙伴绑得上的工作区，这里也一定给得出上下文"。
 */
import { effectiveRoots } from '../store.js'
import { writeJson } from '../http.js'
import { targetUnder, companionProjectOf } from './helpers.js'
import { chapterContext, chapterContextLines } from '../chapter-context.js'

export async function getChapterContext({ req, res, url, cfg }) {
  const rawPath = url.searchParams.get('path') || ''
  const target = targetUnder({ res, cfg }, rawPath)
  if (target === null) return
  const project = companionProjectOf(rawPath, effectiveRoots(cfg))
  if (!project) {
    writeJson(res, 400, { ok: false, error: 'invalid-project' })
    return
  }
  const context = chapterContext(project, target.abs)
  writeJson(res, 200, { ok: true, context, lines: chapterContextLines(context) })
}
