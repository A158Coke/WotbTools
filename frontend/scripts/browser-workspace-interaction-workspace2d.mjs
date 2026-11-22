import { detailsPlacementPreserved } from '../src/utils/detailsPlacementBounds.ts'
import { OCCLUSION_LIMITS, measureOcclusion } from './browser-occlusion.mjs'
import { join } from 'node:path'
import { closePageTarget, captureMobileReview, Page, check, clickElement, clicked, delay, results, setLastPage } from './browser-workspace-interaction-core.mjs'
import { checkAnnotationDrag, checkAnnotationMode, checkDisplaySurface, checkPlaybackDeclutter, dragDetailsTo, hudStressProbe, setRosterVisible, workspace2dProbe } from './browser-workspace-interaction-probes-b.mjs'

export const WORKSPACE_2D_SCENARIOS = [
  { name: 'ws2d-375x812-portrait-coarse', width: 375, height: 812, touch: true, layout: 'portrait' },
  { name: 'ws2d-390x844-portrait-coarse', width: 390, height: 844, touch: true, layout: 'portrait' },
  // 手机横屏：地图是主角。minMap = 地图边长下限（由 740×360 基线 96px + 产品目标推出：
  // 外壳让出 104px、传输条合成一行、HUD 一行后的预算，留 ~6% 余量）。
  { name: 'ws2d-600x320-landscape-coarse', width: 600, height: 320, touch: true, layout: 'lanes', minMap: 170 },
  { name: 'ws2d-667x375-landscape-coarse', width: 667, height: 375, touch: true, layout: 'lanes', minMap: 270 },
  // 紧凑 HUD 宽度竞争：非空四基地 + 完整 5 位 HP 数字 + 超长地图名；mixed 再加 PARTIAL/UNKNOWN。
  { name: 'ws2d-667x375-hud-exact', width: 667, height: 375, touch: true, layout: 'lanes', minMap: 270, hudStress: 'exact' },
  { name: 'ws2d-740x360-hud-mixed', width: 740, height: 360, touch: true, layout: 'lanes', minMap: 260, hudStress: 'mixed' },
  { name: 'ws2d-844x390-hud-exact', width: 844, height: 390, touch: true, layout: 'lanes', minMap: 290, hudStress: 'exact' },
  { name: 'ws2d-740x360-landscape-coarse', width: 740, height: 360, touch: true, layout: 'lanes', minMap: 260 },
  { name: 'ws2d-740x360-fullscreen-coarse', width: 740, height: 360, touch: true, layout: 'lanes', fullscreen: true, minMap: 260 },
  { name: 'ws2d-844x390-landscape-coarse', width: 844, height: 390, touch: true, layout: 'lanes', minMap: 290 },
  { name: 'ws2d-844x390-annotation-fullscreen', width: 844, height: 390, touch: true, layout: 'lanes', minMap: 290, annotationFullscreen: true },
  { name: 'ws2d-844x390-landscape-recorder-team2', width: 844, height: 390, touch: true, layout: 'lanes', recorder: 2, minMap: 290 },
  { name: 'ws2d-844x390-fullscreen-coarse', width: 844, height: 390, touch: true, layout: 'lanes', fullscreen: true, minMap: 290 },
  { name: 'ws2d-1024x768-tablet', width: 1024, height: 768, touch: false, layout: 'lanes' },
  // 1280 宽桌面：侧边车道（≈320）比详情浮窗（340）窄——初始落位必须收窄浮窗，而不是伸进中心栏盖住 HUD
  { name: 'ws2d-1280x720-desktop', width: 1280, height: 720, touch: false, layout: 'lanes' },
  { name: 'ws2d-1280x800-desktop', width: 1280, height: 800, touch: false, layout: 'lanes' },
  { name: 'ws2d-1600x900-desktop', width: 1600, height: 900, touch: false, layout: 'lanes' },
  { name: 'ws2d-1792x922-fullscreen-desktop', width: 1792, height: 922, touch: false, layout: 'lanes', fullscreen: true },
]

/** workspace 几何探针（只读）。 */
export async function runWorkspace2DScenario(env, scenario) {
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
    await closePageTarget(env.chrome, targetId)
    return result()
  }

  // ---- 三段式 ----
  check(failures, g.rootClass.includes('pb-roster-lanes'), `expected Team 1 | Stage | Team 2 lanes (class=${g.rootClass})`)
  check(failures, !!g.left && !!g.right, 'both physical lanes must be visible without opening any menu')
  if (!g.left || !g.right || !g.map) {
    await closePageTarget(env.chrome, targetId)
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
  await closePageTarget(env.chrome, targetId)
  result()
}

