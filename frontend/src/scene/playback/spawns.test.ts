// spawns 纯模块测试：fail-closed 门、坐标镜像、贴地几何与生命周期（#835）。
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createSpawnMarkers, type MapSpawnPoint } from './spawns.js'

/** 记录 add/remove 的假 scene（模块只做 add/remove + dispose，无需真实渲染）。 */
function fakeScene() {
  const added: THREE.Object3D[] = []
  const removed: THREE.Object3D[] = []
  return {
    scene: { add: (o: THREE.Object3D) => added.push(o), remove: (o: THREE.Object3D) => removed.push(o) } as unknown as THREE.Scene,
    added, removed,
  }
}

function geomCenterY(o: THREE.Object3D): number {
  const pos = (o as THREE.Mesh).geometry.getAttribute('position')
  let sum = 0
  for (let i = 0; i < pos.count; i++) sum += pos.getY(i)
  return sum / pos.count
}

function geomXZRange(o: THREE.Object3D) {
  const p = (o as THREE.Mesh).geometry.getAttribute('position')
  const xs = Array.from({ length: p.count }, (_, i) => p.getX(i))
  const zs = Array.from({ length: p.count }, (_, i) => p.getZ(i))
  return { xMin: Math.min(...xs), xMax: Math.max(...xs), zMin: Math.min(...zs), zMax: Math.max(...zs) }
}

describe('createSpawnMarkers fail-closed 门', () => {
  it('null / undefined / 非数组：不向场景添加任何对象', () => {
    for (const bad of [null, undefined, 'x', 42]) {
      const { scene, added } = fakeScene()
      const markers = createSpawnMarkers({ getScene: () => scene, groundY: () => 0 })
      markers.build(bad as unknown as readonly MapSpawnPoint[])
      expect(added.length).toBe(0)
    }
  })

  it('空数组：不添加', () => {
    const { scene, added } = fakeScene()
    const markers = createSpawnMarkers({ getScene: () => scene, groundY: () => 0 })
    markers.build([])
    expect(added.length).toBe(0)
  })

  it('脏条目逐条兜底：NaN / Infinity / null / 缺坐标条目不画，同批有效条目照画', () => {
    const { scene, added } = fakeScene()
    const markers = createSpawnMarkers({ getScene: () => scene, groundY: () => 0 })
    markers.build([
      { x: 10, y: 20 },
      { x: Number.NaN, y: 20 },
      { x: 10, y: Number.POSITIVE_INFINITY },
      null as unknown as MapSpawnPoint,
      { x: 30, y: 40 },
    ])
    // 每个有效点 = 盘 + 环 两个对象
    expect(added.length).toBe(4)
  })
})

describe('坐标与几何', () => {
  it('scene x = −语义 x 镜像（与回放/bases 同一口径），z = 语义 y；逐顶点贴地', () => {
    const { scene, added } = fakeScene()
    const markers = createSpawnMarkers({ getScene: () => scene, groundY: () => 5 })
    markers.build([{ x: 100, y: -200, team: 1, name: 'spawn1' }])
    expect(added.length).toBe(2)
    for (const o of added) {
      const r = geomXZRange(o)
      // 顶点全部落在 (−100, ·, −200) 附近（贴地采样允许 ±半径偏移）
      expect(r.xMin).toBeGreaterThan(-103.5)
      expect(r.xMax).toBeLessThan(-96.5)
      expect(r.zMin).toBeGreaterThan(-203.5)
      expect(r.zMax).toBeLessThan(-196.5)
    }
    // 逐顶点贴地：groundY=5 → 所有顶点 y ≈ 5.05/5.08
    const discY = geomCenterY(added[0])
    expect(discY).toBeGreaterThan(4.9)
    expect(discY).toBeLessThan(5.3)
  })

  it('reground 按新高度场重建几何（地形异步就绪链）', () => {
    const { scene, added } = fakeScene()
    let gy = 0
    const markers = createSpawnMarkers({ getScene: () => scene, groundY: () => gy })
    markers.build([{ x: 0, y: 0 }])
    const before = geomCenterY(added[0])
    gy = 40
    markers.reground()
    const after = geomCenterY(added[0])
    expect(after).toBeGreaterThan(before + 30)
  })

  it('clear 移除场景对象并逐个 dispose；重复 clear 幂等', () => {
    const { scene, added, removed } = fakeScene()
    const markers = createSpawnMarkers({ getScene: () => scene, groundY: () => 0 })
    markers.build([{ x: 1, y: 2 }, { x: 3, y: 4 }])
    const disposals = added.map((o) => {
      const mesh = o as THREE.Mesh
      const geoSpy = vi.spyOn(mesh.geometry, 'dispose')
      const matSpy = vi.spyOn(mesh.material as THREE.Material, 'dispose')
      return { geoSpy, matSpy }
    })
    markers.clear()
    expect(removed).toEqual(added)   // 移除的正是添加过的对象
    disposals.forEach(({ geoSpy, matSpy }) => {
      expect(geoSpy).toHaveBeenCalledTimes(1)
      expect(matSpy).toHaveBeenCalledTimes(1)
    })
    markers.clear()
    expect(removed.length).toBe(added.length)
  })

  it('换图重建：build 再次调用先清旧点再加新点（不残留旧图标记）', () => {
    const { scene, added, removed } = fakeScene()
    const markers = createSpawnMarkers({ getScene: () => scene, groundY: () => 0 })
    markers.build([{ x: 1, y: 1 }, { x: 2, y: 2 }])
    const firstCount = added.length
    markers.build([{ x: 9, y: 9 }])
    expect(added.length).toBe(firstCount + 2)
    expect(removed.length).toBe(4)   // 旧图 2 点 × 盘+环
  })
})

