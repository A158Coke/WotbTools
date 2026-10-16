import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

// Real application/router/transport/CSS; only the external HTTP/auth boundaries are fixtures.
let db
function reset() {
  db = { categories: [{ id: 1, name: 'High damage replays' }, { id: 2, name: 'Live commentary' }],
    levels: [{ id: 1, name: 'Professional' }], threshold: 200, active: new Set(), avatars: new Map(),
    creators: [{ id: 1, name: 'A creator with a long name for narrow screens', description: 'Recommended replays and commentary.', homepageUrl: 'https://space.bilibili.com/1000001', categoryIds: [1, 2], levelId: null, baseStars: 3, avatarId: null, score: 6, favoriteCount: 199, createdAt: '2026-10-16T00:00:00Z' },
      { id: 2, name: 'Assessed creator', description: null, homepageUrl: 'https://space.bilibili.com/1000002', categoryIds: [1], levelId: 1, baseStars: 3, avatarId: null, score: 7, favoriteCount: 300, createdAt: '2026-10-15T00:00:00Z' }],
    nextId: 10, failSave: false, writes: 0 }
}
const avatarUrl = id => id ? `/api/creators/avatars/${id}` : null
const detail = value => ({ id: value.id, name: value.name, description: value.description, homepageUrl: value.homepageUrl,
  categoryIds: value.categoryIds, levelId: value.levelId, baseStars: value.baseStars, avatarId: value.avatarId, avatarUrl: avatarUrl(value.avatarId) })
const card = value => ({ id: value.id, name: value.name, description: value.description, homepageUrl: value.homepageUrl,
  avatarUrl: avatarUrl(value.avatarId), categories: db.categories.filter(category => value.categoryIds.includes(category.id)),
  level: db.levels.find(level => level.id === value.levelId) ?? null, score: value.score, favoriteCount: value.favoriteCount, createdAt: value.createdAt })
