import { measureReachability } from './browser-occlusion.mjs'
import { join, resolve } from 'node:path'
import { closePageTarget, captureMobileReview, PARSE_LIFECYCLE_BRIDGE, Page, check, clickCenterExpression, clickElement, clicked, delay, fakeAnalysisOrigin, playbackControlProbe, results, sceneHitTarget, setLastPage, startFixtureServer, tapElement } from './browser-workspace-interaction-core.mjs'
import { capabilityHitProbe, capabilityLayoutProbe, capabilityStateProbe } from './browser-workspace-interaction-probes-a.mjs'

export const APP_SCENARIOS = [
  { name: 'capability-375x812-portrait-coarse', width: 375, height: 812, touch: true, authenticated: true, login: 'resolve' },
  { name: 'capability-390x844-portrait-coarse', width: 390, height: 844, touch: true, authenticated: true, login: 'resolve' },
  { name: 'capability-740x360-landscape-coarse', width: 740, height: 360, touch: true, authenticated: true, login: 'resolve' },
  { name: 'capability-1024x768-tablet', width: 1024, height: 768, touch: false, authenticated: true, login: 'resolve' },
  { name: 'capability-1600x900-desktop', width: 1600, height: 900, touch: false, authenticated: true, login: 'resolve' },
  { name: 'anonymous-390x844-coarse', width: 390, height: 844, touch: true, authenticated: false, login: 'reject' },
  { name: 'auth-init-pending-390x844-coarse', width: 390, height: 844, touch: true, authenticated: false, login: 'resolve', authInit: 'pending', authTimeout: 120_000 },
  { name: 'auth-init-reject-390x844-coarse', width: 390, height: 844, touch: true, authenticated: false, login: 'resolve', authInit: 'reject', authTimeout: 120_000 },
  { name: 'admin-1600x900-desktop', width: 1600, height: 900, touch: false, authenticated: true, login: 'resolve', roles: ['wotbtools-admin'] },
  { name: 'admin-390x844-portrait-coarse', width: 390, height: 844, touch: true, authenticated: true, login: 'resolve', roles: ['wotbtools-admin'] },
  ...['zh', 'en', 'ru'].flatMap(locale => ['summer', 'winter'].flatMap(profile => [
    { width: 320, height: 812, touch: true },
    { width: 390, height: 844, touch: true },
    { width: 767, height: 900, touch: true },
    { width: 1024, height: 900, touch: false },
    { width: 1600, height: 900, touch: false },
  ].map(viewport => ({
    ...viewport, name: `capability-wrap-${locale}-${profile}-${viewport.width}`,
    locale, profile, authenticated: true, login: 'resolve',
  })))),
]

export const AUTH_CAPABILITY_SCENARIOS = [
  { name: 'capability-normal-3d-desktop', cap: '3d', view: 'agent-replay', authenticated: true, width: 1600, height: 900, touch: false },
  { name: 'capability-normal-shots-desktop', cap: 'shots', view: 'agent-shots', authenticated: true, width: 1600, height: 900, touch: false },
  { name: 'capability-anonymous-3d-coarse', cap: '3d', view: 'agent-replay', authenticated: false, width: 390, height: 844, touch: true },
  { name: 'capability-anonymous-shots-coarse', cap: 'shots', view: 'agent-shots', authenticated: false, width: 390, height: 844, touch: true },
  { name: 'capability-normal-shots-armor-handoff', cap: 'shots', view: 'agent-shots', authenticated: true, width: 1600, height: 900, touch: false, reconstruct: true },
  { name: 'capability-normal-shots-armor-handoff-mobile', cap: 'shots', view: 'agent-shots', authenticated: true, width: 390, height: 844, touch: true, reconstruct: true },
  { name: 'capability-normal-shots-armor-handoff-tablet', cap: 'shots', view: 'agent-shots', authenticated: true, width: 1024, height: 768, touch: false, reconstruct: true },
  { name: 'capability-normal-shots-fullscreen-landscape-740x360', profile: 'summer', cap: 'shots', view: 'agent-shots', authenticated: true, width: 740, height: 360, touch: true, shotsFullscreen: true },
  ...['summer', 'winter'].map(profile => ({ name: `capability-normal-shots-armor-handoff-landscape-${profile}`, profile, cap: 'shots', view: 'agent-shots', authenticated: true, width: 740, height: 360, touch: true, reconstruct: true })),
]

