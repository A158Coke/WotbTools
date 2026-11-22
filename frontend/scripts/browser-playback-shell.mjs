import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export function createPlaybackShellScenarios({ Page, setLastPage, results, check, clicked, clickElement,
  clickCenterExpression, delay, startFixtureServer }) {
const PLAYBACK_COLLAPSE_SCENARIOS = [
  { name: 'pb-collapse-844x390-landscape-coarse', width: 844, height: 390, touch: true, duration: 60 },
  { name: 'pb-collapse-740x360-landscape-coarse', width: 740, height: 360, touch: true, duration: 60 },
  { name: 'pb-collapse-600x320-landscape-coarse', width: 600, height: 320, touch: true, duration: 60 },
  { name: 'pb-collapse-375x812-winter-reduced', width: 375, height: 812, touch: true, duration: 60, reduced: true, profile: 'winter' },
  { name: 'pb-collapse-1280x900-fullscreen', width: 1280, height: 900, touch: false, duration: 60, fullscreen: true },
  { name: 'pb-collapse-390x844-portrait-coarse', width: 390, height: 844, touch: true, duration: 60 },
  { name: 'pb-collapse-1280x900-desktop', width: 1280, height: 900, touch: false, duration: 60 },
]

function playbackCollapseProbe() {
  const root = document.querySelector('[data-test="battle-playback"]')
  if (!root) return { found: false }
  const rect = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
  }
  const rectOf = (sel) => rect(document.querySelector(sel))
  const laneLeft = document.querySelector('[data-test="pb-team-lane-left"]')
  const laneRight = document.querySelector('[data-test="pb-team-lane-right"]')
  const entry = document.querySelector('[data-test="pb-roster-entry"]')
  const transportContent = document.querySelector('[data-test="pb-transport-controls"]')
  const toggle = document.querySelector('[data-test="pb-transport-toggle"]')
  const map = document.querySelector('.pb-map')
  const hitSelf = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cx = Math.round(r.left + r.width / 2)
    const cy = Math.round(r.top + r.height / 2)
    const hit = document.elementFromPoint(Math.min(Math.max(cx, 1), innerWidth - 1), Math.min(Math.max(cy, 1), innerHeight - 1))
    return hit === el || el.contains(hit)
  }
  const mapRect = rect(map)
  return {
    found: true,
    phoneLandscape: root.classList.contains('pb-phone-landscape'),
    formClass: Array.from(root.classList).find((n) => n.startsWith('pb-form-')) || null,
    lanes: !!laneLeft && !!laneRight,
    laneRect: rect(laneLeft),
    laneRectRight: rect(laneRight),
    stageRect: rectOf('.pb-map-stage'),
    mapRect,
    mapShare: mapRect ? (mapRect.width * mapRect.height) / (innerWidth * innerHeight) : null,
    transportRect: rectOf('[data-test="pb-transport-slot"]'),
    rosterEntry: entry ? { pressed: entry.getAttribute('aria-pressed'), hitSelf: hitSelf(entry) } : null,
    rosterRows: document.querySelectorAll('[data-test="pb-roster-row"]').length,
    selectedRows: document.querySelectorAll('[data-test="pb-roster-row"][aria-pressed="true"]').length,
    transportContentHidden: transportContent ? getComputedStyle(transportContent).display === 'none' : null,
    contentHeight: transportContent?.getBoundingClientRect().height,
    contentTop: transportContent?.getBoundingClientRect().top,
    contentInlineHeight: transportContent?.style.height,
    toggleRect: rect(toggle),
    transportToggle: toggle ? { expanded: toggle.getAttribute('aria-expanded'), hitSelf: hitSelf(toggle), controls: toggle.getAttribute('aria-controls') } : null,
    time: document.querySelector('[data-test="pb-time"]') ? document.querySelector('[data-test="pb-time"]').textContent.trim() : null,
    pageScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
  }
}

async function captureToolbarReview(page, scenario, state) {
  const output = process.env.WOTB_TOOLBAR_REVIEW_DIR
  if (!output) return
  await mkdir(output, { recursive: true })
  const { data } = await page.client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, page.sessionId)
  await writeFile(resolve(output, `${scenario.name}-${state}.png`), Buffer.from(data, 'base64'))
}

