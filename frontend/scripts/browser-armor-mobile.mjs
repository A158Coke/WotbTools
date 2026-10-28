import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page, delay } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'
import { FIXTURE_SECOND_TANK_ID, FIXTURE_TANK_CACHE, FIXTURE_TANK_DATA, FIXTURE_TANK_ID, startFixtureAssetPack } from './browser-fixtures/fixture-asset-pack.mjs'

/**
 * 装甲查看器（?view=agent-armor）移动端布局的浏览器几何门禁。
 *
 * 为什么必须是真浏览器：本次改动把手机端从「四角面板 + 上下两条可滚动窄带」改成
 * 「顶栏一行 + 底栏一行 + 参数面板默认收起」。这类断言的本质是真实 CSS 几何
 * （元素 rect、互相遮挡、触控尺寸、断点边界）——happy-dom / jsdom 没有布局引擎，
 * 只能靠 source-text 猜，那个不算验证（frontend/AGENTS.md：不得用正则测试冒充浏览器验证）。
 *
 * 与另外两个浏览器门禁的分工：
 *   - browser-playback-layout.mjs：file:// + 生产 CSS 的**静态几何**夹具；
 *   - browser-workspace-interaction.mjs：工作台 / 回放控件的**交互**夹具；
 *   - 本文件：Vite dev server + **真实装甲查看器**（AgentArmorView + tankViewer 内核 +
 *     全部 CSS）在手机 / 平板 / 桌面三档设备指标下的几何与真实触摸接线。
 *
 * 环境前提与三处显式让位（都不影响被测契约）：
 *   1. 正常态使用与瞄准/加载门禁共用的确定性夹具资产包，等待实际初始化完成再测量。
 *      资产不可达场景显式使用不可达 origin，测量前移除错误遮罩，只验证外壳与禁用入口。
 *   2. 加载态布局（顶栏单行 / 弹种不截断 / 面板控件 ≥44px）用 `applyLoadedFixture`
 *      注入 worst-case 内容后测量——不依赖资产，避免"退化态下空跑"（评审 BLOCKER 2）。
 *   3. 3D 画面本身不在断言之列（视觉归属用户，见 .agents/AGENTS.md）；这里只断言
 *      DOM/CSS chrome 的几何与接线。
 */

/**
 * 装甲查看器 chrome 的几何快照。真函数（不用闭包），跨进程序列化执行。
 * 资产缺失时 #info-panel 保持 display:none，因此顶部卡片里只有「参数」开关；
 * 断言不依赖车名是否加载成功。
 */