describe('场景 Team 身份色（#835 后续：Team 1 绿 / Team 2 红 / 未知中性）', () => {
  /** 直接检查 MeshBasicMaterial 的实际颜色，不只看代码字符串。 */
  function matOf(o: THREE.Object3D): THREE.MeshBasicMaterial {
    return (o as THREE.Mesh).material as THREE.MeshBasicMaterial
  }
  const hex = (o: THREE.Object3D) => matOf(o).color.getHexString()

  it('Team 1 → 绿（--color-team-1）；Team 2 → 红（--color-team-2）；环为深色轮廓', () => {
    const { scene, added } = fakeScene()
    const markers = createSpawnMarkers({ getScene: () => scene, groundY: () => 0 })
    markers.build([{ x: 1, y: 1, team: 1 }, { x: 2, y: 2, team: 2 }])
    // disc / ring 交替（每点两个对象）；node 测试环境无 getComputedStyle → 按
    // tokens.css 同值 fallback 断言（token 名 ↔ fallback 的映射守卫在本模块常量）
    expect(hex(added[0])).toBe('5cc280')   // --color-team-1（green-400）
    expect(hex(added[2])).toBe('f2786d')   // --color-team-2（red-400）
    // 环是深色轮廓（--color-on-team-neutral），不是阵营色
    expect(hex(added[1])).toBe('1c1f1d')
    expect(hex(added[3])).toBe('1c1f1d')
  })

  it('未知 / null / 0 / 3 → 中性（不误归 Team 2），保持原半透明中性材质', () => {
    const { scene, added } = fakeScene()
    const markers = createSpawnMarkers({ getScene: () => scene, groundY: () => 0 })
    markers.build([
      { x: 1, y: 1 },
      { x: 2, y: 2, team: null as unknown as number },
      { x: 3, y: 3, team: 0 },
      { x: 4, y: 4, team: 3 },
    ])
    for (const i of [0, 2, 4, 6]) {
      expect(hex(added[i])).toBe('858f81')   // --text-muted
      expect(matOf(added[i]).transparent).toBe(true)
      expect(matOf(added[i]).opacity).toBe(0.85)
    }
  })

  it('红绿盘不透明（opacity 1、非 transparent）；中性盘维持半透明', () => {
    const { scene, added } = fakeScene()
    const markers = createSpawnMarkers({ getScene: () => scene, groundY: () => 0 })
    markers.build([{ x: 1, y: 1, team: 1 }, { x: 2, y: 2, team: 2 }, { x: 3, y: 3, team: 9 }])
    expect(matOf(added[0]).transparent).toBe(false)
    expect(matOf(added[0]).opacity).toBe(1)
    expect(matOf(added[2]).transparent).toBe(false)
    expect(matOf(added[2]).opacity).toBe(1)
    expect(matOf(added[4]).transparent).toBe(true)
    expect(matOf(added[4]).opacity).toBe(0.85)
  })

  it('reground 重建几何后材质颜色保持', () => {
    const { scene, added } = fakeScene()
    const markers = createSpawnMarkers({ getScene: () => scene, groundY: () => 0 })
    markers.build([{ x: 0, y: 0, team: 2 }])
    const before = hex(added[0])
    markers.reground()
    expect(hex(added[0])).toBe(before)
  })

  it('坐标/数量不变：team 只影响颜色，不影响镜像与几何', () => {
    const { scene, added } = fakeScene()
    const markers = createSpawnMarkers({ getScene: () => scene, groundY: () => 5 })
    markers.build([{ x: 100, y: -200, team: 1 }])
    const r = geomXZRange(added[0])
    expect(r.xMin).toBeGreaterThan(-103.5)
    expect(r.xMax).toBeLessThan(-96.5)
    expect(r.zMin).toBeGreaterThan(-203.5)
    expect(r.zMax).toBeLessThan(-196.5)
  })
})

