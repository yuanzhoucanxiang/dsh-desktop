/**
 * 项目域路由（templates / project-resource / create-project / compile / archive-export / wiki）。
 * 从 index.js 原样搬出，行为不变；ctx = { req, res, url, route, cfg }。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  readDoc, writeDoc, storeError, effectiveRoots, resolveUnderRoots, resolveProjectDir,
  scanTree, prepareProjectTarget, isSafeTemplateRel, createTemplateFile, realOrNull,
  listProjectFiles, writeExportFile,
} from '../store.js'
import { listTemplates, renderTemplate, renderStarter, PROJECT_RESOURCES } from '../templates.js'
import { latestOfSeries, naturalSortFiles, chapterTitle, safeBookTitle, compileBook } from '../compile.js'
import { parseWikiPage, renderWikiSite } from '../archive-site.js'
import { assembleArchiveModel, buildArchiveModel, WIKI_CSP } from '../archive-model.js'
import { writeJson, readJsonBody } from '../http.js'

/** GET templates：可用项目模板。 */
export async function getTemplates({ res }) {
  writeJson(res, 200, { ok: true, templates: listTemplates() })
}

/** POST project-resource：按需添加一份资料（固定白名单 + 排他创建）。 */
export async function postProjectResource({ req, res, cfg }) {
  const body = await readJsonBody(req)
  const roots = effectiveRoots(cfg)
  const project = body && resolveProjectDir(body.path, roots)
  if (!project || !PROJECT_RESOURCES.some(([rel]) => rel === body.resource)) {
    writeJson(res, 400, { ok: false, error: 'invalid-project-resource' }); return
  }
  try {
    const marker = fs.existsSync(path.join(project, 'project.md')) ? readDoc(resolveUnderRoots(path.join(project, 'project.md'), roots)).content : ''
    const templateId = marker.includes('短剧') ? 'shortdrama' : /电影|剧集/.test(marker) ? 'screenplay' : 'novel'
    const file = renderTemplate(templateId, path.basename(project), '').files.find(f => f.rel === body.resource)
    const created = createTemplateFile(project, file, roots)
    writeJson(res, 200, { ok: true, path: created })
  } catch (err) {
    writeJson(res, err.code === 'EEXIST' ? 409 : 400, { ok: false, error: err.code === 'EEXIST' ? 'resource-exists' : String(err.code || err.message) })
  }
}

/** POST create-project：轻量建项（默认 project.md + 首篇正文）。 */
export async function postCreateProject({ req, res, cfg }) {
  const parsed = await readJsonBody(req)
  if (parsed === null) {
    writeJson(res, 400, { ok: false, error: 'invalid-json' })
    return
  }
  const title = String(parsed.title || '').trim() || '未命名项目'
  const premise = String(parsed.premise || '').trim()
  const tmpl = (parsed.fullTemplate === true ? renderTemplate : renderStarter)(parsed.templateId || 'novel', title, premise)
  const roots = effectiveRoots(cfg)
  const rootPath =
    (typeof parsed.root === 'string' && parsed.root) ||
    cfg.activeRoot ||
    (roots.find((r) => r.real) || {}).real
  if (!rootPath) {
    writeJson(res, 400, { ok: false, error: 'no-root' })
    return
  }
  const prepared = prepareProjectTarget(rootPath, title, roots)
  if (!prepared.ok) {
    const status = prepared.error === 'project-exists' || prepared.error === 'directory-not-empty' ? 409 : 400
    writeJson(res, status, {
      ok: false,
      error: prepared.error,
      ...(prepared.path ? { path: prepared.path } : {}),
    })
    return
  }
  const { dirName, target } = prepared
  const written = []
  try {
    // Validate the entire template before creating anything. New parents
    // must then be materialized one level at a time: resolveUnderRoots
    // deliberately only accepts a missing leaf under an existing parent.
    const files = tmpl.files.filter(f => f.rel && !f.rel.endsWith('.gitkeep'))
    if (files.some(f => !isSafeTemplateRel(f.rel))) {
      writeJson(res, 500, { ok: false, error: 'template-path-unsafe' })
      return
    }
    fs.mkdirSync(target.abs, { recursive: true })
    for (const f of files) {
      createTemplateFile(target.abs, f, roots)
      written.push(f.rel)
    }
  } catch (err) {
    writeJson(res, 500, { ok: false, error: String(err?.message || err) })
    return
  }
  writeJson(res, 200, {
    ok: true,
    project: { name: dirName, path: target.abs, template: tmpl.id, files: written },
    tree: scanTree(cfg),
  })
}

/**
 * POST compile：把项目里各章的**当前版**按文档树顺序拼成一份完整书稿，
 * 独占创建在项目根（<书名>-vN.<ext>，可见于文档树；原稿一律只读不动）。
 * body: { path（项目内任意路径）, include?（rel 数组，顺序即章节顺序）, title?, titles? }
 * include 省略时默认收 draft/ 下的文本文件，并按系列只取最新版。
 */