export async function runAuthCapabilityScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  setLastPage(page)
  await page.enable({ profile: scenario.profile ?? 'summer' })
  await page.emulate(scenario)
  const origin = await fakeAnalysisOrigin()
  await page.goto(`${origin}/?view=replay&ws-auth=${scenario.authenticated ? 1 : 0}&ws-shot-fixture=1&assets=${encodeURIComponent(`${origin}/fixture-assets`)}`)
  await page.waitFor(() => !!document.querySelector('[data-testid="ws-data"]'), { label: 'data pane' })
  await page.evaluate(PARSE_LIFECYCLE_BRIDGE)
  await page.evaluate('window.__pbSelect("auth-capability.wotbreplay", [1, 2, 3, 4])')
  await page.installInputTrace()
  const tabCap = scenario.cap === '3d' ? 'replay' : scenario.cap
  const selector = `[data-testid="ws-tab"][data-cap="${tabCap}"]`
  const center = await page.evaluate(clickCenterExpression(selector))
  if (!center) throw new Error(`${tabCap} tab must be hit-testable`)
  await page.tap({ ...center, touch: scenario.touch })
  if (scenario.cap === '3d') {
    await page.waitFor(() => !!document.querySelector('[data-testid="viewer-mode-3d"]'), { label: '3D mode switch' })
    const tapped = await tapElement(page, '[data-testid="viewer-mode-3d"]', {
      touch: scenario.touch,
      verify: () => page.waitForValue('new URLSearchParams(location.search).get("view")', (view) => view === 'agent-replay',
        { timeout: 5000, label: '3D mode route' }),
    })
    if (!tapped) throw new Error('3D mode switch not hit-testable or tap did not change the route')
  }
  await page.waitForValue('new URLSearchParams(location.search).get("view")', (view) => view === scenario.view,
    { label: 'capability destination' })
  const trace = await page.evaluate('window.__wsInput.click')
  const traceOk = scenario.cap === '3d' ? trace?.testId === 'viewer-mode-3d' : trace?.cap === tabCap
  check(failures, traceOk, `real capability click landed on ${JSON.stringify(trace)}`)
  const paneSelector = scenario.cap === '3d' ? '.pb-root' : '[data-testid="replay-shots-pane"]'
  if (!scenario.authenticated) {
    await page.waitFor(() => !!document.querySelector('[data-testid="capability-auth-gate"]'), { label: 'login gate' })
    check(failures, !await page.evaluate(`!!document.querySelector(${JSON.stringify(paneSelector)})`),
      `anonymous ${scenario.cap} must not mount its production pane`)
    check(failures, await page.evaluate('!window.__wsShotParse || (window.__wsShotParse.playback === 0 && window.__wsShotParse.shots === 0)'),
      'anonymous capability must not begin playback or shots parsing')
    check(failures, await page.evaluate('window.__wsAuth.loginCalls.length') === 0,
      'capability navigation must not initiate login')
    const loginCenter = await page.evaluate(clickCenterExpression('[data-testid="capability-login"]'))
    if (!loginCenter) throw new Error('capability login button must be hit-testable')
    await page.tap({ ...loginCenter, touch: scenario.touch })
    const loginTrace = await page.evaluate('window.__wsInput.click')
    check(failures, loginTrace?.testId === 'capability-login', `real login click landed on ${JSON.stringify(loginTrace)}`)
    check(failures, await page.evaluate('JSON.stringify(window.__wsAuth.loginCalls)') === JSON.stringify([scenario.view]),
      `login must preserve ${scenario.view} as destination`)
    const listTrigger = await page.waitForValue(clickCenterExpression('[data-testid="collection-trigger"]'), Boolean, { label: 'collection trigger' })
    await page.tap({ ...listTrigger, touch: scenario.touch })
    await page.waitFor(() => !!document.querySelector('[data-testid="collection-row"]'), { label: 'collection rows' })
    check(failures, await page.evaluate('document.querySelector("[data-testid=collection-row]")?.title === "auth-capability.wotbreplay"'),
      'login gate must preserve the chosen replay')
  } else {
    await page.waitForValue(`!!document.querySelector(${JSON.stringify(paneSelector)})`, (present) => present === true,
      { label: 'authenticated production pane' })
    check(failures, !await page.evaluate('!!document.querySelector("[data-testid=capability-auth-gate]")'),
      'normal authenticated user must bypass login gate')
    if (scenario.cap === 'shots') {
      await page.waitFor(() => !!document.querySelector('[data-testid="shot-row-1"]'), { label: 'parsed shot row' })
      check(failures, await page.evaluate('window.__wsShotParse.playback === 1 && window.__wsShotParse.shots === 1'),
        'normal authenticated user must execute the shot parsing chain')
      check(failures, await page.evaluate(`document.querySelector('[data-testid="shots-shooter-select"]')?.value === 'own'
        && !!document.querySelector('[data-testid="shot-row-3"]') && !document.querySelector('[data-testid="shot-row-2"]')`),
      'shots must default to the recorder and exclude other players')
      check(failures, await page.evaluate(`(() => {
        const row = document.querySelector('[data-testid="shot-row-1"]')
        return row.textContent.includes('T-34') && row.textContent.includes('Tiger II')
      })()`), 'shot rows must show both tank names')
      await page.evaluate(`(() => {
        const select = document.querySelector('[data-testid="shots-shooter-select"]')
        select.value = 'all'; select.dispatchEvent(new Event('change', { bubbles: true }))
      })()`)
      await page.waitFor(() => !!document.querySelector('[data-testid="shot-row-2"]'), { label: 'explicit all-player filter' })
      await page.evaluate(`(() => {
        const select = document.querySelector('[data-testid="shots-shooter-select"]')
        select.value = 'own'; select.dispatchEvent(new Event('change', { bubbles: true }))
      })()`)
      await page.waitFor(() => !document.querySelector('[data-testid="shot-row-2"]'), { label: 'restore recorder filter' })
      check(failures, await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'shot list must not overflow the viewport')
      if (scenario.shotsFullscreen) {
        const enter = await page.evaluate(clickCenterExpression('[data-testid="shots-fullscreen"]'))
        if (!enter) throw new Error('shots fullscreen button must be hit-testable')
        await page.tap({ ...enter, touch: scenario.touch })
        await page.waitForValue('document.fullscreenElement?.getAttribute("data-testid")', (id) => id === 'replay-shots-pane', { label: 'shots fullscreen entered' })
        const inView = (selector) => page.callWith((sel) => {
          const el = document.querySelector(sel)
          if (!el) return false
          const r = el.getBoundingClientRect()
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0
            && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5
            && !!hit && (hit === el || el.contains(hit))
        }, selector)
        check(failures, await inView('[data-testid="shots-fullscreen"]'), 'fullscreen exit button must be fully visible and hit-testable')
        check(failures, await inView('[data-testid="shots-shooter-select"]'), 'fullscreen shooter filter must be visible and hit-testable')
        check(failures, await page.evaluate(`(() => { const root = document.fullscreenElement
          return root.scrollWidth <= root.clientWidth + 1 && getComputedStyle(root).overflowY === 'auto' })()`), 'fullscreen pane must not clip horizontally and must scroll vertically')
        await page.evaluate(`document.querySelector('[data-testid="shot-row-3"]').scrollIntoView({ block: 'center' })`)
        check(failures, await inView('[data-testid="shot-row-3"]'), 'fullscreen shot list row must be reachable')
        const row = await page.evaluate(clickCenterExpression('[data-testid="shot-row-3"]'))
        await page.tap({ ...row, touch: scenario.touch })
        await page.waitFor(() => !!document.querySelector('[data-testid="shot-inspector"]'), { label: 'fullscreen shot inspector' })
        check(failures, await page.evaluate(`(() => { const r = document.querySelector('[data-testid="shot-inspector"]').getBoundingClientRect()
          return r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.width > 0 && r.height > 0 })()`), 'fullscreen inspector must stay inside the viewport')
        await page.evaluate(`document.fullscreenElement.scrollTo(0, 0)`)
        const exit = await page.evaluate(clickCenterExpression('[data-testid="shots-fullscreen"]'))
        if (!exit) throw new Error('fullscreen exit button must be hit-testable with the inspector open')
        await page.tap({ ...exit, touch: scenario.touch })
        await page.waitForValue('document.fullscreenElement === null', Boolean, { label: 'shots fullscreen exited' })
        check(failures, await page.evaluate(`document.querySelector('[data-testid="shot-row-3"]')?.getAttribute('aria-current') === 'true'`), 'selection must survive fullscreen exit')
        check(failures, await page.evaluate(`document.querySelector('[data-testid="shots-shooter-select"]')?.value === 'own'`), 'filter must survive fullscreen exit')
        check(failures, await page.evaluate('window.__wsShotParse.playback === 1 && window.__wsShotParse.shots === 1'), 'fullscreen round trip must not reparse')
      }
    }
    if (scenario.reconstruct) {
      const row = await page.evaluate(clickCenterExpression('[data-testid="shot-row-1"]'))
      if (!row) throw new Error('shot row must be hit-testable')
      await page.tap({ ...row, touch: scenario.touch })
      check(failures, await page.evaluate('window.__wsInput.click?.testId') === 'shot-row-1',
        'real selection click must land on the selected shot row')
      const directOpen = scenario.width < 600
      if (directOpen) check(failures, await page.evaluate('!document.querySelector("[data-testid=shot-inspector]")'), 'compact shot tap must not open the inspector overlay')
      if (!directOpen) for (const selector of ['[data-testid=shot-next]', '[data-testid=shot-prev]', '[data-testid=shot-detail-close]']) {
        await page.callWith((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), selector)
        const reach = await measureReachability(page, { options: [selector], touch: scenario.touch })
        check(failures, reach.sampled > 0, `${selector}: no hit-test samples`)
        failures.push(...reach.failures)
        const point = await page.evaluate(clickCenterExpression(selector))
        if (!point) throw new Error(`${selector} must be hit-testable`)
        await page.tap({ ...point, touch: scenario.touch })
      }
      if (!directOpen) {
        await page.waitForValue('!document.querySelector("[data-testid=shot-inspector]")', Boolean)
        await page.evaluate('document.querySelector("[data-testid=shot-row-1]").scrollIntoView({block:"center"})')
        const reopened = await page.evaluate(clickCenterExpression('[data-testid=shot-row-1]'))
        if (!reopened) throw new Error('shot row cannot be reopened')
        await page.tap({ ...reopened, touch: scenario.touch })
        await page.evaluate('document.querySelector("[data-testid=shot-open-viewer]").scrollIntoView({block:"center"})')
        const viewerReach = await measureReachability(page, { options: ['[data-testid=shot-open-viewer]'], touch: scenario.touch })
        check(failures, viewerReach.sampled > 0, 'armor handoff reachability is empty')
        failures.push(...viewerReach.failures)
        const open = await page.evaluate(clickCenterExpression('[data-testid="shot-open-viewer"]'))
        if (!open) throw new Error('armor handoff button must be hit-testable')
        await page.tap({ ...open, touch: scenario.touch })
        check(failures, await page.evaluate('window.__wsInput.click?.testId') === 'shot-open-viewer',
          'real armor handoff click must land on its button')
      }
      await page.waitForValue('window.__wsArmorScene?.shot || null', (shot) => shot?.index === 1,
        { label: 'armor scene received the selected shot' })
      const scene = await page.evaluate('window.__wsArmorScene')
      check(failures, scene.tank === 2 && scene.shooter === 1, `armor scene tank context lost: ${JSON.stringify(scene)}`)
      const expected = { view: 'agent-armor', tank: '2', shooter: '1', config: '1', shell: '2', shot: '1', world: '1', heatmap: '1' }
      check(failures, Object.entries(expected).every(([key, value]) => scene.query[key] === value),
        `armor scene query lost: ${JSON.stringify(scene.query)}`)
      check(failures, scene.shot.target_eid === 8 && scene.shot.shooter_eid === 7,
        `armor scene local shot context lost: ${JSON.stringify(scene.shot)}`)
      check(failures, await page.evaluate('window.__wsAuth.loginCalls.length') === 0,
        'normal user armor handoff must not request another login')
      check(failures, await page.evaluate(`(() => {
        const header = document.querySelector('[data-testid="armor-shot-header"]')
        return header?.textContent.includes('T-34') && header?.textContent.includes('Tiger II')
          && document.documentElement.scrollWidth <= innerWidth + 1
      })()`), 'armor shot header must show both tank names without overflow')
      const nextShot = await page.evaluate(clickCenterExpression('.armor-shot-navigation button:last-child'))
      check(failures, !!nextShot, 'next recorded shot must be hit-testable')
      if (nextShot) {
        await page.tap({ ...nextShot, touch: scenario.touch })
        await page.waitForValue('window.__wsArmorScene?.shot?.index', value => value === 3,
          { label: 'next shot stays within recorder snapshot' })
        check(failures, await page.evaluate(`document.querySelector('.armor-shot-navigation button:last-child')?.disabled === true`),
          'last recorder shot must disable next navigation')
      }
      const previousShot = await page.evaluate(clickCenterExpression('.armor-shot-navigation button:first-child'))
      if (!previousShot) throw new Error('previous recorded shot must be hit-testable')
      await page.tap({ ...previousShot, touch: scenario.touch })
      await page.waitForValue('window.__wsArmorScene?.shot?.index', value => value === 1,
        { label: 'previous shot navigation' })
      const backToList = await page.evaluate(clickCenterExpression('.armor-shot-back'))
      if (!backToList) throw new Error('return to shots must be hit-testable')
      await page.tap({ ...backToList, touch: scenario.touch })
      await page.waitFor(() => !!document.querySelector('[data-testid="shot-row-1"]'),
        { label: 'return preserves the selected replay and its shot list' })
      check(failures, await page.evaluate(`document.querySelector('[data-testid="shots-shooter-select"]')?.value === 'own'`),
        'return must preserve recorder scope')
    }
  }
  check(failures, page.consoleErrors.length === 0, `JS errors: ${page.consoleErrors.join(' | ')}`)
  await closePageTarget(env.chrome, targetId)
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}`, xfail: scenario.xfail })
}

export const ROSTER_GEOMETRY_SCENARIOS = [
  { name: 'roster-geometry-1600x900-desktop', width: 1600, height: 900, touch: false, players: 7, unknown: 2, killfeed: 3, layout: 'side', killfeedRows: 2, killfeedAdaptive: true },
  { name: 'roster-geometry-1792x922-fullscreen-desktop', width: 1792, height: 922, touch: false, players: 7, unknown: 2, killfeed: 3, layout: 'side', fullscreen: true },
  { name: 'roster-geometry-1024x768-tablet', width: 1024, height: 768, touch: false, players: 7, unknown: 2, killfeed: 3, layout: 'side' },
  { name: 'roster-geometry-375x812-portrait-coarse', width: 375, height: 812, touch: true, players: 7, unknown: 0, killfeed: 3, layout: 'portrait' },
  { name: 'roster-geometry-390x844-portrait-coarse', width: 390, height: 844, touch: true, players: 7, unknown: 2, killfeed: 3, layout: 'portrait' },
  { name: 'roster-geometry-390x844-portrait-fullscreen-coarse', width: 390, height: 844, touch: true, players: 7, unknown: 2, killfeed: 3, layout: 'portrait', fullscreen: true },
  { name: 'roster-geometry-740x360-landscape-coarse', width: 740, height: 360, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side' },
  { name: 'roster-geometry-740x360-fullscreen-coarse', width: 740, height: 360, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', fullscreen: true },
  { name: 'roster-geometry-844x390-landscape-coarse', width: 844, height: 390, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side' },
  { name: 'roster-geometry-844x390-fullscreen-coarse', width: 844, height: 390, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', fullscreen: true },
  { name: 'roster-geometry-portrait-to844x390-coarse', width: 390, height: 844, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', rotateTo: { width: 844, height: 390 } },
  { name: 'roster-geometry-667x375-landscape-coarse', width: 667, height: 375, touch: true, players: 7, unknown: 0, killfeed: 0 },
  { name: 'roster-geometry-740x360-distance-ru-free', width: 740, height: 360, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'ru', camera: 'free', toggleFullscreen: true },
  { name: 'roster-geometry-740x360-distance-ru-top', width: 740, height: 360, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'ru', camera: 'top' },
  { name: 'roster-geometry-844x390-distance-ru-free', width: 844, height: 390, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'ru', camera: 'free', toggleFullscreen: true },
  { name: 'roster-geometry-844x390-distance-ru-top', width: 844, height: 390, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'ru', camera: 'top' },
  { name: 'roster-geometry-740x360-distance-ru-free-fullscreen', width: 740, height: 360, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'ru', camera: 'free', fullscreen: true },
  { name: 'roster-geometry-844x390-distance-ru-free-fullscreen', width: 844, height: 390, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'ru', camera: 'free', fullscreen: true },
  { name: 'roster-geometry-740x360-distance-zh-free', width: 740, height: 360, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'zh', camera: 'free' },
  { name: 'roster-geometry-740x360-distance-zh-top', width: 740, height: 360, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'zh', camera: 'top' },
  { name: 'roster-geometry-740x360-distance-en-free', width: 740, height: 360, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'en', camera: 'free' },
  { name: 'roster-geometry-740x360-distance-en-top', width: 740, height: 360, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'en', camera: 'top' },
  { name: 'roster-geometry-844x390-distance-zh-free', width: 844, height: 390, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'zh', camera: 'free' },
  { name: 'roster-geometry-844x390-distance-zh-top', width: 844, height: 390, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'zh', camera: 'top' },
  { name: 'roster-geometry-844x390-distance-en-free', width: 844, height: 390, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'en', camera: 'free' },
  { name: 'roster-geometry-844x390-distance-en-top', width: 844, height: 390, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'en', camera: 'top' },
  { name: 'roster-geometry-1280x720-desktop', width: 1280, height: 720, touch: false, players: 7, unknown: 2, killfeed: 0 },
  { name: 'roster-geometry-1280x800-desktop', width: 1280, height: 800, touch: false, players: 7, unknown: 2, killfeed: 0, killfeedRows: 1 },
  { name: 'roster-geometry-1280x704-desktop', width: 1280, height: 704, touch: false, players: 7, unknown: 2, killfeed: 0, killfeedRows: 3 },
  { name: 'roster-geometry-1280x660-desktop', width: 1280, height: 660, touch: false, players: 7, unknown: 2, killfeed: 0 },
  { name: 'roster-geometry-1024x460-short', width: 1024, height: 460, touch: false, players: 7, unknown: 0, killfeed: 1, layout: 'side' },
]

export const PLAYBACK_SCENARIOS = [
  { name: 'play-390x844-coarse', width: 390, height: 844, touch: true, duration: 60, form: 'pb-form-mobile' },
  { name: 'play-740x360-landscape-coarse', width: 740, height: 360, touch: true, duration: 60, form: 'pb-form-mobile' },
  { name: 'play-1024x768-tablet', width: 1024, height: 768, touch: false, duration: 60, form: 'pb-form-tablet' },
  { name: 'play-1024x768-ipad-coarse', width: 1024, height: 768, touch: true, duration: 60, form: 'pb-form-tablet' },
  { name: 'play-1440x900-desktop', width: 1440, height: 900, touch: false, duration: 60, form: 'pb-form-pc' },
  { name: 'play-1366x1024-tablet-coarse', width: 1366, height: 1024, touch: true, duration: 60, form: 'pb-form-pc' },
  { name: 'duration-zero-390x844-coarse', width: 390, height: 844, touch: true, duration: 0, form: 'pb-form-mobile' },
  { name: 'play-markers-hidden-1440x900', width: 1440, height: 900, touch: false, duration: 120, form: 'pb-form-pc', query: 'ticks=1', markers: 'hidden' },
  { name: 'play-markers-visible-1440x900', width: 1440, height: 900, touch: false, duration: 120, form: 'pb-form-pc', query: 'ticks=1&markers=1', markers: 'visible' },
  { name: 'play-markers-visible-1024x768-tablet', width: 1024, height: 768, touch: false, duration: 120, form: 'pb-form-tablet', query: 'ticks=1&markers=1', markers: 'visible' },
  { name: 'play-markers-visible-740x360-landscape-coarse', width: 740, height: 360, touch: true, duration: 120, form: 'pb-form-mobile', query: 'ticks=1&markers=1', markers: 'visible' },
]

export const ROTATION_SCENARIO = {
  name: 'orientation-portrait-to-landscape-coarse',
  width: 390, height: 844, touch: true, duration: 60,
  rotateTo: { width: 844, height: 390 },
}

export async function runAppScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  setLastPage(page)
  await page.enable(scenario)
  await page.emulate(scenario)

  const authParams = scenario.authInit
    ? `&ws-auth-init=${scenario.authInit}&ws-auth-timeout-ms=${scenario.authTimeout ?? 12_000}`
    : ''
  const roleParams = scenario.roles?.length ? `&ws-roles=${encodeURIComponent(scenario.roles.join(','))}` : ''
  const url = `${env.origin}/?view=replay&ws-auth=${scenario.authenticated ? 1 : 0}&ws-login=${scenario.login}${authParams}${roleParams}`
  await page.goto(url)
  await page.waitFor(() => !!document.querySelector('[data-testid="ws-tab"][data-cap="replay"]'), { label: 'capability tabs' })

  await page.waitFor(() => !!document.querySelector('[data-testid="ws-data"]'), {
    ...(scenario.authInit ? { timeout: 3_000 } : {}),
    label: 'data pane',
  })
  if (scenario.authInit === 'pending') {
    check(failures, await page.evaluate(`window.__wsAuth?.authInitState?.value !== 'authenticated'`),
      'auth init unexpectedly settled; the pending scenario no longer proves the workspace ignores auth')
  }
  check(failures, !(await page.evaluate(`!!document.querySelector('[data-testid="ws-auth-loading"]')`)),
    'workspace shows a removed auth-checking state')

  const hit = await page.probe(capabilityHitProbe)
  check(failures, hit.found, 'capability tab button missing')
  check(failures, hit.hitIsButton, `elementFromPoint(${hit.center?.x},${hit.center?.y}) hit ${JSON.stringify(hit.hitChain)} instead of the tab button`)
  check(failures, hit.pointerEvents === 'auto', `tab pointer-events=${hit.pointerEvents}`)
  check(failures, hit.visibility === 'visible' && Number(hit.opacity) > 0.9, `tab visibility=${hit.visibility} opacity=${hit.opacity}`)
  check(failures, hit.insideViewport, `tab rect ${JSON.stringify(hit.rect)} is outside the ${hit.viewportWidth}px viewport`)
  check(failures, hit.pageScrollWidth <= hit.viewportWidth + 1, `page-level horizontal overflow: scrollWidth=${hit.pageScrollWidth} viewport=${hit.viewportWidth}`)
  if (scenario.touch) {
    check(failures, hit.coarsePointer && hit.hoverNone, `device emulation missed pointer:coarse/hover:none (coarse=${hit.coarsePointer} hoverNone=${hit.hoverNone})`)
  }
  const layout = await page.probe(capabilityLayoutProbe)
  check(failures, layout?.buttons.length === 4 && !layout.overflow,
    `四 capability buttons must fit without horizontal scrolling: ${JSON.stringify(layout)}`)
  check(failures, layout?.buttons.every(button => button.inside && button.labelFits && button.hit),
    `every capability label must be visible and its button directly reachable: ${JSON.stringify(layout)}`)
  if (scenario.width >= 768) {
    check(failures, layout?.rows === 1, `wide capability bar must stay on one row: ${JSON.stringify(layout)}`)
  }

  await page.installInputTrace()
  await page.tap({ ...hit.center, touch: scenario.touch })
  const input = await page.inputTrace()
  check(failures, input?.primary?.cap === 'replay',
    `the real ${scenario.touch ? 'touchstart' : 'mousedown'} landed on ${JSON.stringify(input?.primary)} instead of the replay tab button`)
  check(failures, input?.click?.cap === 'replay',
    `the real click landed on ${JSON.stringify(input?.click)} instead of the replay tab button`)

  await page.waitForValue('new URLSearchParams(location.search).get("view")', (value) => value === 'battle-playback', { label: 'route ?view=battle-playback' })
  const state = await page.probe(capabilityStateProbe)
  check(failures, state.playback.visible, `ws-playback not visible after tap (${JSON.stringify(state.playback)})`)
  check(failures, !state.data.visible, 'ws-data still visible after switching to playback')
  const playbackTab = state.tabs.find((tab) => tab.cap === 'replay')
  check(failures, !!playbackTab && playbackTab.selected && playbackTab.active, `playback tab not marked active: ${JSON.stringify(state.tabs)}`)
  await delay(500)
  const settled = await page.probe(capabilityStateProbe)
  check(failures, settled.playback.visible && !settled.data.visible
    && settled.tabs.find((tab) => tab.cap === 'replay')?.selected === true,
  `capability was reverted by a later watcher/route sync: ${JSON.stringify(settled)}`)
  check(failures, await page.evaluate('new URLSearchParams(location.search).get("view")') === 'battle-playback',
    'route was reverted away from ?view=battle-playback by a later watcher/route sync')

  const eventProbe = `(() => {
    const toggleEl = document.querySelector('[data-testid="viewer-events-toggle"]')
    const section = document.querySelector('[data-testid="ws-events"]')
    const r = section?.getBoundingClientRect()
    return {
      toggle: !!toggleEl,
      checked: toggleEl?.getAttribute('aria-checked') ?? null,
      displayed: !!section && section.offsetHeight > 0 && (r?.height ?? 0) > 0,
      styleDisplay: section?.style.display ?? null,
      sectionMounted: !!section,
      height: r?.height ?? 0,
    }
  })()`
  const eventToggle = await page.evaluate(`(() => {
    const button = document.querySelector('[data-testid="viewer-events-toggle"]')
    if (!button) return null
    button.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = button.getBoundingClientRect()
    const center = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    const hit = document.elementFromPoint(center.x, center.y)
    return { center, hitIsButton: hit === button || button.contains(hit), height: r.height, width: r.width }
  })()`)
  check(failures, !!eventToggle && eventToggle.hitIsButton,
    `event details switch missing or not hit-testable: ${JSON.stringify(eventToggle)}`)
  check(failures, (eventToggle?.height ?? 0) >= 43.5,
    `event details switch hit height below 44px: ${JSON.stringify(eventToggle)}`)
  const defaultEvents = await page.evaluate(eventProbe)
  check(failures, defaultEvents.toggle && defaultEvents.checked === 'false' && !defaultEvents.displayed
    && defaultEvents.sectionMounted,
  `events must default hidden but stay mounted: ${JSON.stringify(defaultEvents)}`)

  if (eventToggle?.hitIsButton) {
    try {
      await page.tap({ ...eventToggle.center, touch: scenario.touch })
    } catch (error) {
      failures.push(`event details switch tap failed: ${error?.message || error}`)
    }
    const open = await page.waitForValue(eventProbe, (value) => value.checked === 'true' && value.displayed, { label: 'events visible after toggle' })
    check(failures, open?.sectionMounted === true,
      `opening events must keep the section mounted: ${JSON.stringify(open)}`)
    await page.tap({ ...eventToggle.center, touch: scenario.touch })
    const closed = await page.waitForValue(eventProbe, (value) => value.checked === 'false' && !value.displayed, { label: 'events hidden after toggle' })
    check(failures, closed?.sectionMounted === true, `closing events must keep the section mounted: ${JSON.stringify(closed)}`)
    await page.tap({ ...eventToggle.center, touch: scenario.touch })
    await page.waitForValue(eventProbe, (value) => value.checked === 'true' && value.displayed, { label: 'events reopened before 3D' })
  }

  check(failures, page.consoleErrors.length === 0, `JS errors: ${page.consoleErrors.join(' | ')}`)
  if (!scenario.authenticated) {
    const attempts = await page.evaluate('window.__wsAuth.loginCalls.length')
    check(failures, attempts === 0, `anonymous capability switch must not start login, loginCalls=${attempts}`)
  }

  const expectedCaps = ['data', 'replay', 'shots', 'ai']
  check(failures, JSON.stringify(state.tabs.map((t) => t.cap)) === JSON.stringify(expectedCaps),
    `capability set=${JSON.stringify(state.tabs.map((t) => t.cap))}, expected ${JSON.stringify(expectedCaps)}`)
  if (scenario.touch) {
    const small = state.tabs.filter((t) => t.minSide < 43.5)
    check(failures, small.length === 0,
      `coarse capability targets below 44px: ${JSON.stringify(small)}`)
  }

  const threeDTab = state.tabs.find((t) => t.cap === 'replay')
  const threeDHit = await page.evaluate(`(() => {
    const button = document.querySelector('[data-testid="viewer-mode-3d"]')
    if (!button) return null
    button.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = button.getBoundingClientRect()
    const center = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    const hit = document.elementFromPoint(center.x, center.y)
    return { center, hitIsButton: hit === button || button.contains(hit) }
  })()`)
  check(failures, !!threeDTab && !!threeDHit?.hitIsButton,
    `3D mode switch not hit-testable: ${JSON.stringify({ threeDTab, threeDHit })}`)
  if (threeDHit?.hitIsButton) {
    await page.tap({ ...threeDHit.center, touch: scenario.touch })
    await page.waitForValue('new URLSearchParams(location.search).get("view")', (value) => value === 'agent-replay',
      { label: 'route ?view=agent-replay' })
    const threeDState = await page.probe(capabilityStateProbe)
    check(failures, threeDState.threeD.visible, `ws-3d not visible after switching (${JSON.stringify(threeDState.threeD)})`)
    check(failures, !threeDState.playback.visible, 'ws-playback still visible after switching to 3D')
    check(failures, !threeDState.data.visible, 'ws-data still visible after switching to 3D')
    const gate = await page.evaluate('!!document.querySelector("[data-testid=capability-auth-gate]")')
    check(failures, gate === !scenario.authenticated, `3D gate visibility must follow authentication: ${gate}`)
    if (eventToggle?.hitIsButton) {
      const after3d = await page.evaluate(eventProbe)
      check(failures, after3d.checked === 'true' && after3d.displayed && after3d.sectionMounted,
        `event details switch must stay open across 2D→3D: ${JSON.stringify(after3d)}`)
      const closedIn3d = await tapElement(page, '[data-testid="viewer-events-toggle"]', {
        touch: scenario.touch,
        verify: async () => {
          const value = await page.evaluate(eventProbe)
          return value.checked === 'false' && !value.displayed && value.sectionMounted
        },
      })
      check(failures, closedIn3d, 'event details switch must close in 3D after a real tap')
      if (closedIn3d) {
        const reopenedIn3d = await tapElement(page, '[data-testid="viewer-events-toggle"]', {
          touch: scenario.touch,
          verify: async () => {
            const value = await page.evaluate(eventProbe)
            return value.checked === 'true' && value.displayed
          },
        })
        check(failures, reopenedIn3d, 'event details switch must reopen in 3D after a real tap')
      }
    }
  }

  await closePageTarget(env.chrome, targetId)
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}`, xfail: scenario.xfail })
}

