import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page, delay } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

/**
 * Browser-level interaction regression for the Replay Workspace capability tabs and the
 * Battle Playback transport controls.
 *
 * 为什么必须是真浏览器：本次回归的两类症状（「点了没反应」、透明层吃掉 pointer）在 jsdom 里
 * 结构上不可见 —— jsdom 没有真实布局/层叠/hit-testing，`elementFromPoint` 恒为 null。
 * 因此这里启动真实 Chrome（独立 user-data-dir）、按设备指标仿真 mobile/tablet/desktop，
 * 用真实输入管线（鼠标 / 触摸原始事件）点击真实坐标，并断言
 * `document.elementFromPoint(按钮中心)` 确实命中按钮本身。
 *
 * 与 `browser-playback-layout.mjs` 的分工：
 *   - 那个是 file:// + 生产 CSS 的**几何**夹具（布局/尺寸契约）；
 *   - 本文件是 Vite dev server + **真实生产应用**（router/AppShell/ReplayWorkspace/全部 CSS）
 *     的**交互**夹具，只把 Keycloak 网络边界替换掉（见 browser-fixtures/*-stub.js）。
 *
 * 通用能力（设备仿真 / 真实输入 / 输入落点记录 / 求值等待）在 browser-page.mjs，
 * 应用夹具服务器在 browser-fixtures/fixture-server.mjs —— 与 browser-armor-mobile.mjs 共用。
 */

/* ------------------------------------------------------------------ 页面内探针
   写成真实函数再序列化执行，避免模板字符串里的转义错误。 */

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
  const tabs = Array.from(document.querySelectorAll('[data-testid="ws-tab"]')).map((tab) => ({
    cap: tab.dataset.cap,
    selected: tab.getAttribute('aria-selected') === 'true',
    active: tab.classList.contains('is-active'),
  }))
  const dialog = document.querySelector('.global-error-modal')
  const overlay = dialog ? dialog.closest('.dialog-scrim') : null
  return {
    tabs,
    data: pane('ws-data'),
    ai: pane('ws-ai'),
    playback: pane('ws-playback'),
    errorDialog: dialog
      ? { text: dialog.textContent.trim(), visible: !!overlay && getComputedStyle(overlay).display !== 'none' }
      : null,
  }
}

/** 3D / 射击 pane 就地在工作台内切换时的工作台状态（页面内探针，供 page.probe 使用）。 */
function workspacePaneProbe() {
  const pane = document.querySelector('[data-testid="ws-3d"]')
  const data = document.querySelector('[data-testid="ws-data"]')
  return {
    view: new URLSearchParams(location.search).get('view'),
    tabsVisible: !!document.querySelector('.workspace-tabs'),
    workspaceRoot: !!document.querySelector('.replay-workspace'),
    paneDisplay: pane ? getComputedStyle(pane).display : null,
    dataDisplay: data ? getComputedStyle(data).display : null,
    // 无已选回放时内核不建 canvas（场景在 loadData 后才创建）：用组件根 + 空态提示证明
    // 这个 pane 真的是 3D 回放视图（而不是空壳）
    paneHasView: !!document.querySelector('[data-testid="ws-3d"] .pb-root'),
    paneEmptyHint: !!document.querySelector('[data-testid="ws-3d"] [data-test="replay3d-source-hint"]'),
  }
}

