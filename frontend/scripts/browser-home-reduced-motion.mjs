import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

/**
 * 首页 reduced-motion 浏览器门禁。
 *
 * 为什么必须是真实浏览器：reduce 下「动画没跑」不是源码里有没有 animation 字符串，
 * 而是媒体查询命中后 computed animation/transition 是否归零、hover 是否真的不产生
 * transform。happy-dom / 正则源码断言看不到媒体查询与真实层叠（frontend/AGENTS.md）。
 *
 * 复用 browser-page.mjs（CDP 页面壳）与 fixture-server.mjs（真实 Vite 应用 + auth stub），
 * 不另起浏览器框架；只替换 /api/hof 为确定性的空页，避免首页数据带请求真实后端。
 */

const VIEWPORT = { width: 1280, height: 900, touch: false, deviceScaleFactor: 1 }
const HOME_READY = `document.querySelectorAll('.home-shot').length >= 4 && !!document.querySelector('.home-hero-line')`

/** 跨进程序列化执行：返回首页关键元素在真实浏览器里的 computed motion 状态。 */
function homeMotionProbe() {
  const read = (selector) => {
    const element = document.querySelector(selector)
    if (!element) return null
    const style = getComputedStyle(element)
    return {
      animationName: style.animationName,
      animationDuration: style.animationDuration,
      transitionProperty: style.transitionProperty,
      transitionDuration: style.transitionDuration,
      animationRange: style.animationRange,
      transform: style.transform,
    }
  }
  return {
    supports: {
      viewTimeline: CSS.supports('animation-timeline: view()'),
      scrollTimeline: CSS.supports('animation-timeline: scroll()'),
    },
    media: {
      hover: matchMedia('(hover: hover)').matches,
      reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
      noPreference: matchMedia('(prefers-reduced-motion: no-preference)').matches,
    },
    line: read('.home-hero-line'),
    accent: read('.home-hero-line.is-accent'),
    subtitle: read('.home-hero-subtitle'),
    heroInner: read('.home-hero-inner'),
    shot: read('.home-shot'),
    figure: read('.home-shot-figure'),
    image: read('.home-shot-figure img'),
    decor: read('.home-hero-decor'),
    ctaArrow: read('.home-cta svg'),
  }
}

const durationSeconds = (value) => Math.max(0, ...(value || '').split(',').map((part) => parseFloat(part) || 0))
const hasAnimation = (state) => Boolean(state) && state.animationName !== 'none' && durationSeconds(state.animationDuration) > 0
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
  await page.emulate(VIEWPORT)
  await setMotionPreference(env.chrome, sessionId, motion)
  await page.goto(`${env.origin}/`)
  await page.waitForValue(HOME_READY, (ready) => ready === true, { label: 'homepage showcase ready' })
  // 图片加载完成后再测 hover，避免布局在 hover 坐标采集中变化。
  await page.waitForValue(
    `[...document.querySelectorAll('.home-shot-figure img')].every((img) => img.complete)`,
    (ready) => ready === true,
    { label: 'showcase images loaded' },
  )
  return { page, targetId }
}