export async function runPlaybackControlScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  setLastPage(page)
  await page.enable()
  await page.emulate(scenario)

  await page.goto(`${env.origin}/scripts/browser-fixtures/playback-controls.html?duration=${scenario.duration}${scenario.query ? `&${scenario.query}` : ''}`)
  await page.waitFor(() => !!document.querySelector('[data-test="pb-play"]'), { label: 'playback controls' })
  const sceneHit = await sceneHitTarget(page)

  if (scenario.markers) {
    const markerState = await page.evaluate(`(() => {
      const range = document.querySelector('.pb-range')
      return {
        layers: document.querySelectorAll('[data-test="pb-ticks"]').length,
        shots: document.querySelectorAll('.pb-tick-shot').length,
        kills: document.querySelectorAll('.pb-tick-kill').length,
        rangeDisabled: range?.disabled ?? null,
      }
    })()`)
    if (scenario.markers === 'hidden') {
      check(failures, markerState.layers === 0 && markerState.shots === 0 && markerState.kills === 0,
        `tick data with events hidden must not render markers: ${JSON.stringify(markerState)}`)
    } else {
      check(failures, markerState.layers === 1 && markerState.shots >= 1 && markerState.kills >= 1,
        `events on must render shot/kill markers: ${JSON.stringify(markerState)}`)
    }
    check(failures, markerState.rangeDisabled === false,
      `event marker gating must not disable the native seek range: ${JSON.stringify(markerState)}`)
  }

  const before = await page.probe(playbackControlProbe)
  const control = before.hitIsButton ? before : await page.revealControl('[data-test="pb-play"]')
  check(failures, control.hitIsButton,
    `play button center hit ${control.hitDescription} instead (viewport=${control.viewportWidth}x${control.viewportHeight} geometry=${JSON.stringify(control.geometry)})`)
  const speed = scenario.touch && !control.speedHit
    ? await page.revealControl('[data-test="pb-speed-current"]')
    : control
  if (scenario.touch && speed.speedHit != null) {
    check(failures, speed.speedHit,
      `touch speed option must expose a ${sceneHit}x${sceneHit} hit target: ${JSON.stringify(speed.speedHitDetail)}`)
  }
  {
    await page.evaluate(`document.querySelector('[data-test="pb-speed-current"]')?.click()`)
    await delay(150)
    const menu = await page.probe(playbackControlProbe)
    check(failures, !!menu.speedMenu, 'speed options must open on demand from the current value')
    if (menu.speedMenu) {
      check(failures, menu.speedMenu.count === 5,
        `speed menu must list every shared speed: ${JSON.stringify(menu.speedMenu)}`)
      check(failures, !menu.speedMenu.overflow, 'speed options overflow their menu')
      if (scenario.touch) {
        check(failures, menu.speedMenu.allHit,
          `touch speed option must expose a ${sceneHit}x${sceneHit} hit target: ${JSON.stringify(menu.speedMenu)}`)
        check(failures, menu.speedMenu.minWidth >= menu.speedMenu.expectedWidth - 0.5,
          `touch speed menu option width is ${menu.speedMenu.minWidth.toFixed(1)}px, below ${menu.speedMenu.expectedWidth}px: ${JSON.stringify(menu.speedMenu)}`)
      }
    }
    await page.evaluate(`document.querySelector('[data-test="pb-speed-current"]')?.click()`)
    await delay(150)
  }
  check(failures, before.pageScrollWidth <= before.viewportWidth + 1,
    `page-level horizontal overflow: ${before.pageScrollWidth} > ${before.viewportWidth} (contentWidth=${before.contentWidth} overflowing=${JSON.stringify(before.overflowing)})`)
  if (scenario.form) check(failures, before.formClass === scenario.form, `form factor class=${before.formClass}, expected ${scenario.form}`)

  if (scenario.duration > 0) {
    check(failures, control.disabled === false, 'play button must be enabled when the timeline is usable')
    await page.installInputTrace()
    await page.tap({ ...control.center, touch: scenario.touch })
    const input = await page.inputTrace()
    check(failures, input?.click?.test === 'pb-play',
      `the real click landed on ${JSON.stringify(input?.click)} instead of the play button`)
    const advanced = await page
      .waitForValue('document.querySelector(\'[data-test="pb-time"]\').textContent.trim()', (value) => value !== control.time, { timeout: 5000, label: 'clock advancing after play tap' })
      .catch(() => null)
    check(failures, advanced !== null, `play tap was a silent no-op: clock stayed ${control.time}`)
  } else {
    check(failures, control.disabled === true || control.ariaDisabled === 'true',
      `duration<=0 but the play button still looks enabled (disabled=${control.disabled} aria-disabled=${control.ariaDisabled})`)
    check(failures, !!control.unavailableReason, 'duration<=0 without an explicit unavailable reason in the UI')
    await page.tap({ ...control.center, touch: scenario.touch })
    const after = await page.probe(playbackControlProbe)
    check(failures, after.time === control.time, `unavailable play button still moved the clock: ${control.time} -> ${after.time}`)
  }

  await closePageTarget(env.chrome, targetId)
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}`, xfail: scenario.xfail })
}

export async function runRotationScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  setLastPage(page)
  await page.enable()
  await page.emulate(scenario)

  await page.goto(`${env.origin}/scripts/browser-fixtures/playback-controls.html?duration=${scenario.duration}`)
  await page.waitFor(() => !!document.querySelector('[data-test="pb-play"]'), { label: 'playback controls' })
  const portrait = await page.probe(playbackControlProbe)
  check(failures, portrait.formClass === 'pb-form-mobile', `portrait form=${portrait.formClass}`)

  await page.emulate({ ...scenario, ...scenario.rotateTo })
  const rotated = await page.waitForValue(
    `(() => { const root = document.querySelector('[data-test="battle-playback"]'); return root ? (Array.from(root.classList).find((n) => n.startsWith('pb-form-')) || null) : null })()`,
    (value) => value !== null,
    { timeout: 5000, label: 'form class after rotation' },
  )
  check(failures, rotated === 'pb-form-mobile',
    `after rotating to ${scenario.rotateTo.width}x${scenario.rotateTo.height} form=${rotated}; coarse-pointer phones must never fall into tablet/pc`)

  const after = await page.probe(playbackControlProbe)
  check(failures, await page.evaluate(`!!document.querySelector('[data-test="pb-speed-current"]')
    && !document.querySelector('.pb-speed .pb-btn')`), '2D rotated phone must retain compact speed picker')
  check(failures, after.pageScrollWidth <= after.viewportWidth + 1,
    `after rotation page-level horizontal overflow: ${after.pageScrollWidth} > ${after.viewportWidth} (contentWidth=${after.contentWidth} geometry=${JSON.stringify(after.geometry)})`)
  const control = after.hitIsButton ? after : await page.revealControl('[data-test="pb-play"]')
  check(failures, control.hitIsButton,
    `after rotation the play button center hit ${control.hitDescription} (viewport=${control.viewportWidth}x${control.viewportHeight} geometry=${JSON.stringify(control.geometry)})`)
  await page.installInputTrace()
  await page.tap({ ...control.center, touch: scenario.touch })
  const input = await page.inputTrace()
  check(failures, input?.click?.test === 'pb-play',
    `after rotation the real click landed on ${JSON.stringify(input?.click)} instead of the play button`)
  const advanced = await page
    .waitForValue('document.querySelector(\'[data-test="pb-time"]\').textContent.trim()', (value) => value !== control.time, { timeout: 5000, label: 'clock advancing after rotation' })
    .catch(() => null)
  check(failures, advanced !== null, `after rotation the play tap was a silent no-op: clock stayed ${control.time}`)

  await closePageTarget(env.chrome, targetId)
  results.push({ name: scenario.name, failures, viewport: `rotate ${scenario.width}x${scenario.height} -> ${scenario.rotateTo.width}x${scenario.rotateTo.height}` })
}

export const ONBOARDING_SCENARIOS = [...['zh', 'en', 'ru'].flatMap(language => ['summer', 'winter'].flatMap(profile =>
  [{ width: 1600, height: 1000, touch: false }, { width: 1024, height: 900, touch: false }, { width: 390, height: 844, touch: true }]
    .map(viewport => ({ ...viewport, language, profile, name: `onboarding-${language}-${profile}-${viewport.width}` })))),
  { name: 'onboarding-fullscreen-844', width: 844, height: 390, touch: true, language: 'zh', profile: 'summer', fullscreen: true },
  { name: 'onboarding-narrow-desktop-840', width: 840, height: 900, touch: false, language: 'zh', profile: 'summer' },
  { name: 'onboarding-fullscreen-transition-844', width: 844, height: 390, touch: true, language: 'zh', profile: 'summer', fullscreen: true, fullscreenTransition: true }]
export let onboardingServer = null
export async function runOnboardingScenario(env, scenario) {
  if (!onboardingServer) onboardingServer = await startFixtureServer({ realReplay: true })
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  const failures = []
  try {
    await page.enable()
    await page.emulate(scenario)
    await env.chrome.client.send('Page.addScriptToEvaluateOnNewDocument', { source:
      `localStorage.setItem('wotb-lang', ${JSON.stringify(scenario.language)}); localStorage.setItem('wotb-ui-profile', ${JSON.stringify(scenario.profile)});` }, sessionId)
    const url = `${onboardingServer.origin}/?view=home&ws-auth=0&ws-onboarding=${scenario.name}`
    await page.goto(url)
    await page.installInputTrace()
    const hit = async selector => {
      const center = await page.waitForValue(clickCenterExpression(selector), value => value != null,
        { label: `guide hit target ${selector}` })
      await page.tap({ ...center, touch: scenario.touch })
    }
    await page.waitFor(() => !!document.querySelector('[data-testid="home-onboarding"]'), { label: 'anonymous homepage tutorial button' })
    check(failures, await page.evaluate('!document.querySelector("[data-testid=onboarding-welcome]")'), 'anonymous visit must not auto-open tutorial')
    await hit('[data-testid="home-onboarding"]')
    await page.waitFor(() => !!document.querySelector('[data-testid="onboarding-directory"]'), { label: 'homepage opens the complete feature directory' })
    await hit('[data-testid="onboarding-restart"]')
    await page.waitFor(() => !!document.querySelector('[data-testid="onboarding-welcome"]'), { label: 'explicit tutorial request' })
    await hit('[data-testid="onboarding-begin"]')
    await page.waitFor(() => !!document.querySelector('[data-testid="workspace-demo-label"]') && !!document.querySelector('[data-tour="data-toolbar"]'),
      { timeout: 60000, label: 'real sample locally analyzed' })
    check(failures, await page.evaluate('!!document.querySelector("[data-tour=workspace-help]")'), 'anonymous replay workspace keeps the feature guide entry')
    const anchors = ['workspace-demo', 'data-toolbar', 'playback-transport', 'playback-annotation-entry', 'playback-declutter']
    let skippedInFullscreen = false
    for (let node = 0; node < anchors.length; node++) {
      const anchor = anchors[node]
      await page.waitForValue('document.querySelector("[data-testid=onboarding-card]")?.dataset.step',
        value => Number(value) === node + 1, { label: `guide node ${node + 1}` })
      await page.waitForValue(`(() => {
        const card = document.querySelector('[data-testid="onboarding-card"]');
        const target = [...document.querySelectorAll('[data-tour=${JSON.stringify(anchor)}]')].find(el => el.getBoundingClientRect().width > 0);
        return card && target && !!document.querySelector('[data-testid="onboarding-cutout"]');
      })()`, value => value === true, { label: `real anchored guide ${node + 1}` })
      await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const geometry = await page.evaluate(`(() => {
        const card=document.querySelector('[data-testid="onboarding-card"]').getBoundingClientRect();
        const navigation=document.querySelector('.onboarding-card-actions').getBoundingClientRect();
        const target=[...document.querySelectorAll('[data-tour=${JSON.stringify(anchor)}]')].find(el=>el.getBoundingClientRect().width>0).getBoundingClientRect();
        return { overflow:document.documentElement.scrollWidth>innerWidth+1,
          cardOut:card.left<0||card.right>innerWidth+1||card.top<0||card.bottom>innerHeight+1,
          covered:Math.min(card.right,target.right)>Math.max(card.left,target.left)&&Math.min(card.bottom,target.bottom)>Math.max(card.top,target.top),
          navigationCovered:Math.min(navigation.right,target.right)>Math.max(navigation.left,target.left)&&Math.min(navigation.bottom,target.bottom)>Math.max(navigation.top,target.top),
          navigationOut:navigation.left<0||navigation.right>innerWidth+1||navigation.top<0||navigation.bottom>innerHeight+1 };
      })()`)
      check(failures, !geometry.overflow && !geometry.cardOut && !geometry.covered && !geometry.navigationCovered && !geometry.navigationOut,
        `node ${node + 1} target/card geometry: ${JSON.stringify(geometry)}`)
      if (node === 2) {
        if (scenario.fullscreen) {
          check(failures, await page.evaluate('!!document.fullscreenEnabled'),
            'document.fullscreenEnabled must be true before the fullscreen tap')
          await hit('[data-test="pb-fullscreen"]')
          await page.waitFor(() => !!document.fullscreenElement, { label: 'actual 2D fullscreen' })
          const fullscreenGeometry = await page.evaluate(`(() => {
            const target=document.querySelector('[data-tour="playback-transport"]').getBoundingClientRect();
            const navigation=document.querySelector('.onboarding-card-actions').getBoundingClientRect();
            return {target:{left:target.left,top:target.top,right:target.right,bottom:target.bottom},navigation:{left:navigation.left,top:navigation.top,right:navigation.right,bottom:navigation.bottom},
              covered:Math.min(navigation.right,target.right)>Math.max(navigation.left,target.left)&&Math.min(navigation.bottom,target.bottom)>Math.max(navigation.top,target.top),
              hostOwned:document.fullscreenElement.contains(document.querySelector('[data-testid="onboarding-host"]'))};
          })()`)
          if (fullscreenGeometry.covered || !fullscreenGeometry.hostOwned) throw new Error(`fullscreen guide geometry ${JSON.stringify(fullscreenGeometry)}`)
        }
        await hit('[data-test="pb-play"]')
        check(failures, await page.evaluate('window.__wsInput.click?.test') === 'pb-play', 'guide must admit the actual play button')
        await hit('[data-test="pb-play"]')
        if (scenario.fullscreen && !scenario.fullscreenTransition) {
          await hit('[data-testid="onboarding-skip"]')
          check(failures, await page.evaluate('!document.querySelector("[data-testid=onboarding-layer]")'), 'skip inside actual fullscreen removes teaching overlay')
          await hit('[data-test="pb-fullscreen"]')
          await page.waitFor(() => !document.fullscreenElement, { label: 'actual 2D fullscreen exit' })
          skippedInFullscreen = true
          break
        }
      }
      if (node === 3) {
        await hit(`[data-tour="${anchor}"]`)
        await page.waitFor(() => !!document.querySelector('[data-tour="playback-annotation-tools"]'), { label: 'real annotation toolbar' })
        check(failures, await page.evaluate('!!document.querySelector("[data-test=pb-annot-arrow]")'), 'drawing tools available during guide')
      }
      if (node === 4) {
        await hit(`[data-tour="${anchor}"]`)
        check(failures, await page.evaluate('document.querySelector("[data-tour=playback-declutter]").getAttribute("aria-pressed") === "true"'),
          'real declutter preference changed through guide cutout')
      }
      await hit('[data-testid="onboarding-next"]')
      check(failures, await page.evaluate('window.__wsInput.click?.testId') === 'onboarding-next',
        `node ${node + 1} Next click must reach the teaching card`)
    }
    if (!skippedInFullscreen) {
      await page.waitForValue('new URLSearchParams(location.search).get("view")', value => value === 'agent-replay', { label: '3D guide destination' })
      if (scenario.fullscreenTransition) {
        // 匿名 3D 已自动开播，guide 的 replay3d-start 阶段会按 advanceOnReady 直接跳到相机阶段。
        await page.waitForValue('document.querySelector("[data-testid=onboarding-card]")?.dataset.anchor', value => value === 'replay3d-camera',
          { timeout: 60_000, label: 'auto-start guide advances to the camera stage' })
        const handoff = await page.evaluate(`(() => {
          const camera=document.querySelector('.pb-root.compact-bar .controls [data-tour="replay3d-camera"]'),root=document.fullscreenElement;
          return {fullscreen:!!root,cameraInsideOwner:!root||root.contains(camera),
            cameraWidth:camera?.getBoundingClientRect().width??0,
            guideWidth:document.querySelector('[data-testid="onboarding-card"]')?.getBoundingClientRect().width??0,
            startPresent:!!document.querySelector('[data-tour="replay3d-start"]')};
        })()`)
        if (!handoff.cameraInsideOwner || !handoff.cameraWidth || !handoff.guideWidth || handoff.startPresent) {
          throw new Error(`fullscreen capability handoff trapped the guide ${JSON.stringify(handoff)}`)
        }
        await page.waitFor(() => {
          const el = document.querySelector('.pb-root.compact-bar .controls [data-tour="replay3d-camera"]')
          const r = el?.getBoundingClientRect()
          return !!r && r.width > 0 && r.height > 0
        }, { label: 'compact camera anchor stays visible in the toolbar' })
      }
      await hit('[data-testid="onboarding-next"]')
      await page.waitForValue('new URLSearchParams(location.search).get("view")', value => value === 'agent-shots', { label: 'shots guide destination' })
      await page.waitFor(() => !!document.querySelector('[data-tour="shots-first-shot"]') && !document.querySelector('.onboarding-status'),
        { timeout: 60_000, label: 'actual sample shooting lesson prepared' })
      check(failures, await page.evaluate('document.querySelector("[data-testid=shots-shooter-select]")?.value') === 'own', 'shooting lesson resets the recorder filter')
      await hit('[data-tour="shots-first-shot"]')
      await page.waitFor(() => !!document.querySelector('[data-testid="shot-inspector"]'), { label: 'actual sample shot inspector' })
      await page.waitForValue('document.querySelector("[data-testid=onboarding-card]")?.dataset.anchor', value => value === 'shot-open-viewer', { label: 'core shooting details action' })
      await page.waitForValue(`(() => {
        const panel=document.querySelector('[data-testid="shot-inspector"]')?.getBoundingClientRect();
        const card=document.querySelector('[data-testid="onboarding-card"]')?.getBoundingClientRect();
        const nav=document.querySelector('.onboarding-card-actions')?.getBoundingClientRect();
        const overlaps=(a,b)=>a&&b&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
        return panel&&card&&nav&&!overlaps(panel,card)&&!overlaps(panel,nav);
      })()`, value => value === true, { label: 'core guide card and navigation do not cover the shot inspector' })
      await captureMobileReview(page, scenario, 'onboarding-shot-details')
      await hit('[data-testid="shot-detail-close"]')
      await page.waitForValue('document.querySelector("[data-testid=onboarding-card]")?.dataset.anchor', value => value === 'shots-first-shot', { label: 'closing actual inspector returns to the shot list' })
      await hit('[data-testid="onboarding-skip"]')
      check(failures, await page.evaluate('!document.querySelector("[data-testid=onboarding-layer]")'),
        `skip must remove overlay: ${JSON.stringify(await page.evaluate('({click:window.__wsInput.click,primary:window.__wsInput.primary,pointers:window.__wsInput.pointers.slice(-3)})'))}`)
    }
    await page.goto(url)
    await page.waitFor(() => !!document.querySelector('[data-testid="home-onboarding"]'), { label: 'homepage after reload' })
    await page.installInputTrace()
    check(failures, await page.evaluate('!document.querySelector("[data-testid=onboarding-welcome]")'), 'same-epoch skip must suppress fresh invitation')
    await hit('[data-testid="home-onboarding"]')
    await hit('[data-testid="onboarding-restart"]')
    await hit('[data-testid="onboarding-begin"]')
    for (let node = 1; node <= 7; node++) {
      await page.waitForValue('document.querySelector("[data-testid=onboarding-card]")?.dataset.step', value => Number(value) === node,
        { label: `manual restart node ${node}` })
      await hit('[data-testid="onboarding-next"]')
    }
    await page.waitFor(() => !!document.querySelector('[data-testid="onboarding-finish"]'), { label: 'manual tutorial completion' })
    await captureMobileReview(page, scenario, 'onboarding-complete')
    check(failures, await page.evaluate('document.querySelectorAll("[data-testid=onboarding-follow-ups] .onboarding-topic").length') === 5, 'core completion directly exposes five optional guides')
    await hit('[data-testid="onboarding-follow-up-ai"]')
    await page.waitFor(() => !!document.querySelector('[data-testid="onboarding-ai-login"]') && !document.querySelector('[data-testid="onboarding-begin"]'), { label: 'anonymous AI tutorial requires login before preparation' })
    await hit('[data-testid="onboarding-skip-welcome"]')
    await page.goto(url)
    await page.waitFor(() => !!document.querySelector('[data-testid="home-onboarding"]'), { label: 'homepage feature directory after completion' })
    await hit('[data-testid="home-onboarding"]')
    await page.waitFor(() => !!document.querySelector('[data-testid="onboarding-directory"]'), { label: 'manual guide directory' })
    check(failures, await page.evaluate('document.querySelectorAll(".onboarding-topic").length') === 10, 'directory covers ten public topics')
  } catch (error) {
    const detail = await page.evaluate(`({step:document.querySelector('[data-testid="onboarding-card"]')?.dataset.step,
      title:document.querySelector('#onboarding-step-title')?.textContent,click:window.__wsInput?.click,
      primary:window.__wsInput?.primary,pointers:window.__wsInput?.pointers?.slice(-6),route:location.search,
      dialogs:[...document.querySelectorAll('[role="dialog"]')].map(el=>({test:el.dataset.testid,text:el.textContent?.slice(0,300),visible:el.getBoundingClientRect().height>0})),
      receipt:localStorage.getItem('wotbtools-onboarding'),source:document.querySelector('.workspace-source')?.textContent?.slice(0,300),
      shotClose:(()=>{const el=document.querySelector('[data-testid=shot-detail-close]');if(!el)return null;const r=el.getBoundingClientRect();return {rect:r.toJSON(),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML?.slice(0,300),scrollY,innerHeight};})()})`).catch(() => null)
    throw new Error(`${error.message}; ${JSON.stringify(detail)}; ${page.consoleErrors.join(' | ')}`)
  } finally {
    await closePageTarget(env.chrome, targetId)
  }
  results.push({ name: scenario.name, failures: [...failures, ...page.consoleErrors], viewport: `${scenario.width}x${scenario.height}` })
}

export const MENU_VIEWPORT_SCENARIOS = ['summer', 'winter'].flatMap(profile => [
  { width: 360, height: 640, touch: true },
  { width: 740, height: 360, touch: true },
  { width: 740, height: 240, touch: true },
  { width: 1024, height: 768, touch: true },
  { width: 1440, height: 900, touch: false },
].map(size => ({ ...size, profile, name: `menu-viewport-${profile}-${size.width}x${size.height}` })))

export async function runMenuViewportScenario(env, scenario) {
  const { sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  setLastPage(page)
  const failures = []
  await page.enable()
  await page.emulate(scenario)
  await page.goto(`${env.origin}/scripts/browser-fixtures/menu-button.html?profile=${scenario.profile}`)
  await page.waitForValue('!!document.querySelector("[data-testid=menu-trigger]")', Boolean)

  async function tap(selector) {
    const point = await page.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await page.tap({ ...point, touch: scenario.touch })
  }
  async function open() {
    await tap('[data-testid=menu-trigger]')
    await page.waitForValue('!!document.querySelector("[role=menu]")', Boolean)
    await page.waitForValue('document.getAnimations().every(a => a.playState !== "running")', Boolean,
      { timeout: 3000, label: 'menu entry animation settled' })
  }
  async function checkBounds() {
    const box = await page.evaluate(`(() => {
      const el = document.querySelector('[role=menu]'), r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height,
        viewportWidth: innerWidth, viewportHeight: innerHeight, client: el.clientHeight, scroll: el.scrollHeight }
    })()`)
    check(failures, box.top >= -1 && box.bottom <= box.viewportHeight + 1,
      `menu leaves vertical viewport: ${JSON.stringify(box)}`)
    check(failures, box.left >= -1 && box.right <= box.viewportWidth + 1,
      `menu leaves horizontal viewport: ${JSON.stringify(box)}`)
    if (box.viewportHeight === 240) check(failures, box.scroll > box.client, 'short viewport must scroll inside the menu')
  }
  async function key(name, code) {
    await env.chrome.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code }, sessionId)
    await env.chrome.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code }, sessionId)
  }

  await open()
  await checkBounds()
  if (failures.length) throw new Error(failures.join('\n'))
  for (const [name, code, item] of [['End', 35, 'png'], ['Home', 36, 'aggregate']]) {
    await key(name, code)
    await page.waitForValue(`document.activeElement?.dataset.testid`, value => value === `menu-${item}`)
    const reach = await measureReachability(page, { options: [`[data-testid=menu-${item}]`], touch: scenario.touch })
    check(failures, reach.sampled > 0, `${name}: reachability probe must sample an item`)
    failures.push(...reach.failures)
  }
  await key('Escape', 27)
  await page.waitForValue('!document.querySelector("[role=menu]")', Boolean)
  await page.waitForValue('document.activeElement?.dataset.testid', value => value === 'menu-trigger')

  for (const item of ['aggregate', 'each', 'png']) {
    await open()
    await page.evaluate(`document.querySelector('[data-testid=menu-${item}]').scrollIntoView({block:'nearest'})`)
    const reach = await measureReachability(page, { options: [`[data-testid=menu-${item}]`], touch: scenario.touch })
    check(failures, reach.sampled > 0, `${item}: reachability probe must sample an item`)
    failures.push(...reach.failures)
    await tap(`[data-testid=menu-${item}]`)
    await page.waitForValue('document.querySelector("[data-testid=menu-selected]")?.textContent', value => value === item)
    await page.waitForValue('!document.querySelector("[role=menu]")', Boolean)
  }
  if (scenario.height > 240) {
    await open()
    for (const height of [240, scenario.height]) {
      await page.emulate({ ...scenario, height })
      await page.waitForValue(`(() => {
        const r = document.querySelector('[role=menu]').getBoundingClientRect()
        return innerHeight === ${height} && r.top >= -1 && r.bottom <= innerHeight + 1
      })()`, Boolean, { timeout: 3000, label: `menu within resized ${height}px viewport` })
      await checkBounds()
    }
    await key('Escape', 27)
    await page.waitForValue('!document.querySelector("[role=menu]")', Boolean)
  }
  if (scenario.width >= 1024) {
    await page.goto(`${env.origin}/scripts/browser-fixtures/menu-button.html?profile=${scenario.profile}&battle`)
    await page.emulate({ ...scenario, width: 844, height: 310 })
    await tap('[data-testid=menu-trigger]')
    await page.waitFor(() => !!document.querySelector('.picker-panel .picker-list'))
    await page.waitForValue('document.getAnimations().every(a => a.playState !== "running")', Boolean,
      { timeout: 3000, label: 'battle menu entry animation settled' })
    const battleMenu = await page.probe(() => {
      const panel = document.querySelector('.picker-panel')
      const rect = panel.getBoundingClientRect()
      const list = panel.querySelector('.picker-list')
      const search = panel.querySelector('input').getBoundingClientRect()
      return {
        inside: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth,
        scrolls: list.clientHeight > 0 && list.scrollHeight > list.clientHeight,
        searchVisible: search.top >= rect.top && search.bottom <= list.getBoundingClientRect().top,
      }
    })
    if (!Object.values(battleMenu).every(Boolean)) throw new Error(`battle menu does not fit: ${JSON.stringify(battleMenu)}`)
    await tap('[data-testid=battle-picker-option][data-value=r13]')
    await page.waitFor(() => document.querySelector('[data-testid=menu-selected]')?.textContent === 'r13'
      && !document.querySelector('.picker-panel'))
  }
  results.push({ name: scenario.name, failures: [...failures, ...page.consoleErrors], viewport: `${scenario.width}x${scenario.height}` })
}


export async function closeOnboardingServer() {
  if (onboardingServer) await onboardingServer.server.close()
}
