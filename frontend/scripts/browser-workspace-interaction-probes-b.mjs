import { measurePaintOrder, measureReachability } from './browser-occlusion.mjs'
import { join } from 'node:path'
import { captureMobileReview, check, clickCenterExpression, clickElement, clicked, delay, dragPointer } from './browser-workspace-interaction-core.mjs'
import { waitForStableLayout } from './browser-workspace-interaction-probes-a.mjs'

export function workspace2dProbe(touch = false) {
  const box = (el) => {
    if (!el || !el.getClientRects().length) return null
    const r = el.getBoundingClientRect()
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }
  }
  const root = document.querySelector('[data-test="battle-playback"]')
  const main = document.querySelector('[data-test="pb-main"]')
  const lane = (side) => {
    const el = document.querySelector(`[data-test="pb-team-lane-${side}"]`)
    if (!el) return null
    const rows = [...el.querySelectorAll('[data-test="pb-roster-row"]')]
    return {
      box: box(el),
      ids: rows.map((row) => Number(row.dataset.accountId)),
      scrolls: el.scrollHeight > el.clientHeight + 1,
      dbg: { sh: el.scrollHeight, ch: el.clientHeight, before: getComputedStyle(el, "::before").content, rows: [...el.querySelectorAll("[data-test=pb-roster-row]")].map(r => Math.round(r.getBoundingClientRect().height)).join(",") },
      scrollsX: el.scrollWidth > el.clientWidth + 1,
      rowsFit: rows.every((row) => {
        const rowBox = row.getBoundingClientRect()
        const laneBox = el.getBoundingClientRect()
        const hpBox = row.querySelector('[data-test="roster-hp"]')?.getBoundingClientRect()
        return rowBox.left >= laneBox.left - 1 && rowBox.right <= laneBox.right + 1
          && hpBox && hpBox.left >= rowBox.left && hpBox.right <= rowBox.right + 1
          && ['pb-roster-player', 'pb-roster-tank'].every(test =>
            row.querySelector(`[data-test="${test}"]`)?.getBoundingClientRect().width > 1)
      }),
      rowsComplete: rows.every((row) => {
        const bar = row.querySelector('[data-test="roster-hp"]')
        return ['pb-roster-player', 'pb-roster-tank']
          .every((test) => (row.querySelector(`[data-test="${test}"]`)?.textContent || '').trim().length > 0)
          && !!bar && (bar.getAttribute('aria-label') || '').trim().length > 0
      }),
      hpBar: !!el.querySelector('[data-test="roster-hp"]'),
    }
  }
  const buttons = [...document.querySelectorAll('.pb-controls > .pb-btn, .pb-controls > * > .pb-btn, .pb-controls .pb-btn')]
    .filter((b) => b.getClientRects().length && !b.closest('.pb-speed-menu'))
  // 手机横屏：全屏入口内联在传输条（右上浮动按钮已移除），与桌面同一组 6 个主控件。
  // 手机竖屏仍保留 HUD 右上角的浮动全屏入口（不压纵向流的名单），传输条只有 5 个主控件。
  // touch 由调用方经 page.callWith 显式传入（probe 在页面内执行，无 Node 闭包）。
  const phoneLandscape = !!root?.classList.contains('pb-phone-landscape')
  const primaryIds = touch && !phoneLandscape
    ? ['pb-back5', 'pb-play', 'pb-fwd5', 'pb-speed-current', 'pb-secondary-entry']
    : ['pb-back5', 'pb-play', 'pb-fwd5', 'pb-speed-current', 'pb-fullscreen', 'pb-secondary-entry']
  const primary = primaryIds
    .map((test) => box(document.querySelector(`.pb-controls [data-test="${test}"]`)))
  // 视觉盒仍是 36px：用真实命中测试验证伪元素把可点范围扩到 ≥40×40（不读 token 代替）。
  const primaryHitAreas = primaryIds.map((test, index) => {
    const el = document.querySelector(`.pb-controls [data-test="${test}"]`)
    const b = primary[index]
    if (!el || !b) return { test, missing: true }
    const hit = (x, y) => { const target = document.elementFromPoint(x, y); return target === el || el.contains(target) }
    const cx = b.l + b.w / 2, cy = b.t + b.h / 2
    return {
      test, center: hit(cx, cy), top: hit(cx, b.t - 1.5), bottom: hit(cx, b.b + 1.5),
      left: hit(b.l - 1.5, cy), right: hit(b.r + 1.5, cy), visualHeight: b.h, visualWidth: b.w,
    }
  })
  const scene = document.querySelector('[data-scene-surface]')
  const sceneStyle = getComputedStyle(scene || document.documentElement)
  const token = (name) => parseFloat(sceneStyle.getPropertyValue(name)) || null
  const details = document.querySelector('[data-test="pb-info"]')
  const transport = document.querySelector('[data-test="pb-transport-slot"]')
  const inline = document.querySelector('[data-test="pb-inline-area"]')
  return {
    width: innerWidth,
    height: innerHeight,
    fullscreen: !!document.fullscreenElement,
    rootClass: root?.className || '',
    phoneLandscape,
    primaryIds,
    hud: box(document.querySelector('.pb-hud')),
    pageOverflowX: document.documentElement.scrollWidth > innerWidth + 1,
    main: box(main),
    mainPadding: main ? {
      left: parseFloat(getComputedStyle(main).paddingLeft) || 0,
      right: parseFloat(getComputedStyle(main).paddingRight) || 0,
      top: parseFloat(getComputedStyle(main).paddingTop) || 0,
    } : null,
    map: box(document.querySelector('[data-test="pb-map"]')),
    transport: box(transport),
    left: lane('left'),
    right: lane('right'),
    inline: box(inline),
    inlineRosterIds: inline ? [...inline.querySelectorAll('[data-test="pb-roster-row"]')].map((r) => Number(r.dataset.accountId)) : [],
    inlineHasDetails: !!inline?.querySelector('[data-test="pb-info"]'),
    details: box(details),
    detailsCount: document.querySelectorAll('[data-test="pb-info"]').length,
    detailsParentIsMain: !!details && details.parentElement === main,
    detailsPresentation: details?.dataset.presentation || null,
    detailsPlayer: document.querySelector('[data-test="pb-sb-player"]')?.textContent?.trim() || null,
    selectedIds: [...document.querySelectorAll('[data-test="pb-roster-row"][aria-pressed="true"]')].map((r) => Number(r.dataset.accountId)),
    time: document.querySelector('[data-test="pb-time"]')?.textContent?.trim() || null,
    friendlyHp: document.querySelector('[data-test="pb-hp-value-friendly"]')?.textContent?.trim() || null,
    primaryTops: primary.map((b) => (b ? Math.round(b.t) : null)),
    primaryBoxes: primary,
    primaryOrder: [...document.querySelectorAll('.pb-controls button[data-test]')].map((b) => b.dataset.test)
      .filter((id) => primaryIds.includes(id)),
    fullscreenInline: (() => {
      const inlineFs = document.querySelector('.pb-controls [data-test="pb-fullscreen"]')
      return !!inlineFs && inlineFs.getClientRects().length > 0
    })(),
    fullscreenCount: document.querySelectorAll('[data-test="pb-fullscreen"]').length,
    primaryMinSide: Math.min(...primary.filter(Boolean).map((b) => Math.min(b.w, b.h))),
    primaryHitAreas,
    tokens: {
      coarse: matchMedia('(pointer: coarse)').matches,
      compact: matchMedia('(pointer: coarse) and (orientation: landscape) and (height <= 520px)').matches,
      controlMd: token('--control-h-md'), hitComfortable: token('--hit-min-comfortable'), space2: token('--space-2'),
    },
    buttonCount: buttons.length,
    layout: ['.battle-playback', '.pb-hud', '.pb-main', '.pb-map-stage', '.pb-map', '.pb-transport-slot', '.pb-mobile-overlay', '.pb-mobile-overlay-content', '.pb-team-lane-left', '[data-test="pb-roster-row"]'].map((selector) => {
      const element = document.querySelector(selector)
      if (!element) return { selector }
      const style = getComputedStyle(element)
      return { selector, box: box(element), rows: style.gridTemplateRows, columns: style.gridTemplateColumns,
        gridRow: style.gridRow, position: style.position, display: style.display, flex: style.flex,
        padding: style.padding, margin: style.margin, border: style.borderWidth, gap: style.gap, minHeight: style.minHeight, maxHeight: style.maxHeight,
        scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, classes: element.className,
        squareAvailable: style.getPropertyValue('--pb-square-avail-h'), workspaceHeight: style.getPropertyValue('--pb-workspace-h') }
    }),
  }
}

