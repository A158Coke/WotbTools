import { OCCLUSION_LIMITS, measureOcclusion, measurePaintOrder, measureReachability } from './browser-occlusion.mjs'
import { detailsPlacementPreserved } from '../src/utils/detailsPlacementBounds.ts'
import { workspace2dProbe, hudStressProbe } from './browser-workspace-probes.mjs'

export function createWorkspace2DScenario({ Page, setLastPage, results, check, clicked, clickElement,
  clickCenterExpression, delay, dragDetailsTo, dragPointer, captureMobileReview, waitForStableLayout }) {
async function setRosterVisible(page, visible) {
  return page.evaluate(`(async () => {
    const wait = () => new Promise((r) => setTimeout(r, 120))
    const box = document.querySelector('[data-test="pb-show-roster"]')
    if (!box) {
      document.querySelector('[data-test="pb-secondary-entry"]')?.click()
      await wait()
    }
    const input = document.querySelector('[data-test="pb-show-roster"]')
    if (!input) return 'missing'
    if (input.checked !== ${visible}) input.click()
    await wait()
    const close = document.querySelector('[data-testid="display-close"]') || document.querySelector('[data-test="pb-secondary-entry"]')
    close?.click()
    await wait()
    return 'ok'
  })()`)
}

/**
 * Display 面开合：始终可从 gear 到达，且不把用户丢到首屏之外。
 *
 * 竖屏下 Display 是**流内**的一块面（不是浮层），必须紧跟传输控件，而不是被排到长长的
 * 详情 / 名册块之后——那种回归在 jsdom 里看不出来（没有布局引擎），只能在这里拦。
 * 宽档 / 横屏则必须是锚定 gear 的浮层。
 *
 * 必须在竖屏分支 return 之前调用：竖屏场景不走三段式断言。
 */
async function checkDisplaySurface(page, failures, layout, scenario) {
  const anchorFocused = await page.evaluate(`(() => {
    const gear = document.querySelector('[data-test="pb-secondary-entry"]')
    gear?.focus()
    return document.activeElement === gear
  })()`)
  await page.evaluate(`document.querySelector('[data-test="pb-secondary-entry"]')?.click()`)
  await delay(200)
  await captureMobileReview(page, scenario, 'display')
  const display = await page.evaluate(`(() => {
    const panel = document.querySelector('[data-testid="display-panel"]')
    if (!panel) return null
    const rect = panel.getBoundingClientRect()
    const transport = document.querySelector('[data-test="pb-transport-slot"]')
    const transportRect = transport?.getBoundingClientRect() || null
    const area = document.querySelector('[data-test="pb-inline-area"]')
    const close = panel.querySelector('[data-testid="display-close"]')
    return {
      order: getComputedStyle(panel).order,
      top: Math.round(rect.top),
      height: Math.round(rect.height),
      position: getComputedStyle(panel).position,
      transportBottom: transportRect ? Math.round(transportRect.bottom) : null,
      inlineAreaBottom: area ? Math.round(area.getBoundingClientRect().bottom) : null,
      viewportHeight: innerHeight,
      focusInside: panel.contains(document.activeElement),
      focusOnClose: !!close && document.activeElement === close,
    }
  })()`)
  check(failures, !!display, 'Display must open from the gear')
  if (display) {
    // 键盘落点：打开时进入面内（有明确关闭入口就优先给它），不在面外干等
    check(failures, display.focusInside,
      `Display must take the keyboard focus on open: ${JSON.stringify(display)}`)
    check(failures, display.focusOnClose,
      `Display should land on its close button: ${JSON.stringify(display)}`)
    if (layout === 'portrait') {
      check(failures, display.position === 'static',
        `portrait Display must be an inline surface: ${JSON.stringify(display)}`)
      check(failures, display.transportBottom != null && display.top - display.transportBottom <= 24,
        `portrait Display must follow the transport, not the inline details/roster block: ${JSON.stringify(display)}`)
      check(failures, display.inlineAreaBottom == null || display.top <= display.inlineAreaBottom + 1,
        `portrait Display must not be pushed below the inline details/roster block: ${JSON.stringify(display)}`)
      check(failures, display.top < display.viewportHeight,
        `portrait Display must open inside the first screen: ${JSON.stringify(display)}`)
    } else {
      check(failures, display.position === 'absolute',
        `wide Display must be an anchored overlay: ${JSON.stringify(display)}`)
    }
  }
  // —— #727 瞬态优先 + 可见即可达（design-language §5「遮挡与可达」）——
  // 绘制次序只能用重叠区的真实命中证明：z-index 数值本身证明不了任何事（只在同一层叠上下文可比）。
  if (display) {
    const PAINT_PAIR = { above: '[data-testid="display-panel"]', below: '[data-test="pb-transport-slot"]' }
    const paint = await measurePaintOrder(page, PAINT_PAIR)
    // 空跑守卫按形态逐场景判定，而不是整轮聚合（聚合会让按名字单跑竖屏、或 CI 分片只分到竖屏时误报）：
    // 宽档 / 横屏的 Display 锚在 gear 上，gear 就在常驻传输条里，两者按契约必然重叠——那正是
    // 「瞬态面压过常驻控件」要判定的区域，没重叠说明这条断言在该形态上空跑了。
    // 竖屏的 Display 是紧跟传输条的流内静态面，按契约本来就不重叠。
    // 手机横屏（minMap）传输条是底部全宽一行，Display 在其上方展开，按设计既不盖传输条也不盖详情：
    // 此时改证「没有覆盖」（传输条整条可点），而不是要求重叠。
    const reflowed = !!scenario.minMap
    if (reflowed) {
      check(failures, !paint.overlaps, `手机横屏 Display 应在全宽传输条上方展开、不得盖住传输条: ${JSON.stringify(paint)}`)
    } else if (layout !== 'portrait') {
      check(failures, paint.overlaps,
        'wide Display 是锚在 gear 上的浮层，应与常驻传输条重叠，实际没有：瞬态优先断言在这个形态上空跑了')
    }
    if (paint.overlaps) {
      for (const failure of paint.failures) check(failures, false, `Display 必须压过常驻传输条: ${failure}`)
      // 负向对照：把常驻传输条强行提回 #727 之前的裸 25，探针必须报错。
      await page.evaluate(`(() => {
        const style = document.createElement('style')
        style.id = 'occlusion-negative-control'
        style.textContent = '.pb-mobile-overlay, .pb-mobile-overlay-transient { z-index: 25 !important }'
        document.head.appendChild(style)
        return true
      })()`)
      let negative
      try {
        negative = await measurePaintOrder(page, PAINT_PAIR)
      } finally {
        // 注入的样式必须无条件撤掉：留下来会把后续断言全部染成"常驻条在上面"。
        await page.evaluate(`document.getElementById('occlusion-negative-control')?.remove()`)
      }
      check(failures, negative.failures.length > 0,
        `负向对照必须失败：常驻传输条提回 z-index 25 后探针仍然通过，说明它发现不了 #727 这类遮挡 ${JSON.stringify(negative)}`)
    }
    // 详情面板与 Display 同时开着时，Display 必须在上：Display 在外点时即关闭，所以两者同时可见时
    // 它一定是更晚打开的那个，被详情面板盖住就是"刚打开的面看不见"。
    // 竖屏的详情是流内块、不是浮层；只有宽档 / 横屏才有两块浮动面板叠在一起的状态组合。
    // 实测全部宽档 / 横屏形态两者都重叠（夹具开场即选中车辆），所以那里必须重叠——否则这条断言空跑。
    if (layout !== 'portrait' && !reflowed) {
      const detailsPaint = await measurePaintOrder(page, { above: '[data-testid="display-panel"]', below: '[data-test="pb-info"]' })
      check(failures, detailsPaint.overlaps === true,
        `宽档 Display 应与车辆详情面板重叠（夹具开场即选中车辆），实际没有：Display / 详情面板次序断言空跑了 ${JSON.stringify(detailsPaint)}`)
      for (const failure of detailsPaint.failures) check(failures, false, `Display 必须压过车辆详情面板: ${failure}`)
    }
    // 选项不只是按钮：显示开关是 label 包着的复选框，只查 button 会漏掉整块被盖住的复选框区
    const compact = !!scenario.touch && scenario.height <= 520 && scenario.width > scenario.height
    const reach = await measureReachability(page, {
      options: ['[data-testid="display-panel"] button', '[data-testid="display-panel"] label'],
      touch: !!scenario.touch,
      minTouchTargetPx: compact ? 40 : undefined,
    })
    for (const failure of reach.failures) check(failures, false, `Display 选项可达性: ${failure}`)
    check(failures, reach.sampled > 0, 'Display 可达性断言空跑：没有任何选项被实际命中采样')
  }

  await page.evaluate(`document.querySelector('[data-testid="display-close"]')?.click()`)
  await delay(200)
  const closed = await page.evaluate(`(() => ({
    gone: !document.querySelector('[data-testid="display-panel"]'),
    focusBackOnGear: document.activeElement === document.querySelector('[data-test="pb-secondary-entry"]'),
  }))()`)
  check(failures, closed.gone, 'Display close must remove the surface')
  // 关掉之后键盘不能掉在 body 上：焦点回到触发它的 gear
  if (anchorFocused) {
    check(failures, closed.focusBackOnGear,
      `closing Display must return focus to the gear: ${JSON.stringify(closed)}`)
  }
}

async function runWorkspace2DScenario(env, scenario) {
  const failures = []
  const viewport = `${scenario.fullscreen ? 'fullscreen ' : ''}${scenario.width}x${scenario.height}`
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  setLastPage(page)
  await page.enable()
  await page.emulate(scenario)
  await page.goto(`${env.origin}/scripts/browser-fixtures/playback-controls.html?duration=60&players=7&recorder=${scenario.recorder || 1}&marks=1${scenario.minMap ? '&shell=immersive' : ''}${scenario.hudStress ? `&hud=${scenario.hudStress}` : ''}`)
  await page.waitFor(() => !!document.querySelector('[data-test="pb-transport-toggle"]'), { label: '2D transport toggle' })
  // §roster-overlay：手机横屏默认**收纳**名册浮层（地图优先），桌面 / 平板默认展开。
  const defaultLanes = await page.evaluate(`!!document.querySelector('[data-test="pb-team-lane-left"]')`)
  const defaultPhoneLandscape = await page.evaluate(`document.querySelector('[data-test="battle-playback"]').classList.contains('pb-phone-landscape')`)
  if (scenario.width > scenario.height) {
    check(failures, defaultLanes === !defaultPhoneLandscape,
      `roster overlay default state wrong (phoneLandscape=${defaultPhoneLandscape} lanes=${defaultLanes})`)
  }
  // §5 遮挡契约按**生产默认态**测量（F4）：手机横屏默认收纳（常驻控件 = HUD/传输条）；
  // 桌面 / 平板默认展开的浮层落在地图两侧空隙里，这里同时守住「用户首屏看到的默认呈现
  // 没有实质遮挡」，不允许为了通过而把桌面名册藏起来再量。
  await delay(300)

  // —— #727 主内容遮挡（design-language §5）：常驻 quick actions 不得实质占住地图 ——
  // 这里量的是真实应用（不是夹具）：真实 locale 文字宽度 + 真实布局决定占比。
  const mapOcclusion = await measureOcclusion(page, {
    primary: '.pb-map',
    // 2D 的主内容是地图：HUD / 常驻传输条 / 任何浮动控件都不得实质压住它，由网格命中发现；
    // 清单只留不参与命中的装饰层。
    persistent: ['.pb-mobile-overlay-content', '.pb-hud', '.pb-kill-feed'],
    ignore: ['.pb-vehicle'],
  })
  console.log(`[browser-interaction] ${scenario.name} occlusion map=${mapOcclusion.primary ? `${mapOcclusion.primary.w}x${mapOcclusion.primary.h}` : '?'} total=${mapOcclusion.totalPct}%`)
  for (const failure of mapOcclusion.failures) {
    check(failures, false, `地图遮挡（上限 ${OCCLUSION_LIMITS.maxPrimaryCoveragePct}%）: ${failure}`)
  }
  // 手机横屏默认收纳：为后续名册 / 选车断言展开浮层；桌面已处于默认展开态，不要动它（F4）。
  if (scenario.width > scenario.height && !(await page.evaluate(`!!document.querySelector('[data-test="pb-team-lane-left"]')`))) {
    await page.evaluate(`document.querySelector('[data-test="pb-roster-entry"]')?.click()`)
  }
  await page.waitFor(() => !!document.querySelector('[data-test="pb-roster-row"]'), { label: '2D roster rows' })
  await delay(300)

  if (scenario.fullscreen) {
    await page.evaluate(`document.querySelector('[data-test="pb-fullscreen"]').scrollIntoView({ block: 'center' })`)
    await delay(200)
    const button = await page.evaluate(`(() => {
      const el = document.querySelector('[data-test="pb-fullscreen"]')
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await page.installInputTrace()
    await page.tap({ ...button, touch: scenario.touch })
    const input = await page.inputTrace()
    check(failures, input.click?.test === 'pb-fullscreen', `fullscreen real click missed button: ${JSON.stringify(input)}`)
    if (input.click?.test !== 'pb-fullscreen') {
      const boxes = await page.evaluate(`(() => {
        const selectors = ['.battle-playback', '.pb-main', '.pb-map-stage', '.pb-map', '.pb-transport-slot', '.pb-mobile-overlay', '.pb-mobile-overlay-content', '.pb-controls']
        return selectors.map((selector) => {
          const el = document.querySelector(selector)
          if (!el) return { selector, missing: true }
          const rect = el.getBoundingClientRect()
          const style = getComputedStyle(el)
          return { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            position: style.position, display: style.display, gridColumn: style.gridColumn, gridRow: style.gridRow,
            columns: style.gridTemplateColumns, rows: style.gridTemplateRows, inlineSize: style.inlineSize, minWidth: style.minWidth }
        })
      })()`)
      throw new Error(`fullscreen button occluded: ${JSON.stringify({ input, boxes })}`)
    }
    await page.waitFor(() => !!document.fullscreenElement, { timeout: 5000, label: 'document.fullscreenElement' })
    await delay(400)
  }

  await captureMobileReview(page, scenario)
  await page.waitFor(() => document.querySelector('[data-gun-marks] svg image')?.getAttribute('href')?.startsWith('data:image/png;base64,'),
    { label: 'self-contained Gun Marks atlas' })
  const marks = await page.evaluate(`(() => {
    const badges = [...document.querySelectorAll('[data-gun-marks] svg')]
    return {
      counts: [...new Set(badges.map(svg => Number(svg.parentElement.dataset.gunMarks)))].sort(),
      badgeCount: badges.length,
      fit: badges.every(svg => { const r = svg.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height <= 22 })
    }
  })()`)
  check(failures, marks.counts.join(',') === '1,2,3' && marks.badgeCount >= 10,
    `recorded mark badges missing: ${JSON.stringify(marks)}`)
  check(failures, marks.fit, `mark badge exceeds its fixed screen footprint: ${JSON.stringify(marks)}`)
  if (scenario.name === 'ws2d-1600x900-desktop') {
    const pixels = await page.evaluate(`(async () => {
      const { default: html2canvas } = await import('/node_modules/html2canvas/dist/html2canvas.esm.js')
      const { computeExportDimensions } = await import('/src/utils/exportReplayPng.js')
      const { default: externalAtlas } = await import('/src/assets/gun-marks/gun-marks.png?url')
      const sample = async (count, external = false) => {
        const host = document.createElement('div')
        host.style.cssText = 'position:fixed;left:-9999px;top:0;width:16px;height:20px;background:white'
        const svg = document.querySelector('[data-gun-marks="' + count + '"] svg').cloneNode(true)
        svg.style.cssText = 'display:block;width:16px;height:20px'
        if (external) svg.querySelector('image').setAttribute('href', externalAtlas)
        host.appendChild(svg)
        document.body.appendChild(host)
        try {
          const dims = computeExportDimensions({ width: 16, height: 20 })
          const rendered = await html2canvas(host, { scale: dims.scale, useCORS: true, backgroundColor: '#ffffff', width: dims.width, height: dims.height })
          // Decode the actual PNG, rather than inspecting only the intermediate canvas.
          const png = new Image()
          png.src = rendered.toDataURL('image/png')
          await png.decode()
          const canvas = document.createElement('canvas')
          canvas.width = png.width; canvas.height = png.height
          const ctx = canvas.getContext('2d')
          ctx.drawImage(png, 0, 0)
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
          let colored = 0
          for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0 && data[i] + data[i + 1] + data[i + 2] < 735) colored++
          return colored
        } finally { host.remove() }
      }
      return { counts: await Promise.all([1, 2, 3].map(n => sample(n))), external: await sample(3, true) }
    })()`)
    check(failures, pixels.counts.every(n => n > 20) && pixels.counts[0] < pixels.counts[1] && pixels.counts[1] < pixels.counts[2],
      `Gun Marks PNG pixels missing or wrong cells: ${JSON.stringify(pixels)}`)
    check(failures, pixels.external === 0, `external-image negative control unexpectedly rendered: ${JSON.stringify(pixels)}`)
    console.log(`[gun-marks-png] ${JSON.stringify(pixels)}`)
  }
  const g = await page.callWith(workspace2dProbe, scenario.touch)
  const result = () => results.push({ name: scenario.name, failures, viewport })
  check(failures, g.width === scenario.width && g.height === scenario.height,
    `viewport collapsed: requested ${scenario.width}x${scenario.height}, measured ${g.width}x${g.height}`)
  if (scenario.fullscreen) check(failures, g.fullscreen, 'fullscreen did not engage')
  check(failures, !g.pageOverflowX, 'page-level horizontal overflow')
  // 正方形 Stage：2D 地图元素带的是地图自己的逻辑画框（mapView W/H，如 766×769，底图 / SVG /
  // 标记共用这一个画框），与 1:1 的差 < 1%——拉成严格 1:1 反而会把地图拉伸变形。
  const squareish = (b) => b && b.w > 0 && Math.abs(b.w - b.h) <= Math.max(1.5, b.w * 0.01)
  check(failures, squareish(g.map), `Stage is not square: ${JSON.stringify(g.map)}`)
  check(failures, JSON.stringify(g.primaryOrder) === JSON.stringify(g.primaryIds),
    `primary controls DOM order: ${JSON.stringify(g.primaryOrder)}`)
  if (scenario.touch) {
    if (g.phoneLandscape) {
      check(failures, g.fullscreenInline === true, 'phone landscape: fullscreen entry must be inline in transport')
      check(failures, g.fullscreenCount === 1, `phone landscape: expected exactly one fullscreen entry, got ${g.fullscreenCount}`)
    } else {
      check(failures, g.fullscreenInline === false, 'phone portrait: fullscreen entry must stay a floating HUD button')
      check(failures, g.fullscreenCount === 1, `phone portrait: expected exactly one fullscreen entry, got ${g.fullscreenCount}`)
    }
  }
  check(failures, g.primaryBoxes.every((box) => box)
    && g.primaryBoxes.every((box, index) => index === 0 || box.l >= g.primaryBoxes[index - 1].r - 1),
    'primary controls must preserve their x-order')
  if (g.hud && g.map && g.transport) {
    for (const [name, gap] of [['HUD', g.map.t - g.hud.b], ['Transport', g.transport.t - g.map.b]]) {
      check(failures, gap >= -1 && gap <= 16, `${name} gap must remain compact (0–16px): ${gap.toFixed(1)} layout=${JSON.stringify(g.layout)}`)
    }
  }
  if (scenario.minMap) {
    // 手机横屏的高度账：地图 ≥ minMap；HUD 与传输条各一行（传输条横跨全宽，不再两行）。
    check(failures, g.map && g.map.h >= scenario.minMap, `phone-landscape map must be >= ${scenario.minMap}px: ${JSON.stringify(g.map)}`)
    check(failures, g.hud && g.hud.h <= 36, `phone-landscape HUD must be a single row (<=36px): ${JSON.stringify(g.hud)}`)
    check(failures, g.transport && g.transport.h <= 56 && g.transport.w >= scenario.width - 4,
      `phone-landscape transport must be one full-width row (<=56px): ${JSON.stringify(g.transport)}`)
    // 紧凑 HUD 两侧血条必须真的有宽度且对称（敌方曾因 grid 列顺序与模板不匹配被压成 0 宽）。
    const bars = await page.evaluate(`(() => {
      const w = (s) => document.querySelector(s)?.parentElement.getBoundingClientRect().width ?? 0
      return { friendly: w('[data-test="pb-hp-fill-friendly"]'), enemy: w('[data-test="pb-hp-fill-enemy"]') }
    })()`)
    check(failures, bars.friendly >= 40 && bars.enemy >= 40 && Math.abs(bars.friendly - bars.enemy) <= 2,
      `compact HUD HP bars must both be >=40px and symmetric: ${JSON.stringify(bars)}`)
    if (scenario.hudStress) {
      const h = await page.callWith(hudStressProbe, true)
      const exact = /^\d{5,} \/ \d{5,}$/
      const valueOk = scenario.hudStress === 'exact'
        ? h.values.every((value) => exact.test(value))
        : /^\d{5,}$/.test(h.values[0]) && h.values[1] === '—'
      check(failures, !h.missing && h.height <= 36, `hud stress: HUD missing or taller than one row: ${JSON.stringify(h)}`)
      check(failures, h.baseCount >= 4 && !!h.clock && !!h.score,
        `hud stress: base/clock/score lost: ${JSON.stringify({ bases: h.baseCount, clock: h.clock, score: h.score })}`)
      check(failures, valueOk && h.valueTextWidths.every((width, index) => width <= h.valueWidths[index] + 1),
        `hud stress: full HP values must render uncut: ${JSON.stringify({ values: h.values, text: h.valueTextWidths, box: h.valueWidths })}`)
      check(failures, h.tracks.every((width) => width >= 40) && Math.abs(h.tracks[0] - h.tracks[1]) <= 2,
        `hud stress: HP tracks must stay >=40px and symmetric: ${JSON.stringify(h.tracks)}`)
      check(failures, h.title && h.title.overflow === 'hidden' && h.title.textOverflow === 'ellipsis'
        && h.title.scrollWidth > h.title.width + 1,
        `hud stress: long map title must yield with ellipsis, not squeeze battle data: ${JSON.stringify(h.title)}`)
      check(failures, !h.centerOverlapsTeam && !h.valueOverlapsCenter && !h.hudOverflowX && !h.centerOverflowX,
        `hud stress: content overlaps/overflows: ${JSON.stringify({ center: h.rects.center, friendly: h.rects.friendly, enemy: h.rects.enemy, hudOverflowX: h.hudOverflowX, centerOverflowX: h.centerOverflowX, hudScrollWidth: h.hudScrollWidth, hudClientWidth: h.hudClientWidth })}`)
      console.log(`[browser-interaction] ${scenario.name} hud=${JSON.stringify({ width: h.width, height: h.height, tracks: h.tracks, values: h.values, bases: h.baseCount, mapW: h.title?.width })}`)
    }
    // 沉浸态横屏（非全屏）也贴屏幕边缘：模拟刘海侧 safe-area，车道与传输条不得进入该区域。
    if (!scenario.fullscreen) {
      const inset = 44
      await page.client.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: inset, right: inset } }, page.sessionId)
      await delay(200)
      const edges = await page.evaluate(`(() => {
        const r = (s) => document.querySelector(s)?.getBoundingClientRect()
        const l = r('[data-test="pb-team-lane-left"]'), rr = r('[data-test="pb-team-lane-right"]'), t = r('.pb-transport-slot')
        return { laneL: l?.left, laneR: rr?.right, transL: t?.left, transR: t?.right, width: innerWidth }
      })()`)
      await page.client.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: 0, right: 0 } }, page.sessionId)
      check(failures, edges.laneL >= inset - 1 && edges.transL >= inset - 1 && edges.laneR <= edges.width - inset + 1 && edges.transR <= edges.width - inset + 1,
        `phone-landscape content must stay inside left/right safe-area (${inset}px): ${JSON.stringify(edges)}`)
    }
    console.log(`[browser-interaction] ${scenario.name} map=${Math.round(g.map?.w)}x${Math.round(g.map?.h)} hud=${Math.round(g.hud?.h)} transport=${Math.round(g.transport?.h)}`)
  }
  // 手机横屏 / 桌面：六项同一行（全屏入口内联）；手机竖屏：五项同一行（全屏浮在 HUD）。
  const tops = g.primaryTops.filter((t) => t != null)
  check(failures, tops.length === g.primaryIds.length && Math.max(...tops) - Math.min(...tops) <= 1,
    `primary controls are not one row: ${JSON.stringify(g.primaryTops)}`)
  if (scenario.touch) {
    if (g.tokens.compact) {
      check(failures, g.tokens.controlMd === 36 && g.tokens.hitComfortable === 40 && g.tokens.space2 === 6,
        `compact scene tokens wrong: ${JSON.stringify(g.tokens)}`)
      check(failures, g.primaryMinSide >= 35.5, `compact primary visual height below 36px: ${g.primaryMinSide}`)
    } else {
      check(failures, g.tokens.hitComfortable === 44, `non-compact touch hit token changed: ${JSON.stringify(g.tokens)}`)
      check(failures, g.primaryMinSide >= 43.5, `primary control below 44px: ${g.primaryMinSide}`)
    }
    check(failures, g.primaryHitAreas.every((area) => area.center
      && (!g.tokens.compact || (area.top && area.bottom && area.left && area.right))),
      `primary controls do not expose a 40x40 effective hit area: ${JSON.stringify(g.primaryHitAreas)}`)
  } else {
    check(failures, g.tokens.compact === false && g.tokens.controlMd === 32 && g.tokens.hitComfortable === 44,
      `desktop scene tokens changed: ${JSON.stringify(g.tokens)}`)
  }

  const team1 = Array.from({ length: 7 }, (_, i) => 1001 + i)
  const team2 = Array.from({ length: 7 }, (_, i) => 2001 + i)
  if (scenario.layout === 'portrait') {
    check(failures, !g.left && !g.right, 'portrait must not render side lanes')
    check(failures, !!g.inline && !!g.transport && g.inline.t >= g.transport.b - 1, 'portrait roster must flow below the transport')
    check(failures, g.transport && g.map && g.transport.t >= g.map.b - 1, 'portrait transport must sit below the Stage')
    check(failures, JSON.stringify(g.inlineRosterIds) === JSON.stringify([...team1, ...team2]),
      `portrait roster order must be Team 1 then Team 2: ${JSON.stringify(g.inlineRosterIds)}`)
    check(failures, g.map && Math.abs(g.map.w - scenario.width) <= 2, 'portrait Stage must use the full column width')
    // 竖屏允许页面纵向延伸（纵向流），不是把名册塞进一个滚动盒
    const longPage = await page.evaluate('document.documentElement.scrollHeight > innerHeight')
    check(failures, longPage, 'portrait vertical flow should extend the page (no nested roster scroll box)')
    // 选中 → inline 详情排在传输控件之后、名册之前；× 只关详情
    await clickElement(page, '[data-test="pb-roster-row"][data-account-id="2002"]')
    await delay(200)
    const opened = await page.callWith(workspace2dProbe, scenario.touch)
    check(failures, opened.detailsPresentation === 'inline' && opened.inlineHasDetails,
      `portrait details must be the inline shared panel: ${opened.detailsPresentation}`)
    await clickElement(page, '[data-test="pb-sb-close"]')
    await delay(200)
    const closed = await page.callWith(workspace2dProbe, scenario.touch)
    check(failures, closed.detailsCount === 0, 'details × must close the panel')
    check(failures, JSON.stringify(closed.selectedIds) === '[2002]', `details × must keep the selection: ${JSON.stringify(closed.selectedIds)}`)
    await checkDisplaySurface(page, failures, scenario.layout, scenario)
    await checkPlaybackDeclutter(page, failures, scenario)
    await env.chrome.client.send('Target.closeTarget', { targetId })
    return result()
  }

  // ---- 三段式 ----
  check(failures, g.rootClass.includes('pb-roster-lanes'), `expected Team 1 | Stage | Team 2 lanes (class=${g.rootClass})`)
  check(failures, !!g.left && !!g.right, 'both physical lanes must be visible without opening any menu')
  if (!g.left || !g.right || !g.map) {
    await env.chrome.client.send('Target.closeTarget', { targetId })
    return result()
  }
  check(failures, JSON.stringify(g.left.ids) === JSON.stringify(scenario.recorder === 2 ? team2 : team1), `left lane must be Recorder friendly: ${JSON.stringify(g.left.ids)}`)
  check(failures, JSON.stringify(g.right.ids) === JSON.stringify(scenario.recorder === 2 ? team1 : team2), `right lane must be Recorder enemy: ${JSON.stringify(g.right.ids)}`)
  // §roster-overlay：车道是 Stage 内侧的浮层——贴 Stage 左右边缘（地图居中时落在侧带空隙里），
  // 任何形态都不得越过地图中心，也不得把地图压窄（地图正方形仍由纵向预算决定）。
  check(failures, g.left.box.r <= (g.map.l + g.map.r) / 2 + 1 && g.right.box.l >= (g.map.l + g.map.r) / 2 - 1,
    `overlay lanes must stay on their own side of the map center: left=${JSON.stringify(g.left.box)} right=${JSON.stringify(g.right.box)} map=${JSON.stringify(g.map)}`)
  check(failures, !g.left.scrolls && !g.right.scrolls, `normal 7v7 lanes must not scroll: ${JSON.stringify({ left: g.left.dbg, right: g.right.dbg })}`)
  check(failures, !g.left.scrollsX && !g.right.scrollsX && g.left.rowsFit && g.right.rowsFit,
    'long player/tank labels must shrink within each lane without horizontal scrolling or clipping the HP bar')
  check(failures, g.left.rowsComplete && g.right.rowsComplete, 'roster rows must show player / tank / HP bar with in-bar text')
  check(failures, g.left.hpBar && g.right.hpBar, 'roster rows must render an HP bar')
  if (g.transport && g.transport.h > 0) {
    check(failures, g.transport.t >= g.map.b - 1, `transport must sit below the Stage (transport=${JSON.stringify(g.transport)} map=${JSON.stringify(g.map)})`)
  }
  if (scenario.recorder === 2) {
    // HUD 仍是录像者视角：friendly 总血量 = Team 2 的当前总血量
    check(failures, /\d/.test(g.friendlyHp || ''), 'friendly HUD value missing')
  }

  // ---- 选择 Team 1 → 浮窗；名册两条都在 ----
  const time0 = g.time
  const leftPlayer = scenario.recorder === 2 ? 2002 : 1002
  const rightPlayer = scenario.recorder === 2 ? 1003 : 2003
  const rightName = scenario.recorder === 2 ? 'T1_Player_3' : 'T2_Player_3'
  const team1Click = await clickElement(page, `[data-test="pb-roster-row"][data-account-id="${leftPlayer}"]`)
  check(failures, clicked(team1Click), `Team 1 row not clickable: ${team1Click}`)
  await delay(250)
  let s = await page.callWith(workspace2dProbe, scenario.touch)
  check(failures, s.detailsCount === 1 && s.detailsPresentation === 'floating', 'selecting must open one floating details panel')
  check(failures, s.detailsParentIsMain, 'floating details must be a child of the battlefield workspace (.pb-main)')
  check(failures, !!s.left && !!s.right, 'details must not hide either lane')
  check(failures, s.details && s.details.l >= s.map.l - 1, 'clicking a left-lane row should place details away from the left lane')
  // 初始落位不压中心栏（HUD / Stage / 传输控件同一列）：侧边放得下（≥ 240px）时，浮窗整个落在那一列之外
  const column = s.transport && s.transport.w > 0 ? s.transport : s.map
  if (s.main.r - 16 - (column.r + 8) >= 240) {
    check(failures, s.details && s.details.l >= column.r + 7.5 && (!s.hud || s.details.l >= s.hud.r - 0.5),
      `initial details must keep the HUD / Stage column clear: details=${JSON.stringify(s.details)} column=${JSON.stringify(column)} hud=${JSON.stringify(s.hud)}`)
  }

  // ---- 拖到 Team 1 / Stage / Team 2 三个区域 ----
  // 右 → 中 → 左：最后停在 Team 1 之上，Team 2 车道保持可点（用户的真实流程：开着详情连点 Team 2）。
  const regions = [['right', (s.right.box.l + s.right.box.r) / 2], ['center', (s.map.l + s.map.r) / 2], ['left', (s.left.box.l + s.left.box.r) / 2]]
  let lastPos = null
  for (const [label, x] of regions) {
    await dragDetailsTo(page, x, scenario.touch)
    const d = await page.callWith(workspace2dProbe, scenario.touch)
    const panel = d.details
    const centre = panel ? (panel.l + panel.r) / 2 : NaN
    const target = label === 'left' ? d.left.box : label === 'right' ? d.right.box : d.map
    check(failures, panel && centre >= target.l - panel.w / 2 && centre <= target.r + panel.w / 2,
      `details could not be dragged over the ${label} region (panel=${JSON.stringify(panel)})`)
    check(failures, panel && panel.l >= d.main.l - 0.5 && panel.r <= d.main.r + 0.5 && panel.t >= d.main.t - 0.5,
      `details left the battlefield workspace after dragging ${label}`)
    if (d.transport && d.transport.h > 0) {
      check(failures, panel && panel.b <= d.transport.t + 0.5, `details covers the transport after dragging ${label}`)
    }
    // 记录宿主相对坐标：下面点 Team 2 时 clickElement 可能把行滚进视口，页面 scrollY 变化会
    // 同时移动面板与宿主，只比较视口坐标会把滚动误判成“面板被重新摆放”。
    lastPos = { panel, main: d.main, transport: d.transport }
  }

  // ---- 点 Team 2 → 同一个窗更新、位置不动、Team 2 车道仍在 ----
  const team2Click = await clickElement(page, `[data-test="pb-roster-row"][data-account-id="${rightPlayer}"]`)
  check(failures, clicked(team2Click), `Team 2 row not clickable: ${team2Click}`)
  await delay(250)
  s = await page.callWith(workspace2dProbe, scenario.touch)
  check(failures, s.detailsCount === 1 && s.detailsPlayer === rightName, `details did not update to the Team 2 vehicle: ${s.detailsPlayer}`)
  check(failures, !!s.right, 'Team 2 lane disappeared after selecting a Team 2 vehicle')
  // 宿主相对坐标：页面滚动不影响。选中另一台车时内容高度可能变化；ResizeObserver 的合法结果
  // 由生产同一份 detailsPlacementLimits 推导：old top 仍合法就**原位保留**，只有真正越过
  // transport / host 下界才 clamp。不能用「上移不超过增高量」这类弱谓词（会放过不必要的位移）。
  const oldPanel = lastPos?.panel
  const oldMain = lastPos?.main
  const dx = oldPanel && oldMain && s.details && s.main ? (s.details.l - s.main.l) - (oldPanel.l - oldMain.l) : NaN
  const placementOk = !!(oldPanel && oldMain && s.details && s.main && s.mainPadding) && detailsPlacementPreserved({
    oldTop: oldPanel.t - oldMain.t,
    newTop: s.details.t - s.main.t,
    newHeight: s.details.h,
    hostWidth: s.main.w,
    hostHeight: s.main.h,
    paddingLeft: s.mainPadding.left,
    paddingRight: s.mainPadding.right,
    paddingTop: s.mainPadding.top,
    panelWidth: s.details.w,
    transportTop: s.transport ? s.transport.t - s.main.t : null,
  })
  check(failures, placementOk && Math.abs(dx) < 1
    && (!s.transport || s.details.b <= s.transport.t + 0.5),
    `user-dragged details position must survive selection changes (host-relative): dx=${dx} old=${JSON.stringify(oldPanel)} now=${JSON.stringify(s.details)} host=${JSON.stringify(s.main)} padding=${JSON.stringify(s.mainPadding)} transport=${JSON.stringify(s.transport)}`)

  // ---- × 只关详情 ----
  await clickElement(page, '[data-test="pb-sb-close"]')
  await delay(200)
  s = await page.callWith(workspace2dProbe, scenario.touch)
  check(failures, s.detailsCount === 0, 'details × must close the panel')
  check(failures, JSON.stringify(s.selectedIds) === JSON.stringify([rightPlayer]), `details × must keep the selection: ${JSON.stringify(s.selectedIds)}`)
  check(failures, s.time === time0, `closing details changed playback time ${time0} -> ${s.time}`)
  await clickElement(page, `[data-test="pb-roster-row"][data-account-id="${rightPlayer}"]`)
  await delay(200)
  s = await page.callWith(workspace2dProbe, scenario.touch)
  check(failures, s.detailsCount === 1, 'clicking the selected vehicle again must reopen details')

  // ---- 名册关闭：车道消失，Stage 仍是居中正方形，详情与选中保留 ----
  if (!scenario.fullscreen) {
    check(failures, (await setRosterVisible(page, false)) === 'ok', 'roster preference toggle missing')
    await delay(300)
    s = await page.callWith(workspace2dProbe, scenario.touch)
    check(failures, !s.left && !s.right, 'roster OFF must remove both lanes')
    check(failures, squareish(s.map), `roster OFF Stage must stay square: ${JSON.stringify(s.map)} main=${JSON.stringify(s.main)}`)
    check(failures, s.map && s.main && Math.abs((s.map.l + s.map.r) / 2 - (s.main.l + s.main.r) / 2) <= 2, 'roster OFF Stage must stay centred')
    check(failures, s.detailsCount === 1, 'roster OFF must keep Details open')
    await setRosterVisible(page, true)
    await delay(300)
    s = await page.callWith(workspace2dProbe, scenario.touch)
    check(failures, !!s.left && !!s.right && JSON.stringify(s.selectedIds) === JSON.stringify([rightPlayer]), 'roster ON must restore lanes with the existing selection')
  }

  // ---- Display 面开合：始终可从 gear 到达，且不把用户丢到首屏之外 ----
  await checkDisplaySurface(page, failures, scenario.layout, scenario)

  // Opening the editor changes the height budget. Closed-editor geometry does not cover
  // short landscape fullscreen or the touch palette, so exercise the visible tools too.
  await checkAnnotationMode(page, failures, scenario)
  await checkPlaybackDeclutter(page, failures, scenario)

  // ---- 标注：真实鼠标从车辆上起笔拖一条箭头——只画线，不选中车辆、不出现浏览器选区 ----
  if (!scenario.touch) await checkAnnotationDrag(page, failures)

  check(failures, page.consoleErrors.length === 0, `JS errors: ${page.consoleErrors.join(' | ')}`)
  await env.chrome.client.send('Target.closeTarget', { targetId })
  result()
}

async function checkPlaybackDeclutter(page, failures, scenario) {
  const state = `(() => {
    const map = document.querySelector('[data-test="pb-map"]')?.getBoundingClientRect()
    const main = document.querySelector('[data-test="pb-main"]')?.getBoundingClientRect()
    const stage = document.querySelector('.pb-map-stage')?.getBoundingClientRect()
    const count = selector => document.querySelectorAll(selector).length
    return {
      mapWidth: map?.width, mapHeight: map?.height, mainWidth: main?.width, stageWidth: stage?.width,
      markers: count('.pb-vehicle'), icons: count('.pb-vehicle .tank-class-icon'),
      hp: count('.pb-vehicle [data-test="pb-hp-hud"]'), rings: count('.pb-vehicle [data-test="pb-hp-ring"]'), tanks: count('.pb-vehicle [data-test="pb-label-tank"]'),
      players: count('.pb-vehicle [data-test="pb-label-player"]'), reload: count('.pb-vehicle [data-test="pb-reload"]'),
      statuses: count('.pb-vehicle .pb-recorder-badge, .pb-vehicle .pb-death, .pb-vehicle .pb-selected-mark'),
      roster: count('[data-test="pb-roster-row"]'),
      active: document.querySelector('[data-test="pb-declutter"]')?.getAttribute('aria-pressed'),
      // 2D 的名册开关是 Display 面里的复选框（#727 后地图上不再有常驻 quick actions）
      expanded: document.querySelector('[data-test="pb-show-roster"]') ? String(document.querySelector('[data-test="pb-show-roster"]').checked) : undefined,
      time: document.querySelector('[data-test="pb-time"]')?.textContent,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    }
  })()`
  const tap = async selector => {
    const center = await page.evaluate(clickCenterExpression(selector))
    check(failures, !!center, `${selector} must be visible and hit-testable`)
    if (!center) return
    await page.installInputTrace()
    await page.tap({ ...center, touch: scenario.touch })
    const trace = await page.inputTrace()
    check(failures, selector.includes(trace?.click?.test) || selector.includes(trace?.click?.testId), `${selector} real click missed: ${JSON.stringify(trace?.click)}`)
  }
  const before = await page.evaluate(state)
  await tap('[data-test="pb-secondary-entry"]')
  await page.waitFor(() => !!document.querySelector('[data-testid="pb-hp-mode-ring"]'), { label: 'HP mode display controls' })
  await page.evaluate(`document.querySelector('[data-testid="pb-hp-mode-ring"]').scrollIntoView({ block: 'nearest' })`)
  await tap('[data-testid="pb-hp-mode-ring"]')
  const manualRing = await page.waitForValue(state, value => value.rings > 0 && value.hp === 0, { label: 'ring mode selected' })
  check(failures, manualRing.reload === 0 && !manualRing.overflow, 'ring mode hides reload without overflowing the page')
  const ringGeometry = await page.evaluate(`(() => {
    const ring = document.querySelector('.pb-hp-ring'), r = ring.getBoundingClientRect(), m = ring.closest('.pb-vehicle').getBoundingClientRect()
    return { centered: Math.abs((r.left+r.right-m.left-m.right)/2) < 1 && Math.abs((r.top+r.bottom-m.top-m.bottom)/2) < 1,
      surrounds: r.width >= m.width + 6, ringWidth: r.width, markerWidth: m.width, reloadDisabled: document.querySelector('[data-test="pb-show-reload"]').disabled }
  })()`)
  check(failures, ringGeometry.centered && ringGeometry.surrounds && ringGeometry.reloadDisabled,
    `HP ring must surround its marker and disable reload: ${JSON.stringify(ringGeometry)}`)
  await tap('[data-testid="pb-hp-mode-bar"]')
  await page.waitForValue(state, value => value.rings === before.rings && value.hp === before.hp, { label: 'bar mode restored' })
  // #727 之后，防遮与名册开关都在 Display 面里（地图上不再放常驻控件），所以先确保面是开着的。
  const ensureDisplayOpen = async () => {
    const open = await page.evaluate(`!!document.querySelector('[data-testid="display-panel"]')`)
    if (!open) await tap('[data-test="pb-secondary-entry"]')
    await page.waitFor(() => !!document.querySelector('[data-testid="display-panel"]'), { label: 'Display surface open' })
  }
  await ensureDisplayOpen()
  await tap('[data-test="pb-declutter"]')
  const clean = await page.waitForValue(state, s => s.active === 'true', { label: 'declutter applied' })
  check(failures, clean.markers > 0 && clean.icons === clean.markers && clean.tanks > 0,
    `declutter must render tank classes and tank names: ${JSON.stringify(clean)}`)
  check(failures, clean.players === 0 && clean.hp === 0 && clean.rings > 0 && clean.reload === 0 && clean.statuses === 0,
    `declutter must retain HP rings and remove player names, bars and status decorations: ${JSON.stringify(clean)}`)
  await ensureDisplayOpen()
  await tap('[data-test="pb-declutter"]')
  const restored = await page.waitForValue(state, s => s.active === 'false', { label: 'declutter restored' })
  check(failures, ['icons', 'hp', 'rings', 'players', 'reload', 'statuses'].every(key => before[key] === restored[key]),
    `declutter must restore the previous presentation: before=${JSON.stringify(before)} after=${JSON.stringify(restored)}`)
  await ensureDisplayOpen()
  await tap('[data-test="pb-show-roster"]')
  const hidden = await page.waitForValue(state, s => s.expanded === 'false' && s.roster === 0, { label: 'roster hidden' })
  check(failures, hidden.mapWidth >= before.mapWidth - 1 && !hidden.overflow, 'hiding teams must preserve or expand the usable map without overflow')
  // Height-constrained square maps cannot grow further; width-constrained maps must.
  if (before.stageWidth && before.stageWidth < before.mainWidth - 2) {
    check(failures, hidden.stageWidth > before.stageWidth + 1, 'collapsing team lanes must return their width to the map stage')
  }
  if (before.stageWidth && Math.abs(before.mapWidth - before.stageWidth) <= 2 && hidden.stageWidth > before.stageWidth + 1) {
    check(failures, hidden.mapWidth > before.mapWidth + 1, 'a width-constrained map must grow when the team lanes collapse')
  }
  await ensureDisplayOpen()
  await tap('[data-test="pb-show-roster"]')
  const shown = await page.waitForValue(state, s => s.expanded === 'true' && s.roster === before.roster, { label: 'roster restored' })
  check(failures, shown.time === before.time, 'display shortcuts must not change playback time')
  // 这些开关现在都在 Display 面里：离开时把面关回去，否则它会挡住后续场景的地图交互
  // （`@pointerdown.stop` 会吃掉标记拖拽）。
  await page.evaluate(`document.querySelector('[data-testid="display-close"]')?.click()`)
  await page.waitFor(() => !document.querySelector('[data-testid="display-panel"]'), { label: 'Display surface closed' })
}

async function checkAnnotationMode(page, failures, scenario) {
  if (await page.evaluate(`!!document.querySelector('[data-test="pb-sb-close"]')`)) {
    await clickElement(page, '[data-test="pb-sb-close"]')
  }
  check(failures, await page.evaluate(`!document.querySelector('[data-test="pb-annot-toolbar"]') && document.querySelectorAll('.pb-annot-item').length === 0`), 'replay must start without an editor or seeded marks')
  await clickElement(page, '[data-test="pb-annotation-entry"]')
  await page.waitFor(() => !!document.querySelector('[data-test="pb-annot-toolbar"]'), { label: 'annotation select controls' })
  await waitForStableLayout(page)
  const vehicleTap = await page.evaluate(`(() => {
    const map = document.querySelector('[data-test="pb-map"]').getBoundingClientRect()
    const marker = [...document.querySelectorAll('.pb-vehicle:not(.pb-destroyed)')].find(el => {
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2
      return x > map.left + 4 && x < map.right - 4 && y > map.top + 4 && y < map.bottom - 4 && y > 0 && y < innerHeight
    })
    if (!marker) return null
    const r = marker.getBoundingClientRect()
    return { x: r.left + r.width/2, y: r.top + r.height/2,
      tank: marker.querySelector('[data-test="pb-label-tank"]')?.textContent,
      hp: marker.querySelector('[data-test="pb-hp-num"]')?.textContent }
  })()`)
  check(failures, !!vehicleTap, 'select-mode inspection needs a visible vehicle')
  if (vehicleTap) {
    await page.tap({ x: vehicleTap.x, y: vehicleTap.y, touch: scenario.touch })
    await page.waitFor(() => !!document.querySelector('[data-test="pb-info"]'), { label: 'vehicle details in annotation select mode' })
    const details = await page.evaluate(`({tank:document.querySelector('[data-test="pb-sb-tank"]')?.textContent, hp:document.querySelector('[data-test="pb-sb-hp-current"]')?.textContent})`)
    check(failures, details.tank === vehicleTap.tank && details.hp === vehicleTap.hp,
      `map inspection must show this vehicle and current HP: ${JSON.stringify({details, vehicleTap})}`)
    await clickElement(page, '[data-test="pb-sb-close"]')
  }
  for (const tool of ['LT', 'MT', 'HT', 'TD', 'route']) {
    check(failures, clicked(await clickElement(page, `[data-test="pb-annot-${tool}"]`)), `annotation ${tool} tool must be reachable`)
  }
  const geometry = await page.evaluate(`(() => {
    const map = document.querySelector('[data-test="pb-map"]').getBoundingClientRect()
    const toolbar = document.querySelector('[data-test="pb-annot-toolbar"]').getBoundingClientRect()
    const close = document.querySelector('[data-test="pb-annot-close"]').getBoundingClientRect()
    return { mapHeight: map.height, mapBottom: map.bottom, toolbarTop: toolbar.top, closeBottom: close.bottom, viewport: innerHeight, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 }
  })()`)
  check(failures, geometry.mapHeight >= 96, `marking mode must retain a usable battlefield: ${JSON.stringify(geometry)}`)
  check(failures, !geometry.horizontalOverflow, `marking tools must not overflow the page horizontally: ${JSON.stringify(geometry)}`)
  if (scenario.fullscreen) check(failures, geometry.closeBottom <= geometry.viewport + 1, `fullscreen marking exit must not be clipped: ${JSON.stringify(geometry)}`)
  if (scenario.annotationFullscreen) {
    await checkCompactAnnotationFullscreen(page, failures, scenario)
  } else {
    check(failures, clicked(await clickElement(page, '[data-test="pb-annot-close"]')), 'marking mode must be closable')
    await delay(150)
  }
}

/**
 * 手机横屏 compactAnnotation：传输条隐藏后仍要有唯一可达的全屏入口。
 * 真正在浏览器里开标注、点两条未完成路线、进出全屏，再关标注恢复传输条——
 * 状态断言只看 route draft / toolbar / 入口可见性，不依赖组件内部 ref。
 */
async function checkCompactAnnotationFullscreen(page, failures, scenario) {
  const map = await page.evaluate(`(() => {
    const r = document.querySelector('[data-test="pb-map"]').getBoundingClientRect()
    return { l: r.left, t: r.top, w: r.width, h: r.height }
  })()`)
  check(failures, map.w > 0 && map.h > 0, `annotation fullscreen test needs a measurable map: ${JSON.stringify(map)}`)
  if (!(map.w > 0 && map.h > 0)) return
  const routePoints = [
    { x: Math.round(map.l + map.w * 0.3), y: Math.round(map.t + map.h * 0.3) },
    { x: Math.round(map.l + map.w * 0.7), y: Math.round(map.t + map.h * 0.65) },
  ]
  for (const point of routePoints) await page.tap({ ...point, touch: scenario.touch })
  await page.waitFor(() => !!document.querySelector('[data-test="pb-annot-route-shape"]'),
    { label: 'unfinished route draft' })

  const snapshot = () => page.evaluate(`(() => {
    const visible = (el) => !!el && el.getClientRects().length > 0
    const root = document.querySelector('[data-test="battle-playback"]')
    const toolbar = document.querySelector('[data-test="pb-annot-toolbar"]')
    const surface = document.querySelector('.pb-annotation-surface')
    const entries = [...document.querySelectorAll('[data-test="pb-fullscreen"]')]
      .filter(visible)
      .map((el) => {
        const r = el.getBoundingClientRect()
        return { l: r.left, t: r.top, r: r.right, b: r.bottom, inTransport: !!el.closest('[data-test="pb-transport-controls"]') }
      })
    const shape = document.querySelector('[data-test="pb-annot-route-shape"]')
    const polyline = shape && shape.querySelector('polyline')
    const finish = document.querySelector('[data-test="pb-annot-route-finish"]')
    const rr = root && root.getBoundingClientRect()
    const tr = toolbar && toolbar.getBoundingClientRect()
    const sr = surface && surface.getBoundingClientRect()
    const tb = tr ? { l: tr.left, t: tr.top, r: tr.right, b: tr.bottom } : null
    const intersects = (a, b) => !!a && !!b && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5
    return {
      fullscreen: !!document.fullscreenElement,
      routeExists: !!shape,
      routeVertices: polyline ? polyline.getAttribute('points').trim().split(/\\s+/).filter(Boolean).length : 0,
      routeActive: document.querySelector('[data-test="pb-annot-route"]')?.classList.contains('active') || false,
      finishDisabled: finish ? finish.disabled : null,
      toolbarVisible: visible(toolbar),
      transportVisible: visible(document.querySelector('[data-test="pb-transport-controls"]')),
      annotationSurface: sr ? { l: sr.left, t: sr.top, r: sr.right, b: sr.bottom } : null,
      toolbar: tb,
      root: rr ? { l: rr.left, t: rr.top, r: rr.right, b: rr.bottom } : null,
      entries,
      entryOverlapsToolbar: entries.length === 1 && tb ? intersects(entries[0], tb) : null,
      docScrollWidth: document.documentElement.scrollWidth,
      surfaceOverflowsX: sr && rr ? sr.left < rr.left - 0.5 || sr.right > rr.right + 0.5 : null,
      pageOverflowsX: document.documentElement.scrollWidth > innerWidth + 1,
      entryInsideRoot: entries.length === 1 && rr
        ? entries[0].l >= rr.left - 1 && entries[0].r <= rr.right + 1 && entries[0].t >= rr.top - 1 && entries[0].b <= rr.bottom + 1
        : null,
    }
  })()`)

  let before = await snapshot()
  console.log(`[browser-interaction] ${scenario.name} annotation fullscreen before=${JSON.stringify(before)}`)
  check(failures, before.routeExists && before.routeVertices === 2 && before.routeActive && before.finishDisabled === false,
    `annotation route must stay editable before fullscreen: ${JSON.stringify(before)}`)
  check(failures, before.toolbarVisible && !before.transportVisible,
    `compact annotation must hide transport controls: ${JSON.stringify(before)}`)
  check(failures, before.entries.length === 1 && !before.entries[0].inTransport,
    `compact annotation must expose exactly one floating fullscreen entry: ${JSON.stringify(before.entries)}`)
  check(failures, before.entryInsideRoot === true && before.entryOverlapsToolbar === false && before.surfaceOverflowsX === false && before.pageOverflowsX === false,
    `annotation fullscreen entry must stay inside the workspace without covering the toolbar or overflowing horizontally: ${JSON.stringify({ entry: before.entries[0], toolbar: before.toolbar, root: before.root, surface: before.annotationSurface, docScrollWidth: before.docScrollWidth })}`)

  const tapFullscreen = async (label) => {
    const point = await page.evaluate(`(() => {
      const el = [...document.querySelectorAll('[data-test="pb-fullscreen"]')].find((node) => node.getClientRects().length > 0)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    check(failures, !!point, `${label}: fullscreen entry is not measurable`)
    if (!point) return
    await page.tap({ ...point, touch: scenario.touch })
  }

  await tapFullscreen('enter')
  await page.waitFor(() => !!document.fullscreenElement, { timeout: 5000, label: 'annotation fullscreen entered' })
  await delay(300)
  const opened = await snapshot()
  console.log(`[browser-interaction] ${scenario.name} annotation fullscreen opened=${JSON.stringify(opened)}`)
  check(failures, opened.fullscreen && opened.routeExists && opened.routeVertices === 2 && opened.routeActive && opened.finishDisabled === false,
    `fullscreen must keep the unfinished annotation route: ${JSON.stringify(opened)}`)
  check(failures, opened.toolbarVisible && opened.entries.length === 1 && !opened.entries[0].inTransport,
    `fullscreen annotation must keep exactly one floating entry: ${JSON.stringify(opened.entries)}`)
  check(failures, opened.entryInsideRoot === true && opened.entryOverlapsToolbar === false && opened.surfaceOverflowsX === false && opened.pageOverflowsX === false,
    `fullscreen annotation entry must remain usable without horizontal overflow: ${JSON.stringify({ entry: opened.entries[0], toolbar: opened.toolbar, root: opened.root, surface: opened.annotationSurface, docScrollWidth: opened.docScrollWidth })}`)

  await tapFullscreen('exit')
  await page.waitFor(() => !document.fullscreenElement, { timeout: 5000, label: 'annotation fullscreen exited' })
  await delay(300)
  const restored = await snapshot()
  console.log(`[browser-interaction] ${scenario.name} annotation fullscreen restored=${JSON.stringify(restored)}`)
  check(failures, !restored.fullscreen && restored.routeExists && restored.routeVertices === 2 && restored.routeActive,
    `exiting fullscreen must keep the unfinished annotation route: ${JSON.stringify(restored)}`)
  check(failures, restored.entries.length === 1 && !restored.entries[0].inTransport,
    `exiting fullscreen must restore the annotation entry: ${JSON.stringify(restored.entries)}`)
  check(failures, restored.entryInsideRoot === true && restored.entryOverlapsToolbar === false && restored.surfaceOverflowsX === false && restored.pageOverflowsX === false,
    `exiting fullscreen must keep one reachable annotation entry without horizontal overflow: ${JSON.stringify({ entry: restored.entries[0], toolbar: restored.toolbar, root: restored.root, surface: restored.annotationSurface, docScrollWidth: restored.docScrollWidth })}`)
  check(failures, clicked(await clickElement(page, '[data-test="pb-annot-close"]')), 'marking mode must be closable after fullscreen')
  await delay(250)
  const closed = await page.evaluate(`(() => {
    const visible = (el) => !!el && el.getClientRects().length > 0
    const entries = [...document.querySelectorAll('[data-test="pb-fullscreen"]')].filter(visible)
    return {
      toolbar: visible(document.querySelector('[data-test="pb-annot-toolbar"]')),
      transport: visible(document.querySelector('[data-test="pb-transport-controls"]')),
      entries: entries.map((el) => ({ inTransport: !!el.closest('[data-test="pb-transport-controls"]') })),
      fullscreen: !!document.fullscreenElement,
    }
  })()`)
  check(failures, !closed.toolbar && closed.transport,
    `closing compact annotation must restore the transport controls: ${JSON.stringify(closed)}`)
  check(failures, closed.entries.length === 1 && closed.entries[0].inTransport && !closed.fullscreen,
    `closing compact annotation must restore exactly one inline fullscreen entry: ${JSON.stringify(closed)}`)
}

/**
 * 标注模式下的鼠标拖动：车辆层整体不接指针（hitbox / 名牌 tooltip 不能把父层的 none 顶掉），
 * 地图上按下拖动也不能变成浏览器的文本 / 图片选择（车辆标记被选中成蓝色色块）。
 */
async function checkAnnotationDrag(page, failures) {
  if (await page.evaluate(`!!document.querySelector('[data-test="pb-sb-close"]')`)) {
    await clickElement(page, '[data-test="pb-sb-close"]')
    await delay(200)
  }
  await clickElement(page, '[data-test="pb-annotation-entry"]')
  await delay(200)
  await clickElement(page, '[data-test="pb-annot-arrow"]')
  await delay(150)
  const from = await page.evaluate(`(() => {
    const map = document.querySelector('[data-test="pb-map"]').getBoundingClientRect()
    const inside = (r) => r.left > map.left + 4 && r.right < map.right - 4 && r.top > map.top + 4 && r.bottom < map.bottom - 4
    const marker = [...document.querySelectorAll('[data-test^="pb-marker-"]')].map((m) => m.getBoundingClientRect()).find(inside)
    return marker ? { x: marker.left + marker.width / 2, y: marker.top + marker.height / 2, map: { l: map.left, t: map.top, r: map.right, b: map.bottom } } : null
  })()`)
  check(failures, !!from, 'annotation drag: no vehicle marker inside the Stage to start a stroke on')
  if (!from) return
  const to = { x: Math.min(from.map.r - 8, Math.max(from.map.l + 8, from.x + 60)), y: Math.min(from.map.b - 8, Math.max(from.map.t + 8, from.y + 40)) }
  await dragPointer(page, from, to)
  const after = await page.evaluate(`(() => ({
    details: document.querySelectorAll('[data-test="pb-info"]').length,
    arrows: document.querySelectorAll('[data-test="pb-annotations"] line').length,
    selection: String(getSelection()).length > 0 || (getSelection().rangeCount > 0 && !getSelection().isCollapsed),
  }))()`)
  check(failures, after.arrows >= 1, `annotation drag starting on a vehicle must draw an arrow: ${JSON.stringify(after)}`)
  check(failures, after.details === 0, `annotation drag must not select the vehicle under the pointer: ${JSON.stringify(after)}`)
  check(failures, !after.selection, `annotation drag must not create a browser selection: ${JSON.stringify(after)}`)
  await clickElement(page, '[data-test="pb-annot-close"]')
  await delay(150)
}


return runWorkspace2DScenario
}
