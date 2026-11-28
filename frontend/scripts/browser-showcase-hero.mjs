import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { FIXTURE_TANK_CACHE, FIXTURE_TANK_DATA, FIXTURE_TANK_ID } from './browser-fixtures/fixture-asset-pack.mjs'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { createAdminDirectory } from './browser-fixtures/admin-directory.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

const PROFILE_INIT_SCRIPTS = {
  spring: "localStorage.setItem('wotb-ui-profile', 'spring'); localStorage.setItem('wotb-lang', 'zh');",
  summer: "localStorage.setItem('wotb-ui-profile', 'summer'); localStorage.setItem('wotb-lang', 'zh');",
  autumn: "localStorage.setItem('wotb-ui-profile', 'autumn'); localStorage.setItem('wotb-lang', 'zh');",
  winter: "localStorage.setItem('wotb-ui-profile', 'winter'); localStorage.setItem('wotb-lang', 'zh');",
}

const WINTER_PORTRAIT_STOPS = ['rgba(238, 243, 248, 0.15)', 'rgba(238, 243, 248, 0)']
const WINTER_TITLE_COLOR = 'rgb(242, 247, 251)'

function relativeLuminance([r, g, b]) {
  const rel = c => (c /= 255) <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  return 0.2126 * rel(r) + 0.7152 * rel(g) + 0.0722 * rel(b)
}

function backgroundContrastFraction(raw, channels, textLum) {
  let pass = 0
  let total = 0
  for (let i = 0; i < raw.length; i += channels) {
    const bgLum = relativeLuminance([raw[i], raw[i + 1], raw[i + 2]])
    if ((Math.max(bgLum, textLum) + 0.05) / (Math.min(bgLum, textLum) + 0.05) >= 4.5) pass += 1
    total += 1
  }
  return total ? pass / total : 0
}

{
  const white = [255, 255, 255]
  const black = [0, 0, 0]
  const mixed = []
  for (let i = 0; i < 1000; i++) mixed.push(...(i % 9 === 0 ? black : white))
  const fraction = backgroundContrastFraction(mixed, 3, relativeLuminance([216, 230, 244]))
  assert.ok(fraction < 0.9, `contrast self-test must reject a mostly-white background: ${(fraction * 100).toFixed(1)}%`)
  const dark = []
  for (let i = 0; i < 3000; i++) dark.push(...[10, 14, 20])
  assert.equal(backgroundContrastFraction(dark, 3, relativeLuminance([216, 230, 244])), 1, 'contrast self-test must accept a uniformly dark background')
}

function heroProbe() {
  const host = document.querySelector('.showcase-hero-host.is-compact-host') ?? document.querySelector('.showcase-hero-host')
  const section = host?.querySelector('.showcase-hero')
  const art = section?.querySelector('.showcase-hero-art')
  if (!section || !art) return null
  const cs = getComputedStyle(art)
  const imageLayer = cs.backgroundImage.startsWith('url(') ? 0 : 1
  const positions = cs.backgroundPosition.split(',').map(s => s.trim())
  const rect = section.getBoundingClientRect()
  return {
    section: section.dataset.section ?? null,
    compact: section.classList.contains('is-compact'),
    height: Math.round(rect.height),
    width: rect.width,
    artWidth: art.getBoundingClientRect().width,
    gutter: rect.left - document.querySelector('main').getBoundingClientRect().left,
    topInset: rect.top - document.querySelector('main').getBoundingClientRect().top,
    contentScrim: getComputedStyle(section.querySelector('.showcase-hero-content')).backgroundImage,
    backgroundImage: cs.backgroundImage,
    imagePosition: positions[imageLayer] ?? null,
    backgroundSize: cs.backgroundSize.split(',').map(s => s.trim())[imageLayer] ?? null,
    titleColor: getComputedStyle(section.querySelector('h1')).color,
    titleBottom: Math.round(section.querySelector('h1').getBoundingClientRect().bottom),
    heroBottom: Math.round(rect.bottom),
  }
}

function fullHeroProbe() {
  const section = document.querySelector('.showcase-hero')
  const h1 = section?.querySelector('h1')
  const description = section?.querySelector('.showcase-hero-description')
  const statsLabel = section?.querySelector('.showcase-hero-stats span')
  if (!section || !h1) return null
  return {
    section: section.dataset.section ?? null,
    compact: section.classList.contains('is-compact'),
    titleColor: getComputedStyle(h1).color,
    descriptionColor: description ? getComputedStyle(description).color : null,
    descriptionShadow: description ? getComputedStyle(description).textShadow : null,
    statsLabelColor: statsLabel ? getComputedStyle(statsLabel).color : null,
  }
}

