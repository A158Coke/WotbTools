import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHofAdminFixture } from './browser-fixtures/hof-admin-fixture.mjs'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { parseScenarioArgs, selectShard } from './browser-scenario-args.mjs'
import { setTimeout as pollDelay } from 'node:timers/promises'
import { runReviewDetail } from './browser-hof-review-detail.mjs'
import { assertStickyPositions } from './browser-hof-sticky.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

const fixture = createHofAdminFixture()

function tabsProbe() {
  const bar = document.querySelector('.hof-admin-tabs')
  if (!bar) return null
  const style = getComputedStyle(bar)
  const rootStyle = getComputedStyle(document.documentElement)
  const rect = bar.getBoundingClientRect()
  return {
    position: style.position,
    top: style.top,
    zIndex: style.zIndex,
    overflowX: style.overflowX,
    headerH: rootStyle.getPropertyValue('--header-h').trim(),
    space2: rootStyle.getPropertyValue('--space-2').trim(),
    zSticky: rootStyle.getPropertyValue('--z-sticky').trim(),
    scrollWidth: bar.scrollWidth,
    clientWidth: bar.clientWidth,
    viewportWidth: innerWidth,
    tabCount: bar.querySelectorAll('button').length,
  }
}

const px = (value) => parseFloat(value) || 0
const check = (failures, ok, message) => { if (!ok) failures.push(message) }

async function runSticky(env) {
  fixture.reset(20)
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  await page.enable()
  try {
    await page.emulate({ width: 1024, height: 480, touch: false })
    await page.goto(`${env.origin}/`)
    await page.evaluate(`localStorage.setItem('wotb-lang', 'zh-CN')`)
    await page.goto(`${env.origin}/?view=hof-admin&ws-auth=1&ws-roles=wotbtools-admin&ws-auth-init=resolve-authenticated`)
    await page.waitForValue('document.querySelectorAll(".hof-admin-table tbody tr").length', count => count === 20, { label: 'sticky fixture rows loaded' })
    await page.waitForValue('document.querySelector("[data-testid=hof-pending-badge]")?.textContent.trim()', count => count === '12')
    await page.evaluate('window.scrollTo({ top: 0, behavior: "instant" })')
    await page.evaluate('document.fonts.ready')
    await page.animationsSettled()
    const state = await page.waitForValue(`(${tabsProbe.toString()})()`, probe => Boolean(probe?.tabCount), { label: 'hof-admin tabs rendered' })

    check(failures, state.position === 'sticky', `tabs must be position:sticky (got ${state.position})`)
    const expectedTop = px(state.headerH) + px(state.space2)
    check(failures, Math.abs(px(state.top) - expectedTop) <= 0.5, `tabs top must equal --header-h + --space-2 = ${expectedTop}px (got ${state.top}, --header-h=${state.headerH})`)
    check(failures, state.zIndex === String(parseInt(state.zSticky, 10)), `tabs z-index must equal --z-sticky=${state.zSticky} (got ${state.zIndex})`)

    const sticky = await assertStickyPositions(page, ['.hof-admin-tabs'])
    console.log('[browser-hof-admin-tabs] sticky geometry', sticky)
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  return failures
}

async function runNarrowScrollable(env) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  await page.enable()
  try {
    await page.emulate({ width: 320, height: 640, touch: true })
    await page.goto(`${env.origin}/`)
    await page.evaluate(`localStorage.setItem('wotb-lang', 'zh-CN')`)
    await page.goto(`${env.origin}/?view=hof-admin&ws-auth=1&ws-roles=wotbtools-admin&ws-auth-init=resolve-authenticated`)
    const state = await page.waitForValue(`(${tabsProbe.toString()})()`, probe => Boolean(probe?.tabCount), { label: 'narrow: hof-admin tabs rendered' })

    check(failures, state.overflowX === 'auto', `narrow: tabs must be horizontally scrollable (got overflow-x ${state.overflowX})`)
    if (state.scrollWidth > state.clientWidth) {
      const end = await page.evaluate(`(() => {
        const bar = document.querySelector('.hof-admin-tabs')
        bar.scrollLeft = bar.scrollWidth
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
          const last = bar.querySelector('button:last-child')
          const rect = last.getBoundingClientRect()
          resolve({ scrollLeft: bar.scrollLeft, lastRight: rect.right, barRight: bar.getBoundingClientRect().right })
        })))
      })()`)
      check(failures, end.scrollLeft > 0, 'narrow: tabs bar must actually scroll horizontally when content overflows')
      check(failures, end.lastRight <= end.barRight + 1, `narrow: last tab must be fully visible after scrolling (right ${end.lastRight.toFixed(1)} vs bar ${end.barRight.toFixed(1)})`)
    } else {
      check(failures, state.clientWidth >= state.scrollWidth, 'narrow: overflow must be real or fully visible')
    }
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  return failures
}


async function waitFor(predicate, label) {
  const until = Date.now() + 10_000
  while (!predicate() && Date.now() < until) await pollDelay(20)
  assert.ok(predicate(), label)
}

async function key(page, name, code) {
  for (const type of ['keyDown', 'keyUp']) {
    await page.client.send('Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: code,
      ...(name === 'Enter' && type === 'keyDown' ? { text: '\r' } : {}) }, page.sessionId)
  }
}

