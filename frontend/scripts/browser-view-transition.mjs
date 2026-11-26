import assert from 'node:assert/strict'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page, delay } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

const LOADER_WINDOW_MS = 1200
const HISTORY_MODULE = '/src/components/HistoryPage.vue'
const CONTACT_MODULE = '/src/components/ContactPage.vue'

const { server, origin } = await startFixtureServer({ allowedHosts: ['wotbtools.com'] })
const chrome = await launchChromeForCdp(findChrome(), { extraArgs: ['--host-resolver-rules=MAP wotbtools.com 127.0.0.1', '--no-proxy-server'] })

let failures = 0
async function scenario(name, width, height, touch, run) {
  const { targetId, sessionId } = await chrome.openPage()
  const page = new Page(chrome.client, sessionId)
  const modulePlan = new Map()
  try {
    await page.enable()
    await page.emulate({ width, height, touch })
    await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('wotb-lang','zh');localStorage.setItem('wotb-ui-profile','summer')" }, sessionId)
    await chrome.client.send('Fetch.enable', { patterns: [
      { urlPattern: `*${HISTORY_MODULE}` }, { urlPattern: `*${CONTACT_MODULE}` },
    ] }, sessionId)
    chrome.client.on('Fetch.requestPaused', async (event, session) => {
      if (session !== sessionId) return
      const plan = modulePlan.get(new URL(event.request.url).pathname)
      try {
        if (!plan) await chrome.client.send('Fetch.continueRequest', { requestId: event.requestId }, sessionId)
        else if (plan.fail) await chrome.client.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Failed' }, sessionId)
        else { await delay(plan.delayMs); await chrome.client.send('Fetch.continueRequest', { requestId: event.requestId }, sessionId) }
      } catch { /* 导航销毁 session 后的收尾噪声 */ }
    })
    await page.goto(`${origin}/`)
    await page.waitForValue(`!!document.querySelector('[data-testid=app-sidebar]') || !!document.querySelector('[data-testid=app-top-bar]')`, Boolean, { label: 'shell ready' })
    await run(page, modulePlan)
    const noise = page.consoleErrors.filter(message => /tech tree|tank cache|tankopedia|history page|markdown/i.test(message))
    assert.deepEqual(noise, [], `${name}: console errors`)
    console.log(`PASS ${name}`)
  } catch (error) {
    failures++
    console.log(`FAIL ${name}: ${error.message}\n${(await page.diagnose().catch(() => ['(diagnose failed)'])).join('\n')}`)
  } finally {
    modulePlan.clear()
    await chrome.client.send('Target.closeTarget', { targetId }).catch(() => {})
  }
}

const loaderVisible = `!!document.querySelector('[data-testid=view-loading]')`
const viewIs = (page, view) => page.waitForValue(`new URL(location.href).searchParams.get("view")`, value => value === view, { label: `view=${view}` })

async function navigateViaMore(page, target) {
  await tap(page, '[data-testid=nav-more]', false)
  await page.waitForValue(`!!document.querySelector('[data-testid=more-link-${target}]')`, Boolean, { label: `more-link-${target}` })
  await tap(page, `[data-testid=more-link-${target}]`, false)
}

async function tap(page, selector, touch) {
  const point = await page.callWith((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    el.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, selector)
  assert.ok(point, `missing ${selector}`)
  await page.animationsSettled()
  await page.tap({ ...point, touch })
}

async function assertNoLoader(page, ms = LOADER_WINDOW_MS) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await page.evaluate(loaderVisible)) throw new Error('loader appeared where a fast transition was expected')
    await delay(50)
  }
}

async function assertGeometry(page) {
  const geometry = await page.evaluate(`(() => {
    const loader = document.querySelector('[data-testid=view-loading]')?.getBoundingClientRect()
    const footer = document.querySelector('[data-testid=app-footer]')?.getBoundingClientRect()
    return {
      loaderInMain: !!document.querySelector('#main [data-testid=view-loading]'),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      footerBelowLoader: !!footer && !!loader ? footer.top >= loader.bottom - 2 : null,
      footerVisible: !!footer ? footer.bottom <= window.innerHeight + 1 : null,
    }
  })()`)
  assert.equal(geometry.loaderInMain, true, 'loader must render inside #main')
  assert.equal(geometry.overflow, false, 'loader must not cause horizontal overflow')
  assert.equal(geometry.footerBelowLoader, true, 'footer must stay below the loading surface')
  assert.equal(geometry.footerVisible, true, 'footer must stay fully visible')
}

async function assertShellInteractiveDuringLoader(page, target) {
  await navigateViaMore(page, target)
  await viewIs(page, target)
}

await scenario('fast-transition-desktop', 1440, 900, false, async page => {
  await navigateViaMore(page, 'history')
  await page.waitForValue(`!!document.querySelector('.history-page')`, Boolean, { label: 'history rendered (warmup)' })
  await navigateViaMore(page, 'contact')
  await page.waitForValue(`!!document.querySelector('.contact-page')`, Boolean, { label: 'contact rendered (warmup)' })
  await navigateViaMore(page, 'history')
  await page.waitForValue(`!!document.querySelector('.history-page')`, Boolean, { label: 'history rendered (fast)' })
  await assertNoLoader(page)
})

