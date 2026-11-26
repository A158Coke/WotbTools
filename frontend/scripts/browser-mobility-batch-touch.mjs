import assert from 'node:assert/strict'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

const { server, origin } = await startFixtureServer({
  plugins: [{
    name: 'mobility-batch-touch-entry',
    config: () => ({ optimizeDeps: {
      noDiscovery: true,
      include: ['vue', 'vue-i18n', 'reka-ui', 'lucide-vue-next', 'motion-v', '@vueuse/core'],
    } }),
  }],
  middleware(request, response, next) {
    if (request.url?.split('?')[0] !== '/mobility-batch-touch') { next(); return }
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><html lang="zh"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module" src="/scripts/browser-fixtures/mobility-batch-touch-page.js"></script></body></html>')
  },
})
let browser
let page
try {
  browser = await launchChromeForCdp(findChrome())
  const { sessionId } = await browser.openPage()
  page = new Page(browser.client, sessionId)
  await page.enable()
  for (const width of [360, 390, 767]) {
    for (const theme of ['summer', 'winter']) {
      await page.emulate({ width, height: 844, touch: true, deviceScaleFactor: 1 })
      await page.goto(origin + '/mobility-batch-touch')
      await page.waitForValue("!!document.querySelector('.mb-targets label')", Boolean)
      await page.callWith(profile => { document.documentElement.dataset.uiProfile = profile }, theme)
      await page.animationsSettled()
      await page.evaluate("document.querySelector('.mb-targets label').scrollIntoView({block:'center'})")
      await page.animationsSettled()
      const before = await page.probe(() => {
        const label = document.querySelector('.mb-targets label')
        const r = label.getBoundingClientRect(), check = label.querySelector('input').getBoundingClientRect()
        return { width:r.width, height:r.height, checked:label.querySelector('input').checked,
          x:r.right-6, y:r.y+r.height/2, checkboxRight:check.right,
          coarse:matchMedia('(pointer: coarse)').matches }
      })
      assert.equal(before.coarse, true)
      assert.ok(before.height >= 44 && before.width >= 44, JSON.stringify(before))
      assert.ok(before.x > before.checkboxRight + 44, 'tap must land in label whitespace')
      assert.equal(before.checked, true)
      await page.installInputTrace()
      await page.tap({ x: before.x, y: before.y, touch: true })
      await page.waitForValue("document.querySelector('.mb-targets input').checked", value => value === false)
      assert.equal((await page.inputTrace()).primary.tag, 'LABEL', 'raw touch must land on the label')
      await page.tapSelector('[role="dialog"] .dialog-actions button:last-child', true)
      await page.waitForValue("document.querySelector('#applied').textContent", value => value === '["2"]')
      console.log(JSON.stringify({ width, theme, labelWidth: before.width, labelHeight: before.height, applied: ['2'] }))
    }
  }
} catch (error) {
  if (page) console.error(await page.diagnose())
  throw error
} finally {
  if (browser) await browser.close()
  await server.close()
}
