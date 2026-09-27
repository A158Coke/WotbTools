// Browser gate: serves the repository over loopback HTTP and drives the WASM page in headless
// Chromium through the repository's CDP helper (`frontend/scripts/browser-chrome.mjs`), so there is
// exactly one place that knows where a Chromium binary lives and how to launch an isolated profile.
//
// The page is asynchronous (wasm init + worker round-trip), so the result is awaited over CDP
// instead of relying on `--dump-dom` at load time.
//
// Usage (from `replay-engine/`): node tests/browser-wasm-smoke.mjs

import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { findChrome, launchChromeForCdp } from '../../frontend/scripts/browser-chrome.mjs'

const engineDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(engineDir, '..')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.wotbreplay': 'application/octet-stream',
}

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  const target = path.resolve(repoRoot, `.${decodeURIComponent(url.pathname)}`)
  if (!target.startsWith(repoRoot)) {
    response.writeHead(403).end()
    return
  }
  let stats
  try {
    stats = statSync(target)
  } catch {
    response.writeHead(404).end()
    return
  }
  if (!stats.isFile()) {
    response.writeHead(404).end()
    return
  }
  response.writeHead(200, {
    'content-type': MIME[path.extname(target)] ?? 'application/octet-stream',
    'content-length': stats.size,
    'cache-control': 'no-store',
  })
  createReadStream(target).pipe(response)
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
const url = `http://127.0.0.1:${port}/replay-engine/tests/wasm-browser.html`

const READ_RESULT = `(async () => {
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) {
    const value = document.body && document.body.dataset ? document.body.dataset.result : null
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return 'TIMEOUT'
})()`

let chrome
try {
  chrome = await launchChromeForCdp(findChrome())
  const { sessionId } = await chrome.openPage()
  await chrome.client.send('Runtime.enable', {}, sessionId)
  await chrome.client.send('Page.enable', {}, sessionId)
  await chrome.client.send('Page.navigate', { url }, sessionId)

  let encoded
  for (let attempt = 0; attempt < 10 && !encoded; attempt += 1) {
    try {
      const { result } = await chrome.client.send(
        'Runtime.evaluate',
        { expression: READ_RESULT, awaitPromise: true, returnByValue: true },
        sessionId,
      )
      if (result.value && result.value !== 'TIMEOUT') encoded = result.value
      else if (result.value === 'TIMEOUT') throw new Error('browser page did not publish a result in time')
    } catch (error) {
      // Execution context is destroyed during navigation; that is expected noise, retry.
      if (attempt === 9) throw error
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  if (!encoded) throw new Error('browser page did not publish a result')

  const { failures, notes } = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
  if (failures.length) throw new Error(`browser WASM smoke failed:\n- ${failures.join('\n- ')}`)
  console.log(`PASS browser wasm: ${notes.join(' | ')}`)
} finally {
  if (chrome) await chrome.close()
  server.close()
}
