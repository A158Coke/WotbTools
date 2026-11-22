import { measureReachability } from './browser-occlusion.mjs'

export function createCapabilityScenarios({ Page, setLastPage, results, check, delay, fakeAnalysisOrigin, clickCenterExpression, PARSE_LIFECYCLE_BRIDGE }) {
function capabilityHitProbe() {
  const button = document.querySelector('[data-testid="ws-tab"][data-cap="playback"]')
  if (!button) return { found: false }
  const rect = button.getBoundingClientRect()
  const center = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
  const hit = document.elementFromPoint(center.x, center.y)
  const describe = (element) => {
    if (!element) return null
    const className = typeof element.className === 'string' ? element.className.trim().split(/\s+/).filter(Boolean).join('.') : ''
    return `${element.tagName}${className ? `.${className}` : ''}`
  }
  const chain = []
  for (let node = hit; node && chain.length < 10; node = node.parentElement) chain.push(describe(node))
  const buttonStyle = getComputedStyle(button)
  return {
    found: true,
    rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    center,
    insideViewport: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
    hitIsButton: hit === button || button.contains(hit),
    hitChain: chain,
    pointerEvents: buttonStyle.pointerEvents,
    visibility: buttonStyle.visibility,
    opacity: buttonStyle.opacity,
    coarsePointer: matchMedia('(pointer: coarse)').matches,
    hoverNone: matchMedia('(hover: none)').matches,
    pageScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
  }
}

function capabilityStateProbe() {
  const pane = (testId) => {
    const element = document.querySelector(`[data-testid="${testId}"]`)
    if (!element) return { present: false, visible: false }
    return { present: true, visible: getComputedStyle(element).display !== 'none' && element.getClientRects().length > 0 }
  }
  const tabs = Array.from(document.querySelectorAll('[data-testid="ws-tab"]')).map((tab) => {
    const rect = tab.getBoundingClientRect()
    return {
      cap: tab.dataset.cap,
      role: tab.getAttribute('role'),
      // 能力切换走 canonical SegmentedControl 的 radiogroup 模型（不是 tablist）
      selected: tab.getAttribute('aria-checked') === 'true',
      active: tab.classList.contains('is-active'),
      /** 触屏点击区域（design-language §5：coarse 下 ≥ 44px） */
      minSide: Math.round(Math.min(rect.width, rect.height)),
    }
  })
  const dialog = document.querySelector('.global-error-modal')
  const overlay = dialog ? dialog.closest('.dialog-scrim') : null
  return {
    tabs,
    data: pane('ws-data'),
    ai: pane('ws-ai'),
    playback: pane('ws-playback'),
    threeD: pane('ws-3d'),
    shots: pane('ws-shots'),
    errorDialog: dialog
      ? { text: dialog.textContent.trim(), visible: !!overlay && getComputedStyle(overlay).display !== 'none' }
      : null,
  }
}

/** 能力栏的真实几何：五个入口与完整标签都在容器内，所有按钮中心可直接命中。 */
function capabilityLayoutProbe() {
  const buttons = [...document.querySelectorAll('[data-testid="ws-tab"]')]
  const group = buttons[0]?.parentElement
  if (!group) return null
  const bounds = group.getBoundingClientRect()
  return {
    rows: new Set(buttons.map(button => Math.round(button.getBoundingClientRect().top))).size,
    overflow: group.scrollWidth > group.clientWidth + 1,
    buttons: buttons.map(button => {
      const rect = button.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return {
        cap: button.dataset.cap,
        inside: rect.left >= bounds.left && rect.right <= bounds.right + 1
          && rect.top >= bounds.top && rect.bottom <= bounds.bottom + 1,
        labelFits: button.scrollWidth <= button.clientWidth + 1 && button.scrollHeight <= button.clientHeight + 1,
        hit: hit === button || button.contains(hit),
      }
    }),
  }
}

const APP_SCENARIOS = [
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

const AUTH_CAPABILITY_SCENARIOS = [
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

async function runAuthCapabilityScenario(env, scenario) {
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
  const selector = `[data-testid="ws-tab"][data-cap="${scenario.cap}"]`
  const center = await page.evaluate(clickCenterExpression(selector))
  if (!center) throw new Error(`${scenario.cap} tab must be hit-testable`)
  await page.tap({ ...center, touch: scenario.touch })
  await page.waitForValue('new URLSearchParams(location.search).get("view")', (view) => view === scenario.view,
    { label: 'capability destination' })
  const trace = await page.evaluate('window.__wsInput.click')
  check(failures, trace?.cap === scenario.cap, `real capability click landed on ${JSON.stringify(trace)}`)
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
  await env.chrome.client.send('Target.closeTarget', { targetId })
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
async function runAppScenario(env, scenario) {
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
  await page.waitFor(() => !!document.querySelector('[data-testid="ws-tab"][data-cap="playback"]'), { label: 'capability tabs' })

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
  check(failures, layout?.buttons.length === 6 && !layout.overflow,
    `six capability buttons must fit without horizontal scrolling: ${JSON.stringify(layout)}`)
  check(failures, layout?.buttons.every(button => button.inside && button.labelFits && button.hit),
    `every capability label must be visible and its button directly reachable: ${JSON.stringify(layout)}`)
  // 最窄夹具验证换行；375/390px 的中文标签在 Linux 字体下可能刚好容纳一行。
  if (scenario.width === 320) {
    check(failures, layout?.rows > 1, `portrait capability bar must wrap: ${JSON.stringify(layout)}`)
  } else if (scenario.width >= 768) {
    check(failures, layout?.rows === 1, `wide capability bar must stay on one row: ${JSON.stringify(layout)}`)
  }

  // —— A/C. 真实点击 ——
  await page.installInputTrace()
  await page.tap({ ...hit.center, touch: scenario.touch })
  const input = await page.inputTrace()
  check(failures, input?.primary?.cap === 'playback',
    `the real ${scenario.touch ? 'touchstart' : 'mousedown'} landed on ${JSON.stringify(input?.primary)} instead of the playback tab button`)
  check(failures, input?.click?.cap === 'playback',
    `the real click landed on ${JSON.stringify(input?.click)} instead of the playback tab button`)

  await page.waitForValue('new URLSearchParams(location.search).get("view")', (value) => value === 'battle-playback', { label: 'route ?view=battle-playback' })
  const state = await page.probe(capabilityStateProbe)
  check(failures, state.playback.visible, `ws-playback not visible after tap (${JSON.stringify(state.playback)})`)
  check(failures, !state.data.visible, 'ws-data still visible after switching to playback')
  const playbackTab = state.tabs.find((tab) => tab.cap === 'playback')
  check(failures, !!playbackTab && playbackTab.selected && playbackTab.active, `playback tab not marked active: ${JSON.stringify(state.tabs)}`)
  // §3.6：结论必须稳定——不能被别的 watcher / route sync 事后改回 data/ai。
  await delay(500)
  const settled = await page.probe(capabilityStateProbe)
  check(failures, settled.playback.visible && !settled.data.visible
    && settled.tabs.find((tab) => tab.cap === 'playback')?.selected === true,
  `capability was reverted by a later watcher/route sync: ${JSON.stringify(settled)}`)
  check(failures, await page.evaluate('new URLSearchParams(location.search).get("view")') === 'battle-playback',
    'route was reverted away from ?view=battle-playback by a later watcher/route sync')
  check(failures, page.consoleErrors.length === 0, `JS errors: ${page.consoleErrors.join(' | ')}`)
  if (!scenario.authenticated) {
    const attempts = await page.evaluate('window.__wsAuth.loginCalls.length')
    check(failures, attempts === 0, `anonymous capability switch must not start login, loginCalls=${attempts}`)
  }

  // 五项能力对所有身份公开可见，身份只决定受保护能力是否挂载。
  const expectedCaps = ['data', 'playback', '3d', 'events', 'shots', 'ai']
  check(failures, JSON.stringify(state.tabs.map((t) => t.cap)) === JSON.stringify(expectedCaps),
    `capability set=${JSON.stringify(state.tabs.map((t) => t.cap))}, expected ${JSON.stringify(expectedCaps)}`)
  if (scenario.touch) {
    const small = state.tabs.filter((t) => t.minSide < 43.5)
    check(failures, small.length === 0,
      `coarse capability targets below 44px: ${JSON.stringify(small)}`)
  }

  // —— 3D 能力：切过去留在同一工作台，URL 与面板一起变 ——
  const threeDTab = state.tabs.find((t) => t.cap === '3d')
  const threeDHit = await page.evaluate(`(() => {
    const button = document.querySelector('[data-testid="ws-tab"][data-cap="3d"]')
    if (!button) return null
    button.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = button.getBoundingClientRect()
    const center = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    const hit = document.elementFromPoint(center.x, center.y)
    return { center, hitIsButton: hit === button || button.contains(hit) }
  })()`)
  check(failures, !!threeDTab && !!threeDHit?.hitIsButton,
    `3D capability tab not hit-testable: ${JSON.stringify({ threeDTab, threeDHit })}`)
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

  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}`, xfail: scenario.xfail })
}


return { APP_SCENARIOS, AUTH_CAPABILITY_SCENARIOS, runAppScenario, runAuthCapabilityScenario }
}
