import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { ADMIN_NAV } from '../src/app/navigation.js'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { MOBILE_VIEWPORTS } from './browser-shell-overlays.mjs'
import { measureViewportSafety } from './browser-occlusion.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'
import { createAdminDirectory } from './browser-fixtures/admin-directory.mjs'
import { createBattleDataFixture } from './browser-fixtures/battle-data.mjs'
import { createHofAdminFixture } from './browser-fixtures/hof-admin-fixture.mjs'
import { createTournamentFixture } from './browser-fixtures/tournament-admin.mjs'

const views = {
  'admin-users': '[data-testid=admin-row-open]',
  'admin-battle-data': '[data-testid=battle-row-open]',
  'admin-ai-review-feedback': '[data-testid=feedback-row-open]',
  'admin-site-feedback': '[data-testid=feedback-row-open]',
  'hof-admin': '.hof-admin-tabs',
  'tournament-points-config': '.tournament-config [data-testid=event-compact]',
  'tournament-points-admin': '[data-testid=tournament-admin-more]',
  'creators-config': '[data-testid=creator-new-category]',
}
assert.deepEqual(Object.keys(views).sort(), ADMIN_NAV.map(item => item.view).sort())
const site = ['admin-users', 'admin-battle-data', 'admin-ai-review-feedback', 'admin-site-feedback', 'hof-admin']
const actors = [
  { name: 'anonymous', claims: [], allowed: [], authenticated: false },
  { name: 'member', claims: [], allowed: [] },
  { name: 'site', claims: ['wotbtools-admin'], allowed: site },
  { name: 'hof', claims: ['HoF-admin'], allowed: ['hof-admin'] },
  { name: 'tournament', claims: ['tournament-admin'], allowed: ['tournament-points-config', 'tournament-points-admin'] },
  { name: 'content', claims: ['content-admin'], allowed: ['creators-config'] },
  { name: 'combined', claims: ['wotbtools-admin', 'tournament-admin', 'content-admin'], allowed: Object.keys(views) },
]
const seasons = ['spring', 'summer', 'autumn', 'winter']
const sizes = [
  ...MOBILE_VIEWPORTS.map((size, i) => ({ ...size, profile: seasons[i % seasons.length], touch: true })),
  { id: 'tablet', width: 900, height: 900, profile: 'autumn', touch: true },
  { id: 'desktop', width: 1280, height: 850, profile: 'summer', touch: false },
]
const renderingSizes = [sizes.find(size => size.width === 390), sizes.at(-1)]
const renderingCases = renderingSizes.flatMap(size => seasons.map(profile => ({ ...size, profile, key: 'render-' + size.width + '-' + profile })))
const only = process.argv.slice(2)
const scenarioNames = ['probe-scrollport', 'backdrop-desktop', 'backdrop-mobile', ...actors.map(a => 'role-' + a.name), ...sizes.map(s => 'layout-' + s.id), ...seasons.map(p => 'theme-' + p), ...renderingCases.map(c => c.key)]
for (const prefix of only) assert.ok(scenarioNames.some(name => name.startsWith(prefix)), 'Unknown scenario prefix: ' + prefix)
const output = fileURLToPath(new URL('../../tmp/admin-contract/', import.meta.url))
const domains = [
  [/^\/api\/admin\/battle-data\//, createBattleDataFixture().middleware],
  [/^\/api\/admin\/hof(?:\/|$)/, createHofAdminFixture().middleware],
  [/^\/api\/(?:admin\/)?tournaments(?:\/|$)/, createTournamentFixture().middleware],
  [/^\/api\/admin\/(?:users|ai-review-feedback|site-feedback)(?:\/|$)/, createAdminDirectory().middleware],
]
const { server, origin } = await startFixtureServer({ middleware(req, res, next) {
  const url = new URL(req.url, 'http://fixture')
  const path = url.pathname
  if (!path.startsWith('/api/')) return next()
  const json = (body, status = 200) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
  if (!['GET', 'HEAD'].includes(req.method)) return json({ error: 'Read-only fixture' }, 405)
  if (path === '/api/admin/recommendations/metadata') {
    return json({ type: url.searchParams.get('type'), categories: [], levels: [], imageUploadsAvailable: false })
  }
  if (path === '/api/recommendations') return json([])
  const handler = domains.find(([match]) => match.test(path))?.[1]
  if (handler) return handler(req, res, next)
  if (path.startsWith('/api/admin/')) return json({ error: 'Unmatched admin fixture' }, 404)
  return next()
} })
const chrome = await launchChromeForCdp(findChrome())
const errors = []
await mkdir(output, { recursive: true })
const selected = key => !only.length || only.some(prefix => key.startsWith(prefix))
const themeReference = new Map()
let fixtureBooted = false

async function scenario(key, size, run) {
  if (!selected(key)) return
  const { sessionId, targetId } = await chrome.openPage()
  const page = new Page(chrome.client, sessionId)
  const rows = []
  try {
    await page.enable()
    await page.emulate({ ...size, deviceScaleFactor: 1 })
    const profile = size.profile ?? 'summer'
    await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'localStorage.setItem("wotb-lang","en");localStorage.setItem("wotb-ui-profile",' + JSON.stringify(profile) + ')',
    }, sessionId)
    await run(page, rows)
  } catch (error) { rows.push({ errors: [error.message] }) }
  finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  const failures = rows.flatMap(row => (row.errors ?? []).map(message => (row.view ?? key) + ': ' + message))
  await writeFile(resolve(output, key + '.json'), JSON.stringify({ key, size, rows }, null, 2))
  if (failures.length) errors.push(key)
  console.log(key, 'rows', rows.length, 'failures', failures.length, failures.slice(0, 3))
}
async function visit(page, view, actor) {
  const params = new URLSearchParams({ view, 'ws-auth': actor.authenticated === false ? '0' : '1', 'ws-roles': actor.claims.join(',') })
  await page.client.send('Page.navigate', { url: origin + '/?' + params }, page.sessionId)
  await page.waitForValue('location.search===' + JSON.stringify('?' + params) + ' && window.__wsAuth?.initialized.value && !!document.querySelector("#main")', Boolean,
    { timeout: fixtureBooted ? 45_000 : 240_000, label: view + ' AppShell and authentication ready' })
  fixtureBooted = true
}
async function waitElement(page, selector) {
  return page.waitForValue('!!document.querySelector(' + JSON.stringify(selector) + ')', Boolean, { label: selector, timeout: 12000 })
}
async function roleMatrix(actor, page, rows) {
  const requests = []
  await chrome.client.send('Network.enable', {}, page.sessionId)
  chrome.client.on('Network.requestWillBeSent', ({ request }, session) => {
    if (session !== page.sessionId) return
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/admin/')) requests.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams) })
  })
  for (const view of Object.keys(views)) {
    requests.length = 0
    await visit(page, view, actor)
    const gate = actor.authenticated === false ? '[data-testid=capability-auth-gate],.hof-admin-login' : '[data-testid=admin-required],.hof-admin-denied'
    const allowed = actor.allowed.includes(view)
    await waitElement(page, views[view] + ',' + gate)
    const canReadCounts = actor.allowed.includes('hof-admin')
    if (canReadCounts) await page.waitForValue('document.querySelector("[data-testid=hof-pending-badge]")?.textContent', text => /^\d+\+?$/.test(text?.trim()))
    const actual = await page.callWith((owner, gate) => ({
      allowed: !!document.querySelector(owner), gated: !!document.querySelector(gate), actualRoles: [...window.__wsAuth.tokenParsed.value.realm_access.roles],
    }), views[view], gate)
    const wrong = actual.allowed !== allowed || actual.gated === allowed || actor.claims.join(',') !== actual.actualRoles.join(',')
    const errors = wrong ? ['direct route access state disagrees with the expected role'] : []
    const background = requests.filter(({ method, path, query }) => method === 'GET' && /^\/api\/admin\/hof\/(hundred|mark3)\/submissions$/.test(path)
      && Object.keys(query).length === 3 && query.status === 'PENDING' && query.page === '1' && query.size === '1')
    if (background.length !== (canReadCounts ? 2 : 0) || new Set(background.map(read => read.path)).size !== background.length) errors.push('unexpected background count reads')
    if (!allowed && requests.length !== background.length) errors.push('protected request from a denied view')
    if (requests.some(({ method }) => !['GET', 'HEAD'].includes(method))) errors.push('unexpected write on navigation')
    rows.push({ view, expected: allowed, ...actual, requests: [...requests], errors })
  }
  for (const size of [sizes.at(-1), sizes[0]]) {
    await page.emulate({ ...size, deviceScaleFactor: 1 })
    await visit(page, 'more', actor)
    await waitElement(page, '[data-testid=more-page]')
    if (size.touch) await page.openNavDrawer()
    if (actor.allowed.includes('creators-config')) await waitElement(page, '[data-testid=nav-creators-config]')
    const items = await page.evaluate('Array.from(document.querySelectorAll("[aria-labelledby=sidebar-admin-title] a"), a => a.dataset.testid.slice(4))')
    rows.push({ nav: size.touch ? 'drawer' : 'sidebar', items, errors: items.join(',') === actor.allowed.join(',') ? [] : ['unexpected admin navigation ' + items.join(',')] })
    if (size.touch) await page.closeNavDrawer()
  }
}
async function selectTournament(page, view, touch) {
  const selector = '[data-testid=event-compact] input'
  await page.waitForValue('document.querySelector(' + JSON.stringify(selector) + ')?.disabled', disabled => disabled === false)
  await page.tapSelector(selector, touch)
  await waitElement(page, '[role=option][data-value="1"]')
  await page.tapSelector('[role=option][data-value="1"]', touch)
  await waitElement(page, view.endsWith('config') ? '[data-testid=rule-1-1]' : '[data-testid=tournament-day-actions]')
}
function inspectHero() {
  const main = document.querySelector('#main')
  const hero = main.querySelector('.showcase-hero')
  const visible = node => node.getClientRects().length > 0
  const controls = [...main.querySelectorAll('button,input:not([type=hidden]),select,textarea,a[href]')].filter(visible)
  const swatch = document.createElement('span')
  swatch.style.backgroundColor = 'var(--color-accent)'
  main.append(swatch)
  const accent = getComputedStyle(swatch).backgroundColor
  swatch.remove()
  const primary = controls.filter(node => node.matches('.app-button.is-primary,.btn-primary') || getComputedStyle(node).backgroundColor === accent).map(node => ({
    label: node.textContent.trim() || node.getAttribute('aria-label'), role: node.getAttribute('role'),
    selected: node.matches('.active,.is-active,[aria-pressed=true],[aria-checked=true],[aria-selected=true]'),
    disabled: node.matches(':disabled'), fill: getComputedStyle(node).backgroundColor,
  }))
  return {
    profile: document.documentElement.dataset.uiProfile,
    headings: [...main.querySelectorAll('h1,h2')].filter(visible).map(node => node.textContent.trim()),
    h1Count: [...main.querySelectorAll('h1')].filter(visible).length, compact: hero?.classList.contains('is-compact'),
    heroControls: controls.filter(node => hero?.contains(node)).length,
    primary,
    controlShape: controls.map(node => node.dataset.testid ?? node.getAttribute('role') ?? node.tagName),
    heroTitleFont: getComputedStyle(hero.querySelector('h1')).fontSize,
  }
}
async function themes(profile, page, rows) {
  for (const view of Object.keys(views)) {
    const actor = actors.find(a => a.allowed.includes(view))
    await visit(page, view, actor)
    await waitElement(page, views[view])
    if (view.startsWith('tournament-')) await selectTournament(page, view, false)
    await page.evaluate('document.fonts.ready')
    await page.animationsSettled()
    const state = await page.probe(inspectHero)
    const { controlShape, ...facts } = state
    const shape = JSON.stringify([state.headings, state.heroTitleFont, controlShape])
    const errors = []
    if (state.profile !== profile) errors.push('unexpected active profile')
    if (state.h1Count !== 1 || !state.compact || state.heroControls) errors.push('expected one compact hero title with actions outside the banner')
    if (themeReference.has(view) && themeReference.get(view) !== shape) errors.push('headings, title size or rendered control sequence changed with theme')
    else themeReference.set(view, shape)
    rows.push({ view, actor: actor.name, ...facts, controls: controlShape.length, errors })
  }
}
async function backdrop(size, page, rows) {
  const reduced = size.touch
  await page.client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] }, page.sessionId)
  await page.client.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const decode = HTMLImageElement.prototype.decode
    window.backdropDecodes = {}
    HTMLImageElement.prototype.decode = function () {
      const match = this.src.match(/backdrop-(spring|summer|autumn|winter)-(wide|portrait)/)
      if (!match) return decode.call(this)
      return decode.call(this).then(() => new Promise(resolve => { window.backdropDecodes[match[1]] = resolve }))
    }` }, page.sessionId)
  await visit(page, 'more', actors[1])
  await waitElement(page, '[data-testid=theme-winter]')
  const ready = "document.querySelector('.app-backdrop').classList.contains('is-ready')"
  const waitDecode = theme => page.waitForValue('typeof window.backdropDecodes[' + JSON.stringify(theme) + ']', type => type === 'function', { timeout: 5000, label: theme + ' backdrop decode' })
  const release = theme => page.callWith(name => window.backdropDecodes[name](), theme)
  const hidden = async () => {
    assert.equal(await page.evaluate(ready), false, 'background must wait for the current decode')
    assert.equal(await page.evaluate("getComputedStyle(document.querySelector('.app-backdrop')).opacity"), '0')
  }
  await waitDecode(size.profile)
  await hidden()
  await page.tapSelector('[data-testid=theme-winter]', size.touch)
  await waitDecode('winter')
  await release(size.profile)
  await hidden()
  await release('winter')
  await page.waitForValue(ready, Boolean)
  const style = await page.probe(() => {
    const s = getComputedStyle(document.querySelector('.app-backdrop'))
    return { opacity: s.opacity, duration: parseFloat(s.transitionDuration), property: s.transitionProperty, image: s.backgroundImage }
  })
  assert.ok(style.image.includes('backdrop-winter-' + (size.touch ? 'portrait' : 'wide')))
  assert.equal(style.duration === 0, reduced)
  if (reduced) assert.equal(style.opacity, '1')
  else assert.equal(style.property, 'opacity')
  rows.push({ theme: 'winter', reduced, duration: style.duration, errors: [] })
}

function inspectRendering() {
  const hero = document.querySelector('.showcase-hero')
  const fields = [...document.querySelectorAll('#main input:not([type]), #main input:is([type=text],[type=search],[type=number]), #main textarea')]
    .filter(el => !el.disabled && !el.readOnly && el.getClientRects().length)
  const clipboardData = new DataTransfer()
  clipboardData.setData('text/plain', '12345')
  const blockedPaste = fields.filter(el => !el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData })))
    .map(el => el.id || el.name || el.tagName)
  return {
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    profile: document.documentElement.dataset.uiProfile,
    heroMotion: [...window.heroMotion, ...hero.getAnimations({ subtree: true }).map(a => a.constructor.name)],
    fonts: [...document.fonts].map(face => face.family),
    fields: fields.length, blockedPaste,
  }
}

async function rendering(size, page, rows) {
  const fontRequests = []
  await page.client.send('Network.enable', {}, page.sessionId)
  page.client.on('Network.requestWillBeSent', (event, session) => {
    if (session === page.sessionId && event.type === 'Font') fontRequests.push(event.request.url)
  })
  await page.client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, page.sessionId)
  await page.client.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.heroMotion = []
    for (const type of ['animationstart', 'transitionrun']) {
      document.addEventListener(type, event => {
        if (event.target.closest?.('.showcase-hero')) window.heroMotion.push(event.animationName || event.propertyName)
      }, true)
    }` }, page.sessionId)
  for (const [view, selector] of Object.entries(views)) {
    fontRequests.length = 0
    const actor = actors.find(a => a.allowed.includes(view))
    await visit(page, view, actor)
    await waitElement(page, selector)
    await waitElement(page, '.app-backdrop.is-ready')
    await page.evaluate('document.fonts.ready')
    await page.animationsSettled()
    const state = await page.probe(inspectRendering)
    const errors = []
    if (!state.reduced || state.profile !== size.profile) errors.push('unexpected motion preference or theme')
    if (state.heroMotion.length) errors.push('hero moved with reduced motion')
    if (fontRequests.length || state.fonts.length) errors.push('downloadable fonts present')
    if (state.blockedPaste.length) errors.push('paste canceled')
    rows.push({ view, ...state, fontRequests: [...fontRequests], errors })
    if (size.profile === 'summer' || size.profile === 'winter') {
      const shot = await page.client.send('Page.captureScreenshot', { format: 'webp', quality: 82 }, page.sessionId)
      await writeFile(resolve(output, size.key + '-' + view + '.webp'), Buffer.from(shot.data, 'base64'))
    }
  }
  if (!rows.some(row => row.fields > 0)) throw new Error('no editable fields tested')
}