function send(response, status, value) {
  response.statusCode = status
  if (value === undefined) { response.end(); return }
  response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value))
}
function fail(response, status, errorCode) {
  send(response, status, { id: 'creator-browser-fixture', errorCode, errorMsg: null, status, retryable: false, details: {}, timestamp: null })
}
const middleware = async (request, response, next) => {
  const url = new URL(request.url, 'http://fixture'), path = url.pathname
  if (path === '/api/observability/events') { send(response, 204); return }
  if (!path.startsWith('/api/creators') && !path.startsWith('/api/admin/creators')) { next(); return }
  try {
    const admin = path.startsWith('/api/admin/'), base = admin ? '/api/admin/creators' : '/api/creators'
    const parts = path.slice(base.length).split('/').filter(Boolean)
    const authenticated = request.headers.authorization === 'Bearer fixture-access-token'
    if ((admin || parts[0] === 'favorites' || parts[1] === 'favorite') && !authenticated) { fail(response, 401, 'AUTH_UNAUTHENTICATED'); return }
    if (request.method === 'GET') {
      if (parts[0] === 'categories') send(response, 200, db.categories)
      else if (parts[0] === 'levels') send(response, 200, db.levels)
      else if (parts[0] === 'settings') send(response, 200, { favoriteThreshold: db.threshold, avatarUploadsAvailable: true })
      else if (parts[0] === 'favorites') send(response, 200, { creatorIds: [...db.active] })
      else if (parts[0] === 'avatars') {
        const file = db.creators.some(value => value.avatarId === parts[1]) ? db.avatars.get(parts[1]) : null
        if (!file) { response.statusCode = 404; response.end() }
        else { response.setHeader('Content-Type', file.type); response.end(Buffer.from(await file.arrayBuffer())) }
      }
      else if (parts.length) {
        const value = db.creators.find(creator => creator.id === Number(parts[0]))
        if (value) send(response, 200, detail(value)); else fail(response, 404, 'CREATOR_NOT_FOUND')
      } else send(response, 200, db.creators.filter(value => !url.searchParams.get('categoryId') || value.categoryIds.includes(Number(url.searchParams.get('categoryId')))).map(card))
      return
    }
    db.writes++
    if (parts[1] === 'favorite') {
      const value = db.creators.find(creator => creator.id === Number(parts[0])), desired = request.method === 'PUT'
      if (db.active.has(value.id) !== desired) {
        value.favoriteCount += desired ? 1 : -1
        if (desired) { db.active.add(value.id); value.score = 8 } else db.active.delete(value.id)
      }
      send(response, 200, { creator: card(value), active: desired }); return
    }
    if (parts[0] === 'avatars') {
      if (request.method === 'DELETE') { db.avatars.delete(parts[1]); send(response, 204); return }
      const incoming = new Request(url, { method: request.method, headers: request.headers, body: Readable.toWeb(request), duplex: 'half' })
      const file = (await incoming.formData()).get('file')
      assert.ok(file?.size > 0, 'avatar multipart contains bytes')
      const id = crypto.randomUUID(); db.avatars.set(id, file)
      send(response, 201, { id, url: avatarUrl(id) }); return
    }
    if (request.method === 'DELETE') {
      if (parts[0] === 'categories') {
        const id = Number(parts[1])
        if (db.creators.some(value => value.categoryIds.length === 1 && value.categoryIds.includes(id))) { fail(response, 409, 'CREATOR_CATEGORY_IN_USE'); return }
        db.categories = db.categories.filter(value => value.id !== id)
      } else db.creators = db.creators.filter(value => value.id !== Number(parts[0]))
      send(response, 204); return
    }
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (parts[0] === 'settings') { db.threshold = payload.favoriteThreshold; send(response, 200, { favoriteThreshold: db.threshold, avatarUploadsAvailable: true }); return }
    if (parts[0] === 'categories' || parts[0] === 'levels') {
      const value = { id: db.nextId++, name: payload.name }; db[parts[0]].push(value); send(response, 201, value); return
    }
    if (db.failSave) { db.failSave = false; fail(response, 400, 'CREATOR_INVALID_REQUEST'); return }
    let value = db.creators.find(creator => creator.id === Number(parts[0]))
    if (value) Object.assign(value, payload)
    else { value = { ...payload, id: db.nextId++, score: payload.baseStars * 2, favoriteCount: 0, createdAt: '2026-10-16T01:00:00Z' }; db.creators.push(value) }
    send(response, request.method === 'POST' ? 201 : 200, detail(value))
  } catch (error) { console.error(error); fail(response, 500, 'INTERNAL_ERROR') }
}
async function tap(page, selector, touch) {
  await page.waitForValue(`!!document.querySelector(${JSON.stringify(selector)})`, Boolean)
  const point = await page.evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:'center',inline:'nearest'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`)
  await page.tap({ ...point, touch })
}
async function fill(page, values) {
  await page.evaluate(`(() => { for (const [id,value] of Object.entries(${JSON.stringify(values)})) { const e=document.querySelector('[data-testid="'+id+'"]');e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true})); } })()`)
}
async function geometry(page, profile, configuration = false) {
  const result = await page.evaluate(`(() => { const panels=[...document.querySelectorAll('.creator-config-grid > *')].map(e=>e.getBoundingClientRect()); return { overflow:document.documentElement.scrollWidth>innerWidth+1, profile:document.documentElement.dataset.uiProfile, stacked:panels.length===2?panels[1].top>=panels[0].bottom:false, tiny:matchMedia('(pointer:coarse)').matches?[...document.querySelectorAll('.creators-page button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.height<43}).map(e=>e.dataset.testid||e.textContent):[] }; })()`)
  assert.equal(result.overflow, false, 'horizontal overflow'); assert.equal(result.profile, profile)
  assert.deepEqual(result.tiny, [], '44px touch targets')
  if (configuration) assert.equal(result.stacked, await page.evaluate('innerWidth<768'), 'responsive management sections')
}

const { server, origin } = await startFixtureServer({ middleware })
const chrome = await launchChromeForCdp(findChrome())
const scenarios = ['showcase', 'classic'].flatMap(profile => [1440, 1024, 390, 360, 767, 768, 1199, 1200].map(width => ({
  name: `${profile}-${width}`, profile, width, height: 1000, touch: width < 1200, full: [1440, 1024, 390].includes(width),
})))
let failures = 0
try {
  const filters = process.argv.slice(2)
  const selected = scenarios.filter(value => !filters.length || filters.some(filter => value.name.includes(filter)))
  assert.ok(selected.length, 'scenario filter matches')
  for (const scenario of selected) {
    reset()
    const { targetId, sessionId } = await chrome.openPage(), page = new Page(chrome.client, sessionId)
    try {
      await page.enable(); await page.emulate(scenario)
      await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('wotb-ui-profile',${JSON.stringify(scenario.profile)});localStorage.setItem('wotb-lang','en');` }, sessionId)
      await page.goto(`${origin}/?view=creators&ws-auth=0`)
      await page.waitForValue('document.querySelectorAll(".creator-card").length', value => value === 2)
      assert.equal(await page.evaluate('!!document.querySelector("[data-testid=creator-edit-1]")'), false)
      assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-card-1] a").rel'), 'noopener noreferrer')
      await tap(page, '[data-testid=creator-favorite-1]', scenario.touch)
      assert.equal(db.writes, 0, 'anonymous favorite cannot write')
      await page.waitForValue('window.__wsAuth.loginCalls.length', value => value === 1)
      await geometry(page, scenario.profile)
      if (scenario.full) {
        await page.goto(`${origin}/?view=creators&ws-auth=1`)
        await page.waitForValue('document.querySelector("[data-testid=creator-favorite-1]")?.disabled', value => value === false)
        await tap(page, '[data-testid=creator-favorite-1]', scenario.touch)
        await page.waitForValue('document.querySelector("[data-testid=creator-favorite-1]")?.getAttribute("aria-pressed")', value => value === 'true')
        assert.equal(await page.evaluate('document.querySelector(".creator-card").dataset.testid'), 'creator-card-1', 'server score reorders cards')
        await tap(page, '[data-testid=creator-filter-2]', scenario.touch)
        await page.waitForValue('document.querySelectorAll(".creator-card").length', value => value === 1)
        assert.equal(await page.evaluate('document.querySelectorAll(".creator-tags li").length'), 2, 'all categories stay visible')
        assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-favorite-1]").getAttribute("aria-pressed")'), 'true')
        await tap(page, '[data-testid=creator-favorite-1]', scenario.touch)
        await page.waitForValue('document.querySelector("[data-testid=creator-favorite-1]")?.getAttribute("aria-pressed")', value => value === 'false')
        assert.equal(db.creators[0].favoriteCount, 199)
        await page.goto(`${origin}/?view=creators&ws-auth=1&ws-roles=tournament-admin`)
        await page.waitForValue('!!document.querySelector("[data-testid=creator-edit-1]")', Boolean)
        await geometry(page, scenario.profile)
        // Another administrator changes dictionaries after this page cached its initial settings.
        db.categories.push({ id: 99, name: 'Added by another administrator' })
        db.levels.push({ id: 99, name: 'New assessment level' })
        db.creators[0].categoryIds = [99]; db.creators[0].levelId = 99
        await tap(page, '[data-testid=creator-edit-1]', scenario.touch)
        await page.waitForValue('!!document.querySelector("[data-testid=creator-name]")', Boolean)
        assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-category-99]")?.checked'), true, 'editor refreshes stale category dictionaries')
        assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-level]")?.value'), '99', 'editor refreshes stale level dictionaries')
        await fill(page, { 'creator-name': 'Edited in real browser' })
        db.failSave = true
        await tap(page, '[data-testid=creator-save]', scenario.touch)
        await page.waitForValue('!!document.querySelector("[data-testid=creator-editor-dialog] [role=alert]")', Boolean)
        assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-name]").value'), 'Edited in real browser')
        await tap(page, '[data-testid=creator-save]', scenario.touch)
        await page.waitForValue('!document.querySelector("[data-testid=creator-editor-dialog]")', Boolean)
        assert.equal(db.creators[0].name, 'Edited in real browser')
        await tap(page, '[data-testid=creator-remove-2]', scenario.touch)
        await tap(page, '[data-testid=confirm-ok]', scenario.touch)
        await page.waitForValue('!document.querySelector("[data-testid=creator-card-2]")', Boolean)
        await page.goto(`${origin}/?view=creators-config&ws-auth=1&ws-roles=tournament-admin`)
        await page.waitForValue('!!document.querySelector("[data-testid=creator-form]")', Boolean)
        await geometry(page, scenario.profile, true)
        await fill(page, { 'creator-name': 'Created in real browser', 'creator-homepage': 'https://space.bilibili.com/1000010', 'creator-description': 'Browser form' })
        await tap(page, '[data-testid=creator-category-1]', scenario.touch)
        await page.evaluate(`(async () => { const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;canvas.getContext('2d').fillRect(0,0,32,32);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const transfer=new DataTransfer();transfer.items.add(new File([blob],'avatar.png',{type:'image/png'}));const input=document.querySelector('[data-testid=tournament-image-input]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true})); })()`)
        await page.waitForValue('document.querySelector("[data-testid=creator-save]")?.disabled', value => value === false)
        await page.waitForValue('document.querySelector("[data-testid=creator-avatar-preview]")?.naturalWidth', value => value === 32)
        assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-avatar-preview]").src.startsWith("blob:")'), true, 'unattached avatar keeps local preview')
        db.failSave = true
        await tap(page, '[data-testid=creator-save]', scenario.touch)
        await page.waitForValue('!!document.querySelector("[data-testid=creators-config-page] [role=alert]")', Boolean)
        assert.equal(db.avatars.size, 1, 'failed save preserves reservation')
        await tap(page, '[data-testid=creator-save]', scenario.touch)
        await page.waitForValue('document.querySelector("[data-testid=creator-name]")?.value', value => value === '')
        assert.equal(db.creators.length, 2)
        assert.ok(db.creators.at(-1).avatarId, 'retry attaches uploaded avatar')
        await fill(page, { 'creator-threshold': 100 })
        await tap(page, '.creator-config-sections section:last-child button', scenario.touch)
        await page.waitForValue('document.querySelector("[data-testid=creator-threshold]")?.disabled', value => value === false)
        assert.equal(db.threshold, 100)
        await fill(page, { 'creator-new-category': 'New browser category' })
        const initialCategoryCount = db.categories.length
        await tap(page, '.creator-config-sections section:first-child form button', scenario.touch)
        await page.waitForValue('document.querySelectorAll(".creator-config-sections section:first-child li").length', value => value === initialCategoryCount + 1)
        await tap(page, '.creator-config-sections section:first-child li:first-child button', scenario.touch)
        await tap(page, '[data-testid=confirm-ok]', scenario.touch)
        await page.waitForValue('!!document.querySelector("[data-testid=creators-config-page] [role=alert]")', Boolean)
        assert.equal(db.categories.length, initialCategoryCount + 1, 'blocked dictionary deletion changes no categories')
        if (process.env.CREATOR_SCREENSHOTS && scenario.width === 390) {
          await mkdir(process.env.CREATOR_SCREENSHOTS, { recursive: true })
          const shot = await chrome.client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId)
          await writeFile(join(process.env.CREATOR_SCREENSHOTS, `${scenario.name}.png`), Buffer.from(shot.data, 'base64'))
        }
        await page.evaluate('window.__wsAuth.tokenParsed.value={realm_access:{roles:[]}}')
        await page.waitForValue('!document.querySelector("[data-testid=creator-form]")', Boolean)
      }
      assert.deepEqual(page.consoleErrors, [], 'no uncaught browser errors')
      console.log(`PASS ${scenario.name}`)
    } catch (error) {
      failures++; console.error(`FAIL ${scenario.name}: ${error.message}\n${(await page.diagnose(() => ({ url: location.href, text: document.body.textContent.slice(0, 2500) }))).join('\n')}`)
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }
} finally { await chrome.close(); await server.close() }
if (failures) process.exitCode = 1
