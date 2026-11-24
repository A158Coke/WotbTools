/** #1090: real app, real portals, native Chromium touch input. No DIALOG_INLINE_KEY. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page, delay } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'
import { startFixtureAssetPack } from './browser-fixtures/fixture-asset-pack.mjs'

const baseline = process.env.PICKER_BASELINE === '1'
const evidence = process.env.PICKER_EVIDENCE_DIR
const nations = ['germany', 'ussr', 'usa', 'uk', 'france', 'china', 'japan', 'european', 'other']
const tankCache = Object.fromEntries(Array.from({ length: 747 }, (_, i) => [9001 + i, {
  id: 9001 + i, name: i ? `Tank ${String(i).padStart(3, '0')}` : 'E 100',
  tier: i ? i % 10 + 1 : 10, nation: nations[i % nations.length],
  type: ['heavyTank', 'mediumTank', 'lightTank', 'AT-SPG'][i % 4], speed: 30 + i % 40,
}]))
const json = body => ({ type: 'application/json', body: JSON.stringify(body) })
const assets = await startFixtureAssetPack({ tankCache, extraRoutes: {
  '/version.json': json({ client: 'wg', dataset_id: 'picker-fixture', release: 'test' }),
  '/tank_images/crops.json': json({}),
  '/research/devices.json': json({ devices: {}, presets: {} }),
  '/research/consumables.json': json({ items: {} }),
  '/research/provisions.json': json({ items: {} }),
  '/research/params/format.json': json({ params: {} }),
  '/research/params/structure.json': json([]),
  '/research/camouflage.json': json({ categories: {} }),
  '/research/skills.json': json({ items: {}, classes: {} }),
} })
const fixture = await startFixtureServer()
let browser
const results = []
const failures = []

function stateProbe() {
  const rect = el => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    const x = r.x + r.width / 2, y = r.y + Math.min(r.height / 2, 24)
    const hit = document.elementFromPoint(x, y)
    return { x: r.x, y: r.y, width: r.width, height: r.height,
      hit: hit?.closest('[data-testid]')?.getAttribute('data-testid') || hit?.className,
      reachable: !!hit && el.contains(hit), scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
      overflow: getComputedStyle(el).overflowY, touchAction: getComputedStyle(el).touchAction,
      inert: !!el.closest('[inert]'), ariaHidden: !!el.closest('[aria-hidden="true"]') }
  }
  return { url: location.href, expanded: document.querySelector('[data-testid="filter-toggle"]')?.getAttribute('aria-expanded'),
    dialogs: [...document.querySelectorAll('[role="dialog"]')].map(el => ({ state: el.getAttribute('data-state'), modal: el.getAttribute('aria-modal'), ...rect(el) })),
    filters: rect(document.querySelector('[data-testid="tank-filters"]')),
    panel: rect(document.querySelector('[data-testid="catalog-filter-panel"]')),
    list: rect(document.querySelector('.tp-results')),
    bodyOverflow: getComputedStyle(document.body).overflow,
    selected: document.querySelector('.tc-bulk-bar span')?.textContent,
    focus: document.activeElement?.getAttribute('data-testid') || document.activeElement?.tagName,
    events: window.__pickerEvents || [] }
}

async function swipe(page, send, selector) {
  const point = await page.evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width*.6,y:Math.min(r.bottom-24,innerHeight-40),end:Math.max(r.y+24,Math.min(r.bottom-24,innerHeight-40)-180)}})()`)
  const before = await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollTop`)
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, id: 1 }] })
  for (let i = 1; i <= 10; i++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + (point.end - point.y) * i / 10, id: 1 }] })
    await delay(20)
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await delay(350)
  return { before, after: await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollTop`) }
}

try {
  if (evidence) await mkdir(evidence, { recursive: true })
  browser = await launchChromeForCdp(findChrome())
  const version = await browser.client.send('Browser.getVersion')
  const scenarios = baseline ? [{ width: 440, height: 956, touch: true }] : [
    { width: 440, height: 956, touch: true }, { width: 360, height: 640, touch: true },
    { width: 390, height: 844, touch: true }, { width: 1440, height: 900, touch: false },
  ]
  const selected = scenarios.filter(item => !process.env.PICKER_WIDTH || item.width === Number(process.env.PICKER_WIDTH))
  assert.ok(selected.length, 'PICKER_WIDTH must select a scenario')
  for (const scenario of selected) {
    const { targetId, sessionId } = await browser.openPage()
    const page = new Page(browser.client, sessionId)
    const send = (method, params = {}) => browser.client.send(method, params, sessionId)
    const tap = selector => page.tapSelector(selector, scenario.touch)
    const shot = async name => {
      if (!evidence) return
      const image = await send('Page.captureScreenshot', { format: 'png' })
      await writeFile(resolve(evidence, `${baseline ? 'before' : 'after'}-${scenario.width}-${name}.png`), Buffer.from(image.data, 'base64'))
    }
    const escape = async () => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await page.animationsSettled()
    }
    try {
      await page.enable()
      await page.emulate({ ...scenario, deviceScaleFactor: 1 })
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('wotb-lang','zh');localStorage.setItem('wotb-ui-profile','summer')` })
      await page.goto(`${fixture.origin}/?view=agent-mobility&assets=${encodeURIComponent(assets.origin)}`)
      await page.waitFor(() => !!document.querySelector('[data-testid="mobility-add"]:not([disabled])'))
      await tap('[data-testid="mobility-add"]')
      await page.waitFor(() => document.querySelectorAll('[data-testid="tank-card"]').length > 0)
      await page.animationsSettled()
      await page.evaluate(`(() => {window.__pickerEvents=[];for(const type of ['touchstart','touchmove','click','keydown'])document.addEventListener(type,e=>{if(type==='touchmove'&&__pickerEvents.at(-1)?.type==='touchmove')return;__pickerEvents.push({type,target:e.target.closest('[data-testid]')?.dataset.testid||e.target.className,key:e.key})},true);window.__pickerList=document.querySelector('.tp-results')})()`)
      const initialUrl = await page.evaluate('location.href')
      if (!scenario.touch) {
        assert.equal(await page.evaluate(`document.querySelectorAll('[data-testid="filter-toggle"]').length`), 0)
        assert.equal(await page.evaluate(`document.querySelectorAll('[role="dialog"]').length`), 1)
        await shot('desktop')
        results.push({ scenario, desktop: await page.probe(stateProbe) })
        continue
      }
      const scrollBefore = await swipe(page, send, '.tp-results')
      assert.ok(scrollBefore.after > scrollBefore.before, 'list must scroll before opening filters')
      await shot('list')
      await tap('[data-testid="filter-toggle"]')
      await page.animationsSettled()
      const opened = await page.probe(stateProbe)
      await shot('filters')
      if (baseline) {
        assert.equal(opened.dialogs.length, 2, 'baseline creates two real modals')
        assert.equal(opened.filters.reachable, false, 'baseline filter is blocked by outer dialog')
        const scrollBlocked = await swipe(page, send, '.tp-results')
        await escape()
        await tap('.tc-bulk-bar button:first-of-type')
        await tap('[data-testid="filter-toggle"]')
        await page.animationsSettled()
        await shot('filters-selected-747')
        const allSelected = await page.probe(stateProbe)
        await page.tap({ x: opened.filters.x + opened.filters.width / 2, y: opened.filters.y + 24, touch: true })
        await page.animationsSettled()
        const dismissed = !await page.evaluate(`Boolean(document.querySelector('[data-testid="tank-catalog-menu"]'))`)
        await shot('hidden-filter-tap')
        results.push({ scenario, version, scrollBefore, opened, scrollBlocked, allSelected, hiddenFilterTapDismissedPicker: dismissed })
        continue
      }
      assert.equal(opened.dialogs.length, 1, 'picker retains a single modal')
      assert.ok(opened.panel.reachable, 'filter panel must receive actual input')
      assert.equal(opened.url, initialUrl, 'opening filters must not navigate')
      // Expand all details to make the panel overflow even at 440x956.
      for (const selector of ['#tp-nation summary', '#tp-type summary', '#tp-category summary']) await tap(selector)
      const panelScroll = await swipe(page, send, '[data-testid="catalog-filter-panel"]')
      assert.ok(panelScroll.after > panelScroll.before, 'overflowing filter panel must touch-scroll')
      await tap('[data-testid="filter-sheet-done"]')
      assert.equal(await page.evaluate(`document.activeElement?.dataset.testid`), 'filter-toggle', 'Done restores focus to filter toggle')
      assert.equal(await page.evaluate(`document.querySelector('.tp-results')===window.__pickerList`), true, 'result DOM remains mounted')
      assert.equal(await page.evaluate(`document.querySelector('.tp-results').scrollTop`), scrollBefore.after, 'panel switch preserves list position')
      const scrollAfter = await swipe(page, send, '.tp-results')
      assert.ok(scrollAfter.after > scrollAfter.before, 'list immediately scrolls after closing filters')
      await shot('list-restored')
      await tap('[data-testid="filter-toggle"]')
      // Shift-Tab can reach the outer Dialog close button; Escape still belongs to the subpanel.
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
      assert.equal(await page.evaluate(`document.activeElement?.classList.contains('dialog-close')`), true, 'Shift-Tab reaches the outer close button')
      await escape()
      assert.equal(await page.evaluate(`document.querySelectorAll('[role="dialog"]').length`), 1, 'Escape only closes subpanel')
      assert.equal(await page.evaluate(`document.activeElement?.dataset.testid`), 'filter-toggle', 'Escape restores focus')
      // Real search input and hidden draft. Keep filter changes independent from confirmation.
      await tap('[data-testid="tank-search"]')
      await send('Input.insertText', { text: 'e100' })
      await page.waitFor(() => document.querySelectorAll('[data-testid="tank-card"]').length === 1)
      await tap('[data-tank-id="9001"]')
      await tap('[data-testid="filter-toggle"]')
      if (!await page.evaluate(`document.querySelector('#tp-nation').open`)) await tap('#tp-nation summary')
      await tap('#tp-nation button[data-value="ussr"]')
      await tap('[data-testid="filter-sheet-done"]')
      assert.equal(await page.evaluate(`document.activeElement?.dataset.testid`), 'filter-toggle')
      assert.equal(await page.evaluate(`document.querySelector('[data-testid="tank-search"]').value`), 'e100')
      assert.ok(await page.evaluate(`document.querySelector('.tc-bulk-bar span').textContent.includes('1')`), 'hidden selected draft survives')
      assert.equal(await page.evaluate('location.href'), initialUrl, 'filtering must not change comparison route')
      for (let i = 0; i < 3; i++) { await tap('[data-testid="filter-toggle"]'); await tap('[data-testid="filter-sheet-done"]') }
      await shot('hidden-draft')
      await tap('.tc-bulk-bar button:last-of-type')
      await page.waitFor(() => !document.querySelector('[data-testid="tank-catalog-menu"]'))
      await page.waitFor(() => !!document.querySelector('.mob-table'))
      assert.ok(await page.evaluate(`document.querySelector('.mob-table').textContent.includes('E 100')`), 'confirmed vehicle appears in actual comparison')
      await shot('confirmed')
      await tap('[data-testid="mobility-add"]')
      await tap('[data-testid="catalog-clear"]')
      await tap('.tc-bulk-bar button:first-of-type')
      await tap('[data-testid="filter-toggle"]')
      await tap('[data-testid="filter-sheet-done"]')
      const allSelectedScroll = await swipe(page, send, '.tp-results.is-dialog-results')
      assert.ok(allSelectedScroll.after > allSelectedScroll.before, '747 selected: Done must release the actual list for native touch scroll')
      assert.ok(await page.evaluate(`document.querySelector('.tc-bulk-bar span').textContent.includes('747')`))
      await shot('747-restored')
      await page.tap({ x: 5, y: 8, touch: true })
      await page.waitFor(() => !document.querySelector('[data-testid="tank-catalog-menu"]'))
      results.push({ scenario, version, scrollBefore, opened, panelScroll, scrollAfter, allSelectedScroll, confirmed: true, explicitScrimDismiss: true })
    } catch (error) {
      await shot('failure').catch(() => {})
      failures.push({ scenario, error: error.stack, state: await page.probe(stateProbe).catch(() => null), diagnostics: await page.diagnose() })
    } finally { await browser.client.send('Target.closeTarget', { targetId }) }
  }
} finally {
  if (evidence) await writeFile(resolve(evidence, `${baseline ? 'before' : 'after'}.json`), JSON.stringify({ results, failures }, null, 2))
  await browser?.close()
  await assets.close()
  await fixture.server.close()
}
for (const failure of failures) console.error(JSON.stringify(failure))
console.log(`[browser-mobility-picker] ${baseline ? 'BASELINE' : 'REGRESSION'} ${failures.length ? 'FAIL' : 'PASS'} ${results.length} scenarios`)
if (failures.length) process.exitCode = 1
