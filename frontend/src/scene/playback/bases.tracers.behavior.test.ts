// @vitest-environment happy-dom
// 阵营调色行为测试（#827 接替 supremacyPoints.test.js:69/:87/:105）：
// - 基地 teardown：clear() 清空贴地标记（场景/几何/材质/纹理释放）+ HUD 派生 baseViews 归零；
// - 中立/无主基地 → 白 token（--color-team-neutral 消费，不再用灰）；
// - 炮线亮色板与车辆 tint 分离（注入契约）：宿主常量亮度 + battleRuntime 阵营分流。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as THREE from 'three'
import { createBaseMarkers } from './bases.js'
import { teamTracerColor } from './battleRuntime.js'
import { COLOR_FRIENDLY, COLOR_ENEMY, TRACER_FRIENDLY, TRACER_ENEMY } from '../playbackScene.js'

function makeBases(overrides = {}) {
  const scene = new THREE.Scene()
  const store = { baseViews: [] as unknown[] }
  const disposeSpy = vi.fn()
  const handle = createBaseMarkers({
    getScene: () => scene,
    getCamera: () => new THREE.PerspectiveCamera(),
    getData: () => ({ meta: { friendly_team: 1 }, supremacy_bases: [], assault_bases: [] }) as never,
    getMapBases: () => ({ supremacy: [{ baseId: 'A', x: 10, y: 20, radius: 15 }], assault: [] }) as never,
    store,
    groundY: () => 0,
    ...overrides,
  })
  return { handle, scene, store }
}

beforeEach(() => {
  // CSS token 显式锚定（happy-dom 无主题注入）：token → 材质 的消费行为
  document.documentElement.style.setProperty('--color-team-neutral', '#f5f5f5')
})

describe('createBaseMarkers teardown（会话切换不留残值）', () => {
  it('clear()：贴地标记随会话释放（场景摘除），HUD baseViews 归零', () => {
    const { handle, scene, store } = makeBases()
    handle.buildStatic('supremacy')
    expect(scene.children.length).toBeGreaterThan(0)   // 环 + 圆盘已入场景
    handle.clear()
    expect(scene.children.length).toBe(0)
    expect(store.baseViews).toEqual([])
    // 重复 clear 幂等（空会话 teardown 也不抛）
    handle.clear()
    expect(scene.children.length).toBe(0)
  })
})

describe('中立基地 → 白 token（PR #411：不再用灰）', () => {
  it('贴地环材质消费 --color-team-neutral（0xf5f5f5），无主圆盘按中性色绘制', () => {
    const { handle, scene } = makeBases()
    handle.buildStatic('supremacy')
    const meshes = scene.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh)
    const ring = meshes.find((m) => !!(m.material as THREE.MeshBasicMaterial).color)
    expect(ring).toBeTruthy()
    expect((ring!.material as THREE.MeshBasicMaterial).color.getHexString()).toBe('f5f5f5')
    handle.clear()
  })
})

describe('炮线亮色板（注入契约行为）', () => {
  const lum = (c: number) => 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)

  it('宿主常量：炮线亮板显著亮于车辆 tint，色相保持绿=友 / 红=敌', () => {
    // 车辆 tint 保持深色板（回退护栏）
    expect(COLOR_FRIENDLY).toBe(0x26794a)
    expect(COLOR_ENEMY).toBe(0x98322a)
    // 炮线同色相提亮：绿更亮且仍偏绿、红更亮且仍偏红；两项都显著亮于 tint
    expect(lum(TRACER_FRIENDLY)).toBeGreaterThan(lum(COLOR_FRIENDLY) * 1.4)
    expect(lum(TRACER_ENEMY)).toBeGreaterThan(lum(COLOR_ENEMY) * 1.4)
    expect((TRACER_FRIENDLY >> 8) & 255).toBeGreaterThan((TRACER_FRIENDLY >> 16) & 255)   // 绿通道为主
    expect((TRACER_ENEMY >> 16) & 255).toBeGreaterThan((TRACER_ENEMY >> 8) & 255)         // 红通道为主
  })

  it('battleRuntime 阵营分流：注入的亮板按射手阵营直出；未知阵营一律白（unknown ≠ enemy）', () => {
    const colors = { unknown: 0xffffff, friendly: TRACER_FRIENDLY, enemy: TRACER_ENEMY }
    expect(teamTracerColor(1, 1, colors)).toBe(TRACER_FRIENDLY)
    expect(teamTracerColor(2, 1, colors)).toBe(TRACER_ENEMY)
    expect(teamTracerColor(1, 2, colors)).toBe(TRACER_ENEMY)
    // unknown ≠ enemy：team 0 / 未知 friendly_team 一律白
    expect(teamTracerColor(0, 1, colors)).toBe(0xffffff)
    expect(teamTracerColor(1, null, colors)).toBe(0xffffff)
    expect(teamTracerColor(3, 1, colors)).toBe(0xffffff)
  })
})
