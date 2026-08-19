// @vitest-environment happy-dom
/**
 * VehicleMarker 正式组件测试（PR2 — §17）：generic / dedicated turreted / dedicated
 * turretless 三条渲染路径 + 状态 class + select 事件。
 */
import {describe, expect, it} from 'vitest'
import {mount} from '@vue/test-utils'
import VehicleMarker from './VehicleMarker.vue'
import markerSource from './VehicleMarker.vue?raw'

const genericMarker = {
  vehicle: { accountId: 1, playerName: 'You', tankId: 1, tankName: 'Maus' },
  model: null,
  hullImage: 'hull.png',
  turretImage: 'turret.png',
  hullScreenDeg: 30,
  turretScreenDeg: 60,
  destroyed: false,
  recorder: false,
  lastKnown: false,
  markerStyle: { left: '10%', top: '20%', transform: 'translate(-50%, -50%)' },
  overlayInverseScale: 'scale(1)',
  overlayInverse: 1,
  // PR4 §36：hull hitbox 比例（generic 车体 55%×88% + padding；dedicated 0.9 方）
  hitbox: { w: 0.58, h: 0.9 },
  playerName: 'You',
  tankName: 'Maus',
  ariaLabel: 'You: reported',
}

const mausRaster = {
  logicalMinX: 112.19, logicalMinY: -19.64, logicalMaxX: 207.81, logicalMaxY: 267.24,
  pixelWidth: 191, pixelHeight: 574, pivotX: 47.81, pivotY: 212.87,
}

const dedicatedMarker = {
  ...genericMarker,
  model: {
    kind: 'turreted',
    hullSrc: '/assets/maus/hull.webp',
    turretSrc: '/assets/maus/turret.webp',
    turretPivot: { x: 160, y: 193.23 },
    turretRaster: mausRaster,
  },
}

const turretlessMarker = {
  ...genericMarker,
  model: { kind: 'turretless', hullSrc: '/assets/ho-ri/hull.webp', turretSrc: null, turretPivot: null, turretRaster: null },
}

function mountMarker(marker, selected = false) {
  return mount(VehicleMarker, { props: { marker, selected } })
}

describe('generic（非 Tier X / fallback）', () => {
  it('渲染 hull + turret 双层 PNG，共同 pivot 居中旋转（translate(-50%,-50%) rotate）', () => {
    const w = mountMarker(genericMarker)
    const hull = w.find('.pb-hull')
    const turret = w.find('.pb-turret')
    expect(hull.exists()).toBe(true)
    expect(hull.attributes('src')).toBe('hull.png')
    expect(hull.attributes('style')).toContain('translate(-50%, -50%) rotate(30deg)')
    expect(turret.attributes('style')).toContain('translate(-50%, -50%) rotate(60deg)')
    expect(w.find('.pb-turret-assembly').exists()).toBe(false)
    expect(w.find('.pb-hull-dedicated').exists()).toBe(false)
  })

  it('无方向样本（hullDeg/turretDeg null）→ 不渲染 img（不伪造朝向）', () => {
    const w = mountMarker({ ...genericMarker, hullScreenDeg: null, turretScreenDeg: null })
    expect(w.find('.pb-hull').exists()).toBe(false)
    expect(w.find('.pb-turret').exists()).toBe(false)
  })
})

