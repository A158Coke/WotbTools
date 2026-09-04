// Source-level regression: Battle Playback fullscreen must turn the whole
// 100vw×100vh into a 3-column stage — Left Rail | Map Workspace | Persistent
// Right Details — with HUD as a top overlay and controls/timeline as a bottom
// overlay confined to the Map Workspace (right edge stops at the Details column).
// NOT a 3-row grid that compresses the map, and NOT Details as an overlay
// covering the map. Vitest does not execute global CSS layout, so the layout
// contract is asserted against the stylesheet source (same pattern as
// classic-theme-source-regression.test.js / classic-profile-css.test.js).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (name) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
// 布局分散在多个形态文件里（见 playback-mobile.css 头部说明）。契约断言针对「最终
// 生效的那套样式」，所以按 main.js 的 import 顺序拼起来读——顺序即层叠顺序。
const SHEETS = ['./playback-responsive.css', './playback-mobile.css']
const css = SHEETS.map(read).join('\n')
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')

const rules = stripped.split(/}/).filter((chunk) => chunk.includes('{'))
// 取最后一个 '{' 之前的部分作为选择器头：这样嵌在 @media 里的规则也能命中。
// 再按 ',' 拆开，逗号分组里的任一条命中即可。
function selectorsOf(chunk) {
  const head = chunk.slice(0, chunk.lastIndexOf('{'))
  const own = head.slice(head.lastIndexOf('{') + 1)
  return own.split(',').map((part) => part.trim()).filter(Boolean)
}
function ruleBody(selector) {
  const chunk = rules.find((c) => selectorsOf(c).includes(selector))
  return chunk ? chunk.slice(chunk.lastIndexOf('{') + 1).trim() : null
}

// §three-forms 守卫：形态文件里每一条选择器都必须带自己的形态前缀。
// 这条约束把「一档的规则打穿另一档」变成结构上不可能——而不是靠人记得加限定。
// 迁移完成后 pc / tablet 各自加同样的一条。
function selectorsIn(source) {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  for (const chunk of noComments.split('}')) {
    if (!chunk.includes('{')) continue
    const head = chunk.slice(0, chunk.lastIndexOf('{'))
    const own = head.slice(head.lastIndexOf('{') + 1).trim()
    if (!own || own.startsWith('@')) continue
    for (const part of own.split(',')) {
      const sel = part.trim()
      if (sel) out.push(sel)
    }
  }
  return out
}

describe('Battle Playback form-scoped stylesheets', () => {
  it('scopes every mobile rule to .pb-form-mobile', () => {
    const selectors = selectorsIn(read('./playback-mobile.css'))
    expect(selectors.length).toBeGreaterThan(20)
    const leaked = selectors.filter((sel) => !sel.includes('.pb-form-mobile'))
    expect(leaked).toEqual([])
  })

  it('keeps the mobile layout out of the shared sheet', () => {
    expect(read('./playback-responsive.css')).not.toContain('.pb-form-mobile')
  })
})

