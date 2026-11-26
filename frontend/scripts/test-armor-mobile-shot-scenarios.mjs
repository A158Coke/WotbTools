import { Page } from './browser-page.mjs'
import { FIXTURE_TANK_ID } from './browser-fixtures/fixture-asset-pack.mjs'
import { armorLayoutProbe, check, checkCommonGeometry, rectsOverlap } from './test-armor-mobile-geometry.mjs'

export const SHOT_SCENARIOS = [
  { name: 'armor-shot-actions-mobile', width: 390, height: 844, touch: true },
  { name: 'armor-shot-actions-tablet', width: 1024, height: 768, touch: false },
  { name: 'armor-shot-actions-desktop', width: 1280, height: 800, touch: false },
]
const FIXTURE_SHOT = {
  index: 1, time_s: 12, shooter_eid: 7, target_eid: 8, is_author: true,
  shooter_tank_id: FIXTURE_TANK_ID, target_tank_id: FIXTURE_TANK_ID,
  shooter_name: 'Shooter', target_name: 'Target', shooter_tank_name: 'Fixture tank', target_tank_name: 'Fixture tank',
  shell_slot: 0, damage: 100, hit_flags: 16, game_hit_result: 3,
  shooter_pos: [0, 0, 60], target_pos: [0, 0, 0], shooter_ang: [0, 0, 0], target_ang: [0, 0, 0],
  ball_a: [0, 1, 60], ball_b: [0, 1, 0], launch_velocity: [0, 0, -1000],
  tick_samples: [{ dt: 0, pos: [0, 0, 0], yaw: 0, pitch: 0, roll: 0 }],
  shooter_tick_samples: [{ dt: 0, pos: [0, 0, 60], yaw: 0, pitch: 0, roll: 0 }],
}
const FIXTURE_SHOTS = [FIXTURE_SHOT, { ...FIXTURE_SHOT, index: 2, time_s: 24, damage: 200 }]
export async function runShotActionsScenario(env, scenario, { trackPage, results }) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  trackPage(page)
  await page.enable()
  await page.emulate(scenario)
  await page.goto(`${env.origin}/?view=home&ws-auth=1`)
  await page.evaluate(`(async () => {
    localStorage.setItem('wotb-lang', 'zh')
    const { storeShotsForViewer } = await import('/src/scene/agentData.js')
    storeShotsForViewer(${JSON.stringify(FIXTURE_SHOTS)})
  })()`)
  await page.goto(`${env.origin}/?view=agent-armor&ws-auth=1&tank=${FIXTURE_TANK_ID}&shooter=${FIXTURE_TANK_ID}&shot=1&world=1&assets=${encodeURIComponent(env.assets)}`)
  await page.waitFor(() => !!document.querySelector('#world-view-toggle'), { timeout: 30000, label: 'real shot scene controls' })
  const state = `(() => ({
    impact: document.querySelector('#rel-view-toggle')?.getAttribute('aria-pressed'),
    overview: document.querySelector('#world-view-toggle')?.getAttribute('aria-pressed'),
    distance: window.__armorRicochet?.aimingState()?.cameraDistance,
    details: !!document.querySelector('#debug-toggle'),
  }))()`
  const initial = await page.waitForValue(state, value => value.impact === 'true' && Math.abs(value.distance - 15) < .1,
    { timeout: 15000, label: 'default impact camera is active at 15m' })
  check(failures, initial.overview === 'false' && initial.details === false, 'impact must be selected by default, without the analysis-details entry')
  const help = await page.evaluate(`(() => {
    const el = document.querySelector('[data-testid="armor-interaction-help"]')
    const r = el.getBoundingClientRect(), stage = document.querySelector('.armor-stage').getBoundingClientRect()
    const header = document.querySelector('[data-testid="armor-shot-header"]').getBoundingClientRect()
    return { text: el.textContent, belowHeader: r.top >= header.bottom - 1, aboveStage: r.bottom <= stage.top + 1, inside: r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1, height: r.height }
  })()`)
  const expectedGestures = scenario.touch ? ['单指拖动', '双指捏合', '双指拖动'] : ['左键拖动', '滚轮', '右键拖动']
  check(failures, ['操作说明', '旋转视角', '缩放视角', '平移视角', ...expectedGestures].every(text => help.text.includes(text)),
    `gesture help must describe the current input: ${JSON.stringify(help)}`)
  check(failures, help.belowHeader && help.aboveStage && help.inside && help.height > 0, `gesture help must sit below the page header and above the canvas without overlap: ${JSON.stringify(help)}`)
  const analysis = await page.waitForValue(`document.querySelector('#traj-info')?.textContent`, value => value?.includes('车体装甲板'),
    { timeout: 15000, label: 'localized armor layer in real shot analysis' })
  check(failures, !/Hull Plate|PENETRATION|BLOCKED/.test(analysis), `analysis must translate part names and results: ${analysis}`)
  const tapControl = async selector => {
    const target = await page.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2
      const hit = document.elementFromPoint(x, y)
      return { x, y, width: r.width, height: r.height, hit: hit === el || el.contains(hit), inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }
    })()`)
    check(failures, target.hit && target.inside && target.width >= 44 && target.height >= 44,
      `${selector} must be visible and reachable at 44px: ${JSON.stringify(target)}`)
    await page.tap({ x: target.x, y: target.y, touch: scenario.touch })
  }
  await tapControl('#rel-view-toggle')
  await tapControl('#world-view-toggle')
  const overview = await page.waitForValue(state, value => value.overview === 'true' && value.distance > 20,
    { label: 'overview camera restored after selecting the already-active impact option' })
  check(failures, overview.impact === 'false', 'view selection must be mutually exclusive')
  await tapControl('#rel-view-toggle')
  await page.waitForValue(state, value => value.impact === 'true' && Math.abs(value.distance - 15) < .1,
    { label: 'return to impact camera' })
  check(failures, await page.evaluate(`!document.querySelector('#world-pen-cmp') && document.querySelector('#turret-controls').style.display === 'none'`),
    'legacy agreement comparison is removed and developer diagnostics stay hidden')
  await tapControl('[data-testid="armor-tools"]')
  for (const selector of ['#shell-select', '#collision-btn', '#penetration-btn']) {
    const target = await page.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)}), r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return { height: r.height, width: r.width, reachable: hit === el || el.contains(hit) }
    })()`)
    check(failures, target.reachable && target.width >= 44 && target.height >= 44,
      `expanded settings must remain reachable above the shot toolbar: ${selector} ${JSON.stringify(target)}`)
  }
  await tapControl('#collision-btn')
  await tapControl('#collision-btn')
  await tapControl('[data-testid="armor-tools"]')
  check(failures, await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'shot toolbar must not create horizontal overflow')
  for (const { label, index, damage } of [
    { label: '下一发', index: '2', damage: '200' },
    { label: '上一发', index: '1', damage: '100' },
  ]) {
    await page.evaluate('window.__navigationPreviousApi = window.__armorRicochet')
    await tapControl('[aria-label="' + label + '"]')
    const navigated = await page.waitForValue(`(() => ({
      shot: new URLSearchParams(location.search).get('shot'),
      fresh: !!window.__armorRicochet && window.__armorRicochet !== window.__navigationPreviousApi,
      judgments: window.__armorRicochet?.info().judgments,
      ready: !document.querySelector('[data-testid="scene3d-loading"]') && !document.querySelector('[data-testid="scene3d-error"]'),
      result: document.querySelector('#traj-info')?.textContent,
      header: document.querySelector('[data-testid="armor-shot-header"]')?.textContent,
    }))()`, value => value.shot === index && value.fresh && value.ready && value.judgments === 1 && value.result?.includes('车体装甲板'),
    { timeout: 30000, label: 'shot navigation rebuilds the ready scene' })
    check(failures, navigated.header.includes(damage), `${label}: recorded damage follows the selected shot`)
  }
  await page.evaluate('delete window.__navigationPreviousApi')
  check(failures, page.consoleErrors.length === 0, `JS errors: ${page.consoleErrors.join(' | ')}`)
  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
}

