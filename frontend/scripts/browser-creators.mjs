import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

// Production router, components, multipart transport and CSS; only external HTTP/auth are fixtures.
let db
function reset() {
  db = { categories: [{ id: 1, name: 'High damage replays' }, { id: 2, name: 'Live commentary' }], levels: [{ id: 1, name: 'Professional' }], avatars: new Map(), uploadAvailable: true,
    creators: [{ id: 1, bilibiliUid: '1000001', name: 'A creator with a long name for narrow screens', description: 'Recommended replays and commentary.', categoryIds: [1, 2], levelId: null, stars: 3, avatarId: null, createdAt: '2026-10-16T00:00:00Z' },
      { id: 2, bilibiliUid: '1000002', name: 'Assessed creator', description: null, categoryIds: [1], levelId: 1, stars: 4, avatarId: null, createdAt: '2026-10-15T00:00:00Z' }], nextId: 10, failSave: false, writes: 0 }
}
const avatarUrl = id => id ? `/api/creators/avatars/${id}` : null
const detail = value => ({ id: value.id, bilibiliUid: value.bilibiliUid, name: value.name, description: value.description, categoryIds: value.categoryIds, levelId: value.levelId, stars: value.stars, avatarUrl: avatarUrl(value.avatarId) })
const card = value => ({ id: value.id, bilibiliUid: value.bilibiliUid, name: value.name, description: value.description, homepageUrl: `https://space.bilibili.com/${value.bilibiliUid}`, avatarUrl: avatarUrl(value.avatarId), categories: db.categories.filter(category => value.categoryIds.includes(category.id)), level: db.levels.find(level => level.id === value.levelId) ?? null, score: value.stars * 2, createdAt: value.createdAt })
function send(response, status, value) { response.statusCode = status; if (value === undefined) { response.end(); return }; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)) }
function fail(response, status, errorCode) { send(response, status, { id: 'creator-browser-fixture', errorCode, errorMsg: null, status, retryable: false, details: {}, timestamp: null }) }
const middleware = async (request, response, next) => {
  const url = new URL(request.url, 'http://fixture'), path = url.pathname
  if (path === '/api/observability/events') { send(response, 204); return }
  if (!path.startsWith('/api/creators') && !path.startsWith('/api/admin/creators')) { next(); return }
  try {
    const admin = path.startsWith('/api/admin/'), parts = path.slice((admin ? '/api/admin/creators' : '/api/creators').length).split('/').filter(Boolean)
    if (admin && request.headers.authorization !== 'Bearer fixture-access-token') { fail(response, 403, 'AUTH_FORBIDDEN'); return }
    if (request.method === 'GET') {
      if (!admin && parts[0] === 'categories') send(response, 200, db.categories)
      else if (admin && parts[0] === 'metadata') send(response, 200, { categories: db.categories, levels: db.levels, avatarUploadsAvailable: db.uploadAvailable })
      else if (!admin && parts[0] === 'avatars') {
        const file = db.creators.some(value => value.avatarId === parts[1]) ? db.avatars.get(parts[1]) : null
        if (!file) { response.statusCode = 404; response.end() } else { response.setHeader('Content-Type', file.type); response.end(Buffer.from(await file.arrayBuffer())) }
      } else if (admin && /^\d+$/.test(parts[0] ?? '')) { const value = db.creators.find(item => item.id === Number(parts[0])); if (value) send(response, 200, detail(value)); else fail(response, 404, 'CREATOR_NOT_FOUND') }
      else if (!admin && !parts.length) send(response, 200, db.creators.filter(value => !url.searchParams.get('categoryId') || value.categoryIds.includes(Number(url.searchParams.get('categoryId')))).sort((a, b) => b.stars - a.stars || b.createdAt.localeCompare(a.createdAt) || b.id - a.id).map(card))
      else fail(response, 404, 'RESOURCE_NOT_FOUND')
      return
    }
    if (!admin) { fail(response, 404, 'RESOURCE_NOT_FOUND'); return }
    db.writes++
    if (request.method === 'DELETE') {
      if (parts[0] === 'categories') { const id = Number(parts[1]); if (db.creators.some(value => value.categoryIds.length === 1 && value.categoryIds.includes(id))) { fail(response, 409, 'CREATOR_CATEGORY_IN_USE'); return }; db.categories = db.categories.filter(value => value.id !== id) }
      else if (parts[0] === 'levels') { const id = Number(parts[1]); if (db.creators.some(value => value.levelId === id)) { fail(response, 409, 'CREATOR_LEVEL_IN_USE'); return }; db.levels = db.levels.filter(value => value.id !== id) }
      else db.creators = db.creators.filter(value => value.id !== Number(parts[0]))
      send(response, 204); return
    }
    const incoming = new Request(url, { method: request.method, headers: request.headers, body: Readable.toWeb(request), duplex: 'half' })
    if (parts[0] === 'categories' || parts[0] === 'levels') { const payload = await incoming.json(), value = { id: db.nextId++, name: payload.name }; db[parts[0]].push(value); send(response, 201, value); return }
    assert.match(String(request.headers['content-type']), /^multipart\/form-data; boundary=/)
    const form = await incoming.formData(), payloadPart = form.get('payload')
    assert.equal(payloadPart.type, 'application/json')
    const payload = JSON.parse(await payloadPart.text()), avatar = form.get('avatar')
    assert.equal(payload.avatarAction === 'REPLACE', !!avatar, 'action matches the one optional avatar part')
    const bilibiliUid = payload.bilibiliUid.trim().replace(/^0+/, ''), id = parts.length ? Number(parts[0]) : null
    if (db.creators.some(value => value.bilibiliUid === bilibiliUid && value.id !== id)) { fail(response, 409, 'CREATOR_UID_ALREADY_EXISTS'); return }
    if (db.failSave) { db.failSave = false; fail(response, 400, 'CREATOR_INVALID_REQUEST'); return }
    let value = db.creators.find(item => item.id === id)
    if (!value) { value = { id: db.nextId++, avatarId: null, createdAt: '2026-10-17T00:00:00Z' }; db.creators.push(value) }
    if (payload.avatarAction === 'REPLACE') { assert.ok(db.uploadAvailable); const avatarId = crypto.randomUUID(); db.avatars.set(avatarId, avatar); value.avatarId = avatarId }
    else if (payload.avatarAction === 'REMOVE') value.avatarId = null
    Object.assign(value, { bilibiliUid, name: payload.name, description: payload.description, categoryIds: payload.categoryIds, levelId: payload.levelId, stars: payload.stars })
    send(response, id ? 200 : 201, detail(value))
  } catch (error) { console.error(error); fail(response, 500, 'INTERNAL_ERROR') }
}
async function tap(page, selector, touch) { await page.waitForValue(`!!document.querySelector(${JSON.stringify(selector)})`, Boolean); const point = await page.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`); await page.tap({ ...point, touch }) }
async function fill(page, values) { await page.evaluate(`(() => {for(const[id,value]of Object.entries(${JSON.stringify(values)})){const e=document.querySelector('[data-testid="'+id+'"]');e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}})()`) }
async function chooseAvatar(page) { await page.evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;canvas.getContext('2d').fillRect(0,0,32,32);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const transfer=new DataTransfer();transfer.items.add(new File([blob],'avatar.png',{type:'image/png'}));const input=document.querySelector('[data-testid=tournament-image-input]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`) }
async function geometry(page, profile, configuration = false) {
  const value = await page.evaluate(`(()=>{const p=[...document.querySelectorAll('.creator-config-grid > *')].map(e=>e.getBoundingClientRect());return{overflow:document.documentElement.scrollWidth>innerWidth+1,profile:document.documentElement.dataset.uiProfile,stacked:p.length===2?p[1].top>=p[0].bottom:false,tiny:matchMedia('(pointer:coarse)').matches?[...document.querySelectorAll('.creators-page button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.height<43}).map(e=>e.dataset.testid||e.textContent):[]}})()`)
  assert.equal(value.overflow, false); assert.equal(value.profile, profile); assert.deepEqual(value.tiny, [])
  if (configuration) assert.equal(value.stacked, await page.evaluate('innerWidth<768'))
}
const { server, origin } = await startFixtureServer({ middleware }), chrome = await launchChromeForCdp(findChrome())
const scenarios = ['showcase', 'classic'].flatMap(profile => [1440, 1024, 390, 360, 767, 768, 1199, 1200].map(width => ({ name: `${profile}-${width}`, profile, width, height: 1000, touch: width < 1200, full: [1440, 1024, 390].includes(width), locale: width === 1024 ? 'zh' : width === 390 ? 'ru' : 'en' })))
let failures = 0
try {
  const filters = process.argv.slice(2), selected = scenarios.filter(value => !filters.length || filters.some(filter => value.name.includes(filter)))
  assert.ok(selected.length)
  for (const scenario of selected) {
    reset(); const { targetId, sessionId } = await chrome.openPage(), page = new Page(chrome.client, sessionId)
    try {
      await page.enable(); await page.emulate(scenario)
      await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('wotb-ui-profile',${JSON.stringify(scenario.profile)});localStorage.setItem('wotb-lang',${JSON.stringify(scenario.locale)});` }, sessionId)
      await page.goto(`${origin}/?view=more&ws-auth=0`)
      const primary = scenario.width < 768 ? '[data-testid=tab-creators]' : '[data-testid=nav-creators]'
      await tap(page, primary, scenario.touch); await page.waitForValue('document.querySelectorAll(".creator-card").length', value => value === 2)
      assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(primary)}).getAttribute('aria-current')`), 'page')
      assert.equal(await page.evaluate('document.querySelectorAll(".creator-card button").length'), 0, 'anonymous cards have no management or user-action buttons')
      assert.equal(await page.evaluate('window.__wsAuth.loginCalls.length'), 0); assert.equal(db.writes, 0)
      assert.equal(await page.evaluate('document.querySelector(".creator-card a").rel'), 'noopener noreferrer')
      await tap(page, '[data-testid=creator-filter-2]', scenario.touch); await page.waitForValue('document.querySelectorAll(".creator-card").length', value => value === 1)
      assert.equal(await page.evaluate('document.querySelectorAll(".creator-tags li").length'), 2)
      await geometry(page, scenario.profile)
      if (scenario.full) {
        await page.goto(`${origin}/?view=creators&ws-auth=1&ws-roles=tournament-admin`)
        await page.waitForValue('document.querySelector("[data-testid=creator-edit-1]")?.disabled', value => value === false)
        await geometry(page, scenario.profile)
        db.categories.push({ id: 99, name: 'New category from another administrator' }); db.levels.push({ id: 99, name: 'New skill level' }); db.creators[0].categoryIds = [99]; db.creators[0].levelId = 99
        await tap(page, '[data-testid=creator-edit-1]', scenario.touch); await page.waitForValue('!!document.querySelector("[data-testid=creator-name]")', Boolean)
        assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-category-99]")?.checked'), true)
        await fill(page, { 'creator-name': 'Edited in real browser' }); db.failSave = true
        await tap(page, '[data-testid=creator-save]', scenario.touch); await page.waitForValue('!!document.querySelector("[data-testid=creator-editor-dialog] [role=alert]")', Boolean)
        assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-name]").value'), 'Edited in real browser')
        await tap(page, '[data-testid=creator-save]', scenario.touch); await page.waitForValue('!document.querySelector("[data-testid=creator-editor-dialog]")', Boolean)
        await tap(page, '[data-testid=creator-remove-2]', scenario.touch); await tap(page, '[data-testid=confirm-ok]', scenario.touch); await page.waitForValue('!document.querySelector("[data-testid=creator-card-2]")', Boolean)
        await page.goto(`${origin}/?view=creators-config&ws-auth=1&ws-roles=tournament-admin`); await page.waitForValue('!!document.querySelector("[data-testid=creator-form]")', Boolean); await geometry(page, scenario.profile, true)
        await fill(page, { 'creator-name': 'Created in real browser', 'creator-uid': '0001000010', 'creator-description': 'Browser form' }); await tap(page, '[data-testid=creator-category-1]', scenario.touch)
        const writes = db.writes; await chooseAvatar(page); await page.waitForValue('document.querySelector("[data-testid=creator-avatar-preview]")?.naturalWidth', value => value === 32)
        assert.equal(db.writes, writes, 'choosing a file makes no HTTP write'); assert.equal(db.avatars.size, 0)
        db.failSave = true; await tap(page, '[data-testid=creator-save]', scenario.touch); await page.waitForValue('!!document.querySelector("[data-testid=creators-config-page] [role=alert]")', Boolean)
        assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-avatar-preview]").src.startsWith("blob:")'), true)
        await tap(page, '[data-testid=creator-save]', scenario.touch); await page.waitForValue('document.querySelector("[data-testid=creator-name]")?.value', value => value === '')
        const created = db.creators.find(value => value.bilibiliUid === '1000010'); assert.ok(created?.avatarId); assert.equal(created.stars, 3); assert.equal(db.avatars.size, 1)
        await fill(page, { 'creator-name': 'Duplicate UID', 'creator-uid': '1000010' }); await tap(page, '[data-testid=creator-category-1]', scenario.touch)
        await tap(page, '[data-testid=creator-save]', scenario.touch); await page.waitForValue('!!document.querySelector("[data-testid=creators-config-page] [role=alert]")', Boolean); assert.equal(db.creators.length, 2, 'duplicate normalized UID cannot create another record')
        await page.goto(`${origin}/?view=creators&ws-auth=1&ws-roles=tournament-admin`); await page.waitForValue(`document.querySelector('[data-testid=creator-edit-${created.id}]')?.disabled`, value => value === false)
        await tap(page, `[data-testid=creator-edit-${created.id}]`, scenario.touch); await page.waitForValue('document.querySelector("[data-testid=creator-avatar-preview]")?.naturalWidth', value => value === 32)
        await tap(page, '[data-testid=creator-avatar-clear]', scenario.touch); await tap(page, '[data-testid=creator-save]', scenario.touch); await page.waitForValue('!document.querySelector("[data-testid=creator-editor-dialog]")', Boolean)
        assert.equal(created.avatarId, null, 'REMOVE detaches rather than deleting a potentially referenced object')
        db.uploadAvailable = false; await tap(page, `[data-testid=creator-edit-${created.id}]`, scenario.touch); await page.waitForValue('!!document.querySelector("[data-testid=creator-form]")', Boolean)
        assert.equal(await page.evaluate('document.querySelector("[data-testid=tournament-image-input]").disabled'), true)
        await fill(page, { 'creator-name': 'Saved without avatar storage' }); await tap(page, '[data-testid=creator-save]', scenario.touch); await page.waitForValue('!document.querySelector("[data-testid=creator-editor-dialog]")', Boolean)
        await page.goto(`${origin}/?view=creators-config&ws-auth=1&ws-roles=tournament-admin`); await page.waitForValue('!!document.querySelector("[data-testid=creator-form]")', Boolean)
        await fill(page, { 'creator-new-category': 'New browser category' }); const categoryCount = db.categories.length
        await tap(page, '.creator-config-sections section:first-child form button', scenario.touch); await page.waitForValue('document.querySelectorAll(".creator-config-sections section:first-child li").length', value => value === categoryCount + 1)
        await tap(page, '.creator-config-sections section:first-child li:first-child button', scenario.touch); await tap(page, '[data-testid=confirm-ok]', scenario.touch); await page.waitForValue('!!document.querySelector("[data-testid=creators-config-page] [role=alert]")', Boolean)
        assert.equal(db.categories.length, categoryCount + 1)
        if (process.env.CREATOR_SCREENSHOTS && scenario.width === 390) { await mkdir(process.env.CREATOR_SCREENSHOTS, { recursive: true }); const shot = await chrome.client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId); await writeFile(join(process.env.CREATOR_SCREENSHOTS, `${scenario.name}.png`), Buffer.from(shot.data, 'base64')) }
        await page.evaluate('window.__wsAuth.tokenParsed.value={realm_access:{roles:[]}}'); await page.waitForValue('!document.querySelector("[data-testid=creator-form]")', Boolean)
      }
      assert.deepEqual(page.consoleErrors, []); console.log(`PASS ${scenario.name}`)
    } catch (error) { failures++; console.error(`FAIL ${scenario.name}: ${error.message}\n${(await page.diagnose(() => ({ url: location.href, text: document.body.textContent.slice(0, 2500) }))).join('\n')}`) }
    finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }
} finally { await chrome.close(); await server.close() }
if (failures) process.exitCode = 1
