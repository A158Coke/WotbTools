/**
 * 装甲查看器 chrome 的几何快照。真函数（不用闭包），跨进程序列化执行。
 * 资产缺失时 #info-panel 保持 display:none，因此顶部卡片里只有「参数」开关；
 * 断言不依赖车名是否加载成功。
 */
export function armorLayoutProbe() {
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
  const rootStyle = root ? getComputedStyle(root) : null
  const sceneToken = (name) => {
    const value = rootStyle?.getPropertyValue(name).trim() || ''
    return value.endsWith('px') ? Number.parseFloat(value) : null
  }
  const stage = document.querySelector('[data-testid="armor-stage"]')
  const viewToggle = document.querySelector('#view-toggle')
  const turretRows = [...document.querySelectorAll('#turret-controls .ctrl-row')].map((row) => row.getBoundingClientRect())
  return {
    url: location.href,
    viewport: { width: innerWidth, height: innerHeight },
    horizontalOverflow: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    },
    coarse: matchMedia('(pointer: coarse)').matches,
    /** 场景根上的密度 token：短视口横屏紧凑档会把它收窄到 40px，断言从实际 token 取值而不是写死 44。 */
    sceneTokens: {
      space2: sceneToken('--space-2'),
      space5: sceneToken('--space-5'),
      hitComfortable: sceneToken('--hit-min-comfortable'),
    },
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
    /** 手机横屏短视口：左上胶囊 = 返回键 + 信息卡 + 参数按钮（视觉上一条胶囊）。 */
    capsule: (() => {
      const back = box('.armor-back')
      const card = box('#corner-tl')
      if (!back) return card
      if (!card) return back
      const top = Math.min(back.top, card.top)
      const bottom = Math.max(back.bottom, card.bottom)
      const left = Math.min(back.left, card.left)
      const right = Math.max(back.right, card.right)
      return {
        top, bottom, left, right,
        width: right - left, height: bottom - top,
        display: 'union', visible: back.visible && card.visible,
      }
    })(),
    clickInfo: (() => {
      const card = box('#click-info')
      if (!card) return null
      const element = document.querySelector('#click-info')
      const style = getComputedStyle(element)
      const borderLeft = parseFloat(style.borderLeftWidth)
      const borderRight = parseFloat(style.borderRightWidth)
      const contentLeft = Math.round(card.left + borderLeft + parseFloat(style.paddingLeft))
      const contentRight = Math.round(card.right - borderRight - parseFloat(style.paddingRight))
      return {
        ...card,
        maxInlineSize: style.maxInlineSize,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        contentLeft,
        contentRight,
        contentWidth: contentRight - contentLeft,
        clipped: element.scrollWidth > element.clientWidth + 1,
      }
    })(),
    clickRow: (() => {
      const element = document.querySelector('#click-info .row')
      if (!element) return null
      return {
        ...box('#click-info .row'),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }
    })(),
    clickPart: box('#click-part'),
    /** 厚度值节点本身是否完整落在结果卡内（overflow:hidden 裁切不能只看外层 box）。 */
    clickArmor: (() => {
      const card = box('#click-info')
      const value = document.querySelector('#click-armor')
      if (!card || !value) return null
      const rect = value.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(value)
      const textRect = range.getBoundingClientRect()
      return {
        ...box('#click-armor'),
        text: value.textContent,
        textLeft: Math.round(textRect.left),
        textRight: Math.round(textRect.right),
        insideCard: textRect.left >= card.left - 1 && textRect.right <= card.right + 1
          && textRect.top >= card.top - 1 && textRect.bottom <= card.bottom + 1,
        // 父级 #click-info 是 overflow:hidden，外框内不等于可见：必须落在 padding/border 之后的内容区。
        ...(() => {
          const style = getComputedStyle(document.querySelector('#click-info'))
          const contentLeft = card.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)
          const contentRight = card.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight)
          return {
            insideContent: textRect.left >= contentLeft - 1 && textRect.right <= contentRight + 1,
            contentLeft: Math.round(contentLeft),
            contentRight: Math.round(contentRight),
          }
        })(),
        selfClipped: value.scrollWidth > value.clientWidth + 1,
      }
    })(),
    closeTools: (() => {
      const element = document.querySelector('[data-testid="armor-tools-close"]')
      if (!element) return null
      const rect = element.getBoundingClientRect()
      const center = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
      const hit = document.elementFromPoint(center.x, center.y)
      return {
        ...box('[data-testid="armor-tools-close"]'),
        center,
        hitIsClose: hit === element || (!!hit && element.contains(hit)),
        hitDescription: hit ? `${hit.tagName}${typeof hit.className === 'string' && hit.className.trim() ? `.${hit.className.trim().split(/\s+/).join('.')}` : ''}` : null,
      }
    })(),
    trajInfo: box('#traj-info'),
    shellButton: box('[data-testid="hud-shell-0"]'),
    distanceInput: box('#armor-distance'),
    distanceValue: box('[data-testid="hud-distance-value"]'),
    penetration: box('[data-testid="hud-penetration"]'),
    viewToggle: box('#view-toggle'),
    tankName: (() => {
      const el = document.querySelector('#tank-name')
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return { width: Math.round(rect.width), height: Math.round(rect.height) }
    })(),
    requiredNodes: ['#corner-tl', '#info-panel', '#tank-name', '#tank-selectors', '#click-info', '#traj-info', '#corner-tr', '#turret-controls', '.armor-back']
      .map(selector => ({ selector, present: !!document.querySelector(selector) })),
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
    /** 外壳沉浸态（shared/shellChrome）：手机横屏申请后 AppShell 卸载顶栏并归零高度 token；任何形态都没有底部 Tab 栏（L1） */
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
export function applyLoadedFixture() {
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
export function check(failures, ok, message) {
  if (!ok) failures.push(message)
}

/** 顶栏 / 底栏共同的空间预算：这两行之外的高度必须全部留给 3D 场景。 */
const SCENE_BAND_MIN_RATIO = 0.6

export function checkCommonGeometry(failures, layout, label) {
  check(failures, layout.scrollWidth <= layout.clientWidth + 1,
    `${label}: page-level horizontal overflow: scrollWidth=${layout.scrollWidth} > clientWidth=${layout.clientWidth}`)
  check(failures, layout.root && layout.root.height > 200, `${label}: armor-view has no measurable height (${JSON.stringify(layout.root)})`)
}

export function checkSceneBand(failures, layout, label) {
  const band = layout.bottomBar.top - layout.topBar.bottom
  check(failures, band >= layout.root.height * SCENE_BAND_MIN_RATIO,
    `${label}: 3D 场景可用带只有 ${band}px（顶栏 ${layout.topBar.height}px + 底栏 ${layout.bottomBar.height}px 之后），低于 armor-view 高度 ${layout.root.height}px 的 ${SCENE_BAND_MIN_RATIO * 100}%`)
}

export function isCompactScene(layout) {
  return layout.coarse && layout.viewport.height <= 520 && layout.viewport.width > layout.viewport.height
}

export function checkTouchTargets(failures, layout, label) {
  // 场景 token 本身也要锁死：紧凑档 40px，其余触控/桌面 44px。
  // 视觉尺寸允许两处例外，但都必须由独立断言锁定：普通场景控件按 token 下限，
  // 装甲短横屏（<=500px）胶囊按 PR #932 的 38px / 36px 紧凑尺寸。
  const expected = isCompactScene(layout) ? 40 : 44
  const floor = layout.sceneTokens?.hitComfortable ?? 44
  check(failures, floor === expected, `${label}: 场景命中 token 为 ${floor}px，期望 ${expected}px`)
  const compactBar = layout.coarse && layout.topBar && layout.topBar.height <= 40
  const minTarget = compactBar ? 34.5 : floor - 0.5
  for (const button of layout.viewToggleButtons) {
    if (!button.visible) continue
    check(failures, Math.min(button.width, button.height) >= minTarget,
      `${label}: 视图开关「${button.text}」触控目标 ${button.width}x${button.height}，低于 ${compactBar ? '36px 紧凑分段下限' : `${floor}px`}`)
  }
  if (layout.tools) {
    check(failures, Math.min(layout.tools.width, layout.tools.height) >= minTarget,
      `${label}: 参数开关触控目标 ${layout.tools.width}x${layout.tools.height}，低于 ${compactBar ? '36px 胶囊下限' : `${floor}px`}`)
  }
  if (layout.back) {
    const minBackHeight = compactBar ? 36 : floor - 0.5
    check(failures, layout.back.height >= minBackHeight,
      `${label}: 返回键高度 ${layout.back.height}px，低于 ${compactBar ? '38px 胶囊下限' : `${floor}px`}`)
  }
}

/** 两个可见矩形是否相交（边缘相接不算）。 */
/** 结果卡高度预算（2026-11-14 用户裁示恢复五行读数后重定）：窄横屏下结果卡从单行胶囊
 *  变成「部件名 + 五行读数」，40px 上限不再适用。预算 = 视口高的 45%（下限仍 40px），
 *  既给五行留出空间，又保证卡片不超过小视口的一半——超出即视为布局退化。 */
export function resultHeightBudget(viewportHeight) {
  return Math.max(40, Math.round((viewportHeight || 0) * 0.45))
}

export function rectsOverlap(a, b) {
  if (!a?.visible || !b?.visible) return false
  return Math.min(a.right, b.right) > Math.max(a.left, b.left) + 0.5
    && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 0.5
}

/** 手机横屏短视口专用几何：紧凑胶囊 / 结果胶囊 / 右下射击 / 左下姿态四块互不相交。 */
export function checkCompactLandscapeHud(failures, layout, label, viewportHeight) {
  checkCommonGeometry(failures, layout, label)
  const missing = (layout.requiredNodes || []).filter(node => !node.present).map(node => node.selector)
  check(failures, missing.length === 0, `${label}: 场景脚本依赖的 DOM 节点缺失：${missing.join(', ')}`)
  check(failures, layout.coarse === true, `${label}: 设备仿真未生效（pointer: coarse 必须为 true）`)
  check(failures, layout.horizontalOverflow?.overflow === false,
    `${label}: 横屏布局出现横向溢出（${JSON.stringify(layout.horizontalOverflow)}）`)

  const result = layout.trajInfo?.visible ? layout.trajInfo : layout.clickInfo
  const boxes = {
    capsule: layout.capsule,
    result,
    shotPanel: layout.bottomBar,
    posturePanel: layout.turretControls,
  }
  const missingBoxes = Object.entries(boxes).filter(([, box]) => box?.visible !== true)
  for (const [name, box] of missingBoxes) {
    check(failures, false, `${label}: ${name} 不可见/不可测（${JSON.stringify(box)}）`)
  }
  // 盒子缺失时后续尺寸断言全都会读到 undefined；记录上面这条失败后直接结束，避免 TypeError。
  if (missingBoxes.length > 0) return
  const pairs = [
    ['capsule', 'result'], ['capsule', 'shotPanel'], ['capsule', 'posturePanel'],
    ['result', 'shotPanel'], ['result', 'posturePanel'], ['shotPanel', 'posturePanel'],
  ]
  for (const [a, b] of pairs) {
    check(failures, !rectsOverlap(boxes[a], boxes[b]),
      `${label}: ${a} 与 ${b} 相交（${a}=${JSON.stringify(boxes[a])} ${b}=${JSON.stringify(boxes[b])}）`)
  }

  check(failures, layout.capsule.height >= 36 && layout.capsule.height <= 40,
    `${label}: 左上胶囊高度 ${layout.capsule.height}px，不在 36–40px 区间`)
  check(failures, layout.capsule.width <= 280,
    `${label}: 左上胶囊宽 ${layout.capsule.width}px，超过 280px`)
  if (layout.viewport.width < 768) {
    // 窄横屏：结果胶囊移到胶囊下方第二行，必须同左对齐且不压住胶囊。
    check(failures, Math.abs(result.left - layout.capsule.left) <= 2 && result.top >= layout.capsule.bottom + 2,
      `${label}: 结果胶囊没有排在左上胶囊下方第二行（capsule=${JSON.stringify(layout.capsule)} result=${JSON.stringify(result)}）`)
  } else {
    check(failures, layout.capsule.right + 2 <= result.left,
      `${label}: 结果胶囊没有排在左上胶囊右侧（capsule right=${layout.capsule.right} result left=${result.left}）`)
  }
  check(failures, result.height <= resultHeightBudget(viewportHeight),
    `${label}: 结果卡高度 ${result.height}px，超过预算 ${resultHeightBudget(viewportHeight)}px`)

  check(failures, layout.bottomBar.width <= 280,
    `${label}: 右下射击面板宽 ${layout.bottomBar.width}px，超过 280px`)
  check(failures, layout.bottomBar.height <= layout.viewport.height * 0.45 + 1,
    `${label}: 右下射击面板高 ${layout.bottomBar.height}px，超过视口 ${layout.viewport.height}px 的 45%`)
  check(failures, layout.shellButton && Math.abs(layout.shellButton.width - 36) <= 2 && Math.abs(layout.shellButton.height - 36) <= 2,
    `${label}: 弹种按钮不是约 36px（${layout.shellButton?.width}x${layout.shellButton?.height}）`)
  check(failures, layout.distanceValue?.visible, `${label}: 距离数值不可见（${JSON.stringify(layout.distanceValue)}）`)
  check(failures, layout.distanceInput?.visible && layout.penetration?.visible
    && Math.abs((layout.distanceInput.top + layout.distanceInput.height / 2) - (layout.penetration.top + layout.penetration.height / 2)) <= 3,
    `${label}: 距离滑条与 AP 数值没有同排（input=${JSON.stringify(layout.distanceInput)} pen=${JSON.stringify(layout.penetration)}）`)
  check(failures, layout.viewToggle?.visible && layout.viewToggle.height <= 38,
    `${label}: 厚度/击穿分段开关高度 ${layout.viewToggle?.height}px，超过 38px`)

  check(failures, layout.turretControls.width <= 240 && layout.turretControls.height <= 80,
    `${label}: 左下姿态面板仍偏大（${layout.turretControls.width}x${layout.turretControls.height}）`)
  check(failures, layout.tankName && layout.tankName.height <= 20,
    `${label}: 车名单行高度异常（${JSON.stringify(layout.tankName)}）`)
}