function armorLayoutProbe() {
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
  const tools = document.querySelector('[data-testid="armor-tools"]')
  const toolsRect = tools ? tools.getBoundingClientRect() : null
  const toolsCenter = toolsRect
    ? { x: Math.round(toolsRect.left + toolsRect.width / 2), y: Math.round(toolsRect.top + toolsRect.height / 2) }
    : null
  const toolsHit = toolsCenter ? document.elementFromPoint(toolsCenter.x, toolsCenter.y) : null
  const root = document.querySelector('.armor-view')
  const stage = document.querySelector('[data-testid="armor-stage"]')
  const viewToggle = document.querySelector('#view-toggle')
  const turretRows = [...document.querySelectorAll('#turret-controls .ctrl-row')].map((row) => row.getBoundingClientRect())
  return {
    url: location.href,
    viewport: { width: innerWidth, height: innerHeight },
    coarse: matchMedia('(pointer: coarse)').matches,
    hasStage: !!stage,
    unsupported: !!document.querySelector('[data-testid="scene3d-unsupported"]'),
    root: box('.armor-view'),
    topBar: box('#corner-tl'),
    bottomBar: box('#corner-tr'),
    infoPanel: box('#info-panel'),
    selectors: box('#tank-selectors'),
    back: box('.armor-back'),
    viewToggle: box('#view-toggle'),
    viewToggleDisplay: viewToggle ? getComputedStyle(viewToggle).display : null,
    /** 弹种下拉：不得把选项文案（「弹种 穿深mm / 伤害dmg」）截断 */
    shellSelectClipped: (() => {
      const select = document.querySelector('#shell-select')
      if (!select || select.getClientRects().length === 0) return null
      const widest = [...select.options].reduce((max, option) => Math.max(max, option.textContent.length), 0)
      return { widestOptionChars: widest, scrollWidth: select.scrollWidth, clientWidth: select.clientWidth, clipped: select.scrollWidth > select.clientWidth + 1 }
    })(),
    viewToggleButtons: [...document.querySelectorAll('#view-toggle button')].map((button) => {
      const rect = button.getBoundingClientRect()
      return {
        text: button.textContent.trim(),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        // 装甲组成过滤行只在厚度视图出现；隐藏时不是触控目标（0x0 不参与 44px 判定）
        visible: button.getClientRects().length > 0,
      }
    }),
    turretControls: box('#turret-controls'),
    turretRowsInline: turretRows.length === 2 ? Math.abs(Math.round(turretRows[0].top) - Math.round(turretRows[1].top)) <= 2 : null,
    tools: tools && toolsRect
      ? {
          ...box('[data-testid="armor-tools"]'),
          center: toolsCenter,
          ariaExpanded: tools.getAttribute('aria-expanded'),
          hitIsTools: toolsHit === tools || (!!toolsHit && tools.contains(toolsHit)),
          hitDescription: toolsHit
            ? `${toolsHit.tagName}${typeof toolsHit.className === 'string' && toolsHit.className.trim() ? `.${toolsHit.className.trim().split(/\s+/).join('.')}` : ''}`
            : null,
        }
      : null,
    stageClass: stage ? stage.className : null,
    toolsOpen: !!document.querySelector('.armor-stage.is-tools-open'),
    picker: box('#tank-picker'),
    pickerOpen: !!document.querySelector('#tank-picker.open'),
    pickerTitle: box('#tp-title'),
    pickerClose: box('#tp-close'),
    pickerSearch: box('#tp-search'),
    pickerFilters: ['#tp-tier', '#tp-nation', '#tp-type'].map((selector) => box(selector)),
    pickerFilterToggle: box('[data-testid="filter-toggle"]'),
    pickerSheet: box('[role="dialog"] [data-testid="tank-filters"]'),
    targetSelect: box('#target-select'),
    configSelect: box('#config-select'),
    eqOpts: [...document.querySelectorAll('#tank-selectors .eq-opt')].map((label) => {
      const rect = label.getBoundingClientRect()
      const requestRect = label.querySelector('.eq-opt-label')?.getBoundingClientRect() || null
      const inputRect = label.querySelector('input')?.getBoundingClientRect() || null
      // 文案需要的最小宽度 = 复选框 + gap(3px) + 文案；被 `label{width:58px}` 之类压窄时
      // scrollWidth 会大于 clientWidth（评审：EN/RU 文案在 58px 盒子里溢出重叠）
      const needed = requestRect && inputRect ? Math.round(inputRect.width + 3 + requestRect.width) : null
      return {
        id: label.id || null,
        visible: rect.width > 0 && rect.height > 0,
        text: label.textContent.trim(),
        width: Math.round(rect.width), height: Math.round(rect.height),
        left: Math.round(rect.left), right: Math.round(rect.right),
        needed, clipped: label.scrollWidth > label.clientWidth + 1,
      }
    }),
    /** 顶栏信息行是否被压成多行（行高 ≤ 26px = 单行；多行会把它撑高） */
    infoPanelHeight: (() => {
      const el = document.querySelector('#info-panel')
      return el ? Math.round(el.getBoundingClientRect().height) : null
    })(),
    /** 单行信息必须裁剪，长车名不得画到「参数」按钮下面 */
    infoPanelOverflowX: (() => {
      const el = document.querySelector('#info-panel')
      return el ? getComputedStyle(el).overflowX : null
    })(),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    statusOverlays: document.querySelectorAll('[data-testid="scene3d-error"], [data-testid="scene3d-loading"]').length,
    /** 外壳沉浸态（shared/shellChrome）：手机横屏申请后 AppShell 卸载顶栏 / Tab 栏并归零高度 token */
    shellChrome: document.documentElement.dataset.shellChrome || null,
    appTopBar: box('[data-testid="app-top-bar"]'),
    appTabBar: box('[data-testid="app-tab-bar"]'),
    interactionHelp: box('.armor-interaction-help'),
    shotHeader: box('[data-testid="armor-shot-header"]'),
  }
}

/**
 * 加载态夹具（评审 BLOCKER 2）：资产缺失时 `#info-panel` / `#shell-selector` / `#config-row`
 * 默认 hidden，门禁会在**退化态**下空跑——「顶栏单行」只证明了「一个按钮不会撑高顶栏」，
 * 「弹种不截断」也因下拉隐藏而变成 no-op。这里向真实组件注入 worst-case 内容
 * （长车名 + 俄语 等级/类型/国籍 + 长弹种文案 + 两项配置），让 loaded 布局在任何资产条件下
 * 都可确定复现；注入的是内容，测的仍是生产 CSS / 生产 DOM 结构。
 */
function applyLoadedFixture() {
  const setText = (selector, text) => {
    const element = document.querySelector(selector)
    if (element) element.textContent = text
  }
  const infoPanel = document.querySelector('#info-panel')
  if (infoPanel) infoPanel.style.display = 'block'
  setText('#tank-name', 'Т-34-85 (обр. 1944 г.)')
  setText('#tank-tier', 'Уровень VIII')
  setText('#tank-type', 'Тяжёлый танк')
  setText('#tank-nation', 'Великобритания')

  const shellSelector = document.querySelector('#shell-selector')
  const shellSelect = document.querySelector('#shell-select')
  if (shellSelector && shellSelect) {
    shellSelect.innerHTML = ''
    for (const text of ['APCR 310mm / 460dmg', 'AP 258mm / 400dmg', 'HE 68mm / 500dmg']) {
      const option = document.createElement('option')
      option.textContent = text
      shellSelect.appendChild(option)
    }
    shellSelector.style.display = 'block'
  }

  const configRow = document.querySelector('#config-row')
  const configSelect = document.querySelector('#config-select')
  if (configRow && configSelect) {
    configSelect.innerHTML = ''
    for (const text of ['Орудие 122 мм Д-25Т', 'Орудие 100 мм Д-10Т']) {
      const option = document.createElement('option')
      option.textContent = text
      configSelect.appendChild(option)
    }
    configRow.style.display = 'flex'
  }

  // 装备复选框文案用最长的俄语变体（评审：EN/RU 文案才照得出 58px 盒子溢出）
  const eqTexts = ['Калибр. снаряды', 'Усил. броня']
  document.querySelectorAll('#tank-selectors .eq-opt-label').forEach((span, index) => {
    if (eqTexts[index]) span.textContent = eqTexts[index]
  })
  return true
}