function playbackControlProbe() {
  const play = document.querySelector('[data-test="pb-play"]')
  const root = document.querySelector('[data-test="battle-playback"]')
  if (!play) return { found: false, root: !!root }
  const rect = play.getBoundingClientRect()
  const center = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
  const hit = document.elementFromPoint(center.x, center.y)
  const time = document.querySelector('[data-test="pb-time"]')
  const reason = document.querySelector('[data-test="pb-play-unavailable"]')
  return {
    found: true,
    disabled: play.disabled === true,
    ariaDisabled: play.getAttribute('aria-disabled'),
    unavailableReason: reason ? reason.textContent.trim() : null,
    time: time ? time.textContent.trim() : null,
    center,
    hitIsButton: hit === play || play.contains(hit),
    hitDescription: hit
      ? `${hit.tagName}${typeof hit.className === 'string' && hit.className.trim() ? `.${hit.className.trim().split(/\s+/).join('.')}` : ''}`
      : null,
    formClass: root ? Array.from(root.classList).find((name) => name.startsWith('pb-form-')) || null : null,
    /** 所有可见速度档位按钮的最小边（触屏点击区域契约：≥ 44px） */
    speedMinSide: (() => {
      const sides = [...document.querySelectorAll('[data-test^="pb-speed-"]')]
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => Math.min(r.width, r.height))
      return sides.length ? Math.min(...sides) : null
    })(),
    /** rail 模式下速度档位必须一行排开且不撑出 rail（档位个数变化时的回归点） */
    railSpeeds: (() => {
      const group = document.querySelector('.pb-controls-rail-mode .pb-speed')
      if (!group) return null
      const container = group.closest('.pb-left-rail') || group.parentElement
      const limit = container.getBoundingClientRect()
      const buttons = [...group.querySelectorAll('[data-test^="pb-speed-"]')].map((b) => b.getBoundingClientRect())
      return {
        count: buttons.length,
        rows: new Set(buttons.map((r) => Math.round(r.top))).size,
        overflow: buttons.some((r) => r.left < limit.left - 1 || r.right > limit.right + 1),
        minSide: Math.min(...buttons.map((r) => Math.min(r.width, r.height))),
      }
    })(),
    pageScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    /** 排除滚动条后的真实内容宽度：区分「真横向溢出」与 innerWidth 含滚动条的假阳性。 */
    contentWidth: document.documentElement.clientWidth,
    /** 横向溢出时直接点名越界的元素，避免只报一个差值。 */
    overflowing: (() => {
      const limit = document.documentElement.clientWidth
      const offenders = []
      for (const element of document.body.querySelectorAll('*')) {
        const r = element.getBoundingClientRect()
        if (r.width === 0) continue
        if (r.right > limit + 1 || r.left < -1) {
          const cls = typeof element.className === 'string' && element.className.trim()
            ? `.${element.className.trim().split(/\s+/).join('.')}`
            : ''
          offenders.push(`${element.tagName}${cls}[${Math.round(r.left)}..${Math.round(r.right)}]`)
          if (offenders.length >= 6) break
        }
      }
      return offenders
    })(),
    /** 几何诊断：控件被挤出视口时，直接指出是谁把它推下去的。 */
    geometry: (() => {
      const box = (selector) => {
        const element = document.querySelector(selector)
        if (!element) return null
        const r = element.getBoundingClientRect()
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) }
      }
      return {
        mapStage: box('.pb-map-stage'),
        map: box('.pb-map'),
        overlay: box('.pb-mobile-overlay'),
        overlayContent: box('.pb-mobile-overlay-content'),
        playTop: Math.round(rect.top),
        playBottom: Math.round(rect.bottom),
      }
    })(),
  }
}

/* ------------------------------------------------------------------ 页面驱动 */

/** 场景失败时的现场快照探针（应用专属；通用外壳在 browser-page.mjs）。 */
function workspaceDiagnosticsProbe() {
  const present = (selector) => !!document.querySelector(selector)
  return {
    authStubLoaded: typeof window.__wsAuth === 'object' && window.__wsAuth !== null,
    appMounted: !!document.querySelector('#app')?.firstElementChild,
    tabs: document.querySelectorAll('[data-testid="ws-tab"]').length,
    dataPane: present('[data-testid="ws-data"]'),
    playbackPane: present('[data-testid="ws-playback"]'),
    inputTrace: window.__inputTrace || null,
    url: location.href,
  }
}


const results = []

/** 最近一次创建的场景页面：场景抛错时用它打印现场（诊断用，不参与断言）。 */
let lastPage = null

function check(failures, ok, message) {
  if (!ok) failures.push(message)
}

/* ------------------------------------------------------------------ 场景 */