async function runPlaybackCollapseScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  setLastPage(page)
  await page.enable()
  await page.emulate(scenario)

  await page.goto(env.origin + '/scripts/browser-fixtures/playback-controls.html?duration=' + scenario.duration + '&players=2')
  await page.waitFor(() => !!document.querySelector('[data-test="pb-play"]'), { label: 'playback controls' })
  await delay(300)
  const portrait = scenario.height > scenario.width

  await page.client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: scenario.reduced ? 'reduce' : 'no-preference' }],
  }, page.sessionId)
  await page.evaluate(`document.documentElement.dataset.uiProfile = ${JSON.stringify(scenario.profile || 'summer')}`)
  if (scenario.fullscreen) {
    const fs = await page.evaluate(`(() => {
      const button = document.querySelector('[data-test="pb-fullscreen"]')
      const r = button.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`)
    await page.tap({ ...fs, touch: false })
    await page.waitFor(() => !!document.fullscreenElement, { label: 'native fullscreen entered' })
    await delay(300)
  }
  const base = await page.probe(playbackCollapseProbe)
  check(failures, base.found, 'fixture must mount the production BattlePlayback')
  check(failures, base.pageScrollWidth <= base.viewportWidth + 1,
    'page-level horizontal overflow at default state: ' + base.pageScrollWidth + ' > ' + base.viewportWidth)

  if (base.phoneLandscape) {
    check(failures, base.lanes === false, 'phone landscape must collapse the roster overlay by default (map first)')
    check(failures, !!base.rosterEntry && base.rosterEntry.pressed === 'false' && base.rosterEntry.hitSelf === true,
      'phone landscape must keep a reachable roster entry in the transport bar (off by default)')
  } else if (!portrait) {
    check(failures, base.lanes === true, 'desktop / tablet landscape must expand the roster overlay by default')
    check(failures, !!base.rosterEntry && base.rosterEntry.pressed === 'true' && base.rosterEntry.hitSelf === true,
      'desktop / tablet roster entry must exist, be pressed and hit-testable')
  }

  const collapsedMapWidth = base.mapRect ? base.mapRect.width : null

  if (!portrait) {
    // Desktop / 平板默认展开：先归位到「收纳」基线，再从它验证展开语义。
    if (base.lanes) {
      const resetRes = await clickElement(page, '[data-test="pb-roster-entry"]')
      check(failures, clicked(resetRes), 'roster entry baseline collapse click failed: ' + resetRes)
    }
    const collapsedShare = (await page.probe(playbackCollapseProbe)).mapShare
    const expandRes = await clickElement(page, '[data-test="pb-roster-entry"]')
    check(failures, clicked(expandRes), 'roster entry click failed: ' + expandRes)
    const open = await page.probe(playbackCollapseProbe)
    check(failures, open.lanes === true, 'roster entry must expand both overlay lanes')
    check(failures, open.rosterEntry.pressed === 'true', 'roster entry must report aria-pressed=true while open')
    check(failures, Math.abs(open.mapRect.width - collapsedMapWidth) <= 1,
      'roster overlay must not change the map square (collapsed=' + collapsedMapWidth + ' open=' + open.mapRect.width + ')')
    check(failures, open.mapShare >= collapsedShare - 0.001,
      'roster overlay must not reduce map viewport share (' + collapsedShare + ' -> ' + open.mapShare + ')')
    check(failures, open.laneRect.left >= open.stageRect.left - 0.5 && open.laneRectRight.right <= open.stageRect.right + 0.5,
      'roster lanes must stay inside the map stage horizontally')
    check(failures, open.laneRect.bottom <= open.transportRect.top + 1,
      'expanded roster lane must not cover the transport controls (lane.bottom=' + open.laneRect.bottom + ' transport.top=' + open.transportRect.top + ')')
    check(failures, Math.abs(open.laneRect.width - open.laneRectRight.width) <= 0.5, 'both roster lanes must share one width')

    const rowRes = await clickElement(page, '[data-test="pb-team-lane-left"] [data-test="pb-roster-row"]')
    check(failures, clicked(rowRes), 'roster row click failed: ' + rowRes)
    const selected = await page.probe(playbackCollapseProbe)
    check(failures, selected.selectedRows >= 1, 'clicking an expanded roster row must select that vehicle')
    const timeBeforeSeek = selected.time
    const seekRes = await clickElement(page, '[data-test="pb-fwd5"]')
    check(failures, clicked(seekRes), '+5s click failed: ' + seekRes)
    const afterSeek = await page.waitForValue(
      'document.querySelector(\'[data-test="pb-time"]\').textContent.trim()',
      (value) => value !== timeBeforeSeek,
      { timeout: 5000, label: 'clock after +5s with roster open' },
    ).catch(() => null)
    check(failures, afterSeek !== null, '+5s was a silent no-op with the roster overlay open: clock stayed ' + timeBeforeSeek)

    const collapseRes = await clickElement(page, '[data-test="pb-roster-entry"]')
    check(failures, clicked(collapseRes), 'roster entry collapse click failed: ' + collapseRes)
    const closed = await page.probe(playbackCollapseProbe)
    check(failures, closed.lanes === false, 'roster entry must collapse both overlay lanes')
    check(failures, Math.abs(closed.mapRect.width - collapsedMapWidth) <= 1,
      'collapsing the roster must restore the map square (' + collapsedMapWidth + ' -> ' + closed.mapRect.width + ')')
    check(failures, closed.pageScrollWidth <= closed.viewportWidth + 1,
      'page-level horizontal overflow with the roster expanded: ' + closed.pageScrollWidth + ' > ' + closed.viewportWidth)
  }

  await captureToolbarReview(page, scenario, 'expanded')
  const beforeCollapse = await page.probe(playbackCollapseProbe)
  check(failures, Math.abs(beforeCollapse.toggleRect.top - beforeCollapse.contentTop) <= 1, 'expanded toggle must sit at the top right of the content')
  const timeBeforeCollapse = beforeCollapse.time
  await page.evaluate(`document.querySelector('[data-test="pb-play"]').focus()`)
  const toggleRes = await clickElement(page, '[data-test="pb-transport-toggle"]')
  check(failures, clicked(toggleRes), 'transport toggle click failed: ' + toggleRes)
  // Observe actual production layout at intermediate animation frames, not just classes.
  const frames = await page.evaluate(`new Promise(resolve => {
    const samples = []
    const start = performance.now()
    function frame() {
      const content = document.querySelector('[data-test="pb-transport-controls"]')
      const button = document.querySelector('[data-test="pb-transport-toggle"]')
      samples.push({ height: content.getBoundingClientRect().height, right: button.getBoundingClientRect().right, inert: content.inert })
      if (performance.now() - start < 750) requestAnimationFrame(frame)
      else resolve(samples)
    }
    requestAnimationFrame(frame)
  })`)
  const collapsed = await page.probe(playbackCollapseProbe)
  await captureToolbarReview(page, scenario, 'collapsed')
  check(failures, collapsed.transportContentHidden === true, 'collapsing must remove the measured content from layout')
  check(failures, collapsed.contentInlineHeight === '', 'completed collapse must clear inline height')
  check(failures, frames.every(frame => frame.inert), 'collapsing content must immediately reject focus and input')
  check(failures, frames.every(frame => Math.abs(frame.right - beforeCollapse.toggleRect.right) <= 1), 'toggle must not jump horizontally during collapse')
  check(failures, Math.abs(collapsed.toggleRect.right - collapsed.transportRect.right) <= 1, 'restore entry must stay at the right edge of its slot')
  const intermediate = frames.some(frame => frame.height > 0 && frame.height < beforeCollapse.contentHeight - 0.5)
  check(failures, scenario.reduced ? !intermediate : intermediate, 'height interpolation must follow reduced-motion preference')
  check(failures, collapsed.transportToggle.expanded === 'false' && collapsed.transportToggle.hitSelf === true,
    'collapsed toolbar must leave a reachable restore entry')
  check(failures, collapsed.time === timeBeforeCollapse, 'collapse must preserve the clock')
  check(failures, await page.evaluate(`document.activeElement === document.querySelector('[data-test="pb-transport-toggle"]')`), 'focus in collapsing content must return to the restore entry')
  for (const type of ['keyDown', 'keyUp']) {
    await page.client.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r', unmodifiedText: '\r' } : {}) }, page.sessionId)
  }

  await page.waitFor(() => document.querySelector('[data-test="pb-transport-toggle"]').getAttribute('aria-expanded') === 'true', { label: 'keyboard restores toolbar' })
  await page.waitFor(() => !document.querySelector('.pb-transport-slide-enter-active, .pb-transport-slide-leave-active'), { label: 'toolbar expand finished' })
  const restored = await page.probe(playbackCollapseProbe)
  check(failures, restored.transportContentHidden === false && restored.contentInlineHeight === '', 'restore must release natural height')
  check(failures, Math.abs(restored.toggleRect.right - beforeCollapse.toggleRect.right) <= 1, 'restore must preserve horizontal alignment')
  check(failures, restored.time === timeBeforeCollapse, 'restore must preserve the clock')
  check(failures, Math.abs(restored.toggleRect.top - restored.contentTop) <= 1, 'restored toggle must return to the top right')

  if (!scenario.reduced) {
    const reversal = await page.evaluate(`new Promise(resolve => {
      const content = document.querySelector('[data-test="pb-transport-controls"]')
      const toggle = document.querySelector('[data-test="pb-transport-toggle"]')
      toggle.click()
      setTimeout(() => {
        const before = content.getBoundingClientRect().height
        toggle.click()
        requestAnimationFrame(() => requestAnimationFrame(() => resolve({ before, after: content.getBoundingClientRect().height, full: content.scrollHeight })))
      }, 150)
    })`)
    check(failures, reversal.before > 0 && reversal.before < reversal.full, 'reversal must interrupt a running slide')
    check(failures, reversal.after > 0 && reversal.after < reversal.full, 'reverse must continue from visible height, not snap to an endpoint')
    await page.waitFor(() => !document.querySelector('.pb-transport-slide-enter-active, .pb-transport-slide-leave-active'), { label: 'reversed slide finished' })
    check(failures, (await page.probe(playbackCollapseProbe)).contentInlineHeight === '', 'reversal must clean inline height')
  }
  if (scenario.width === 844) {
    // Rotation preserves disclosure state, and a transition interrupted by hiding UI is disposable.
    await clickElement(page, '[data-test="pb-transport-toggle"]')
    await delay(120)
    await page.emulate({ ...scenario, width: 390, height: 844 })
    await page.waitFor(() => !document.querySelector('.pb-transport-slide-leave-active'), { label: 'rotated slide finished' })
    const rotated = await page.probe(playbackCollapseProbe)
    check(failures, rotated.transportContentHidden && rotated.transportToggle.hitSelf, 'rotation must preserve a reachable collapsed state')
    check(failures, Math.abs(rotated.toggleRect.right - rotated.transportRect.right) <= 1, 'rotation must preserve right docking')
    await page.emulate(scenario)
    await clickElement(page, '[data-test="pb-transport-toggle"]')
    await page.waitFor(() => !document.querySelector('.pb-transport-slide-enter-active'), { label: 'post-rotation restore' })
    await clickElement(page, '[data-test="pb-transport-toggle"]')
    await delay(100)
    await page.evaluate('document.activeElement?.blur()')
    await page.pressH()
    await page.waitFor(() => !document.querySelector('[data-test="pb-transport-slot"]'), { label: 'hide UI during slide' })
    await page.pressH()
    await page.waitFor(() => !!document.querySelector('[data-test="pb-transport-toggle"]'), { label: 'restore UI after slide teardown' })
    const remounted = await page.probe(playbackCollapseProbe)
    check(failures, remounted.transportToggle.expanded === 'false' && remounted.contentInlineHeight === '', 'UI remount must preserve collapse without stale height')
    await clickElement(page, '[data-test="pb-transport-toggle"]')
    await page.waitFor(() => !document.querySelector('.pb-transport-slide-enter-active'), { label: 'post-remount restore' })
  }
  console.log('[toolbar-motion]', scenario.name, JSON.stringify({ right: collapsed.toggleRect.right, slotRight: collapsed.transportRect.right, frames: frames.length, intermediate, reduced: !!scenario.reduced, fullscreen: !!scenario.fullscreen }))

  await clickElement(page, '[data-test="pb-play"]')
  const advanced = await page
    .waitForValue('document.querySelector(\'[data-test="pb-time"]\').textContent.trim()', (value) => value !== timeBeforeCollapse,
      { timeout: 5000, label: 'clock advancing after restore + play' })
    .catch(() => null)
  check(failures, advanced !== null, 'play after collapse/restore was a silent no-op: clock stayed ' + timeBeforeCollapse)
  const final = await page.probe(playbackCollapseProbe)
  check(failures, final.pageScrollWidth <= final.viewportWidth + 1,
    'page-level horizontal overflow at the end: ' + final.pageScrollWidth + ' > ' + final.viewportWidth)

  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: scenario.width + 'x' + scenario.height, mapShare: base.mapShare })
}

