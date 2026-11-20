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
  // Data / 2D 在未登录、auth init 挂起 / 失败时立即可用；受保护能力停在登录门。
  // pending 的 watchdog 设得远长于场景本身——工作台必须在 auth init 仍挂起时就渲染（不能等超时兜底）。
  { name: 'anonymous-390x844-coarse', width: 390, height: 844, touch: true, authenticated: false, login: 'reject' },
  { name: 'auth-init-pending-390x844-coarse', width: 390, height: 844, touch: true, authenticated: false, login: 'resolve', authInit: 'pending', authTimeout: 120_000 },
  { name: 'auth-init-reject-390x844-coarse', width: 390, height: 844, touch: true, authenticated: false, login: 'resolve', authInit: 'reject', authTimeout: 120_000 },
  // Admin 与普通登录用户能力集合相同。
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
  // 统一回放面板后 3D 不再是独立能力标签：先点「回放」再切 3D 模式。
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
  // 3D 的「真实点击」是面板内的模式开关（3D 不再是独立标签）；其余能力仍是标签点击。
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
        // 射击复现全屏（Android 手机横屏尺寸）：退出按钮可达、不裁切、列表与详情可达、退出后状态保持
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
      // compact 窗格（< 600）：点一发直接进入射击复现，不经检视面板（design-language §9「射击分析」）
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

/**
 * 3D 阵容车道的**真实几何**回归（review blocker：源码级 CSS 断言证明不了最终渲染）。
 * 每个场景走真实用户路径：选文件 → 真实点击切 3D 能力 → 真实点击「开始」（走过待开播
 * 闸门）→ 经 ?debug 注入口喂入就绪态（两队名单非空 / unknown 非空 / killfeed）→ 用
 * getBoundingClientRect 断言：三块名单两两不重叠、不覆盖 HUD 子面板、不覆盖底部控制条、
 * 全部位于 pb-root 内。宽档 normal 7v7 全员可见且无 team/lane 内滚动；phone/短视口
 * 必须由 Display 打开临时 roster surface，打开即关闭 Display，dismiss 即归还完整场景。
 */
/**
 * `getBoundingClientRect` 断言：三块名单两两不重叠、不覆盖 HUD 子面板、不覆盖底部控制条、
 * 全部位于 pb-root 内；每个可见行都要有 HP 数值与百分比且不被截断。
 *
 * `transient` 不是「手机 / 矮视口」的别名，而是**名册放不放得下**的实测结论
 * （`Replay3DPane` 的 `rosterConstrained`）。7v7 全员 16 行的真实名册需要约 534px 车道高，
 * 而 `.pb-root` 的高度上限是 `clamp(320px, 62dvh, 720px)` —— 战场必须占主导，900 高的视口
 * 只给出 558px 根高，HUD 与传输控件再各占 127 / 120px，车道只剩 313px。
 * 所以 1600×900 与 1024×768 上**全量名册**同样是临时面：常驻车道会溢出到控制条上，
 * 那正是这条门禁要挡住的事。
 */
/**
 * 3D 与 2D 同一个 workspace 契约：竖屏手机 = 纵向流（HUD / Stage / 传输控件 / 详情 / Team 1 /
 * Team 2）；其余（手机横屏、手机全屏横屏、平板、桌面）= `Team 1 | 正方形 Stage | Team 2`。
 * 正常 7v7 不走任何「临时名册面」，车道不出现滚动条。`unknown` 是未识别阵营的行数（排在 Team 1 下）。
 */
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
  // §form-factor：手机横屏内宽 >768 仍必须是 mobile 形态，不能落进 tablet/pc。
  { name: 'play-740x360-landscape-coarse', width: 740, height: 360, touch: true, duration: 60, form: 'pb-form-mobile' },
  { name: 'play-1024x768-tablet', width: 1024, height: 768, touch: false, duration: 60, form: 'pb-form-tablet' },
  // 审计 PB-07：iPad 横屏是触屏但有平板的可用空间，必须拿 tablet 形态（触屏只放大点击区域）
  { name: 'play-1024x768-ipad-coarse', width: 1024, height: 768, touch: true, duration: 60, form: 'pb-form-tablet' },
  { name: 'play-1440x900-desktop', width: 1440, height: 900, touch: false, duration: 60, form: 'pb-form-pc' },
  // 触屏 + 大平板（iPad Pro / Android 平板横屏）走 pc 形态：六个 primary 控件仍在 Stage 之下的
  // 中心列，速度档位展开后每个都满足 44px 点击区域（触屏自动放大 --control-h-*）。
  { name: 'play-1366x1024-tablet-coarse', width: 1366, height: 1024, touch: true, duration: 60, form: 'pb-form-pc' },
  { name: 'duration-zero-390x844-coarse', width: 390, height: 844, touch: true, duration: 0, form: 'pb-form-mobile' },
]