const APP_SCENARIOS = [
  { name: 'capability-375x812-portrait-coarse', width: 375, height: 812, touch: true, authenticated: true, login: 'resolve' },
  { name: 'capability-390x844-portrait-coarse', width: 390, height: 844, touch: true, authenticated: true, login: 'resolve' },
  { name: 'capability-740x360-landscape-coarse', width: 740, height: 360, touch: true, authenticated: true, login: 'resolve' },
  { name: 'capability-1024x768-tablet', width: 1024, height: 768, touch: false, authenticated: true, login: 'resolve' },
  { name: 'capability-1600x900-desktop', width: 1600, height: 900, touch: false, authenticated: true, login: 'resolve' },
  // 3D 回放 / 射击分析已并入工作台：admin 下点这两个 tab 必须**留在工作台内**（tab 栏保留、
  // pane 就地切换），不再跳到独立页面。admin 角色由 auth stub 的 ws-roles 提供。
  { name: 'capability-admin-3d-tab-390x844-coarse', width: 390, height: 844, touch: true, authenticated: true, login: 'resolve', roles: 'wotbtools-admin', adminPanes: true },
  // 服务器没有 parser，工作台没有 auth gating：未登录、auth init 挂起 / 失败时都立即可用，且不发起登录。
  // pending 的 watchdog 设得远长于场景本身——工作台必须在 auth init 仍挂起时就渲染（不能等超时兜底）。
  { name: 'anonymous-390x844-coarse', width: 390, height: 844, touch: true, authenticated: false, login: 'reject' },
  { name: 'auth-init-pending-390x844-coarse', width: 390, height: 844, touch: true, authenticated: false, login: 'resolve', authInit: 'pending', authTimeout: 120_000 },
  { name: 'auth-init-reject-390x844-coarse', width: 390, height: 844, touch: true, authenticated: false, login: 'resolve', authInit: 'reject', authTimeout: 120_000 },
]

const PLAYBACK_SCENARIOS = [
  { name: 'play-390x844-coarse', width: 390, height: 844, touch: true, duration: 60, form: 'pb-form-mobile' },
  // §form-factor：手机横屏内宽 >768 仍必须是 mobile 形态，不能落进 tablet/pc。
  { name: 'play-740x360-landscape-coarse', width: 740, height: 360, touch: true, duration: 60, form: 'pb-form-mobile' },
  { name: 'play-1024x768-tablet', width: 1024, height: 768, touch: false, duration: 60, form: 'pb-form-tablet' },
  // 审计 PB-07：iPad 横屏是触屏但有平板的可用空间，必须拿 tablet 形态（触屏只放大点击区域）
  { name: 'play-1024x768-ipad-coarse', width: 1024, height: 768, touch: true, duration: 60, form: 'pb-form-tablet' },
  { name: 'play-1440x900-desktop', width: 1440, height: 900, touch: false, duration: 60, form: 'pb-form-pc' },
  // 触屏 + rail：视口 >1200 的大平板（iPad Pro / Android 平板横屏）走 pc 形态，控件进 rail；
  // 速度档位必须一行排开且每个都满足 44px 点击区域（rail 在触屏上自动加宽）
  { name: 'play-1366x1024-tablet-coarse-rail', width: 1366, height: 1024, touch: true, duration: 60, form: 'pb-form-pc' },
  { name: 'duration-zero-390x844-coarse', width: 390, height: 844, touch: true, duration: 0, form: 'pb-form-mobile' },
]

/** §form-factor：竖屏 → 横屏旋转后 class / hit target 必须重新正确计算，不留 stale 状态。 */
const ROTATION_SCENARIO = {
  name: 'orientation-portrait-to-landscape-coarse',
  width: 390, height: 844, touch: true, duration: 60,
  rotateTo: { width: 844, height: 390 },
}