/** 资产不可达场景测量外壳前移除遮罩；真实失败状态由加载门禁覆盖。 */
async function dismissStatusOverlays(page) {
  await page.evaluate(`(() => {
    const nodes = document.querySelectorAll('[data-testid="scene3d-error"], [data-testid="scene3d-loading"]')
    nodes.forEach((node) => { node.style.display = 'none' })
    return nodes.length
  })()`)
}

const results = []
let lastPage = null

function check(failures, ok, message) {
  if (!ok) failures.push(message)
}

/** 顶栏 / 底栏共同的空间预算：这两行之外的高度必须全部留给 3D 场景。 */
const SCENE_BAND_MIN_RATIO = 0.6

function checkCommonGeometry(failures, layout, label) {
  check(failures, layout.scrollWidth <= layout.clientWidth + 1,
    `${label}: page-level horizontal overflow: scrollWidth=${layout.scrollWidth} > clientWidth=${layout.clientWidth}`)
  check(failures, layout.root && layout.root.height > 200, `${label}: armor-view has no measurable height (${JSON.stringify(layout.root)})`)
}

function checkSceneBand(failures, layout, label) {
  const band = layout.bottomBar.top - layout.topBar.bottom
  check(failures, band >= layout.root.height * SCENE_BAND_MIN_RATIO,
    `${label}: 3D 场景可用带只有 ${band}px（顶栏 ${layout.topBar.height}px + 底栏 ${layout.bottomBar.height}px 之后），低于 armor-view 高度 ${layout.root.height}px 的 ${SCENE_BAND_MIN_RATIO * 100}%`)
}

function checkTouchTargets(failures, layout, label) {
  for (const button of layout.viewToggleButtons) {
    if (!button.visible) continue
    check(failures, Math.min(button.width, button.height) >= 43.5,
      `${label}: 视图开关「${button.text}」触控目标 ${button.width}x${button.height}，低于 44px`)
  }
  if (layout.tools) {
    check(failures, Math.min(layout.tools.width, layout.tools.height) >= 43.5,
      `${label}: 参数开关触控目标 ${layout.tools.width}x${layout.tools.height}，低于 44px`)
  }
  if (layout.back) {
    check(failures, layout.back.height >= 43.5, `${label}: 返回键高度 ${layout.back.height}px，低于 44px`)
  }
}

/* ------------------------------------------------------------------ 场景 */

const MOBILE_SCENARIOS = [
  { name: 'armor-390x844-portrait-coarse', width: 390, height: 844, touch: true },
  { name: 'armor-360x640-small-coarse', width: 360, height: 640, touch: true },
  // 断点边界：767px 仍必须是手机档（面板收起、顶栏单行）
  { name: 'armor-767x1024-narrow', width: 767, height: 1024, touch: false },
]

// 资产源不可达（CI 就是这种环境）：车名 / 坦克数据不加载，顶栏只剩「参数」开关——
// 这时布局同样必须成立（不能塌成 0 高、不能把开关挤出视口）。
// 排在最后跑：URL 上的非空 ?assets= 会持久化进 localStorage，不让它污染其它场景。
const ASSETLESS_SCENARIO = { name: 'armor-390x844-no-assets-coarse', width: 390, height: 844, touch: true, assetless: true }

// 「从射击分析 / 坦克百科经路由打开」的形态：history.state.back 存在 → 返回键出现
const BACK_SCENARIO = { name: 'armor-390x844-with-back-coarse', width: 390, height: 844, touch: true }

