import http from 'node:http'; import { readFileSync } from 'node:fs'
const dir = 'D:/Program/WotbTools/.claude/worktrees/designer-tool-7fb949/common/fixtures/replays/'
http.createServer((q, r) => { const n = q.url.slice(1).replace(/[^a-z0-9.-]/gi, ''); try { const b = readFileSync(dir + n); r.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/octet-stream', 'Content-Length': b.length }); r.end(b) } catch { r.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); r.end() } }).listen(8099, '127.0.0.1')