export async function postCompile({ req, res, cfg }) {
  const parsed = await readJsonBody(req)
  if (parsed === null) {
    writeJson(res, 400, { ok: false, error: 'invalid-json' })
    return
  }
  const roots = effectiveRoots(cfg)
  const target = resolveUnderRoots(parsed?.path || '', roots)
  if (target === null) {
    writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
    return
  }
  const found = resolveProjectDir(target.abs, roots)
  const projectReal = found && realOrNull(found)
  if (!projectReal) {
    writeJson(res, 400, { ok: false, error: 'no-project' })
    return
  }
  const scope = [{ path: projectReal, real: projectReal }]
  const files = listProjectFiles(projectReal)
  const byRel = new Map(files.map((f) => [f.rel.toLowerCase(), f]))
  let selected = []
  let skipped = []
  const include = Array.isArray(parsed?.include) ? parsed.include : null
  if (include) {
    if (include.length === 0) {
      writeJson(res, 400, { ok: false, error: 'empty-include' })
      return
    }
    const seenAbs = new Set()
    for (const item of include) {
      const rel = String(item || '').replaceAll('\\', '/')
      if (!isSafeTemplateRel(rel)) {
        writeJson(res, 400, { ok: false, error: 'bad-include', rel: String(item ?? '') })
        return
      }
      const inProject = resolveUnderRoots(path.join(projectReal, ...rel.split('/')), scope)
      const f = inProject ? byRel.get(rel.toLowerCase()) : null
      if (!f) {
        writeJson(res, 400, { ok: false, error: 'unknown-include', rel })
        return
      }
      if (seenAbs.has(f.abs.toLowerCase())) continue
      seenAbs.add(f.abs.toLowerCase())
      selected.push(f)
    }
  } else {
    const drafts = files.filter((f) => f.rel.startsWith('draft/'))
    if (drafts.length === 0) {
      writeJson(res, 400, { ok: false, error: 'no-drafts' })
      return
    }
    const r = latestOfSeries(drafts)
    selected = naturalSortFiles(r.latest)
    skipped = r.skipped.map((f) => f.rel)
  }
  const exts = [...new Set(selected.map((f) => f.ext.toLowerCase()))]
  if (exts.length > 1) {
    writeJson(res, 400, { ok: false, error: 'mixed-formats', exts })
    return
  }
  const ext = exts[0]
  const format = ext === '.fountain' ? 'fountain' : 'markdown'
  const bookTitle = safeBookTitle(parsed?.title ?? path.basename(projectReal))
  if (!bookTitle) {
    writeJson(res, 400, { ok: false, error: 'invalid-title' })
    return
  }
  let entries
  try {
    entries = selected.map((f) => ({ title: chapterTitle(f.name), content: fs.readFileSync(f.abs, 'utf8') }))
  } catch {
    // 扫描到读取之间文件被移走/改名：如实报，不写半成品
    writeJson(res, 409, { ok: false, error: 'source-changed' })
    return
  }
  const date = new Date().toLocaleString('zh-CN', { hour12: false })
  const book = compileBook(entries, { format, title: bookTitle, date, titles: parsed?.titles !== false })
  try {
    let doc = null
    for (let n = 1; n <= 100 && !doc; n++) {
      const out = resolveUnderRoots(path.join(projectReal, `${bookTitle}-v${n}${ext}`), scope)
      try {
        doc = writeDoc(out, book.text, null) // 独占创建：已存在就试下一个编号，绝不覆盖
      } catch (err) {
        if (err.status !== 409) throw err
      }
    }
    if (!doc) throw storeError('version-conflict', 409)
    writeJson(res, 200, {
      ok: true,
      doc: { path: doc.path, chars: doc.chars, revision: doc.revision },
      stats: { files: book.files, chars: book.chars, skipped },
    })
  } catch (err) {
    writeJson(res, err.status || 500, { ok: false, error: String(err?.message || err) })
  }
}

/**
 * POST archive-export：与档案面板同一口径的**只读投影**，自包含单文件，便于分享与打印。
 * 独占创建在项目根（<书名>-档案-vN.html，绝不覆盖）；.html 不在 TEXT_EXTS 里，
 * 所以档案页不会混进文档库、也不参与成书候选；与 compile 一样不记码字账。
 * body: { path（项目内任意路径）, title?（书名，默认取目录名） }
 */
