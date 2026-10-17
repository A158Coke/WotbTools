import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'
import { primaryNavItems } from '../src/app/navigation.js'

// Exercise the production router, components, transport validators and CSS. Only external
// auth and HTTP services are fixtures, shared by anonymous and administrator requests.
const servers = ['CN', 'ASIA', 'NA', 'EU', 'LESTA']
const coverId = '493199ec-c421-456b-a865-dcd69ef4c62a'
let db
function reset() {
  db = { seasons: [{ id: 10, server: 'CN', year: 2026, name: 'Summer league — international tournament', startDate: '2026-08-16', createdAt: '2026-07-01T00:00:00Z', version: 0, rootCount: 1, replayCount: 1 }],
    categories: [{ id: 20, seasonId: 10, type: 'POINTS' }],
    nodes: [{ id: 30, categoryId: 20, roundNumber: 1, format: null, replays: [{ id: 40, nodeId: 30, title: 'Final day — a long broadcast title for narrow screens', url: 'https://example.org/watch', matchDate: '2026-08-16', dayNumber: 7, groupLabel: 'International group A', groupNumber: null, bracket: null, teams: ['Followed team', 'Other international team'], perspective: 'POV', coverId }] }],
    nextId: 100, failNext: false }
}
const publicBase = '/api/tournament-broadcasts', adminBase = '/api/admin/tournament-broadcasts'
function send(response, status, value) {
  response.statusCode = status
  if (value === undefined) { response.end(); return }
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(value))
}
function failure(response, status, code) {
  send(response, status, { id: 'broadcast-browser-fixture', errorCode: code, errorMsg: null, status, retryable: false, details: {}, timestamp: null })
}
const seasonView = season => ({ season, categories: db.categories.filter(value => value.seasonId === season.id), coverUploadAvailable: true })
const categoryView = category => ({ season: db.seasons.find(value => value.id === category.seasonId), category, nodes: db.nodes.filter(value => value.categoryId === category.id), coverUploadAvailable: true })
function recount(season) {
  const categories = db.categories.filter(value => value.seasonId === season.id).map(value => value.id)
  const nodes = db.nodes.filter(value => categories.includes(value.categoryId))
  season.rootCount = nodes.length; season.replayCount = nodes.reduce((sum, value) => sum + value.replays.length, 0)
}
const middleware = async (request, response, next) => {
  const url = new URL(request.url, 'http://fixture'), path = url.pathname
  if (path === '/api/observability/events') { send(response, 204); return }
  if (path === '/api/health') { send(response, 200, { status: 'ok', tanks: 0, capabilities: ['creators-v1'] }); return }
  if (!path.startsWith(publicBase) && !path.startsWith(adminBase)) { next(); return }
  try {
    const admin = path.startsWith(adminBase), base = admin ? adminBase : publicBase
    const parts = path.slice(base.length).split('/').filter(Boolean), targetId = Number(parts[1])
    if (admin && request.headers.authorization !== 'Bearer fixture-access-token') { failure(response, 403, 'AUTH_FORBIDDEN'); return }
    if (!parts.length) { send(response, 200, { servers, seasons: db.seasons.filter(value => value.server === url.searchParams.get('server')), coverUploadAvailable: true }); return }
    if (parts[0] === 'covers') { response.statusCode = 404; response.end(); return }
    let season = parts[0] === 'seasons' ? db.seasons.find(value => value.id === targetId) : null
    let category = parts[0] === 'categories' ? db.categories.find(value => value.id === targetId) : null
    let node = parts[0] === 'nodes' ? db.nodes.find(value => value.id === targetId) : null
    const replay = parts[0] === 'replays' ? db.nodes.flatMap(value => value.replays).find(value => value.id === targetId) : null
    if (replay) node = db.nodes.find(value => value.id === replay.nodeId)
    if (node) category = db.categories.find(value => value.id === node.categoryId)
    if (category) season = db.seasons.find(value => value.id === category.seasonId)
    if (request.method === 'GET') {
      if (!season) { failure(response, 404, 'RESOURCE_NOT_FOUND'); return }
      if (parts[2] === 'deletion-preview') send(response, 200, { seasonId: season.id, expectedVersion: season.version, rootCount: node ? 1 : season.rootCount, replayCount: node ? node.replays.length : season.replayCount })
      else send(response, 200, category ? categoryView(category) : seasonView(season))
      return
    }
    let payload
    if (request.method !== 'DELETE') {
      const incoming = new Request(url, { method: request.method, headers: request.headers, body: Readable.toWeb(request), duplex: 'half' })
      payload = String(request.headers['content-type']).startsWith('multipart/')
        ? JSON.parse(await (await incoming.formData()).get('payload').text()) : await incoming.json()
    }
    if (db.failNext) { db.failNext = false; failure(response, 400, 'INVALID_ARGUMENT'); return }
    if (season && (payload?.expectedVersion ?? Number(url.searchParams.get('expectedVersion'))) !== season.version) { failure(response, 409, 'BROADCAST_VERSION_CONFLICT'); return }
    if (request.method === 'DELETE') {
      if (replay) node.replays = node.replays.filter(value => value.id !== targetId)
      else if (node) db.nodes = db.nodes.filter(value => value.id !== targetId)
      else if (season) db.seasons = db.seasons.filter(value => value.id !== targetId)
      if (season) { season.version++; recount(season) }
      send(response, 204); return
    }
    if (parts[0] === 'seasons' && parts.length === 1) {
      season = { ...payload, id: db.nextId++, version: 0, createdAt: '2026-10-16T00:00:00Z', rootCount: 0, replayCount: 0 }
      db.seasons.push(season)
    } else if (parts[0] === 'seasons' && parts.length === 2) {
      Object.assign(season, { year: payload.year, name: payload.name, startDate: payload.startDate }); season.version++
    } else if (parts[2] === 'categories') {
      category = { id: db.nextId++, seasonId: season.id, type: payload.type }; db.categories.push(category); season.version++
      send(response, 200, seasonView(season)); return
    } else if (parts[2] === 'nodes') {
      node = { id: db.nextId++, categoryId: category.id, roundNumber: payload.roundNumber, format: payload.format, replays: [] }
      db.nodes.push(node); season.version++; recount(season)
    } else {
      const { expectedVersion, coverAction, ...fields } = payload
      if (replay) Object.assign(replay, fields)
      else node.replays.push({ ...fields, id: db.nextId++, nodeId: node.id, coverId: null })
      season.version++; recount(season)
    }
    send(response, 200, category ? categoryView(category) : seasonView(season))
  } catch (error) { console.error(error); failure(response, 500, 'INTERNAL_ERROR') }
}

