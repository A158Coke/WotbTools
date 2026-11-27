import { Page } from './browser-page.mjs'
import { measureOcclusion, measureReachability, measureTouchTargets, measureViewportSafety } from './browser-occlusion.mjs'
import { primaryNavItems } from '../src/app/navigation.js'

export const SHELL_OVERLAY_SCENARIOS = ['summer', 'winter'].flatMap(profile => [
  { width: 390, height: 844, touch: true },
  { width: 740, height: 360, touch: true },
  { width: 844, height: 340, touch: true },
  { width: 1024, height: 768, touch: true },
  { width: 1440, height: 900, touch: false },
].map(size => ({ ...size, profile, name: `shell-overlay-${profile}-${size.width}x${size.height}` })))

export async function runShellOverlayScenario(env, scenario) {
  const { sessionId, targetId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  const failures = []
  const check = (ok, message) => { if (!ok) failures.push(message) }
  await page.enable()
  await env.chrome.client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('wotb-lang','ru');localStorage.setItem('wotb-ui-profile',${JSON.stringify(scenario.profile)})`,
  }, sessionId)
  env.chrome.client.on('Fetch.requestPaused', async (event, session) => {
    if (session !== sessionId) return
    const body = new URL(event.request.url).pathname === '/api/health'
      ? { status: 'ok', tanks: 1, capabilities: ['recommendations-v1'] }
      : [{ id: 1, name: 'Fixture', type: 'UP' }]
    await env.chrome.client.send('Fetch.fulfillRequest', {
      requestId: event.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify(body)).toString('base64'),
    }, sessionId)
  })
  await env.chrome.client.send('Fetch.enable', { patterns: [
    { urlPattern: '*/api/health*' }, { urlPattern: '*/api/recommendations/categories*' },
  ] }, sessionId)

  async function tap(selector) {
    await page.callWith((sel) => document.querySelector(sel).scrollIntoView({ block: 'center', inline: 'nearest' }), selector)
    await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await page.animationsSettled()
    const reach = await measureReachability(page, { options: [selector], touch: scenario.touch })
    check(reach.sampled > 0, `${selector}: no hit-test samples`)
    failures.push(...reach.failures)
    const point = await page.callWith((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, selector)
    await page.tap({ ...point, touch: scenario.touch })
  }
  const viewIs = (view) => page.waitForValue('new URL(location.href).searchParams.get("view")', value => value === view, { label: `view=${view}` })
  const isCurrent = (selector) => page.waitForValue(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-current')`, value => value === 'page', { label: `${selector} current` })

  async function assertNavigationMatrix() {
    try { await walkNavigation() } finally {
      page.consoleErrors = page.consoleErrors.filter(message => !/(tech tree|tank cache|tankopedia) load failed/.test(message))
    }
  }
  async function walkNavigation() {
    const drawerShell = await page.evaluate('!!document.querySelector("[data-testid=nav-menu]")')
    check(await page.evaluate('!document.querySelector("[data-testid=app-tab-bar]")'), 'bottom tab bar must not render (L1)')
    if (!drawerShell) {
      for (const item of primaryNavItems('127.0.0.1').filter(entry => entry.id !== 'more')) {
        await tap(`[data-testid=nav-${item.id}]`)
        await viewIs(item.view)
        await isCurrent(`[data-testid=nav-${item.id}]`)
      }
      return
    }
    const panel = '[data-testid=nav-drawer-panel]'
    for (const item of primaryNavItems('127.0.0.1')) {
      await tap('[data-testid=nav-menu]')
      await page.waitForValue(`!!document.querySelector(${JSON.stringify(panel)})`, Boolean, { label: 'drawer open' })
      await tap(`${panel} [data-testid=nav-${item.id}]`)
      await viewIs(item.view)
      await page.waitForValue(`!document.querySelector(${JSON.stringify(panel)})`, Boolean, { label: `drawer closed after ${item.id}` })
      await tap('[data-testid=nav-menu]')
      await page.waitForValue(`!!document.querySelector(${JSON.stringify(panel)})`, Boolean, { label: 'drawer reopen' })
      await isCurrent(`${panel} [data-testid=nav-${item.id}]`)
      await env.chrome.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
      await env.chrome.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
      await page.waitForValue(`!document.querySelector(${JSON.stringify(panel)})`, Boolean, { label: 'drawer closed on Escape' })
      check(await page.evaluate('document.activeElement?.dataset.testid === "nav-menu"'), `Esc did not restore menu focus (${item.id})`)
    }
    await tap('[data-testid=app-top-bar] .brand')
    await viewIs('replay')
  }

  try {
    await page.emulate(scenario)
    await page.goto(`${env.origin}/?view=more&ws-auth=0`)
    await page.waitForValue('!!document.querySelector("[data-testid=more-page]")', Boolean)
    if (scenario.touch) {
      const touch = await measureTouchTargets(page, { exclude: ['footer'] })
      check(touch.scanned > 0, 'shell touch sweep must not be empty')
      failures.push(...touch.failures)
    }
    const mobile = scenario.width < 768 || (scenario.touch && scenario.height <= 520)
    if (mobile) {
      const occlusion = await measureOcclusion(page, {
        primary: '[data-testid=more-page] .showcase-hero', persistent: ['[data-testid=app-top-bar]'],
      })
      check(!!occlusion.primary, 'more page primary region absent')
      failures.push(...occlusion.failures)
      await tap('[data-testid=more-language] [data-value=en]')
      await page.waitForValue('document.querySelector("[data-testid=more-language] [data-value=en]")?.getAttribute("aria-checked")', v => v === 'true')
      await tap('[data-testid=more-language] [data-value=ru]')
      await page.waitForValue('document.querySelector("[data-testid=more-language] [data-value=ru]")?.getAttribute("aria-checked")', v => v === 'true')
      const last = '[data-testid=more-link-feedback]'
      await page.evaluate(`document.querySelector('${last}').scrollIntoView({block:'center'})`)
      const reach = await measureReachability(page, { options: [last], touch: true })
      check(reach.sampled > 0, 'bottom support link not sampled')
      failures.push(...reach.failures)
      await tap('[data-testid=more-link-history]')
      await page.waitForValue('new URL(location.href).searchParams.get("view")', v => v === 'history')
      await assertNavigationMatrix()
    } else {
      await tap('[data-testid=nav-more]')
      await page.waitForValue('!!document.querySelector("[data-testid=more-panel]")', Boolean)
      await page.animationsSettled()
      const options = await page.evaluate(`Array.from(document.querySelectorAll('[data-testid=more-panel] button,[data-testid=more-panel] a')).map((el,i)=>{el.dataset.overlayProbe=String(i);return '[data-overlay-probe="'+i+'"]'})`)
      check(options.length >= 6, 'more-panel options missing')
      for (const selector of options) {
        await page.callWith((sel) => document.querySelector(sel).scrollIntoView({ block: 'nearest' }), selector)
        const reach = await measureReachability(page, { options: [selector], touch: scenario.touch })
        check(reach.sampled > 0, `${selector}: not sampled`)
        failures.push(...reach.failures)
      }
      await page.evaluate(`(() => { const blocker=document.createElement('div');blocker.id='overlay-negative';blocker.style.cssText='position:fixed;inset:0;z-index:2147483647';document.body.append(blocker) })()`)
      const negative = await measureReachability(page, { options: [options.at(-1)] })
      check(negative.sampled > 0 && negative.results.some(value => value.occludedAt.length > 0), 'transparent occlusion negative control did not fail')
      await page.evaluate('document.getElementById("overlay-negative").remove()')
      await tap('[data-testid=more-panel-language] [data-value=en]')
      await page.waitForValue('document.querySelector("[data-testid=more-panel-language] [data-value=en]")?.getAttribute("aria-checked")', v => v === 'true')
      await tap('[data-testid=more-panel-language] [data-value=ru]')
      await env.chrome.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
      await env.chrome.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
      await page.waitForValue('!document.querySelector("[data-testid=more-panel]")', Boolean)
      check(await page.evaluate('document.activeElement?.dataset.testid === "nav-more"'), 'Esc did not restore More trigger focus')
      await tap('[data-testid=nav-more]')
      await page.waitForValue('!!document.querySelector("[data-testid=more-panel]")', Boolean)
      await tap('[data-testid=more-panel] [data-testid=more-link-history]')
      await page.waitForValue('new URL(location.href).searchParams.get("view")', v => v === 'history')
      check(await page.evaluate('!document.querySelector("[data-testid=more-panel]")'), 'navigation left More panel open')
      await assertNavigationMatrix()
    }
  } catch (error) {
    failures.push(error.message, ...await page.diagnose())
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  return { name: scenario.name, failures: [...failures, ...page.consoleErrors], viewport: `${scenario.width}x${scenario.height}` }
}

export const MOBILE_VIEWPORTS = Object.freeze([
  { id: 'android-360', width: 360, height: 740, insets: { bottom: 24 } },
  { id: 'android-412', width: 412, height: 839, insets: { bottom: 24 } },
  { id: 'iphone-390', width: 390, height: 664, insets: { top: 47, bottom: 34 } },
  { id: 'iphone-se', width: 375, height: 553, insets: { top: 20 } },
  { id: 'iphone-land', width: 844, height: 340, insets: { left: 47, right: 47, bottom: 21 } },
])
const MOBILE_PAGES = ['more', 'hof', 'agent-tankopedia', 'tournament-points', 'league-broadcasts', 'history', 'contact', 'sponsor', 'android', 'rating-docs', 'profile']
export const MOBILE_PAGE_SCENARIOS = MOBILE_VIEWPORTS.map(viewport => ({ ...viewport, touch: true, name: `mobile-pages-${viewport.id}-${viewport.width}x${viewport.height}` }))

export async function runMobilePageScenario(env, scenario) {
  const { sessionId, targetId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  const failures = []
  await page.enable()
  await env.chrome.client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('wotb-lang','zh')`,
  }, sessionId)
  try {
    await page.emulate(scenario)
    const insets = { top: 0, right: 0, bottom: 0, left: 0, ...scenario.insets }
    await env.chrome.client.send('Emulation.setSafeAreaInsetsOverride', { insets }, sessionId)
    for (const view of MOBILE_PAGES) {
      await page.goto(`${env.origin}/?view=${view}&ws-auth=0`)
      await page.waitForValue('!!document.querySelector("[data-testid=app-top-bar]") && !document.querySelector(".view-loading")', Boolean, { label: `${view} ready` })
      await page.animationsSettled()
      const seen = new Set()
      for (let step = 0; step < 40; step += 1) {
        await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        await page.animationsSettled()
        const probe = await measureViewportSafety(page, { insets, chrome: ['[data-testid=app-top-bar]'] })
        for (const failure of probe.failures) if (!seen.has(failure)) { seen.add(failure); failures.push(`${view}: ${failure}`) }
        if (probe.scrollWidth > probe.viewport + 1) failures.push(`${view}: 横向溢出 ${probe.scrollWidth} > ${probe.viewport}`)
        const done = await page.evaluate(`(() => { const before = scrollY; scrollBy(0, Math.round(innerHeight * 0.6)); return scrollY === before })()`)
        if (done) break
      }
    }
  } catch (error) {
    failures.push(error.message, ...await page.diagnose())
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  return { name: scenario.name, failures: [...new Set(failures)], viewport: `${scenario.width}x${scenario.height}` }
}
