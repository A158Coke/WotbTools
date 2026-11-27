#!/usr/bin/env node
import { createServer } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(here, '..')

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>shader-check</title></head>
<body><script type="module" src="/scripts/shader-check-page.js"></script></body></html>`

async function main() {
  const server = await createServer({
    configFile: false,
    root: frontendRoot,
    cacheDir: 'node_modules/.vite-shader-check',
    logLevel: 'error',
    plugins: [{
      name: 'shader-check-page',
      configureServer(s) {
        s.middlewares.use('/shadercheck', (_req, res) => {
          res.setHeader('content-type', 'text/html')
          res.end(PAGE_HTML)
        })
      },
    }],
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  const origin = server.resolvedUrls?.local?.[0]?.replace(/\/$/, '')
  if (!origin) throw new Error('vite did not publish a local URL')
  const env = await launchChromeForCdp(findChrome(), {})
  try {
    const { sessionId } = await env.openPage()
    const page = new Page(env.client, sessionId)
    await page.enable()
    await page.evaluate(`location.href = ${JSON.stringify(origin + '/shadercheck')}`)
    try {
      await page.waitForValue('window.__shaderCheckDone === true', (v) => v === true,
                               { timeout: 60000, label: 'shader check' })
    } catch (e) {
      const state = await page.evaluate(`JSON.stringify({ href: location.href, step: window.__step || null,
        done: !!window.__shaderCheckDone, err: window.__shaderCheck && window.__shaderCheck.error })`)
      console.log('页面未就绪：', state)
      throw e
    }
    const data = JSON.parse(await page.evaluate('JSON.stringify(window.__shaderCheck)'))
    if (data.error) { console.log('页面异常：', data.error); console.log('gate debug：', JSON.stringify(data.debug)); process.exitCode = 1; return }
    let failed = 0
    for (const p of data.programs) {
      const d = p.diag
      const text = d ? (d.programLog + d.vertexLog + d.fragmentLog) : ''
      if (d && (d.runnable === false || /ERROR/i.test(text))) {
        failed++
        console.log(`\n✗ 程序编译失败：${p.name}`)
        for (const [label, s] of [['programLog', d.programLog], ['vertexLog', d.vertexLog], ['fragmentLog', d.fragmentLog]]) {
          if (s) console.log(`  ${label}:\n    ` + s.split('\n').slice(0, 24).join('\n    '))
        }
      }
    }
    for (const line of (data.log || [])) console.log('  [console.error]', String(line).slice(0, 800))
    console.log(`用例 ${data.cases.length} 个：${data.cases.join(', ')}`)
    console.log(`程序 ${data.programs.length} 个，编译失败 ${failed} 个，console.error ${(data.log || []).length} 条`)
    process.exitCode = (failed || (data.log || []).length) ? 1 : 0
  } finally {
    await env.close?.()
    await server.close()
  }
}
await main()
