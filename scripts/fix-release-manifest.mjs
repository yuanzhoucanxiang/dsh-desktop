/**
 * 通用版：把某个 release 快照的 delivery-manifest.json 里 `dsh-plugins/gir-ui/client.js`
 * 的 sha256/bytes 校正为实际值（r2 当时没校正，属已知漂移；r3/r4 顺手修对）。
 *
 * 用法：node fix-release-manifest.mjs <release目录>
 * 幂等：已经是实际值时不改动文件。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const dir = process.argv[2]
if (!dir) {
  console.error('用法: node fix-release-manifest.mjs <release目录>')
  process.exit(2)
}
const manifestPath = path.join(dir, 'delivery-manifest.json')
const clientPath = path.join(dir, 'dsh-plugins', 'gir-ui', 'client.js')
const buf = fs.readFileSync(clientPath)
const sha = crypto.createHash('sha256').update(buf).digest('hex')
const raw = fs.readFileSync(manifestPath, 'utf8')
const parsed = JSON.parse(raw)
const entry = (parsed.files || []).find((f) => f.path === 'dsh-plugins/gir-ui/client.js')
if (!entry) {
  console.error('清单里没有 gir-ui/client.js 条目')
  process.exit(1)
}
if (entry.sha256 === sha && entry.bytes === buf.length) {
  console.log(`MANIFEST_OK 已是实际值（${sha.slice(0, 12)}… / ${buf.length} B）`)
  process.exit(0)
}
// 定向替换：只改这一条（保留文件原有 CRLF 与缩进风格，不做整体重排）
const oldBlock = `"sha256": "${entry.sha256}",\r\n      "bytes": ${entry.bytes}`
const newBlock = `"sha256": "${sha}",\r\n      "bytes": ${buf.length}`
if (!raw.includes(oldBlock)) {
  console.error('未匹配到旧条目（格式可能已变），未改动')
  process.exit(1)
}
fs.writeFileSync(manifestPath, raw.replace(oldBlock, newBlock))
const after = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files.find((f) => f.path === 'dsh-plugins/gir-ui/client.js')
console.log(`MANIFEST_FIXED ${entry.sha256.slice(0, 12)}…/${entry.bytes} → ${after.sha256.slice(0, 12)}…/${after.bytes}`)
console.log(after.sha256 === sha && after.bytes === buf.length ? 'MANIFEST_OK' : 'MANIFEST_MISMATCH')
