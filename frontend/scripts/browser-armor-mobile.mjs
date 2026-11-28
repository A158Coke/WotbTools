import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { armorLayoutProbe, applyLoadedFixture, check, checkCommonGeometry, checkSceneBand, isCompactScene, checkTouchTargets, resultHeightBudget, rectsOverlap, checkCompactLandscapeHud } from './test-armor-mobile-geometry.mjs'
import { SHOT_SCENARIOS, SHOT_LANDSCAPE_SCENARIOS, runShotActionsScenario, runShotLandscapeScenario } from './test-armor-mobile-shot-scenarios.mjs'
import { Page, delay } from './browser-page.mjs'
import { parseScenarioArgs, selectShard } from './browser-scenario-args.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'
import { FIXTURE_SECOND_TANK_ID, FIXTURE_TANK_CACHE, FIXTURE_TANK_DATA, FIXTURE_TANK_ID, startFixtureAssetPack } from './browser-fixtures/fixture-asset-pack.mjs'

const COMPACT_SCREENSHOT_DIR = fileURLToPath(new URL('../../tmp/armor-landscape-compact-hud/', import.meta.url))


async function dismissStatusOverlays(page) {
  await page.evaluate(`(() => {
    const nodes = document.querySelectorAll('[data-testid="scene3d-error"], [data-testid="scene3d-loading"]')
    nodes.forEach((node) => { node.style.display = 'none' })
    return nodes.length
  })()`)
}

const results = []
let lastPage = null


const MOBILE_SCENARIOS = [
  { name: 'armor-390x844-portrait-coarse', width: 390, height: 844, touch: true },
  { name: 'armor-360x640-small-coarse', width: 360, height: 640, touch: true },
  { name: 'armor-767x1024-narrow', width: 767, height: 1024, touch: false },
]

const ASSETLESS_SCENARIO = { name: 'armor-390x844-no-assets-coarse', width: 390, height: 844, touch: true, assetless: true }

const BACK_SCENARIO = { name: 'armor-390x844-with-back-coarse', width: 390, height: 844, touch: true }

async function runMobileScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)

  const label = scenario.name
  const assetQuery = '&assets=' + encodeURIComponent(scenario.assetless ? 'http://127.0.0.1:1/' : env.assets)
  await page.goto(`${env.origin}/?view=agent-armor&ws-auth=1&tank=${FIXTURE_TANK_ID}${assetQuery}`)
  await page.waitFor(() => !!document.querySelector('[data-testid="armor-stage"]'), { label: 'armor stage' })
  if (scenario.assetless) {
    await page.waitFor(() => !!document.querySelector('[data-testid="scene3d-error"]'), { label: 'assetless failure' })
    await dismissStatusOverlays(page)
  } else {
    await page.waitFor(() => !document.querySelector('[data-testid="scene3d-loading"]') && !document.querySelector('[data-testid="scene3d-error"]') && !document.querySelector('#target-select').disabled, { label: 'viewer initialized' })
  }
  await delay(150)

  if (scenario.touch) {
    check(failures, (await page.evaluate('matchMedia("(pointer: coarse)").matches')) === true,
      `${label}: 设备仿真未生效（pointer: coarse 必须为 true）`)
  }

  if (!scenario.assetless) {
    await page.probe(applyLoadedFixture)
    await delay(120)
  }
  const initial = await page.probe(armorLayoutProbe)
  check(failures, initial.hasStage && !initial.unsupported, `${label}: 场景未渲染（hasStage=${initial.hasStage} unsupported=${initial.unsupported}）`)
  checkCommonGeometry(failures, initial, label)
  check(failures, initial.appTopBar?.visible === true && initial.appTabBar === null,
    `${label}: 竖屏外壳顶栏必须保留且没有 Tab 栏（top=${initial.appTopBar?.visible} tab=${!!initial.appTabBar}）`)
  check(failures, initial.shellChrome !== 'immersive', `${label}: 竖屏不应进入沉浸态（dataset=${initial.shellChrome}）`)
  if (scenario.assetless) {
    check(failures, initial.infoPanel?.visible === false, `${label}: 资产不可达时车名面板不应可见（场景前提失效）`)
    check(failures, initial.statusOverlays >= 1, `${label}: 资产不可达时应出现错误态遮罩（环境前提）`)
    check(failures, initial.topBar && initial.topBar.height >= 44,
      `${label}: 车名未加载时顶栏塌陷（height=${initial.topBar?.height}）`)
  } else {
    check(failures, initial.infoPanel?.visible === true && initial.infoPanelHeight !== null && initial.infoPanelHeight <= 26,
      `${label}: 顶栏信息行不是单行（#info-panel 高 ${initial.infoPanelHeight}px；长车名 + ru 等级/类型/国籍不得换行）`)
    check(failures, initial.infoPanelOverflowX === 'hidden',
      `${label}: 顶栏信息行没有裁剪（overflow-x=${initial.infoPanelOverflowX}；长车名会画到「参数」按钮下面）`)
  }
  check(failures, initial.topBar && initial.root && Math.abs((initial.topBar.top - initial.root.top) - 8) <= 2,
    `${label}: 顶栏没有贴 armor-view 顶边（top=${initial.topBar?.top} root top=${initial.root?.top}，期望间距 8）`)
  check(failures, initial.topBar && initial.topBar.height <= 56,
    `${label}: 顶栏高度 ${initial.topBar?.height}px，超过 56px 单行预算`)
  check(failures, initial.topBar && initial.root && Math.abs((initial.root.right - initial.topBar.right) - 8) <= 2,
    `${label}: 顶栏没有贴 armor-view 右缘（right=${initial.topBar?.right} root right=${initial.root?.right}，期望间距 8）`)
  check(failures, initial.bottomBar && initial.bottomBar.height <= 130,
    `${label}: 底栏高度 ${initial.bottomBar?.height}px，超过两行预算 130px（弹种 + 视图开关各一行）`)
  check(failures, initial.bottomBar && initial.root && Math.abs((initial.root.bottom - initial.bottomBar.bottom) - 8) <= 2,
    `${label}: 底栏没有贴底（bottom=${initial.bottomBar?.bottom}，armor-view bottom=${initial.root?.bottom}，期望间距 8）`)
  check(failures, !initial.selectors?.visible,
    `${label}: 参数面板默认应收起（selectors visible=${initial.selectors?.visible}）`)
  check(failures, initial.toolsOpen === false && initial.tools?.ariaExpanded === 'false',
    `${label}: 默认态 is-tools-open/aria-expanded 不正确（is-tools-open=${initial.toolsOpen} aria=${initial.tools?.ariaExpanded}）`)
  check(failures, initial.tools?.hitIsTools === true,
    `${label}: 顶栏参数开关中心被 ${initial.tools?.hitDescription} 覆盖`)
  check(failures, initial.viewToggleDisplay === 'grid',
    `${label}: 视图开关不是移动端三档网格（display=${initial.viewToggleDisplay}）`)
  if (initial.shellSelectClipped) {
    check(failures, initial.shellSelectClipped.clipped === false,
      `${label}: 弹种下拉被截断（scrollWidth=${initial.shellSelectClipped.scrollWidth} > clientWidth=${initial.shellSelectClipped.clientWidth}，最长选项 ${initial.shellSelectClipped.widestOptionChars} 字）`)
  }
  checkTouchTargets(failures, initial, label)
  checkSceneBand(failures, initial, label)
  if (initial.turretControls?.visible) {
    check(failures, initial.turretRowsInline === true, `${label}: 炮塔 / 炮管角度条不是单行`)
    check(failures, initial.turretControls.height <= 48, `${label}: 角度条高度 ${initial.turretControls.height}px 超过单行预算`)
    check(failures, initial.turretControls.top >= initial.topBar.bottom - 1,
      `${label}: 角度条与顶栏重叠（top=${initial.turretControls.top} < 顶栏 bottom=${initial.topBar.bottom}）`)
    check(failures, initial.turretControls.bottom <= initial.bottomBar.top,
      `${label}: 角度条与底栏重叠（bottom=${initial.turretControls.bottom} > 底栏 top=${initial.bottomBar.top}）`)
  }

  await page.installInputTrace()
  await page.tap({ ...initial.tools.center, touch: scenario.touch })
  const tapInput = await page.inputTrace()
  check(failures, tapInput?.click?.testId === 'armor-tools',
    `${label}: 真实点击落在 ${JSON.stringify(tapInput?.click)}，不是参数开关`)

  const opened = await page.probe(armorLayoutProbe)
  check(failures, opened.toolsOpen === true && opened.tools?.ariaExpanded === 'true',
    `${label}: 点击后面板未标记展开（is-tools-open=${opened.toolsOpen} aria=${opened.tools?.ariaExpanded}）`)
  check(failures, opened.selectors?.visible === true, `${label}: 点击后参数面板仍不可见`)
  check(failures, opened.selectors && opened.selectors.top >= opened.tools.bottom - 1,
    `${label}: 参数面板没有挂在顶栏第一行（开关）下方（panel top=${opened.selectors?.top} tools bottom=${opened.tools?.bottom}）`)
  check(failures, opened.selectors && opened.topBar && opened.selectors.bottom <= opened.topBar.bottom - 1,
    `${label}: 参数面板越出顶栏卡片（panel bottom=${opened.selectors?.bottom} bar bottom=${opened.topBar?.bottom}）`)
  check(failures, opened.selectors && opened.selectors.bottom <= opened.root.bottom - 4,
    `${label}: 参数面板越出 armor-view 底边（panel bottom=${opened.selectors?.bottom} root bottom=${opened.root.bottom}）`)
  check(failures, opened.selectors && opened.selectors.height <= opened.root.height * 0.46 + 2,
    `${label}: 参数面板高度 ${opened.selectors?.height}px 超过 46% 视口上限`)
  check(failures, opened.targetSelect?.visible === true, `${label}: 参数面板里没有可用的目标 / 选车按钮`)
  if (!scenario.assetless) {
    check(failures, opened.configSelect?.visible === true && opened.configSelect.height >= 43.5,
      `${label}: 配置下拉缺失或命中区不足 44px（${JSON.stringify(opened.configSelect)}）`)
    const visibleEq = opened.eqOpts.filter((option) => option.visible)
    check(failures, visibleEq.length === 2,
      `${label}: 可见装备复选框 label 数量 ${visibleEq.length}，期望 2（校准弹 / 强化装甲）`)
    check(failures, opened.eqOpts.length === 4
      && opened.eqOpts.some((option) => !option.visible && option.id === 'armor-state-opt')
      && opened.eqOpts.some((option) => !option.visible && option.id === 'pitch-device-opt'),
      `${label}: 静态夹具应有 2 个隐藏装备项（#armor-state-opt 动态装甲、#pitch-device-opt 无 122 槽位），`
      + `实测隐藏项 [${opened.eqOpts.filter((option) => !option.visible).map((option) => option.id || option.text).join(',')}]`)
    for (const option of visibleEq) {
      check(failures, option.height >= 43.5,
        `${label}: 装备「${option.text}」label 命中区 ${option.width}x${option.height}，低于 44px`)
      check(failures, option.clipped === false,
        `${label}: 装备「${option.text}」label 文案溢出盒子（width=${option.width} 需要 ≥${option.needed}）`)
    }
    if (visibleEq.length === 2) {
      const [first, second] = visibleEq
      check(failures, first.right <= second.left + 1,
        `${label}: 两个装备 label 重叠（第一个 right=${first.right} > 第二个 left=${second.left}）`)
    }
  }
  checkCommonGeometry(failures, opened, `${label} (expanded)`)
  console.log(`[browser-armor-mobile] ${label} metrics: topBar=${initial.topBar?.height}px infoPanel=${initial.infoPanelHeight}px `
    + `shellClipped=${initial.shellSelectClipped ? initial.shellSelectClipped.clipped : 'n/a'} `
    + `configSelect=${opened.configSelect ? opened.configSelect.height + 'px' : 'n/a'} `
    + `eqOpts=[${opened.eqOpts.map((option) => option.width + 'x' + option.height).join(',')}] sceneBand=${initial.bottomBar.top - initial.topBar.bottom}px`)

  await page.tap({ ...opened.tools.center, touch: scenario.touch })
  const collapsed = await page.probe(armorLayoutProbe)
  check(failures, collapsed.toolsOpen === false && collapsed.selectors?.visible === false,
    `${label}: 再次点击未收起（is-tools-open=${collapsed.toolsOpen} selectors visible=${collapsed.selectors?.visible}）`)

  await page.tap({ ...opened.tools.center, touch: scenario.touch })
  const expanded = await page.probe(armorLayoutProbe)
  check(failures, expanded.targetSelect?.visible === true, `${label}: 展开后目标按钮不可见，无法打开选车弹窗`)
  await page.tap({ x: expanded.targetSelect.left + Math.round(expanded.targetSelect.width / 2), y: expanded.targetSelect.top + Math.round(expanded.targetSelect.height / 2), touch: scenario.touch })
  if (scenario.assetless) {
    check(failures, await page.evaluate(`document.querySelector('#target-select').disabled && !document.querySelector('#tank-picker.open')`),
      `${label}: 初始化失败时选车入口应保持禁用且不能打开弹窗`)
    await env.chrome.client.send('Target.closeTarget', { targetId })
    results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
    return
  }
  const picker = await page.waitForValue(`!!document.querySelector('#tank-picker.open')`, (value) => value === true, { timeout: 5000, label: 'tank picker opened' })
    .then(() => page.probe(armorLayoutProbe))
    .catch(() => null)
  if (!picker) {
    check(failures, false, `${label}: 点击目标按钮未打开选车弹窗`)
  } else {
    check(failures, Math.abs(picker.picker.width - picker.root.width) <= 1 && Math.abs(picker.picker.height - picker.root.height) <= 1,
      `${label}: 选车弹窗不是全屏（picker ${picker.picker.width}x${picker.picker.height} vs root ${picker.root.width}x${picker.root.height}）`)
    check(failures, Math.min(picker.pickerClose.width, picker.pickerClose.height) >= 43.5,
      `${label}: 弹窗关闭键 ${picker.pickerClose.width}x${picker.pickerClose.height}，低于 44px`)
    check(failures, picker.pickerTitle.top >= picker.pickerClose.top - 1 && picker.pickerTitle.bottom <= picker.pickerClose.bottom + 1,
      `${label}: 关闭键被挤到与标题不同的行（close ${picker.pickerClose.top}..${picker.pickerClose.bottom} title ${picker.pickerTitle.top}..${picker.pickerTitle.bottom}）`)
    check(failures, picker.pickerClose.right <= picker.root.right - 4 + 1,
      `${label}: 关闭键超出 armor-view 右缘（right=${picker.pickerClose.right} root right=${picker.root.right}）`)
    check(failures, picker.pickerSearch.top >= picker.pickerTitle.bottom - 1,
      `${label}: 搜索框没有独占一行（search top=${picker.pickerSearch.top} title bottom=${picker.pickerTitle.bottom}）`)
    check(failures, picker.pickerSearch.height >= 43.5,
      `${label}: 选车搜索框高度 ${picker.pickerSearch.height}px，低于 44px`)
    check(failures, picker.pickerFilterToggle && Math.min(picker.pickerFilterToggle.width, picker.pickerFilterToggle.height) >= 43.5,
      `${label}: 筛选入口 ${JSON.stringify(picker.pickerFilterToggle)}，低于 44px`)
    if (picker.pickerFilterToggle) {
      await page.tap({
        x: picker.pickerFilterToggle.left + Math.round(picker.pickerFilterToggle.width / 2),
        y: picker.pickerFilterToggle.top + Math.round(picker.pickerFilterToggle.height / 2),
        touch: scenario.touch,
      })
      const sheet = await page.waitForValue(`(${pickerSheetProbe.toString()})()`, value => value?.sheet === true && value.boxes.every(box => box?.visible),
        { timeout: 5000, label: 'picker filter sheet' }).catch(() => null)
      check(failures, !!sheet && sheet.boxes.every(box => box && box.height >= 43.5) && sheet.done && sheet.done.height >= 43.5,
        `${label}: 筛选 sheet 的筛选控件/完成按钮缺失或低于 44px（boxes=${JSON.stringify(sheet?.boxes)} done=${JSON.stringify(sheet?.done)}）`)
      await page.waitForValue(`document.getAnimations().every(animation => animation.playState !== 'running')`, value => value === true,
        { timeout: 3000, label: 'sheet enter animation settled' }).catch(() => {})
      const done = await page.evaluate(`(() => {
        const el = document.querySelector('[data-testid="filter-sheet-done"]')
        if (!el) return null
        const rect = el.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, visible: rect.width > 0 && rect.height > 0 }
      })()`)
      check(failures, !!done?.visible, `${label}: 筛选 sheet 缺少可点击的「完成」按钮`)
      if (done?.visible) {
        await page.tap({ x: done.x, y: done.y, touch: scenario.touch })
      }
      await page.waitForValue(`!document.querySelector('[role="dialog"] [data-testid="tank-filters"]')`, value => value === true,
        { timeout: 5000, label: 'picker filter sheet closed' }).catch(() => {})
      const released = await page.waitForValue(`getComputedStyle(document.body).pointerEvents !== 'none'`, value => value === true,
        { timeout: 3000, label: 'body pointer-events released' }).then(() => true).catch(() => false)
      const releaseState = released ? null : await page.evaluate(`JSON.stringify({ style: document.body.getAttribute('style'), layers: [...document.querySelectorAll('[data-dismissable-layer],[data-state]')].filter(e => /sheet|dialog|drawer/i.test(e.className + e.getAttribute('role'))).map(e => e.className + '|' + e.getAttribute('data-state')), scrims: document.querySelectorAll('[data-testid=sheet-scrim]').length, sheets: document.querySelectorAll('.sheet').length })`)
      check(failures, released, `${label}: 筛选 sheet 关闭后 body 仍是 pointer-events: none ${releaseState || ''}`)
    }
    await page.tap({ x: picker.pickerClose.left + Math.round(picker.pickerClose.width / 2), y: picker.pickerClose.top + Math.round(picker.pickerClose.height / 2), touch: scenario.touch })
    const closed = await page.waitForValue(`document.querySelector('#tank-picker').classList.contains('open')`, (value) => value === false, { timeout: 5000, label: 'tank picker closed' })
      .then(() => true)
      .catch(() => false)
    check(failures, closed, `${label}: 点击关闭键后选车弹窗未关闭`)
  }

  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
}

