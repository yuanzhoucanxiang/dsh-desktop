/**
 * 路由分发表：route 名 → 处理函数（与 lib/http.js 的 ROUTE_METHODS 一一对应）。
 * index.js 的 handler 中间件做完可信判定 / 方法白名单 / 长度与 JSON 门禁 /
 * 损坏配置守卫后，按这张表分发；同名多方法的路由在处理函数内按 req.method 分支。
 */
import { getConfigList, getTree, postPrefs, postRoots } from './config.js'
import { getDirs } from './fs.js'
import { getDoc, saveDoc, deleteDocRoute, postGate, postLedger, getStats, getOutline, postReorder } from './docs.js'
import { getTemplates, postProjectResource, postCreateProject, postCompile, postArchiveExport, getWiki } from './project.js'
import { getMemory, postMemory, getMemoryOperation, settingProjectionRoute, maintenanceRoute, projectRecoveryRoute } from './memory.js'
import { getDraft, postDraft, companionRoute, postAssist, coordinationRoute } from './sessions.js'

/** draft / world-draft 共用一对处理函数（桶后缀由 route 名决定）。 */
function draftRoute(ctx) {
  return ctx.req.method === 'GET' ? getDraft(ctx) : postDraft(ctx)
}

/** memory GET/POST 原是两个分支块，分发上互斥，合并为一个入口。 */
function memoryRoute(ctx) {
  return ctx.req.method === 'GET' ? getMemory(ctx) : postMemory(ctx)
}

export const ROUTE_HANDLERS = {
  '': getConfigList,
  config: getConfigList,
  list: getConfigList,
  tree: getTree,
  dirs: getDirs,
  prefs: postPrefs,
  roots: postRoots,
  get: getDoc,
  save: saveDoc,
  version: saveDoc,
  delete: deleteDocRoute,
  gate: postGate,
  ledger: postLedger,
  stats: getStats,
  outline: getOutline,
  reorder: postReorder,
  templates: getTemplates,
  'project-resource': postProjectResource,
  'create-project': postCreateProject,
  compile: postCompile,
  'archive-export': postArchiveExport,
  wiki: getWiki,
  memory: memoryRoute,
  'memory-operation': getMemoryOperation,
  'setting-projection': settingProjectionRoute,
  maintenance: maintenanceRoute,
  'project-recovery': projectRecoveryRoute,
  coordination: coordinationRoute,
  companion: companionRoute,
  assist: postAssist,
  draft: draftRoute,
  'world-draft': draftRoute,
}
