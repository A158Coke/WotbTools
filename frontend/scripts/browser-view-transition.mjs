/**
 * #845 View transition loading boundary 的浏览器级确定性回归。
 *
 * 驱动真实应用（router / AppShell / ViewHost / defineLazyView），只把**外部时间边界**
 * 换成确定性的：CDP Fetch 拦截对指定 view 模块注入 delay / 失败，不依赖真实网络慢速，
 * 生产代码里没有任何用户可触发的 debug 协议（注入只存在于本 harness 的 CDP 会话）。
 *
 * 覆盖：fast（无 loader）/ slow（loader 在 #main、壳可交互）/ A→B→C latest-wins /
 * import 失败 error surface / Back-Forward 同边界 / desktop + compact 几何稳定。
 */
import assert from 'node:assert/strict'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page, delay } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

// loader 只在超过 viewRegistry.js 的 VIEW_LOAD_FEEDBACK_DELAY_MS(300ms) 后出现；
// 本脚本按行为断言（等元素出现/不出现），只需要「观察窗口 > 阈值」的数量级。
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
    await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('wotb-lang','zh');localStorage.setItem('wotb-ui-profile','showcase')" }, sessionId)
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

/** 桌面导航：侧边栏「更多」弹出面板（同步壳）→ aboutLinks 的 RouterLink push。 */
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

/** 在 ms 窗口内轮询：loader 一旦出现即失败（fast 用例；阈值保证可见期 ≥ 300ms，50ms 轮询不会漏）。 */
async function assertNoLoader(page, ms = LOADER_WINDOW_MS) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await page.evaluate(loaderVisible)) throw new Error('loader appeared where a fast transition was expected')
    await delay(50)
  }
}

/** loader 在 #main 内、布局几何稳定（无横向溢出、Footer 可见且在 loader 之下）。 */
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

/** 加载期间壳仍可交互：侧边栏「更多」可打开、面板链接可导航。 */
async function assertShellInteractiveDuringLoader(page, target) {
  await navigateViaMore(page, target)
  await viewIs(page, target)
}

await scenario('fast-transition-desktop', 1440, 900, false, async page => {  // 预热：首次加载允许 loader（dev transform 冷启动不可控），不作为断言对象
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
  // history（先发起、更慢）此刻 resolve：不得覆盖 C，也不得残留它的 loader
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
  // contact 还在 pending 时 Back：latest-wins 同样适用于 popstate，history 立即可用
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
  // 底部 Tab 栏不被 loader 覆盖且可点击
  const tabReachable = await page.evaluate(`(() => { const tab = document.querySelector('[data-testid=tab-more]'); if (!tab) return null; const r = tab.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('[data-testid=tab-more]') != null })()`)
  assert.equal(tabReachable, true, 'tab bar must stay clickable above the loader')
  await tap(page, '[data-testid=tab-more]', true)
  await viewIs(page, 'more')
})

console.log(failures ? `\n${failures} scenario(s) FAILED` : '\nall view-transition scenarios passed')
await server.close()
await chrome.close()
process.exit(failures ? 1 : 0)