/**
 * §2d-shellnav：600×320 沉浸态下的**真实 Shell 导航所有权**回归。
 *
 * 与 pb-collapse-* 的差别：这里挂载的是**真实应用**（startFixtureServer({ realReplay: true })，
 * 只有 auth 边界替身，AppShell / shellChrome / AppNavDrawer / 回放解析全部是生产实现），
 * 不是 playback-controls.html 那种直接挂 BattlePlayback 的夹具——只有真实 AppShell 才能
 * 证明 `SHELL_CHROME_KEY` / `OPEN_NAV_DRAWER_KEY` 的注入与 `hostNav` 所有权交接：
 *   · 传输条展开时承载唯一可见导航入口（fallback .immersive-nav 必须不存在）；
 *   · 传输条折叠后所有权交还 AppShell（fallback 出现且可点，传输条内导航隐藏）；
 *   · 恢复后所有权回到传输条（fallback 消失）。
 * 任何一侧漏渲染 / 双渲染（两个 nav-menu 同时可见）都会让 navCount 断言失败。
 */
const PLAYBACK_SHELLNAV_SCENARIOS = [
  { name: 'pb-shellnav-600x320-landscape-coarse', width: 600, height: 320, touch: true, duration: 60 },
]

function playbackShellNavProbe() {
  const rectOf = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (!(r.width > 0 && r.height > 0)) return { visible: false }
    const cx = Math.min(Math.max(Math.round(r.left + r.width / 2), 1), innerWidth - 1)
    const cy = Math.min(Math.max(Math.round(r.top + r.height / 2), 1), innerHeight - 1)
    const hit = document.elementFromPoint(cx, cy)
    return {
      visible: true,
      left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
      hitSelf: !!(hit && (hit === el || el.contains(hit) || (hit.contains(el) && hit.tagName !== 'BODY'))),
    }
  }
  const controlSelectors = [
    ['nav', '[data-testid="nav-menu"]'],
    ['back5', '[data-test="pb-back5"]'],
    ['play', '[data-test="pb-play"]'],
    ['fwd5', '[data-test="pb-fwd5"]'],
    ['speed', '[data-test="pb-speed-current"]'],
    ['fullscreen', '[data-test="pb-fullscreen"]'],
    ['annotation', '[data-test="pb-annotation-entry"]'],
    ['roster', '[data-test="pb-roster-entry"]'],
    ['gear', '[data-test="pb-secondary-entry"]'],
    ['clock', '[data-test="pb-time"]'],
    ['hudClock', '[data-test="pb-hud-time"]'],
    ['timeline', '[data-test="pb-progress"]'],
    ['toggle', '[data-test="pb-transport-toggle"]'],
  ]
  const controls = {}
  for (const [key, selector] of controlSelectors) {
    // 同名入口可能有多个（传输条导航 vs 外壳 fallback）：全部收集，命中状态按「存在任一可见且可点」计。
    const rects = [...document.querySelectorAll(selector)].map(rectOf).filter(Boolean)
    controls[key] = rects
  }
  const navVisible = [...document.querySelectorAll('[data-testid="nav-menu"]')]
    .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
  const fallback = document.querySelector('.immersive-nav')
  const fallbackRect = fallback ? fallback.getBoundingClientRect() : null
  const map = document.querySelector('.pb-map')
  const mapRect = map ? map.getBoundingClientRect() : null
  const rootEl = document.querySelector('[data-test="battle-playback"]')
  const rootStyle = rootEl ? getComputedStyle(rootEl) : null
  return {
    immersive: document.documentElement.dataset.shellChrome === 'immersive',
    navCount: navVisible.length,
    navInTransport: navVisible.some(el => !!el.closest('.pb-controls')),
    navFallbackVisible: !!(fallbackRect && fallbackRect.width > 0 && fallbackRect.height > 0),
    controls,
    map: mapRect ? { width: mapRect.width, height: mapRect.height, top: mapRect.top, bottom: mapRect.bottom } : null,
    mapShare: mapRect ? (mapRect.width * mapRect.height) / (innerWidth * innerHeight) : null,
    availH: rootStyle ? rootStyle.getPropertyValue('--pb-square-avail-h').trim() : null,
    workspaceH: rootStyle ? rootStyle.getPropertyValue('--pb-workspace-h').trim() : null,
    pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    clock: document.querySelector('[data-test="pb-time"]')?.textContent.trim() || null,
  }
}