async function runAppScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)

  const authParams = scenario.authInit
    ? `&ws-auth-init=${scenario.authInit}&ws-auth-timeout-ms=${scenario.authTimeout ?? 12_000}`
    : ''
  const url = `${env.origin}/?view=replay&ws-auth=${scenario.authenticated ? 1 : 0}&ws-login=${scenario.login}${authParams}${scenario.roles ? `&ws-roles=${scenario.roles}` : ''}`
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
  // §3D-capability：3D 回放 / 射击分析并入工作台后，admin 点这两个 tab 必须留在工作台内
  if (scenario.adminPanes) {
    const tabPoint = async (cap) => page.evaluate(`(() => {
      const b = document.querySelector('.workspace-tabs [data-testid="ws-tab"][data-cap="${cap}"]')
      if (!b) return null
      const r = b.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })()`)

    const threeDPoint = await tabPoint('3d')
    check(failures, !!threeDPoint, 'admin 场景缺少 3D 回放 tab')
    if (threeDPoint) {
      await page.tap({ ...threeDPoint, touch: scenario.touch })
      const entered = await page
        .waitForValue(`new URLSearchParams(location.search).get('view')`, (value) => value === 'agent-replay', { timeout: 10_000, label: 'view=agent-replay' })
        .then(() => page.waitForValue(`(() => { const p = document.querySelector('[data-testid="ws-3d"]'); return !!p && getComputedStyle(p).display !== 'none' })()`, (value) => value === true, { timeout: 10_000, label: '3D pane visible' })
          // 场景内核是懒加载 async 组件：等组件根真正挂进 pane（否则 pane 只是空壳）
          .then(() => page.waitForValue(`!!document.querySelector('[data-testid="ws-3d"] .pb-root')`, (value) => value === true, { timeout: 15_000, label: '3D pane view root' }).catch(() => null))
          .then(() => page.probe(workspacePaneProbe))
          .catch(() => null))
        .catch(() => null)
      check(failures, !!entered, '点击 3D tab 后没有进入工作台内的 3D pane（可能又跳独立页面）')
      if (entered) {
        check(failures, entered.tabsVisible, '切到 3D 后工作台 tab 栏消失（回到独立页面形态）')
        check(failures, entered.workspaceRoot, '切到 3D 后工作台根容器消失')
        check(failures, entered.dataDisplay === 'none', `切到 3D 后数据 pane 仍可见（display=${entered.dataDisplay}）`)
        check(failures, entered.paneHasView && entered.paneEmptyHint,
          `3D pane 内不是 3D 回放视图（view=${entered.paneHasView} emptyHint=${entered.paneEmptyHint}）`)
      }
      // 切回数据：pane 保留（状态不丢），tab 栏仍在
      const dataPoint = await tabPoint('data')
      check(failures, !!dataPoint, 'admin 场景缺少数据 tab')
      if (dataPoint) {
        await page.tap({ ...dataPoint, touch: scenario.touch })
        const back = await page
          .waitForValue(`new URLSearchParams(location.search).get('view')`, (value) => value === 'replay', { timeout: 10_000, label: 'view=replay' })
          .then(() => page.probe(workspacePaneProbe))
          .catch(() => null)
        check(failures, !!back && back.paneDisplay === 'none', `切回数据后 3D pane 未隐藏（${JSON.stringify(back)}）`)
        check(failures, !!back && back.tabsVisible, '切回数据后工作台 tab 栏消失')
      }
    }
  }
  check(failures, page.consoleErrors.length === 0, `JS errors: ${page.consoleErrors.join(' | ')}`)
  if (!scenario.authenticated) {
    const attempts = await page.evaluate('window.__wsAuth.loginCalls.length')
    check(failures, attempts === 0, `anonymous capability switch must not start login, loginCalls=${attempts}`)
  }

  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
}

