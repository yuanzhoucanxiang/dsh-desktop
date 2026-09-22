/**
 * 单一项目身份口径（V6 修复）。
 *
 * 为什么需要：此前 draft / memory / coordination / project-recovery 各自规范化项目路径，
 * 规则互不相同——draft 的 bucketKey 会 lowercase + 换分隔符但**不剥尾部斜杠**，
 * coordination 的 bucketOf **剥**，listCheckpoints 甚至用**原始串全等**比较。
 * 结果是同一路径尾部多一个分隔符就分裂成两个草稿桶，跨窗口草稿列表悄悄为空，
 * 而 project-recovery 用 realpath 规范身份写入的桶、UI 用客户端原始串读不到。
 *
 * 约定：**所有按项目分桶的键都必须经 identityKey()**。
 * 本函数只做纯字符串规范化（分隔符 / 尾部斜杠 / 大小写），**不做 realpath**——
 * realpath 由调用方在解析阶段完成（store.resolveUnderRoots 已返回 realpath 后的 abs），
 * 这样既有用户的桶名不会因为一次 realpath 结果变化而整体失联。
 *
 * `\0` 后缀（world / history 分桶）原样保留，只对路径部分做规范化。
 */

/** 归一化项目身份键；保留 `\0` 之后的分桶后缀。 */
export function identityKey(project) {
  const raw = String(project ?? '')
  const nul = raw.indexOf('\0')
  const base = nul < 0 ? raw : raw.slice(0, nul)
  const suffix = nul < 0 ? '' : raw.slice(nul)
  const norm = base.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm + suffix
}

/** 两个项目路径串是否指向同一身份（含分桶后缀）。 */
export function sameProject(a, b) {
  return identityKey(a) === identityKey(b)
}

/** 取出 `\0` 分桶后缀（'' / '\0world' / '\0history'）。 */
export function bucketSuffix(project) {
  const raw = String(project ?? '')
  const nul = raw.indexOf('\0')
  return nul < 0 ? '' : raw.slice(nul)
}