/** §form-factor：竖屏 → 横屏旋转后 class / hit target 必须重新正确计算，不留 stale 状态。 */
export const ROTATION_SCENARIO = {
  name: 'orientation-portrait-to-landscape-coarse',
  width: 390, height: 844, touch: true, duration: 60,
  rotateTo: { width: 844, height: 390 },
}

/** 阵容车道的真实几何断言（getBoundingClientRect，0.5px 容差吸收亚像素舍入）。 */
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

  // 无 auth gating：auth init 挂起 / 失败时数据面板也必须马上出现（远早于 auth watchdog）
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

  // —— B. 无透明 blocker：真实 hit-testing ——
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
  // 统一面板后 UI 收敛为 4 个标签：320px 也可能单行放下，不再硬要求换行；
  // 不溢出 / 标签完整 / 可点击已在上方逐项断言。
  if (scenario.width >= 768) {
    check(failures, layout?.rows === 1, `wide capability bar must stay on one row: ${JSON.stringify(layout)}`)
  }

  // —— A/C. 真实点击 ——
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
  // §3.6：结论必须稳定——不能被别的 watcher / route sync 事后改回 data/ai。
  await delay(500)
  const settled = await page.probe(capabilityStateProbe)
  check(failures, settled.playback.visible && !settled.data.visible
    && settled.tabs.find((tab) => tab.cap === 'replay')?.selected === true,
  `capability was reverted by a later watcher/route sync: ${JSON.stringify(settled)}`)
  check(failures, await page.evaluate('new URLSearchParams(location.search).get("view")') === 'battle-playback',
    'route was reverted away from ?view=battle-playback by a later watcher/route sync')
  check(failures, page.consoleErrors.length === 0, `JS errors: ${page.consoleErrors.join(' | ')}`)
  if (!scenario.authenticated) {
    const attempts = await page.evaluate('window.__wsAuth.loginCalls.length')
    check(failures, attempts === 0, `anonymous capability switch must not start login, loginCalls=${attempts}`)
  }

  // 五项能力对所有身份公开可见，身份只决定受保护能力是否挂载。
  const expectedCaps = ['data', 'replay', 'shots', 'ai']
  check(failures, JSON.stringify(state.tabs.map((t) => t.cap)) === JSON.stringify(expectedCaps),
    `capability set=${JSON.stringify(state.tabs.map((t) => t.cap))}, expected ${JSON.stringify(expectedCaps)}`)
  if (scenario.touch) {
    const small = state.tabs.filter((t) => t.minSide < 43.5)
    check(failures, small.length === 0,
      `coarse capability targets below 44px: ${JSON.stringify(small)}`)
  }

  // —— 3D 模式：统一回放面板内的 2D/3D 切换，留在同一工作台，URL 与面板一起变 ——
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

  await page.goto(`${env.origin}/scripts/browser-fixtures/playback-controls.html?duration=${scenario.duration}`)
  await page.waitFor(() => !!document.querySelector('[data-test="pb-play"]'), { label: 'playback controls' })
  const sceneHit = await sceneHitTarget(page)

  const before = await page.probe(playbackControlProbe)
  // §landscape：非全屏手机横屏时地图按宽度定尺寸，方形地图可以比视口还高，
  // controls 因此排在首屏之外。要求不是「永远在首屏」，而是「可以滚动到并真的可点」。
  const control = before.hitIsButton ? before : await page.revealControl('[data-test="pb-play"]')
  check(failures, control.hitIsButton,
    `play button center hit ${control.hitDescription} instead (viewport=${control.viewportWidth}x${control.viewportHeight} geometry=${JSON.stringify(control.geometry)})`)
  // 命中区必须在档位控件真正进入视口后测量：1024×768 平板的地图高于视口，
  // 控件条会换行且档位可能在首屏之外；此时 elementFromPoint 返回 null 是可达性问题，
  // 不是命中区问题。先滚到档位控件本身，再判定 44×44 的可点范围。
  const speed = scenario.touch && !control.speedHit
    ? await page.revealControl('[data-test="pb-speed-current"]')
    : control
  if (scenario.touch && speed.speedHit != null) {
    check(failures, speed.speedHit,
      `touch speed option must expose a ${sceneHit}x${sceneHit} hit target: ${JSON.stringify(speed.speedHitDetail)}`)
  }
  // 速度档位是渐进披露：常驻只有当前值，展开后是一列档位菜单——档位齐全、不越出自身容器、
  // 触屏每个档位都满足场景命中下限（紧凑档 40px、常规触屏 44px）。菜单是覆盖层，不参与控件条高度。
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
    // duration<=0 是不可用时间线：控件必须显式不可用并给出原因，不得「看起来能用但什么都不发生」。
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

  // 旋转：同一页面，只改 viewport —— 模拟真机 orientationchange。
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

