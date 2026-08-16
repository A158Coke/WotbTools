// @vitest-environment happy-dom
/**
 * VehicleMarker 正式组件测试（PR2 — §17）：generic / dedicated turreted / dedicated
 * turretless 三条渲染路径 + 状态 class + select 事件。
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import VehicleMarker from './VehicleMarker.vue'

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

  it('阵亡 ✕：红色 + 更大 + 高层级 + 不被车辆淡化（PR #92 Review A + Blocker）', () => {
    const w = mountMarker({ ...genericMarker, destroyed: true })
    const death = w.find('.pb-death')
    expect(death.exists()).toBe(true)
    expect(death.text()).toBe('✕')
    const style = death.attributes('style') || ''
    expect(style).toContain('color: #ff4d4f') // 红色
    expect(style).toContain('font-size: 22px') // 比原 16px 更大
    expect(style).toContain('z-index: 6') // 高于 hull(1)/turret(2)/name(5)
    // ✕ 是 button 直接子元素、与 .pb-graphics 视觉层容器平级——不继承 destroyed opacity
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
    expect(btn.classes()).toContain('pb-recorder')
    expect(btn.classes()).toContain('pb-selected')
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