async function runPlaybackControlScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)

  await page.goto(`${env.origin}/scripts/browser-fixtures/playback-controls.html?duration=${scenario.duration}`)
  await page.waitFor(() => !!document.querySelector('[data-test="pb-play"]'), { label: 'playback controls' })

  const before = await page.probe(playbackControlProbe)
  // §landscape：非全屏手机横屏时地图按宽度定尺寸，方形地图可以比视口还高，
  // controls 因此排在首屏之外。要求不是「永远在首屏」，而是「可以滚动到并真的可点」。
  const control = before.hitIsButton ? before : await page.revealControl('[data-test="pb-play"]', playbackControlProbe)
  check(failures, control.hitIsButton,
    `play button center hit ${control.hitDescription} instead (viewport=${control.viewportWidth}x${control.viewportHeight} geometry=${JSON.stringify(control.geometry)})`)
  if (before.railSpeeds) {
    check(failures, before.railSpeeds.rows === 1,
      `rail speed options wrapped onto ${before.railSpeeds.rows} rows (${before.railSpeeds.count} options)`)
    check(failures, !before.railSpeeds.overflow, 'rail speed options overflow the rail')
  }
  if (scenario.touch && before.speedMinSide != null) {
    check(failures, before.speedMinSide >= 43.5,
      `touch speed option hit target is ${before.speedMinSide.toFixed(1)}px, below 44px`)
  }
  if (scenario.name.endsWith('-rail')) {
    check(failures, !!before.railSpeeds, 'expected the playback controls to be in the rail')
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

  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
}

async function runRotationScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
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
  check(failures, after.pageScrollWidth <= after.viewportWidth + 1,
    `after rotation page-level horizontal overflow: ${after.pageScrollWidth} > ${after.viewportWidth} (contentWidth=${after.contentWidth} geometry=${JSON.stringify(after.geometry)})`)
  const control = after.hitIsButton ? after : await page.revealControl('[data-test="pb-play"]', playbackControlProbe)
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

  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `rotate ${scenario.width}x${scenario.height} -> ${scenario.rotateTo.width}x${scenario.rotateTo.height}` })
}

/**
 * §mobile-fullscreen：手机横屏全屏是「148px navigation rail | map」，播放控件仍在底部 overlay。
 * 触屏 rail 的 248px 下限只属于「控件真的在 rail 里」的大平板，不得通过 inline --pb-rail-w
 * 盖掉 mobile fullscreen 的 148px（inline style 优先级高于 CSS 规则）；用户在桌面拖过、持久化在
 * localStorage 的 rail 宽度同样不得盖掉它。
 */
const MOBILE_FULLSCREEN_SCENARIOS = [
  { name: 'fullscreen-740x360-landscape-coarse', width: 740, height: 360, touch: true, duration: 60 },
  {
    name: 'fullscreen-740x360-landscape-coarse-persisted-rail',
    width: 740, height: 360, touch: true, duration: 60,
    paneWidths: { rail: 320, details: null },
  },
]

async function runMobileFullscreenScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)
  if (scenario.paneWidths) {
    // mount 前写入持久化偏好（模拟此前在桌面拖过 rail）
    await env.chrome.client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { localStorage.setItem('wotb.pb.pane-widths', ${JSON.stringify(JSON.stringify(scenario.paneWidths))}) } catch {}`,
    }, sessionId)
  }

  await page.goto(`${env.origin}/scripts/browser-fixtures/playback-controls.html?duration=${scenario.duration}`)
  await page.waitFor(() => !!document.querySelector('[data-test="pb-fullscreen"]'), { label: 'fullscreen button' })
  await page.evaluate(`document.querySelector('[data-test="pb-fullscreen"]').scrollIntoView({ block: 'center' })`)
  const button = await page.evaluate(`(() => {
    const r = document.querySelector('[data-test="pb-fullscreen"]').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  // 真实触摸 = user gesture，requestFullscreen 才会被浏览器放行
  await page.tap({ ...button, touch: scenario.touch })
  await page.waitFor(() => !!document.fullscreenElement, { timeout: 5000, label: 'document.fullscreenElement' })
  await delay(200)

  const state = await page.evaluate(`(() => {
    const root = document.querySelector('[data-test="battle-playback"]')
    const rail = root.querySelector('.pb-left-rail')
    return {
      fullscreenIsRoot: document.fullscreenElement === root,
      formClass: Array.from(root.classList).find((n) => n.startsWith('pb-form-')) || null,
      persisted: localStorage.getItem('wotb.pb.pane-widths'),
      railVar: getComputedStyle(root).getPropertyValue('--pb-rail-w').trim(),
      inlineRailVar: root.style.getPropertyValue('--pb-rail-w').trim(),
      railWidth: rail ? rail.getBoundingClientRect().width : null,
      controlsInRail: !!document.querySelector('.pb-controls-rail-mode'),
    }
  })()`)
  check(failures, state.fullscreenIsRoot, 'fullscreen element is not the playback root')
  check(failures, state.formClass === 'pb-form-mobile', `fullscreen form=${state.formClass}, expected pb-form-mobile`)
  check(failures, !state.controlsInRail, 'mobile fullscreen must keep the playback controls out of the rail')
  if (scenario.paneWidths) {
    check(failures, state.persisted === JSON.stringify(scenario.paneWidths),
      `persisted pane widths were not in place: ${state.persisted}`)
  }
  check(failures, state.inlineRailVar === '', `mobile fullscreen wrote inline --pb-rail-w=${state.inlineRailVar}`)
  check(failures, state.railVar === '148px',
    `mobile fullscreen --pb-rail-w=${state.railVar} (inline=${state.inlineRailVar || 'none'}), expected 148px`)
  check(failures, state.railWidth != null && Math.abs(state.railWidth - 148) <= 1,
    `mobile fullscreen rail rendered ${state.railWidth}px wide, expected 148px`)

  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `fullscreen ${scenario.width}x${scenario.height}` })
}

