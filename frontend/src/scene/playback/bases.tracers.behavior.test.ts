// @vitest-environment happy-dom
// 阵营调色行为测试：
// - 基地 teardown：clear() 清空贴地标记（场景/几何/材质/纹理释放）+ HUD 派生 baseViews 归零；
// - 中立/无主基地 → Playback SSOT neutral（不再从 document root 读 token）；
// - 炮线亮色板与车辆 tint 分离（注入契约）：宿主常量亮度 + battleRuntime 阵营分流。
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import * as THREE from 'three'
import { createBaseMarkers } from './bases.js'
import { teamTracerColor } from './battleRuntime.js'
import { COLOR_FRIENDLY, COLOR_ENEMY, TRACER_FRIENDLY, TRACER_ENEMY } from '../playbackScene.js'
import { PLAYBACK_ROLES } from '../../data/mapTeamColors.js'

const numeric = (hex: string) => parseInt(hex.slice(1), 16)

function makeBases(overrides = {}) {
  const scene = new THREE.Scene()
  const store = { baseViews: [] as unknown[] }
  const handle = createBaseMarkers({
    getScene: () => scene,
    getCamera: () => new THREE.PerspectiveCamera(),
    getData: () => ({ meta: { friendly_team: 1 }, supremacy_bases: [], assault_bases: [] }) as never,
    getMapBases: () => ({ supremacy: [{ baseId: 'A', x: 10, y: 20, radius: 15 }], assault: [] }) as never,
    store: store as never,
    groundY: () => 0,
    ...overrides,
  })
  return { handle, scene, store }
}

const ROOT_VARS = [
  '--color-team-neutral',
  '--color-team-ally',
  '--color-team-enemy',
  '--color-objective',
  '--color-on-team-neutral',
]

beforeEach(() => {
  // 故意写一组与 SSOT 冲突的 document-root token（模拟 Winter 主题根与场景子树不一致）。
  // 基地颜色若仍从 documentElement 读取，下面的断言会立刻失败。
  document.documentElement.style.setProperty('--color-team-neutral', '#ff0000')
  document.documentElement.style.setProperty('--color-team-ally', '#00ff00')
  document.documentElement.style.setProperty('--color-team-enemy', '#0000ff')
  document.documentElement.style.setProperty('--color-objective', '#ff00ff')
  document.documentElement.style.setProperty('--color-on-team-neutral', '#123456')
})

afterEach(() => {
  for (const name of ROOT_VARS) document.documentElement.style.removeProperty(name)
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

describe('基地颜色来自 Playback SSOT（忽略 document root 作用域）', () => {
  it('无主环材质 = PLAYBACK_ROLES.neutral.base，即使 document root 写了冲突 token', () => {
    const { handle, scene } = makeBases()
    handle.buildStatic('supremacy')
    const meshes = scene.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh)
    const ring = meshes.find((m) => !!(m.material as THREE.MeshBasicMaterial).color)
    expect(ring).toBeTruthy()
    expect((ring!.material as THREE.MeshBasicMaterial).color.getHexString())
      .toBe(PLAYBACK_ROLES.neutral.base.slice(1))
    handle.clear()
  })
})

describe('炮线亮色板（注入契约行为）', () => {
  const lum = (c: number) => 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)

  it('宿主常量由 SSOT 派生：炮线亮板显著亮于车辆 tint，色相保持绿=友 / 红=敌', () => {
    // 车辆 tint 使用 SSOT 的 vehicle variant，不再是 renderer 私有 HEX
    expect(COLOR_FRIENDLY).toBe(numeric(PLAYBACK_ROLES.friendly.vehicle))
    expect(COLOR_ENEMY).toBe(numeric(PLAYBACK_ROLES.enemy.vehicle))
    expect(TRACER_FRIENDLY).toBe(numeric(PLAYBACK_ROLES.friendly.tracer))
    expect(TRACER_ENEMY).toBe(numeric(PLAYBACK_ROLES.enemy.tracer))
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