async function runMobileBackScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)

  const url = `${env.origin}/?view=agent-armor&ws-auth=1&tank=${FIXTURE_TANK_ID}&assets=${encodeURIComponent(env.assets)}`
  await page.goto(url)
  await page.evaluate(`history.replaceState({ back: '/', current: location.href, forward: null }, '', location.href)`)
  await env.chrome.client.send('Page.reload', {}, sessionId)
  await page.waitFor(() => !!document.querySelector('[data-testid="armor-stage"]'), { label: 'armor stage after reload' })
  await page.waitFor(() => !!document.querySelector('[data-testid="armor-back"]'), { label: 'armor back button' })
  await page.waitFor(() => !document.querySelector('[data-testid="scene3d-loading"]') && !document.querySelector('[data-testid="scene3d-error"]') && !document.querySelector('#target-select').disabled, { label: 'viewer initialized after reload' })
  await delay(150)

  const layout = await page.probe(armorLayoutProbe)
  const label = scenario.name
  check(failures, layout.back?.visible === true, `${label}: 返回键未显示`)
  checkTouchTargets(failures, layout, label)
  check(failures, layout.topBar.left >= layout.back.right - 1,
    `${label}: 顶栏与返回键重叠（bar left=${layout.topBar.left} back right=${layout.back.right}）`)
  check(failures, layout.root && Math.abs((layout.topBar.top - layout.root.top) - 8) <= 2 && Math.abs((layout.back.top - layout.root.top) - 8) <= 2,
    `${label}: 返回键与顶栏不在同一行或没有贴 armor-view 顶边（back top=${layout.back.top} bar top=${layout.topBar.top} root top=${layout.root?.top}）`)
  check(failures, layout.root && Math.abs((layout.topBar.left - layout.root.left) - 60) <= 2,
    `${label}: 顶栏没有给返回键让出位置（bar left=${layout.topBar.left} root left=${layout.root?.left}，期望间距 60）`)
  checkSceneBand(failures, layout, label)
  checkCommonGeometry(failures, layout, label)

  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height} (with back)` })
}

const DESKTOP_SCENARIOS = [
  { name: 'armor-740x360-landscape-coarse', width: 740, height: 360, touch: true, phoneLandscape: true },
  { name: 'armor-1024x768-landscape-tablet-coarse', width: 1024, height: 768, touch: true, tabletLandscape: true },
  { name: 'armor-768x1024-tablet-boundary', width: 768, height: 1024, touch: false },
  { name: 'armor-1024x768-tablet', width: 1024, height: 768, touch: false },
  { name: 'armor-1280x800-desktop', width: 1280, height: 800, touch: false },
]

async function runDesktopScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)

  await page.goto(`${env.origin}/?view=agent-armor&ws-auth=1&tank=${FIXTURE_TANK_ID}&assets=${encodeURIComponent(env.assets)}`)
  await page.waitFor(() => !!document.querySelector('[data-testid="armor-stage"]'), { label: 'armor stage' })
  await page.waitFor(() => !document.querySelector('[data-testid="scene3d-loading"]') && !document.querySelector('[data-testid="scene3d-error"]') && !document.querySelector('#target-select').disabled, { label: 'viewer initialized' })
  await delay(150)

  const label = scenario.name
  const layout = await page.probe(armorLayoutProbe)
  check(failures, layout.hasStage && !layout.unsupported, `${label}: 场景未渲染（hasStage=${layout.hasStage} unsupported=${layout.unsupported}）`)
  checkCommonGeometry(failures, layout, label)
  if (scenario.phoneLandscape) {
    check(failures, layout.shellChrome === 'immersive',
      `${label}: 手机横屏未申请沉浸态（dataset=${layout.shellChrome}）`)
    check(failures, layout.appTopBar === null && layout.appTabBar === null,
      `${label}: 沉浸态下外壳顶栏仍渲染或出现 Tab 栏（top=${!!layout.appTopBar} tab=${!!layout.appTabBar}）`)
    check(failures, layout.root && layout.root.top === 0 && Math.abs(layout.root.height - layout.viewport.height) <= 1,
      `${label}: armor-view 没有占满整屏（root=${JSON.stringify(layout.root)} viewport=${JSON.stringify(layout.viewport)}）`)
    check(failures, layout.back?.visible === true,
      `${label}: 沉浸态缺少返回/退出入口（返回键未显示）`)
  }
  if (scenario.tabletLandscape) {
    check(failures, layout.shellChrome !== 'immersive', `${label}: 平板横屏不应申请沉浸态（dataset=${layout.shellChrome}）`)
  }
  if (scenario.touch) checkTouchTargets(failures, layout, label)
  check(failures, layout.tools?.visible === true,
    `${label}: 桌面档参数开关必须可见（display=${layout.tools?.display}）`)
  check(failures, layout.selectors?.visible === false,
    `${label}: 桌面档设置面板默认应收起（visible=${layout.selectors?.visible}）`)
  check(failures, layout.toolsOpen === false && layout.tools?.ariaExpanded === 'false',
    `${label}: 桌面档默认收起状态不正确（is-tools-open=${layout.toolsOpen} aria=${layout.tools?.ariaExpanded}）`)
  const backRel = layout.back && layout.root
    ? { top: layout.back.top - layout.root.top, left: layout.back.left - layout.root.left } : null
  const barRel = layout.topBar && layout.root
    ? { top: layout.topBar.top - layout.root.top, left: layout.topBar.left - layout.root.left } : null
  const compactScene = isCompactScene(layout)
  const expectedSpace2 = compactScene ? 6 : 8
  const expectedSpace5 = compactScene ? 15 : 20
  const sceneSpace2 = layout.sceneTokens?.space2 ?? 8
  const sceneSpace5 = layout.sceneTokens?.space5 ?? 20
  check(failures, sceneSpace2 === expectedSpace2 && sceneSpace5 === expectedSpace5,
    `${label}: 场景间距 token space-2/space-5 为 ${sceneSpace2}/${sceneSpace5}，期望 ${expectedSpace2}/${expectedSpace5}`)
  const coexistVertical = layout.back && layout.topBar
    && Math.abs((layout.topBar.top - layout.back.bottom) - sceneSpace2) <= 2
    && Math.abs(barRel.left - sceneSpace5) <= 2
  const coexistHorizontal = layout.back && layout.topBar
    && Math.abs((layout.topBar.left - layout.back.right) - sceneSpace2) <= 2
    && Math.abs(barRel.top - sceneSpace5) <= 2
  const coexistMergedCapsule = scenario.phoneLandscape && scenario.height <= 500 && layout.back && layout.topBar
    && Math.abs(layout.topBar.left - layout.back.right) <= 1
    && Math.abs(layout.topBar.top - layout.back.top) <= 1
    && Math.abs(layout.topBar.height - layout.back.height) <= 1
  const backInsetLeft = scenario.phoneLandscape ? sceneSpace5 + 52 : sceneSpace5
  check(failures, !!backRel && Math.abs(backRel.top - sceneSpace5) <= 2 && Math.abs(backRel.left - backInsetLeft) <= 2,
    `${label}: 返回键没有贴 armor-view 左上 inset ${sceneSpace5}/${backInsetLeft}（back=${JSON.stringify(backRel)}）`)
  if (scenario.phoneLandscape) {
    const menu = await page.evaluate(`(() => { const el = document.querySelector('[data-testid="nav-menu"]'); if (!el) return null; const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { right: r.right, hit: !!hit && el.contains(hit) } })()`)
    check(failures, menu?.hit === true && layout.back && menu.right <= layout.back.left,
      `${label}: 沉浸态左上菜单按钮不可达或与返回键重叠（menu=${JSON.stringify(menu)} back.left=${layout.back?.left}）`)
  }
  check(failures, coexistVertical || coexistHorizontal || coexistMergedCapsule,
    `${label}: 顶栏未在返回键下方 / 右侧留出 space-2，也未与返回键并成同一条胶囊（bar=${JSON.stringify(barRel)} back=${JSON.stringify(layout.back && { bottom: layout.back.bottom, right: layout.back.right })}）`)
  if (scenario.phoneLandscape) {
    check(failures, layout.bottomBar && layout.root
      && Math.abs((layout.root.bottom - layout.bottomBar.bottom) - sceneSpace2) <= 2 && Math.abs((layout.root.right - layout.bottomBar.right) - sceneSpace5) <= 2,
      `${label}: 射击快捷面板没有停在右下拇指区（bottom=${layout.bottomBar?.bottom} right=${layout.bottomBar?.right}，期望间距 ${sceneSpace2}/${sceneSpace5}）`)
  } else {
    check(failures, layout.bottomBar && layout.root
      && Math.abs((layout.bottomBar.top - layout.root.top) - 20) <= 2 && Math.abs((layout.root.right - layout.bottomBar.right) - 20) <= 2,
      `${label}: 底栏没有回到右上角（top=${layout.bottomBar?.top} right=${layout.bottomBar?.right} root right=${layout.root?.right}，期望相对 20/20）`)
  }
  const compactLandscape = scenario.phoneLandscape && scenario.height <= 500
  check(failures, layout.viewToggleDisplay === 'flex' || (compactLandscape && layout.viewToggleDisplay === 'grid'),
    `${label}: 视图开关不是桌面 flex 布局（display=${layout.viewToggleDisplay}）`)
  const panelWidth = layout.bottomBar?.width
  await page.evaluate(`document.getElementById('collision-btn').click()`)
  await delay(200)
  const thicknessLayout = await page.probe(armorLayoutProbe)
  check(failures, thicknessLayout.bottomBar?.width === panelWidth,
    `${label}: 进入装甲厚度模式后右上角面板宽度变化（${panelWidth} → ${thicknessLayout.bottomBar?.width}px）`)
  await page.evaluate(`document.getElementById('collision-btn').click()`)
  await delay(200)

  await page.installInputTrace()
  await page.tap({ ...layout.tools.center, touch: scenario.touch })
  const tapInput = await page.inputTrace()
  check(failures, tapInput?.click?.testId === 'armor-tools',
    `${label}: 真实点击落在 ${JSON.stringify(tapInput?.click)}，不是参数开关`)
  const opened = await page.probe(armorLayoutProbe)
  check(failures, opened.toolsOpen === true && opened.tools?.ariaExpanded === 'true',
    `${label}: 点击后设置面板未展开（is-tools-open=${opened.toolsOpen} aria=${opened.tools?.ariaExpanded}）`)
  check(failures, opened.selectors?.visible === true, `${label}: 点击后设置面板仍不可见`)
  if (scenario.phoneLandscape) {
    check(failures, opened.selectors && opened.root
      && Math.abs(opened.selectors.right - opened.root.right) <= 1 && opened.selectors.top <= opened.root.top + 1
      && Math.abs(opened.selectors.bottom - opened.root.bottom) <= 1 && opened.selectors.width <= opened.root.width * 0.5,
      `${label}: 设置面板不是右侧整高面板（panel=${JSON.stringify(opened.selectors)} root=${JSON.stringify(opened.root)}）`)
    check(failures, opened.selectors && opened.tools && opened.tools.right <= opened.selectors.left,
      `${label}: 参数开关被右侧面板盖住（tools right=${opened.tools?.right} panel left=${opened.selectors?.left}）`)
  } else {
    check(failures, opened.selectors && opened.tools && opened.selectors.top >= opened.tools.bottom - 1,
      `${label}: 设置面板没有排在参数开关下方（panel top=${opened.selectors?.top} tools bottom=${opened.tools?.bottom}）`)
    check(failures, opened.selectors && opened.topBar
      && opened.selectors.left >= opened.topBar.left - 1
      && opened.selectors.right <= opened.topBar.right + 1
      && opened.selectors.bottom <= opened.topBar.bottom + 1,
      `${label}: 设置面板没有并进左上角信息卡（panel=${opened.selectors?.left}/${opened.selectors?.bottom} bar=${opened.topBar?.left}/${opened.topBar?.bottom}）`)
  }
  check(failures, opened.targetSelect?.visible === true, `${label}: 展开后目标按钮不可见`)
  check(failures, opened.configSelect?.visible === true, `${label}: 展开后配置下拉不可见`)
  checkCommonGeometry(failures, opened, `${label} (expanded)`)

  const setConfig = async (index) => {
    await page.evaluate(`(() => {
      const sel = document.getElementById('config-select')
      sel.value = '${index}'
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      return sel.value
    })()`)
    await delay(120)
  }
  const scanArmorHit = () => page.evaluate(`(() => {
    const H = window.__armorRicochet, c = document.querySelector('canvas'), r = c.getBoundingClientRect()
    const out = {}
    for (const step of [12, 6]) {
      for (let cy = 16; cy < c.height - 16; cy += step) {
        for (let cx = 16; cx < c.width - 16; cx += step) {
          const px = r.left + cx, py = r.top + cy
          if (document.elementFromPoint(px, py) !== c) continue
          for (const hit of (H.__raytrace(px, py) || [])) {
            if (!out.turret && hit.sec === 'turret' && /armor_(\\d+)/.test(hit.name)) {
              out.turret = { x: px, y: py, name: hit.name, th: hit.th }
            }
            if (!out.gun && hit.sec === 'gunBarrel') {
              out.gun = { x: px, y: py, name: hit.name, th: hit.th }
            }
          }
          if (out.turret && out.gun) return out
        }
      }
      if (out.turret && out.gun) return out
    }
    return out
  })()`)
  const readHitAt = (spot, section) => page.evaluate(`(() => {
    const hits = window.__armorRicochet.__raytrace(${spot.x}, ${spot.y}) || []
    return hits.find(hit => ${JSON.stringify(section)} === 'turret'
      ? hit.sec === 'turret' && hit.name === ${JSON.stringify(spot.name)}
      : hit.sec === 'gunBarrel') || null
  })()`)
  await setConfig(0)
  const stock = await scanArmorHit()
  check(failures, !!stock.turret && !!stock.gun,
    `${label}: 夹具未找到炮塔/炮管装甲像素（${JSON.stringify(stock)}）`)
  if (stock.turret && stock.gun) {
    const plateId = stock.turret.name.match(/armor_(\d+)/)[1]
    const stockCfg = FIXTURE_TANK_DATA.configs[0]
    check(failures, stock.turret.th === stockCfg.turret_plates[plateId],
      `${label}: stock 炮塔板 ${plateId} 厚度 ${stock.turret.th} != ${stockCfg.turret_plates[plateId]}`)
    check(failures, stock.gun.th === stockCfg.gun_thickness,
      `${label}: stock 炮管厚度 ${stock.gun.th} != ${stockCfg.gun_thickness}`)
    await setConfig(1)
    const topTurret = await readHitAt(stock.turret, 'turret')
    const topGun = await readHitAt(stock.gun, 'gun')
    const topCfg = FIXTURE_TANK_DATA.configs[1]
    check(failures, topTurret?.th === topCfg.turret_plates[plateId],
      `${label}: top 炮塔板 ${plateId} 厚度 ${topTurret?.th} != ${topCfg.turret_plates[plateId]}（配置缓存未刷新？）`)
    check(failures, topGun?.th === topCfg.gun_thickness,
      `${label}: top 炮管厚度 ${topGun?.th} != ${topCfg.gun_thickness}（gunBarrel 缓存未刷新？）`)
  }

  await page.tap({ ...opened.tools.center, touch: scenario.touch })
  const collapsed = await page.probe(armorLayoutProbe)
  check(failures, collapsed.toolsOpen === false && collapsed.selectors?.visible === false,
    `${label}: 再次点击未收起（is-tools-open=${collapsed.toolsOpen} selectors visible=${collapsed.selectors?.visible}）`)

  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
}


function applyCompactHeaderFixture() {
  const title = document.getElementById('tank-name')
  if (title) title.textContent = '116-F3 X · 重型坦克 · 实验型'
  const tier = document.getElementById('tank-tier')
  if (tier) tier.textContent = 'VIII'
  const type = document.getElementById('tank-type')
  if (type) type.textContent = '重型坦克'
  const info = document.getElementById('info-panel')
  if (info) info.style.display = 'block'
  return true
}

function applyCompactResultBadge() {
  const click = document.getElementById('click-info')
  if (click) click.style.display = 'none'
  const traj = document.getElementById('traj-info')
  if (!traj) return false
  traj.style.display = 'block'
  traj.classList.add('is-expanded')
  traj.setAttribute('aria-expanded', 'true')
  traj.innerHTML = '<div style="background:var(--tooltip-bg);border:1px solid var(--border);border-radius:var(--radius-md);box-shadow:var(--elevation-2);padding:4px 8px;box-sizing:border-box;max-width:360px;">'
    + '<div data-card-title="final" style="display:flex;flex-wrap:wrap;align-items:baseline;gap:3px;font:700 14px/16px var(--font-family-sans);color:var(--color-success);">'
    + '击穿<span style="font:400 var(--font-size-caption-xs)/var(--line-height-caption-xs) var(--font-family-sans);color:var(--color-text-secondary);">· 420</span></div>'
    + '<div data-card-title="segment" style="font:400 var(--font-size-caption-xs)/var(--line-height-caption-xs) var(--font-family-sans);color:var(--color-text-secondary);">击穿概率 72% · 车体装甲板</div>'
    + '</div>'
  return true
}

async function captureCompactScreenshot(env, page, name) {
  const { data } = await env.chrome.client.send('Page.captureScreenshot', { format: 'png' }, page.sessionId)
  await mkdir(COMPACT_SCREENSHOT_DIR, { recursive: true })
  const file = join(COMPACT_SCREENSHOT_DIR, `${name}.png`)
  await writeFile(file, Buffer.from(data, 'base64'))
  console.log(`[browser-armor-mobile] screenshot ${file}`)
}

async function compactTarget(page, selector) {
  await page.callWith((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }), selector)
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  return page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const hit = document.elementFromPoint(x, y)
    return {
      x, y,
      center: { x, y },
      width: Math.round(r.width), height: Math.round(r.height),
      left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom),
      visible: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden',
      hit: hit === el || (!!hit && el.contains(hit)),
      hitDescription: hit ? \`\${hit.tagName}\${typeof hit.className === 'string' && hit.className.trim() ? \`.\${hit.className.trim().split(/\\s+/).join('.')}\` : ''}\` : null,
      inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
    }
  })()`)
}