describe('Battle Playback fullscreen layout (source regression)', () => {
  it('fullscreen root is the whole viewport, no page frame, no 3-row grid', () => {
    const body = ruleBody('.battle-playback:fullscreen')
    expect(body).not.toBeNull()
    expect(body).toContain('width: 100vw')
    expect(body).toContain('height: 100vh')
    expect(body).toContain('overflow: hidden')
    expect(body).toContain('padding: 0')
    expect(body).toContain('grid-template-columns: var(--pb-left-col) minmax(0, 1fr)')
    expect(body).not.toContain('grid-template-rows')
  })

  // §float-panels：桌面 fullscreen 下地图占满整宽，Left Rail / Right Details 浮在
  // 方图两侧必然出现的黑边上。视口不够宽时它们会盖住地图外缘，所以必须半透明。
  it('desktop fullscreen gives the map the full width and floats the panels', () => {
    // 护栏：黑边放得下面板时才浮，否则回落三列（大平板横屏 / 窄桌面窗口）。
    expect(stripped).toContain('@media (min-width: 1600px) and (min-aspect-ratio: 3/2)')
    const shell = ruleBody('.battle-playback:fullscreen:not(.pb-device-mobile)')
    expect(shell).toContain('grid-template-columns: minmax(0, 1fr)')

    const rail = ruleBody('.battle-playback:fullscreen:not(.pb-device-mobile) .pb-left-rail')
    expect(rail).toContain('position: absolute')
    expect(rail).toContain('left: 0')
    expect(rail).toContain('width: var(--pb-left-col)')
    expect(rail).toContain('backdrop-filter')

    const details = ruleBody('.battle-playback:fullscreen:not(.pb-device-mobile) .pb-map-stage > .pb-side-panel-shell')
    expect(details).toContain('position: absolute')
    expect(details).toContain('right: 0')
    expect(details).toContain('width: var(--pb-details-w)')
    expect(details).toContain('backdrop-filter')

    // map-stage 不再为 Right Details 保留一列
    const stage = ruleBody('.battle-playback:fullscreen:not(.pb-device-mobile) .pb-map-stage')
    expect(stage).toContain('grid-template-columns: minmax(0, 1fr)')
  })

  // 手机非全屏：左栏排到地图下方（order），右侧详情是从右滑入的窗口而不是底部 sheet。
  it('puts the mobile rail under the map and slides the details in from the right', () => {
    const main = ruleBody('.battle-playback:not(:fullscreen).pb-form-mobile .pb-main')
    expect(main).toContain('order: 1')
    const rail = ruleBody('.battle-playback:not(:fullscreen).pb-form-mobile.pb-drawer-open .pb-left-rail')
    expect(rail).toContain('order: 2')
    expect(rail).toContain('position: static')

    // 横屏：右侧滑入的窗口（不贴左边、不满宽）
    const details = ruleBody('.battle-playback:not(:fullscreen).pb-form-mobile .pb-map-stage > .pb-side-panel-shell .pb-side-panel')
    expect(details).toContain('position: fixed')
    expect(details).toContain('right: 8px')
    expect(details).toContain('left: auto')
    expect(details).toContain('animation: pb-details-slide-in')
    expect(stripped).toContain('@keyframes pb-details-slide-in')

    // 竖屏：~400px 宽的屏上右侧窗口等于满屏，会盖住地图，因此改为从底部滑上来的 sheet，
    // 地图始终留在上方可见。
    expect(stripped).toContain('@media (orientation: portrait)')
    expect(stripped).toContain('@keyframes pb-details-slide-up')
    const portrait = stripped.slice(stripped.indexOf('@media (orientation: portrait)'))
    expect(portrait).toContain('max-height: min(58dvh, 480px)')
    expect(portrait).toContain('animation: pb-details-slide-up')
  })

  // 非全屏窄视口：两侧面板都排进正常文档流，不做浮层弹窗/抽屉。
  it('keeps the side panes inline outside fullscreen instead of floating them', () => {
    const details = ruleBody('.battle-playback .pb-map-stage > .pb-side-panel-shell')
    // relative（不是 absolute）：在流内参与布局，同时作为拖拽把手的定位基准。
    expect(details).toContain('position: relative')
    expect(details).not.toContain('position: absolute')

    const detailsPanel = ruleBody('.battle-playback .pb-map-stage > .pb-side-panel-shell .pb-side-panel')
    expect(detailsPanel).toContain('max-height: none')
    expect(detailsPanel).toContain('box-shadow: none')

    const rail = ruleBody('.battle-playback:not(.pb-device-mobile):not(:fullscreen).pb-drawer-open .pb-left-rail')
    expect(rail).toContain('position: static')
    const backdrop = ruleBody('.battle-playback:not(.pb-device-mobile):not(:fullscreen) .pb-drawer-backdrop')
    expect(backdrop).toContain('display: none')
  })

  // §rail-collapse：全屏下左栏可收起成窄条。绝不能收成 0 宽——重新展开的入口
  // 必须有地方放，放到地图上会违反「地图上不能有任何东西」。
  it('collapses the fullscreen rail to a strip that still holds the re-open control', () => {
    const collapsed = ruleBody('.battle-playback.pb-rail-collapsed')
    expect(collapsed).toContain('--pb-left-col: var(--pb-rail-collapsed-w)')
    const w = /--pb-rail-collapsed-w:\s*(\d+)px/.exec(ruleBody('.battle-playback'))
    expect(w).not.toBeNull()
    expect(Number(w[1])).toBeGreaterThanOrEqual(32)

    // 同特异性 (0,2,0)，靠源码顺序决出胜负：收起态必须写在二级展开之后。
    expect(stripped.indexOf('.battle-playback.pb-rail-collapsed'))
      .toBeGreaterThan(stripped.indexOf('.battle-playback.pb-rail-expanded'))

    expect(ruleBody('.battle-playback.pb-rail-collapsed .pb-rail-body')).toContain('display: none')
    // 开关只在左栏是常驻列（fullscreen）时出现；非全屏左栏已排到地图下方。
    expect(ruleBody('.battle-playback .pb-rail-collapse')).toContain('display: none')
    expect(ruleBody('.battle-playback:fullscreen .pb-rail-collapse')).toContain('display: flex')
  })

  // §side-slots：横屏全屏且两侧黑边够宽时，HUD/controls 改放两侧黑边，地图吃满高度。
  // 竖屏或黑边不够时不生效（放下面）。判定用真实像素（JS 的 sideSlotWidth），
  // 不是宽高比——宽高比推不出黑边有多少像素。
  it('parks the HUD and controls in the side gutters when they fit there', () => {
    const hud = ruleBody('.battle-playback:fullscreen.pb-side-slots .pb-hud')
    expect(hud).toContain('right: 0')
    expect(hud).toContain('left: auto')
    expect(hud).toContain('top: 0')
    expect(hud).toContain('bottom: 0')
    expect(hud).toContain('width: var(--pb-slot-w)')

    const controls = ruleBody('.battle-playback:fullscreen.pb-side-slots .pb-mobile-overlay')
    expect(controls).toContain('left: 0')
    expect(controls).toContain('right: auto')
    expect(controls).toContain('top: 0')
    expect(controls).toContain('bottom: 0')
    expect(controls).toContain('width: var(--pb-slot-w)')

    // 窄高的侧栏里 HUD 必须竖排单列、controls 必须竖排
    expect(ruleBody('.battle-playback:fullscreen.pb-side-slots .pb-hud-grid'))
      .toContain('grid-template-columns: minmax(0, 1fr)')
    expect(ruleBody('.battle-playback:fullscreen.pb-side-slots .pb-controls'))
      .toContain('flex-direction: column')
  })

  // rail 同时承载图标导航与播放控制，60px 放不下速度档位那一排。
  it('the Left Rail is wide enough to hold the playback controls', () => {
    const body = ruleBody('.battle-playback')
    const width = /--pb-rail-w:\s*(\d+)px/.exec(body)
    expect(width).not.toBeNull()
    expect(Number(width[1])).toBeGreaterThanOrEqual(180)
  })

  it('pb-main is the map-workspace column (grid col 2) and pb-map-stage fills it', () => {
    const main = ruleBody('.battle-playback:fullscreen .pb-main')
    expect(main).toContain('grid-column: 2')
    expect(main).toContain('position: relative')
    const stage = ruleBody('.battle-playback:fullscreen .pb-map-stage')
    expect(stage).toContain('position: absolute')
    expect(stage).toContain('inset: 0')
    expect(stage).toContain('overflow: hidden')
  })

  it('Left Rail is fullscreen-only left column; Right Details is a persistent column (not an overlay)', () => {
    expect(ruleBody('.battle-playback .pb-left-rail')).toContain('display: none')
    const rail = ruleBody('.battle-playback:fullscreen .pb-left-rail')
    expect(rail).toContain('grid-column: 1')
    expect(rail).toContain('display: flex')
    expect(ruleBody('.battle-playback .pb-rail-btn')).toContain('cursor: pointer')
    // fullscreen 下隐藏旧右上角 tab launcher（Left Rail 是唯一入口）
    expect(ruleBody('.battle-playback:fullscreen .pb-map-stage > .pb-side-panel-shell .pb-panel-launcher')).toContain('display: none')
    // §3 真三列：Right Details 是 map-stage grid 的 persistent col2 列（非绝对 overlay 覆盖地图）
    const shell = ruleBody('.battle-playback:fullscreen .pb-map-stage > .pb-side-panel-shell')
    expect(shell).toContain('position: static')
    expect(shell).toContain('grid-column: 2')
    const panel = ruleBody('.battle-playback:fullscreen .pb-map-stage > .pb-side-panel-shell .pb-side-panel')
    expect(panel).toContain('position: static')
    // 面板跟着列高走：内容短时被 shell 垂直居中，内容超过列高才填满并内部滚动。
    // 不能是 flex: 1 1 auto——那会强行撑满并把短内容顶到列顶。
    expect(panel).toContain('flex: 0 1 auto')
    expect(panel).toContain('max-height: 100%')
    expect(panel).toContain('overflow-y: auto')
    expect(shell).toContain('justify-content: center')
  })

  it('HUD is a top overlay covering only the Map Workspace (stops at the Details column)', () => {
    const body = ruleBody('.battle-playback:fullscreen .pb-hud')
    expect(body).toContain('position: absolute')
    expect(body).toContain('top: 0')
    expect(body).toContain('left: var(--pb-left-col)')
    expect(body).toContain('right: var(--pb-details-w)')
    expect(body).toContain('z-index: 50')
  })

  it('controls + timeline are a bottom overlay over the Map Workspace (stops at the Details column)', () => {
    const body = ruleBody('.battle-playback:fullscreen .pb-mobile-overlay')
    expect(body).toContain('position: absolute')
    expect(body).toContain('bottom: 0')
    // overlay 是 .pb-main（col2）的子元素，left 从 col2 左缘起算；再加 --pb-left-col 会重复偏移。
    expect(body).toContain('left: 0')
    expect(body).not.toContain('left: var(--pb-left-col)')
    expect(body).toContain('right: var(--pb-details-w)')
    expect(body).toContain('z-index: 40')
    expect(body).toContain('pointer-events: auto')
  })

  it('map workspace is a true 2-column grid (Map | Persistent Details)', () => {
    const stage = ruleBody('.battle-playback:fullscreen .pb-map-stage')
    expect(stage).toContain('display: grid')
    expect(stage).toContain('grid-template-columns: minmax(0, 1fr) var(--pb-details-w)')
    const map = ruleBody('.battle-playback:fullscreen .pb-main .pb-map')
    expect(map).toContain('grid-column: 1')
  })

  // 标注工具栏排在地图下方的流内容器里，展开时把页面顶开而不是向上长着盖住地图。
  // 任何 absolute/bottom 锚定都会让它重新浮回地图上。
  it('annotation toolbar is in flow, never an overlay anchored over the map', () => {
    const surface = ruleBody('.battle-playback .pb-annotation-surface')
    expect(surface).not.toBeNull()
    expect(surface).not.toContain('position: absolute')
    expect(surface).not.toContain('bottom:')
    expect(surface).not.toContain('z-index')
    // 全屏走左栏二级菜单，不该再有任何 fullscreen 浮层偏移残留
    expect(ruleBody('.battle-playback:fullscreen .pb-annotation-surface')).toBeNull()
  })

  // 地图上只允许短暂的事件播报。横屏提示是进入全屏时 orientation.lock 失败的兜底 toast，
  // 不是事件播报，所以整条被删除（自动转横屏本身保留）。
  it('no orientation hint element or style survives anywhere', () => {
    expect(css).not.toContain('pb-orientation-hint')
  })

  it('map keeps its canonical aspect — cover-fill, no non-uniform X/Y stretch', () => {
    const map = ruleBody('.battle-playback:fullscreen .pb-main .pb-map')
    expect(map).toContain('width: 100%')
    expect(map).toContain('max-width: none')
    // SVG stays aspect-preserving (height:auto) so the raster geometry is never
    // distorted by a non-aspect container box.
    expect(ruleBody('.battle-playback:fullscreen .pb-main .pb-map .pb-svg')).toContain('height: auto')
  })

  it('exits fullscreen back to the normal page layout (no fullscreen-only absolute on the base)', () => {
    const base = ruleBody('.battle-playback')
    expect(base).toContain('display: flex')
    expect(base).toContain('flex-direction: column')
    expect(base).not.toContain('width: 100vw')
    expect(base).not.toContain('position: absolute')
  })

  it('cover-fill sizing: the map fills the workspace width and never force-contains to a viewport ratio', () => {
    // §3 cover-fill：地图填满 Map Workspace 宽度（width:100%），高度按 canonical aspect 推导，
    // 允许高于视口（裁切可被 pan/viewport 到达），绝不横向拉伸成 viewport 比例。这也是对
    // 「旧 contain 假几何回归」的替换——真实几何由 battlePlayback.test.js 的 clampViewPan /
    // mapRenderRect 宽视口回归覆盖。
    const map = ruleBody('.battle-playback:fullscreen .pb-main .pb-map')
    expect(map).toContain('width: 100%')
    expect(map).toContain('max-width: none')
    expect(map).not.toContain('aspect-ratio')
    // the stage clips (overflow hidden) so cover can legally extend beyond the viewport.
    expect(ruleBody('.battle-playback:fullscreen .pb-map-stage')).toContain('overflow: hidden')
  })

  it('Fix2 widths: Left Rail 列是独立 token（不复用 --pb-details-w）；Right Details 单独 ~340px', () => {
    const base = ruleBody('.battle-playback')
    expect(base).toContain('--pb-panel-w: 300px')
    // fullscreen grid col1 用 --pb-left-col（collapsed rail 60px / 展开 panel 300px），而非 --pb-details-w
    const fs = ruleBody('.battle-playback:fullscreen')
    expect(fs).toContain('grid-template-columns: var(--pb-left-col) minmax(0, 1fr)')
    expect(fs).not.toContain('grid-template-columns: var(--pb-details-w)')
    // Right Details 是 map-stage 的独立 col2（--pb-details-w）
    const stage = ruleBody('.battle-playback:fullscreen .pb-map-stage')
    expect(stage).toContain('grid-template-columns: minmax(0, 1fr) var(--pb-details-w)')
  })

  // 两侧把手必须对称：两栏都有 overflow 裁剪，负偏移会让一侧的握柄落在栏外被裁掉，
  // 于是「左边有右边没有」。显示时也必须保持 flex，block 会让握柄不再居中。
  it('shows the resize handle on both panes symmetrically', () => {
    expect(ruleBody('.battle-playback .pb-pane-resizer-rail')).toContain('right: 0')
    expect(ruleBody('.battle-playback .pb-pane-resizer-details')).toContain('left: 0')

    const base = ruleBody('.battle-playback .pb-pane-resizer')
    expect(base).toContain('display: flex')
    expect(base).toContain('justify-content: center')

    for (const sel of [
      '.battle-playback:fullscreen:not(.pb-device-mobile) .pb-left-rail .pb-pane-resizer',
      '.battle-playback:fullscreen:not(.pb-device-mobile) .pb-map-stage > .pb-side-panel-shell .pb-pane-resizer',
      '.battle-playback:not(:fullscreen) .pb-left-rail .pb-pane-resizer',
      '.battle-playback:not(:fullscreen) .pb-map-stage > .pb-side-panel-shell .pb-pane-resizer',
    ]) {
      expect(ruleBody(sel)).toContain('display: flex')
    }
  })

  // 车辆详情是 .pb-sidebar，标签面板是 .pb-side-panel——两个不同元素都挂在 shell 下。
  // 手机抽屉形态曾经只写给 .pb-side-panel，结果车辆详情完全没被改到。
  it('gives the mobile drawer treatment to the details element itself', () => {
    // 抽屉形态只属于全屏——全屏地图占满屏幕，没有「地图下方」可用。非全屏一律排进流里。
    // 以前这条没写 :fullscreen，(0,6,0) 压过宽度键控的流内规则 (0,5,0)，手机上详情
    // 始终是盖在地图上的 sheet，违反「地图上不能有任何东西」。
    const sheet = ruleBody('.battle-playback:fullscreen.pb-form-mobile .pb-map-stage > .pb-side-panel-shell.pb-details-active .pb-sidebar')
    expect(sheet).not.toBeNull()
    expect(sheet).toContain('animation: pb-details-slide-up')
    expect(css).not.toContain('.battle-playback.pb-form-mobile .pb-map-stage > .pb-side-panel-shell')

    // 流内还不够：详情内容能到 ~650px（战斗装载那几组），不封顶就把地图整个顶出视口，
    // 形式上没盖住地图、实际效果一样。手机上必须像标注工具栏那样是一块有界区块。
    // 该选择器在 <1200px 与 <768px 两个 media 块里都出现，ruleBody 只返回第一处，
    // 所以这里显式切到 768 块再断言。
    const phoneBlock = stripped.slice(stripped.lastIndexOf('@media (width < 768px)'))
    const capped = phoneBlock.slice(phoneBlock.indexOf('.pb-side-panel-shell.pb-details-active .pb-sidebar'))
    const cappedBody = capped.slice(capped.indexOf('{') + 1, capped.indexOf('}'))
    expect(cappedBody).toContain('max-height: min(46dvh, 380px)')
    expect(cappedBody).toContain('overflow-y: auto')

    // §no-overlay：没有持久列的宽度区间（<1200px 非全屏）没有黑边可用，详情必须排进流里。
    // 按宽度而不是设备类判定——.pb-form-mobile 要求 pointer: coarse，窄的桌面窗口拿不到。
    const inflow = ruleBody('.battle-playback:not(:fullscreen) .pb-map-stage > .pb-side-panel-shell.pb-details-active .pb-sidebar')
    expect(inflow).toContain('position: static')
    expect(ruleBody('.battle-playback:not(:fullscreen) .pb-map-stage > .pb-side-panel-shell')).toContain('position: static')

    // 手机全屏横屏：抽屉宽度按黑边实宽算（(100vw - 100vh) / 2），不越到地图上。
    expect(stripped).toContain('@media (orientation: landscape)')
    const landscape = stripped.slice(stripped.indexOf('@media (orientation: landscape)'))
    expect(landscape).toContain('calc((100vw - 100vh) / 2 - 8px)')
    expect(landscape).toContain('animation: pb-details-slide-in')
  })

  // VehicleDetailsPanel 挂在 .pb-side-panel-shell 下，不在 .pb-side-panel 内。
  // 只覆盖 .pb-side-panel .pb-sidebar 的写法匹配不到它，组件的 width: 260px 会一直生效，
  // 详情就在几百像素宽的列里缩成一张窄卡片。
  it('overrides the sidebar on its real DOM path, not only inside pb-side-panel', () => {
    // 所有形态：只解开组件的 width: 260px，让它填满可用宽度。
    const body = ruleBody('.battle-playback .pb-map-stage > .pb-side-panel-shell > .pb-sidebar')
    expect(body).not.toBeNull()
    expect(body).toContain('width: auto')
    expect(body).toContain('max-width: none')
    // 背景/边框不能在这里去掉：浮层与 sheet 形态没有背景板会让文字直接透在地图上。
    expect(body).not.toContain('background: transparent')
    expect(body).not.toContain('border: 0')

    // 只有持久列里详情才变成「列本身」——去卡片外观、跟着列高走。
    const column = ruleBody('.battle-playback:not(:fullscreen):not(.pb-device-mobile) .pb-map-stage > .pb-side-panel-shell > .pb-sidebar')
    expect(column).toContain('background: transparent')
    expect(column).toContain('border: 0')
    expect(column).toContain('max-height: 100%')
  })

  // 控制条在流内时不能再被「触摸唤起」的 opacity: 0 压住——元素已不在地图上，
  // 没有能唤起它的触摸，结果就是控制条彻底消失。这条规则特异性高于按宽度写的那条，
  // 所以必须一起改，否则真机上仍然看不见。
  it('never hides the in-flow controls behind a touch-reveal opacity', () => {
    for (const sel of [
      '.battle-playback:not(:fullscreen) .pb-mobile-overlay',
      '.battle-playback:not(:fullscreen).pb-form-mobile .pb-mobile-overlay',
    ]) {
      const body = ruleBody(sel)
      expect(body).not.toBeNull()
      expect(body).toContain('position: static')
      expect(body).toContain('opacity: 1')
      expect(body).not.toContain('pointer-events: none')
    }
  })

  // 同一选择器写两遍时，后一条静默赢过前一条——本文件的 ruleBody 只取第一条，
  // 于是「测试断言的」和「浏览器生效的」可以完全不同。这里守住关键选择器不重复。
  it('does not declare the same layout selector twice at the top level', () => {
    // 只查顶层：media query 内的同名选择器是不同上下文，不算重复。
    const topLevel = stripped.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    const seen = new Map()
    for (const chunk of topLevel.split(/}/).filter((c) => c.includes('{'))) {
      for (const sel of selectorsOf(chunk)) {
        if (!sel.includes('pb-side-panel-shell') && !sel.includes('pb-left-rail')) continue
        seen.set(sel, (seen.get(sel) || 0) + 1)
      }
    }
    const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([sel]) => sel)
    expect(duplicated).toEqual([])
  })

  // 手机 fullscreen 必然横屏，横向放得下三段，因此与桌面同构：窄 Left Rail | Map |
  // 右侧滑入的 Details 抽屉。controls 仍走 bottom overlay（拇指够得到底部）。
  it('mobile fullscreen contract: 窄 rail + 地图 + 右侧 Details 抽屉，controls 仍在 bottom overlay', () => {
    const fsM = ruleBody('.battle-playback:fullscreen.pb-form-mobile')
    expect(fsM).toContain('grid-template-columns: var(--pb-left-col) minmax(0, 1fr)')
    expect(fsM).toContain('--pb-rail-w: 148px')
    // Details 是抽屉不是常驻列，token 仍归零：kill-feed / annotation-surface 不为浮层预留空间。
    expect(fsM).toContain('--pb-details-w: 0px')
    // overlay 已经是 col2 的子元素；再加 --pb-left-col 会重复偏移一个 rail 宽，
    // 把 controls 推进地图里并裁掉右侧（实测 740×360：x 173→321，宽 587→439）。
    const fsOverlay = ruleBody('.battle-playback:fullscreen.pb-form-mobile .pb-mobile-overlay')
    expect(fsOverlay).toContain('left: 0')
    expect(fsOverlay).not.toContain('--pb-left-col')
    expect(ruleBody('.battle-playback:fullscreen.pb-form-mobile .pb-left-rail')).toContain('display: flex')
    expect(ruleBody('.battle-playback:fullscreen.pb-form-mobile .pb-main')).toContain('grid-column: 2')
    expect(ruleBody('.battle-playback:fullscreen.pb-form-mobile .pb-hud')).toContain('left: var(--pb-left-col)')
    expect(ruleBody('.battle-playback:fullscreen.pb-form-mobile .pb-map-stage')).toContain('grid-template-columns: minmax(0, 1fr)')
    // .pb-hud 是根的子元素，偏移 --pb-left-col 才能停在 rail 右缘；.pb-mobile-overlay
    // 在 .pb-main（col2）里，同样的偏移会叠加一次 rail 宽——两者不能照抄。
    // Details 走与非全屏一致的右侧滑入窗口
    const details = ruleBody('.battle-playback:fullscreen.pb-form-mobile .pb-map-stage > .pb-side-panel-shell .pb-side-panel')
    expect(details).toContain('position: fixed')
    expect(details).toContain('animation: pb-details-slide-in')
  })

  it('details-blocker: mobile 空 shell 不接管 pointer，选中（pb-details-active）才打开 sheet', () => {
    const shell = ruleBody('.battle-playback:fullscreen.pb-form-mobile .pb-map-stage > .pb-side-panel-shell')
    expect(shell).toContain('pointer-events: none')
    expect(shell).toContain('background: transparent')
    const shellActive = ruleBody('.battle-playback:fullscreen.pb-form-mobile .pb-map-stage > .pb-side-panel-shell.pb-details-active')
    expect(shellActive).toContain('pointer-events: auto')
    // §layering：active Details 必须显式 z-index（不依赖 768-1199 media 的 var(--z-modal)）
    expect(shellActive).toContain('z-index: 60')
    // 稳定层级：controls(≤40) < events(45) < HUD(50) < active Details(60) < drawer backdrop(74)/rail(75)
    expect(ruleBody('.battle-playback:fullscreen .pb-hud')).toContain('z-index: 50')
    expect(ruleBody('.battle-playback:fullscreen .pb-mobile-overlay')).toContain('z-index: 40')
    expect(ruleBody('.battle-playback .pb-drawer-backdrop')).toContain('z-index: 74')
    expect(ruleBody('.battle-playback.pb-drawer-open .pb-left-rail')).toContain('z-index: 75')
  })

  it('mobile drawer: ☰ 用 .pb-drawer-open 把 rail 打开为 drawer（backdrop 关闭），非 dead action', () => {
    expect(ruleBody('.battle-playback .pb-drawer-backdrop')).toContain('position: fixed')
    expect(ruleBody('.battle-playback.pb-drawer-open .pb-left-rail')).toContain('position: fixed')
    expect(ruleBody('.battle-playback.pb-drawer-open .pb-left-rail')).toContain('width: min(84vw, 320px)')
    // mobile fullscreen 也要 win 过 .pb-form-mobile 的 display:none
    expect(ruleBody('.battle-playback:fullscreen.pb-form-mobile.pb-drawer-open .pb-left-rail')).toContain('display: flex')
  })

  it('mobile-contract: .pb-form-mobile 控件/overlay 尺寸生效（横屏>768 仍 mobile UX，不依赖 @media(width<768px)）', () => {
    expect(ruleBody('.battle-playback.pb-form-mobile .pb-controls')).toContain('justify-content: center')
    expect(ruleBody('.battle-playback.pb-form-mobile .pb-controls .pb-control-label')).toContain('display: none')
    expect(ruleBody('.battle-playback.pb-form-mobile .pb-controls .pb-btn')).toContain('min-height: 36px')
    // <1200px 非全屏：控制条排在地图下方的正常流里，不再是压住地图的浮层。
    // 按宽度判定，窄的桌面浏览器窗口（精确指针、拿不到 .pb-form-mobile）同样生效。
    expect(ruleBody('.battle-playback:not(:fullscreen) .pb-mobile-overlay-content')).toContain('position: static')
    const overlay = ruleBody('.battle-playback:not(:fullscreen) .pb-mobile-overlay')
    expect(overlay).toContain('position: static')
    expect(overlay).toContain('opacity: 1')
    expect(ruleBody('.battle-playback.pb-form-mobile .pb-controls .pb-time')).toContain('order: 20')
  })
})
