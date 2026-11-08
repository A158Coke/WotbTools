import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createBroadcastFixture } from './browser-fixtures/broadcast-fixture.mjs'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

// Exercise the production router, components, transport validators and CSS. Only external
// auth and HTTP services are fixtures, shared by anonymous and administrator requests.
const fixture = createBroadcastFixture({ rich: true })
let db
function reset() { fixture.reset(); db = fixture.db }
const middleware = fixture.middleware

if (process.argv.includes('--preview')) {
  const local = createBroadcastFixture({ preview: true })
  const previewPlugin = { name: 'broadcast-local-preview',
    transformIndexHtml(html) { return html.replace('<head>', `<head><script>localStorage.setItem('wotb-lang','zh');</script>`) },
  }
  const result = await startFixtureServer({ middleware: local.middleware, plugins: [previewPlugin], port: 5187 })
  console.log(`Preview: ${result.origin}/?view=league-broadcasts&lbServer=CN&lbSeason=10&ws-auth=1&ws-roles=wotbtools-admin`)
  process.on('SIGINT', async () => { await result.server.close(); process.exit(0) })
  await new Promise(() => {})
}
const { server, origin } = await startFixtureServer({ middleware, allowedHosts: ['wotbtools.com'] })

const chrome = await launchChromeForCdp(findChrome(), { extraArgs: ['--host-resolver-rules=MAP wotbtools.com 127.0.0.1', '--no-proxy-server'] })
const screenshots = process.env.BROADCAST_SCREENSHOTS
const scenarios = ['summer', 'winter'].flatMap(profile => [
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
  await page.animationsSettled()
  const point = await page.callWith((sel) => {
    const element = document.querySelector(sel)
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = element.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, selector)
  await page.tap({ ...point, touch })
}
async function fill(page, values) {
  await page.callWith((entries) => {
    for (const [id, value] of Object.entries(entries)) {
      const el = document.querySelector('[data-testid="' + id + '"]')
      el.value = String(value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }, values)
}
async function geometry(page) {
  const result = await page.evaluate(`(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1,
    tiny: matchMedia('(pointer:coarse)').matches ? [...document.querySelectorAll('[data-testid="league-broadcasts-page"] button')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.height<43}).map(el=>el.dataset.testid||el.textContent) : [],
    tabBar:!!document.querySelector('[data-testid="app-tab-bar"]'),
    profile:document.documentElement.dataset.uiProfile }))()`)
  assert.equal(result.overflow, false, 'horizontal overflow')
  assert.deepEqual(result.tiny, [], 'minimum 44px hit targets')
  assert.equal(result.tabBar, false, 'no bottom tab bar (L1)')
}
async function toolbarGeometry(page, scenario) {
  await page.waitForValue('document.querySelectorAll("[data-testid=broadcast-toolbar] [data-testid^=broadcast-server-]").length', value => value === 5)
  const layout = await page.evaluate(`(() => {
    const bar = document.querySelector('[data-testid=broadcast-toolbar]').getBoundingClientRect()
    const servers = [...document.querySelectorAll('[data-testid^=broadcast-server-]')].map(el => el.textContent.trim())
    const season = document.querySelector('[data-testid=broadcast-season-select]')?.getBoundingClientRect()
    return { barRight: bar.right, viewport: innerWidth, servers, seasonWidth: season?.width ?? 0 }
  })()`)
  if (scenario.locale === 'en') assert.deepEqual(layout.servers, ['CN Server', 'APAC Server', 'NA Server', 'EU Server', 'Lesta'])
  assert.ok(layout.barRight <= layout.viewport + 1, `toolbar stays inside the viewport: ${JSON.stringify(layout)}`)
  assert.ok(layout.seasonWidth > 0, 'season selector is part of the toolbar')
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
      await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('wotb-ui-profile',${JSON.stringify(scenario.profile)});localStorage.setItem('wotb-lang',${JSON.stringify(scenario.locale)});localStorage.removeItem('wotb-broadcast-display-time-zone');` }, sessionId)
      const scenarioOrigin = scenario.productionHome ? origin.replace('127.0.0.1', 'wotbtools.com') : origin
      await page.goto(`${scenarioOrigin}/?view=more&ws-auth=0`)
      await page.waitForValue('!!document.querySelector("[data-testid=more-page]")', Boolean)
      assert.equal(await page.evaluate('!!document.querySelector("[data-testid=more-link-league-broadcasts]")'), false)
      if (scenario.productionHome && scenario.width >= 768) {
        await tap(page, '[data-testid=app-sidebar] .sidebar-brand', scenario.touch)
        await page.waitForValue('!!document.querySelector("[data-testid=home-feedback]")', Boolean, { label: 'public home after logo' })
        assert.deepEqual(await page.evaluate('[location.pathname, new URL(location.href).searchParams.has("view"), document.querySelector("[data-testid=nav-home]")?.getAttribute("aria-current")]'), ['/', false, 'page'])
        await page.goto(`${scenarioOrigin}/?view=more&ws-auth=0`)
        await page.waitForValue('!!document.querySelector("[data-testid=more-page]")', Boolean)
      }
      // 手机竖屏 / 横屏走「菜单 → 左侧抽屉」，平板 / 桌面走侧边栏（§9 L1 / L3）；栏目入口是同一项。
      const clicked = await page.navigateViaShell('league-broadcasts', scenario.touch)
      await page.waitForValue('document.querySelectorAll("[data-testid^=broadcast-server-]").length', value => value === 5)
      const drawerShell = clicked.includes('nav-drawer-panel')
      if (drawerShell) await page.openNavDrawer(scenario.touch)
      const activeEntry = drawerShell ? '[data-testid=nav-drawer-panel] [data-testid=nav-league-broadcasts]' : '[data-testid=nav-league-broadcasts]'
      assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(activeEntry)}).getAttribute('aria-current')`), 'page')
      const navLabel = await page.evaluate(`(() => { const link = document.querySelector(${JSON.stringify(activeEntry)}); return { visible: link.textContent.trim(), accessible: link.getAttribute('aria-label') }; })()`)
      assert.ok(navLabel.accessible.includes(navLabel.visible), 'accessible name includes the visible navigation label')
      if (drawerShell) await page.closeNavDrawer()
      await page.waitForValue('!!document.querySelector("[data-testid=broadcast-round-30]")', Boolean, { label: 'first server and latest season open by default' })
      await toolbarGeometry(page, scenario)
      if (screenshots && ['summer-desktop', 'winter-mobile'].includes(scenario.name)) {
        await mkdir(screenshots, { recursive: true })
        const image = await chrome.client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId)
        await writeFile(join(screenshots, `${scenario.name}-servers.png`), Buffer.from(image.data, 'base64'))
      }
      if (scenario.name.endsWith('-desktop')) {
        await page.emulate({ ...scenario, width: 1280, height: 720 })
        await toolbarGeometry(page, { ...scenario, width: 1280, height: 720 })
        await page.emulate(scenario)
        await toolbarGeometry(page, scenario)
      }
      await tap(page, '[data-testid=broadcast-server-LESTA]', scenario.touch)
      await page.waitForValue('!!document.querySelector("[data-testid=broadcast-no-seasons]")', Boolean)
      assert.equal(await page.evaluate('new URLSearchParams(location.search).get("lbServer")'), 'LESTA', 'fifth server remains reachable in the segmented bar')
      await tap(page, '[data-testid=broadcast-server-CN]', scenario.touch)
      const seasonName = scenario.locale === 'zh' ? db.seasons[0].nameZh : db.seasons[0].nameEn
      await page.waitForValue('document.querySelector("[data-testid=broadcast-season-select]")?.selectedOptions[0]?.textContent', value => value?.includes(seasonName))
      await page.waitForValue('document.querySelector("[data-testid=broadcast-round-30]")?.getAttribute("aria-pressed")', value => value === 'true')
      assert.equal(await page.evaluate('document.querySelectorAll("[data-testid^=broadcast-stage-]").length'), 3, 'stages are tabs')
      assert.equal(await page.evaluate('document.querySelectorAll("button[data-testid^=broadcast-round-]").length'), 3, 'points rounds are listed beside the video grid')
      assert.equal(await page.evaluate('!!document.querySelector("[data-testid^=broadcast-new-node-]")'), false, 'anonymous mutation hidden')
      await page.waitForValue('!!document.querySelector("[data-testid=broadcast-replay-40]")', Boolean)
      await geometry(page)
      assert.equal(await page.evaluate('document.querySelector("[data-testid=broadcast-replay-40] a")?.getAttribute("rel")'), 'noopener noreferrer')
      const groupLabel = scenario.locale === 'zh' ? '第7组' : scenario.locale === 'ru' ? 'Группа 7' : 'Group 7'
      assert.ok(await page.evaluate(`document.querySelector('[data-testid=broadcast-replay-40]').textContent.includes(${JSON.stringify(groupLabel)})`), 'group number follows the UI language')
      assert.equal(await page.evaluate('document.querySelector("[data-testid=broadcast-display-time-zone]").value'), 'server')
      await page.waitForValue('document.querySelector("[data-testid=broadcast-replay-40]").textContent', value => value.includes('19:00') && value.includes('UTC+8'))
      if (screenshots && ['summer-desktop', 'winter-mobile'].includes(scenario.name)) {
        await mkdir(screenshots, { recursive: true })
        const image = await chrome.client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId)
        await writeFile(join(screenshots, `${scenario.name}.png`), Buffer.from(image.data, 'base64'))
      }
      await fill(page, { 'broadcast-display-time-zone': 'UTC' })
      await page.waitForValue('document.querySelector("[data-testid=broadcast-replay-40]").textContent', value => value.includes('11:00 UTC'))
      await geometry(page)
      if (!scenario.geometryOnly) {
        await page.goto(`${origin}/?view=league-broadcasts&lbServer=CN&ws-auth=1&ws-roles=wotbtools-admin`)
        await tap(page, '[data-testid=broadcast-edit-season-10]', scenario.touch)
        assert.deepEqual(await page.evaluate(`['zh', 'en', 'ru'].map(language => { const input = document.querySelector('[data-testid=broadcast-season-name-' + language + ']'); return { required: input.required, maxLength: input.maxLength }; })`), [
          { required: true, maxLength: 100 }, { required: true, maxLength: 100 }, { required: false, maxLength: 100 },
        ])
        await fill(page, { 'broadcast-season-name-zh': ' 更新赛事 ', 'broadcast-season-name-en': ' Updated tournament ', 'broadcast-season-name-ru': ' ' })
        await tap(page, '[data-testid=broadcast-structure-save]', scenario.touch)
        await page.waitForValue('!document.querySelector("[data-testid=broadcast-season-name-zh]")', Boolean)
        assert.equal(db.seasons[0].nameZh, '更新赛事')
        assert.equal(db.seasons[0].nameEn, 'Updated tournament')
        assert.equal(db.seasons[0].nameRu, null)
        await page.waitForValue('!!document.querySelector("[data-testid=broadcast-node-menu-30]")', Boolean)
        await geometry(page)
        if (screenshots && ['summer-desktop', 'winter-mobile'].includes(scenario.name)) {
          await page.evaluate('window.scrollTo(0, 0)')
          const image = await chrome.client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId)
          await writeFile(join(screenshots, `${scenario.name}-admin.png`), Buffer.from(image.data, 'base64'))
        }
        await fill(page, { 'broadcast-display-time-zone': 'UTC' })
        await tap(page, '[data-testid=broadcast-new-replay-30]', scenario.touch)
        assert.equal(await page.evaluate('document.querySelector("[data-testid=broadcast-input-time-zone]").value'), '480', 'editor defaults to UTC+8 independently of viewer')
        assert.equal(await page.evaluate('document.querySelector("[data-testid=broadcast-group-number]").required'), false, 'group is optional')
        await fill(page, { 'broadcast-title': 'Created in browser', 'broadcast-url': 'https://example.org/new', 'broadcast-date': '2026-10-16', 'broadcast-time': '19:15:30.125', 'broadcast-day': 7, 'broadcast-team-0': 'Followed', 'broadcast-team-1': 'Other', 'broadcast-group-number': 12 })
        await fill(page, { 'broadcast-input-time-zone': '0' })
        await page.waitForValue('document.querySelector("[data-testid=broadcast-time]").value', value => value === '11:15:30.125')
        await fill(page, { 'broadcast-input-time-zone': '480' })
        await page.waitForValue('document.querySelector("[data-testid=broadcast-time]").value', value => value === '19:15:30.125')
        db.failNext = true
        await tap(page, '[data-testid=broadcast-replay-save]', scenario.touch)
        await page.waitForValue('document.querySelectorAll("[data-testid=broadcast-replay-dialog] [role=alert]").length', value => value > 0)
        assert.equal(await page.evaluate('document.querySelector("[data-testid=broadcast-title]").value'), 'Created in browser', 'failed save retains draft')
        assert.equal(await page.evaluate('!!document.querySelector("[data-testid=broadcast-round-30]")'), true, 'failed mutation retains public tree')
        await fill(page, { 'broadcast-title': 'Corrected in browser' })
        await tap(page, '[data-testid=broadcast-replay-save]', scenario.touch)
        await page.waitForValue('!document.querySelector("[data-testid=broadcast-replay-dialog]")', Boolean)
        const replayId = db.nodes[0].replays.at(-1).id
        assert.equal(db.nodes[0].replays.at(-1).groupNumber, 12, 'points groups are not limited to 1 through 4')
        assert.equal(Object.hasOwn(db.nodes[0].replays.at(-1), 'groupLabel'), false)
        assert.equal(db.replayStarts[replayId], '2026-10-16T11:15:30.125Z')
        await tap(page, `[data-testid=broadcast-edit-replay-${replayId}]`, scenario.touch)
        db.seasons[0].version++
        await tap(page, '[data-testid=broadcast-replay-save]', scenario.touch)
        await page.waitForValue('!!document.querySelector("[data-testid=broadcast-editor-reload]")', Boolean)
        await tap(page, '[data-testid=broadcast-editor-reload]', scenario.touch)
        await page.waitForValue('!!document.querySelector("[data-testid=broadcast-replay-dialog]") && !document.querySelector("[data-testid=broadcast-editor-reload]")', Boolean)
        await fill(page, { 'broadcast-title': 'Updated after conflict', 'broadcast-group-number': '', 'broadcast-time': '' })
        await tap(page, '[data-testid=broadcast-replay-save]', scenario.touch)
        await page.waitForValue('!document.querySelector("[data-testid=broadcast-replay-dialog]")', Boolean)
        assert.equal(db.nodes[0].replays.at(-1).title, 'Updated after conflict')
        assert.equal(db.nodes[0].replays.at(-1).groupNumber, null)
        assert.equal(db.replayStarts[replayId], null)
        const dateOnlyText = await page.evaluate(`document.querySelector('[data-testid="broadcast-replay-${replayId}"]').textContent`)
        assert.doesNotMatch(dateOnlyText, /UTC|00:00|Group number pending|组号待补|Номер группы не указан/)
        assert.ok(dateOnlyText.includes('2026-10-16'))
        await tap(page, `[data-testid=broadcast-delete-replay-${replayId}]`, scenario.touch)
        await tap(page, '[data-testid=confirm-ok]', scenario.touch)
        await page.waitForValue(`!document.querySelector('[data-testid="broadcast-replay-${replayId}"]')`, Boolean)
        assert.equal(db.nodes[0].replays.length, 1)
        await tap(page, '[data-testid=broadcast-category-menu-20]', scenario.touch)
        await geometry(page)
        await tap(page, '[data-testid=broadcast-delete-category-20]', scenario.touch)
        await tap(page, '[data-testid=confirm-cancel]', scenario.touch)
        assert.equal(db.categories.some(category => category.id === 20), true, 'cancel preserves the complete category')
        await tap(page, '[data-testid=broadcast-category-menu-20]', scenario.touch)
        await tap(page, '[data-testid=broadcast-delete-category-20]', scenario.touch)
        db.seasons[0].version++
        await tap(page, '[data-testid=confirm-ok]', scenario.touch)
        await page.waitForValue('!!document.querySelector("[data-testid=league-broadcasts-page] [role=alert]")', Boolean)
        assert.equal(db.categories.some(category => category.id === 20), true, 'stale confirmation cannot delete')
        await tap(page, '[data-testid=broadcast-category-menu-20]', scenario.touch)
        await tap(page, '[data-testid=broadcast-delete-category-20]', scenario.touch)
        await tap(page, '[data-testid=confirm-ok]', scenario.touch)
        await page.waitForValue('!document.querySelector("[data-testid=broadcast-category-20]")', Boolean)
        assert.equal(db.nodes.some(node => node.categoryId === 20), false, 'whole-category deletion removes every round')
        assert.equal(db.nodes.some(node => node.categoryId === 21), true, 'other categories remain')
        await tap(page, '[data-testid=broadcast-stage-22]', scenario.touch)
        await tap(page, '[data-testid=broadcast-node-menu-34]', scenario.touch)
        await tap(page, '[data-testid=broadcast-delete-node-34]', scenario.touch)
        await tap(page, '[data-testid=confirm-ok]', scenario.touch)
        await page.waitForValue('!!document.querySelector("[data-testid=broadcast-new-node-22]")', Boolean)
        await tap(page, '[data-testid=broadcast-category-menu-22]', scenario.touch)
        await tap(page, '[data-testid=broadcast-delete-category-22]', scenario.touch)
        await tap(page, '[data-testid=confirm-ok]', scenario.touch)
        await page.waitForValue('!document.querySelector("[data-testid=broadcast-category-22]")', Boolean)
        await tap(page, '[data-testid=broadcast-new-replay-33]', scenario.touch)
        await page.evaluate('window.__wsAuth.tokenParsed.value={realm_access:{roles:[]}}')
        await page.waitForValue('!document.querySelector("[data-testid=broadcast-replay-dialog]") && !document.querySelector("[data-testid^=broadcast-new-node-]")', Boolean)
        await page.waitForValue('!!document.querySelector("[data-testid=broadcast-round-panel-33]")', Boolean)
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