function armorVisibilityProbe() {
  const counts = { primary: 0, spaced: 0, external: 0 }
  const dbg = window.__DBG__
  if (!dbg) return counts
  dbg.armorModel?.traverse((node) => {
    if (!node.isMesh) return
    const section = node.userData.armorSection
    if (!node.visible) return
    if (section === 'hull' || section === 'turret' || section === 'gun') counts.primary += 1
    if (section === 'spaced') counts.spaced += 1
  })
  dbg.scene?.traverse((node) => {
    if (node.isMesh && node.visible && (node.userData.armorSection === 'chassis' || node.userData.armorSection === 'gunBarrel')) counts.external += 1
  })
  return counts
}

const COMPACT_LANDSCAPE_SCENARIOS = [
  { name: 'armor-compact-landscape-844x390', width: 844, height: 390, touch: true, safeAreaInsets: { left: 47, right: 47 } },
  { name: 'armor-compact-landscape-780x360', width: 780, height: 360, touch: true, safeAreaInsets: { left: 47, right: 47 } },
  { name: 'armor-compact-landscape-768x360', width: 768, height: 360, touch: true, safeAreaInsets: { left: 47, right: 47 } },
  { name: 'armor-compact-landscape-740x360', width: 740, height: 360, touch: true },
  { name: 'armor-compact-landscape-600x320', width: 600, height: 320, touch: true },
]

