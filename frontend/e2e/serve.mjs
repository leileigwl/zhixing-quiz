/* global process, console */
// 极简静态服务器：E2E 用来托管 dist-h5（不引入额外依赖）。用法：node e2e/serve.mjs [port] [dir]
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const port = Number(process.argv[2] || process.env.E2E_PORT || 4173)
const root = resolve(process.argv[3] || 'dist-h5')
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
}

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    let file = normalize(join(root, urlPath))
    if (!file.startsWith(root)) {
      res.writeHead(403).end()
      return
    }
    const st = await stat(file).catch(() => null)
    if (!st || st.isDirectory()) file = join(st ? file : root, 'index.html')
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`[e2e] serving ${root} on http://127.0.0.1:${port}`)
})
