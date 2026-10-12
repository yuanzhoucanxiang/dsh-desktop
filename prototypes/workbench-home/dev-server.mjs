// 零依赖静态服务器：只服务本目录（原型预览用）。
// 支持 --port / --host（两种写法都收），默认 7100 / 127.0.0.1。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const arg = (name, dflt) => {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const port = Number(arg('port', process.env.PORT || 7100))
const host = arg('host', process.env.HOST || '127.0.0.1')
const root = path.dirname(fileURLToPath(import.meta.url))

const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    let rel = decodeURIComponent(url.pathname)
    if (rel === '/') rel = '/index.html'
    const file = path.join(root, rel)
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(res)
  })
  .listen(port, host, () => console.log(`workbench-home prototype: http://${host}:${port}/`))
