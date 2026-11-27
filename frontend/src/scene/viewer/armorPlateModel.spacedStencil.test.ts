import { describe, expect, it, vi, afterEach } from 'vitest'
import * as THREE from 'three'
import { createArmorShaderContext } from './armorShaders.ts'
import { populateSpacedArmorScene } from './armorPlateModel.ts'
import { assignSpacedStencilBits, resolveSpacedHitMask, spacedDedupKey } from '../armorMeshTopology.ts'
import type { BufferGeometry, Mesh, Scene } from 'three'


const SIDES = new Map([[THREE.FrontSide, 'front'], [THREE.BackSide, 'back'], [THREE.DoubleSide, 'double']])

function spacedMesh(geometry: BufferGeometry, orig: string, plateId: string): Mesh {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
  mesh.userData.armorSection = 'spaced'
  mesh.userData.armorSectionOrig = orig
  mesh.userData.armorPlateId = plateId
  mesh.userData.armorThickness = 120
  return mesh
}

function openShellGeometry(): BufferGeometry {
  const box = new THREE.BoxGeometry(1, 1, 1)
  const trimmed = new THREE.BufferGeometry()
  trimmed.setAttribute('position', box.attributes.position)
  trimmed.setIndex(Array.from(box.index!.array.slice(6)))
  return trimmed
}

function mats() {
  const ctx = createArmorShaderContext()
  return {
    ctx,
    omit: new THREE.MeshBasicMaterial(),
    spacedOmit: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    externalDepth: new THREE.MeshBasicMaterial(),
    spacedMaterial: ctx.spacedMaterial,
    externalMaterial: ctx.externalMaterial,
  }
}

function spacedClones(scene: Scene, m: ReturnType<typeof mats>): Mesh[] {
  return scene.children.filter((n): n is Mesh =>
    (n as Mesh).isMesh && (n as Mesh).material !== m.omit && (n as Mesh).material !== m.spacedOmit)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('populateSpacedArmorScene 同板去重装配', () => {
  it('闭合网格保持单 clone FrontSide、无 stencil 状态', () => {
    const m = mats()
    const scene = new THREE.Scene()
    populateSpacedArmorScene(scene, {
      primary: [],
      spaced: [spacedMesh(new THREE.BoxGeometry(1, 1, 1), 'gun', '2')],
      external: [],
    }, m, 200, null)
    const clones = spacedClones(scene, m)
    expect(clones).toHaveLength(1)
    const mat = clones[0].material as THREE.Material
    expect(SIDES.get(mat.side)).toBe('front')
    expect(mat.stencilWrite).toBe(false)
    expect(clones[0].renderOrder).toBe(2)
    m.ctx.dispose()
  })

  it('开放网格拆 front/back 两 clone：front 写位（Always+Replace），back 测位（NotEqual，只测不写）', () => {
    const m = mats()
    const scene = new THREE.Scene()
    populateSpacedArmorScene(scene, {
      primary: [],
      spaced: [spacedMesh(openShellGeometry(), 'gun', '2')],
      external: [],
    }, m, 200, null)
    const clones = spacedClones(scene, m)
    expect(clones).toHaveLength(2)
    const front = clones.find((c) => c.renderOrder === 2)!
    const back = clones.find((c) => c.renderOrder === 2.1)!
    expect(front).toBeTruthy()
    expect(back).toBeTruthy()
    const fm = front.material as THREE.Material
    const bm = back.material as THREE.Material
    expect(SIDES.get(fm.side)).toBe('front')
    expect(SIDES.get(bm.side)).toBe('back')
    expect(fm.stencilWrite).toBe(true)
    expect(fm.stencilFunc).toBe(THREE.AlwaysStencilFunc)
    expect(fm.stencilRef).toBe(0x01)
    expect(fm.stencilWriteMask).toBe(0x01)
    expect(fm.stencilZPass).toBe(THREE.ReplaceStencilOp)
    expect(fm.stencilFail).toBe(THREE.KeepStencilOp)
    expect(fm.stencilZFail).toBe(THREE.KeepStencilOp)
    expect(bm.stencilWrite).toBe(true)
    expect(bm.stencilFunc).toBe(THREE.NotEqualStencilFunc)
    expect(bm.stencilRef).toBe(0x01)
    expect(bm.stencilFuncMask).toBe(0x01)
    expect(bm.stencilWriteMask).toBe(0)
    expect(bm.stencilZPass).toBe(THREE.KeepStencilOp)
    expect(bm.stencilFail).toBe(THREE.KeepStencilOp)
    expect(bm.stencilZFail).toBe(THREE.KeepStencilOp)
    expect(front.userData._baseThickness).toBe(120)
    expect(back.userData._baseThickness).toBe(120)
    m.ctx.dispose()
  })

  it('同 plateId 拆多网格共享同一位（与点击链键级去重同粒度）', () => {
    const m = mats()
    const scene = new THREE.Scene()
    populateSpacedArmorScene(scene, {
      primary: [],
      spaced: [
        spacedMesh(openShellGeometry(), 'gun', '2'),
        spacedMesh(openShellGeometry(), 'gun', '2'),
        spacedMesh(openShellGeometry(), 'hull', '6'),
      ],
      external: [],
    }, m, 200, null)
    const clones = spacedClones(scene, m)
    expect(clones).toHaveLength(6)
    const bitsAt = (order: number) => new Set(clones.filter((c) => c.renderOrder === order).map((c) => (c.material as THREE.Material).stencilRef))
    expect(bitsAt(2)).toEqual(new Set([0x01, 0x02]))
    expect(bitsAt(2.1)).toEqual(new Set([0x01, 0x02]))
    m.ctx.dispose()
  })

  it('开放键超 8 位 → 整车开放网格回退单 clone 双面累计并显式报告（fail-closed）', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = mats()
    const scene = new THREE.Scene()
    populateSpacedArmorScene(scene, {
      primary: [],
      spaced: Array.from({ length: 9 }, (_, i) => spacedMesh(openShellGeometry(), 'gun', String(i))),
      external: [],
    }, m, 200, null)
    const clones = spacedClones(scene, m)
    expect(clones).toHaveLength(9)
    for (const c of clones) {
      const mat = c.material as THREE.Material
      expect(SIDES.get(mat.side)).toBe('double')
      expect(mat.stencilWrite).toBe(false)
    }
    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(errSpy.mock.calls[0][0]).toContain('stencil bits')
    m.ctx.dispose()
  })
})