const { server, origin } = await startFixtureServer({ middleware, allowedHosts: ['wotbtools.com'] })

const chrome = await launchChromeForCdp(findChrome(), { extraArgs: ['--host-resolver-rules=MAP wotbtools.com 127.0.0.1', '--no-proxy-server'] })
const screenshots = process.env.BROADCAST_SCREENSHOTS
const scenarios = ['showcase', 'classic'].flatMap(profile => [
  { name: `${profile}-desktop`, profile, width: 1440, height: 900, touch: false, locale: 'en', productionHome: true },
  { name: `${profile}-tablet`, profile, width: 1024, height: 768, touch: true, locale: 'zh' },
  { name: `${profile}-mobile`, profile, width: 390, height: 844, touch: true, locale: 'ru' },
  { name: `${profile}-production-mobile`, profile, width: 360, height: 844, touch: true, locale: 'ru', productionHome: true, geometryOnly: true },
  { name: `${profile}-wide`, profile, width: 2560, height: 1440, touch: false, locale: 'zh', geometryOnly: true },
  { name: `${profile}-short-phone`, profile, width: 667, height: 375, touch: true, locale: 'en', geometryOnly: true },
  ...[360, 767, 768, 1199, 1200].map(width => ({ name: `${profile}-boundary-${width}`, profile, width, height: 900, touch: width < 768, locale: 'en', geometryOnly: true })),
])
let failures = 0
const nameFilter = process.argv[2]
const selectedScenarios = scenarios.filter(value => !nameFilter || value.name.includes(nameFilter))
async function tap(page, selector, touch) {
  await page.waitForValue(`!!document.querySelector(${JSON.stringify(selector)})`, Boolean)
  const point = await page.evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.scrollIntoView({block:'center', inline:'nearest'}); const r = element.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`)
  await page.tap({ ...point, touch })
}
async function fill(page, values) {
  await page.evaluate(`(() => { for (const [id,value] of Object.entries(${JSON.stringify(values)})) { const el=document.querySelector('[data-testid="'+id+'"]'); el.value=String(value); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); } })()`)
}
async function geometry(page) {
  const result = await page.evaluate(`(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1,
    tiny: matchMedia('(pointer:coarse)').matches ? [...document.querySelectorAll('[data-testid="league-broadcasts-page"] button')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.height<43}).map(el=>el.dataset.testid||el.textContent) : [],
    tabs:[...document.querySelectorAll('[data-testid="app-tab-bar"] .tab')].map(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height}}),
    profile:document.documentElement.dataset.uiProfile }))()`)
  assert.equal(result.overflow, false, 'horizontal overflow')
  assert.deepEqual(result.tiny, [], 'minimum 44px hit targets')
  for (const tab of result.tabs) {
    assert.ok(tab.width >= 44 && tab.height >= 44, 'primary tab remains at least 44px wide and tall')
  }
}
async function serverGeometry(page, scenario, count) {
  await page.waitForValue('document.querySelectorAll("[data-testid=broadcast-servers] .broadcast-server-card").length', value => value === count)
  await page.waitForValue('document.querySelector("[data-testid=broadcast-servers]")?.style.getPropertyValue("--broadcast-grid-top")', Boolean)
  const layout = await page.evaluate(`(() => {
    const grid = document.querySelector('[data-testid=broadcast-servers]'), style = getComputedStyle(grid)
    return { cards: [...grid.querySelectorAll('.broadcast-server-card')].map(el => { const r=el.getBoundingClientRect(); return { x:r.x, y:r.y+scrollY, width:r.width, height:r.height, bottom:r.bottom+scrollY, icon:!!el.querySelector('.broadcast-server-emblem svg'), code:el.querySelector('.broadcast-server-code').textContent }; }),
      gap:parseFloat(style.rowGap), top:parseFloat(style.getPropertyValue('--broadcast-grid-top')), tail:parseFloat(style.getPropertyValue('--broadcast-grid-tail')),
      tabs:document.querySelector('[data-testid=app-tab-bar]')?.getBoundingClientRect().height ?? 0, viewport:innerHeight }
  })()`)
  const [first, second, third, fourth, fifth] = layout.cards
  assert.ok(layout.cards.every(card => card.height >= 200 && card.icon && servers.includes(card.code)), 'large cards include region code and Lucide icon')
  if (scenario.width >= 768) {
    assert.ok(Math.abs(first.y - second.y) < 1 && second.x > first.x, 'desktop and tablet use two columns')
    assert.ok(third.y > first.y && Math.abs(third.y - fourth.y) < 1, 'four cards form two rows')
    if (fifth) assert.ok(fifth.y > fourth.y, 'fifth server follows on the next row')
  } else {
    assert.ok(layout.cards.every(card => Math.abs(card.x - first.x) < 1), 'phone is one column')
    assert.ok(second.y > first.y, 'phone cards stack vertically')
  }
  const expected = Math.max(200, (layout.viewport - layout.top - layout.tail - layout.gap) / 2)
  assert.ok(Math.abs(first.height - expected) < 2, `cards fill two available rows: ${JSON.stringify(layout)}`)
  if (expected > 200 && count === 5) {
    const secondRowEnd = scenario.width < 768 ? second.bottom : fourth.bottom
    assert.ok(Math.abs(secondRowEnd - (layout.viewport - layout.tabs)) < 2, 'first two rows fill the viewport without reserving offscreen footer space')
  }
  await geometry(page)
}

try {
  assert.ok(selectedScenarios.length, `no scenario matches ${nameFilter}`)
  for (const scenario of selectedScenarios) {
    reset()
    const { targetId, sessionId } = await chrome.openPage()
    const page = new Page(chrome.client, sessionId)
    try {
      await page.enable(); await page.emulate(scenario)
      await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('wotb-ui-profile',${JSON.stringify(scenario.profile)});localStorage.setItem('wotb-lang',${JSON.stringify(scenario.locale)});` }, sessionId)
      const scenarioOrigin = scenario.productionHome ? origin.replace('127.0.0.1', 'wotbtools.com') : origin
      await page.goto(`${scenarioOrigin}/?view=more&ws-auth=0`)
      await page.waitForValue('!!document.querySelector("[data-testid=more-page]")', Boolean)
      assert.equal(await page.evaluate('!!document.querySelector("[data-testid=more-link-league-broadcasts]")'), false)
      const navigation = scenario.width < 768 ? 'tab' : 'nav'
      await tap(page, `[data-testid=${navigation}-league-broadcasts]`, scenario.touch)
      await page.waitForValue('document.querySelectorAll("[data-testid^=broadcast-server-]").length', value => value === 5)
      assert.equal(await page.evaluate(`document.querySelector('[data-testid="${navigation}-league-broadcasts"]').getAttribute('aria-current')`), 'page')
      const navLabel = await page.evaluate(`(() => { const link = document.querySelector('[data-testid="${navigation}-league-broadcasts"]'); return { visible: link.textContent.trim(), accessible: link.getAttribute('aria-label') }; })()`)
      assert.ok(navLabel.accessible.includes(navLabel.visible), 'accessible name includes the visible navigation label')
      if (scenario.width < 768) {
        assert.equal(await page.evaluate('document.querySelectorAll("[data-testid=app-tab-bar] .tab").length'), primaryNavItems(new URL(scenarioOrigin).hostname).length)
      }
      await serverGeometry(page, scenario, 5)
      if (screenshots && ['showcase-desktop', 'classic-mobile'].includes(scenario.name)) {
        await mkdir(screenshots, { recursive: true })
        const image = await chrome.client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId)
        await writeFile(join(screenshots, `${scenario.name}-servers.png`), Buffer.from(image.data, 'base64'))
      }
      if (scenario.name.endsWith('-desktop')) {
        await page.emulate({ ...scenario, width: 1280, height: 720 })
        await serverGeometry(page, { ...scenario, width: 1280, height: 720 }, 5)
        await page.emulate(scenario)
        await serverGeometry(page, scenario, 5)
      }
      await tap(page, '[data-testid=broadcast-server-LESTA]', scenario.touch)
      await page.waitForValue('!!document.querySelector("[data-testid=broadcast-seasons]")', Boolean)
      assert.equal(await page.evaluate('new URLSearchParams(location.search).get("lbServer")'), 'LESTA', 'fifth server remains reachable by scrolling')
      await tap(page, '[data-testid=broadcast-back]', scenario.touch)
      await tap(page, '[data-testid=broadcast-server-CN]', scenario.touch)
      await tap(page, '[data-testid=broadcast-enter-season-10]', scenario.touch)
      await tap(page, '[data-testid=broadcast-category-20]', scenario.touch)
      await page.waitForValue('document.querySelector("[data-testid=broadcast-node-toggle-30]")?.getAttribute("aria-expanded")', value => value === 'false')
      assert.equal(await page.evaluate('!!document.querySelector("[data-testid=broadcast-new-node]")'), false, 'anonymous mutation hidden')
      await tap(page, '[data-testid=broadcast-node-toggle-30]', scenario.touch)
      await page.waitForValue('!!document.querySelector("[data-testid=broadcast-replay-40]")', Boolean)
      await geometry(page)
      assert.equal(await page.evaluate('document.querySelector("[data-testid=broadcast-replay-40] a")?.getAttribute("rel")'), 'noopener noreferrer')
      if (screenshots && ['showcase-desktop', 'classic-mobile'].includes(scenario.name)) {
        await mkdir(screenshots, { recursive: true })
        const image = await chrome.client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId)
        await writeFile(join(screenshots, `${scenario.name}.png`), Buffer.from(image.data, 'base64'))
      }
      if (!scenario.geometryOnly) {
        await page.goto(`${origin}/?view=league-broadcasts&lbServer=CN&lbSeason=10&lbCategory=20&ws-auth=1&ws-roles=wotbtools-admin`)
        await tap(page, '[data-testid=broadcast-new-replay-30]', scenario.touch)
        await fill(page, { 'broadcast-title': 'Created in browser', 'broadcast-url': 'https://example.org/new', 'broadcast-date': '2026-10-16', 'broadcast-day': 7, 'broadcast-team-0': 'Followed', 'broadcast-team-1': 'Other', 'broadcast-group-label': 'Group Z' })
        db.failNext = true
        await tap(page, '[data-testid=broadcast-replay-save]', scenario.touch)
        await page.waitForValue('document.querySelectorAll("[data-testid=broadcast-replay-dialog] [role=alert]").length', value => value > 0)
        assert.equal(await page.evaluate('document.querySelector("[data-testid=broadcast-title]").value'), 'Created in browser', 'failed save retains draft')
        assert.equal(await page.evaluate('!!document.querySelector("[data-testid=broadcast-node-toggle-30]")'), true, 'failed mutation retains public tree')
        await fill(page, { 'broadcast-title': 'Corrected in browser' })
        await tap(page, '[data-testid=broadcast-replay-save]', scenario.touch)
        await page.waitForValue('!document.querySelector("[data-testid=broadcast-replay-dialog]")', Boolean)
        const replayId = db.nodes[0].replays.at(-1).id
        await tap(page, `[data-testid=broadcast-edit-replay-${replayId}]`, scenario.touch)
        db.seasons[0].version++
        await tap(page, '[data-testid=broadcast-replay-save]', scenario.touch)
        await page.waitForValue('!!document.querySelector("[data-testid=broadcast-editor-reload]")', Boolean)
        await tap(page, '[data-testid=broadcast-editor-reload]', scenario.touch)
        await page.waitForValue('!!document.querySelector("[data-testid=broadcast-replay-dialog]") && !document.querySelector("[data-testid=broadcast-editor-reload]")', Boolean)
        await fill(page, { 'broadcast-title': 'Updated after conflict' })
        await tap(page, '[data-testid=broadcast-replay-save]', scenario.touch)
        await page.waitForValue('!document.querySelector("[data-testid=broadcast-replay-dialog]")', Boolean)
        assert.equal(db.nodes[0].replays.at(-1).title, 'Updated after conflict')
        await tap(page, `[data-testid=broadcast-delete-replay-${replayId}]`, scenario.touch)
        await tap(page, '[data-testid=confirm-ok]', scenario.touch)
        await page.waitForValue(`!document.querySelector('[data-testid="broadcast-replay-${replayId}"]')`, Boolean)
        assert.equal(db.nodes[0].replays.length, 1)
        await tap(page, '[data-testid=broadcast-new-replay-30]', scenario.touch)
        await page.evaluate('window.__wsAuth.tokenParsed.value={realm_access:{roles:[]}}')
        await page.waitForValue('!document.querySelector("[data-testid=broadcast-replay-dialog]") && !document.querySelector("[data-testid=broadcast-new-node]")', Boolean)
        await page.waitForValue('!!document.querySelector("[data-testid=broadcast-node-toggle-30]")', Boolean)
        await geometry(page)
      }
      assert.deepEqual(page.consoleErrors, [], 'no uncaught browser errors')
      console.log(`PASS ${scenario.name}`)
    } catch (error) {
      failures++; console.error(`FAIL ${scenario.name}: ${error.message}\n${(await page.diagnose(() => ({url:location.href,text:document.body.textContent.slice(0,2500)}))).join('\n')}`)
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }
} finally { await chrome.close(); await server.close() }
if (failures) process.exitCode = 1