async function runCompactLandscapeScenario(env, scenario) {
  const failures = []
  const label = scenario.name
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)
  if (scenario.safeAreaInsets) {
    await env.chrome.client.send('Emulation.setSafeAreaInsetsOverride', { insets: scenario.safeAreaInsets }, sessionId)
  }
  await page.goto(`${env.origin}/?view=agent-armor&ws-auth=1&tank=${FIXTURE_TANK_ID}&shooter=${FIXTURE_TANK_ID}&assets=${encodeURIComponent(env.compactAssets)}`)
  await page.waitFor(() => !!document.querySelector('[data-testid="armor-stage"]'), { label: 'armor stage' })
  await page.waitFor(() => !document.querySelector('[data-testid="scene3d-loading"]') && !document.querySelector('[data-testid="scene3d-error"]') && !document.querySelector('#target-select').disabled,
    { timeout: 30000, label: 'viewer initialized' })
  await delay(150)

  const hudAppeared = await page.waitFor(() => !!document.querySelector('[data-testid="armor-shot-hud"]'), { timeout: 6000, label: 'shot hud ready' })
    .then(() => true).catch(() => false)
  const nativeShellHidden = await page.waitFor(() => getComputedStyle(document.querySelector('#shell-selector')).display === 'none', { timeout: 3000, label: 'native shell selector hidden' })
    .then(() => true).catch(() => false)
  const hudDebug = await page.evaluate(`(() => ({
    hud: !!document.querySelector('[data-testid="armor-shot-hud"]'),
    shellSelector: getComputedStyle(document.querySelector('#shell-selector')).display,
    shellOptions: [...document.querySelectorAll('#shell-select option')].map(option => option.textContent),
    targetValue: document.querySelector('#target-select')?.value,
    shooterValue: document.querySelector('#shooter-select')?.value,
    shellValue: document.querySelector('#shell-select')?.value,
  }))()`)
  console.log(`[browser-armor-mobile] ${label} HUD ready=${hudAppeared} ${JSON.stringify(hudDebug)}`)
  check(failures, hudAppeared, `${label}: 射击快捷 HUD 未渲染（debug=${JSON.stringify(hudDebug)}）`)
  check(failures, nativeShellHidden && hudDebug.shellSelector === 'none',
    `${label}: 原生弹种下拉仍可见（display=${hudDebug.shellSelector}）`)
  await page.probe(applyCompactHeaderFixture)
  await page.probe(applyCompactResultBadge)
  await page.animationsSettled()
  await delay(100)
  const layout = await page.probe(armorLayoutProbe)
  checkCompactLandscapeHud(failures, layout, label, scenario.height)
  const compactFloor = layout.sceneTokens?.hitComfortable ?? 44

  await page.installInputTrace()
  await page.tap({ ...layout.tools.center, touch: true })
  const tapInput = await page.inputTrace()
  check(failures, tapInput?.click?.testId === 'armor-tools',
    `${label}: 真实点击落在 ${JSON.stringify(tapInput?.click)}，不是参数开关`)
  const opened = await page.probe(armorLayoutProbe)
  check(failures, opened.toolsOpen === true && opened.tools?.ariaExpanded === 'true',
    `${label}: 点击后设置面板未展开（is-tools-open=${opened.toolsOpen} aria=${opened.tools?.ariaExpanded}）`)
  check(failures, opened.selectors?.visible === true, `${label}: 点击后设置面板仍不可见`)
  await page.animationsSettled()
  await captureCompactScreenshot(env, page, `${scenario.name}-drawer`)
  if (scenario.width >= 768) {
    check(failures, opened.tools?.hitIsTools === true,
      `${label}: 展开后参数开关中心被 ${opened.tools?.hitDescription} 覆盖`)
  }
  const closeTarget = await compactTarget(page, '[data-testid="armor-tools-close"]')
  check(failures, closeTarget?.visible === true && closeTarget?.hit === true && closeTarget?.inside === true,
    `${label}: 设置抽屉关闭按钮不可触达（${JSON.stringify(closeTarget)}）`)
  check(failures, closeTarget && Math.min(closeTarget.width, closeTarget.height) >= compactFloor - 0.5,
    `${label}: 设置抽屉关闭按钮 ${closeTarget?.width}x${closeTarget?.height}，低于 ${compactFloor}px`)
  const targetButton = await compactTarget(page, '#target-select')
  check(failures, targetButton?.hit === true && targetButton?.inside === true,
    `${label}: 抽屉内目标选择器不可触达（${JSON.stringify(targetButton)}）`)
  await page.tap({ x: targetButton.x, y: targetButton.y, touch: true })
  await page.waitFor(() => !!document.querySelector('#tank-picker.open'), { label: 'target picker opened from drawer' })
  await page.tapSelector('#tp-close', true)
  await page.waitFor(() => !document.querySelector('#tank-picker.open'), { label: 'target picker closed' })
  check(failures, await page.evaluate(`!!document.querySelector('.armor-stage.is-tools-open')`),
    `${label}: 关闭目标选择器后设置抽屉丢失打开状态`)
  await page.resetInputTrace()
  await page.tap({ x: closeTarget.center.x, y: closeTarget.center.y, touch: true })
  const closeInput = await page.inputTrace()
  check(failures, closeInput?.click?.testId === 'armor-tools-close',
    `${label}: 关闭按钮真实点击落在 ${JSON.stringify(closeInput?.click)}`)
  const collapsed = await page.probe(armorLayoutProbe)
  check(failures, collapsed.toolsOpen === false && collapsed.selectors?.visible === false,
    `${label}: 关闭按钮未收起设置面板（is-tools-open=${collapsed.toolsOpen} selectors visible=${collapsed.selectors?.visible}）`)
  await page.tap({ ...layout.tools.center, touch: true })
  const reopened = await page.probe(armorLayoutProbe)
  check(failures, reopened.toolsOpen === true && reopened.selectors?.visible === true,
    `${label}: 收起后无法再次打开设置面板`)
  const closeAgain = await compactTarget(page, '[data-testid="armor-tools-close"]')
  check(failures, closeAgain?.hit === true, `${label}: 第二次打开后关闭按钮不可触达`)
  await page.tap({ x: closeAgain.center.x, y: closeAgain.center.y, touch: true })
  const collapsedAgain = await page.probe(armorLayoutProbe)
  check(failures, collapsedAgain.toolsOpen === false && collapsedAgain.selectors?.visible === false,
    `${label}: 第二次打开后无法关闭设置面板`)

  await page.evaluate(`(() => {
    const traj = document.querySelector('#traj-info')
    if (traj) traj.style.display = 'none'
    const click = document.querySelector('#click-info')
    if (click) click.style.display = 'none'
  })()`)
  const collision = await compactTarget(page, '#collision-btn')
  check(failures, collision?.hit === true && collision?.inside === true,
    `${label}: 厚度模式开关不可触达（${JSON.stringify(collision)}）`)
  await page.tap({ x: collision.x, y: collision.y, touch: true })
  await page.waitForValue(`document.querySelector('#collision-btn').getAttribute('aria-pressed')`,
    (value) => value === 'true', { label: 'thickness mode active' })
  await page.waitForValue(`!document.querySelector('#armor-filters').hidden`, Boolean,
    { label: 'armor filters visible' })
  const filterMetrics = await page.evaluate(`(() => {
    const toggle = document.querySelector('#view-toggle')
    const buttons = [...document.querySelectorAll('#armor-filters button')]
    return {
      toggleHeight: Math.round(toggle.getBoundingClientRect().height),
      count: buttons.length,
      buttons: buttons.map(button => ({ text: button.textContent.trim(), height: Math.round(button.getBoundingClientRect().height) })),
    }
  })()`)
  check(failures, filterMetrics.count === 3, `${label}: 装甲分类过滤按钮不是 3 个（${JSON.stringify(filterMetrics)}）`)
  check(failures, filterMetrics.toggleHeight > 38,
    `${label}: 厚度模式过滤行被压扁（#view-toggle 高 ${filterMetrics.toggleHeight}px，${JSON.stringify(filterMetrics)}）`)
  await page.callWith((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }), '#filter-primary')
  await page.animationsSettled()
  await captureCompactScreenshot(env, page, `${scenario.name}-thickness`)
  const filterCategories = [
    { name: 'primary', id: '#filter-primary' },
    { name: 'spaced', id: '#filter-spaced' },
    { name: 'external', id: '#filter-external' },
  ]
  for (const category of filterCategories) {
    const target = await compactTarget(page, category.id)
    check(failures, target?.hit === true && target?.inside === true,
      `${label}: ${category.id} 不可触达（${JSON.stringify(target)}）`)
    check(failures, target && Math.min(target.width, target.height) >= compactFloor - 0.5,
      `${label}: ${category.id} 触控目标 ${target?.width}x${target?.height}，低于 ${compactFloor}px`)
    const pressed = await page.evaluate(`document.querySelector('${category.id}').getAttribute('aria-pressed')`)
    check(failures, pressed === 'true', `${label}: ${category.id} 初始 aria-pressed=${pressed}`)
    const countsBefore = await page.probe(armorVisibilityProbe)
    await page.tap({ x: target.x, y: target.y, touch: true })
    const off = await page.waitForValue(`(() => ({
      pressed: document.querySelector('${category.id}').getAttribute('aria-pressed'),
      counts: (${armorVisibilityProbe.toString()})(),
    }))()`, (value) => value.pressed === 'false', { label: `${category.id} pressed off` })
    if (countsBefore[category.name] > 0) {
      check(failures, off.counts[category.name] === 0,
        `${label}: 关闭 ${category.id} 后仍有 ${off.counts[category.name]} 个网格可见（before=${JSON.stringify(countsBefore)}）`)
    }
    const targetAgain = await compactTarget(page, category.id)
    await page.tap({ x: targetAgain.x, y: targetAgain.y, touch: true })
    const on = await page.waitForValue(`(() => ({
      pressed: document.querySelector('${category.id}').getAttribute('aria-pressed'),
      counts: (${armorVisibilityProbe.toString()})(),
    }))()`, (value) => value.pressed === 'true', { label: `${category.id} pressed on` })
    if (countsBefore[category.name] > 0) {
      check(failures, on.counts[category.name] === countsBefore[category.name],
        `${label}: 恢复 ${category.id} 后网格可见数 ${on.counts[category.name]} 与初始 ${countsBefore[category.name]} 不一致`)
    }
    console.log(`[browser-armor-mobile] ${label} filter ${category.name}: before=${JSON.stringify(countsBefore)} off=${JSON.stringify(off.counts)} on=${JSON.stringify(on.counts)}`)
  }

  let realThickness = null
  const canvasPoints = [[0.4, 0.4], [0.5, 0.35], [0.35, 0.55], [0.45, 0.55], [0.3, 0.45], [0.55, 0.3]]
  for (const [fx, fy] of canvasPoints) {
    const point = await page.evaluate(`(() => {
      const canvas = document.querySelector('#canvas-container canvas')
      const stage = document.querySelector('[data-testid="armor-stage"]')
      if (!canvas || !stage) return null
      const r = stage.getBoundingClientRect()
      const x = r.left + r.width * ${fx}
      const y = r.top + r.height * ${fy}
      const hit = document.elementFromPoint(x, y)
      if (!(hit === canvas || canvas.contains(hit))) return null
      return { x, y }
    })()`)
    if (!point) continue
    await page.tap({ x: point.x, y: point.y, touch: true })
    await delay(250)
    const state = await page.evaluate(`(() => {
      const card = document.querySelector('#click-info')
      const part = document.querySelector('#click-part')
      const armor = document.querySelector('#click-armor')
      return { display: getComputedStyle(card).display, part: part?.textContent, armor: armor?.textContent }
    })()`)
    if (state.display !== 'none' && state.armor?.trim()) { realThickness = state; break }
  }
  check(failures, realThickness?.armor && /\d+\s*mm/.test(realThickness.armor),
    `${label}: 真实厚度点选没有产生厚度数值（${JSON.stringify(realThickness)}）`)
  console.log(`[browser-armor-mobile] ${label} real thickness result: ${JSON.stringify(realThickness)}`)

  const checkThicknessValue = async (part, armor, expected, labelText = '基础装甲') => {
    await page.evaluate(`(() => {
      document.querySelector('#click-part').textContent = ${JSON.stringify(part)}
      document.querySelector('#click-info .row > span').textContent = ${JSON.stringify(labelText)}
      document.querySelector('#click-armor').textContent = ${JSON.stringify(armor)}
      document.querySelector('#click-info').style.display = 'flex'
    })()`)
    await page.animationsSettled()
    const valueLayout = await page.probe(armorLayoutProbe)
    check(failures, valueLayout.clickInfo?.visible === true,
      `${label}: 厚度结果卡不可见（${JSON.stringify(valueLayout.clickInfo)}）`)
    check(failures, valueLayout.clickArmor?.visible === true && valueLayout.clickArmor.text === expected,
      `${label}: 厚度数值节点文本异常（${JSON.stringify(valueLayout.clickArmor)}）`)
    check(failures, valueLayout.clickArmor?.insideCard === true && valueLayout.clickArmor?.selfClipped === false,
      `${label}: 厚度数值节点被裁切（${JSON.stringify(valueLayout.clickArmor)}）`)
    check(failures, valueLayout.clickArmor?.insideContent === true,
      `${label}: 厚度数值超出结果卡可见内容区（card=${JSON.stringify(valueLayout.clickInfo)} value=${JSON.stringify(valueLayout.clickArmor)}）`)
    check(failures, valueLayout.clickInfo?.clipped === false
      && valueLayout.clickRow?.scrollWidth <= (valueLayout.clickInfo?.contentWidth ?? 0) + 1,
      `${label}: 厚度数值行横向溢出结果卡（row=${JSON.stringify(valueLayout.clickRow)} card=${JSON.stringify(valueLayout.clickInfo)}）`)
    check(failures, valueLayout.clickInfo.height <= resultHeightBudget(scenario.height),
      `${label}: 厚度结果卡高 ${valueLayout.clickInfo.height}px，超过预算 ${resultHeightBudget(scenario.height)}px`)
    console.log(`[browser-armor-mobile] ${label} thickness "${part} / ${armor}": card=${JSON.stringify(valueLayout.clickInfo)} value=${JSON.stringify(valueLayout.clickArmor)}`)
  }
  await checkThicknessValue('Hull', '200 mm', '200 mm', 'Base armor')
  await checkThicknessValue('炮塔正面附加装甲模块', '1280 mm', '1280 mm')

  const penetrationButton = await compactTarget(page, '#penetration-btn')
  check(failures, penetrationButton?.hit === true && penetrationButton?.inside === true,
    `${label}: 击穿模式开关不可触达（${JSON.stringify(penetrationButton)}）`)
  await page.tap({ x: penetrationButton.x, y: penetrationButton.y, touch: true })
  const penetrationState = await page.waitForValue(`(() => ({
    collision: document.querySelector('#collision-btn').getAttribute('aria-pressed'),
    penetration: document.querySelector('#penetration-btn').getAttribute('aria-pressed'),
    filtersHidden: document.querySelector('#armor-filters').hidden,
    clickDisplay: getComputedStyle(document.querySelector('#click-info')).display,
  }))()`, (value) => value.collision === 'false' && value.filtersHidden === true,
  { label: 'penetration mode restored' })
  check(failures, penetrationState.penetration === 'true' && penetrationState.clickDisplay === 'none',
    `${label}: 击穿模式恢复不完整（${JSON.stringify(penetrationState)}）`)
  const restoredLayout = await page.probe(armorLayoutProbe)
  check(failures, restoredLayout.viewToggle?.height <= 38,
    `${label}: 恢复击穿模式后分段开关高度 ${restoredLayout.viewToggle?.height}px`)

  await page.probe(applyCompactResultBadge)
  await page.animationsSettled()
  const finalLayout = await page.probe(armorLayoutProbe)
  checkCompactLandscapeHud(failures, finalLayout, label, scenario.height)

  await captureCompactScreenshot(env, page, scenario.name)

  const badge = await compactTarget(page, '#traj-info')
  check(failures, badge?.hit === true && badge?.inside === true,
    `${label}: 默认展开态结果卡不可触达（${JSON.stringify(badge)}）`)
  const defaultExpanded = await page.evaluate(`(() => {
    const el = document.querySelector('#traj-info')
    const segment = el.querySelector('[data-card-title="segment"]')
    const r = el.getBoundingClientRect()
    const sr = segment?.getBoundingClientRect()
    return {
      expanded: el.classList.contains('is-expanded'),
      aria: el.getAttribute('aria-expanded'),
      height: Math.round(r.height),
      segmentVisible: !!segment && getComputedStyle(segment).display !== 'none' && sr.width > 0 && sr.height > 0,
      segmentText: segment?.textContent,
    }
  })()`)
  check(failures, defaultExpanded.expanded === true && defaultExpanded.aria === 'true'
    && defaultExpanded.segmentVisible && /击穿概率/.test(defaultExpanded.segmentText || ''),
    `${label}: 默认展开态明细行不可见（${JSON.stringify(defaultExpanded)}）`)
  check(failures, defaultExpanded.height <= 72,
    `${label}: 默认展开结果卡高 ${defaultExpanded.height}px，超过 72px`)
  const expandedLayout = await page.probe(armorLayoutProbe)
  check(failures, expandedLayout.trajInfo?.visible === true,
    `${label}: 默认展开结果卡不可见（${JSON.stringify(expandedLayout.trajInfo)}）`)
  for (const [name, rect] of [
    ['左上胶囊', expandedLayout.capsule],
    ['右下射击面板', expandedLayout.bottomBar],
    ['左下姿态面板', expandedLayout.turretControls],
  ]) {
    check(failures, !rectsOverlap(expandedLayout.trajInfo, rect),
      `${label}: 默认展开结果卡与${name}相交（result=${JSON.stringify(expandedLayout.trajInfo)} other=${JSON.stringify(rect)}）`)
  }
  await captureCompactScreenshot(env, page, `${scenario.name}-expanded`)

  await page.tap({ x: badge.x, y: badge.y, touch: true })
  const collapsedState = await page.waitForValue(`(() => {
    const el = document.querySelector('#traj-info')
    const r = el.getBoundingClientRect()
    return { expanded: el.classList.contains('is-expanded'), aria: el.getAttribute('aria-expanded'), height: Math.round(r.height) }
  })()`, (value) => value.expanded === false, { label: 'result details collapsed' })
  check(failures, collapsedState.aria === 'false' && collapsedState.height <= 40,
    `${label}: 结果卡收起异常（${JSON.stringify(collapsedState)}）`)

  const collapsedBadge = await compactTarget(page, '#traj-info')
  check(failures, collapsedBadge?.hit === true && collapsedBadge?.inside === true,
    `${label}: 收起态结果卡不可触达（${JSON.stringify(collapsedBadge)}）`)
  await page.tap({ x: collapsedBadge.x, y: collapsedBadge.y, touch: true })
  const reopenedCard = await page.waitForValue(`(() => {
    const el = document.querySelector('#traj-info')
    const segment = el.querySelector('[data-card-title="segment"]')
    const r = el.getBoundingClientRect()
    const sr = segment?.getBoundingClientRect()
    return {
      expanded: el.classList.contains('is-expanded'),
      aria: el.getAttribute('aria-expanded'),
      height: Math.round(r.height),
      segmentVisible: !!segment && getComputedStyle(segment).display !== 'none' && sr.width > 0 && sr.height > 0,
      segmentText: segment?.textContent,
    }
  })()`, (value) => value.expanded === true, { label: 'result details expanded again' })
  check(failures, reopenedCard.aria === 'true' && reopenedCard.segmentVisible && /击穿概率/.test(reopenedCard.segmentText || ''),
    `${label}: 结果卡重新展开后明细行不可见（${JSON.stringify(reopenedCard)}）`)
  check(failures, reopenedCard.height <= 72,
    `${label}: 重新展开结果卡高 ${reopenedCard.height}px，超过 72px`)

  check(failures, page.consoleErrors.length === 0, `${label}: JS errors: ${page.consoleErrors.join(' | ')}`)
  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
}

