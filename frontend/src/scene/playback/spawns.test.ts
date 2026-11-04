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
