// @vitest-environment happy-dom
// 热力图叠加层生命周期（#827 接替 heHeatmapProjection.test.js:76）：
// 释放后必须把 Scene 引用一并置 null（只 clear() 不置 null 会让「已构建」判断始终
// truthy、重建永不发生，评审 P2）——dispose → getPrimaryArmorScene() null → 重建非空新实例。
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createHeatmapPipeline } from './heatmap.js'
import { createTurretRig } from './turretRig.js'

const TANK_DATA = {
  model_origins: { track: [0, 1, 0], turret: [0, 2, 0], gun: [0, 0, 0] },
  visual_model_url: '/glb/123/model.glb',
  armor_model: {},
}

const CONFIG = {
  gun_index: 0,
  turret_index: 0,
  gun_mask: 0.5,
  gun_origin: [0, 1, 0],
  turret_spaced: [],
  gun_spaced: [],
  pitch_limits: { max: 20, min: -10 },
}

function makeTurretPlate() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ], 3))
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
  mesh.name = 'turret_01_armor_11'
  mesh.userData.armorSection = 'turret'
  mesh.userData.armorThickness = 100
  return mesh
}

function makePipeline() {
  const camera = new THREE.PerspectiveCamera()
  const tankModel = new THREE.Group()
  const armorModel = new THREE.Group()
  armorModel.add(makeTurretPlate())
  const rig = createTurretRig({
    getTankModel: () => tankModel,
    getArmorModel: () => armorModel,
    getTankData: () => TANK_DATA,
    getConfig: () => CONFIG,
    updateCollisionWorldMatrices: vi.fn(),
    getCollisionMode: () => false,
    computeGunClipPlane: vi.fn(),
    syncModuleClipPlanes: vi.fn(),
    invalidateRicochetPose: vi.fn(),
  })
  const hm = createHeatmapPipeline({
    models: { tankModel, armorModel },
    rig,
    getWorldMetersPerUnit: () => 1,
    getModuleMeshes: () => [],
    getRenderer: () => ({ render: vi.fn(), autoClear: true, setRenderTarget: vi.fn(), domElement: { width: 1280, height: 720 } } as never),
    getCamera: () => camera,
    getTankData: () => TANK_DATA,
    getCurrentConfig: () => CONFIG,
    getActiveGunNumber: () => 0,
    getSelectedShell: () => null,
    getShooterShells: () => [],
    getPenetrationMode: () => false,
    getCollisionMode: () => false,
    equipmentCoeffs: () => ({ thickMul: 1 }),
    resolveCaliberFor: () => 0,
    applyArmorViewStyle: vi.fn(),
    getFxScene: () => new THREE.Scene(),
    getScene: () => new THREE.Scene(),
    applyCategoryFilters: vi.fn(),
  })
  return hm
}

describe('heatmap 叠加层释放/重建生命周期', () => {
  it('build → dispose → getPrimaryArmorScene() null → 重建为全新非空实例（评审 P2）', () => {
    const hm = makePipeline()
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    // 未构建：引用为 null（「已构建」判断依赖同一引用）
    expect(hm.getPrimaryArmorScene()).toBeNull()

    hm.rebuildHeatmapScenes()
    const first = hm.getPrimaryArmorScene()
    expect(first).not.toBeNull()
    expect(first!.children.length).toBeGreaterThan(0)

    // 释放：三个 Scene 清空后引用一并置 null（不是 truthy 空场景）
    hm.disposePenetrationResources()
    expect(hm.getPrimaryArmorScene()).toBeNull()

    // 重建走 rebuildHeatmapScenes（null 时「已构建」判断不再跳过）：全新机械
    hm.rebuildHeatmapScenes()
    const second = hm.getPrimaryArmorScene()
    expect(second).not.toBeNull()
    expect(second).not.toBe(first)
    expect(second!.children.length).toBeGreaterThan(0)
  })
})