const PICKER_TANK_CACHE = {
  ...FIXTURE_TANK_CACHE,
  ...Object.fromEntries(Array.from({ length: 120 }, (_, index) => {
    const id = 10000 + index
    return [id, { ...FIXTURE_TANK_CACHE[FIXTURE_TANK_ID], id, name: `Picker Medium ${String(index).padStart(3, '0')}` }]
  })),
}
const PICKER_PAGE_SIZE = 48
const PICKER_SCENARIOS = ['summer', 'winter'].flatMap(profile => [
  { name: `armor-picker-390x844-${profile}`, width: 390, height: 844, touch: true, profile },
  { name: `armor-picker-1024x768-${profile}`, width: 1024, height: 768, touch: false, profile },
  { name: `armor-picker-1440x900-${profile}`, width: 1440, height: 900, touch: false, profile },
  { name: `armor-picker-3840x2160-${profile}`, width: 3840, height: 2160, deviceScaleFactor: 1, touch: false, profile, fillViewport: true },
  { name: `armor-picker-resize-${profile}`, width: 1440, height: 900, deviceScaleFactor: 1, touch: false, profile, resize: true },
])
function pickerCardsProbe() {
  const grid = document.querySelector('#tp-grid')
  const cards = [...grid.querySelectorAll('.tank-card')]
  const clipped = cards.filter(card => {
    const outer = card.getBoundingClientRect()
    const children = [...card.querySelectorAll('.tp-media, .tp-card-name, .tp-badges')]
    return children.length !== 3 || children.some(child => {
      const inner = child.getBoundingClientRect(), style = getComputedStyle(child)
      return inner.width <= 0 || inner.height <= 0 || style.visibility === 'hidden'
        || inner.top < outer.top - 1 || inner.bottom > outer.bottom + 1
    })
  })
  const first = cards[0], outer = first?.getBoundingClientRect(), name = first?.querySelector('.tp-card-name')?.getBoundingClientRect()
  const hit = name ? document.elementFromPoint(name.left + name.width / 2, name.top + name.height / 2) : null
  const last = cards.at(-1), lastName = last?.querySelector('.tp-card-name')?.getBoundingClientRect()
  const lastHit = lastName ? document.elementFromPoint(lastName.left + lastName.width / 2, lastName.top + lastName.height / 2) : null
  const rect = grid.getBoundingClientRect()
  return {
    count: cards.length, clipped: clipped.length, clippedNames: clipped.slice(0, 3).map(card => card.textContent.trim()),
    firstHeight: outer?.height, firstNameHit: !!first && !!hit && first.contains(hit),
    lastNameHit: !!last && !!lastHit && last.contains(lastHit),
    scrollTop: grid.scrollTop, scrollHeight: grid.scrollHeight, clientHeight: grid.clientHeight,
    pageScroll: { x: scrollX, y: scrollY },
    overflowX: grid.scrollWidth > grid.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1,
    wheel: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) },
  }
}
function pickerSheetProbe() {
  const sheet = document.querySelector('[role="dialog"] [data-testid="tank-filters"]')
  const boxes = ['#tp-tier', '#tp-nation', '#tp-type', '#tp-sort'].map(selector => {
    const el = document.querySelector(selector)
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { width: Math.round(rect.width), height: Math.round(rect.height), visible: rect.width > 0 && rect.height > 0 }
  })
  const doneEl = document.querySelector('[data-testid="filter-sheet-done"]')
  const doneRect = doneEl ? doneEl.getBoundingClientRect() : null
  const done = doneRect
    ? { width: Math.round(doneRect.width), height: Math.round(doneRect.height), visible: doneRect.width > 0 && doneRect.height > 0 }
    : null
  return { sheet: !!sheet, boxes, done }
}
async function runPickerCardsScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  const PICKER_TOTAL = Object.keys(PICKER_TANK_CACHE).length
  const exhaustPicker = async (total) => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const count = await page.evaluate(`document.querySelectorAll('#tp-grid .tank-card').length`)
      if (count >= total) return count
      const probe = await page.probe(pickerCardsProbe)
      await env.chrome.client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...probe.wheel, deltaX: 0, deltaY: probe.scrollHeight }, sessionId)
      await page.waitForValue(`document.querySelectorAll('#tp-grid .tank-card').length`, next => next > count,
        { timeout: 3000, label: 'roster growth after wheel' }).catch(() => {})
    }
    return page.evaluate(`document.querySelectorAll('#tp-grid .tank-card').length`)
  }
  await page.enable(); await page.emulate(scenario)
  await page.goto(`${env.origin}/?view=home&ws-auth=1`)
  await page.evaluate(`localStorage.setItem('wotb-ui-profile', ${JSON.stringify(scenario.profile)})`)
  await page.goto(`${env.origin}/?view=agent-armor&ws-auth=1&tank=${FIXTURE_TANK_ID}&assets=${encodeURIComponent(env.pickerAssets)}`)
  await page.waitFor(() => !document.querySelector('[data-testid="scene3d-loading"]') && !document.querySelector('[data-testid="scene3d-error"]') && document.querySelector('#target-select')?.disabled === false,
    { timeout: 30000, label: 'picker fixture initialized' })
  const initialChrome = await page.probe(armorLayoutProbe)
  if (!initialChrome.selectors?.visible) {
    await page.tap({ ...initialChrome.tools.center, touch: scenario.touch })
  }
  await page.evaluate(`document.getElementById('target-select').scrollIntoView({ block: 'nearest' })`)
  await delay(80)
  const controls = await page.probe(armorLayoutProbe)
  await page.tap({ x: controls.targetSelect.left + controls.targetSelect.width / 2, y: controls.targetSelect.top + controls.targetSelect.height / 2, touch: scenario.touch })
  await page.waitFor(() => !!document.querySelector('#tank-picker.open') && document.querySelectorAll('#tp-grid .tank-card').length >= 48,
    { timeout: 5000, label: 'first roster page' })
  if (scenario.fillViewport) {
    await page.waitForValue(`document.querySelectorAll('#tp-grid .tank-card').length`, count => count > PICKER_PAGE_SIZE,
      { timeout: 5000, label: 'large viewport auto-fills' }).catch(() => {})
  }
  const initial = await page.probe(pickerCardsProbe)
  check(failures, await page.evaluate('document.documentElement.dataset.uiProfile') === scenario.profile,
    `${scenario.name}: requested presentation profile must be active`)
  check(failures, initial.clipped === 0 && initial.firstNameHit,
    `${scenario.name}: picker clips image/name/metadata or hides the name hit target: ${JSON.stringify(initial)}`)
  check(failures, initial.scrollHeight > initial.clientHeight && !initial.overflowX,
    `${scenario.name}: roster must scroll vertically without horizontal overflow: ${JSON.stringify(initial)}`)
  check(failures, scenario.fillViewport ? initial.count > PICKER_PAGE_SIZE : initial.count === PICKER_PAGE_SIZE,
    `${scenario.name}: first page fills/chunks the viewport as expected: ${JSON.stringify(initial)}`)
  if (failures.length === 0) {
    if (scenario.resize) {
      await page.emulate({ ...scenario, width: 3840, height: 2160, deviceScaleFactor: 1 })
      await page.waitForValue(`document.querySelectorAll('#tp-grid .tank-card').length`, count => count > initial.count,
        { timeout: 5000, label: 'resize appends a page without input' }).catch(() => {})
      const resized = await page.evaluate(`document.querySelectorAll('#tp-grid .tank-card').length`)
      check(failures, resized > initial.count,
        `${scenario.name}: resize must append a page before scrolling (${resized}/${PICKER_TOTAL}, initial ${initial.count})`)
    }
    const loadedCount = await exhaustPicker(PICKER_TOTAL)
    check(failures, loadedCount === PICKER_TOTAL,
      `${scenario.name}: scroll loads the remaining roster pages (${loadedCount}/${PICKER_TOTAL})`)
    if (scenario.fillViewport) {
      await page.evaluate(`document.getElementById('tp-search')?.focus()`)
      await env.chrome.client.send('Input.insertText', { text: 'Picker' }, sessionId)
      const filteredCount = await exhaustPicker(120)
      check(failures, filteredCount === 120,
        `${scenario.name}: filter refills the large visible picker (${filteredCount}/120)`)
    }
    const loaded = await page.probe(pickerCardsProbe)
    await env.chrome.client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...loaded.wheel, deltaX: 0, deltaY: loaded.scrollHeight }, sessionId)
    await page.waitForValue(`(${pickerCardsProbe.toString()})().lastNameHit`, hit => hit === true,
      { timeout: 5000, label: 'last roster card can be reached' })
    const scrolled = await page.probe(pickerCardsProbe)
    check(failures, scrolled.scrollTop > 0 && scrolled.clipped === 0 && scrolled.lastNameHit && !scrolled.overflowX,
      `${scenario.name}: appended roster cards must remain whole after real scrolling: ${JSON.stringify(scrolled)}`)
    const close = (await page.probe(armorLayoutProbe)).pickerClose
    await page.installInputTrace()
    await page.evaluate(`(() => {
      window.__pickerCloseClick = null
      document.addEventListener('click', event => {
        window.__pickerCloseClick = { trusted: event.isTrusted, button: event.target.closest('button')?.id || null }
      }, { once: true, capture: true })
    })()`)
    await page.tap({ x: close.left + close.width / 2, y: close.top + close.height / 2, touch: scenario.touch })
    const closed = await page.waitFor(() => !document.querySelector('#tank-picker.open'), { timeout: 5000, label: 'picker closed after raw input' }).then(() => true).catch(() => false)
    const trace = await page.inputTrace()
    const closeClick = await page.evaluate('window.__pickerCloseClick')
    const pageScroll = await page.evaluate('({ x: scrollX, y: scrollY })')
    check(failures, scrolled.pageScroll.x === initial.pageScroll.x && scrolled.pageScroll.y === initial.pageScroll.y
      && pageScroll.x === initial.pageScroll.x && pageScroll.y === initial.pageScroll.y,
      `${scenario.name}: scrolling at the roster boundary must not move the outer page: ${JSON.stringify({ initial: initial.pageScroll, beforeClose: scrolled.pageScroll, afterClose: pageScroll })}`)
    check(failures, closed && trace.clickCount === 1 && closeClick?.trusted && closeClick.button === 'tp-close',
      `${scenario.name}: picker close requires a trusted click on the close button and closed state: ${JSON.stringify({ trace, closeClick })}`)
  }
  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
}