/**
 * 紧凑 HUD 的宽度竞争探针：把地图名换成超长串后，量实际轨道/数字/中列的几何。
 * 只读 + 一次 DOM 文本注入，不依赖 fixture 为某个设备硬编码 HUD 宽度。
 */
export function hudStressProbe(longTitle = false) {
  const box = (el) => {
    if (!el || !el.getClientRects().length) return null
    const r = el.getBoundingClientRect()
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }
  }
  const hud = document.querySelector('[data-test="pb-hud"]')
  if (!hud) return { missing: true }
  const map = hud.querySelector('[data-test="pb-hud-map"]')
  if (longTitle && map) {
    map.textContent = '异常长的地图名称用于验证截断优先级与完整战斗数据'
    void hud.offsetWidth
  }
  const center = hud.querySelector('[data-test="pb-hud-center"]')
  const teams = [...hud.querySelectorAll('[data-test="pb-hud-friendly"], [data-test="pb-hud-enemy"]')]
  const tracks = teams.map((el) => el.querySelector('.pb-hp-track'))
  const values = teams.map((el) => el.querySelector('.pb-hp-value'))
  const valueTextWidth = (el) => {
    if (!el) return 0
    const range = document.createRange()
    range.selectNodeContents(el)
    return range.getBoundingClientRect().width
  }
  const rects = { hud: box(hud), map: box(map), center: box(center), friendly: box(teams[0]), enemy: box(teams[1]) }
  const overlaps = (a, b) => !!a && !!b && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5
  return {
    missing: false,
    width: hud.getBoundingClientRect().width,
    height: hud.getBoundingClientRect().height,
    tracks: tracks.map((el) => (el ? el.getBoundingClientRect().width : 0)),
    values: values.map((el) => (el ? el.textContent.trim() : '')),
    valueWidths: values.map((el) => (el ? el.getBoundingClientRect().width : 0)),
    valueTextWidths: values.map(valueTextWidth),
    baseCount: hud.querySelectorAll('[data-testid^="base-badge-"]').length,
    clock: hud.querySelector('[data-test="pb-hud-time"]')?.textContent?.trim() || '',
    score: hud.querySelector('[data-test="pb-hud-score"]')?.textContent?.trim() || '',
    title: map ? {
      text: map.textContent.trim(),
      width: map.getBoundingClientRect().width,
      scrollWidth: map.scrollWidth,
      overflow: getComputedStyle(map).overflow,
      textOverflow: getComputedStyle(map).textOverflow,
    } : null,
    rects,
    centerOverlapsTeam: overlaps(rects.center, rects.friendly) || overlaps(rects.center, rects.enemy),
    valueOverlapsCenter: overlaps(box(values[0]), rects.center) || overlaps(box(values[1]), rects.center),
    hudOverflowX: hud.scrollWidth > hud.clientWidth + 1,
    hudScrollWidth: hud.scrollWidth,
    hudClientWidth: hud.clientWidth,
    centerOverflowX: center ? center.scrollWidth > center.clientWidth + 1 : false,
  }
}