async function checkRecordActions(page, tap, present) {
  const firstRow = '.hof-admin-table tbody tr:first-child'
  const del = firstRow + ' .actions .danger'
  await tap(firstRow + ' .actions button:not(.danger)')
  assert.equal(fixture.requests.filter(r => r.pathname === '/api/admin/hof/71/replay').length, 1)
  await tap(del)
  await tap('.hof-delete-modal .modal-actions button:not(.danger)')
  assert.equal(fixture.requests.filter(r => r.method === 'DELETE').length, 0)
  await tap(del)
  await tap('.hof-delete-modal .modal-actions .danger')
  await page.waitForValue("document.querySelectorAll('.hof-admin-table tbody tr').length", n => n === 2)
  await tap('.hof-check input[type=checkbox]')
  await tap('.hof-bulk-bar .danger')
  await present('.admin-confirm-input')
  assert.equal(await page.evaluate("document.querySelector('.bulk-delete-modal .modal-actions .danger').disabled"), true)
  await tap('.admin-confirm-input')
  await page.client.send('Input.insertText', { text: 'DELETE' }, page.sessionId)
  await tap('.bulk-delete-modal .modal-actions .danger')
  await page.waitForValue("document.querySelector('.hof-bulk-failures')?.textContent", text => text?.includes('#73'))
  await tap('.bulk-delete-modal .modal-actions button')
  await page.waitForValue("document.querySelectorAll('.hof-admin-table tbody tr').length", n => n === 1)
  assert.equal(await page.evaluate("document.querySelector('.hof-admin-table tbody input').checked"), true)
  await tap('.hof-admin-tabs button:nth-child(2)')
  await page.waitForValue("document.querySelector('.hof-admin-tabs button:nth-child(2)')?.getAttribute('aria-selected')", v => v === 'true')
}

async function reviewTwoSubmissions({ page, tap, present, domain, list, snapshot }) {
  const queue = '.hof-queue-item'
  for (const position of [1, 2]) {
    if (position === 1) await snapshot(domain + '-queue', queue)
    await tap(`${queue}:nth-child(${position}) [data-testid=hof-queue-open]`)
    const approve = '.hof-review-decision .ok:not(:disabled)'
    await present(approve)
    if (position === 1) {
      await snapshot(domain + '-detail', '.hof-review-top')
      await snapshot(domain + '-actions', approve)
      await tap('.hof-zoom-proof')
      await present('.screenshot-zoom [role=dialog]')
      await key(page, 'Escape', 27)
      await page.waitForValue("!document.querySelector('.screenshot-zoom [role=dialog]')", Boolean)
      await page.waitForValue("document.activeElement.matches('.hof-zoom-proof')", Boolean, { label: 'zoom returns focus' })
      await key(page, 'Enter', 13)
      await page.waitForValue("!!document.querySelector('.screenshot-zoom [role=dialog]')", Boolean, { label: 'zoom opens on Enter' })
      await key(page, 'Escape', 27)
      await present(approve)
    }
    await tap(approve)
    await present('.hundred-confirm')
    assert.equal(fixture.requests.filter(request => request.pathname.startsWith(list) && request.method === 'POST').length, position - 1)
    await tap('.hundred-action-area .ok')
    await present(`${queue}:nth-child(${position}) .hundred-status-current`)
    assert.equal(await page.evaluate("!!document.querySelector('.hof-review-pane')"), false)
    const expectedId = (domain === 'hundred' ? 10 : 30) + position
    await page.waitForValue("document.activeElement.dataset.recordId", id => id === String(expectedId), { label: 'approved row regains focus' })
  }
  await tap(`${queue}:nth-child(3) [data-testid=hof-queue-open]`)
  await present('.hof-review-pane .replay-evidence-item:nth-child(4)')
  await present('.hof-review-decision .ok:disabled')
  await tap('[data-testid=hof-review-back]')
  assert.deepEqual(fixture.requests.filter(request => request.method === 'POST' && request.pathname.startsWith(list))
    .map(request => request.pathname.slice(list.length)), (domain === 'hundred' ? [11, 12] : [31, 32]).map(id => `/${id}/approve`))
}

