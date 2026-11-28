import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'


const DESKTOP_WINDOW = '--window-size=1440,900'
const DESKTOP_POINTER = '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'
const HOME_READY = `!!document.querySelector('.home-hero-line') && !!document.querySelector('[data-testid=home-version-diff]')`

function homeMotionProbe() {
  const read = (selector) => {
    const element = document.querySelector(selector)
    if (!element) return null
    const style = getComputedStyle(element)
    return {
      transitionProperty: style.transitionProperty,
      animationName: style.animationName,
      transitionDuration: style.transitionDuration,
      transform: style.transform,
    }
  }
  return {
    viewport: { width: innerWidth, height: innerHeight },
    media: {
      hover: matchMedia('(hover: hover)').matches,
      fine: matchMedia('(pointer: fine)').matches,
      reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
      noPreference: matchMedia('(prefers-reduced-motion: no-preference)').matches,
    },
    line: read('.home-hero-line'),
    updateArrow: read('.home-update-link > svg:last-child'),
    ctaArrow: read('.home-download-arrow'),
  }
}

const durationSeconds = (value) => Math.max(0, ...(value || '').split(',').map((part) => parseFloat(part) || 0))
const hasTransition = (state) => Boolean(state) && state.transitionProperty !== 'none' && durationSeconds(state.transitionDuration) > 0
const check = (failures, ok, message) => { if (!ok) failures.push(message) }

async function setMotionPreference(chrome, sessionId, value) {
  await chrome.client.send('Emulation.setEmulatedMedia', {
    media: '',
    features: [{ name: 'prefers-reduced-motion', value }],
  }, sessionId)
}

async function openHome(env, motion) {
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  await page.enable()
  await setMotionPreference(env.chrome, sessionId, motion)
  await page.goto(`${env.origin}/?view=home&assets=${encodeURIComponent(env.origin)}`)
  await page.waitForValue(HOME_READY, Boolean, { label: 'homepage ready' })
  return { page, targetId }
}