export async function dragDetailsTo(page, targetCenterX, touch = false) {
  const handle = await page.evaluate(`(() => {
    const h = document.querySelector('[data-test="pb-sb-drag"]')
    if (!h) return null
    // 矮横屏的页面里 workspace 可能有一截在首屏外：先像用户一样把拖动柄滚进视口。
    h.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = h.getBoundingClientRect()
    const panel = document.querySelector('[data-test="pb-info"]').getBoundingClientRect()
    return { x: r.left + 12, y: r.top + r.height / 2, panelCenter: panel.left + panel.width / 2, room: innerHeight - (r.top + r.height / 2) - 4 }
  })()`)
  if (!handle) return false
  // 向下拖到底（夹紧会把它停在传输控件之上）；指针本身不离开视口，否则移动事件会被丢掉。
  await dragPointer(page, handle, { x: handle.x + (targetCenterX - handle.panelCenter), y: handle.y + Math.max(0, handle.room) }, { touch })
  return true
}

export async function setRosterVisible(page, visible) {
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
export async function checkDisplaySurface(page, failures, layout, scenario) {
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

export async function checkPlaybackDeclutter(page, failures, scenario) {
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

export async function checkAnnotationMode(page, failures, scenario) {
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
export async function checkCompactAnnotationFullscreen(page, failures, scenario) {
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
export async function checkAnnotationDrag(page, failures) {
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