describe('UI Profile 切换后 refreshColors 原位重着色（#877 review P3）', () => {
  /** token 面板模拟：showcase(dark) ↔ classic(light) 的 team 色板（tokens/color.css 实值）。 */
  const PROFILES = {
    showcase: { '--color-team-1': '#5cc280', '--color-team-2': '#f2786d', '--color-on-team-neutral': '#1c1f1d' },
    classic: { '--color-team-1': '#16703c', '--color-team-2': '#b8352a', '--color-on-team-neutral': '#1c1f1d' },
  } as const
  let prevGetComputedStyle: typeof globalThis.getComputedStyle | undefined
  let prevDocument: typeof globalThis.document | undefined
  let tokens: Record<string, string> = { ...PROFILES.showcase }

  function useProfile(name: keyof typeof PROFILES) {
    tokens = { ...PROFILES[name] }
  }

  function stubCss() {
    prevGetComputedStyle = globalThis.getComputedStyle
    prevDocument = globalThis.document
    ;(globalThis as Record<string, unknown>).document = {}
    globalThis.getComputedStyle = (() => ({
      getPropertyValue: (name: string) => tokens[name] ?? '',
    })) as unknown as typeof globalThis.getComputedStyle
  }

  function restoreCss() {
    if (prevGetComputedStyle) globalThis.getComputedStyle = prevGetComputedStyle
    else delete (globalThis as Record<string, unknown>).getComputedStyle
    if (prevDocument !== undefined) (globalThis as Record<string, unknown>).document = prevDocument
    else delete (globalThis as Record<string, unknown>).document
  }

  function hexOf(o: THREE.Object3D): string {
    return ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHexString()
  }

  it('showcase → classic → showcase 双向：颜色随 token 更新，几何/对象原位保留', () => {
    stubCss()
    try {
      useProfile('showcase')
      const { scene, added } = fakeScene()
      const markers = createSpawnMarkers({ getScene: () => scene, groundY: () => 0 })
      markers.build([
        { x: 1, y: 1, team: 1 },
        { x: 2, y: 2, team: 2 },
        { x: 3, y: 3, team: null as unknown as number },
      ])
      expect(hexOf(added[0])).toBe('5cc280')
      expect(hexOf(added[2])).toBe('f2786d')

      // classic（light 主题深色变体）：不重建场景，同批对象原位换色
      const identityBefore = added.map(o => (o as THREE.Mesh).geometry)
      useProfile('classic')
      markers.refreshColors()
      expect(hexOf(added[0])).toBe('16703c')
      expect(hexOf(added[2])).toBe('b8352a')
      // 中性盘：classic 无 --text-muted 覆盖（stub 未给）→ fallback，不误入 team 色
      expect(hexOf(added[4])).toBe('858f81')
      expect(added.map(o => (o as THREE.Mesh).geometry)).toEqual(identityBefore)

      // 切回 showcase：双向回归
      useProfile('showcase')
      markers.refreshColors()
      expect(hexOf(added[0])).toBe('5cc280')
      expect(hexOf(added[2])).toBe('f2786d')

      // 换 profile 后 build 新点：直接用新 token（不只 refresh 路径生效）
      markers.build([{ x: 9, y: 9, team: 1 }])
      expect(hexOf(added.at(-2)!)).toBe('5cc280')
    } finally {
      restoreCss()
    }
  })

  it('refreshColors 后 ring 深色轮廓保持、reground 链不受影响', () => {
    stubCss()
    try {
      useProfile('classic')
      const { scene, added } = fakeScene()
      const markers = createSpawnMarkers({ getScene: () => scene, groundY: () => 0 })
      markers.build([{ x: 0, y: 0, team: 2 }])
      markers.refreshColors()
      expect(hexOf(added[1])).toBe('1c1f1d')
      // reground 与 refreshColors 正交：几何重建不改颜色
      const colorBefore = hexOf(added[0])
      markers.reground()
      expect(hexOf(added[0])).toBe(colorBefore)
    } finally {
      restoreCss()
    }
  })
})