async function runMobileScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)

  const label = scenario.name
  // assetless 场景显式把资产源指向不可达端口：无论本机有没有跑资产包，都稳定复现
  // 「资产加载失败」态（CI 环境本来就没有资产源）
  const assetQuery = '&assets=' + encodeURIComponent(scenario.assetless ? 'http://127.0.0.1:1/' : env.assets)
  await page.goto(`${env.origin}/?view=agent-armor&ws-auth=1&tank=${FIXTURE_TANK_ID}${assetQuery}`)
  await page.waitFor(() => !!document.querySelector('[data-testid="armor-stage"]'), { label: 'armor stage' })
  // 正常场景必须加载成功，不能用后续的布局文案夹具掩盖目标模型加载失败。
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

  // —— 默认收起态：顶栏一行 + 底栏一行 + 场景带 ——
  // 加载态夹具：非 assetless 场景注入 worst-case 内容，让「顶栏单行 / 弹种不截断 /
  // 面板控件 ≥44px」在有无资产包时都可确定复现（评审 BLOCKER 2）
  if (!scenario.assetless) {
    await page.probe(applyLoadedFixture)
    await delay(120)
  }
  const initial = await page.probe(armorLayoutProbe)
  check(failures, initial.hasStage && !initial.unsupported, `${label}: 场景未渲染（hasStage=${initial.hasStage} unsupported=${initial.unsupported}）`)
  checkCommonGeometry(failures, initial, label)
  // 竖屏（含窄桌面窗口）不申请沉浸：外壳顶栏 / Tab 栏必须保留（沉浸契约只属于手机横屏）
  check(failures, initial.appTopBar?.visible === true && initial.appTabBar?.visible === true,
    `${label}: 竖屏外壳顶栏 / Tab 栏必须保留（top=${initial.appTopBar?.visible} tab=${initial.appTabBar?.visible}）`)
  check(failures, initial.shellChrome !== 'immersive', `${label}: 竖屏不应进入沉浸态（dataset=${initial.shellChrome}）`)
  if (scenario.assetless) {
    check(failures, initial.infoPanel?.visible === false, `${label}: 资产不可达时车名面板不应可见（场景前提失效）`)
    check(failures, initial.statusOverlays >= 1, `${label}: 资产不可达时应出现错误态遮罩（环境前提）`)
    check(failures, initial.topBar && initial.topBar.height >= 44,
      `${label}: 车名未加载时顶栏塌陷（height=${initial.topBar?.height}）`)
  } else {
    // 加载态：worst-case 车名/等级/类型/国籍必须在**一行**内（评审「额外关注」：
    // 越界由省略号接管，不许换行把顶栏撑高）
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
  // 弹种文案是「弹种 穿深mm / 伤害dmg」，被限宽截断过一轮（用户实测反馈）：锁死不许截断
  if (initial.shellSelectClipped) {
    check(failures, initial.shellSelectClipped.clipped === false,
      `${label}: 弹种下拉被截断（scrollWidth=${initial.shellSelectClipped.scrollWidth} > clientWidth=${initial.shellSelectClipped.clientWidth}，最长选项 ${initial.shellSelectClipped.widestOptionChars} 字）`)
  }
  checkTouchTargets(failures, initial, label)
  checkSceneBand(failures, initial, label)
  // 炮塔 / 炮管角度条：单行（两行并排），且在顶栏与底栏之间不与任何一条重叠
  if (initial.turretControls?.visible) {
    check(failures, initial.turretRowsInline === true, `${label}: 炮塔 / 炮管角度条不是单行`)
    check(failures, initial.turretControls.height <= 48, `${label}: 角度条高度 ${initial.turretControls.height}px 超过单行预算`)
    check(failures, initial.turretControls.top >= initial.topBar.bottom - 1,
      `${label}: 角度条与顶栏重叠（top=${initial.turretControls.top} < 顶栏 bottom=${initial.topBar.bottom}）`)
    check(failures, initial.turretControls.bottom <= initial.bottomBar.top,
      `${label}: 角度条与底栏重叠（bottom=${initial.turretControls.bottom} > 底栏 top=${initial.bottomBar.top}）`)
  }

  // —— 真实触摸：展开 / 收起参数面板 ——
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
  // 参数面板内的真实交互控件 ≥44px（评审 BLOCKER 1：配置下拉 + 装备复选框 label）。
  // 动态装甲项（#armor-state-opt）只在有 XML 声明车出现，静态夹具下按设计 display:none——
  // 命中区/文案断言只对**可见**控件成立（隐藏项 0×0 不是违规），隐藏项按 id 单独锁定。
  if (!scenario.assetless) {
    check(failures, opened.configSelect?.visible === true && opened.configSelect.height >= 43.5,
      `${label}: 配置下拉缺失或命中区不足 44px（${JSON.stringify(opened.configSelect)}）`)
    const visibleEq = opened.eqOpts.filter((option) => option.visible)
    check(failures, visibleEq.length === 2,
      `${label}: 可见装备复选框 label 数量 ${visibleEq.length}，期望 2（校准弹 / 强化装甲）`)
    check(failures, opened.eqOpts.length === 3
      && opened.eqOpts.some((option) => !option.visible && option.id === 'armor-state-opt'),
      `${label}: 静态夹具应恰有 1 个隐藏装备项（#armor-state-opt 动态装甲，无声明不显示），`
      + `实测隐藏项 [${opened.eqOpts.filter((option) => !option.visible).map((option) => option.id || option.text).join(',')}]`)
    for (const option of visibleEq) {
      check(failures, option.height >= 43.5,
        `${label}: 装备「${option.text}」label 命中区 ${option.width}x${option.height}，低于 44px`)
      // 文案盒不得被压窄（width:auto 被 `#tank-selectors label{width:58px}` 按优先级盖回过一轮）
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
  // 逐场景指标（CI 日志里的证据：证明夹具真的注入、断言不是空跑）
  console.log(`[browser-armor-mobile] ${label} metrics: topBar=${initial.topBar?.height}px infoPanel=${initial.infoPanelHeight}px `
    + `shellClipped=${initial.shellSelectClipped ? initial.shellSelectClipped.clipped : 'n/a'} `
    + `configSelect=${opened.configSelect ? opened.configSelect.height + 'px' : 'n/a'} `
    + `eqOpts=[${opened.eqOpts.map((option) => option.width + 'x' + option.height).join(',')}] sceneBand=${initial.bottomBar.top - initial.topBar.bottom}px`)

  await page.tap({ ...opened.tools.center, touch: scenario.touch })
  const collapsed = await page.probe(armorLayoutProbe)
  check(failures, collapsed.toolsOpen === false && collapsed.selectors?.visible === false,
    `${label}: 再次点击未收起（is-tools-open=${collapsed.toolsOpen} selectors visible=${collapsed.selectors?.visible}）`)

  // —— 选车弹窗：全屏 + 头部不换行 + 关闭键 44px ——
  await page.tap({ ...opened.tools.center, touch: scenario.touch })   // 重新展开
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
    // 共享 TankCatalogMenu：手机筛选收进 chips + sheet（与坦克百科同一实现），
    // 不再在弹窗头部平铺三个下拉。搜索框与筛选入口都必须满足 44px 命中区。
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
      // sheet 有进场位移动画：等它落定再量坐标，否则真实 tap 会落在滑动中的旧位置
      await page.waitForValue(`document.getAnimations().every(animation => animation.playState !== 'running')`, value => value === true,
        { timeout: 3000, label: 'sheet enter animation settled' }).catch(() => {})
      // 关闭 sheet：优先点「完成」按钮（确定性入口；scrim 点击在弹窗叠层下时序不稳定）。
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
      // 模态 sheet 关闭后 Reka 会把 body 的 pointer-events 恢复；残留 none 会让后面的真实点击全部落空
      const released = await page.waitForValue(`getComputedStyle(document.body).pointerEvents !== 'none'`, value => value === true,
        { timeout: 3000, label: 'body pointer-events released' }).then(() => true).catch(() => false)
      const releaseState = released ? null : await page.evaluate(`JSON.stringify({ style: document.body.getAttribute('style'), layers: [...document.querySelectorAll('[data-dismissable-layer],[data-state]')].filter(e => /sheet|dialog|drawer/i.test(e.className + e.getAttribute('role'))).map(e => e.className + '|' + e.getAttribute('data-state')), scrims: document.querySelectorAll('[data-testid=sheet-scrim]').length, sheets: document.querySelectorAll('.sheet').length })`)
      check(failures, released, `${label}: 筛选 sheet 关闭后 body 仍是 pointer-events: none ${releaseState || ''}`)
    }
    // 关闭弹窗：真实点击关闭键
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
  // 模拟「从射击分析 / 坦克百科经路由打开」：history.state.back 存在 → 返回键出现
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

/** 桌面 / 平板回归：移动端规则只作用于 <768px；桌面复用左上信息卡，参数面板默认收起。 */
const DESKTOP_SCENARIOS = [
  // 横屏粗指针手机必须走平板式布局（左上信息卡 + 四角浮层），而不是竖屏 mobile 的上下窄带，
  // 并通过 shared/shellChrome 申请沉浸（AppShell 卸载顶栏 / Tab 栏，armor-view 占满整屏）。
  { name: 'armor-740x360-landscape-coarse', width: 740, height: 360, touch: true, phoneLandscape: true },
  // 横屏粗指针平板同一套布局（信息行压单行；不再有额外的 height 断点）；不申请沉浸。
  { name: 'armor-1024x768-landscape-tablet-coarse', width: 1024, height: 768, touch: true, tabletLandscape: true },
  // 断点边界：768px 起进入桌面档（左上信息卡 + 可收起设置面板、四角布局）
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
  // 沉浸态契约：手机横屏申请（外壳 bar 卸载、armor-view 占满整屏）；平板横屏不申请
  if (scenario.phoneLandscape) {
    check(failures, layout.shellChrome === 'immersive',
      `${label}: 手机横屏未申请沉浸态（dataset=${layout.shellChrome}）`)
    check(failures, layout.appTopBar === null && layout.appTabBar === null,
      `${label}: 沉浸态下外壳顶栏 / Tab 栏仍渲染（top=${!!layout.appTopBar} tab=${!!layout.appTabBar}）`)
    check(failures, layout.root && layout.root.top === 0 && Math.abs(layout.root.height - layout.viewport.height) <= 1,
      `${label}: armor-view 没有占满整屏（root=${JSON.stringify(layout.root)} viewport=${JSON.stringify(layout.viewport)}）`)
    // 深链直达（本场景 goto 即无 history.back）也必须有应用内退出：返回键恒在，
    // 无历史时点击回坦克百科（#767 复审 P2：沉浸态不得让站内导航全部消失）
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
  // 返回键恒在（深链直达也必须有站内退出）：has-back 共存布局下顶栏为返回键让位——
  // 或下移 44+8（base 规则，横屏 / 桌面档），或右移 44+8（并排变体）；两种都要求返回键
  // 自身贴 armor-view 顶边 inset 20、顶栏与它保持 space-2 间距且不重叠。不再锁死旧的
  // 「顶栏相对 20/20」单一期望（那会让恒在返回键的正常布局必然失败）。
  const backRel = layout.back && layout.root
    ? { top: layout.back.top - layout.root.top, left: layout.back.left - layout.root.left } : null
  const barRel = layout.topBar && layout.root
    ? { top: layout.topBar.top - layout.root.top, left: layout.topBar.left - layout.root.left } : null
  const coexistVertical = layout.back && layout.topBar
    && Math.abs((layout.topBar.top - layout.back.bottom) - 8) <= 2
    && Math.abs(barRel.left - 20) <= 2
  const coexistHorizontal = layout.back && layout.topBar
    && Math.abs((layout.topBar.left - layout.back.right) - 8) <= 2
    && Math.abs(barRel.top - 20) <= 2
  check(failures, !!backRel && Math.abs(backRel.top - 20) <= 2 && Math.abs(backRel.left - 20) <= 2,
    `${label}: 返回键没有贴 armor-view 左上 inset 20（back=${JSON.stringify(backRel)}）`)
  check(failures, coexistVertical || coexistHorizontal,
    `${label}: 顶栏未在返回键下方或右侧留出 space-2 间距（bar=${JSON.stringify(barRel)} back=${JSON.stringify(layout.back && { bottom: layout.back.bottom, right: layout.back.right })}）`)
  check(failures, layout.bottomBar && layout.root
    && Math.abs((layout.bottomBar.top - layout.root.top) - 20) <= 2 && Math.abs((layout.root.right - layout.bottomBar.right) - 20) <= 2,
    `${label}: 底栏没有回到右上角（top=${layout.bottomBar?.top} right=${layout.bottomBar?.right} root right=${layout.root?.right}，期望相对 20/20）`)
  check(failures, layout.viewToggleDisplay === 'flex',
    `${label}: 视图开关不是桌面 flex 布局（display=${layout.viewToggleDisplay}）`)
  // 右上角是一块固定宽度面板：进入厚度视图（装甲组成过滤行出现）不得把面板撑宽
  // （2026-10-29 用户报障：点厚度模式后这一栏突然变宽）。
  const panelWidth = layout.bottomBar?.width
  await page.evaluate(`document.getElementById('collision-btn').click()`)
  await delay(200)
  const thicknessLayout = await page.probe(armorLayoutProbe)
  check(failures, thicknessLayout.bottomBar?.width === panelWidth,
    `${label}: 进入装甲厚度模式后右上角面板宽度变化（${panelWidth} → ${thicknessLayout.bottomBar?.width}px）`)
  await page.evaluate(`document.getElementById('collision-btn').click()`)
  await delay(200)

  // Desktop mirrors mobile portrait: the toggle expands the setup fields inside the top-left info card.
  await page.installInputTrace()
  await page.tap({ ...layout.tools.center, touch: scenario.touch })
  const tapInput = await page.inputTrace()
  check(failures, tapInput?.click?.testId === 'armor-tools',
    `${label}: 真实点击落在 ${JSON.stringify(tapInput?.click)}，不是参数开关`)
  const opened = await page.probe(armorLayoutProbe)
  check(failures, opened.toolsOpen === true && opened.tools?.ariaExpanded === 'true',
    `${label}: 点击后设置面板未展开（is-tools-open=${opened.toolsOpen} aria=${opened.tools?.ariaExpanded}）`)
  check(failures, opened.selectors?.visible === true, `${label}: 点击后设置面板仍不可见`)
  check(failures, opened.selectors && opened.tools && opened.selectors.top >= opened.tools.bottom - 1,
    `${label}: 设置面板没有排在参数开关下方（panel top=${opened.selectors?.top} tools bottom=${opened.tools?.bottom}）`)
  check(failures, opened.selectors && opened.topBar
    && opened.selectors.left >= opened.topBar.left - 1
    && opened.selectors.right <= opened.topBar.right + 1
    && opened.selectors.bottom <= opened.topBar.bottom + 1,
    `${label}: 设置面板没有并进左上角信息卡（panel=${opened.selectors?.left}/${opened.selectors?.bottom} bar=${opened.topBar?.left}/${opened.topBar?.bottom}）`)
  check(failures, opened.targetSelect?.visible === true, `${label}: 展开后目标按钮不可见`)
  check(failures, opened.configSelect?.visible === true, `${label}: 展开后配置下拉不可见`)
  checkCommonGeometry(failures, opened, `${label} (expanded)`)

  // Per-config armor: switching stock/top must update both armor plates and the gun-barrel
  // module cache, not just the initially loaded config. The fixture has two distinct configs.
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

/** Real scene + deterministic GLB: verify default camera and the prominent shot controls without inspecting pixels. */
const SHOT_SCENARIOS = [
  { name: 'armor-shot-actions-mobile', width: 390, height: 844, touch: true },
  { name: 'armor-shot-actions-tablet', width: 1024, height: 768, touch: false },
  { name: 'armor-shot-actions-desktop', width: 1280, height: 800, touch: false },
]
/** 射击复现夹具数据（sessionStorage 交接；runShotActionsScenario 与横屏场景共用同一份）。 */
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
async function runShotActionsScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
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
  // After integrating the readiness fix, real next/previous inputs must rebuild the scene and calculate once.
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

/** 手机横屏射击复现页：沉浸态 + 流内「操作提示」节整节让位（竖屏 / 平板 / 桌面保留，由 runShotActionsScenario 锁定）。 */
const SHOT_LANDSCAPE_SCENARIO = { name: 'armor-shot-landscape-phone', width: 740, height: 360, touch: true }
async function runShotLandscapeScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)
  await page.goto(`${env.origin}/?view=home&ws-auth=1`)
  await page.evaluate(`(async () => {
    localStorage.setItem('wotb-lang', 'zh')
    const { storeShotsForViewer } = await import('/src/scene/agentData.js')
    storeShotsForViewer(${JSON.stringify(FIXTURE_SHOTS)})
  })()`)
  await page.goto(`${env.origin}/?view=agent-armor&ws-auth=1&tank=${FIXTURE_TANK_ID}&shooter=${FIXTURE_TANK_ID}&shot=1&assets=${encodeURIComponent(env.assets)}`)
  await page.waitFor(() => !!document.querySelector('[data-testid="armor-stage"]'), { label: 'armor stage' })
  await page.waitFor(() => !document.querySelector('[data-testid="scene3d-loading"]') && !document.querySelector('[data-testid="scene3d-error"]'),
    { timeout: 30000, label: 'shot scene ready' })
  const label = scenario.name
  const layout = await page.probe(armorLayoutProbe)
  check(failures, layout.shellChrome === 'immersive', `${label}: 手机横屏未申请沉浸态（dataset=${layout.shellChrome}）`)
  check(failures, layout.appTopBar === null && layout.appTabBar === null,
    `${label}: 沉浸态下外壳顶栏 / Tab 栏仍渲染（top=${!!layout.appTopBar} tab=${!!layout.appTabBar}）`)
  check(failures, layout.root && layout.root.top === 0 && Math.abs(layout.root.height - layout.viewport.height) <= 1,
    `${label}: armor-view 没有占满整屏（root=${JSON.stringify(layout.root)} viewport=${JSON.stringify(layout.viewport)}）`)
  check(failures, layout.interactionHelp === null || layout.interactionHelp.visible === false,
    `${label}: 操作提示节没有在手机横屏让位（${JSON.stringify(layout.interactionHelp)}）`)
  check(failures, layout.shotHeader?.visible === true, `${label}: 射击复现顶栏丢失（${JSON.stringify(layout.shotHeader)}）`)
  checkCommonGeometry(failures, layout, label)
  check(failures, page.consoleErrors.length === 0, `${label}: JS errors: ${page.consoleErrors.join(' | ')}`)
  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
}

// A real roster response drives makeCard/loadMoreCards; do not synthesize card DOM or change product CSS.
const PICKER_TANK_CACHE = {
  ...FIXTURE_TANK_CACHE,
  ...Object.fromEntries(Array.from({ length: 120 }, (_, index) => {
    const id = 10000 + index
    return [id, { ...FIXTURE_TANK_CACHE[FIXTURE_TANK_ID], id, name: `Picker Medium ${String(index).padStart(3, '0')}` }]
  })),
}
const PICKER_PAGE_SIZE = 48   // 共享 TankCatalogMenu 的首屏页大小（useIncrementalList 默认）
const PICKER_SCENARIOS = ['showcase', 'classic'].flatMap(profile => [
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
/** 共享 TankCatalogMenu 的手机筛选 sheet 探针：四个筛选控件在 dialog 内可见。 */
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
  /** 真实滚轮逐页加载到目标条数（共享 useIncrementalList 每页 PICKER_PAGE_SIZE）。 */
  const exhaustPicker = async (total) => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const count = await page.evaluate(`document.querySelectorAll('#tp-grid .tank-card').length`)
      if (count >= total) return count
      const probe = await page.probe(pickerCardsProbe)
      await env.chrome.client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...probe.wheel, deltaX: 0, deltaY: probe.scrollHeight }, sessionId)
      // 等名册实际增长（IO 回调 + Vue patch 可能超过一帧），而不是固定延时。
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
  // The setup panel is collapsed by default on every viewport; open it before choosing a target.
  const initialChrome = await page.probe(armorLayoutProbe)
  if (!initialChrome.selectors?.visible) {
    await page.tap({ ...initialChrome.tools.center, touch: scenario.touch })
  }
  // The setup body scrolls inside the card; multiple configs push the target row below the
  // tablet-height fold. Scroll it into view before issuing real input.
  await page.evaluate(`document.getElementById('target-select').scrollIntoView({ block: 'nearest' })`)
  await delay(80)
  const controls = await page.probe(armorLayoutProbe)
  await page.tap({ x: controls.targetSelect.left + controls.targetSelect.width / 2, y: controls.targetSelect.top + controls.targetSelect.height / 2, touch: scenario.touch })
  await page.waitFor(() => !!document.querySelector('#tank-picker.open') && document.querySelectorAll('#tp-grid .tank-card').length >= 48,
    { timeout: 5000, label: 'first roster page' })
  // 大视口首屏会自动续页（IntersectionObserver 在哨兵可见时追加）；等它稳定后再取初始快照。
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
      // 视口扩大只靠 IO 续页：先不送滚轮，断言 resize 确实追加了一页（共享增量列表
      // 只补到可滚动，不要求一次到全量）；滚动加载剩余页在下一步单独测试。
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

/**
 * Context-loss lifecycle: losing WebGL during initialization must keep the error card
 * (no later modelProgress/ready overwrite) and retry must recreate the renderer.
 */
const CONTEXT_LOSS_SCENARIO = { name: 'armor-context-lost-init', width: 1024, height: 768, touch: false }
const CONTEXT_LOSS_SELECTION_SCENARIO = { name: 'armor-context-lost-selection', width: 1024, height: 768, touch: false }
/** 选择场景专用名册：默认夹具名册保持单车，避免影响其它门禁的首卡选择。 */
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
  // 给仍在途的 JSON/GLB/modelProgress 链足够时间走完；错误卡不得被 loading/ready 覆盖。
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

/**
 * Same-view route rebuild: the replacement viewer must not resurrect the previous route's
 * picker selection. Delayed tank_cache keeps the "before onTankSelection" window open.
 */
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
  // 同一 view 只换 query：URL 目标仍是 9001，旧 picker 选择是 9002。
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
  // tank_cache 延迟 1.5s：此刻新 viewer 尚未发布 onTankSelection，选择 refs 仍是旧路线的。
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

/** Load-order regression: collision enabled before the delayed armor GLB finishes, visual first. */
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
  // viewer 静态控件事件必须先挂上；按钮置灰期内的程序化点击会被浏览器忽略（真实用户同样点不动）。
  await page.waitFor(() => { const button = document.getElementById('collision-btn'); return !!button && !button.disabled },
    { timeout: 10000, label: 'viewer controls ready' })
  const beforeLoad = await page.evaluate('window.__LOAD__')
  check(failures, beforeLoad !== 'ok:' + FIXTURE_TANK_ID,
    `${scenario.name}: visual 在开启碰撞前已完成，竞态未被复现（__LOAD__=${beforeLoad}）`)
  // Programmatic click reaches the collision handler even while the status overlay is visible.
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
    let armorSample = null
    if (debug && debug.scene) {
      debug.scene.traverse(node => {
        if (armorSample || !node.isMesh || !node.visible || node.userData.armorSection === 'deco') return
        if (/_armor_/.test(node.name || '')) armorSample = node
      })
    }
    let visibleBodyMeshes = 0
    let visibleModuleMeshes = 0
    if (debug && debug.tankModel) {
      debug.tankModel.traverse(node => {
        if (!node.isMesh || !node.visible) return
        const section = node.userData.armorSection
        if (section === 'chassis' || section === 'gunBarrel') visibleModuleMeshes++
        else visibleBodyMeshes++
      })
    }
    return {
      load: window.__LOAD__,
      collision: document.getElementById('collision-btn').getAttribute('aria-pressed'),
      tankVisible: debug && debug.tankModel ? debug.tankModel.visible : null,
      visibleBodyMeshes,
      visibleModuleMeshes,
      armorOpacity: armorSample && armorSample.material ? armorSample.material.opacity : null,
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
  check(failures, state.armorOpacity != null && state.armorOpacity >= 0.9,
    `${scenario.name}: armor 材质未切到碰撞态（opacity=${state.armorOpacity}）`)
  check(failures, page.consoleErrors.length === 0, `${scenario.name}: JS errors: ${page.consoleErrors.join(' | ')}`)
  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
}

/* ------------------------------------------------------------------ main */

const chrome = findChrome()
const { server, origin } = await startFixtureServer()
const assets = await startFixtureAssetPack()
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
      // 本门禁要求 WebGL2 预检通过（否则整页走 unsupported 分支、没有可测的 stage）。
      // 无 GPU 的机器 / CI runner 上允许软件 WebGL 兜底（未知此 flag 的旧版本会忽略它）。
      '--enable-unsafe-swiftshader',
    ],
  })
  const env = { origin, chrome: chromeCdp, assets: assets.origin, pickerAssets: pickerAssets.origin, staggeredAssets: staggeredAssets.origin, contextLossSelectionAssets: contextLossSelectionAssets.origin, contextLossRouteRebuildAssets: contextLossRouteRebuildAssets.origin }
  const runs = [
    ...SHOT_SCENARIOS.map(scenario => ({ scenario, run: () => runShotActionsScenario(env, scenario) })),
    { scenario: SHOT_LANDSCAPE_SCENARIO, run: () => runShotLandscapeScenario(env, SHOT_LANDSCAPE_SCENARIO) },
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
  const nameFilter = process.argv.slice(2).find((arg) => !arg.startsWith('-'))
  const selected = nameFilter ? runs.filter(({ scenario }) => scenario.name.includes(nameFilter)) : runs
  if (nameFilter && selected.length === 0) throw new Error(`no scenario matches "${nameFilter}"`)
  for (const { scenario, run } of selected) {
    try {
      await run()
    } catch (error) {
      results.push({
        name: scenario.name,
        failures: [error.message, ...(lastPage ? await lastPage.diagnose(armorLayoutProbe).catch(() => []) : [])],
        viewport: `${scenario.width}x${scenario.height}`,
      })
    }
  }

  let failed = 0
  for (const result of results) {
    if (result.failures.length === 0) {
      console.log(`[browser-armor-mobile] ${result.name} OK (${result.viewport})`)
      continue
    }
    failed += 1
    console.error(`[browser-armor-mobile] ${result.name} FAILED (${result.viewport})`)
    for (const failure of result.failures) console.error(`  - ${failure}`)
  }
  if (failed > 0) {
    process.exitCode = 1
    console.error(`[browser-armor-mobile] ${failed}/${results.length} scenarios failed`)
  } else {
    console.log(`[browser-armor-mobile] all ${results.length} scenarios passed`)
  }
} finally {
  if (chromeCdp) await chromeCdp.close()
  await server.close()
  await assets.close()
  await staggeredAssets.close()
  await pickerAssets.close()
  await contextLossSelectionAssets.close()
  await contextLossRouteRebuildAssets.close()
}
