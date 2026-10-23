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
  db = { categories: [{ id: 1, name: 'High damage replays' }, { id: 2, name: 'Live commentary' }, { id: 3, name: 'Empty category' }, { id: 4, name: 'LongCategoryName'.repeat(6) }], levels: [{ id: 1, name: 'Professional' }], avatars: new Map(), uploadAvailable: true, apiAvailable: true, recommendationsAvailable: true, creatorReads: 0, publicListReads: 0, metadataReads: 0, recommendationReads: 0,
    creators: [{ id: 1, version: 0, bilibiliUid: '1000001', name: 'A creator with a long name for narrow screens', description: 'Recommended replays and commentary.', categoryIds: [1, 2], levelId: null, stars: 3, avatarId: null, createdAt: '2026-10-16T00:00:00Z' },
      { id: 2, version: 0, bilibiliUid: '1000002', name: 'Assessed creator', description: null, categoryIds: [1], levelId: 1, stars: 4, avatarId: null, createdAt: '2026-10-15T00:00:00Z' }], nextId: 10, failSave: false, writes: 0 }
  db.categories.forEach(value => { value.type = 'UP' }); db.creators.forEach(value => { value.type = 'UP' })
}
const avatarUrl = id => id ? `/api/creators/avatars/${id}` : null
const recommendationDetail = value => ({ id: value.id, version: value.version, type: value.type, externalId: value.bilibiliUid, name: value.name, description: value.description, categoryIds: value.categoryIds, levelId: value.levelId, stars: value.stars, imageUrl: avatarUrl(value.avatarId) })
const recommendationCard = value => ({ id: value.id, version: value.version, type: value.type, externalId: value.bilibiliUid, name: value.name, description: value.description, targetUrl: value.type === 'VIDEO' ? `https://www.bilibili.com/video/${value.bilibiliUid}` : `https://space.bilibili.com/${value.bilibiliUid}`, imageUrl: avatarUrl(value.avatarId), categories: db.categories.filter(category => value.categoryIds.includes(category.id)), level: db.levels.find(level => level.id === value.levelId) ?? null, score: value.stars * 2, createdAt: value.createdAt })
function send(response, status, value) { response.statusCode = status; if (value === undefined) { response.end(); return }; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)) }
function fail(response, status, errorCode) { send(response, status, { id: 'creator-browser-fixture', errorCode, errorMsg: null, status, retryable: false, details: {}, timestamp: null }) }
const middleware = async (request, response, next) => {
  const url = new URL(request.url, 'http://fixture'), path = url.pathname
  if (path === '/api/health') { send(response, 200, { status: 'ok', tanks: 0, ...(db.apiAvailable ? { capabilities: db.recommendationsAvailable ? ['recommendations-v1'] : ['creators-v1', 'creators-content-visibility-v1'] } : {}) }); return }
  if (path === '/api/observability/events') { send(response, 204); return }
  if (path.startsWith('/api/creators/avatars/')) {
    const id = path.slice('/api/creators/avatars/'.length)
    const file = db.creators.some(value => value.avatarId === id) ? db.avatars.get(id) : null
    if (!file) { response.statusCode = 404; response.end() } else { response.setHeader('Content-Type', file.type); response.end(Buffer.from(await file.arrayBuffer())) }
    return
  }
  if (!path.startsWith('/api/recommendations') && !path.startsWith('/api/admin/recommendations')) { next(); return }
  db.recommendationReads++
  if (!db.recommendationsAvailable) { fail(response, 404, 'RESOURCE_NOT_FOUND'); return }
  try {
    const admin = path.startsWith('/api/admin/'), base = `${admin ? '/api/admin' : '/api'}/recommendations`
    const parts = path.slice(base.length).split('/').filter(Boolean), type = url.searchParams.get('type')
    if (admin && request.headers.authorization !== 'Bearer fixture-access-token') { fail(response, 403, 'AUTH_FORBIDDEN'); return }
    if (request.method === 'GET') {
      db.creatorReads++
      if (!admin && parts[0] === 'categories') {
        const categories = db.categories.filter(category => db.creators.some(value => value.type === category.type && value.categoryIds.includes(category.id)))
        send(response, 200, categories)
      } else if (admin && parts[0] === 'metadata') {
        db.metadataReads++
        if (!['UP', 'VIDEO'].includes(type)) { fail(response, 400, 'CREATOR_INVALID_REQUEST'); return }
        const categories = db.categories.filter(value => value.type === type)
        send(response, 200, { type, categories, levels: type === 'UP' ? db.levels : [], imageUploadsAvailable: db.uploadAvailable })
      } else if (admin && /^\d+$/.test(parts[0] ?? '')) { const value = db.creators.find(item => item.id === Number(parts[0]) && item.type === type); if (value) send(response, 200, recommendationDetail(value)); else fail(response, 404, 'CREATOR_NOT_FOUND') }
      else if (!admin && !parts.length) {
        if (!['UP', 'VIDEO'].includes(type)) { fail(response, 400, 'CREATOR_INVALID_REQUEST'); return }
        db.publicListReads++; send(response, 200, db.creators.filter(value => value.type === type && (!url.searchParams.get('categoryId') || value.categoryIds.includes(Number(url.searchParams.get('categoryId'))))).sort((a, b) => b.stars - a.stars || b.createdAt.localeCompare(a.createdAt) || b.id - a.id).map(recommendationCard))
      }
      else fail(response, 404, 'RESOURCE_NOT_FOUND')
      return
    }
    if (!admin) { fail(response, 404, 'RESOURCE_NOT_FOUND'); return }
    db.writes++
    if (request.method === 'DELETE') {
      if (parts[0] === 'categories') { const id = Number(parts[1]); if (!db.categories.some(value => value.id === id && value.type === type)) { fail(response, 404, 'CREATOR_NOT_FOUND'); return }; if (db.creators.some(value => value.categoryIds.length === 1 && value.categoryIds.includes(id))) { fail(response, 409, 'CREATOR_CATEGORY_IN_USE'); return }; db.categories = db.categories.filter(value => value.id !== id) }
      else if (parts[0] === 'levels') { const id = Number(parts[1]); if (db.creators.some(value => value.levelId === id)) { fail(response, 409, 'CREATOR_LEVEL_IN_USE'); return }; db.levels = db.levels.filter(value => value.id !== id) }
      else { const current = db.creators.find(value => value.id === Number(parts[0]) && value.type === type); if (!current) { fail(response, 404, 'CREATOR_NOT_FOUND'); return }; if (!url.searchParams.has('expectedVersion') || current.version !== Number(url.searchParams.get('expectedVersion'))) { fail(response, 409, 'CREATOR_CONFIG_CONFLICT'); return }; db.creators = db.creators.filter(value => value.id !== current.id) }
      send(response, 204); return
    }
    const incoming = new Request(url, { method: request.method, headers: request.headers, body: Readable.toWeb(request), duplex: 'half' })
    if (parts[0] === 'categories' || parts[0] === 'levels') { const payload = await incoming.json(), value = { id: db.nextId++, name: payload.name, ...(parts[0] === 'categories' ? { type: payload.type } : {}) }; db[parts[0]].push(value); send(response, 201, value); return }
    assert.match(String(request.headers['content-type']), /^multipart\/form-data; boundary=/)
    const form = await incoming.formData(), payloadPart = form.get('payload')
    assert.equal(payloadPart.type, 'application/json')
    const input = JSON.parse(await payloadPart.text()), recordType = input.type
    const payload = input, avatar = form.get('image')
    assert.equal(payload.imageAction === 'REPLACE', !!avatar, 'action matches the one optional avatar part')
    if (!['UP', 'VIDEO'].includes(recordType) || (recordType === 'VIDEO' && payload.levelId !== null)
      || payload.categoryIds.some(id => !db.categories.some(value => value.id === id && value.type === recordType))) { fail(response, 400, 'CREATOR_INVALID_REQUEST'); return }
    const bilibiliUid = recordType === 'UP' ? payload.externalId.trim().replace(/^0+/, '') : payload.externalId.trim(), id = parts.length ? Number(parts[0]) : null
    if (db.creators.some(value => value.type === recordType && value.bilibiliUid === bilibiliUid && value.id !== id)) { fail(response, 409, recordType === 'UP' ? 'CREATOR_UID_ALREADY_EXISTS' : 'RECOMMENDATION_ID_ALREADY_EXISTS'); return }
    const current = db.creators.find(item => item.id === id)
    if (current && current.type !== recordType) { fail(response, 404, 'CREATOR_NOT_FOUND'); return }
    if ((id === null && payload.expectedVersion !== null) || (id !== null && (!current || current.version !== payload.expectedVersion))) { fail(response, 409, 'CREATOR_CONFIG_CONFLICT'); return }
    if (db.failSave) { db.failSave = false; fail(response, 400, 'CREATOR_INVALID_REQUEST'); return }
    let value = db.creators.find(item => item.id === id)
    if (!value) { value = { id: db.nextId++, type: recordType, version: 0, avatarId: null, createdAt: '2026-10-17T00:00:00Z' }; db.creators.push(value) }
    if (payload.imageAction === 'REPLACE') { assert.ok(db.uploadAvailable); const avatarId = crypto.randomUUID(); db.avatars.set(avatarId, avatar); value.avatarId = avatarId }
    else if (payload.imageAction === 'REMOVE') value.avatarId = null
    Object.assign(value, { bilibiliUid, name: payload.name, description: payload.description, categoryIds: payload.categoryIds, levelId: payload.levelId, stars: payload.stars })
    if (id !== null) value.version++
    send(response, id ? 200 : 201, recommendationDetail(value))
  } catch (error) { console.error(error); fail(response, 500, 'INTERNAL_ERROR') }
}
async function tap(page, selector, touch) {
  const point = await page.waitForValue(`(async () => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return null;
    element.scrollIntoView({block:'center',inline:'nearest'});
    const before = element.getBoundingClientRect();
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    const after = element.getBoundingClientRect(), x = after.x + after.width / 2, y = after.y + after.height / 2;
    if (!after.width || !after.height || Math.abs(before.x-after.x) > 0.5 || Math.abs(before.y-after.y) > 0.5
      || !element.contains(document.elementFromPoint(x, y))) return null;
    return {x, y};
  })()`, value => value !== null, { label: `stable enabled hit target ${selector}` })
  await page.tap({ ...point, touch })
}
async function fill(page, values) { await page.evaluate(`(() => {for(const[id,value]of Object.entries(${JSON.stringify(values)})){const e=document.querySelector('[data-testid="'+id+'"]');e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}})()`) }
async function chooseAvatar(page) { await page.evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;canvas.getContext('2d').fillRect(0,0,32,32);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const transfer=new DataTransfer();transfer.items.add(new File([blob],'avatar.png',{type:'image/png'}));const input=document.querySelector('[data-testid=tournament-image-input]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`) }
async function geometry(page, profile, configuration = false) {
  const value = await page.evaluate(`(()=>{const p=[...document.querySelectorAll('.creator-config-grid > *')].map(e=>e.getBoundingClientRect());return{overflow:document.documentElement.scrollWidth>innerWidth+1,profile:document.documentElement.dataset.uiProfile,stacked:p.length===2?p[1].top>=p[0].bottom:false,tiny:matchMedia('(pointer:coarse)').matches?[...document.querySelectorAll('.creators-page button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.height<43}).map(e=>e.dataset.testid||e.textContent):[]}})()`)
  assert.equal(value.overflow, false); assert.equal(value.profile, profile); assert.deepEqual(value.tiny, [])
  if (configuration) assert.equal(value.stacked, await page.evaluate('innerWidth<768'))
}
async function tabGeometry(page, expectedCount) {
  const value = await page.evaluate(`(() => {
    const bar = document.querySelector('[data-testid=app-tab-bar]'), bounds = bar.getBoundingClientRect();
    const tabs = [...bar.querySelectorAll('.tab')].map(el => { const r = el.getBoundingClientRect(); return {left:r.left,right:r.right,width:r.width,height:r.height,active:el.getAttribute('aria-current') === 'page'} });
    return {tabs,left:bounds.left,right:bounds.right,overflow:document.documentElement.scrollWidth > innerWidth + 1};
  })()`)
  assert.equal(value.tabs.length, expectedCount)
  assert.equal(value.overflow, false, 'tab overflow stays inside the navigation scroller')
  value.tabs.forEach((tab, index) => {
    assert.ok(tab.width >= 44 && tab.height >= 44, 'tabs retain 44px touch targets')
    if (index) assert.ok(tab.left >= value.tabs[index - 1].right - 0.5, 'adjacent tab targets never overlap')
    if (tab.active) assert.ok(tab.left >= value.left - 0.5 && tab.right <= value.right + 0.5, 'active tab is visible after navigation')
  })
}
async function cardPresentation(page, origin, scenario, chrome, sessionId) {
  const type = scenario.cardType
  db.categories = ['混剪', '单车解析', '娱乐', '直播回放', '高手/大神类', '联赛类'].map((name, index) => ({ id: index + 1, name, type }))
  const seed = db.creators[0]
  db.creators = [
    { ...seed, id: 1, name: 'Aetheris_Caeloru', description: '高质量 AE 创作者', categoryIds: [1], stars: 5 },
    { ...seed, id: 2, name: 'ChineseMaoMao', description: '坦克世界闪击战实况与解说，分享比赛回放、单车解析和精彩瞬间。', categoryIds: [1, 2, 3, 4, 5, 6], stars: 5 },
    { ...seed, id: 3, name: '【WOTB】所有游戏表达好感的方式都是转圈？', description: null, categoryIds: [3], stars: 4 },
    { ...seed, id: 4, name: '坦闪人自己的 BMPT——AC-10 阿特拉斯', description: '侧面够硬，能哒哒哒，你就是 BMPT。\n装甲给了他相当高的下限，但上限受限于 DPM。各方面数据都有，但不够极致，感觉还是挺适合新手上手游玩的。\n视频仅代表个人观点，欢迎友善讨论。', categoryIds: [2], stars: 3, levelId: type === 'UP' ? 1 : null },
  ].map((value, index) => ({ ...value, type, bilibiliUid: type === 'UP' ? `${1000 + index}` : `BV1xx411c7m${index}` }))
  const view = type === 'UP' ? 'creators' : 'recommended-videos'
  for (const admin of [false, true]) {
    await page.goto(`${origin}/?view=${view}&ws-auth=${admin ? '1&ws-roles=content-admin' : '0'}`)
    await page.waitForValue('document.querySelectorAll(".creator-card").length', count => count === 4)
    await geometry(page, scenario.profile)
    const cards = await page.evaluate(`Array.from(document.querySelectorAll('.creator-card'), card => {
      const rect = card.getBoundingClientRect();
      const top = selector => card.querySelector(selector)?.getBoundingClientRect().top ?? null;
      const rating = card.querySelector('.creator-rating').getBoundingClientRect(), visit = card.querySelector('.creator-visit').getBoundingClientRect();
      return {top:rect.top,bottom:rect.bottom,heading:top('.creator-card-heading'),tags:top('.creator-tags'),
        rating:top('.creator-rating'),visit:top('.creator-visit'),admin:top('.creator-admin-actions'),
        ratingCenter:rating.top+rating.height/2,visitCenter:visit.top+visit.height/2,ratingRight:rating.right,visitLeft:visit.left,visitHeight:visit.height,
        overflow:card.scrollWidth>card.clientWidth+1};
    })`)
    for (const card of cards) {
      assert.equal(card.overflow, false, 'long titles and categories remain inside the card')
      assert.equal(card.admin !== null, admin)
      if (scenario.width >= 1200 && scenario.locale === 'zh') {
        assert.ok(Math.abs(card.ratingCenter - card.visitCenter) < 1, 'desktop score and external link share a row')
        assert.ok(card.visitLeft >= card.ratingRight, 'desktop score is left of the external link')
      }
      if (scenario.touch) assert.ok(card.visitHeight >= 44, 'external links retain touch target height')
      for (const peer of cards.filter(value => Math.abs(value.top - card.top) < 1)) {
        for (const key of ['bottom', 'heading', 'tags', 'rating', 'visit', ...(admin ? ['admin'] : [])]) {
          assert.ok(Math.abs(peer[key] - card[key]) < 1, `${type} ${scenario.width}: same-row ${key} aligned`)
        }
      }
    }
    assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-card-4] .creator-description").textContent'), db.creators[3].description, 'full descriptions remain readable')
    if (process.env.CREATOR_SCREENSHOTS) {
      await mkdir(process.env.CREATOR_SCREENSHOTS, { recursive: true })
      const shot = await chrome.client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId)
      await writeFile(join(process.env.CREATOR_SCREENSHOTS, `${scenario.name}-${admin ? 'admin' : 'public'}.png`), Buffer.from(shot.data, 'base64'))
    }
  }
  // Missing images return to the compact icon header without leaving a cover-sized hole.
  db.creators[0].avatarId = 'missing-image'
  await tap(page, '[data-testid=creator-refresh]', scenario.touch)
  await page.waitForValue('performance.getEntriesByType("resource").some(entry => entry.name.endsWith("/api/creators/avatars/missing-image"))', Boolean)
  await page.waitForValue('!!document.querySelector("[data-testid=creator-card-1] .creator-avatar-fallback") && !document.querySelector("[data-testid=creator-card-1] img")', Boolean)
  const compactCard = await page.evaluate(`(() => {
    const card=document.querySelector('[data-testid=creator-card-1]');
    return {heading:card.querySelector('.creator-card-heading').getBoundingClientRect().height,
      height:card.getBoundingClientRect().height, copy:card.querySelector('.creator-card-copy').getBoundingClientRect().height};
  })()`)
  if (scenario.width === 1920) {
    db.avatars.set('valid-image', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }))
    db.creators[0].avatarId = 'valid-image'
    await tap(page, '[data-testid=creator-refresh]', scenario.touch)
    await page.waitForValue('(() => {const img=document.querySelector("[data-testid=creator-card-1] img");return !!img?.complete && img.naturalWidth>0})()', Boolean)
    const mixed = await page.evaluate(`(() => {
      const card = document.querySelector('[data-testid=creator-card-1]'), heading = card.querySelector('.creator-card-heading');
      const titles = [...document.querySelectorAll('.creator-card h2')].map(el=>el.getBoundingClientRect().top);
      return {headingHeight:heading.getBoundingClientRect().height, height:card.getBoundingClientRect().height,
        copy:card.querySelector('.creator-card-copy').getBoundingClientRect().height,
        coverInMedia:!!card.querySelector('.creator-card-media > .recommendation-cover'), titles};
    })()`)
    assert.equal(mixed.headingHeight, compactCard.heading, 'loading a cover never expands the shared title track')
    assert.equal(mixed.height, compactCard.height, 'loading a cover never reserves extra space in peer cards')
    assert.equal(mixed.copy, compactCard.copy, 'loading a cover never expands the shared copy track')
    assert.equal(mixed.coverInMedia, type === 'VIDEO')
    assert.ok(mixed.titles.every(top => Math.abs(top - mixed.titles[0]) < 1), 'mixed covered/coverless cards retain aligned title text')
    await geometry(page, scenario.profile)
    await chrome.client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId)
    assert.ok(await page.evaluate('getComputedStyle(document.querySelector(".creator-card")).transitionDuration.split(",").every(value => parseFloat(value) === 0)'), 'reduced motion disables card transitions')
  }
  assert.equal(db.writes, 0, 'presentation checks never mutate the directory')
}
async function videoLifecycle(page, origin, scenario) {
  const touch = scenario.touch, primary = scenario.width < 768 ? '[data-testid=tab-creators]' : '[data-testid=nav-creators]'
  db.categories.push({ id: 51, type: 'VIDEO', name: 'Video tutorials' }, { id: 52, type: 'VIDEO', name: 'Video highlights' }, { id: 53, type: 'VIDEO', name: 'Empty video category' })
  db.creators = [
    { ...db.creators[0], id: 101, type: 'VIDEO', bilibiliUid: 'BV1xx411c7mD', name: 'Tutorial video', categoryIds: [51], levelId: null },
    { ...db.creators[1], id: 102, type: 'VIDEO', bilibiliUid: 'BV1XX411C7MD', name: 'Highlight video', categoryIds: [52], levelId: null },
  ]
  await page.goto(`${origin}/?view=recommendations&ws-auth=0&keep=1#catalog`)
  await page.waitForValue('!!document.querySelector("[data-testid=recommendation-card-VIDEO]")', Boolean)
  assert.equal(await page.evaluate('!!document.querySelector("[data-testid=recommendation-card-UP]")'), false, 'only VIDEO content still publishes the main entry')
  assert.equal(await page.evaluate(`!!document.querySelector(${JSON.stringify(primary)})`), true)
  await geometry(page, scenario.profile)
  await tap(page, '[data-testid=recommendation-card-VIDEO]', touch)
  await page.waitForValue('document.querySelectorAll(".creator-card").length', value => value === 2)
  assert.equal(await page.evaluate('new URL(location.href).searchParams.get("view")'), 'recommended-videos')
  assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-card-101] a").href'), 'https://www.bilibili.com/video/BV1xx411c7mD')
  await tap(page, '[data-testid=creator-categories-toggle]', touch)
  assert.equal(await page.evaluate('!!document.querySelector("[data-testid=creator-filter-1],[data-testid=creator-filter-53]")'), false, 'public VIDEO filters exclude UP and empty VIDEO categories')
  await tap(page, '[data-testid=creator-filter-51]', touch)
  await page.waitForValue('document.querySelectorAll(".creator-card").length', value => value === 1)
  await page.evaluate('history.back()')
  await page.waitForValue('document.querySelectorAll(".creator-card").length', value => value === 2)
  await page.evaluate('history.forward()')
  await page.waitForValue('document.querySelectorAll(".creator-card").length', value => value === 1)
  await tap(page, '[data-testid=recommendations-back]', touch)
  await page.waitForValue('!!document.querySelector("[data-testid=recommendations-page]")', Boolean)
  assert.deepEqual(await page.evaluate('({view:new URL(location.href).searchParams.get("view"),category:new URL(location.href).searchParams.get("creatorCategory"),keep:new URL(location.href).searchParams.get("keep"),hash:location.hash})'), { view: 'recommendations', category: null, keep: '1', hash: '#catalog' })

  reset(); db.recommendationsAvailable = false
  for (const view of ['recommendations', 'creators', 'recommended-videos', 'creators-config']) {
    await page.goto(`${origin}/?view=${view}&ws-auth=1&ws-roles=content-admin`)
    await page.waitForValue('!!document.querySelector("[data-testid=creators-unavailable]")', Boolean)
    await page.waitForValue('document.querySelector("[data-testid=creators-availability-retry]")?.disabled', value => value === false)
    assert.equal(await page.evaluate('!!document.querySelector("[data-testid=nav-creators],[data-testid=tab-creators]")'), false)
  }
  assert.equal(db.recommendationReads, 0, 'obsolete capabilities never authorize recommendation API requests')

  reset()
  await page.goto(`${origin}/?view=creators-config&ws-auth=1&ws-roles=content-admin`)
  await page.waitForValue('!!document.querySelector("[data-testid=creator-form]")', Boolean)
  await fill(page, { 'creator-name': 'Unsaved UP draft', 'creator-uid': '123456' })
  await chooseAvatar(page)
  await page.waitForValue('document.querySelector("[data-testid=creator-avatar-preview]")?.naturalWidth', value => value === 32)
  await tap(page, '[data-testid=recommendation-type-VIDEO]', touch)
  await tap(page, '[data-testid=confirm-cancel]', touch)
  await page.waitForValue('!document.querySelector("[data-testid=confirm-dialog]") && !document.body.classList.contains("dialog-open")', Boolean, { label: 'cancelled type navigation closes and restores the form' })
  assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-name]").value'), 'Unsaved UP draft')
  assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-avatar-preview]").src.startsWith("blob:")'), true)
  await tap(page, '[data-testid=recommendation-type-VIDEO]', touch)
  await page.waitForValue('!!document.querySelector("[data-testid=confirm-dialog]")', Boolean, { label: 'second type navigation requests draft confirmation' })
  await tap(page, '[data-testid=confirm-ok]', touch)
  await page.waitForValue('new URL(location.href).searchParams.get("recommendationType")', value => value === 'VIDEO')
  await page.waitForValue('document.querySelector("[data-testid=creator-name]")?.value', value => value === '')
  assert.equal(await page.evaluate('!!document.querySelector("[data-testid=creator-avatar-preview],[data-testid=creator-assessed],[data-testid=creator-level],[data-testid=creator-new-level]")'), false, 'VIDEO clears abandoned UP draft and never exposes strength configuration')
  assert.equal(await page.evaluate('document.querySelector(".creator-fieldset small").textContent'), 'No categories yet. Add one in category management first.')
  assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-stars]").value'), '3')
  await geometry(page, scenario.profile, true)
  await fill(page, { 'creator-new-category': 'New video category' })
  await tap(page, '.creator-config-sections section:first-child form button', touch)
  await page.waitForValue('document.querySelectorAll(".creator-options input").length', value => value === 1)
  const category = db.categories.find(value => value.type === 'VIDEO')
  assert.ok(category); assert.equal(db.categories.filter(value => value.type === 'UP').length, 4)
  await fill(page, { 'creator-name': 'New video from administrator', 'creator-uid': '  BV1xX411c7mD  ', 'creator-description': 'A cover is optional.' })
  await tap(page, `[data-testid=creator-category-${category.id}]`, touch)
  assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-homepage]").href'), 'https://www.bilibili.com/video/BV1xX411c7mD')
  const writes = db.writes
  await chooseAvatar(page)
  await page.waitForValue('document.querySelector("[data-testid=creator-avatar-preview]")?.naturalWidth', value => value === 32)
  assert.equal(db.writes, writes, 'cover selection does not upload ahead of a save')
  db.failSave = true
  await tap(page, '[data-testid=creator-save]', touch)
  await page.waitForValue('!!document.querySelector("[data-testid=creators-config-page] [role=alert]")', Boolean)
  assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-name]").value'), 'New video from administrator')
  assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-avatar-preview]").src.startsWith("blob:")'), true)
  await tap(page, '[data-testid=creator-save]', touch)
  await page.waitForValue('document.querySelector("[data-testid=creator-name]")?.value', value => value === '')
  const created = db.creators.find(value => value.type === 'VIDEO')
  assert.ok(created?.avatarId); assert.equal(created.bilibiliUid, 'BV1xX411c7mD'); assert.equal(created.levelId, null); assert.equal(created.stars, 3)
  await tap(page, primary, touch)
  await tap(page, '[data-testid=recommendation-card-VIDEO]', touch)
  await page.waitForValue(`document.querySelector('[data-testid=creator-edit-${created.id}]')?.disabled`, value => value === false)
  await geometry(page, scenario.profile)
  await tap(page, `[data-testid=creator-edit-${created.id}]`, touch)
  await page.waitForValue('document.querySelector("[data-testid=creator-avatar-preview]")?.naturalWidth', value => value === 32)
  assert.equal(await page.evaluate('!!document.querySelector("[data-testid=creator-assessed],[data-testid=recommendation-type-UP]")'), false)
  await fill(page, { 'creator-name': 'Edited video' })
  await tap(page, '[data-testid=creator-avatar-clear]', touch)
  await tap(page, '[data-testid=creator-save]', touch)
  await page.waitForValue('!document.querySelector("[data-testid=creator-editor-dialog]")', Boolean)
  assert.equal(created.name, 'Edited video'); assert.equal(created.avatarId, null, 'VIDEO can be saved without a cover')
  await tap(page, `[data-testid=creator-remove-${created.id}]`, touch)
  await tap(page, '[data-testid=confirm-ok]', touch)
  await page.waitForValue('document.querySelectorAll(".creator-card").length', value => value === 0)
  await tap(page, '[data-testid=recommendations-back]', touch)
  await page.waitForValue('!!document.querySelector("[data-testid=recommendation-card-VIDEO]")', Boolean)
  await page.evaluate('window.__wsAuth.tokenParsed.value={realm_access:{roles:[]}}')
  await page.waitForValue('!document.querySelector("[data-testid=recommendation-card-VIDEO]")', Boolean)
  assert.equal(await page.evaluate('!!document.querySelector("[data-testid=recommendation-card-UP]")'), true, 'deleting final VIDEO hides its public card while UP stays published')
  assert.equal(await page.evaluate(`!!document.querySelector(${JSON.stringify(primary)})`), true)
}
const { server, origin } = await startFixtureServer({ middleware, allowedHosts: ['wotbtools.com'] }), chrome = await launchChromeForCdp(findChrome(), { extraArgs: ['--host-resolver-rules=MAP wotbtools.com 127.0.0.1', '--no-proxy-server'] })
const scenarios = ['showcase', 'classic'].flatMap(profile => [
  ...['UP', 'VIDEO'].flatMap(cardType => [1920, 1600, 1024, 390, 320].map(width => ({ name: `${profile}-cards-${cardType}-${width}`, profile, cardType, width, height: 1000, touch: width < 1200, locale: 'zh' }))),
  ...['en', 'ru'].map(locale => ({ name: `${profile}-cards-VIDEO-${locale}-1280`, profile, cardType: 'VIDEO', width: 1280, height: 1000, touch: false, locale })),
  ...[1440, 1024, 390, 360, 767, 768, 1199, 1200].map(width => ({ name: `${profile}-${width}`, profile, width, height: 1000, touch: width < 1200, full: [1440, 1024, 390].includes(width), locale: width === 1024 ? 'zh' : width === 390 ? 'ru' : 'en' })),
  ...[320, 351, 352, 360].map(width => ({ name: `${profile}-production-${width}`, profile, width, height: 844, touch: true, locale: 'ru', productionHome: true, compactNavigation: true })),
  { name: `${profile}-old-backend`, profile, width: 1440, height: 900, touch: false, locale: 'en', oldBackend: true },
  { name: `${profile}-content-lifecycle`, profile, width: 390, height: 1000, touch: true, locale: 'en', contentLifecycle: true },
  { name: `${profile}-local-320`, profile, width: 320, height: 844, touch: true, locale: 'zh', compactNavigation: true },
  ...[1440, 390].map(width => ({ name: `${profile}-videos-${width}`, profile, width, height: 1000, touch: width < 768, locale: 'en', videos: true })),
])
let failures = 0
try {
  const filters = process.argv.slice(2), selected = scenarios.filter(value => !filters.length || filters.some(filter => value.name.includes(filter)))
  assert.ok(selected.length)
  for (const scenario of selected) {
    reset(); const { targetId, sessionId } = await chrome.openPage(), page = new Page(chrome.client, sessionId)
    try {
      await page.enable(); await page.emulate(scenario)
      await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('wotb-ui-profile',${JSON.stringify(scenario.profile)});localStorage.setItem('wotb-lang',${JSON.stringify(scenario.locale)});` }, sessionId)
      if (scenario.cardType) {
        await cardPresentation(page, origin, scenario, chrome, sessionId)
        assert.deepEqual(page.consoleErrors, []); console.log(`PASS ${scenario.name}`); continue
      }
      if (scenario.videos) {
        await videoLifecycle(page, origin, scenario)
        assert.deepEqual(page.consoleErrors, []); console.log(`PASS ${scenario.name}`); continue
      }
      if (scenario.contentLifecycle) {
        const published = structuredClone(db.creators[0])
        db.creators = []
        for (const authenticated of [0, 1]) {
          await page.goto(`${origin}/?view=creators&ws-auth=${authenticated}`)
          await page.waitForValue('!!document.querySelector("[data-testid=creators-not-published]")', Boolean)
          assert.equal(await page.evaluate('!!document.querySelector("[data-testid=nav-creators],[data-testid=tab-creators]")'), false)
        }
        assert.equal(db.publicListReads, 0, 'empty public directory never fetches cards')
        assert.equal(db.metadataReads, 0, 'ordinary users never fetch management metadata')
        await page.goto(`${origin}/?view=creators-config&ws-auth=1&ws-roles=tournament-admin`)
        await page.waitForValue('!!document.querySelector("[data-testid=admin-required]")', Boolean)
        assert.equal(await page.evaluate('!!document.querySelector("[data-testid=creator-form]")'), false, 'tournament-admin never reaches content administration')
        assert.equal(db.metadataReads, 0, 'a denied content page never reads management metadata')
        await page.goto(`${origin}/?view=creators-config&ws-auth=1&ws-roles=content-admin`)
        await page.waitForValue('!!document.querySelector("[data-testid=creator-form]")', Boolean)
        assert.equal(await page.evaluate('!!document.querySelector("[data-testid=tab-creators]")'), true, 'admin keeps the directory entry before first UP')
        assert.equal(await page.evaluate('!!document.querySelector("[data-testid=creator-category-3]")'), true)
        await fill(page, { 'creator-name': 'First published creator', 'creator-uid': '123456' })
        await tap(page, '[data-testid=creator-category-1]', scenario.touch)
        await tap(page, '[data-testid=creator-save]', scenario.touch)
        await page.waitForValue('document.querySelector("[data-testid=creator-name]")?.value', value => value === '')
        const created = db.creators[0]
        assert.ok(created, 'administrator can publish the first UP')
        await tap(page, '[data-testid=tab-creators]', scenario.touch)
        await tap(page, '[data-testid=recommendation-card-UP]', scenario.touch)
        await page.waitForValue('document.querySelectorAll(".creator-card").length', value => value === 1)
        await tap(page, '[data-testid=creator-categories-toggle]', scenario.touch)
        await tap(page, '[data-testid=creator-filter-3]', scenario.touch)
        await page.waitForValue('document.querySelectorAll(".creator-card").length', value => value === 0)
        assert.equal(await page.evaluate('new URL(location.href).searchParams.get("creatorCategory")'), '3', 'admin keeps empty selection')
        await page.evaluate('window.__wsAuth.tokenParsed.value={realm_access:{roles:[]}}')
        await page.waitForValue('document.querySelectorAll(".creator-card").length', value => value === 1)
        assert.equal(await page.evaluate('new URL(location.href).searchParams.has("creatorCategory")'), false)
        assert.equal(await page.evaluate('!!document.querySelector("[data-testid=creator-filter-3]")'), false)
        await page.evaluate('window.__wsAuth.tokenParsed.value={realm_access:{roles:["content-admin"]}}')
        await page.waitForValue(`document.querySelector('[data-testid=creator-remove-${created.id}]')?.disabled`, value => value === false)
        await tap(page, `[data-testid=creator-remove-${created.id}]`, scenario.touch)
        await tap(page, '[data-testid=confirm-ok]', scenario.touch)
        await page.waitForValue('document.querySelectorAll(".creator-card").length', value => value === 0)
        assert.equal(await page.evaluate('!!document.querySelector("[data-testid=creators-page]")'), true)
        await page.evaluate('window.__wsAuth.tokenParsed.value={realm_access:{roles:[]}}')
        await page.waitForValue('!!document.querySelector("[data-testid=creators-not-published]")', Boolean)
        assert.equal(await page.evaluate('!!document.querySelector("[data-testid=tab-creators]")'), false, 'delete ACK removes the public entry without a reload')
        db.creators = [published]
        await page.evaluate('window.dispatchEvent(new Event("focus"))')
        await page.waitForValue('document.querySelectorAll(".creator-card").length', value => value === 1)
        assert.equal(await page.evaluate('!!document.querySelector("[data-testid=tab-creators]")'), true)
        db.creators = []
        await page.evaluate('window.dispatchEvent(new Event("focus"))')
        await page.waitForValue('!!document.querySelector("[data-testid=creators-not-published]")', Boolean)
        assert.equal(await page.evaluate('!!document.querySelector("[data-testid=tab-creators]")'), false, 'focus refresh also detects removal of the final UP')
        assert.deepEqual(page.consoleErrors, []); console.log(`PASS ${scenario.name}`); continue
      }
      if (scenario.oldBackend) {
        db.apiAvailable = false
        await page.goto(`${origin}/?view=creators&ws-auth=1&ws-roles=content-admin`)
        await page.waitForValue('!!document.querySelector("[data-testid=creators-unavailable]")', Boolean)
        await page.waitForValue('document.querySelector("[data-testid=creators-availability-retry]")?.disabled', value => value === false)
        assert.equal(await page.evaluate('!!document.querySelector("[data-testid=nav-creators],[data-testid=tab-creators],[data-testid=nav-creators-config],[data-testid=more-link-creators-config]")'), false)
        assert.equal(db.creatorReads, 0, 'legacy backend is never queried for creator directory or management metadata')
        db.apiAvailable = true
        await tap(page, '[data-testid=creators-availability-retry]', false)
        await page.waitForValue('document.querySelectorAll(".creator-card").length', value => value === 2)
        assert.equal(await page.evaluate('!!document.querySelector("[data-testid=nav-creators]")'), true)
        assert.ok(db.creatorReads > 0)
        assert.deepEqual(page.consoleErrors, []); console.log(`PASS ${scenario.name}`); continue
      }
      const scenarioOrigin = scenario.productionHome ? origin.replace('127.0.0.1', 'wotbtools.com') : origin
      await page.goto(`${scenarioOrigin}/?view=more&ws-auth=0`)
      if (scenario.compactNavigation) {
        await page.waitForValue('!!document.querySelector("[data-testid=more-page]")', Boolean)
        await page.waitForValue('!!document.querySelector("[data-testid=tab-creators]")', Boolean)
        await tabGeometry(page, scenario.productionHome ? 8 : 7)
        if (scenario.productionHome && scenario.width === 320) {
          const y = await page.evaluate('document.querySelector("[data-testid=app-tab-bar]").getBoundingClientRect().top + 24')
          await chrome.client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 140, y, id: 1 }] }, sessionId)
          for (const x of [160, 190, 230]) await chrome.client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] }, sessionId)
          await chrome.client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId)
          await page.waitForValue('document.querySelector("[data-testid=app-tab-bar]").scrollLeft', value => value <= 0.5)
        }
        // Tab traversal must reveal every target without moving the page vertically.
        const scrollY = await page.evaluate('window.scrollY')
        const targets = await page.evaluate('[...document.querySelectorAll("[data-testid=app-tab-bar] .tab")].map(el=>el.dataset.testid)')
        await page.evaluate(`document.querySelector('[data-testid="${targets[0]}"]').focus()`)
        for (const [index, target] of targets.entries()) {
          if (index) {
            await chrome.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId)
            await chrome.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId)
          }
          await page.waitForValue(`(() => {const e=document.activeElement,r=e.getBoundingClientRect();return {id:e.dataset.testid,left:r.left,right:r.right,width:innerWidth}})()`, value => value.id === target && value.left >= -0.5 && value.right <= value.width + 0.5)
        }
        assert.equal(await page.evaluate('window.scrollY'), scrollY)
      }
      const primary = scenario.width < 768 ? '[data-testid=tab-creators]' : '[data-testid=nav-creators]'
      await tap(page, primary, scenario.touch)
      await tap(page, '[data-testid=recommendation-card-UP]', scenario.touch)
      await page.waitForValue('document.querySelectorAll(".creator-card").length', value => value === 2)
      assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(primary)}).getAttribute('aria-current')`), 'page')
      if (scenario.compactNavigation) await tabGeometry(page, scenario.productionHome ? 8 : 7)
      assert.equal(await page.evaluate('document.querySelectorAll(".creator-card button").length'), 0, 'anonymous cards have no management or user-action buttons')
      assert.equal(await page.evaluate('window.__wsAuth.loginCalls.length'), 0); assert.equal(db.writes, 0)
      assert.equal(await page.evaluate('document.querySelector(".creator-card a").rel'), 'noopener noreferrer')
      const readsBeforeDisclosure = db.creatorReads, urlBeforeDisclosure = await page.evaluate('location.href')
      assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-categories-toggle]").getAttribute("aria-expanded")'), 'false')
      assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-category-options]").getClientRects().length'), 0)
      await tap(page, '[data-testid=creator-categories-toggle]', scenario.touch)
      assert.equal(await page.evaluate('!!document.querySelector("[data-testid=creator-filter-3]")'), false, 'empty categories are hidden from the public')
      await geometry(page, scenario.profile)
      await tap(page, '[data-testid=creator-categories-toggle]', scenario.touch)
      assert.equal(await page.evaluate('document.activeElement.dataset.testid'), 'creator-categories-toggle')
      if (scenario.width === 1440) {
        for (const [key, code, keyCode, expanded] of [[' ', 'Space', 32, 'true'], ['Enter', 'Enter', 13, 'false']]) {
          await chrome.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, text: key === 'Enter' ? '\r' : key }, sessionId)
          await chrome.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode }, sessionId)
          await page.waitForValue('document.querySelector("[data-testid=creator-categories-toggle]").getAttribute("aria-expanded")', value => value === expanded)
        }
      }
      await chrome.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId)
      await chrome.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId)
      assert.equal(await page.evaluate('!!document.activeElement.closest("[data-testid=creator-category-options]")'), false, 'collapsed options leave the keyboard tab order')
      assert.equal(db.creatorReads, readsBeforeDisclosure, 'disclosure does not request data')
      assert.equal(await page.evaluate('location.href'), urlBeforeDisclosure, 'disclosure does not change browser history')
      await tap(page, '[data-testid=creator-categories-toggle]', scenario.touch)
      await tap(page, '[data-testid=creator-filter-2]', scenario.touch); await page.waitForValue('document.querySelectorAll(".creator-card").length', value => value === 1)
      assert.equal(await page.evaluate('document.querySelectorAll(".creator-tags li").length'), 2)
      await tap(page, '[data-testid=creator-categories-toggle]', scenario.touch)
      assert.ok((await page.evaluate('document.querySelector("[data-testid=creator-selected-category]").textContent')).includes('Live commentary'))
      await geometry(page, scenario.profile)
      if (scenario.full) {
        await tap(page, '[data-testid=creator-refresh]', scenario.touch)
        await page.waitForValue('document.querySelector("[data-testid=creator-refresh]").disabled', value => value === false)
        assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-categories-toggle]").getAttribute("aria-expanded")'), 'false')
        assert.equal(await page.evaluate('new URL(location.href).searchParams.get("creatorCategory")'), '2')
        const profileBeforeReads = db.creatorReads
        await page.evaluate(`import('/src/composables/useUiProfile.js').then(m => m.setUiProfile(${JSON.stringify(scenario.profile === 'classic' ? 'showcase' : 'classic')}))`)
        assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-categories-toggle]").getAttribute("aria-expanded")'), 'false')
        await page.evaluate(`import('/src/composables/useUiProfile.js').then(m => m.setUiProfile(${JSON.stringify(scenario.profile)}))`)
        assert.equal(db.creatorReads, profileBeforeReads)
        await tap(page, '[data-testid=creator-category-all]', scenario.touch)
        await page.waitForValue('document.querySelectorAll(".creator-card").length', value => value === 2)
        assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-categories-toggle]").getAttribute("aria-expanded")'), 'false')
        await page.evaluate('history.back()')
        await page.waitForValue('document.querySelector("[data-testid=creator-filter-2]").getAttribute("aria-pressed")', value => value === 'true')
        assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-categories-toggle]").getAttribute("aria-expanded")'), 'true')
        await page.evaluate('history.forward()')
        await page.waitForValue('document.querySelector("[data-testid=creator-category-all]").getAttribute("aria-pressed")', value => value === 'true')
        assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-categories-toggle]").getAttribute("aria-expanded")'), 'true')
        await page.goto(`${origin}/?view=creators&ws-auth=0&creatorCategory=3&keep=1#list`)
        await page.waitForValue('document.querySelectorAll(".creator-card").length', value => value === 2)
        assert.deepEqual(await page.evaluate('({category:new URL(location.href).searchParams.get("creatorCategory"),keep:new URL(location.href).searchParams.get("keep"),hash:location.hash})'), { category: null, keep: '1', hash: '#list' })
        await page.goto(`${origin}/?view=creators&ws-auth=1&ws-roles=content-admin`)
        await page.waitForValue('document.querySelector("[data-testid=creator-edit-1]")?.disabled', value => value === false)
        await tap(page, '[data-testid=creator-categories-toggle]', scenario.touch)
        await tap(page, '[data-testid=creator-filter-3]', scenario.touch)
        await page.waitForValue('document.querySelectorAll(".creator-card").length', value => value === 0)
        assert.equal(await page.evaluate('new URL(location.href).searchParams.get("creatorCategory")'), '3', 'administrator can browse an empty category')
        await tap(page, '[data-testid=creator-category-all]', scenario.touch)
        await page.waitForValue('document.querySelector("[data-testid=creator-edit-1]")?.disabled', value => value === false)
        await geometry(page, scenario.profile)
        db.categories.push({ id: 99, type: 'UP', name: 'New category from another administrator' }); db.levels.push({ id: 99, name: 'New skill level' }); db.creators[0].categoryIds = [99]; db.creators[0].levelId = 99; db.creators[0].version++
        await tap(page, '[data-testid=creator-edit-1]', scenario.touch); await page.waitForValue('!!document.querySelector("[data-testid=creator-name]")', Boolean)
        assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-category-99]")?.checked'), true)
        await fill(page, { 'creator-name': 'Edited in real browser' })
        db.creators[0].name = 'Concurrent administrator edit'; db.creators[0].version++
        await tap(page, '[data-testid=creator-save]', scenario.touch); await page.waitForValue('!!document.querySelector("[data-testid=creator-editor-dialog] [role=alert]")', Boolean)
        assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-name]").value'), 'Edited in real browser', '409 preserves the local draft')
        assert.equal(db.creators[0].name, 'Concurrent administrator edit', 'a stale editor cannot overwrite a newer version')
        await tap(page, '[data-testid=creator-editor-reload]', scenario.touch)
        await page.waitForValue('document.querySelector("[data-testid=creator-name]")?.value', value => value === 'Concurrent administrator edit')
        await fill(page, { 'creator-name': 'Edited in real browser' })
        await tap(page, '[data-testid=creator-save]', scenario.touch); await page.waitForValue('!document.querySelector("[data-testid=creator-editor-dialog]")', Boolean)
        await tap(page, '[data-testid=creator-remove-2]', scenario.touch); await tap(page, '[data-testid=confirm-ok]', scenario.touch); await page.waitForValue('!document.querySelector("[data-testid=creator-card-2]")', Boolean)
        await page.goto(`${origin}/?view=creators-config&ws-auth=1&ws-roles=content-admin`); await page.waitForValue('!!document.querySelector("[data-testid=creator-form]")', Boolean); await geometry(page, scenario.profile, true)
        await fill(page, { 'creator-name': 'Created in real browser', 'creator-uid': '0001000010', 'creator-description': 'Browser form' }); await tap(page, '[data-testid=creator-category-1]', scenario.touch)
        const writes = db.writes; await chooseAvatar(page); await page.waitForValue('document.querySelector("[data-testid=creator-avatar-preview]")?.naturalWidth', value => value === 32)
        assert.equal(db.writes, writes, 'choosing a file makes no HTTP write'); assert.equal(db.avatars.size, 0)
        db.failSave = true; await tap(page, '[data-testid=creator-save]', scenario.touch); await page.waitForValue('!!document.querySelector("[data-testid=creators-config-page] [role=alert]")', Boolean)
        assert.equal(await page.evaluate('document.querySelector("[data-testid=creator-avatar-preview]").src.startsWith("blob:")'), true)
        await tap(page, '[data-testid=creator-save]', scenario.touch); await page.waitForValue('document.querySelector("[data-testid=creator-name]")?.value', value => value === '')
        const created = db.creators.find(value => value.bilibiliUid === '1000010'); assert.ok(created?.avatarId); assert.equal(created.stars, 3); assert.equal(db.avatars.size, 1)
        await fill(page, { 'creator-name': 'Duplicate UID', 'creator-uid': '1000010' }); await tap(page, '[data-testid=creator-category-1]', scenario.touch)
        await tap(page, '[data-testid=creator-save]', scenario.touch); await page.waitForValue('!!document.querySelector("[data-testid=creators-config-page] [role=alert]")', Boolean); assert.equal(db.creators.length, 2, 'duplicate normalized UID cannot create another record')
        await page.goto(`${origin}/?view=creators&ws-auth=1&ws-roles=content-admin`); await page.waitForValue(`document.querySelector('[data-testid=creator-edit-${created.id}]')?.disabled`, value => value === false)
        await tap(page, `[data-testid=creator-edit-${created.id}]`, scenario.touch); await page.waitForValue('document.querySelector("[data-testid=creator-avatar-preview]")?.naturalWidth', value => value === 32)
        await tap(page, '[data-testid=creator-avatar-clear]', scenario.touch); await tap(page, '[data-testid=creator-save]', scenario.touch); await page.waitForValue('!document.querySelector("[data-testid=creator-editor-dialog]")', Boolean)
        assert.equal(created.avatarId, null, 'REMOVE detaches rather than deleting a potentially referenced object')
        db.uploadAvailable = false; await tap(page, `[data-testid=creator-edit-${created.id}]`, scenario.touch); await page.waitForValue('!!document.querySelector("[data-testid=creator-form]")', Boolean)
        assert.equal(await page.evaluate('document.querySelector("[data-testid=tournament-image-input]").disabled'), true)
        await fill(page, { 'creator-name': 'Saved without avatar storage' }); await tap(page, '[data-testid=creator-save]', scenario.touch); await page.waitForValue('!document.querySelector("[data-testid=creator-editor-dialog]")', Boolean)
        await page.goto(`${origin}/?view=creators-config&ws-auth=1&ws-roles=content-admin`); await page.waitForValue('!!document.querySelector("[data-testid=creator-form]")', Boolean)
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