async function hover(page, selector) {
  const point = await page.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return null
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
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
    check(failures, before.media.hover === true, 'desktop viewport must match (hover: hover) for hover regression')
    for (const key of ['line', 'accent', 'subtitle', 'heroInner', 'shot']) {
      check(failures, before[key]?.animationName === 'none', `reduce: ${key} must not run animation (got ${before[key]?.animationName})`)
    }
    check(failures, before.decor?.animationName === 'none', `reduce: hero decor must not run parallax (got ${before.decor?.animationName})`)
    check(failures, before.figure?.transform === 'none', `reduce: screenshot figure must start untransformed (got ${before.figure?.transform})`)
    check(failures, before.image?.transform === 'none', `reduce: screenshot image must start untransformed (got ${before.image?.transform})`)
    check(failures, before.ctaArrow?.transform === 'none', `reduce: CTA arrow must start untransformed (got ${before.ctaArrow?.transform})`)
    check(failures, durationSeconds(before.image?.transitionDuration) === 0, `reduce: screenshot image transition must be zero (got ${before.image?.transitionDuration})`)
    check(failures, durationSeconds(before.figure?.transitionDuration) === 0, `reduce: screenshot figure transition must be zero (got ${before.figure?.transitionDuration})`)

    await hover(page, '.home-shot-figure')
    const afterShot = await page.probe(homeMotionProbe)
    check(failures, afterShot.figure?.transform === before.figure?.transform, 'reduce: screenshot hover must not lift the figure')
    check(failures, afterShot.image?.transform === before.image?.transform, 'reduce: screenshot hover must not zoom the image')

    await hover(page, '.home-cta')
    const afterCta = await page.probe(homeMotionProbe)
    check(failures, afterCta.ctaArrow?.transform === before.ctaArrow?.transform, 'reduce: CTA hover must not translate the arrow')

    await page.waitForValue(
      `(() => {
        const scroller = document.scrollingElement
        if (!scroller) return null
        scroller.scrollTop = scroller.scrollHeight
        return {
          decor: getComputedStyle(document.querySelector('.home-hero-decor')).transform,
          shot: getComputedStyle(document.querySelector('.home-shot')).animationName,
        }
      })()`,
      (state) => state && state.shot === 'none' && state.decor === 'none',
      { label: 'reduce: scroll reveal and parallax stay disabled' },
    )
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
    check(failures, before.media.hover === true, 'desktop viewport must match (hover: hover) for hover regression')
    check(failures, hasAnimation(before.line), 'no-preference: hero line must keep an entrance animation')
    check(failures, hasAnimation(before.subtitle), 'no-preference: hero subtitle must keep an entrance animation')
    check(failures, before.shot?.animationName !== 'none', 'no-preference: showcase block must keep its reveal animation')
    check(failures, hasTransition(before.figure), 'no-preference: screenshot figure must keep its hover transition')
    check(failures, hasTransition(before.image), 'no-preference: screenshot image must keep its hover transition')
    check(failures, before.image?.transform === 'none', `no-preference: image must start untransformed (got ${before.image?.transform})`)
    if (before.supports.viewTimeline) {
      check(failures, before.shot?.animationName?.startsWith('home-reveal'), `no-preference: scroll reveal must be active (got ${before.shot?.animationName})`)
    }
    if (before.supports.scrollTimeline) {
      check(failures, before.decor?.animationName?.startsWith('home-parallax'), `no-preference: hero parallax must be active (got ${before.decor?.animationName})`)
      check(failures, (before.decor?.animationRange || '').includes('640px'), `no-preference: hero parallax range token must resolve (got ${before.decor?.animationRange})`)
    }

    await hover(page, '.home-shot-figure')
    await page.waitForValue(
      `getComputedStyle(document.querySelector('.home-shot-figure img')).transform`,
      (transform) => transform !== 'none',
      { timeout: 3000, label: 'no-preference: screenshot hover zoom' },
    )

    await hover(page, '.home-cta')
    await page.waitForValue(
      `getComputedStyle(document.querySelector('.home-cta svg')).transform`,
      (transform) => transform !== 'none',
      { timeout: 3000, label: 'no-preference: CTA hover translate' },
    )
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  return failures
}

/* ------------------------------------------------------------------ main */

const chromeBinary = findChrome()
const hofMiddleware = (request, response, next) => {
  const path = request.url?.split('?')[0]
  if (request.method !== 'GET' || path !== '/api/hof') { next(); return }
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ items: [], page: 1, size: 1, totalItems: 0, totalPages: 0 }))
}
const { server, origin } = await startFixtureServer({ middleware: hofMiddleware })
let chromeCdp = null
const results = []
try {
  chromeCdp = await launchChromeForCdp(chromeBinary, {
    extraArgs: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
  })
  const env = { origin, chrome: chromeCdp }
  for (const [name, run] of [['home-reduced-motion', runReducedMotion], ['home-motion-enabled', runMotionEnabled]]) {
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
