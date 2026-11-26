import { readFileSync } from 'node:fs'
import { compileStyle, parse } from 'vue/compiler-sfc'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'

const filename = new URL('../src/app/AppShell.vue', import.meta.url)
const { descriptor } = parse(readFileSync(filename, 'utf8'))
const scopeId = 'data-v-pseudo-nav-test'
const shell = descriptor.styles.map(style => {
  const result = compileStyle({ source: style.content, filename: filename.pathname, id: scopeId, scoped: style.scoped })
  if (result.errors.length) throw new Error(result.errors.join('\n'))
  return result.code
}).join('\n')
const workspace = [
  readFileSync(new URL('../src/styles/playback-workspace.css', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/styles/playback-workspace-3d.css', import.meta.url), 'utf8'),
].join('\n')
const browser = await launchChromeForCdp(findChrome())
try {
  for (const [width, height] of [[390, 844], [844, 390]]) {
    const { targetId, sessionId } = await browser.openPage()
    const page = new Page(browser.client, sessionId)
    await page.enable()
    await page.emulate({ width, height, touch: true, deviceScaleFactor: 1 })
    const html = `<html data-pb-pseudo-fullscreen><style>
      :root { --z-header: 100; --space-2: 8px; --control-h-md: 44px; }
      body { margin: 0; } .battle-playback { background: black; height: 100vh; }
      ${workspace}\n${shell}
      </style><body><main><div class="battle-playback playback-workspace pb-pseudo-fullscreen"></div></main>
      <div class="immersive-nav" ${scopeId}><button style="width:44px;height:44px" onclick="this.dataset.clicked='yes'">Menu</button></div></body></html>`
    await page.goto('data:text/html,' + encodeURIComponent(html))
    const result = await page.probe(() => {
      const button = document.querySelector('button')
      const rect = button.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      hit.click()
      return { reachable: hit === button, clicked: button.dataset.clicked }
    })
    if (!result.reachable || result.clicked !== 'yes') throw new Error(JSON.stringify(result))
    console.log(`${width}x${height} compiled fallback navigation hit-test PASS`)
    await browser.client.send('Target.closeTarget', { targetId })
  }
} finally { await browser.close() }