describe('stencil 去重与点击链去重判据（resolveSpacedHitMask）给出同一层数', () => {
  const CASES: Array<{ name: string; crossings: Array<{ face: 'front' | 'back'; key: string }> }> = [
    { name: '开放壳体入/出（炮盾）：出射面与入射面同板', crossings: [{ face: 'front', key: 'gun:2' }, { face: 'back', key: 'gun:2' }] },
    { name: '从背面看的单面屏：入射面即背面，必须计入', crossings: [{ face: 'back', key: 'hull:6' }] },
    { name: '叠放屏：近屏正面 + 远屏背面（双侧裙板）', crossings: [{ face: 'front', key: 'gun:2' }, { face: 'back', key: 'hull:6' }] },
    { name: 'S 形双正面穿越：两折都计（front 恒计）', crossings: [{ face: 'front', key: 'gun:2' }, { face: 'front', key: 'gun:2' }] },
    { name: '闭合壳体从外穿入：出射 back 被同键抑制', crossings: [{ face: 'front', key: 'turret:10' }, { face: 'back', key: 'turret:10' }, { face: 'front', key: 'hull:5' }] },
    { name: '近背远正同键：背面更近、入射面更远', crossings: [{ face: 'back', key: 'gun:2' }, { face: 'front', key: 'gun:2' }] },
    { name: '同键仅背面：两片背面朝向相机', crossings: [{ face: 'back', key: 'gun:7' }, { face: 'back', key: 'gun:7' }] },
    { name: '折面 back→front→back：集合判据与深度无关', crossings: [{ face: 'back', key: 'gun:2' }, { face: 'front', key: 'gun:2' }, { face: 'back', key: 'gun:2' }] },
  ]

  for (const { name, crossings } of CASES) {
    it(name, () => {
      const keep = resolveSpacedHitMask(crossings.map((c) => ({ key: c.key, spaced: true, backface: c.face === 'back' })))
      const cpuLayers = keep.filter(Boolean).length
      const { bits } = assignSpacedStencilBits([...new Set(crossings.map((c) => c.key))])
      let gpuLayers = 0
      const stencil = new Set<number>()
      for (const c of crossings) {
        if (c.face !== 'front') continue
        stencil.add(bits.get(c.key)!)
        gpuLayers++
      }
      for (const c of crossings) {
        if (c.face === 'front') continue
        if (stencil.has(bits.get(c.key)!)) continue
        gpuLayers++
      }
      expect(gpuLayers).toBe(cpuLayers)
    })
  }

  it('位分配键与点击链键同构（spacedDedupKey 粒度）', () => {
    expect(assignSpacedStencilBits([spacedDedupKey('gun', 'spaced', '2')]).bits.get('gun:2')).toBe(0x01)
  })
})