const CONTEXT_LOSS_SCENARIO = { name: 'armor-context-lost-init', width: 1024, height: 768, touch: false }
const CONTEXT_LOSS_SELECTION_SCENARIO = { name: 'armor-context-lost-selection', width: 1024, height: 768, touch: false }
const CONTEXT_LOSS_SELECTION_TANK_CACHE = {
  ...FIXTURE_TANK_CACHE,
  [FIXTURE_SECOND_TANK_ID]: { id: FIXTURE_SECOND_TANK_ID, name: 'Fixture Heavy', tier: 8, nation: 'ussr', type: 'heavyTank' },
}

async function selectSecondFixtureTarget(page) {
  await page.waitFor(() => {
    const button = document.querySelector('#target-select')
    return !!button && !button.disabled
  }, { timeout: 30000, label: 'viewer ready for target selection' })
  await page.evaluate(`document.querySelector('#target-select').click()`)
  await page.waitFor(() => !!document.querySelector('#tank-picker.open')
    && document.querySelectorAll('[data-testid="tank-card"]').length >= 2,
  { timeout: 5000, label: 'target picker with second fixture tank' })
  const selected = await page.evaluate(`(() => {
    const card = document.querySelector('[data-testid="tank-card"][data-tank-id="${FIXTURE_SECOND_TANK_ID}"]')
    if (!card) return null
    card.click()
    return card.querySelector('.tp-card-name')?.textContent || null
  })()`)
  if (!selected) throw new Error('second fixture tank card missing')
  await page.waitFor(() => {
    const picker = document.querySelector('#tank-picker.open')
    const target = document.querySelector('#target-select')
    return !picker && !!target && !target.disabled
  }, { timeout: 30000, label: 'second fixture target loaded' })
  const text = await page.evaluate(`document.querySelector('#target-select')?.textContent || ''`)
  if (!text.includes(selected)) throw new Error(`target label did not switch to ${selected}: ${text}`)
  return selected
}

