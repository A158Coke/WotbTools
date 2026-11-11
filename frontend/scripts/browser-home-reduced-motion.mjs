import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

/**
 * 首页 reduced-motion 浏览器门禁。
 *
 * 为什么必须是真实浏览器：reduce 下「动画没跑」不是源码里有没有 animation 字符串，
 * 而是媒体查询命中后 computed animation/transition 是否归零、hover 是否真的不产生
 * transform。happy-dom / 正则源码断言看不到媒体查询与真实层叠。
 *
 * 复用 browser-page.mjs（CDP 页面壳）与 fixture-server.mjs（真实 Vite 应用 + auth stub），
 * 不另起浏览器框架；只替换 /api/hof 为确定性的空页，避免首页数据带请求真实后端。
 *
 * 桌面 hover 能力必须由 fixture 显式建立：hosted headless Chrome 不保证
 * `matchMedia('(hover: hover)')` 为 true，而共享 Page.emulate() 的 device metrics /
 * touch 覆盖会重新决定 pointer capability。这里用 Blink settings 固定 fine pointer + hover，
 * 用 --window-size 固定桌面视口（> 1200 断点），并在测试开始时断言 media capability 真的成立。
 */

const DESKTOP_WINDOW = '--window-size=1440,900'
const DESKTOP_POINTER = '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'
const HOME_READY = `document.querySelectorAll('.home-feature, .home-card').length >= 4 && !!document.querySelector('.home-hero-line')`

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
    viewport: { width: innerWidth, height: innerHeight },
    media: {
      hover: matchMedia('(hover: hover)').matches,
      fine: matchMedia('(pointer: fine)').matches,
      reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
      noPreference: matchMedia('(prefers-reduced-motion: no-preference)').matches,
    },
    line: read('.home-hero-line'),
    accent: read('.home-hero-line.is-accent'),
    subtitle: read('.home-hero-subtitle'),
    heroInner: read('.home-hero-inner'),
    shot: read('.home-card'),
    figure: read('.home-card-figure'),
    image: read('.home-card-figure img'),
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
  // 不调用 Page.emulate()：桌面 viewport 由 --window-size 固定，pointer capability 由
  // --blink-settings 固定；device metrics / touch 覆盖会重新决定 (hover: hover)。
  await setMotionPreference(env.chrome, sessionId, motion)
  await page.goto(`${env.origin}/`)
  await page.waitForValue(HOME_READY, (ready) => ready === true, { label: 'homepage showcase ready' })
  // 图片加载完成后再测 hover，避免布局在 hover 坐标采集中变化。
  // 卡片截图是 lazy 且位于第二屏之后：先滚到卡片区触发加载，再回到顶部。
  await page.waitForValue(
    `(() => { document.querySelector('.home-cards')?.scrollIntoView({ block: 'center' }); return [...document.querySelectorAll('.home-card-figure img')].every((img) => img.complete) })()`,
    (ready) => ready === true,
    { label: 'showcase images loaded' },
  )
  await page.evaluate('window.scrollTo(0, 0)')
  return { page, targetId }
}

