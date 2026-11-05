import { Page } from './browser-page.mjs'
import { measureOcclusion, measureReachability, measureTouchTargets } from './browser-occlusion.mjs'
import { COMPACT_SHORTCUT_ITEMS, COMPACT_TAB_ITEMS, primaryNavItems } from '../src/app/navigation.js'

export const SHELL_OVERLAY_SCENARIOS = ['showcase', 'classic'].flatMap(profile => [
  { width: 390, height: 844, touch: true },
  { width: 740, height: 360, touch: true },
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
  // 仅替换本页面的外部服务边界；生产外壳、路由、更多页面/面板和样式全部真实运行。
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

  /** 能力矩阵：PRIMARY_NAV 的每个入口都按真实点击到达，并断言路由与当前栏目。 */
  async function assertNavigationMatrix() {
    try { await walkNavigation() } finally {
      // 夹具不提供百科与科技树的资产数据，矩阵只判导航；其余 console.error 仍算失败。
      page.consoleErrors = page.consoleErrors.filter(message => !/(tech tree|tank cache|tankopedia) load failed/.test(message))
    }
  }
  async function walkNavigation() {
    const tabBar = await page.evaluate('!!document.querySelector("[data-testid=app-tab-bar]")')
    if (!tabBar) {
      for (const item of primaryNavItems('127.0.0.1').filter(entry => entry.id !== 'more')) {
        await tap(`[data-testid=nav-${item.id}]`)
        await viewIs(item.view)
        await isCurrent(`[data-testid=nav-${item.id}]`)
      }
      return
    }
    check(await page.evaluate('document.querySelectorAll("[data-testid=app-tab-bar] .tab").length') === COMPACT_TAB_ITEMS.length, 'compact tab count must follow COMPACT_TAB_ITEMS')
    check(await page.evaluate(`[...document.querySelectorAll('[data-testid=app-tab-bar] .tab')].every(tab => tab.getAttribute('aria-label').includes(tab.querySelector('.tab-label').textContent.trim()))`), 'tab accessible name must contain its visible label')
    for (const item of COMPACT_TAB_ITEMS) {
      await tap(`[data-testid=tab-${item.id}]`)
      await viewIs(item.view)
      await isCurrent(`[data-testid=tab-${item.id}]`)
    }
    for (const item of COMPACT_SHORTCUT_ITEMS) {
      await tap('[data-testid=tab-more]')
      await page.waitForValue(`!!document.querySelector("[data-testid=more-shortcut-${item.id}]")`, Boolean, { label: `shortcut ${item.id}` })
      await tap(`[data-testid=more-shortcut-${item.id}]`)
      await viewIs(item.view)
      await isCurrent('[data-testid=tab-more]')
    }
    await tap('[data-testid=app-top-bar] .brand')
    await viewIs('replay')
    await isCurrent('[data-testid=tab-replay]')
  }

  try {
    await page.emulate(scenario)
    await page.goto(`${env.origin}/?view=more&ws-auth=0`)
    await page.waitForValue('!!document.querySelector("[data-testid=more-page]")', Boolean)
    if (scenario.touch) {
      // 页脚备案号是法定文字链接（WCAG 2.5.8 inline 例外），不是任务控件
      const touch = await measureTouchTargets(page, { exclude: ['footer'] })
      check(touch.scanned > 0, 'shell touch sweep must not be empty')
      failures.push(...touch.failures)
    }
    const mobile = scenario.width < 768
    if (mobile) {
      const occlusion = await measureOcclusion(page, {
        primary: '[data-testid=more-page] .page-header', persistent: ['[data-testid=app-top-bar]', '[data-testid=app-tab-bar]'],
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
      // 返回页内链接使用真实路由。
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
      // 独立负向对照：透明遮挡也必须被探针识别，移除后恢复真实选择路径。
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