async function hover(page, selector) {
  const point = await page.evaluate(`(async () => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return null
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
    await frame()
    await Promise.all(document.getAnimations().filter((animation) => animation.timeline === document.timeline && Number.isFinite(animation.effect?.getComputedTiming().endTime)).map((animation) => animation.finished.catch(() => {})))
    await frame()
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  if (!point) throw new Error(`hover target not found: ${selector}`)
  await page.client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }, page.sessionId)
  await page.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
}

async function runReducedMotion(env) {
  const failures = []
  const { page, targetId } = await openHome(env, 'reduce')
  try {
    const before = await page.probe(homeMotionProbe)
    check(failures, before.media.reduce === true, 'Emulation.setEmulatedMedia did not enable reduce')
    check(failures, before.viewport.width >= 1200, `desktop viewport required for hover regression (got width ${before.viewport.width})`)
    check(failures, before.media.hover === true && before.media.fine === true, `desktop hover/fine pointer capability missing (hover=${before.media.hover}, fine=${before.media.fine})`)
    check(failures, before.updateArrow?.transform === 'none', 'reduce: version arrow must start untransformed')
    check(failures, !hasTransition(before.updateArrow), 'reduce: version arrow must have no transition')
    check(failures, !hasTransition(before.ctaArrow), 'reduce: download arrow must have no transition')
    check(failures, before.line?.animationName === 'none', 'reduce: hero entrance must be disabled')

    await hover(page, '.home-update-link')
    const afterUpdate = await page.probe(homeMotionProbe)
    check(failures, afterUpdate.updateArrow?.transform === before.updateArrow?.transform, 'reduce: version card hover must not move the arrow')

    await hover(page, '.home-cta')
    const afterCta = await page.probe(homeMotionProbe)
    check(failures, afterCta.ctaArrow?.transform === before.ctaArrow?.transform, 'reduce: CTA hover must not translate the arrow')

  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  return failures
}

async function runMotionEnabled(env) {
  const failures = []
  const { page, targetId } = await openHome(env, 'no-preference')
  try {
    const before = await page.probe(homeMotionProbe)
    check(failures, before.media.noPreference === true, 'Emulation.setEmulatedMedia did not enable no-preference')
    check(failures, before.viewport.width >= 1200, `desktop viewport required for hover regression (got width ${before.viewport.width})`)
    check(failures, before.media.hover === true && before.media.fine === true, `desktop hover/fine pointer capability missing (hover=${before.media.hover}, fine=${before.media.fine})`)
    check(failures, before.line?.animationName?.startsWith('home-rise'), 'hero entrance should remain enabled')
    const cover = await page.probe(fullPageCoverProbe)
    check(failures, cover.coverBehindVersion && cover.reachesFooter, 'desktop cover should span the content through the version card')
    check(failures, cover.statsExposeCover, 'desktop statistics should leave the cover visible')
    check(failures, hasTransition(before.updateArrow), 'no-preference: version arrow must keep its hover transition')

    await hover(page, '.home-update-link')
    await page.waitForValue(
      `getComputedStyle(document.querySelector('.home-update-link > svg:last-child')).transform`,
      transform => transform !== 'none',
      { timeout: 3000, label: 'no-preference: version card hover translates arrow' },
    )

    await hover(page, '.home-cta')
    await page.waitForValue(
      `getComputedStyle(document.querySelector('.home-download-arrow')).transform`,
      (transform) => transform !== 'none',
      { timeout: 3000, label: 'no-preference: CTA hover translate' },
    )
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  return failures
}



const THEMES = ['summer', 'spring', 'autumn', 'winter']

function glassProbe() {
  const card = document.querySelector('.home-update-link')
  if (!card) return null
  const style = getComputedStyle(card)
  const resolveToken = (token) => {
    const probe = document.createElement('div')
    probe.style.display = 'none'
    probe.style.background = `var(${token})`
    document.body.append(probe)
    const value = getComputedStyle(probe).backgroundColor
    probe.remove()
    return value
  }
  return {
    media: {
      reducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
      supportedTransparency: matchMedia('(prefers-reduced-transparency)').media !== 'not all',
      contrastMore: matchMedia('(prefers-contrast: more)').matches,
      supportedContrast: matchMedia('(prefers-contrast)').media !== 'not all',
    },
    background: style.backgroundColor,
    backdrop: style.backdropFilter,
    border: style.borderTopColor,
    opaque1: resolveToken('--color-surface-1'),
    opaque2: resolveToken('--color-surface-2'),
    opaque3: resolveToken('--color-surface-3'),
    borderStrong: resolveToken('--color-border-strong'),
    glass: [1, 2, 3].map((tier) => {
      const probe = document.createElement('div')
      probe.className = `surface-glass-${tier}`
      document.body.append(probe)
      const computed = getComputedStyle(probe)
      const state = { background: computed.backgroundColor, border: computed.borderColor, backdrop: computed.backdropFilter }
      probe.remove()
      return state
    }),
    theme: document.documentElement.dataset.uiProfile || 'summer(default)',
  }
}

const rgbaAlpha = (rgb) => {
  const match = /rgba\(([^)]+)\)/.exec(rgb || '')
  if (!match) return 1
  return Number(match[1].trim().split(/\s+/)[3] ?? 1)
}

async function setPreferences(chrome, sessionId, features) {
  await chrome.client.send('Emulation.setEmulatedMedia', { media: '', features }, sessionId)
}

async function runGlassAccessibility(env) {
  const failures = []
  const { page, targetId } = await openHome(env, 'no-preference')
  const probe = async () => page.probe(glassProbe)
  const gate = (ok, message) => { if (!ok) failures.push(message) }
  try {
    const P = (name, value) => [{ name, value }]

    await setPreferences(env.chrome, page.sessionId, [])
    let state = await probe()
    gate(state.media.reducedTransparency === false && state.media.contrastMore === false, 'default: emulation did not clear preferences')
    gate(rgbaAlpha(state.background) < 1, `default: glass background must stay translucent (got ${state.background})`)
    gate(state.backdrop.includes('blur(16px)'), `default: glass must keep backdrop blur (got ${state.backdrop})`)
    const defaultSummer = state

    await setPreferences(env.chrome, page.sessionId, P('prefers-reduced-transparency', 'reduce'))
    state = await probe()
    gate(state.media.supportedTransparency, 'prefers-reduced-transparency unsupported in this browser: scenario UNVERIFIED, cannot gate')
    gate(state.media.reducedTransparency === true, 'emulation did not enable prefers-reduced-transparency: reduce')
    gate(state.backdrop === 'none', `reduce-transparency: backdrop-filter must be off (got ${state.backdrop})`)
    gate(state.background === state.opaque1, `reduce-transparency: background must equal --color-surface-1 (got ${state.background}, want ${state.opaque1})`)
    for (const tier of [1, 2, 3]) {
      const glass = state.glass[tier - 1]
      gate(glass.backdrop === 'none', `reduce-transparency: glass tier ${tier} backdrop-filter must be off (got ${glass.backdrop})`)
      gate(glass.background === state[`opaque${tier}`], `reduce-transparency: glass tier ${tier} background must equal --color-surface-${tier} (got ${glass.background}, want ${state[`opaque${tier}`]})`)
    }

    await setPreferences(env.chrome, page.sessionId, P('prefers-contrast', 'more'))
    state = await probe()
    gate(state.media.supportedContrast, 'prefers-contrast unsupported in this browser: scenario UNVERIFIED, cannot gate')
    gate(state.media.contrastMore === true, 'emulation did not enable prefers-contrast: more')
    gate(state.backdrop === 'none', `contrast-more: backdrop-filter must be off (got ${state.backdrop})`)
    gate(state.background === state.opaque1, `contrast-more: background must equal --color-surface-1 (got ${state.background}, want ${state.opaque1})`)
    gate(state.border === state.borderStrong, `contrast-more: border must equal --color-border-strong (got ${state.border}, want ${state.borderStrong})`)
    for (const tier of [1, 2, 3]) {
      const glass = state.glass[tier - 1]
      gate(glass.background === state[`opaque${tier}`], `contrast-more: glass tier ${tier} background must equal --color-surface-${tier} (got ${glass.background}, want ${state[`opaque${tier}`]})`)
      gate(glass.border === state.borderStrong, `contrast-more: glass tier ${tier} border must equal --color-border-strong (got ${glass.border}, want ${state.borderStrong})`)
    }

    await setPreferences(env.chrome, page.sessionId, [
      { name: 'prefers-reduced-transparency', value: 'reduce' },
      { name: 'prefers-contrast', value: 'more' },
    ])
    state = await probe()
    gate(state.backdrop === 'none', `combined: backdrop-filter must be off (got ${state.backdrop})`)
    gate(state.background === state.opaque1, `combined: background must equal --color-surface-1 (got ${state.background}, want ${state.opaque1})`)
    gate(state.border === state.borderStrong, `combined: border must equal --color-border-strong (got ${state.border}, want ${state.borderStrong})`)

    await setPreferences(env.chrome, page.sessionId, [
      { name: 'prefers-reduced-motion', value: 'reduce' },
      { name: 'prefers-contrast', value: 'more' },
    ])
    state = await probe()
    gate(state.media.contrastMore === true, 'combined motion+contrast: emulation lost prefers-contrast')
    gate(state.background === state.opaque1, `motion+contrast: background must equal --color-surface-1 (got ${state.background}, want ${state.opaque1})`)
    gate(state.border === state.borderStrong, `motion+contrast: border must equal --color-border-strong (got ${state.border}, want ${state.borderStrong})`)

    await setPreferences(env.chrome, page.sessionId, [])
    for (const theme of THEMES) {
      await page.callWith((value) => {
        document.documentElement.dataset.uiProfile = value
        return document.documentElement.dataset.uiProfile
      }, theme)
      await page.waitForValue('document.documentElement.dataset.uiProfile', (value) => value === theme, { label: `theme switch ${theme}` })
      state = await probe()
      gate(state.theme === theme, `theme ${theme}: attribute not applied`)
      gate(rgbaAlpha(state.background) < 1, `theme ${theme} default: glass must stay translucent (got ${state.background})`)
      gate(state.backdrop === defaultSummer.backdrop, `theme ${theme} default: blur regressed (got ${state.backdrop})`)
      await setPreferences(env.chrome, page.sessionId, P('prefers-reduced-transparency', 'reduce'))
      const reduced = await probe()
      gate(reduced.background === reduced.opaque1, `theme ${theme} reduce-transparency: background must equal --color-surface-1 (got ${reduced.background}, want ${reduced.opaque1})`)
      gate(reduced.backdrop === 'none', `theme ${theme} reduce-transparency: blur must be off (got ${reduced.backdrop})`)
      await setPreferences(env.chrome, page.sessionId, [])
    }
    await page.waitForValue(
      `(() => { delete document.documentElement.dataset.uiProfile; return document.documentElement.dataset.uiProfile || '' })()`,
      (value) => value === '',
      { label: 'restore default theme' },
    )
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  return failures
}


function fullPageCoverProbe() {
  const stage = document.querySelector('.home-stage')
  const version = stage.querySelector('.home-update')
  const footer = document.querySelector('.app-footer')
  const stageRect = stage.getBoundingClientRect()
  const cover = getComputedStyle(stage, '::before')
  const stats = getComputedStyle(stage.querySelector('.home-stats'))
  return {
    statsExposeCover: stats.backgroundColor === 'rgba(0, 0, 0, 0)' && stats.backdropFilter === 'none',
    coverBehindVersion: cover.backgroundImage.includes('url(') && cover.backgroundSize.includes('cover') &&
      Math.abs(parseFloat(cover.height) - stageRect.height) <= 1 && version.getBoundingClientRect().bottom <= stageRect.bottom,
    reachesFooter: Math.abs(stageRect.bottom - footer.getBoundingClientRect().top) <= 1 &&
      footer.getBoundingClientRect().bottom >= innerHeight - 1,
  }
}

async function runMobileNavigation(env) {
  const failures = []
  const { page, targetId } = await openHome(env, 'reduce')
  try {
    await page.emulate({ width: 390, height: 844 })
    await page.waitForValue(`document.querySelector('[data-testid=home-update-versions]')?.textContent.trim()`,
      value => value === '11.21.0_1 → 11.22.0', { label: 'latest comparison shown' })
    const cover = await page.probe(fullPageCoverProbe)
    check(failures, cover.coverBehindVersion && cover.reachesFooter, 'mobile cover should span the content through the version card')
    check(failures, cover.statsExposeCover, 'mobile statistics should leave the cover visible')
    const layout = await page.probe(() => {
      return {
        brandVisible: document.querySelector('.home-hero-line')?.textContent.includes('WotbTools'),
        updateIsLast: document.querySelector('.home-stage').lastElementChild?.matches('.home-update'),
        hasOverflow: document.documentElement.scrollWidth > innerWidth,
        updateFollowsHero: document.querySelector('[data-testid=home-hero]').nextElementSibling?.matches('.home-update'),
      }
    })
    check(failures, layout.brandVisible, 'mobile homepage should show WotbTools in the main heading')
    check(failures, layout.updateIsLast, 'version changes should end the homepage')
    check(failures, !layout.hasOverflow, 'mobile homepage should fit the viewport')
    check(failures, layout.updateFollowsHero, 'version link should immediately follow the hero')
    await page.tapSelector('[data-testid=home-version-diff]')
    await page.waitForValue(
      `Object.fromEntries(new URLSearchParams(location.search))`,
      query => query.view === 'agent-version-diff' && query.from === '11.21.0_1' && query.to === '11.22.0',
      { label: 'version changes links to the displayed comparison' },
    )
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  return failures
}

const chromeBinary = findChrome()
const comparison = (from, to) => ({
  id: `${from}__${to}`, path: `${from}__${to}`,
  from: { dataset: from, release: `${from}-fixture` },
  to: { dataset: to, release: `${to}-fixture` },
  counts: {},
})
const middleware = (request, response, next) => {
  const path = request.url?.split('?')[0]
  if (request.method === 'GET' && path === '/api/hof') {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ items: [], page: 1, size: 1, totalItems: 0, totalPages: 0 }))
    return
  }
  if (request.method !== 'GET' || path !== '/diffs/index.json') { next(); return }
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ schema: 1, pairs: [comparison('11.21.0', '11.21.0_1'), comparison('11.21.0_1', '11.22.0')] }))
}
const { server, origin } = await startFixtureServer({ middleware })
let chromeCdp = null
const results = []
try {
  chromeCdp = await launchChromeForCdp(chromeBinary, {
    extraArgs: [
      DESKTOP_WINDOW,
      DESKTOP_POINTER,
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  })
  const env = { origin, chrome: chromeCdp }
  for (const [name, run] of [['home-reduced-motion', runReducedMotion], ['home-motion-enabled', runMotionEnabled], ['home-glass-accessibility', runGlassAccessibility], ['home-mobile-navigation', runMobileNavigation]]) {
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
    console.log(`[browser-home] ${result.name} OK`)
    continue
  }
  failed += 1
  console.error(`[browser-home] ${result.name} FAILED`)
  for (const failure of result.failures) console.error(`  - ${failure}`)
}
if (failed > 0) {
  process.exitCode = 1
  console.error(`[browser-home] ${failed}/${results.length} scenarios failed`)
} else {
  console.log(`[browser-home] all ${results.length} scenarios passed`)
}