async function hover(page, selector) {
  // 滚动回首屏后，进场动画（document timeline，位移 --home-rise-travel）可能重新开始或仍在跑：
  // 先等这些有限动画结束、目标位置稳定，再取中心点；否则鼠标落在动画前的位置，:hover 打不中。
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
    for (const key of ['line', 'accent', 'subtitle', 'heroInner', 'shot']) {
      check(failures, before[key]?.animationName === 'none', `reduce: ${key} must not run animation (got ${before[key]?.animationName})`)
    }
    check(failures, before.decor?.animationName === 'none', `reduce: hero decor must not run parallax (got ${before.decor?.animationName})`)
    check(failures, before.figure?.transform === 'none', `reduce: screenshot figure must start untransformed (got ${before.figure?.transform})`)
    check(failures, before.image?.transform === 'none', `reduce: screenshot image must start untransformed (got ${before.image?.transform})`)
    check(failures, before.ctaArrow?.transform === 'none', `reduce: CTA arrow must start untransformed (got ${before.ctaArrow?.transform})`)
    check(failures, durationSeconds(before.image?.transitionDuration) === 0, `reduce: screenshot image transition must be zero (got ${before.image?.transitionDuration})`)
    check(failures, durationSeconds(before.figure?.transitionDuration) === 0, `reduce: screenshot figure transition must be zero (got ${before.figure?.transitionDuration})`)

    await hover(page, '.home-card-figure')
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
          shot: getComputedStyle(document.querySelector('.home-card')).animationName,
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
    check(failures, before.viewport.width >= 1200, `desktop viewport required for hover regression (got width ${before.viewport.width})`)
    check(failures, before.media.hover === true && before.media.fine === true, `desktop hover/fine pointer capability missing (hover=${before.media.hover}, fine=${before.media.fine})`)
    check(failures, hasAnimation(before.line), 'no-preference: hero line must keep an entrance animation')
    check(failures, hasAnimation(before.subtitle), 'no-preference: hero subtitle must keep an entrance animation')
    check(failures, before.shot?.animationName !== 'none', 'no-preference: showcase block must keep its reveal animation')
    check(failures, hasTransition(before.image), 'no-preference: screenshot image must keep its hover transition')
    check(failures, before.image?.transform === 'none', `no-preference: image must start untransformed (got ${before.image?.transform})`)
    if (before.supports.viewTimeline) {
      check(failures, before.shot?.animationName?.startsWith('home-reveal'), `no-preference: scroll reveal must be active (got ${before.shot?.animationName})`)
    }
    if (before.supports.scrollTimeline) {
      check(failures, before.decor?.animationName?.startsWith('home-parallax'), `no-preference: hero parallax must be active (got ${before.decor?.animationName})`)
      check(failures, (before.decor?.animationRange || '').includes('640px'), `no-preference: hero parallax range token must resolve (got ${before.decor?.animationRange})`)
    }

    await hover(page, '.home-card-figure')
    await page.waitForValue(
      `getComputedStyle(document.querySelector('.home-card-figure img')).transform`,
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

/* ---------------------------------------------------- glass accessibility */

/**
 * F-05 玻璃表面可访问性门禁：prefers-reduced-transparency / prefers-contrast
 * 必须在真实浏览器里验证——源码正则看不到媒体查询命中与真实层叠，
 * 且必须区分「浏览器不支持该 feature」（matchMedia 为 false）与
 * 「偏好已启用但 CSS 未生效」两种失败，不能把不支持误判为通过。
 */

const THEMES = ['summer', 'spring', 'autumn', 'winter']

function glassProbe() {
  const card = document.querySelector('.home-card')
  if (!card) return null
  const style = getComputedStyle(card)
  // 用临时元素把 token 解析成 computed 颜色，与卡片背景逐值比较。
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
    border: style.borderColor,
    opaque1: resolveToken('--color-surface-1'),
    opaque2: resolveToken('--color-surface-2'),
    opaque3: resolveToken('--color-surface-3'),
    borderStrong: resolveToken('--color-border-strong'),
    // 三个玻璃档位逐一探测（app-shell.css 是全局样式，合成元素即可命中真实层叠）：
    // reduce/contrast 降级块按档位映射 --color-surface-1/2/3 与 --color-border-strong。
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
  if (!match) return 1 // rgb() 形态即完全不透明
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

    // 1) Default：玻璃必须保持原样——半透明 + blur，未开启任何偏好。
    await setPreferences(env.chrome, page.sessionId, [])
    let state = await probe()
    gate(state.media.reducedTransparency === false && state.media.contrastMore === false, 'default: emulation did not clear preferences')
    gate(rgbaAlpha(state.background) < 1, `default: glass background must stay translucent (got ${state.background})`)
    gate(state.backdrop.includes('blur(16px)'), `default: glass must keep backdrop blur (got ${state.backdrop})`)
    const defaultSummer = state

    // 2) Reduced transparency：不透明语义表面 + blur 归零（不是只降模糊）。
    await setPreferences(env.chrome, page.sessionId, P('prefers-reduced-transparency', 'reduce'))
    state = await probe()
    gate(state.media.supportedTransparency, 'prefers-reduced-transparency unsupported in this browser: scenario UNVERIFIED, cannot gate')
    gate(state.media.reducedTransparency === true, 'emulation did not enable prefers-reduced-transparency: reduce')
    gate(state.backdrop === 'none', `reduce-transparency: backdrop-filter must be off (got ${state.backdrop})`)
    gate(state.background === state.opaque1, `reduce-transparency: background must equal --color-surface-1 (got ${state.background}, want ${state.opaque1})`)
    // 每个玻璃档位各自退化到对应的不透明表面 token（F-05，接替 glass-accessibility.test.js 的 computed 半句）。
    for (const tier of [1, 2, 3]) {
      const glass = state.glass[tier - 1]
      gate(glass.backdrop === 'none', `reduce-transparency: glass tier ${tier} backdrop-filter must be off (got ${glass.backdrop})`)
      gate(glass.background === state[`opaque${tier}`], `reduce-transparency: glass tier ${tier} background must equal --color-surface-${tier} (got ${glass.background}, want ${state[`opaque${tier}`]})`)
    }

    // 3) More contrast：不透明表面 + strong 边界，默认视觉关闭。
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

    // 4) Combined：reduce + contrast 同时开启，更强规则胜出且无 blur。
    await setPreferences(env.chrome, page.sessionId, [
      { name: 'prefers-reduced-transparency', value: 'reduce' },
      { name: 'prefers-contrast', value: 'more' },
    ])
    state = await probe()
    gate(state.backdrop === 'none', `combined: backdrop-filter must be off (got ${state.backdrop})`)
    gate(state.background === state.opaque1, `combined: background must equal --color-surface-1 (got ${state.background}, want ${state.opaque1})`)
    gate(state.border === state.borderStrong, `combined: border must equal --color-border-strong (got ${state.border}, want ${state.borderStrong})`)

    // 5) Reduced motion + contrast：玻璃规则只受 contrast 影响，不得互相踩踏。
    await setPreferences(env.chrome, page.sessionId, [
      { name: 'prefers-reduced-motion', value: 'reduce' },
      { name: 'prefers-contrast', value: 'more' },
    ])
    state = await probe()
    gate(state.media.contrastMore === true, 'combined motion+contrast: emulation lost prefers-contrast')
    gate(state.background === state.opaque1, `motion+contrast: background must equal --color-surface-1 (got ${state.background}, want ${state.opaque1})`)
    gate(state.border === state.borderStrong, `motion+contrast: border must equal --color-border-strong (got ${state.border}, want ${state.borderStrong})`)

    // 6) 四主题回归：default 保持玻璃、reduce 退化为该主题的纯色表面。
    await setPreferences(env.chrome, page.sessionId, [])
    for (const theme of THEMES) {
      await page.waitForValue(
        `(() => { document.documentElement.dataset.uiProfile = ${JSON.stringify(theme)}; return document.documentElement.dataset.uiProfile })()`,
        (value) => value === theme,
        { label: `theme switch ${theme}` },
      )
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
    extraArgs: [
      DESKTOP_WINDOW,
      DESKTOP_POINTER,
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  })
  const env = { origin, chrome: chromeCdp }
  for (const [name, run] of [['home-reduced-motion', runReducedMotion], ['home-motion-enabled', runMotionEnabled], ['home-glass-accessibility', runGlassAccessibility]]) {
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
