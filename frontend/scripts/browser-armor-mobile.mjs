import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page, delay } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

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
 *   1. 门禁不带资产包：坦克数据会加载失败，场景脚本弹出**全屏阻塞**错误遮罩——测量前
 *      先移除状态遮罩（它是环境产物，不是被测对象）。资产包若恰好在跑，页面直接进入
 *      正常态，同样兼容。
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
      return { text: button.textContent.trim(), width: Math.round(rect.width), height: Math.round(rect.height) }
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
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    statusOverlays: document.querySelectorAll('[data-testid="scene3d-error"], [data-testid="scene3d-loading"]').length,
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

/** 资产缺失时场景脚本的阻塞遮罩是环境产物：测量前移除（见文件头「环境前提」）。 */
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
  const assetQuery = scenario.assetless ? '&assets=http://127.0.0.1:1/' : ''
  await page.goto(`${env.origin}/?view=agent-armor&ws-auth=1&ws-roles=wotbtools-admin&tank=1${assetQuery}`)
  await page.waitFor(() => !!document.querySelector('[data-testid="armor-stage"]'), { label: 'armor stage' })
  // 等内核**做完**（成功或失败）：loading 遮罩消失才算 settled——否则注入的夹具会被
  // 迟到的真实加载结果覆盖，测量变成"看运气"。
  await page.waitFor(() => {
    const loading = document.querySelector('[data-testid="scene3d-loading"]')
    const error = document.querySelector('[data-testid="scene3d-error"]')
    return !loading || !!error
  }, { label: 'scene settled' })
  await dismissStatusOverlays(page)
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
  // 参数面板内的真实交互控件 ≥44px（评审 BLOCKER 1：配置下拉 + 两个装备复选框 label）
  if (!scenario.assetless) {
    check(failures, opened.configSelect?.visible === true && opened.configSelect.height >= 43.5,
      `${label}: 配置下拉缺失或命中区不足 44px（${JSON.stringify(opened.configSelect)}）`)
    check(failures, opened.eqOpts.length === 2, `${label}: 装备复选框 label 数量 ${opened.eqOpts.length}，期望 2`)
    for (const option of opened.eqOpts) {
      check(failures, option.height >= 43.5,
        `${label}: 装备「${option.text}」label 命中区 ${option.width}x${option.height}，低于 44px`)
      // 文案盒不得被压窄（width:auto 被 `#tank-selectors label{width:58px}` 按优先级盖回过一轮）
      check(failures, option.clipped === false,
        `${label}: 装备「${option.text}」label 文案溢出盒子（width=${option.width} 需要 ≥${option.needed}）`)
    }
    if (opened.eqOpts.length === 2) {
      const [first, second] = opened.eqOpts
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
    const [tier, nation, type] = picker.pickerFilters
    check(failures, tier && nation && type && Math.abs(tier.top - nation.top) <= 2 && Math.abs(nation.top - type.top) <= 2,
      `${label}: 三个筛选下拉不在同一行（tops=${picker.pickerFilters.map((filter) => filter?.top)}）`)
    for (const [index, filter] of picker.pickerFilters.entries()) {
      check(failures, filter && filter.height >= 43.5, `${label}: 筛选下拉 #${index} 高度 ${filter?.height}px，低于 44px`)
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

  const url = `${env.origin}/?view=agent-armor&ws-auth=1&ws-roles=wotbtools-admin&tank=1`
  await page.goto(url)
  // 模拟「从射击分析 / 坦克百科经路由打开」：history.state.back 存在 → 返回键出现
  await page.evaluate(`history.replaceState({ back: '/', current: location.href, forward: null }, '', location.href)`)
  await env.chrome.client.send('Page.reload', {}, sessionId)
  await page.waitFor(() => !!document.querySelector('[data-testid="armor-stage"]'), { label: 'armor stage after reload' })
  await page.waitFor(() => !!document.querySelector('[data-testid="armor-back"]'), { label: 'armor back button' })
  await dismissStatusOverlays(page)
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

/** 桌面 / 平板回归：本仓的移动端规则只能作用于 <768px，且参数开关不渲染成可见控件。 */
const DESKTOP_SCENARIOS = [
  // 断点边界：768px 起必须是桌面档（面板常驻、四角布局）
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

  await page.goto(`${env.origin}/?view=agent-armor&ws-auth=1&ws-roles=wotbtools-admin&tank=1`)
  await page.waitFor(() => !!document.querySelector('[data-testid="armor-stage"]'), { label: 'armor stage' })
  await page.waitFor(() => !!document.querySelector('[data-testid="scene3d-error"], [data-testid="scene3d-loading"], #info-panel'), { label: 'scene settled' })
  await dismissStatusOverlays(page)
  await delay(150)

  const label = scenario.name
  const layout = await page.probe(armorLayoutProbe)
  check(failures, layout.hasStage && !layout.unsupported, `${label}: 场景未渲染（hasStage=${layout.hasStage} unsupported=${layout.unsupported}）`)
  checkCommonGeometry(failures, layout, label)
  check(failures, layout.tools?.display === 'none' || !layout.tools?.visible,
    `${label}: 桌面档不应渲染可见的参数开关（display=${layout.tools?.display}）`)
  check(failures, layout.selectors?.visible === true,
    `${label}: 桌面档参数面板必须常驻可见（visible=${layout.selectors?.visible}）`)
  check(failures, layout.topBar && layout.root
    && Math.abs((layout.topBar.top - layout.root.top) - 20) <= 2 && Math.abs((layout.topBar.left - layout.root.left) - 20) <= 2,
    `${label}: 顶栏没有回到四角布局（top=${layout.topBar?.top} left=${layout.topBar?.left} root=${layout.root?.top}/${layout.root?.left}，期望相对 20/20）`)
  check(failures, layout.bottomBar && layout.root
    && Math.abs((layout.bottomBar.top - layout.root.top) - 20) <= 2 && Math.abs((layout.root.right - layout.bottomBar.right) - 20) <= 2,
    `${label}: 底栏没有回到右上角（top=${layout.bottomBar?.top} right=${layout.bottomBar?.right} root right=${layout.root?.right}，期望相对 20/20）`)
  check(failures, layout.viewToggleDisplay === 'flex',
    `${label}: 视图开关不是桌面 flex 布局（display=${layout.viewToggleDisplay}）`)

  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
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
      // 本门禁要求 WebGL2 预检通过（否则整页走 unsupported 分支、没有可测的 stage）。
      // 无 GPU 的机器 / CI runner 上允许软件 WebGL 兜底（未知此 flag 的旧版本会忽略它）。
      '--enable-unsafe-swiftshader',
    ],
  })
  const env = { origin, chrome: chromeCdp }
  const runs = [
    ...MOBILE_SCENARIOS.map((scenario) => ({ scenario, run: () => runMobileScenario(env, scenario) })),
    { scenario: BACK_SCENARIO, run: () => runMobileBackScenario(env, BACK_SCENARIO) },
    ...DESKTOP_SCENARIOS.map((scenario) => ({ scenario, run: () => runDesktopScenario(env, scenario) })),
    { scenario: ASSETLESS_SCENARIO, run: () => runMobileScenario(env, ASSETLESS_SCENARIO) },
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
}