describe('dedicated turreted（嵌套 transform）', () => {
  it('hull 满盒绕中心旋转 + turret assembly 随 hull 移动 + 子层绕 image-local pivot 旋转 T-H', () => {
    const w = mountMarker(dedicatedMarker)
    const hull = w.find('.pb-hull-dedicated')
    expect(hull.exists()).toBe(true)
    expect(hull.attributes('src')).toBe('/assets/maus/hull.webp')
    expect(hull.attributes('style')).toContain('rotate(30deg)')
    const assembly = w.find('.pb-turret-assembly')
    expect(assembly.exists()).toBe(true)
    expect(assembly.attributes('style')).toContain('rotate(30deg)') // 父层 rotate(H)
    const turret = w.find('.pb-turret-dedicated')
    expect(turret.attributes('src')).toBe('/assets/maus/turret.webp')
    expect(turret.attributes('style')).toContain('left: 35.0594%')
    expect(turret.attributes('style')).toContain('top: -6.1375%')
    expect(turret.attributes('style')).toContain('width: 29.8438%')
    // transform-origin 相对 image 自身盒（image-local pivot / image 尺寸）：
    // 47.81/95.5 = 50.0628%，212.87/287 = 74.1707%（不是 marker-global 的 14.9406%/66.5219%）
    expect(turret.attributes('style')).toContain('transform-origin: 50.0628% 74.1707%')
    expect(turret.attributes('style')).toContain('rotate(30deg)') // T - H = 60 - 30
  })

  it('destroyed 无方向样本 → 0° 渲染（最后可信姿态冻结语义）', () => {
    const w = mountMarker({ ...dedicatedMarker, hullScreenDeg: 0, turretScreenDeg: 0, destroyed: true })
    expect(w.find('.pb-hull-dedicated').attributes('style')).toContain('rotate(0deg)')
    expect(w.find('.pb-turret-dedicated').attributes('style')).toContain('rotate(0deg)')
    expect(w.find('.pb-death').exists()).toBe(true)
  })

  it('阵亡 ✕：红色 + 明显放大（主状态）+ 覆盖车体中心 + 不被车辆淡化（PR #92 Review A + PR3 增补）', () => {
    const w = mountMarker({ ...genericMarker, destroyed: true })
    const death = w.find('.pb-death')
    expect(death.exists()).toBe(true)
    expect(death.text()).toBe('✕')
    const style = death.attributes('style') || ''
    expect(style).toContain('color: #ff4d4f') // 红色
    expect(style).toContain('font-size: 30px') // 22px → 30px 明显放大（主状态）
    expect(style).toContain('z-index: 6') // 高于 hull(1)/turret(2)/name(5)
    expect(style).toContain('translate(-50%, -50%)') // 车体中心定位（覆盖车辆主体，非名字旁角标）
    expect(markerSource).toMatch(/\.pb-death \{[^}]*top: 50%[^}]*left: 50%[^}]*\}/)
    // ✕ 是 button 直接子元素、与 .pb-graphics 视觉层容器平级——不继承 destroyed opacity/grayscale
    const graphics = w.find('.pb-graphics')
    expect(graphics.exists()).toBe(true)
    expect(death.element.parentElement).toBe(graphics.element.parentElement)
    // 非 destroyed 不渲染 ✕（与 last-known 语义区分：淡化无 ✕）
    const lk = mountMarker({ ...genericMarker, lastKnown: true, destroyed: false })
    expect(lk.find('.pb-death').exists()).toBe(false)
    expect(lk.find('button').classes()).toContain('pb-last-known')
  })

  it('destroyed 三条路径：车辆视觉层都在 .pb-graphics 容器内（root 不再整体 opacity）', () => {
    const g = mountMarker({ ...genericMarker, destroyed: true })
    const t = mountMarker({ ...dedicatedMarker, destroyed: true })
    const tl = mountMarker({ ...turretlessMarker, destroyed: true })
    for (const w of [g, t, tl]) {
      expect(w.find('.pb-graphics').exists()).toBe(true)
      expect(w.find('button').classes()).toContain('pb-destroyed')
      // hull/turret/assembly 都是 .pb-graphics 的后代；✕ 是 button 直接子元素
      const graphicsEl = w.find('.pb-graphics').element
      const deathEl = w.find('.pb-death').element
      expect(deathEl.parentElement).toBe(graphicsEl.parentElement)
      for (const sel of ['.pb-hull', '.pb-turret', '.pb-turret-assembly']) {
        const el = w.find(sel)
        if (el.exists()) expect(graphicsEl.contains(el.element)).toBe(true)
      }
    }
  })
})

describe('dedicated turretless（无 fake turret layer，§14）', () => {
  it('仅 hull（gun 已 bake 进 hull）；turretDeg 存在也不渲染 turret 层', () => {
    const w = mountMarker(turretlessMarker)
    expect(w.find('.pb-hull-dedicated').exists()).toBe(true)
    expect(w.find('.pb-turret').exists()).toBe(false)
    expect(w.find('.pb-turret-assembly').exists()).toBe(false)
  })
})