export async function postArchiveExport({ req, res, cfg }) {
  const parsed = await readJsonBody(req)
  if (parsed === null) {
    writeJson(res, 400, { ok: false, error: 'invalid-json' })
    return
  }
  const roots = effectiveRoots(cfg)
  const target = resolveUnderRoots(parsed?.path || '', roots)
  if (target === null) {
    writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
    return
  }
  const found = resolveProjectDir(target.abs, roots)
  const projectReal = found && realOrNull(found)
  if (!projectReal) {
    writeJson(res, 400, { ok: false, error: 'no-project' })
    return
  }
  let built
  try {
    built = assembleArchiveModel(projectReal, cfg.prefs, parsed?.title)
  } catch (err) {
    writeJson(res, err.status || 500, { ok: false, error: String(err?.message || err) })
    return
  }
  const { html, bookTitle, counts } = built
  try {
    const scope = [{ path: projectReal, real: projectReal }]
    let written = null
    for (let n = 1; n <= 100 && !written; n++) {
      const out = resolveUnderRoots(path.join(projectReal, `${bookTitle}-档案-v${n}.html`), scope)
      try {
        written = writeExportFile(out, html) // 独占创建：已存在就试下一个编号，绝不覆盖
      } catch (err) {
        if (err.status !== 409) throw err
      }
    }
    if (!written) throw storeError('version-conflict', 409)
    writeJson(res, 200, {
      ok: true,
      doc: { path: written.path, bytes: written.bytes },
      stats: counts,
    })
  } catch (err) {
    writeJson(res, err.status || 500, { ok: false, error: String(err?.message || err) })
  }
}

/**
 * GET wiki：作品档案页（HTML 文档，只读）：与 archive-export 同一份组装口径（buildArchiveModel），但**不落盘**。
 * 它是「档案作为一个页面」的地址——独立窗口（shell:open-wiki）或浏览器直接打开都走这里。
 * 形态是**多页站点**（lib/archive-site.js）：query 的 page 参数是白名单页 id
 * （index 首页 / settings / progress / ledger / docs / doc-N 篇目 / doc-N-sK 节 / ch-N 章），
 * 缺省首页、非法形状回首页、越界页逐层回落（节→篇→资料，章→进度）。
 * 每次请求现算、明确不缓存（缓存里的设定是过期的，比没有更糟）；CSP 关掉脚本/图片/连接，
 * 作者稿子里的东西只能当文字看。query: path（项目内任意路径）, page?（页 id）
 */
export async function getWiki({ req, res, url, cfg }) {
  const roots = effectiveRoots(cfg)
  const target = resolveUnderRoots(url.searchParams.get('path') || '', roots)
  if (target === null) {
    writeJson(res, 400, { ok: false, error: 'path-outside-roots' })
    return
  }
  const found = resolveProjectDir(target.abs, roots)
  const projectReal = found && realOrNull(found)
  if (!projectReal) {
    writeJson(res, 400, { ok: false, error: 'no-project' })
    return
  }
  try {
    // 切换器只列**真能渲染的作品**：scanTree 会把库根本身（根目录下的散稿）也算成
    // 一个条目，那种路径 resolveProjectDir 给不出结果，点了就是死链（实测撞到过）。
    // 两道闸都要有：resolveProjectDir 为 null 时**不能**把空串交给 realOrNull
    // （Windows 上 realpathSync('') 会返回进程 cwd，于是链接能指到仓库目录去）；
    // 解析出来的目录还必须仍在库根内，越界一律不列。
    // 名单沿用 scanTree 而不是另写一套目录扫描——「库里有哪些作品」只该有一处说法；
    // 代价是每次开页多走一遍目录，而档案页是作者点开才算、不轮询。
    const seen = new Set()
    const projects = []
    for (const r of scanTree(cfg)) {
      for (const p of (r.projects || [])) {
        const dir = resolveProjectDir(p.path, roots)
        const resolved = dir ? realOrNull(dir) : null
        if (!resolved || resolveUnderRoots(resolved, roots) === null) continue
        const key = resolved.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        projects.push({ path: resolved, name: p.name, rootLabel: r.label || '' })
      }
    }
    const { model } = buildArchiveModel(projectReal, cfg.prefs, '', { projects, currentPath: projectReal })
    const page = parseWikiPage(url.searchParams.get('page'))
    // 章页正文按需现读（档案是此刻的投影：读不到就如实说，不拿旧稿冒充）
    let chapterText = null
    const chm = /^ch-(\d+)$/.exec(page)
    if (chm) {
      const ch = (model.chapters || [])[Number(chm[1]) - 1]
      if (ch?.abs) {
        try { chapterText = fs.readFileSync(ch.abs, 'utf8') } catch { chapterText = null }
      }
    }
    const html = renderWikiSite(model, { page, projectPath: projectReal, chapterText })
    res.statusCode = 200
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.setHeader('content-security-policy', WIKI_CSP)
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('cache-control', 'no-store')
    res.end(html)
  } catch (err) {
    writeJson(res, err.status || 500, { ok: false, error: String(err?.message || err) })
  }
}