/**
 * §mobile-fullscreen：手机横屏全屏与**非全屏横屏是同一个几何**——Team 1 | 正方形 Stage | Team 2，
 * 播放控件在 Stage 之下，没有常驻左栏；⚙ 打开的是锚定在 gear 上的 Display 浮面。
 * 早先「148px navigation rail | map」的模型已整体移除，这里锁的是替代它的契约：
 * 全屏本身不产生任何常驻侧栏，⚙ 的浮面既不离开 gear 也不越出视口。
 */
/**
 * §2d-toolbar-collapse / §roster-overlay：2D 工具栏折叠与名册浮层的真浏览器交互回归。
 * 夹具 = playback-controls.html（生产 BattlePlayback + 生产 CSS）：
 *   · 手机横屏默认收纳名册、Desktop / 平板默认展开；
 *   · 传输条折叠后只剩恢复入口（命中测试必须命中按钮本身）；
 *   · 名册浮层开合不得改变地图正方形面积（mapShare 独立度量），浮层不得盖住传输控件；
 *   · 展开状态下选中名册行、+5s seek 与播放都必须继续正确。
 */
export const ONBOARDING_SCENARIOS = [...['zh', 'en', 'ru'].flatMap(language => ['summer', 'winter'].flatMap(profile =>
  [{ width: 1600, height: 1000, touch: false }, { width: 1024, height: 900, touch: false }, { width: 390, height: 844, touch: true }]
    .map(viewport => ({ ...viewport, language, profile, name: `onboarding-${language}-${profile}-${viewport.width}` })))),
  { name: 'onboarding-fullscreen-844', width: 844, height: 390, touch: true, language: 'zh', profile: 'summer', fullscreen: true },
  { name: 'onboarding-narrow-desktop-840', width: 840, height: 900, touch: false, language: 'zh', profile: 'summer' },
  { name: 'onboarding-fullscreen-transition-844', width: 844, height: 390, touch: true, language: 'zh', profile: 'summer', fullscreen: true, fullscreenTransition: true }]
export let onboardingServer = null
export async function runOnboardingScenario(env, scenario) {
  // Actual pinned WASM and the actual sample: only the external auth/profile boundary is stubbed.
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
    // 3D remains explicitly user-started; browser gate checks teaching/navigation, not GPU appearance.
    if (!skippedInFullscreen) {
      await page.waitForValue('new URLSearchParams(location.search).get("view")', value => value === 'agent-replay', { label: '3D guide destination' })
      if (scenario.fullscreenTransition) {
        await page.waitFor(() => !!document.querySelector('[data-tour="replay3d-start"]'), { label: 'real 3D start controls mounted' })
        const handoff = await page.evaluate(`(() => {
          const start=document.querySelector('[data-tour="replay3d-start"]'),root=document.fullscreenElement;
          return {fullscreen:!!root,fullscreenOwner:root?.dataset.tour,
            startInsideOwner:!root||root.contains(start),startWidth:start.getBoundingClientRect().width,
            guideWidth:document.querySelector('[data-testid="onboarding-card"]')?.getBoundingClientRect().width};
        })()`)
        if (!handoff.startInsideOwner || !handoff.startWidth || !handoff.guideWidth) throw new Error(`fullscreen capability handoff trapped the guide ${JSON.stringify(handoff)}`)
        // 紧凑形态的镜头在 Display 面里：真实点「开始」后教程自动推进，必须自己把面打开，目标才存在
        // 原地点：先滚到屏幕正中会把按钮送到教程卡片下面，真实用户不会这样滚
        const startPoint = await page.evaluate(`(() => {
          const button = document.querySelector('[data-test="replay3d-start"]')
          const r = button.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2
          return { x, y, onButton: button.contains(document.elementFromPoint(x, y)) }
        })()`)
        check(failures, startPoint.onButton, `3D start must be reachable beside the guide card: ${JSON.stringify(startPoint)}`)
        await page.tap({ ...startPoint, touch: scenario.touch })
        await page.waitForValue('document.querySelector("[data-testid=onboarding-card]")?.dataset.anchor', value => value === 'replay3d-camera',
          { timeout: 60_000, label: 'guide auto-advances to the camera stage' })
        await page.waitFor(() => !!document.querySelector('.pb-root.compact-bar [data-testid="display-panel"] [data-tour="replay3d-camera"]'),
          { label: 'compact guide opens Display and the camera anchor exists' })
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

// #727：真实 MenuButton + 当前三项导出文案；短视口在上下两侧都放不下整个菜单。
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
  // 键盘导航本身必须把末项/首项滚入可用区；不能靠测试先 scrollIntoView 掩盖它。
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

  // 每一项都用原始触摸/鼠标选择；回调结果和菜单关闭共同证明事件真正到达。
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
  // 菜单打开时缩短并恢复视口，覆盖浏览器可用空间动态变化；不声称模拟真实软键盘。
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
  results.push({ name: scenario.name, failures: [...failures, ...page.consoleErrors], viewport: `${scenario.width}x${scenario.height}` })
}


export async function closeOnboardingServer() {
  if (onboardingServer) await onboardingServer.server.close()
}
