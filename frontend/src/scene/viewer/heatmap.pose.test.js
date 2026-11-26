// @vitest-environment happy-dom
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

function makePipeline({ rig, models }) {
  const camera = new THREE.PerspectiveCamera()
  return createHeatmapPipeline({
    models,
    rig,
    getWorldMetersPerUnit: () => 1,
    getModuleMeshes: () => [],
    getRenderer: () => ({ render: vi.fn() }),
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
}

function makeRig({ tankModel, armorModel, onPoseChanged = vi.fn() }) {
  return createTurretRig({
    getTankModel: () => tankModel,
    getArmorModel: () => armorModel,
    getTankData: () => TANK_DATA,
    getConfig: () => CONFIG,
    updateCollisionWorldMatrices: vi.fn(),
    getCollisionMode: () => false,
    computeGunClipPlane: vi.fn(),
    syncModuleClipPlanes: vi.fn(),
    invalidateRicochetPose: onPoseChanged,
  })
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

describe('heatmap + turret rig pose ownership', () => {
  it('gun_mask clip plane follows the rig gun pose matrix', () => {
    const tankModel = new THREE.Group()
    const turret = new THREE.Group()
    turret.name = 'turret_01'
    const gun = new THREE.Group()
    gun.name = 'gun_01'
    tankModel.add(turret, gun)
    const armorModel = new THREE.Group()
    const rig = makeRig({ tankModel, armorModel })
    const hm = makePipeline({ rig, models: { tankModel, armorModel } })
    rig.collectConfigNodes(tankModel)

    rig.updateTurretGun(90, 0)
    hm.computeGunClipPlane()
    const plane = hm.getGunClipPlane()

    expect(plane).toBeTruthy()
    expect(plane.normal.x).toBeCloseTo(-1, 5)
    expect(plane.normal.y).toBeCloseTo(0, 5)
    expect(plane.normal.z).toBeCloseTo(0, 5)
    expect(rig.gunPoseMatrix.equals(new THREE.Matrix4())).toBe(false)
  })

  it('invalidates cached collision geometry synchronously after a rig pose change', () => {
    const tankModel = new THREE.Group()
    const turret = new THREE.Group()
    turret.name = 'turret_01'
    const gun = new THREE.Group()
    gun.name = 'gun_01'
    tankModel.add(turret, gun)
    const armorModel = new THREE.Group()
    const plate = makeTurretPlate()
    armorModel.add(plate)
    const invalidate = vi.fn()
    const rig = makeRig({ tankModel, armorModel, onPoseChanged: invalidate })
    const hm = makePipeline({ rig, models: { tankModel, armorModel } })
    invalidate.mockImplementation(() => hm.invalidateRicochetPose())
    rig.collectConfigNodes(tankModel)

    hm.rebuildRicochetPack()
    const initialPack = hm.getRicochetPack()
    expect(initialPack.ok).toBe(true)
    const initialMatrices = Array.from(initialPack.matsData)

    rig.updateTurretGun(90, 0)

    expect(invalidate).toHaveBeenCalled()
    expect(hm.isRicochetPoseDirty()).toBe(true)
    const splash = hm.buildSplashGeometry()
    expect(splash.pack.ok).toBe(true)
    expect(splash.pack).not.toBe(initialPack)
    expect(Array.from(splash.pack.matsData)).not.toEqual(initialMatrices)
  })

  it('reuses pack/grid when the pose is unchanged (no per-frame rebuild)', () => {
    const tankModel = new THREE.Group()
    const armorModel = new THREE.Group()
    armorModel.add(makeTurretPlate())
    const rig = makeRig({ tankModel, armorModel })
    const hm = makePipeline({ rig, models: { tankModel, armorModel } })

    hm.rebuildRicochetPack()
    const generation = hm.getRicochetGridGeneration()
    const first = hm.buildSplashGeometry()
    const second = hm.buildSplashGeometry()

    expect(first.pack.ok).toBe(true)
    expect(first.grid.ok).toBe(true)
    expect(second.pack).toBe(first.pack)
    expect(second.grid).toBe(first.grid)

    hm.prepareRicochetFrame()
    expect(hm.getRicochetGridGeneration()).toBe(generation)
    expect(hm.isRicochetPoseDirty()).toBe(false)
  })

  it('stays fail-closed when the dirty rebuild has no usable collision geometry', () => {
    const tankModel = new THREE.Group()
    const armorModel = new THREE.Group()
    const rig = makeRig({ tankModel, armorModel })
    const hm = makePipeline({ rig, models: { tankModel, armorModel } })

    hm.invalidateRicochetPose()
    const splash = hm.buildSplashGeometry()
    expect(splash.pack.ok).toBe(false)
    expect(splash.grid.ok).toBe(false)
    expect(hm.getRicochetPack()).toBeNull()
  })
})