let shellNavServer = null
async function runPlaybackShellNavScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  setLastPage(page)
  await page.enable()
  await page.emulate(scenario)
  if (!shellNavServer) shellNavServer = await startFixtureServer({ realReplay: true })

  // 真实应用：示例回放 → 2D 战局回放 tab；沉浸态由 ReplayWorkspace 向真实 AppShell 申请。
  await page.goto(`${shellNavServer.origin}/?view=replay&ws-auth=0`)
  await page.waitFor(() => !!document.querySelector('[data-testid="workspace-demo"]'), { label: 'workspace demo entry' })
  await page.evaluate(`document.querySelector('[data-testid="workspace-demo"]').scrollIntoView({ block: 'center' })`)
  await delay(200)
  await page.tap({ ...await page.waitForValue(clickCenterExpression('[data-testid="workspace-demo"]'), Boolean, { label: 'demo center' }), touch: true })
  await page.waitFor(() => !!document.querySelector('[data-testid="workspace-demo-label"]'), { timeout: 90000, label: 'real sample analyzed' })
  await page.tap({ ...await page.waitForValue(clickCenterExpression('[data-testid="ws-tab"][data-cap="playback"]'), Boolean, { label: 'playback tab center' }), touch: true })
  await page.waitFor(() => !!document.querySelector('[data-test="battle-playback"]'), { timeout: 30000, label: 'battle playback pane' })
  await delay(1000)

  const hit = async (selector) => {
    await alignWorkspace()
    const center = await page.waitForValue(clickCenterExpression(selector), Boolean, { label: selector })
    await page.installInputTrace()
    await page.tap({ ...center, touch: true })
    const trace = await page.inputTrace()
    return trace?.click
  }

  // —— Step 1/2：沉浸态 + 传输条承载唯一导航入口 + 全控件几何 ——
  // 横屏地图可高于视口（仓库既有契约：控件允许滚动触达），命中测试前先把工作台对齐到视口。
  const alignWorkspace = async () => {
    await page.evaluate(`(() => {
      const slot = document.querySelector('[data-test="pb-transport-slot"]')
      if (!slot) return
      const r = slot.getBoundingClientRect()
      if (r.top < 0 || r.bottom > innerHeight) slot.scrollIntoView({ block: 'nearest' })
    })()`)
    await delay(250)
  }
  await alignWorkspace()
  const expanded = await page.probe(playbackShellNavProbe)
  check(failures, expanded.immersive, 'immersive mode must be active (real AppShell shellChrome)')
  check(failures, expanded.navCount === 1 && expanded.navInTransport,
    `expanded transport must host exactly one visible navigation entry (count=${expanded.navCount} inTransport=${expanded.navInTransport})`)
  check(failures, !expanded.navFallbackVisible, 'shell fallback nav must be hidden while the transport hosts navigation')
  // §2d-shellnav：窄视口（<640px）传输条时钟让位（紧凑 HUD 中心列有同一时钟），时间轴下限收缩——
  // 否则 min-content 超宽，时钟溢出视口并与折叠按钮重叠（真实缺陷，已由本场景复现）。
  check(failures, expanded.controls.clock.every(r => !r.visible) && expanded.controls.hudClock.some(r => r.visible && r.hitSelf),
    `narrow viewport must hide the transport clock and keep the HUD clock reachable: clock=${JSON.stringify(expanded.controls.clock)} hud=${JSON.stringify(expanded.controls.hudClock)}`)
  const expandedControls = ['nav', 'back5', 'play', 'fwd5', 'speed', 'fullscreen', 'annotation', 'roster', 'gear', 'timeline', 'toggle']
  for (const key of expandedControls) {
    const rects = expanded.controls[key] || []
    check(failures, rects.some(r => r.visible && r.hitSelf),
      `${key} control must be visible and hit-testable at 600x320 immersive: ${JSON.stringify(rects)}`)
    for (const r of rects.filter(r => r.visible)) {
      check(failures, r.left >= -0.5 && r.right <= scenario.width + 0.5,
        `${key} control must not be clipped by the viewport: ${JSON.stringify(r)}`)
    }
  }
  const visibleRects = expandedControls.flatMap(key => (expanded.controls[key] || []).filter(r => r.visible))
  for (let i = 0; i < visibleRects.length; i++) {
    for (let j = i + 1; j < visibleRects.length; j++) {
      const a = visibleRects[i], b = visibleRects[j]
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      check(failures, !(overlapX > 0.5 && overlapY > 0.5),
        `controls must not overlap: [${i}] ${JSON.stringify(a)} vs [${j}] ${JSON.stringify(b)}`)
    }
  }
  check(failures, !expanded.pageOverflow, `page-level horizontal overflow: ${JSON.stringify(expanded)}`)
  check(failures, expanded.map && expanded.map.width >= 170 && expanded.map.height >= 170,
    `map stage must stay usable at 600x320 immersive: ${JSON.stringify(expanded.map)}`)

  // —— Step 3a：抽屉打开 / 关闭（真实 AppNavDrawer，Esc 关闭） ——
  const navClick = await hit('[data-testid="nav-menu"]')
  check(failures, navClick?.testId === 'nav-menu', `navigation tap missed the hosted nav entry: ${JSON.stringify(navClick)}`)
  await page.waitFor(() => !!document.querySelector('[data-testid="nav-drawer"]'), { timeout: 5000, label: 'nav drawer open' })
  await page.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, page.sessionId)
  await page.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, page.sessionId)
  // 退场动画期间 DrawerContent 由 Reka Presence 挂起（~duration-slow），限时等待真实卸载再断言
  await page.waitFor(() => !document.querySelector('[data-testid="nav-drawer"]'), { timeout: 5000, label: 'nav drawer unmount after Escape' })
  check(failures, await page.evaluate(`!document.querySelector('[data-testid="nav-drawer"]')`), 'Escape must close the navigation drawer')
  check(failures, (await page.probe(playbackShellNavProbe)).navCount === 1, 'exactly one nav entry must remain after closing the drawer')

  // —— Step 3b：折叠 → 所有权交还 AppShell ——
  const clockBefore = (await page.probe(playbackShellNavProbe)).clock
  const toggleClick = await hit('[data-test="pb-transport-toggle"]')
  check(failures, toggleClick?.test === 'pb-transport-toggle', `collapse tap missed the toggle: ${JSON.stringify(toggleClick)}`)
  await alignWorkspace()
  await page.waitFor(() => getComputedStyle(document.querySelector('[data-test="pb-transport-controls"]')).display === 'none', { label: 'transport collapse animation finished' })
  const collapsed = await page.probe(playbackShellNavProbe)
  check(failures, collapsed.controls.play.every(r => !r.visible), 'collapsing must hide the primary transport controls')
  check(failures, collapsed.controls.toggle.some(r => r.visible && r.hitSelf), 'the collapsed restore entry must stay reachable')
  check(failures, collapsed.navCount === 1 && collapsed.navFallbackVisible && collapsed.controls.nav.some(r => r.hitSelf),
    `collapsed state must return navigation ownership to AppShell (count=${collapsed.navCount} fallback=${collapsed.navFallbackVisible})`)
  check(failures, collapsed.clock === clockBefore, 'collapsing must not move the clock')
  // 折叠释放传输条高度 → 纵向预算变大：地图正方形只能变大或不变（不能因折叠而缩小）。
  check(failures, collapsed.map.width >= expanded.map.width - 1,
    `collapsing must not shrink the map square (expanded=${expanded.map.width} collapsed=${collapsed.map.width})`)

  // —— Step 3b'：fallback 导航按钮**真实触控**打开抽屉（P3：不能只靠 elementFromPoint 判命中）——
  const fallbackClick = await hit('.immersive-nav')
  check(failures, fallbackClick?.testId === 'nav-menu', `fallback nav tap missed: ${JSON.stringify(fallbackClick)}`)
  await page.waitFor(() => !!document.querySelector('[data-testid="nav-drawer"]'), { timeout: 5000, label: 'nav drawer open from fallback' })
  check(failures, (await page.probe(playbackShellNavProbe)).navCount === 1, 'exactly one nav entry while the fallback opens the drawer')
  await page.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, page.sessionId)
  await page.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, page.sessionId)
  await page.waitFor(() => !document.querySelector('[data-testid="nav-drawer"]'), { timeout: 5000, label: 'fallback drawer unmount after Escape' })
  check(failures, await page.evaluate(`!document.querySelector('[data-testid="nav-drawer"]')`), 'Escape must close the drawer opened from the fallback')

  // —— Step 3c：恢复 → 所有权回到传输条 ——
  await hit('[data-test="pb-transport-toggle"]')
  await alignWorkspace()
  const restored = await page.probe(playbackShellNavProbe)
  check(failures, restored.navCount === 1 && restored.navInTransport && !restored.navFallbackVisible,
    `restored transport must reclaim navigation ownership (count=${restored.navCount} fallback=${restored.navFallbackVisible})`)

  // —— Step 3d：播放 / seek / 名册开合仍然正确 ——
  await hit('[data-test="pb-play"]')
  const advanced = await page
    .waitForValue('document.querySelector(\'[data-test="pb-time"]\').textContent.trim()', (value) => value !== clockBefore,
      { timeout: 5000, label: 'clock advancing after restore + play' })
    .catch(() => null)
  check(failures, advanced !== null, `play after the nav handoff round-trip was a silent no-op: clock stayed ${clockBefore}`)
  const clockAfterPlay = advanced ?? clockBefore
  await hit('[data-test="pb-fwd5"]')
  const afterSeek = await page
    .waitForValue('document.querySelector(\'[data-test="pb-time"]\').textContent.trim()', (value) => value !== clockAfterPlay,
      { timeout: 5000, label: 'clock after +5s' })
    .catch(() => null)
  check(failures, afterSeek !== null, `+5s seek was a silent no-op: clock stayed ${clockAfterPlay}`)
  const rosterClick = await hit('[data-test="pb-roster-entry"]')
  check(failures, rosterClick?.test === 'pb-roster-entry', `roster entry tap missed: ${JSON.stringify(rosterClick)}`)
  const rosterOpen = await page.probe(playbackShellNavProbe)
  check(failures, !!await page.evaluate(`!!document.querySelector('[data-test="pb-team-lane-left"]')`), 'roster entry must expand the overlay lanes')
  check(failures, rosterOpen.controls.roster.some(r => r.hitSelf), 'roster entry must stay hit-testable while lanes are open')
  check(failures, !rosterOpen.pageOverflow, `page-level horizontal overflow with lanes open: ${JSON.stringify(rosterOpen)}`)
  await hit('[data-test="pb-roster-entry"]')
  check(failures, await page.evaluate(`!document.querySelector('[data-test="pb-team-lane-left"]')`), 'roster entry must collapse the overlay lanes')

  // —— Step 4（F6）：showTopbar 关闭 → HUD 时钟消失，窄容器必须保留可见的传输条时钟 ——
  await hit('[data-test="pb-secondary-entry"]')
  await page.waitFor(() => !!document.querySelector('[data-testid="display-panel"]'), { timeout: 5000, label: 'Display surface open' })
  await page.evaluate(`document.querySelector('[data-test="pb-show-hud"]').click()`)
  await delay(300)
  await page.evaluate(`document.querySelector('[data-testid="display-close"]').click()`)
  await delay(300)
  await alignWorkspace()
  const noHud = await page.probe(playbackShellNavProbe)
  check(failures, await page.evaluate(`document.querySelector('[data-test="battle-playback"]').classList.contains('pb-hud-clock-off')`),
    'top bar off must put the workspace in the pb-hud-clock-off clock-fallback state')
  check(failures, !noHud.controls.hudClock.some(r => r.visible), 'the HUD clock must be gone after turning the top bar off')
  check(failures, noHud.controls.clock.some(r => r.visible && r.hitSelf),
    `narrow viewport with the top bar off must keep a visible, hit-testable transport clock: ${JSON.stringify(noHud.controls.clock)}`)
  for (const key of ['gear', 'toggle']) {
    const a = noHud.controls.clock.find(r => r.visible)
    const b = (noHud.controls[key] || []).find(r => r.visible)
    check(failures, !(a && b && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5),
      `transport clock must not overlap the ${key} with the top bar off: clock=${JSON.stringify(a)} ${key}=${JSON.stringify(b)}`)
  }
  check(failures, !noHud.pageOverflow, `page-level horizontal overflow with the top bar off: ${JSON.stringify(noHud)}`)
  // 恢复 showTopbar → 传输条时钟回到让位态（HUD 时钟接管）
  await hit('[data-test="pb-secondary-entry"]')
  await page.waitFor(() => !!document.querySelector('[data-testid="display-panel"]'), { timeout: 5000, label: 'Display surface reopen' })
  await page.evaluate(`document.querySelector('[data-test="pb-show-hud"]').click()`)
  await delay(300)
  await page.evaluate(`document.querySelector('[data-testid="display-close"]').click()`)
  await delay(300)
  const hudRestored = await page.probe(playbackShellNavProbe)
  check(failures, hudRestored.controls.clock.every(r => !r.visible) && hudRestored.controls.hudClock.some(r => r.visible),
    're-enabling the top bar must hand the clock back to the HUD')

  console.log(`[browser-interaction] ${scenario.name} map=${Math.round(expanded.map?.width)}x${Math.round(expanded.map?.height)} share=${expanded.mapShare?.toFixed(3)} navHandoff=OK`)
  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}`, mapShare: expanded.mapShare })
}


return { PLAYBACK_COLLAPSE_SCENARIOS, PLAYBACK_SHELLNAV_SCENARIOS, runPlaybackCollapseScenario, runPlaybackShellNavScenario, closeShellNavServer: async () => { if (shellNavServer) await shellNavServer.server.close() } }
}