async function runContextLossScenario(env, scenario, { prepare = null, verify = null, assets = null } = {}) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)
  await page.goto(`${env.origin}/?view=agent-armor&ws-auth=1&tank=${FIXTURE_TANK_ID}&assets=${encodeURIComponent(assets || env.assets)}`)
  await page.waitFor(() => !!document.querySelector('#canvas-container canvas'), { label: 'canvas before context loss' })
  const prepared = prepare ? await prepare(page) : null
  const lost = await page.evaluate(`(() => {
    const canvas = document.querySelector('#canvas-container canvas')
    const gl = canvas && canvas.getContext('webgl2')
    const ext = gl && gl.getExtension('WEBGL_lose_context')
    if (!ext) return false
    ext.loseContext()
    return true
  })()`)
  check(failures, lost === true, `${scenario.name}: WEBGL_lose_context 不可用，无法模拟 context lost`)
  const errorSeen = await page.waitFor(
    () => !!document.querySelector('[data-testid="scene3d-error"]'),
    { timeout: 5000, label: 'context-lost error card' },
  ).then(() => true).catch(() => false)
  check(failures, errorSeen, `${scenario.name}: context lost 后没有显示错误卡`)
  const errorText = await page.evaluate(`document.querySelector('[data-testid="scene3d-error"]')?.textContent || ''`)
  check(failures, /3D|WebGL|context/i.test(errorText),
    `${scenario.name}: context-lost 错误卡文案异常：${JSON.stringify(errorText.slice(0, 160))}`)
  await delay(1500)
  const afterLoad = await page.evaluate(`(() => ({
    error: !!document.querySelector('[data-testid="scene3d-error"]'),
    loading: !!document.querySelector('[data-testid="scene3d-loading"]'),
    retry: !!document.querySelector('[data-testid="scene3d-retry"]'),
  }))()`)
  check(failures, afterLoad.error && afterLoad.retry && !afterLoad.loading,
    `${scenario.name}: context-lost 错误态被后续加载覆盖（${JSON.stringify(afterLoad)}）`)
  const retry = await page.evaluate(`(() => {
    const button = document.querySelector('[data-testid="scene3d-retry"]')
    if (!button) return null
    const rect = button.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  check(failures, !!retry, `${scenario.name}: 错误卡没有可点击的重试按钮`)
  if (retry) await page.tap({ ...retry, touch: scenario.touch })
  const recovered = await page.waitFor(() => {
    const error = document.querySelector('[data-testid="scene3d-error"]')
    const loading = document.querySelector('[data-testid="scene3d-loading"]')
    const target = document.querySelector('#target-select')
    return !error && !loading && !!target && !target.disabled
  }, { timeout: 30000, label: 'context-lost retry recreates the renderer' }).then(() => true).catch(() => false)
  check(failures, recovered, `${scenario.name}: 重试没有重建 renderer/恢复场景`)
  if (recovered && verify) await verify(page, prepared, failures)
  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
}

const CONTEXT_LOSS_ROUTE_REBUILD_SCENARIO = { name: 'armor-context-lost-route-rebuild', width: 1024, height: 768, touch: false }
async function runContextLossRouteRebuildScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)
  await page.goto(`${env.origin}/?view=agent-armor&ws-auth=1&tank=${FIXTURE_TANK_ID}&shooter=${FIXTURE_TANK_ID}&assets=${encodeURIComponent(env.contextLossRouteRebuildAssets)}`)
  await selectSecondFixtureTarget(page)
  await page.evaluate(`window.__OLD_ARMOR_CANVAS__ = document.querySelector('#canvas-container canvas')`)
  const navigated = await page.evaluate(`(() => {
    const router = document.querySelector('#app').__vue_app__.config.globalProperties.$router
    const query = Object.fromEntries(new URLSearchParams(location.search))
    query.shooter = '${FIXTURE_SECOND_TANK_ID}'
    return router.push({ query }).then(() => true).catch(() => false)
  })()`)
  check(failures, navigated === true, `${scenario.name}: same-view 导航失败`)
  const replaced = await page.waitFor(() => {
    const canvas = document.querySelector('#canvas-container canvas')
    return !!canvas && canvas !== window.__OLD_ARMOR_CANVAS__
  }, { timeout: 10000, label: 'route rebuild creates the replacement canvas' }).then(() => true).catch(() => false)
  check(failures, replaced, `${scenario.name}: 路由重建没有生成新 canvas`)
  const lost = await page.evaluate(`(() => {
    const canvas = document.querySelector('#canvas-container canvas')
    const gl = canvas && canvas.getContext('webgl2')
    const ext = gl && gl.getExtension('WEBGL_lose_context')
    if (!ext) return false
    ext.loseContext()
    return true
  })()`)
  check(failures, lost === true, `${scenario.name}: WEBGL_lose_context 不可用`)
  const errorSeen = await page.waitFor(() => !!document.querySelector('[data-testid="scene3d-error"]'),
    { timeout: 5000, label: 'route-rebuild context-lost error card' }).then(() => true).catch(() => false)
  check(failures, errorSeen, `${scenario.name}: 重建期间 context lost 没有显示错误卡`)
  const retry = await page.evaluate(`(() => {
    const button = document.querySelector('[data-testid="scene3d-retry"]')
    if (!button) return null
    const rect = button.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  if (retry) await page.tap({ ...retry, touch: scenario.touch })
  const recovered = await page.waitFor(() => {
    const error = document.querySelector('[data-testid="scene3d-error"]')
    const loading = document.querySelector('[data-testid="scene3d-loading"]')
    const target = document.querySelector('#target-select')
    return !error && !loading && !!target && !target.disabled
  }, { timeout: 30000, label: 'route-rebuild retry recreates the renderer' }).then(() => true).catch(() => false)
  check(failures, recovered, `${scenario.name}: 重试没有重建 renderer/恢复场景`)
  const labels = await page.evaluate(`(() => ({
    target: document.querySelector('#target-select')?.textContent || '',
    shooter: document.querySelector('#shooter-select')?.textContent || '',
  }))()`)
  check(failures, labels.target.includes('Fixture Medium') && labels.shooter.includes('Fixture Heavy'),
    `${scenario.name}: retry 恢复了上一条路由的选择（${JSON.stringify(labels)}）`)
  check(failures, page.consoleErrors.length === 0, `${scenario.name}: JS errors: ${page.consoleErrors.join(' | ')}`)
  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
}

const STAGGERED_LOAD_SCENARIO = { name: 'armor-staggered-visual-first', width: 1024, height: 768, touch: false }
async function runStaggeredLoadScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)
  await page.goto(`${env.origin}/?view=agent-armor&ws-auth=1&tank=${FIXTURE_TANK_ID}&assets=${encodeURIComponent(env.staggeredAssets)}`)
  await page.waitFor(() => !!document.querySelector('[data-testid="armor-stage"]'), { label: 'armor stage' })
  await page.waitFor(() => { const button = document.getElementById('collision-btn'); return !!button && !button.disabled },
    { timeout: 10000, label: 'viewer controls ready' })
  const beforeLoad = await page.evaluate('window.__LOAD__')
  check(failures, beforeLoad !== 'ok:' + FIXTURE_TANK_ID,
    `${scenario.name}: visual 在开启碰撞前已完成，竞态未被复现（__LOAD__=${beforeLoad}）`)
  const clicked = await page.evaluate(`(() => {
    const button = document.getElementById('collision-btn')
    if (!button) return null
    button.click()
    return button.getAttribute('aria-pressed')
  })()`)
  check(failures, clicked === 'true', `${scenario.name}: 碰撞模式未在 armor 加载前开启（aria-pressed=${clicked}）`)
  await page.waitFor(() => !document.querySelector('[data-testid="scene3d-loading"]') && !document.querySelector('[data-testid="scene3d-error"]') && !document.querySelector('#target-select').disabled,
    { timeout: 30000, label: 'staggered visual/armor load ready' })
  const state = await page.evaluate(`(() => {
    const debug = window.__DBG__
    let primarySample = null
    let spacedSample = null
    if (debug && debug.scene) {
      debug.scene.traverse(node => {
        if (!node.isMesh || !node.visible || node.userData.armorSection === 'deco') return
        if (node.userData.armorSection === 'spaced') {
          if (!spacedSample) spacedSample = node
        } else if (!primarySample && /_armor_/.test(node.name || '')) {
          primarySample = node
        }
      })
    }
    let moduleSample = null
    let visibleBodyMeshes = 0
    let visibleModuleMeshes = 0
    if (debug && debug.tankModel) {
      debug.tankModel.traverse(node => {
        if (!node.isMesh || !node.visible) return
        const section = node.userData.armorSection
        if (section === 'chassis' || section === 'gunBarrel') {
          visibleModuleMeshes++
          if (!moduleSample) moduleSample = node
        } else visibleBodyMeshes++
      })
    }
    const sample = node => node && node.material ? {
      opacity: node.material.opacity,
      depthWrite: node.material.depthWrite,
      outlines: node.children.filter(child => child.isLineSegments).length,
    } : null
    return {
      load: window.__LOAD__,
      collision: document.getElementById('collision-btn').getAttribute('aria-pressed'),
      tankVisible: debug && debug.tankModel ? debug.tankModel.visible : null,
      visibleBodyMeshes,
      visibleModuleMeshes,
      primary: sample(primarySample),
      spaced: sample(spacedSample),
      module: sample(moduleSample),
    }
  })()`)
  check(failures, state.load === 'ok:' + FIXTURE_TANK_ID,
    `${scenario.name}: visual 先完成时加载未收敛（__LOAD__=${state.load}）`)
  check(failures, state.collision === 'true',
    `${scenario.name}: armor 就绪后碰撞模式丢失（aria-pressed=${state.collision}）`)
  check(failures, state.tankVisible === true && state.visibleBodyMeshes === 0,
    `${scenario.name}: armor 就绪后视觉车体仍可见（tankVisible=${state.tankVisible}, body=${state.visibleBodyMeshes}）`)
  check(failures, state.visibleModuleMeshes > 0,
    `${scenario.name}: 厚度视图未保留炮管/履带碰撞体（modules=${state.visibleModuleMeshes}）`)
  check(failures, !!state.primary && state.primary.opacity === 1
    && state.primary.depthWrite === true && state.primary.outlines > 0,
    `${scenario.name}: primary 厚度材质不是不透明平涂+勾线（${JSON.stringify(state.primary)}）`)
  check(failures, !!state.spaced && state.spaced.opacity >= 0.5 && state.spaced.opacity <= 1
    && state.spaced.depthWrite === true && state.spaced.outlines > 0,
    `${scenario.name}: spaced 厚度材质透明度/勾线异常（${JSON.stringify(state.spaced)}）`)
  check(failures, !!state.module && Math.abs(state.module.opacity - 0.125) < 1e-6
    && state.module.depthWrite === false && state.module.outlines > 0,
    `${scenario.name}: external 厚度材质不是 1/8 透明+不写深度+勾线（${JSON.stringify(state.module)}）`)

  const leftTrackSpot = await page.evaluate(`(() => {
    const H = window.__armorRicochet
    const canvas = document.querySelector('#canvas-container canvas')
    if (!H || !canvas) return null
    const rect = canvas.getBoundingClientRect()
    for (let y = 20; y < canvas.height - 20; y += 8) {
      for (let x = 20; x < canvas.width - 20; x += 8) {
        const px = rect.left + x, py = rect.top + y
        if (document.elementFromPoint(px, py) !== canvas) continue
        const hits = H.__raytrace(px, py) || []
        // 必须选“首个命中就是履带”的像素：履带后面的 chassis 命中不能代表可见表面，
        // 点击链会先选到前面的车体装甲板。
        const hit = hits[0]
        if (hit && hit.sec === 'chassis' && /trackL|_L_/.test(hit.name || '')) return { x: px, y: py }
      }
    }
    return null
  })()`)
  check(failures, !!leftTrackSpot, `${scenario.name}: 夹具未找到左侧履带像素`)
  if (leftTrackSpot) {
    // 该场景是桌面鼠标模拟（touch:false）；用 touch 事件不会产生 pointer 点击。
    await page.tap({ x: leftTrackSpot.x, y: leftTrackSpot.y, touch: false })
    await delay(150)
    const group = await page.evaluate(`(() => {
      const tank = window.__DBG__ && window.__DBG__.tankModel
      if (!tank) return null
      let left = 0, leftOpaque = 0, right = 0, rightOpaque = 0
      const parts = []
      tank.traverse(node => {
        if (!node.isMesh || node.userData.armorSection !== 'chassis') return
        const opacity = node.material ? node.material.opacity : null
        const opaque = opacity === 1
        const plate = node.userData.armorPlateId
        parts.push({ name: node.name, plate, opacity })
        if (plate === 'leftTrack') {
          left++
          if (opaque) leftOpaque++
        } else if (plate === 'rightTrack') {
          right++
          if (opaque) rightOpaque++
        }
      })
      const card = document.querySelector('#click-part')
      return { left, leftOpaque, right, rightOpaque, part: card ? card.textContent : null, parts }
    })()`)
    console.log(`[browser-armor-mobile] ${scenario.name} left track click: spot=${JSON.stringify(leftTrackSpot)} group=${JSON.stringify(group)}`)
    check(failures, !!group && group.left > 0 && group.leftOpaque === group.left && group.rightOpaque === 0,
      `${scenario.name}: 点击左侧履带未整侧高亮（${JSON.stringify(group)}）`)
  }
  check(failures, page.consoleErrors.length === 0, `${scenario.name}: JS errors: ${page.consoleErrors.join(' | ')}`)
  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
}