const box = '.hof-admin-filters [role=combobox]'

async function chooseVehicle({ page, tap, present, touch, list, domain, width, screenshot }) {
  if (touch) await tap("[data-testid=filter-toggle]")
  await present(`${box}:not(:disabled)`)
  const listRequests = () => fixture.requests.filter(request => request.pathname === list && request.query.size !== '1')
  const count = () => listRequests().length
  await tap(box)
  await page.waitForValue("document.querySelectorAll('.hof-admin-filters [role=option]').length - 1", n => domain === 'records' ? n === 12 : n > 10)
  await waitFor(() => count() > 0, 'initial list reached fixture')
  const initial = count()
  await screenshot(width, domain)
  await page.client.send('Input.insertText', { text: domain === 'records' ? 'Fixture Tank 12' : 'Progetto 65' }, page.sessionId)
  const first = '.hof-admin-filters [role=option]'
  const id = domain === 'records' ? '1011' : '385'
  await page.waitForValue(`document.querySelector(${JSON.stringify(first)})?.dataset.id`, value => value === id)
  assert.equal(count(), initial, 'typing must not query the list')
  await key(page, 'Enter', 13)
  await present(`${box}[data-value="${id}"][aria-expanded=false]`)
  const requestsAfterSelect = () => fixture.requests.filter(request => request.pathname === list && request.query[domain === 'records' ? 'tankId' : 'vehicleId'] === id)
  await waitFor(() => requestsAfterSelect().length > 0, 'vehicle filter reached fixture')
  assert.equal(count(), initial + 1, 'one choice must make exactly one request')
  assert.equal(listRequests().at(-1).query[domain === 'records' ? 'tankId' : 'vehicleId'], id)
  assert.equal(await page.evaluate(`document.activeElement.matches(${JSON.stringify(box)})`), true)
  if (touch) {
    await tap('[data-testid=admin-filter-done]')
    const chip = `[data-testid=filter-chip][data-key="${domain === 'records' ? 'tankId' : 'vehicleId'}"]`
    await present(chip)
    await tap(chip)
    await page.waitForValue(`!document.querySelector(${JSON.stringify(chip)})`, Boolean)
    assert.equal(count(), initial + 2)
    assert.equal(listRequests().at(-1).query[domain === 'records' ? 'tankId' : 'vehicleId'], undefined)
  }
}

