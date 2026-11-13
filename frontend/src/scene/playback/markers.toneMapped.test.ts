// 标记层材质字面色直出行为测试（#827 接替 sceneryMaterials.test.js 的 :1265 边界/基地半句）：
// 边界红线与基地环/圆盘必须 toneMapped:false——逐图曝光（toneMappingExposure =
// 基准太阳强度/该图强度）不得压深 UI 语义色（山地图 expo≈0.21 会压到 1/5）。
// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as THREE from 'three'
import { createBoundaryBand } from './boundary.js'
import { createBaseMarkers } from './bases.js'

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe(':1265 标记层 toneMapped:false（字面色直出）', () => {
  it('边界带：红色 0xff2f2f + toneMapped:false（随地形贴地）', () => {
    const scene = new THREE.Scene()
    const band = createBoundaryBand({
      getScene: () => scene,
      disposeObject3D: () => {},
      groundY: () => 0,
    })
    band.build({ cx: 0, cz: 0, hx: 100, hz: 80 }, 1.8)
    const group = scene.children[0]
    expect(group).toBeTruthy()
    const mats: THREE.MeshBasicMaterial[] = []
    group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) mats.push(mesh.material as THREE.MeshBasicMaterial)
    })
    expect(mats.length).toBe(1)
    expect(mats[0].toneMapped).toBe(false)
    expect(mats[0].color.getHex()).toBe(0xff2f2f)
    band.clear()
    expect(scene.children.length).toBe(0)
  })

  it('基地环/圆盘：toneMapped:false（画布贴图为显示内容 SRGB）', () => {
    const scene = new THREE.Scene()
    const markers = createBaseMarkers({
      getScene: () => scene,
      getCamera: () => new THREE.PerspectiveCamera(),
      getData: () => ({ supremacy_bases: [{ base_id: 'A', team: 0 }] }) as never,
      getMapBases: () => ({ supremacy: [{ baseId: 'A', x: 10, y: 10, radius: 15 }] }) as never,
      store: { baseViews: [] } as never,
      groundY: () => 0,
    })
    markers.build()
    const mats: THREE.MeshBasicMaterial[] = []
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) mats.push(mesh.material as THREE.MeshBasicMaterial)
    })
    expect(mats.length).toBe(2)   // 环 + 圆盘
    for (const m of mats) {
      expect(m.toneMapped).toBe(false)
      expect(m.transparent).toBe(true)
      expect(m.depthWrite).toBe(false)   // 贴地层不参与深度
    }
    // 圆盘画布贴图：显示内容 → SRGB
    const disc = mats.find((m) => m.map)
    expect(disc?.map?.colorSpace).toBe(THREE.SRGBColorSpace)
    markers.clear()
    expect(scene.children.length).toBe(0)
  })
})
