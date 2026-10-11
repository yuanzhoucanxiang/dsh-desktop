// 一次性维护脚本：把 r3 快照的 delivery-manifest.json 里 gir-ui/client.js 的
// sha256/bytes 校正为实际值（r2 当时没校正，导致清单与实际漂移；r3 顺手修对）。
// 用法：node fix-r3-manifest.mjs <manifest> <client.js>
import fs from 'node:fs'
import crypto from 'node:crypto'

const [manifestPath, clientPath] = process.argv.slice(2)
if (!manifestPath || !clientPath) {
  console.error('用法: node fix-r3-manifest.mjs <delivery-manifest.json> <client.js>')
  process.exit(2)
}
const buf = fs.readFileSync(clientPath)
const sha = crypto.createHash('sha256').update(buf).digest('hex')
const raw = fs.readFileSync(manifestPath, 'utf8')
const oldEntry = [
  '"path": "dsh-plugins/gir-ui/client.js",',
  '      "sha256": "b9d51d82dfa58ced557466814276dd82a0d6927df2360a22f9377dbcca2aab37",',
  '      "bytes": 457118',
].join('\r\n')
if (!raw.includes(oldEntry)) {
  console.error('未匹配到旧条目（清单格式可能已变），未改动')
  process.exit(1)
}
const nextEntry = [
  '"path": "dsh-plugins/gir-ui/client.js",',
  `      "sha256": "${sha}",`,
  `      "bytes": ${buf.length}`,
].join('\r\n')
fs.writeFileSync(manifestPath, raw.replace(oldEntry, nextEntry))
const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const entry = parsed.files.find((f) => f.path === 'dsh-plugins/gir-ui/client.js')
console.log('清单条目 =', JSON.stringify(entry))
console.log('实际文件 =', sha, buf.length)
console.log(entry.sha256 === sha && entry.bytes === buf.length ? 'MANIFEST_OK' : 'MANIFEST_MISMATCH')