async function runVehiclesAndReviews(env, { width, height, theme, review }) {
  fixture.reset()
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  const touch = width < 768
  const tap = selector => page.tapSelector(selector, touch)
  const present = selector => page.waitForValue(`!!document.querySelector(${JSON.stringify(selector)})`, Boolean)
  async function capture(width, domain) {
    if (!process.env.HOF_SCREENSHOTS) return
    await mkdir(process.env.HOF_SCREENSHOTS, { recursive: true })
    const shot = await env.chrome.client.send('Page.captureScreenshot', { format: 'png' }, sessionId)
    await writeFile(join(process.env.HOF_SCREENSHOTS, `after-${width}-${domain}.png`), Buffer.from(shot.data, 'base64'))
  }
  async function snapshot(name, selector) {
    if (!process.env.HOF_SCREENSHOTS) return
    await present(selector)
    await page.callWith(sel => document.querySelector(sel).scrollIntoView({ block: 'center' }), selector)
    await page.animationsSettled()
    await capture(width, theme + '-' + name)
  }
  try {
    await page.enable()
    await page.emulate({ width, height, touch, deviceScaleFactor: 1 })
    await page.goto(env.origin)
    await page.callWith(profile => {
      localStorage.setItem('wotb-lang', 'en')
      localStorage.setItem('wotb-ui-profile', profile)
    }, theme)
    await page.goto(`${env.origin}/?view=hof-admin&ws-auth=1&ws-roles=HoF-admin&ws-auth-init=resolve-authenticated`)
    await present(touch ? "[data-testid=filter-toggle]" : box)
    assert.equal(await page.evaluate('document.documentElement.dataset.uiProfile'), theme)
    for (const [domain, tab] of [['records', 1], ['hundred', 3], ['mark3', 4]]) {
      await tap(`.hof-admin-tabs button:nth-child(${tab})`)
      const list = domain === 'records' ? '/api/admin/hof' : `/api/admin/hof/${domain}/submissions`
      await chooseVehicle({ page, tap, present, touch, list, domain, width, screenshot: capture })
      if (review && domain === 'records') await checkRecordActions(page, tap, present)
      if (review && domain !== 'records') await reviewTwoSubmissions({ page, tap, present, domain, list, snapshot })
    }
    return []
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
}

const chromeBinary = findChrome()
const { server, origin } = await startFixtureServer({ middleware: fixture.middleware })
let chromeCdp = null
const results = []
try {
  chromeCdp = await launchChromeForCdp(chromeBinary, {
    extraArgs: [
      '--window-size=1440,900',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  })
  const env = { origin, chrome: chromeCdp }
  const scenarios = [['hof-admin-tabs-sticky', runSticky], ['hof-admin-tabs-narrow-scrollable', runNarrowScrollable]]
  for (const [theme, width, height, review] of [
    ['summer', 1280, 850, true], ['winter', 390, 664, true], ['spring', 900, 850, false], ['autumn', 360, 740, false],
    ['winter', 1280, 850, true], ['summer', 390, 664, true],
  ]) scenarios.push([`hof-admin-vehicles-${theme}-${width}`, env => runVehiclesAndReviews(env, { width, height, theme, review })])
  for (const [width, height, locale, theme, reduced] of [
    [1600, 900, 'zh', 'summer', false], [1280, 720, 'ru', 'winter', true],
    [1200, 600, 'zh', 'winter', false], [1199, 800, 'ru', 'summer', true],
    [900, 740, 'zh', 'winter', false], [390, 844, 'zh', 'summer', false],
    [360, 640, 'ru', 'winter', true], [844, 390, 'ru', 'summer', false],
  ]) {
    for (const domain of ['hundred', 'mark3']) {
      scenarios.push([`hof-review-detail-${width}-${domain}`, env => runReviewDetail(env, fixture, { width, height, locale, theme, reduced, domain })])
    }
  }
  const args = parseScenarioArgs(process.argv.slice(2))
  const selected = scenarios.filter(([name]) => !args.nameFilter || name.includes(args.nameFilter))
  for (const [name, run] of selectShard(selected, args)) {
    try {
      results.push({ name, failures: await run(env) })
    } catch (error) {
      results.push({ name, failures: [error.message] })
    }
  }
} finally {
  if (chromeCdp) await chromeCdp.close()
  await server.close()
}

let failed = 0
for (const result of results) {
  if (result.failures.length === 0) {
    console.log(`[browser-hof-admin-tabs] ${result.name} OK`)
    continue
  }
  failed += 1
  console.error(`[browser-hof-admin-tabs] ${result.name} FAILED`)
  for (const failure of result.failures) console.error(`  - ${failure}`)
}
if (failed > 0) {
  process.exitCode = 1
  console.error(`[browser-hof-admin-tabs] ${failed}/${results.length} scenarios failed`)
} else {
  console.log(`[browser-hof-admin-tabs] all ${results.length} scenarios passed`)
}