describe('marker 根元素（按钮）', () => {
  it('定位样式 + 状态 class + 无障碍标签 + select 事件', async () => {
    const w = mountMarker({ ...genericMarker, recorder: true, lastKnown: false }, true)
    const btn = w.find('button.pb-vehicle')
    expect(btn.attributes('style')).toContain('left: 10%')
    expect(btn.attributes('style')).toContain('top: 20%')
    expect(btn.attributes('aria-label')).toBe('You: reported')
    expect(btn.attributes('data-test')).toBe('pb-marker-1')
    expect(w.find('.pb-name').text()).toBe('Maus')
    await btn.trigger('click')
    expect(w.emitted('select')).toHaveLength(1)
  })

  it('last-known（未阵亡）套用淡化 class；destroyed 不套 last-known', () => {
    const lk = mountMarker({ ...genericMarker, lastKnown: true })
    expect(lk.find('button').classes()).toContain('pb-last-known')
    const d = mountMarker({ ...genericMarker, destroyed: true, lastKnown: true })
    expect(d.find('button').classes()).not.toContain('pb-last-known')
    expect(d.find('button').classes()).toContain('pb-destroyed')
  })
})

describe('PR3 §19–§25 — team outline/glow 与状态视觉', () => {
  it('friendly/enemy token 互斥；generic 与 dedicated 都走 team class（不再 dedicated-only）', () => {
    for (const [marker, friendly] of [[dedicatedMarker, true], [genericMarker, true], [dedicatedMarker, false]]) {
      const w = mountMarker({ ...marker, friendly })
      const btn = w.find('button')
      expect(btn.classes()).toContain(friendly ? 'pb-friendly' : 'pb-enemy')
      expect(btn.classes()).not.toContain(friendly ? 'pb-enemy' : 'pb-friendly')
      expect(w.find('.pb-graphics').exists()).toBe(true)
    }
  })

  it('team outline/glow 消费根元素 CSS vars（friendly green|blue / enemy red，非专用色）', () => {
    const src = markerSource
    const friendlyRule = src.match(/\.pb-friendly:not\(\.pb-destroyed\):not\(\.pb-last-known\) \.pb-graphics \{[^}]*\}/)?.[0] || ''
    const enemyRule = src.match(/\.pb-enemy:not\(\.pb-destroyed\):not\(\.pb-last-known\) \.pb-graphics \{[^}]*\}/)?.[0] || ''
    expect(friendlyRule).toContain('var(--pb-team-outline')
    expect(friendlyRule).toContain('var(--pb-team-glow')
    expect(enemyRule).toContain('var(--pb-enemy-outline')
    expect(enemyRule).toContain('var(--pb-enemy-glow')
    // PR2 B3 过渡色（暖 amber/冷 cyan）已被 PR3 正式 team token 取代
    expect(src).not.toContain('rgba(255, 166, 77')
    expect(src).not.toContain('rgba(64, 192, 255')
    expect(src).not.toContain('pb-graphics-dedicated')
  })

  it('destroyed：中度变暗（0.55）+ grayscale + team outline 弱化保留；红 X 在容器外完整强度', () => {
    const src = markerSource
    expect(src).toContain('opacity: 0.55') // §24 不再极端透明（原 0.35）
    expect(src).toMatch(/\.pb-destroyed\.pb-friendly \.pb-graphics \{[^}]*grayscale\(1\)[^}]*var\(--pb-team-outline[^}]*\}/)
    expect(src).toMatch(/\.pb-destroyed\.pb-enemy \.pb-graphics \{[^}]*grayscale\(1\)[^}]*var\(--pb-enemy-outline[^}]*\}/)
    // 一次性 transition <1s + reduced-motion 直达终态
    expect(src).toContain('transition: opacity 0.45s ease, filter 0.45s ease')
    expect(src).toContain('@media (prefers-reduced-motion: reduce)')
    expect(src).toContain('.pb-destroyed .pb-graphics { transition: none; }')
    const w = mountMarker({ ...dedicatedMarker, friendly: false, destroyed: true })
    const death = w.find('.pb-death')
    expect(death.exists()).toBe(true)
    expect(death.attributes('style')).toContain('color: #ff4d4f')
    expect(death.element.parentElement).toBe(w.find('.pb-graphics').element.parentElement)
  })

  it('last-known：模型淡化 + 仅弱 outline（无 glow）；label 文字弱化、background 正常', () => {
    const src = markerSource
    expect(src).toMatch(/\.pb-last-known\.pb-friendly \.pb-graphics \{[^}]*opacity: 0\.35[^}]*\}/)
    // PR4 §25：label 块只弱化文字（两行都淡化）、background 保持正常
    expect(src).toMatch(/\.pb-last-known \.pb-labels \.pb-label-tank,[\s\S]*?opacity: \.65[^}]*\}/)
    expect(src).toContain('.pb-last-known .pb-labels .pb-label-player')
    expect(src).not.toContain('.pb-last-known { opacity: .3') // root opacity 已移除（✕/name 不被连带淡化）
    const w = mountMarker({ ...dedicatedMarker, friendly: true, lastKnown: true, destroyed: false })
    expect(w.find('button').classes()).toContain('pb-last-known')
    expect(w.find('button').classes()).toContain('pb-friendly')
  })

  it('selected：红色倒三角渲染（label 上方、浮动动画、reduced-motion 停止）', () => {
    const src = markerSource
    expect(src).toMatch(/\.pb-selected-mark \{[^}]*border-top: 9px solid #e5484d[^}]*animation: pb-selected-float 1\.6s[^}]*\}/)
    expect(src).toContain('.pb-selected-mark { animation: none; }')
    const w = mountMarker(dedicatedMarker, true)
    const mark = w.find('.pb-selected-mark')
    expect(mark.exists()).toBe(true)
    expect(mark.attributes('style')).toContain('translateX(-50%) scale(1)')
    const w2 = mountMarker(dedicatedMarker, false)
    expect(w2.find('.pb-selected-mark').exists()).toBe(false)
  })

  it('recorder：空心菱形（tank 下方、friendly team 色、静态）', () => {
    const src = markerSource
    expect(src).toContain('.pb-recorder-badge {')
    expect(src).toContain('border: 1.5px solid var(--pb-team-outline, #ffd76a)') // rotate(45deg) 由 inline style 提供
    const w = mountMarker({ ...dedicatedMarker, recorder: true })
    const badge = w.find('.pb-recorder-badge')
    expect(badge.exists()).toBe(true)
    expect(badge.attributes('style')).toContain('rotate(45deg)')
    const w2 = mountMarker({ ...dedicatedMarker, recorder: false })
    expect(w2.find('.pb-recorder-badge').exists()).toBe(false)
  })

  it('destroyed + selected：selected 克制变体（更小更淡，destroyed > selected）；generic/dedicated 都正常', () => {
    const src = markerSource
    // 克制规则：透明度 0.55 + 三角线性缩小（9px→6px 高、6px→4px 边）
    expect(src).toMatch(/\.pb-selected-restrained \{[^}]*opacity: 0\.55[^}]*border-left-width: 4px[^}]*border-right-width: 4px[^}]*border-top-width: 6px[^}]*\}/)
    const g = mountMarker({ ...genericMarker, destroyed: true }, true)
    expect(g.find('.pb-selected-mark').classes()).toContain('pb-selected-restrained')
    const d = mountMarker({ ...dedicatedMarker, destroyed: true }, true)
    expect(d.find('.pb-selected-mark').classes()).toContain('pb-selected-restrained')
    // 存活 selected：正常完整强度（无克制 class）
    const alive = mountMarker(genericMarker, true)
    expect(alive.find('.pb-selected-mark').classes()).not.toContain('pb-selected-restrained')
    // 非 selected 不渲染任何 mark
    const none = mountMarker({ ...genericMarker, destroyed: true }, false)
    expect(none.find('.pb-selected-mark').exists()).toBe(false)
  })

  it('destroyed ✕ 与 label 块保持 inverse-scale（不随地图 zoom 异常放大）；✕ 无 filter/opacity', () => {
    const w = mountMarker({ ...genericMarker, destroyed: true, overlayInverseScale: 'scale(0.5)', overlayInverse: 0.5 })
    expect(w.find('.pb-death').attributes('style')).toContain('translate(-50%, -50%) scale(0.5)')
    expect(w.find('.pb-labels').attributes('style')).toContain('translateX(-50%) scale(0.5)')
    // ✕ 不套用 .pb-graphics 的 grayscale/opacity（自身规则不含 filter/opacity）
    expect(markerSource).not.toMatch(/\.pb-death[^}]*filter:/)
    expect(markerSource).not.toMatch(/\.pb-death[^}]*opacity:/)
  })

  it('selected/recorder layout offset 按 overlayInverse 反缩放：selected→name gap 与 recorder→vehicle 恒定', () => {
    // inv = 1/1、1/2、1/4（对应 scale 1/2/4）
    // selected：X = 4.5 + 14.5·inv（三角底边跟随 name 顶边，屏幕 gap 恒 3px；1× 即 19px 车辆契约）
    for (const inv of [1, 0.5, 0.25]) {
      const w = mountMarker({ ...genericMarker, recorder: true, overlayInverse: inv, overlayInverseScale: `scale(${inv})` }, true)
      const markStyle = w.find('.pb-selected-mark').attributes('style') || ''
      const x = 4.5 + 14.5 * inv
      expect(markStyle).toContain(`bottom: calc(100% + ${x}px)`)
      expect(markStyle).toContain(`scale(${inv})`) // 元素尺寸同步反缩放
      // 屏幕几何：三角底边 = (x + 4.5)·s − 4.5；name 顶边 = 9·s + 7 → gap 必须恒 3
      const s = 1 / inv
      const triBottom = (x + 4.5) * s - 4.5
      const nameTop = 9 * s + 7
      expect(triBottom - nameTop).toBeCloseTo(3, 9)
      // 浮动幅度：2px × inv × s = 2px 恒定（var 注入 + keyframes calc）
      expect(markStyle).toContain(`--pb-overlay-inv: ${inv}`)
      expect(markerSource).toContain('margin-top: calc(2px * var(--pb-overlay-inv, 1))')
      // recorder：offset × scale = 5 恒定
      const badgeStyle = w.find('.pb-recorder-badge').attributes('style') || ''
      expect(badgeStyle).toContain(`top: calc(100% + ${5 * inv}px)`)
      expect(badgeStyle).toContain(`scale(${inv})`)
    }
    // 缺省 overlayInverse（旧 fixture 兼容）：回退 1× 间距
    const legacy = mountMarker({ ...genericMarker, recorder: true }, true)
    expect(legacy.find('.pb-selected-mark').attributes('style')).toContain('bottom: calc(100% + 19px)')
    expect(legacy.find('.pb-recorder-badge').attributes('style')).toContain('top: calc(100% + 5px)')
  })
})