/* ------------------------------------------------------------------ main */

const chrome = findChrome()
const { server, origin } = await startFixtureServer()
let chromeCdp = null

try {
  chromeCdp = await launchChromeForCdp(chrome, {
    extraArgs: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  })
  const env = { origin, chrome: chromeCdp }
  const runs = [
    ...APP_SCENARIOS.map((scenario) => ({ scenario, run: () => runAppScenario(env, scenario) })),
    ...PLAYBACK_SCENARIOS.map((scenario) => ({ scenario, run: () => runPlaybackControlScenario(env, scenario) })),
    { scenario: ROTATION_SCENARIO, run: () => runRotationScenario(env, ROTATION_SCENARIO) },
    ...MOBILE_FULLSCREEN_SCENARIOS.map((scenario) => ({ scenario, run: () => runMobileFullscreenScenario(env, scenario) })),
  ]
  // 可选场景名过滤（调试单个形态时不必跑满矩阵）。
  const nameFilter = process.argv.slice(2).find((arg) => !arg.startsWith('-'))
  const selected = nameFilter ? runs.filter(({ scenario }) => scenario.name.includes(nameFilter)) : runs
  if (nameFilter && selected.length === 0) throw new Error(`no scenario matches "${nameFilter}"`)
  for (const { scenario, run } of selected) {
    // 单个场景抛错（例如等不到元素）不得吞掉整轮结果：记为该场景的失败后继续。
    try {
      await run()
    } catch (error) {
      results.push({
        name: scenario.name,
        failures: [error.message, ...(lastPage ? await lastPage.diagnose(workspaceDiagnosticsProbe).catch(() => []) : [])],
        viewport: `${scenario.width}x${scenario.height}`,
      })
    }
  }

  let failed = 0
  for (const result of results) {
    if (result.failures.length === 0) {
      console.log(`[browser-interaction] ${result.name} OK (${result.viewport})`)
      continue
    }
    failed += 1
    console.error(`[browser-interaction] ${result.name} FAILED (${result.viewport})`)
    for (const failure of result.failures) console.error(`  - ${failure}`)
  }
  if (failed > 0) {
    process.exitCode = 1
    console.error(`[browser-interaction] ${failed}/${results.length} scenarios failed`)
  } else {
    console.log(`[browser-interaction] all ${results.length} scenarios passed`)
  }
} finally {
  // Chrome 启动失败时也必须关掉 Vite server，否则脚本会挂在未释放的监听上而不是报错退出。
  if (chromeCdp) await chromeCdp.close()
  await server.close()
}