function assertDesktopCompact(hero, { section, position }) {
  assert.equal(hero.section, section, `desktop ${section} must use its section hero`)
  assert.ok(hero.compact, `desktop ${section} must render compact`)
  assert.equal(hero.imagePosition, position, `desktop ${section} compact focus must be ${position}`)
  assert.equal(hero.backgroundSize, 'cover', 'desktop image sizing for ' + section)
  assert.ok(hero.titleBottom <= hero.heroBottom, `desktop ${section} title must stay inside the banner`)
}

function assertMobileCompact(hero, { section, position }) {
  assert.equal(hero.section, section, `mobile ${section} must use its section hero`)
  assert.ok(hero.compact, `mobile ${section} must render compact`)
  assert.equal(hero.imagePosition, position, `mobile ${section} must fall back to mobilePosition ${position}`)
  assert.equal(hero.backgroundSize, 'cover', `mobile ${section} must keep cover`)
}

const screenshotDirectory = resolve('../tmp/section-heroes')
await mkdir(screenshotDirectory, { recursive: true })
const directory = createAdminDirectory()
const fixtureData = new Map([
  ['/api/users/profile', { id: 7, keycloakUserId: 'fixture-user', username: 'fixture', displayName: 'Fixture', wotbServer: 'CN', wotbAccountSource: 'MANUAL' }],
  ['/fixture-assets/data/tank_cache.json', FIXTURE_TANK_CACHE],
  ['/fixture-assets/tank/' + FIXTURE_TANK_ID + '.json', FIXTURE_TANK_DATA],
  ['/fixture-assets/index.json', { schema: 1, maps: { 26: { key: 'faust', display: 'Faust' } } }],
])
const { server, origin } = await startFixtureServer({ middleware(req, res, next) {
  if (fixtureData.has(req.url)) {
    res.setHeader('Content-Type', 'application/json')
    return res.end(JSON.stringify(fixtureData.get(req.url)))
  }
  if (req.url.startsWith('/api/admin/')) return directory.middleware(req, res, next)
  return next()
} })
let chrome
try {
  chrome = await launchChromeForCdp(findChrome())

  async function openAppPage({ width, height = 900, profile = 'summer', view, extraAuth = '', locale = 'zh', readySelector = '[data-testid="showcase-hero"]' }) {
    const { targetId, sessionId } = await chrome.openPage()
    const page = new Page(chrome.client, sessionId)
    await page.enable()
    await page.emulate({ width, height, touch: width < 1200, deviceScaleFactor: 1 })
    const initScript = PROFILE_INIT_SCRIPTS[profile]
    if (!initScript) throw new Error(`unknown UI profile: ${profile}`)
    await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: initScript + `localStorage.setItem('wotb-lang',${JSON.stringify(locale)})`,
    }, sessionId)
    await chrome.client.send('Page.navigate', { url: `${origin}/?view=${view}${extraAuth}` }, sessionId)
    await page.waitForValue('document.readyState', value => value === 'complete', { timeout: 90_000, label: 'application modules loaded' })
    await page.waitForValue(`!!document.querySelector(${JSON.stringify(readySelector)})`, Boolean, { timeout: 90_000, label: `${readySelector} on ${view}` })
    return { targetId, page }
  }

  // Exercise the real routes so a page-specific thumbnail or missing gutter fails here.
  for (const [section, views] of Object.entries({
    tankopedia: ['agent-tankopedia'],
    maps: ['map-preview'],
    community: ['recommendations', 'creators', 'recommended-videos', 'contact', 'more', 'android', 'sponsor'],
    admin: ['admin-battle-data', 'admin-ai-review-feedback', 'admin-site-feedback', 'admin-users', 'creators-config', 'hof-admin', 'tournament-points-admin', 'tournament-points-config'],
    replay: ['replay'],
    hof: ['hof', 'hof&tab=hundred'],
    mark3: ['hof&tab=mark3'],
    docs: ['history', 'technical-evolution', 'rating-docs'],
    events: ['league-broadcasts', 'tournament-points'],
    profile: ['profile'],
  })) {
    for (const view of views) {
      const { targetId, page } = await openAppPage({ width: 1440, profile: 'winter', view, extraAuth: '&ws-auth=1&ws-roles=wotbtools-admin,content-admin,tournament-admin&assets=' + encodeURIComponent(origin + '/fixture-assets') })
      try {
        await page.waitForValue("document.querySelector('.showcase-hero')?.dataset.section", value => value === section)
        const hero = await page.probe(heroProbe)
        assert.equal(hero.height, 480, view + ' expanded height')
        assert.ok(Math.abs(hero.artWidth - hero.width) <= 2, `${view} art width ${hero.artWidth} of ${hero.width}`)
        assert.equal(hero.backgroundSize, 'cover', view)
        assert.match(hero.backgroundImage, /^url\(/, view + ' clear artwork')
        assert.match(hero.contentScrim, /linear-gradient/, view + ' text contrast')
        assert.equal(hero.titleColor, WINTER_TITLE_COLOR, view)
        if (view === 'map-preview') {
          assert.ok(hero.topInset >= 16 && hero.gutter >= 16, 'map picker must have page gutters')
          await page.waitForValue("!!document.querySelector('[data-testid=map-search]')", Boolean)
        }
        if (view === 'agent-tankopedia') await page.waitForValue("!!document.querySelector('[data-testid=tankopedia-count]')", Boolean)
        await page.evaluate('document.fonts.ready')
        await page.probe(async () => {
          const img = new Image()
          img.src = getComputedStyle(document.querySelector('.showcase-hero-art')).getPropertyValue('--hero-image').trim().replace(/^url\(["']?|["']?\)$/g, '')
          await img.decode()
        })
        const shot = await chrome.client.send('Page.captureScreenshot', { format: 'webp', quality: 80 }, page.sessionId)
        await writeFile(resolve(screenshotDirectory, view.replaceAll('&', '-') + '.webp'), Buffer.from(shot.data, 'base64'))
        await page.emulate({ width: 390, height: 844, touch: true, deviceScaleFactor: 1 })
        const mobile = await page.probe(heroProbe)
        assert.ok(mobile.width > 0 && mobile.width <= 390 && mobile.height > 0, view + ' mobile banner bounds')
        assert.ok(mobile.titleBottom <= mobile.heroBottom, view + ' mobile title bounds')
        console.log('[browser-showcase-hero] ' + view + ' desktop and mobile passed')
      } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
    }
  }

  {
    const { targetId, page } = await openAppPage({
      width: 1440,
      view: 'agent-tankopedia&tank=' + FIXTURE_TANK_ID,
      extraAuth: '&assets=' + encodeURIComponent(origin + '/fixture-assets'),
      readySelector: '.tp-detail-head h1',
    })
    const assertTankDetailHeader = async () => {
      const detail = await page.probe(() => {
        const root = document.querySelector('[data-testid="tankopedia"]')
        const head = root.querySelector('.tp-detail-head')
        return {
          titles: [...root.querySelectorAll('h1')].filter(node => node.getClientRects().length).map(node => node.textContent),
          bannerVisible: !!root.querySelector('.showcase-hero')?.getClientRects().length,
          cover: !!head.querySelector('.tp-media > img'),
          bottom: head.getBoundingClientRect().bottom,
          viewport: innerHeight,
        }
      })
      assert.deepEqual(detail.titles, [FIXTURE_TANK_DATA.name])
      assert.equal(detail.bannerVisible, false)
      assert.ok(detail.cover && detail.bottom < detail.viewport / 2, JSON.stringify(detail))
    }
    try {
      await page.animationsSettled()
      await assertTankDetailHeader()
      await page.emulate({ width: 390, height: 844, touch: true })
      await assertTankDetailHeader()
      await page.tapSelector('[data-testid="tank-back"]', true)
      await page.waitFor(() => !!document.querySelector('.showcase-hero')?.getClientRects().length)
      await page.tapSelector('[data-testid="tank-card"][data-tank-id="' + FIXTURE_TANK_ID + '"]', true)
      await page.waitFor(() => !!document.querySelector('.tp-detail-head h1'))
      await page.animationsSettled()
      await assertTankDetailHeader()
      console.log('[browser-showcase-hero] tank detail header on deep link and list navigation passed')
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }

  for (const [view, extraAuth, section, mobilePosition, heightLo, heightHi] of [
    ['replay', '', 'replay', '45% 50%', 88, 112],
    ['admin-users', '&ws-auth=1&ws-roles=wotbtools-admin', 'admin', '40% 50%', 88, 112],
  ]) {
    const { targetId, page } = await openAppPage({ width: 1440, view, extraAuth })
    try {
      const desktop = await page.probe(heroProbe)
      assertDesktopCompact(desktop, { section, position: section === 'replay' ? '50% 50%' : '50% 45%' })
      if (section === 'admin') {
        for (const width of [900, 1280, 1890]) {
          await page.emulate({ width, height: 900, touch: false, deviceScaleFactor: 1 })
          const hero = await page.probe(heroProbe)
          assertDesktopCompact(hero, { section, position: '50% 45%' })
          assert.ok(hero.height >= Math.min(280, width * 0.28), 'users section must expand on desktop at ' + width)
          assert.ok(Math.abs(hero.artWidth - hero.width) <= 2, 'the background image must span the whole users section')
          const firstRow = await page.waitForValue('document.querySelector("[data-testid=admin-row-open]")?.getBoundingClientRect().top', Number.isFinite)
          assert.ok(firstRow < 900, 'first user row must remain in the initial viewport')
          const edges = await page.probe(() => ['.showcase-hero', '.admin-filter-bar', '.admin-list-table-wrap'].map(
            selector => document.querySelector(selector).getBoundingClientRect().right))
          assert.ok(Math.max(...edges) - Math.min(...edges) <= 1, 'users hero, filters and table must share their right edge at ' + width)
        }
      }
      await page.emulate({ width: 390, height: 844, touch: true })
      await page.waitForValue(`window.innerWidth`, value => value === 390, { timeout: 20_000, label: 'mobile viewport applied' })
      const mobile = await page.probe(heroProbe)
      assertMobileCompact(mobile, { section, position: mobilePosition })
      assert.ok(mobile.height >= heightLo && mobile.height <= heightHi, `mobile ${section} hero height must stay ${heightLo}-${heightHi}px: ${mobile.height}`)
      await page.evaluate(`localStorage.setItem('wotb-ui-profile', 'winter'); document.documentElement.setAttribute('data-ui-profile', 'winter'); document.documentElement.setAttribute('data-theme', 'light')`)
      await page.waitForValue(`getComputedStyle(document.querySelector('.showcase-hero-art')).backgroundImage`, value => value.includes(WINTER_PORTRAIT_STOPS[0]), { timeout: 20_000, label: 'winter portrait scrim' })
      const winter = await page.probe(heroProbe)
      for (const stop of WINTER_PORTRAIT_STOPS) {
        assert.ok(winter.backgroundImage.includes(stop), `mobile ${section} winter portrait scrim must contain ${stop}: ${winter.backgroundImage}`)
      }
      assert.equal(winter.titleColor, WINTER_TITLE_COLOR, `mobile ${section} winter title must switch to white: ${winter.titleColor}`)
      console.log(`[browser-showcase-hero] breakpoint ${section}: desktop pos=${desktop.imagePosition} → mobile pos=${mobile.imagePosition} height=${mobile.height}, winter scrim stops ok passed`)
    } catch (error) {
      console.error(await page.diagnose(heroProbe))
      throw error
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }

  {
    const { targetId, page } = await openAppPage({ width: 1920, height: 540, view: 'replay' })
    try {
      const hero = await page.probe(heroProbe)
      assert.ok(hero.height >= 120 && hero.height <= 140, `replay hero must fall back to compact density in short windows: ${hero.height}`)
      assert.ok(hero.titleBottom <= hero.heroBottom, 'replay title must stay inside the degraded banner')
      console.log(`[browser-showcase-hero] short-window replay: height=${hero.height} at 1920x540 passed`)
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }

  const fullTextProbe = () => {
    const section = document.querySelector('.showcase-hero')
    if (!section) return null
    const pick = sel => {
      const el = section.querySelector(sel)
      return el ? Math.round(el.getBoundingClientRect().height) : null
    }
    return {
      kickerH: pick('.showcase-hero-kicker'),
      titleH: pick('h1'),
      descriptionH: pick('.showcase-hero-description'),
      textH: Math.round(section.querySelector('.showcase-hero-text')?.getBoundingClientRect().height ?? 0),
      contentH: Math.round(section.querySelector('.showcase-hero-content')?.getBoundingClientRect().height ?? 0),
    }
  }
  for (const [view, extraAuth] of [['league-broadcasts', ''], ['hof', ''], ['tournament-points', '']]) {
    const { targetId, page } = await openAppPage({ width: 1440, view, extraAuth })
    try {
      const probe = heroProbe
      const desktop = await page.probe(probe)
      assert.ok(!desktop.compact, `desktop full hero on ${view} must not be compact`)
      assert.ok(desktop.height === 480, `desktop full hero on ${view} must use the shared section height at 1440: ${desktop.height}`)
      assert.ok(desktop.titleBottom <= desktop.heroBottom, `desktop ${view} title must stay inside the banner`)
      const text = await page.probe(fullTextProbe)
      assert.ok(text.kickerH === null || text.kickerH <= 30, `full hero kicker on ${view} must keep its natural row height (grid rows must not stretch): ${text.kickerH}`)
      assert.ok(text.titleH <= 90, `full hero title on ${view} must keep its natural row height (grid rows must not stretch): ${text.titleH}`)
      assert.ok(text.descriptionH === null || text.descriptionH <= 60, `full hero description on ${view} must keep its natural row height: ${text.descriptionH}`)
      assert.ok(text.textH <= text.contentH, `full hero text block on ${view} must fit inside the content grid`)
      await page.emulate({ width: 1920, height: 540, touch: false })
      await page.waitForValue(`window.innerHeight`, v => v === 540, { timeout: 20_000, label: 'short window applied' })
      const short = await page.probe(probe)
      assert.ok(short.height <= 260, `full hero on ${view} must fall back to content height in short windows: ${short.height}`)
      assert.ok(short.titleBottom <= short.heroBottom, `short-window ${view} title must stay inside the banner`)
      await page.emulate({ width: 390, height: 844, touch: true })
      await page.waitForValue(`window.innerWidth`, v => v === 390, { timeout: 20_000, label: 'mobile viewport applied' })
      const mobile = await page.probe(probe)
      assert.ok(mobile.height <= 280, `mobile full hero on ${view} must keep the portrait density: ${mobile.height}`)
      console.log(`[browser-showcase-hero] full-hero height ${view}: desktop=${desktop.height} short=${short.height} mobile=${mobile.height} kicker=${text.kickerH} title=${text.titleH} desc=${text.descriptionH} passed`)
    } catch (error) {
      console.error(await page.diagnose(heroProbe))
      throw error
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }

  {
    const { targetId, page } = await openAppPage({ width: 390, height: 844, profile: 'winter', view: 'contact' })
    try {
      const hero = await page.probe(fullHeroProbe)
      assert.equal(hero.descriptionColor, 'rgb(216, 230, 244)', `winter full hero description must switch to light: ${hero.descriptionColor}`)
      assert.ok(hero.descriptionShadow.includes('rgba(4, 10, 18'), `winter full hero description must keep its dark text-shadow: ${hero.descriptionShadow}`)
      assert.equal(hero.titleColor, WINTER_TITLE_COLOR, `winter full hero title must switch to white: ${hero.titleColor}`)
      const rect = await page.evaluate(`(() => { const el = document.querySelector('.showcase-hero-description'); el.style.visibility = 'hidden'; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
      const { data } = await chrome.client.send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 2 } }, page.sessionId)
      await page.evaluate(`(() => { document.querySelector('.showcase-hero-description').style.visibility = '' })()`)
      const { default: sharp } = await import('sharp')
      const { info, data: raw } = await sharp(Buffer.from(data, 'base64')).raw().toBuffer({ resolveWithObject: true })
      const textLum = relativeLuminance([216, 230, 244])
      const lums = []
      for (let i = 0; i < raw.length; i += info.channels) lums.push(relativeLuminance([raw[i], raw[i + 1], raw[i + 2]]))
      lums.sort((a, b) => a - b)
      const medianLum = lums[Math.floor(lums.length / 2)]
      const medianRatio = (Math.max(medianLum, textLum) + 0.05) / (Math.min(medianLum, textLum) + 0.05)
      const passFraction = backgroundContrastFraction(raw, info.channels, textLum)
      assert.ok(medianRatio >= 4.5, `winter full hero description median background contrast must be >= 4.5:1: ${medianRatio.toFixed(2)}:1`)
      assert.ok(passFraction >= 0.8, `winter full hero description contrast must hold over >=80% of its area (unfavorable bright area <=20%): ${(passFraction * 100).toFixed(1)}%`)
      console.log(`[browser-showcase-hero] winter full hero (contact 390x844): description light + median ${medianRatio.toFixed(2)}:1 + ${(passFraction * 100).toFixed(1)}% area passed`)
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }

  {
    const { targetId, page } = await openAppPage({ width: 390, height: 844, profile: 'winter', view: 'hof' })
    try {
      const hero = await page.probe(fullHeroProbe)
      let statsLabelColor = hero.statsLabelColor
      if (!statsLabelColor) {
        statsLabelColor = await page.evaluate(`(() => {
          const section = document.querySelector('.showcase-hero')
          const content = section?.querySelector('.showcase-hero-content')
          if (!content) return null
          const scopeName = root => [...root.querySelectorAll('*')].find(el => el.getAttributeNames().some(n => n.startsWith('data-v-')))?.getAttributeNames().find(n => n.startsWith('data-v-'))
          const pageScope = scopeName(document.querySelector('.app-main') ?? document.body)
          const heroScope = [...section.attributes].find(a => a.name.startsWith('data-v-'))?.name
          const stats = document.createElement('div')
          stats.className = 'showcase-hero-stats'
          if (heroScope) stats.setAttribute(heroScope, '')
          const span = document.createElement('span')
          span.className = 'lb-hero-stat-label'
          if (pageScope) span.setAttribute(pageScope, '')
          span.textContent = 'stats'
          stats.appendChild(span)
          content.appendChild(stats)
          return getComputedStyle(span).color
        })()`)
      }
      assert.notEqual(statsLabelColor, 'rgb(59, 84, 112)', `winter full hero stat label must not stay dark: ${statsLabelColor}`)
      assert.equal(statsLabelColor, 'rgb(216, 230, 244)', `winter full hero stat label must follow the light container color: ${statsLabelColor}`)
      console.log(`[browser-showcase-hero] winter full hero (hof 390x844): stat label color=${statsLabelColor} passed`)
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }



  // 管理页文字区随标题长度扩展，长标签也要测实际底图上的最差像素。
  for (const profile of Object.keys(PROFILE_INIT_SCRIPTS)) {
    for (const width of [390, 1280]) {
      const { targetId, page } = await openAppPage({ width, profile, locale: 'en', view: 'admin-users', extraAuth: '&ws-auth=1&ws-roles=wotbtools-admin' })
      try {
        await page.waitForValue("document.querySelector('.showcase-hero-title')?.textContent", label => label === 'User Management')
        await page.waitForValue('!!document.querySelector("[data-testid=admin-row-open]")', Boolean)
        await page.evaluate('document.fonts.ready')
        await page.animationsSettled()
        for (const selector of ['.showcase-hero-title', '.showcase-hero-kicker']) {
          const sample = await page.callWith(sel => {
            const node = document.querySelector(sel)
            const style = getComputedStyle(node)
            const range = document.createRange()
            range.selectNodeContents(node)
            const rect = range.getBoundingClientRect()
            const color = style.color.match(/[\d.]+/g).map(Number)
            const large = parseFloat(style.fontSize) >= 24 || (Number(style.fontWeight) >= 700 && parseFloat(style.fontSize) >= 18.667)
            node.style.visibility = 'hidden'
            return { color, threshold: large ? 3 : 4.5, clip: { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height, scale: 1 } }
          }, selector)
          await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
          const { data } = await page.client.send('Page.captureScreenshot', { format: 'png', clip: sample.clip }, page.sessionId)
          await page.callWith(sel => { document.querySelector(sel).style.visibility = '' }, selector)
          const { default: sharp } = await import('sharp')
          const { data: pixels, info } = await sharp(Buffer.from(data, 'base64')).raw().toBuffer({ resolveWithObject: true })
          const textLum = relativeLuminance(sample.color)
          let minimum = Infinity
          for (let offset = 0; offset < pixels.length; offset += info.channels) {
            const bg = relativeLuminance(pixels.subarray(offset, offset + 3))
            minimum = Math.min(minimum, (Math.max(textLum, bg) + 0.05) / (Math.min(textLum, bg) + 0.05))
          }
          assert.ok(minimum >= sample.threshold, [profile, width, selector, minimum, sample.threshold].join(' '))
        }
      } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
    }
  }

  console.log('[browser-showcase-hero] all scenarios passed')
} finally {
  if (chrome) await chrome.close()
  await server.close()
}