await scenario('slow-transition-desktop', 1440, 900, false, async (page, modulePlan) => {
  modulePlan.set(HISTORY_MODULE, { delayMs: 800 })
  await navigateViaMore(page, 'history')
  await page.waitForValue(loaderVisible, Boolean, { label: 'loader appears after threshold' })
  await assertGeometry(page)
  assert.equal(await page.evaluate(`!!document.querySelector('.history-page')`), false, 'stale content must not linger')
  await assertShellInteractiveDuringLoader(page, 'contact')
  await page.waitForValue(`!!document.querySelector('.contact-page')`, Boolean, { label: 'contact rendered' })
  assert.equal(await page.evaluate(loaderVisible), false, 'loader must be gone once the view resolves')
})

await scenario('latest-wins-desktop', 1440, 900, false, async (page, modulePlan) => {
  modulePlan.set(HISTORY_MODULE, { delayMs: 1500 })
  modulePlan.set(CONTACT_MODULE, { delayMs: 500 })
  await navigateViaMore(page, 'history')
  await delay(150)
  await navigateViaMore(page, 'contact')
  await page.waitForValue(`!!document.querySelector('.contact-page')`, Boolean, { label: 'contact wins' })
  assert.equal(await page.evaluate(`!!document.querySelector('.history-page')`), false, 'B must not render')
  await delay(1500)
  assert.equal(await page.evaluate(`!!document.querySelector('.contact-page')`), true, 'contact must stay rendered')
  assert.equal(await page.evaluate(`!!document.querySelector('.history-page')`), false, 'history must never overwrite contact')
  assert.equal(await page.evaluate(loaderVisible), false, 'no stale loader after superseded view resolves')
  assert.equal(await page.evaluate(`new URL(location.href).searchParams.get("view")`), 'contact', 'route stays on C')
})

await scenario('import-failure-desktop', 1440, 900, false, async (page, modulePlan) => {
  modulePlan.set(HISTORY_MODULE, { fail: true })
  await navigateViaMore(page, 'history')
  await page.waitForValue(`!!document.querySelector('[data-testid=view-load-error]')`, Boolean, { label: 'error surface' })
  assert.equal(await page.evaluate(loaderVisible), false, 'no infinite spinner behind the error')
  assert.equal(await page.evaluate(`!!document.querySelector('[data-testid=view-load-reload]')`), true, 'reload recovery offered')
  await assertShellInteractiveDuringLoader(page, 'contact')
  await page.waitForValue(`!!document.querySelector('.contact-page')`, Boolean, { label: 'navigation recovers from failure' })
  assert.equal(await page.evaluate(`!!document.querySelector('[data-testid=view-load-error]')`), false, 'error must not leak into the next view')
})

await scenario('back-forward-desktop', 1440, 900, false, async (page, modulePlan) => {
  await navigateViaMore(page, 'history')
  await page.waitForValue(`!!document.querySelector('.history-page')`, Boolean, { label: 'history rendered' })
  modulePlan.set(CONTACT_MODULE, { delayMs: 700 })
  await navigateViaMore(page, 'contact')
  await page.waitForValue(loaderVisible, Boolean, { label: 'loader on forward transition' })
  await page.evaluate('history.back()')
  await viewIs(page, 'history')
  await page.waitForValue(`!!document.querySelector('.history-page')`, Boolean, { label: 'history rendered after back' })
  assert.equal(await page.evaluate(loaderVisible), false, 'back must drop the pending forward transition')
  await page.evaluate('history.forward()')
  await viewIs(page, 'contact')
  await page.waitForValue(`!!document.querySelector('.contact-page')`, Boolean, { label: 'contact rendered after forward' })
  assert.equal(await page.evaluate(loaderVisible), false, 'no stuck loader after forward resolves')
})

await scenario('slow-transition-compact-390', 390, 844, true, async (page, modulePlan) => {
  await page.goto(`${origin}/?view=history`)
  await page.waitForValue(`!!document.querySelector('.history-page')`, Boolean, { label: 'history rendered (warmup)' })
  modulePlan.set(HISTORY_MODULE, { delayMs: 800 })
  await page.goto(`${origin}/?view=history`)
  await page.waitForValue(loaderVisible, Boolean, { label: 'loader appears (compact deep link)' })
  await assertGeometry(page)
  const menuReachable = await page.evaluate(`(() => { const menu = document.querySelector('[data-testid=nav-menu]'); if (!menu) return null; const r = menu.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('[data-testid=nav-menu]') != null })()`)
  assert.equal(menuReachable, true, 'top bar menu must stay clickable above the loader')
  await tap(page, '[data-testid=nav-menu]', true)
  await page.waitForValue(`!!document.querySelector('[data-testid=nav-drawer-panel] [data-testid=nav-more]')`, Boolean, { label: 'drawer open above the loader' })
  await tap(page, '[data-testid=nav-drawer-panel] [data-testid=nav-more]', true)
  await viewIs(page, 'more')
})

console.log(failures ? `\n${failures} scenario(s) FAILED` : '\nall view-transition scenarios passed')
await server.close()
await chrome.close()
process.exit(failures ? 1 : 0)