export const SHOT_LANDSCAPE_SCENARIOS = [
  { name: 'armor-shot-landscape-844x390', width: 844, height: 390, touch: true, safeAreaInsets: { left: 47, right: 47 } },
  { name: 'armor-shot-landscape-780x360', width: 780, height: 360, touch: true, safeAreaInsets: { left: 47, right: 47 } },
  { name: 'armor-shot-landscape-phone', width: 740, height: 360, touch: true },
  { name: 'armor-shot-landscape-600x320', width: 600, height: 320, touch: true },
  { name: 'armor-shot-landscape-667x375', width: 667, height: 375, touch: true },
  { name: 'armor-shot-landscape-915x412', width: 915, height: 412, touch: true },
]
function shotLandscapeProbe() {
  const box = (selector) => {
    const element = document.querySelector(selector)
    if (!element) return null
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      top: Math.round(rect.top), bottom: Math.round(rect.bottom),
      left: Math.round(rect.left), right: Math.round(rect.right),
      width: Math.round(rect.width), height: Math.round(rect.height),
      display: style.display,
      visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
    }
  }
  const hitTest = (selector) => {
    const element = document.querySelector(selector)
    if (!element) return null
    const rect = element.getBoundingClientRect()
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2
    const tx = Math.round(x), ty = Math.round(y)
    const hit = document.elementFromPoint(x, y)
    return {
      ...box(selector),
      center: { x: tx, y: ty },
      hit: hit === element || (!!hit && element.contains(hit)),
      hitDescription: hit ? `${hit.tagName}${typeof hit.className === 'string' && hit.className.trim() ? `.${hit.className.trim().split(/\s+/).join('.')}` : ''}` : null,
      inside: Number.isFinite(tx) && Number.isFinite(ty)
        && tx >= 0 && ty >= 0 && tx <= innerWidth && ty <= innerHeight
        && rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1,
    }
  }
  const viewSwitch = box('.armor-shot-view-switch')
  const resultElement = document.querySelector('#traj-info')?.getClientRects().length ? document.querySelector('#traj-info') : document.querySelector('#click-info')
  const resultCenter = (() => {
    const rect = resultElement?.getBoundingClientRect()
    return rect && rect.width > 0 ? { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) } : null
  })()
  const relBtn = hitTest('#rel-view-toggle')
  const worldBtn = hitTest('#world-view-toggle')
  const back = box('.armor-back')
  const topCard = box('#corner-tl')
  const capsule = back && topCard ? {
    top: Math.min(back.top, topCard.top), bottom: Math.max(back.bottom, topCard.bottom),
    left: Math.min(back.left, topCard.left), right: Math.max(back.right, topCard.right),
    visible: back.visible && topCard.visible,
  } : (topCard || back)
  return {
    viewport: { width: innerWidth, height: innerHeight },
    capsule,
    result: box('#traj-info')?.visible ? box('#traj-info') : box('#click-info'),
    resultCenter,
    resultExpanded: !!document.querySelector('#traj-info.is-expanded, #click-info.is-expanded'),
    postureControls: box('#turret-controls'),
    shotPanel: box('#corner-tr'),
    viewSwitch,
    relBtn,
    worldBtn,
    hudShell: hitTest('[data-testid="hud-shell-0"]'),
    distanceInput: hitTest('#armor-distance'),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }
}
const drawerOcclusionProbe = () => {
  const box = (selector) => {
    const element = document.querySelector(selector)
    if (!element) return null
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      top: Math.round(rect.top), bottom: Math.round(rect.bottom),
      left: Math.round(rect.left), right: Math.round(rect.right),
      width: Math.round(rect.width), height: Math.round(rect.height),
      display: style.display,
      visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
    }
  }
  const drawerEl = document.querySelector('#tank-selectors')
  if (!drawerEl) return { drawer: null, drawerVisible: false, regions: [], sampleHit: null, bottomControl: null }
  const drawer = box('#tank-selectors')
  const shotPanel = box('#corner-tr')
  const viewSwitch = box('.armor-shot-view-switch')
  const intersect = (a, b) => {
    if (!a || !b || !a.visible || !b.visible) return null
    const left = Math.max(a.left, b.left), right = Math.min(a.right, b.right)
    const top = Math.max(a.top, b.top), bottom = Math.min(a.bottom, b.bottom)
    return right > left && bottom > top ? { left, right, top, bottom } : null
  }
  const regions = [intersect(drawer, shotPanel), intersect(drawer, viewSwitch)].filter(Boolean)
  const sample = regions[0]
    ? { x: Math.round((regions[0].left + regions[0].right) / 2), y: Math.round((regions[0].top + regions[0].bottom) / 2) }
    : null
  const sampleHit = (() => {
    if (!sample) return null
    const el = document.elementFromPoint(sample.x, sample.y)
    return {
      description: el ? `${el.tagName}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}` : null,
      inDrawer: !!el && (el === drawerEl || drawerEl.contains(el)),
      inHud: !!el && !!(el.closest && el.closest('#corner-tr, .armor-shot-view-switch')),
    }
  })()
  let inRegionControl = null
  let bottomControl = null
  for (const el of drawerEl.querySelectorAll('button, input, select')) {
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0 || el.disabled) continue
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2)
    const hit = document.elementFromPoint(cx, cy)
    const candidate = {
      bottom: Math.round(r.bottom),
      description: `${el.tagName}${el.id ? `#${el.id}` : ''}`,
      center: { x: cx, y: cy },
      inOccludedRegion: regions.some(rg => cx > rg.left && cx < rg.right && cy > rg.top && cy < rg.bottom),
      hit: !!hit && (hit === el || el.contains(hit)),
      hitDescription: hit ? `${hit.tagName}${typeof hit.className === 'string' && hit.className.trim() ? `.${hit.className.trim().split(/\s+/).join('.')}` : ''}` : null,
    }
    if (candidate.inOccludedRegion && (!inRegionControl || candidate.bottom > inRegionControl.bottom)) inRegionControl = candidate
    if (!bottomControl || candidate.bottom > bottomControl.bottom) bottomControl = candidate
  }
  return { drawer, drawerVisible: drawer.visible === true, regions, sample, sampleHit, bottomControl: inRegionControl || bottomControl }
}
export async function runShotLandscapeScenario(env, scenario, { trackPage, results }) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  trackPage(page)
  await page.enable()
  await page.emulate(scenario)
  if (scenario.safeAreaInsets) {
    await env.chrome.client.send('Emulation.setSafeAreaInsetsOverride', { insets: scenario.safeAreaInsets }, sessionId)
  }
  await page.goto(`${env.origin}/?view=home&ws-auth=1`)
  await page.evaluate(`(async () => {
    localStorage.setItem('wotb-lang', 'zh')
    const { storeShotsForViewer } = await import('/src/scene/agentData.js')
    storeShotsForViewer(${JSON.stringify(FIXTURE_SHOTS)})
  })()`)
  await page.goto(`${env.origin}/?view=agent-armor&ws-auth=1&tank=${FIXTURE_TANK_ID}&shooter=${FIXTURE_TANK_ID}&shot=1&world=1&assets=${encodeURIComponent(env.compactAssets)}`)
  await page.waitFor(() => !!document.querySelector('#world-view-toggle'),
    { timeout: 30000, label: 'real shot view-switch controls' })
  await page.waitFor(() => !document.querySelector('[data-testid="scene3d-loading"]') && !document.querySelector('[data-testid="scene3d-error"]'),
    { timeout: 30000, label: 'shot scene ready' })
  const label = scenario.name
  const layout = await page.probe(armorLayoutProbe)
  check(failures, layout.shellChrome === 'immersive', `${label}: 手机横屏未申请沉浸态（dataset=${layout.shellChrome}）`)
  check(failures, layout.appTopBar === null && layout.appTabBar === null,
    `${label}: 沉浸态下外壳顶栏仍渲染或出现 Tab 栏（top=${!!layout.appTopBar} tab=${!!layout.appTabBar}）`)
  check(failures, layout.root && layout.root.top === 0 && Math.abs(layout.root.height - layout.viewport.height) <= 1,
    `${label}: armor-view 没有占满整屏（root=${JSON.stringify(layout.root)} viewport=${JSON.stringify(layout.viewport)}）`)
  check(failures, layout.interactionHelp === null || layout.interactionHelp.visible === false,
    `${label}: 操作提示节没有在手机横屏让位（${JSON.stringify(layout.interactionHelp)}）`)
  check(failures, layout.shotHeader?.visible === true, `${label}: 射击复现顶栏丢失（${JSON.stringify(layout.shotHeader)}）`)
  checkCommonGeometry(failures, layout, label)
  const backNav = await page.evaluate(`(() => {
    const back = document.querySelector('.armor-shot-back')
    const nav = document.querySelector('.immersive-nav')
    if (!back || !nav) return { missing: { back: !back, nav: !nav } }
    const b = back.getBoundingClientRect(), n = nav.getBoundingClientRect()
    const hitsBack = (x, y) => { const el = document.elementFromPoint(x, y); return !!el && (el === back || back.contains(el)) }
    const midY = b.top + b.height / 2
    return {
      back: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
      nav: { left: n.left, right: n.right, top: n.top, bottom: n.bottom },
      overlap: b.left < n.right && n.left < b.right && b.top < n.bottom && n.top < b.bottom,
      leftEdgeHit: hitsBack(b.left + 1, midY), centerHit: hitsBack(b.left + b.width / 2, midY),
    }
  })()`)
  check(failures, !backNav.missing && backNav.overlap === false && backNav.leftEdgeHit === true && backNav.centerHit === true,
    `${label}: 沉浸态菜单按钮遮挡了返回射击分析（${JSON.stringify(backNav)}）`)
  const shot = await page.probe(shotLandscapeProbe)
  const assertShotGeometry = (snapshot, phase) => {
    for (const name of ['capsule', 'result', 'shotPanel', 'viewSwitch']) {
      check(failures, snapshot[name]?.visible === true,
        `${label}${phase}: ${name} 不可见/不可测（${JSON.stringify(snapshot[name])}）`)
    }
    check(failures, snapshot.postureControls?.visible === false,
      `${label}${phase}: shot 页姿态面板必须由场景隐藏（${JSON.stringify(snapshot.postureControls)}）`)
    const visibleBoxes = Object.entries({ capsule: snapshot.capsule, result: snapshot.result, shotPanel: snapshot.shotPanel, viewSwitch: snapshot.viewSwitch })
      .filter(([, box]) => box?.visible === true)
    for (let a = 0; a < visibleBoxes.length; a++) {
      for (let b = a + 1; b < visibleBoxes.length; b++) {
        const [nameA, boxA] = visibleBoxes[a]
        const [nameB, boxB] = visibleBoxes[b]
        check(failures, !rectsOverlap(boxA, boxB),
          `${label}${phase}: ${nameA} 与 ${nameB} 相交（${nameA}=${JSON.stringify(boxA)} ${nameB}=${JSON.stringify(boxB)}）`)
      }
    }
    check(failures, snapshot.horizontalOverflow === false, `${label}${phase}: shot 页横屏出现横向溢出`)
  }
  const assertTouchTargets = (snapshot, phase) => {
    for (const [name, target] of Object.entries({ relBtn: snapshot.relBtn, worldBtn: snapshot.worldBtn, hudShell: snapshot.hudShell, distanceInput: snapshot.distanceInput })) {
      check(failures, target?.visible === true && target.hit === true && target.inside === true,
        `${label}${phase}: ${name} 不是真实触控目标（hit=${target?.hit} hitDescription=${target?.hitDescription} box=${JSON.stringify(target)}）`)
    }
  }
  assertShotGeometry(shot, '')
  assertTouchTargets(shot, '')
  const viewState = `(() => ({
    impact: document.querySelector('#rel-view-toggle')?.getAttribute('aria-pressed'),
    overview: document.querySelector('#world-view-toggle')?.getAttribute('aria-pressed'),
    distance: window.__armorRicochet?.aimingState()?.cameraDistance,
  }))()`
  await page.tap({ ...shot.worldBtn.center, touch: scenario.touch })
  await page.waitForValue(viewState, value => value.overview === 'true' && value.impact === 'false' && value.distance > 20,
    { timeout: 15000, label: 'overview camera from default impact view' })
  await page.tap({ ...shot.relBtn.center, touch: scenario.touch })
  await page.waitForValue(viewState, value => value.impact === 'true' && value.overview === 'false' && Math.abs(value.distance - 15) < .1,
    { timeout: 15000, label: 'impact camera re-selected from overview' })
  await page.tap({ ...shot.worldBtn.center, touch: scenario.touch })
  await page.waitForValue(viewState, value => value.overview === 'true' && value.impact === 'false' && value.distance > 20,
    { timeout: 15000, label: 'overview restored after full round trip' })
  const settleResultCard = () => page.evaluate(`new Promise((resolve) => {
    const started = performance.now()
    let prev = null
    let stable = 0
    const tick = () => {
      const r = document.getElementById('traj-info')?.getBoundingClientRect()
      const now = r && r.width > 0 ? { x: r.x, y: r.y } : null
      stable = now && prev && Math.abs(now.x - prev.x) < 0.5 && Math.abs(now.y - prev.y) < 0.5 ? stable + 1 : 0
      prev = now
      if (stable >= 2) resolve(true)
      else if (performance.now() - started > 5000) resolve(false)
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })`)
  check(failures, await settleResultCard() === true, `${label}: 结果卡位置未稳定`)
  const shotResult = await page.probe(shotLandscapeProbe)
  check(failures, !!shotResult.resultCenter, `${label}: 射击结果卡无有效中心（${JSON.stringify(shotResult.result)}）`)
  await page.tap({ ...shotResult.resultCenter, touch: scenario.touch })
  await page.waitForValue(`!!document.querySelector('#traj-info.is-expanded, #click-info.is-expanded')`, value => value === true,
    { label: 'result details expanded' })
  assertShotGeometry(await page.probe(shotLandscapeProbe), ' 结果展开')
  check(failures, await settleResultCard() === true, `${label} 结果展开: 结果卡位置未稳定`)
  const expandedResult = await page.probe(shotLandscapeProbe)
  check(failures, !!expandedResult.resultCenter, `${label} 结果展开: 射击结果卡无有效中心（${JSON.stringify(expandedResult.result)}）`)
  await page.tap({ ...expandedResult.resultCenter, touch: scenario.touch })
  await page.waitForValue(`!!document.querySelector('#traj-info.is-expanded, #click-info.is-expanded')`, value => value === false,
    { label: 'result details collapsed' })
  await page.tap({ ...layout.tools.center, touch: scenario.touch })
  await page.waitForValue(`document.querySelector('.armor-stage').className`, value => value.includes('is-tools-open'),
    { label: 'tools drawer open' })
  assertShotGeometry(await page.probe(shotLandscapeProbe), ' 参数展开')
  await page.evaluate(`(() => {
    const drawer = document.querySelector('#tank-selectors')
    if (drawer) drawer.scrollTop = drawer.scrollHeight
  })()`)
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  let occlusion = await page.probe(drawerOcclusionProbe)
  for (let attempt = 0; attempt < 10 && occlusion.bottomControl && !occlusion.bottomControl.inOccludedRegion; attempt++) {
    await page.evaluate(`(() => {
      const drawer = document.querySelector('#tank-selectors')
      if (drawer) drawer.scrollTop = Math.max(0, drawer.scrollTop - 60)
    })()`)
    await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    occlusion = await page.probe(drawerOcclusionProbe)
  }
  check(failures, occlusion.drawerVisible === true, `${label} 参数展开: 抽屉不可见（${JSON.stringify(occlusion.drawer)}）`)
  check(failures, occlusion.regions.length > 0,
    `${label} 参数展开: 抽屉与右下 HUD 无实际交集，遮挡断言无效（drawer=${JSON.stringify(occlusion.drawer)}）`)
  check(failures, occlusion.sampleHit?.inDrawer === true && occlusion.sampleHit?.inHud === false,
    `${label} 参数展开: HUD 覆盖区域的命中不属于抽屉（sample=${JSON.stringify(occlusion.sample)} hit=${JSON.stringify(occlusion.sampleHit)}）`)
  check(failures, occlusion.bottomControl?.inOccludedRegion === true,
    `${label} 参数展开: 抽屉最下方交互控件未落入 HUD 覆盖区域，控件命中断言无效（${JSON.stringify(occlusion.bottomControl)}）`)
  check(failures, occlusion.bottomControl?.hit === true,
    `${label} 参数展开: 抽屉内位于 HUD 覆盖区域的控件被 HUD 抢走触摸（${JSON.stringify(occlusion.bottomControl)}）`)
  const closeProbe = await page.evaluate(`(() => {
    const el = document.querySelector('[data-testid="armor-tools-close"]')
    if (!el) return { present: false }
    const r = el.getBoundingClientRect()
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2)
    const hit = document.elementFromPoint(x, y)
    return {
      present: true, x, y, width: Math.round(r.width), height: Math.round(r.height),
      hit: hit === el || el.contains(hit),
      hitDescription: hit ? hit.tagName : null,
    }
  })()`)
  check(failures, closeProbe.present === true && closeProbe.hit === true && closeProbe.width >= 36,
    `${label} 参数展开: 抽屉关闭按钮不是真实触控目标（${JSON.stringify(closeProbe)}）`)
  if (closeProbe.present && closeProbe.hit) {
    await page.tap({ x: closeProbe.x, y: closeProbe.y, touch: scenario.touch })
  } else {
    await page.tap({ ...layout.tools.center, touch: scenario.touch })
  }
  await page.waitForValue(`document.querySelector('.armor-stage').className`, value => !value.includes('is-tools-open'),
    { label: 'tools drawer closed' })
  const closedShot = await page.probe(shotLandscapeProbe)
  assertShotGeometry(closedShot, ' 参数关闭')
  assertTouchTargets(closedShot, ' 参数关闭')
  check(failures, page.consoleErrors.length === 0, `${label}: JS errors: ${page.consoleErrors.join(' | ')}`)
  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
}