describe('PR4 — 玩家/坦克标签与碰撞（§26–§36）', () => {
  const label = { showPlayer: false, showTank: true, tankDy: 0, playerHidden: false, playerFading: false }

  it('§26/§27：默认只显示 TankName；showPlayer 开启后两行共享背景块', () => {
    const w = mount(VehicleMarker, { props: { marker: genericMarker, selected: false, label } })
    const labels = w.find('.pb-labels')
    expect(labels.exists()).toBe(true)
    expect(w.find('.pb-label-tank').text()).toBe('Maus')
    expect(w.find('.pb-label-player').exists()).toBe(false) // 默认玩家名关
    const two = mount(VehicleMarker, { props: { marker: genericMarker, selected: false, label: { ...label, showPlayer: true } } })
    expect(two.find('.pb-label-player').text()).toBe('You')
    expect(two.find('.pb-label-player').isVisible()).toBe(true)
    // 两行都在同一背景块内（共享 canvas §28）
    expect(two.find('.pb-labels').element.contains(two.find('.pb-label-player').element)).toBe(true)
    expect(two.find('.pb-labels').element.contains(two.find('.pb-label-tank').element)).toBe(true)
  })

  it('§29 team 文字色：friendly 用 --pb-team-text、enemy 用 --pb-enemy-text（根元素 CSS vars）', () => {
    const src = markerSource
    expect(src).toContain('.pb-friendly .pb-label-tank,')
    expect(src).toContain('color: var(--pb-team-text, #fff);')
    expect(src).toContain('.pb-enemy .pb-label-tank,')
    expect(src).toContain('color: var(--pb-enemy-text, #ff8d8d);')
  })

  it('§30 tooltip：只有 PlayerName 截断（scrollWidth > clientWidth）才显示完整名 title', async () => {
    const w = mount(VehicleMarker, { props: { marker: genericMarker, selected: false, label: { ...label, showPlayer: true } } })
    await new Promise((r) => setTimeout(r, 0)) // nextTick 测量
    expect(w.find('.pb-label-player').attributes('title')).toBeUndefined() // 未截断 → 无 tooltip
    // 模拟截断：scrollWidth > clientWidth
    Object.defineProperty(w.find('.pb-label-player').element, 'scrollWidth', { value: 200, configurable: true })
    Object.defineProperty(w.find('.pb-label-player').element, 'clientWidth', { value: 60, configurable: true })
    // watch 依赖变化触发重测
    await w.setProps({ label: { ...label, showPlayer: true, playerHidden: true } })
    await w.setProps({ label: { ...label, showPlayer: true, playerHidden: false } })
    await new Promise((r) => setTimeout(r, 0))
    expect(w.find('.pb-label-player').attributes('title')).toBe('You')
  })

  it('§32/§33：playerHidden → v-show 隐藏；playerFading → fade 动画 class', () => {
    const src = markerSource
    expect(src).toContain('animation: pb-label-fade-in 0.12s ease;')
    const hidden = mount(VehicleMarker, { props: { marker: genericMarker, selected: false, label: { ...label, showPlayer: true, playerHidden: true } } })
    expect(hidden.find('.pb-label-player').attributes('style')).toContain('display: none') // v-show
    const fading = mount(VehicleMarker, { props: { marker: genericMarker, selected: false, label: { ...label, showPlayer: true, playerFading: true } } })
    expect(fading.find('.pb-label-player').classes()).toContain('pb-label-fading')
    expect(src).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.pb-label-fading \{ animation: none; \}/)
  })

  it('§34 tankDy：标签块 bottom 上移（tankDy×inv），selected 三角同步上移；车体不受影响', () => {
    const w = mount(VehicleMarker, { props: { marker: genericMarker, selected: true, label: { ...label, tankDy: -10 } } })
    const labelsStyle = w.find('.pb-labels').attributes('style') || ''
    expect(labelsStyle).toContain('bottom: calc(100% + -8px)') // 2 + (-10)×1
    const markStyle = w.find('.pb-selected-mark').attributes('style') || ''
    expect(markStyle).toContain('bottom: calc(100% + 9px)') // 19 - 10
    expect(w.find('button').attributes('style')).toContain('left: 10%')
  })

  it('§36 hitbox：hull 范围 span（% 尺寸随 marker 缩放）', () => {
    const w = mount(VehicleMarker, { props: { marker: genericMarker, selected: false, label } })
    const hitbox = w.find('.pb-hitbox')
    expect(hitbox.exists()).toBe(true)
    expect(hitbox.attributes('style')).toContain('width: 58%')
    expect(hitbox.attributes('style')).toContain('height: 90%')
    // 居中定位 + 可点 + 在图形层之上（CSS 提供，inline 只给 % 尺寸）
    expect(markerSource).toMatch(/\.pb-hitbox \{[^}]*left: 50%[^}]*top: 50%[^}]*transform: translate\(-50%, -50%\)[^}]*pointer-events: auto[^}]*\}/)
    const d = mount(VehicleMarker, { props: { marker: { ...dedicatedMarker, hitbox: { w: 0.9, h: 0.9 } }, selected: false, label } })
    expect(d.find('.pb-hitbox').attributes('style')).toContain('width: 90%')
    expect(d.find('.pb-hitbox').attributes('style')).toContain('height: 90%')
  })

  it('select 事件带原生 event（§37 需要 clientX/Y）', async () => {
    const w = mount(VehicleMarker, { props: { marker: genericMarker, selected: false, label } })
    await w.find('button').trigger('click', { clientX: 10, clientY: 20 })
    const emitted = w.emitted('select')
    expect(emitted).toHaveLength(1)
    expect(emitted[0][0]).toBeTruthy()
    expect(emitted[0][0].clientX).toBe(10)
  })
})