async function layout(size, page, rows) {
  const insets = { top: 0, right: 0, bottom: 0, left: 0, ...size.insets }
  await chrome.client.send('Emulation.setSafeAreaInsetsOverride', { insets }, page.sessionId)
  for (const view of Object.keys(views)) {
    const actor = actors.find(a => a.allowed.includes(view))
    const problems = new Set()
    let steps = 0, checked = 0, mainChecked = 0
    try {
      await visit(page, view, actor)
      await waitElement(page, views[view])
      await page.waitForValue('document.querySelector(' + JSON.stringify(views[view]) + ')?.getBoundingClientRect().width', n => n > 0)
      if (view.startsWith('tournament-')) await selectTournament(page, view, size.touch)
      await page.evaluate('scrollTo(0,0)')
      await page.animationsSettled()
      const state = await page.probe(() => {
        const marker = document.createElement('div')
        marker.style.cssText = 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'
        document.body.append(marker)
        const style = getComputedStyle(marker)
        const cssInsets = { top: parseFloat(style.paddingTop), right: parseFloat(style.paddingRight), bottom: parseFloat(style.paddingBottom), left: parseFloat(style.paddingLeft) }
        marker.remove()
        return { profile: document.documentElement.dataset.uiProfile, drawer: !!document.querySelector('[data-testid=nav-menu]'), width: document.documentElement.scrollWidth, cssInsets }
      })
      if (Object.keys(insets).some(edge => state.cssInsets[edge] !== insets[edge])) problems.add('CSS environment insets differ from the requested fixture')
      if (state.profile !== size.profile) problems.add('expected profile ' + size.profile + ', got ' + state.profile)
      if (Boolean(size.insets) !== state.drawer) problems.add('unexpected shell navigation topology')
      if (state.width > size.width + 1) problems.add('document overflow ' + state.width + ' > ' + size.width)
      if (view === 'admin-battle-data' && size.width < 768) {
        await waitElement(page, '.spawn-cell .spawn-bar')
        const barsFit = await page.probe(() => [...document.querySelectorAll('.spawn-cell .spawn-bar')].every(bar => {
          const cell = bar.closest('td').getBoundingClientRect(), rect = bar.getBoundingClientRect()
          return rect.width > 0 && rect.left >= cell.left - 1 && rect.right <= cell.right + 1
        }))
        if (!barsFit) problems.add('spawn bar extends beyond its mobile card cell')
      }
      for (let done = false; !done && steps < 120; steps++) {
        await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        await page.animationsSettled()
        const probe = await measureViewportSafety(page, { insets, chrome: ['[data-testid=app-top-bar]'] })
        for (const error of probe.failures) problems.add(error)
        checked += probe.checked
        mainChecked += probe.mainChecked
        done = await page.evaluate('(() => { const old = scrollY; scrollBy(0, Math.round(innerHeight * 0.6)); return old === scrollY })()')
        if (!done && steps === 119) problems.add('scan did not reach the end')
      }
      if (!mainChecked) problems.add('no controls sampled inside main')
      rows.push({ view, actor: actor.name, ...state, steps, checked, mainChecked, errors: [...problems] })
    } catch (error) { rows.push({ view, actor: actor.name, errors: [error.message] }) }
  }
}
try {
  await scenario('probe-scrollport', sizes[0], async (page, rows) => {
    await page.evaluate(`document.body.innerHTML = '<div id="port" style="width:180px;height:60px;overflow:auto"><div style="height:100px"></div><button data-testid="nested-button" style="width:100px;height:40px">Fixture</button></div><div id="cover" style="height:160px;background:white"></div>'`)
    await page.evaluate("document.querySelector('#port').style.position = 'fixed'")
    const check = () => measureViewportSafety(page, { insets: {} })
    let probe = await check()
    assert.equal(probe.checked, 0, 'button outside its scrollport is not visible yet')
    assert.deepEqual(probe.failures, [])
    await page.evaluate('document.querySelector("#port").scrollTop=100')
    probe = await check()
    assert.equal(probe.checked, 1, 'scrolling the same button into view enables hit testing')
    assert.deepEqual(probe.failures, [])
    await page.evaluate('document.querySelector("#cover").style.cssText="position:fixed;inset:0;background:white;z-index:1"')
    probe = await check()
    assert.equal(probe.checked, 1)
    assert.ok(probe.failures.some(message => message.includes('nested-button')), 'real overlay remains a failure')
    rows.push({ errors: [] })
  })
  for (const size of [{ ...sizes.at(-1), profile: 'summer' }, { ...renderingSizes[0], profile: 'spring' }]) {
    await scenario(size.touch ? 'backdrop-mobile' : 'backdrop-desktop', size, (page, rows) => backdrop(size, page, rows))
  }
  for (const actor of actors) await scenario('role-' + actor.name, sizes.at(-1), (page, rows) => roleMatrix(actor, page, rows))
  for (const size of sizes) await scenario('layout-' + size.id, size, (page, rows) => layout(size, page, rows))
  for (const profile of seasons) await scenario('theme-' + profile, { ...sizes.at(-1), profile }, (page, rows) => themes(profile, page, rows))
  for (const size of renderingCases) await scenario(size.key, size, (page, rows) => rendering(size, page, rows))
} finally {
  await chrome.close()
  await server.close()
}
if (errors.length) process.exitCode = 1