const scenarioArgs = parseScenarioArgs(process.argv.slice(2))
const chrome = findChrome()
const { server, origin } = await startFixtureServer()
const assets = await startFixtureAssetPack()
const compactAssets = await startFixtureAssetPack({ extraRoutes: {
  '/research/devices.json': { type: 'application/json', body: JSON.stringify({ meta: { gameVersion: 'fixture' }, devices: [], presets: [] }) },
} })
const staggeredAssets = await startFixtureAssetPack({ delays: { armor: 6000, visual: 4000 } })
const pickerAssets = await startFixtureAssetPack({ tankCache: PICKER_TANK_CACHE })
const contextLossSelectionAssets = await startFixtureAssetPack({ tankCache: CONTEXT_LOSS_SELECTION_TANK_CACHE })
const contextLossRouteRebuildAssets = await startFixtureAssetPack({
  tankCache: CONTEXT_LOSS_SELECTION_TANK_CACHE,
  delays: { tankCache: 1500 },
})
let chromeCdp = null

try {
  chromeCdp = await launchChromeForCdp(chrome, {
    extraArgs: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--enable-unsafe-swiftshader',
    ],
  })
  const env = { origin, chrome: chromeCdp, assets: assets.origin, compactAssets: compactAssets.origin, pickerAssets: pickerAssets.origin, staggeredAssets: staggeredAssets.origin, contextLossSelectionAssets: contextLossSelectionAssets.origin, contextLossRouteRebuildAssets: contextLossRouteRebuildAssets.origin }
  const shotContext = { results, trackPage: page => { lastPage = page } }
  const runs = [
    ...SHOT_SCENARIOS.map(scenario => ({ scenario, run: () => runShotActionsScenario(env, scenario, shotContext) })),
    ...SHOT_LANDSCAPE_SCENARIOS.map(scenario => ({ scenario, run: () => runShotLandscapeScenario(env, scenario, shotContext) })),
    ...COMPACT_LANDSCAPE_SCENARIOS.map(scenario => ({ scenario, run: () => runCompactLandscapeScenario(env, scenario) })),
    ...MOBILE_SCENARIOS.map((scenario) => ({ scenario, run: () => runMobileScenario(env, scenario) })),
    { scenario: BACK_SCENARIO, run: () => runMobileBackScenario(env, BACK_SCENARIO) },
    ...DESKTOP_SCENARIOS.map((scenario) => ({ scenario, run: () => runDesktopScenario(env, scenario) })),
    { scenario: STAGGERED_LOAD_SCENARIO, run: () => runStaggeredLoadScenario(env, STAGGERED_LOAD_SCENARIO) },
    { scenario: CONTEXT_LOSS_SCENARIO, run: () => runContextLossScenario(env, CONTEXT_LOSS_SCENARIO) },
    {
      scenario: CONTEXT_LOSS_SELECTION_SCENARIO,
      run: () => runContextLossScenario(env, CONTEXT_LOSS_SELECTION_SCENARIO, {
        assets: env.contextLossSelectionAssets,
        prepare: selectSecondFixtureTarget,
        verify: async (page, expected, failures) => {
          const text = await page.evaluate(`document.querySelector('#target-select')?.textContent || ''`)
          check(failures, !!expected && text.includes(expected),
            `${CONTEXT_LOSS_SELECTION_SCENARIO.name}: context-loss retry 丢失了 picker 选择（期望 ${expected}，实际 ${JSON.stringify(text)}）`)
        },
      }),
    },
    { scenario: CONTEXT_LOSS_ROUTE_REBUILD_SCENARIO, run: () => runContextLossRouteRebuildScenario(env, CONTEXT_LOSS_ROUTE_REBUILD_SCENARIO) },
    { scenario: ASSETLESS_SCENARIO, run: () => runMobileScenario(env, ASSETLESS_SCENARIO) },
    ...PICKER_SCENARIOS.map(scenario => ({ scenario, run: () => runPickerCardsScenario(env, scenario) })),
  ]
  const { nameFilter, shard } = scenarioArgs
  const named = nameFilter ? runs.filter(({ scenario }) => scenario.name.includes(nameFilter)) : runs
  const selected = selectShard(named, scenarioArgs)
  const shardLabel = shard?.label ?? 'full'
  console.log(`[browser-armor-mobile] shard=${shardLabel} selected=${selected.length}`)
  const suiteStartedAt = performance.now()
  let failed = 0
  for (const { scenario, run } of selected) {
    const startedAt = performance.now()
    try {
      await run()
    } catch (error) {
      results.push({
        name: scenario.name,
        failures: [error.message, ...(lastPage ? await lastPage.diagnose(armorLayoutProbe).catch(() => []) : [])],
        viewport: `${scenario.width}x${scenario.height}`,
      })
    }
    const elapsed = Math.round(performance.now() - startedAt)
    const result = results.at(-1)
    if (result.failures.length === 0) {
      console.log(`[browser-armor-mobile] ${result.name} OK (${result.viewport}) elapsed=${elapsed}ms`)
      continue
    }
    failed += 1
    console.error(`[browser-armor-mobile] ${result.name} FAILED (${result.viewport}) elapsed=${elapsed}ms`)
    for (const failure of result.failures) console.error(`  - ${failure}`)
  }
  if (failed > 0) process.exitCode = 1
  console.log(`[browser-armor-mobile] summary shard=${shardLabel} selected=${selected.length} passed=${results.length - failed} failed=${failed} elapsed=${Math.round(performance.now() - suiteStartedAt)}ms`)
} finally {
  if (chromeCdp) await chromeCdp.close()
  await server.close()
  await assets.close()
  await compactAssets.close()
  await staggeredAssets.close()
  await pickerAssets.close()
  await contextLossSelectionAssets.close()
  await contextLossRouteRebuildAssets.close()
}
