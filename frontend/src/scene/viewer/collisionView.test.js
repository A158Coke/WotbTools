// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createCollisionView } from './collisionView.js'
import { createJudgment } from './judgment.js'
import { tankViewerSource } from '../__tests__/sceneSource.ts'
import { dynamicDeclarationByTankId } from '../../data/armorStates.js'

const THICKNESS = {
  'hull:13': 100,
  'hull:14': 120,
  'space:20': 20,
}

function makeArmorMesh(name, section = 'deco', thickness = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
  mesh.name = name
  mesh.userData.armorSection = section
  mesh.userData.armorThickness = thickness
  return mesh
}

function makeModuleMesh(name, plateId, thickness = 20, section = 'chassis') {
  const mesh = makeArmorMesh(name, section, thickness)
  mesh.userData.armorPlateId = plateId
  return mesh
}

function makeView({ modules = [], hmOverrides = {} } = {}) {
  const armorModel = new THREE.Group()
  const tankModel = new THREE.Group()
  const models = { armorModel, tankModel }
  let collisionMode = false
  let penetrationMode = false
  const hm = {
    applyArmorStateToHeatmapClones: vi.fn(),
    rebuildRicochetPack: vi.fn(),
    getPrimaryArmorScene: () => null,
    getGunClipPlane: () => null,
    computeGunClipPlane: vi.fn(),
    ...hmOverrides,
  }
  const rig = {
    applyConfigVisible: vi.fn(),
    updateTurretGun: vi.fn(),
    alignArmorModules: vi.fn(),
    getLastAppliedTurretDeg: () => 0,
    getLastAppliedGunDeg: () => 0,
  }
  const cvs = createCollisionView({
    models,
    getModuleMeshes: () => modules,
    hmRef: () => hm,
    rig,
    ml: { retagSpacedSections: vi.fn() },
    getRenderer: () => null,
    getTankData: () => ({ armor_model: {} }),
    getCurrentConfig: () => ({ turret_index: 0, gun_index: 0 }),
    getActiveGunNumber: () => 0,
    getPenetrationMode: () => penetrationMode,
    getCollisionMode: () => collisionMode,
    getPlateThickness: (section, plateId) => THICKNESS[section + ':' + plateId] ?? null,
    thicknessToColor: () => 0x123456,
    isEffectivelyVisible: (node) => node.visible,
  })
  return {
    cvs, hm, rig, models, armorModel, tankModel, modules,
    setCollisionMode(value) { collisionMode = value },
    setPenetrationMode(value) { penetrationMode = value },
  }
}

function clickInfoCard() {
  return document.getElementById('click-info')
}

beforeEach(() => {
  document.body.innerHTML = [
    '<button id="filter-primary" class="active" aria-pressed="true"></button>',
    '<button id="filter-spaced" class="active" aria-pressed="true"></button>',
    '<button id="filter-external" class="active" aria-pressed="true"></button>',
    '<div id="click-info" style="display:block"></div>',
    '<div id="armor-state-opt"></div>',
    '<input id="armor-state-toggle" type="checkbox">',
  ].join('')
})

describe('collisionView dynamic armor state (P1-B)', () => {
  it('applies default/non-default states to controlled plates with thickness and material', () => {
    const { cvs, armorModel, rig } = makeView()
    const activeDefault = makeArmorMesh('hull_state_01_armor_13')
    const inactive = makeArmorMesh('hull_state_01_armor_14')
    armorModel.add(activeDefault, inactive)

    cvs.resolveArmorStateDecl(8305)
    cvs.applyArmorStateToModel()

    expect(activeDefault.visible).toBe(true)
    expect(activeDefault.userData.armorSection).toBe('hull')
    expect(activeDefault.userData.armorSectionOrig).toBe('hull')
    expect(activeDefault.userData.armorStateHidden).toBe(false)
    expect(activeDefault.userData.armorThickness).toBe(100)
    expect(activeDefault.material.transparent).toBe(true)
    expect(activeDefault.material.opacity).toBe(0)

    expect(inactive.visible).toBe(false)
    expect(inactive.userData.armorSection).toBe('deco')
    expect(inactive.userData.armorStateHidden).toBe(true)
    expect(inactive.userData.armorThickness).toBe(120)

    cvs.setArmorState(1)

    expect(activeDefault.visible).toBe(false)
    expect(activeDefault.userData.armorSection).toBe('deco')
    expect(activeDefault.userData.armorStateHidden).toBe(true)
    expect(inactive.visible).toBe(true)
    expect(inactive.userData.armorSection).toBe('hull')
    expect(inactive.userData.armorThickness).toBe(120)
    expect(inactive.material.transparent).toBe(true)
    expect(inactive.material.opacity).toBe(0)
    expect(rig.alignArmorModules).toHaveBeenCalled()
    expect(rig.updateTurretGun).toHaveBeenCalledWith(0, 0)
  })

  it('uses collision-mode material style for newly activated plates', () => {
    const { cvs, armorModel, setCollisionMode } = makeView()
    const activeDefault = makeArmorMesh('hull_state_01_armor_13')
    const inactive = makeArmorMesh('hull_state_01_armor_14')
    armorModel.add(activeDefault, inactive)
    cvs.resolveArmorStateDecl(8305)
    cvs.applyArmorStateToModel()

    setCollisionMode(true)
    cvs.setArmorState(1)

    expect(inactive.visible).toBe(true)
    expect(inactive.material.isMeshBasicMaterial).toBe(true)
    expect(inactive.material.transparent).toBe(false)
    expect(inactive.material.opacity).toBe(1)
    expect(inactive.material.depthWrite).toBe(true)
    expect(inactive.material.color.getHex()).toBe(0x123456)
    expect(activeDefault.visible).toBe(false)
  })

  it('keeps the selected fixed plate highlighted across dynamic state changes', () => {
    const fixed = makeArmorMesh('hull_armor_12', 'hull', 80)
    fixed.userData.armorPlateId = '12'
    const activeDefault = makeArmorMesh('hull_state_01_armor_13')
    const inactive = makeArmorMesh('hull_state_01_armor_14')
    const { cvs, armorModel, setCollisionMode } = makeView()
    armorModel.add(fixed, activeDefault, inactive)
    cvs.resolveArmorStateDecl(8305)
    cvs.applyArmorStateToModel()

    setCollisionMode(true)
    cvs.applyArmorViewStyle(true)
    cvs.applyArmorHighlight(fixed)
    expect(fixed.material.opacity).toBe(1)

    cvs.setArmorState(1)

    // 新激活的板必须重新进入“未选中”态，不能以默认不透明材质盖住当前选中板。
    expect(inactive.visible).toBe(true)
    expect(inactive.material.opacity).toBe(0.18)
    expect(inactive.material.transparent).toBe(true)
    expect(inactive.material.depthWrite).toBe(false)
    expect(inactive.children.find(child => child.isLineSegments).visible).toBe(false)
    expect(fixed.material.opacity).toBe(1)
    expect(fixed.children.find(child => child.isLineSegments).visible).toBe(true)
  })

  it('clears the selection when a dynamic state hides the selected plate', () => {
    const activeDefault = makeArmorMesh('hull_state_01_armor_13')
    const inactive = makeArmorMesh('hull_state_01_armor_14')
    const { cvs, armorModel, setCollisionMode } = makeView()
    armorModel.add(activeDefault, inactive)
    cvs.resolveArmorStateDecl(8305)
    cvs.applyArmorStateToModel()

    setCollisionMode(true)
    cvs.applyArmorViewStyle(true)
    cvs.applyArmorHighlight(activeDefault)

    cvs.setArmorState(1)

    expect(cvs.getHighlightedArmorNode()).toBeNull()
    expect(clickInfoCard().style.display).toBe('none')
    expect(inactive.material.opacity).toBe(1)
    expect(inactive.children.find(child => child.isLineSegments).visible).toBe(true)
  })
})

describe('collisionView deferred heatmap operations (P2-A)', () => {
  it('invokes the heatmap methods and forwards the active plate set', () => {
    const { cvs, armorModel, hm, setPenetrationMode } = makeView({
      hmOverrides: {
        applyArmorStateToHeatmapClones: vi.fn(),
        rebuildRicochetPack: vi.fn(),
      },
    })
    armorModel.add(
      makeArmorMesh('hull_state_01_armor_13'),
      makeArmorMesh('hull_state_01_armor_14'),
    )
    cvs.resolveArmorStateDecl(8305)
    cvs.applyArmorStateToModel()
    setPenetrationMode(true)

    cvs.setArmorState(1)

    expect(hm.applyArmorStateToHeatmapClones).toHaveBeenCalledTimes(1)
    expect(hm.applyArmorStateToHeatmapClones).toHaveBeenCalledWith(new Set(['gun:14', 'hull:14']))
    expect(hm.rebuildRicochetPack).toHaveBeenCalledTimes(1)
  })
})

describe('collisionView explicit owner interface (P2-B)', () => {
  it('exposes nonDefaultStateId and syncModuleClipPlanes', () => {
    const { cvs, modules, hm } = makeView()
    const plateMaterial = new THREE.MeshStandardMaterial()
    const gunBarrel = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), plateMaterial)
    gunBarrel.userData.armorSection = 'gunBarrel'
    gunBarrel.userData.collisionSolidMaterial = plateMaterial
    modules.push(gunBarrel)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1)
    hm.getGunClipPlane = () => plane

    expect(typeof cvs.nonDefaultStateId).toBe('function')
    expect(typeof cvs.syncModuleClipPlanes).toBe('function')
    expect(cvs.nonDefaultStateId(dynamicDeclarationByTankId(8305))).toBe(1)

    cvs.syncModuleClipPlanes()
    expect(plateMaterial.clippingPlanes).toEqual([plane])
    const versionWithClip = plateMaterial.version

    hm.getGunClipPlane = () => null
    cvs.syncModuleClipPlanes()
    expect(plateMaterial.clippingPlanes).toBeNull()
    expect(plateMaterial.version).toBeGreaterThan(versionWithClip)
  })
})

describe('collisionView category filtering (P2-C / P2-E)', () => {
  it('toggles categories through collisionView instead of mutating a second state map', () => {
    const { cvs, armorModel } = makeView()
    const spaced = makeArmorMesh('turret_01_armor_20', 'spaced', 20)
    armorModel.add(spaced)

    expect(cvs.toggleCategory('spaced')).toBe(false)
    expect(spaced.visible).toBe(false)
    const button = document.getElementById('filter-spaced')
    expect(button.classList.contains('active')).toBe(false)
    expect(button.getAttribute('aria-pressed')).toBe('false')

    expect(cvs.toggleCategory('spaced')).toBe(true)
    expect(spaced.visible).toBe(true)
    expect(button.classList.contains('active')).toBe(true)
    expect(button.getAttribute('aria-pressed')).toBe('true')

    expect(cvs.toggleCategory('unknown')).toBeNull()
    expect(spaced.visible).toBe(true)

    const facade = tankViewerSource()
    expect(facade).not.toContain('hiddenCategories')
    expect(facade).toContain('cvs.toggleCategory(name)')
  })

  it('resets a highlighted plate when its category becomes invisible (P2-E)', () => {
    const { cvs, armorModel, setCollisionMode } = makeView()
    const spaced = makeArmorMesh('turret_01_armor_20', 'spaced', 20)
    spaced.userData.armorPlateId = '20'
    armorModel.add(spaced)
    setCollisionMode(true)

    const judgment = createJudgment({
      models: { armorModel, tankModel: null },
      hm: {},
      tc: {},
      cvs: {},
    })
    cvs.setHighlightedArmorNode(spaced)
    expect(judgment.isEffectivelyVisible(spaced)).toBe(true)

    cvs.toggleCategory('spaced')

    expect(spaced.visible).toBe(false)
    expect(judgment.isEffectivelyVisible(spaced)).toBe(false)
    expect(cvs.getHighlightedArmorNode()).toBeNull()
    expect(clickInfoCard().style.display).toBe('none')
  })
})

describe('thickness view BlitzKit-style appearance', () => {
  it('uses flat category materials, BlitzKit opacities and non-pickable outlines', () => {
    const primary = makeArmorMesh('hull_armor_13', 'hull', 100)
    const spaced = makeArmorMesh('turret_armor_20', 'spaced', 20)
    spaced.userData.armorPlateId = '20'
    const track = makeModuleMesh('chassis_track_L', 'leftTrack', 20)
    const gun = makeModuleMesh('gun_01_barrel', 'gun', 80, 'gunBarrel')
    const { cvs, armorModel, setCollisionMode } = makeView({ modules: [track, gun] })
    armorModel.add(primary, spaced)

    setCollisionMode(true)
    cvs.applyArmorViewStyle(true)

    expect(primary.material.isMeshBasicMaterial).toBe(true)
    expect(primary.material.toneMapped).toBe(false)
    expect(primary.material.opacity).toBe(1)
    expect(primary.material.transparent).toBe(false)
    expect(primary.material.depthWrite).toBe(true)

    expect(spaced.material.isMeshBasicMaterial).toBe(true)
    expect(spaced.material.opacity).toBeCloseTo(0.6)
    expect(spaced.material.transparent).toBe(true)
    expect(spaced.material.depthWrite).toBe(true)
    expect(spaced.material.side).toBe(THREE.DoubleSide)

    for (const module of [track, gun]) {
      expect(module.material.isMeshBasicMaterial).toBe(true)
      expect(module.material.opacity).toBeCloseTo(0.125)
      expect(module.material.transparent).toBe(true)
      expect(module.material.depthWrite).toBe(false)
    }

    const outlines = (mesh) => mesh.children.filter(child => child.isLineSegments)
    for (const mesh of [primary, spaced, track, gun]) {
      expect(outlines(mesh)).toHaveLength(1)
      const hits = []
      outlines(mesh)[0].raycast(new THREE.Raycaster(), hits)
      expect(hits).toHaveLength(0)
    }

    // 换配置/重进视图会反复调用 applyArmorViewStyle：勾线只能复用，不能重复挂载。
    cvs.applyArmorViewStyle(true)
    for (const mesh of [primary, spaced, track, gun]) expect(outlines(mesh)).toHaveLength(1)

    cvs.applyArmorViewStyle(false)
    for (const mesh of [primary, spaced, track, gun]) expect(outlines(mesh)).toHaveLength(0)
  })
})

describe('thickness view track module highlight', () => {
  it('highlights the whole left/right chassis side from any child mesh', () => {
    const leftTrack = makeModuleMesh('chassis_track_L', 'leftTrack', 20)
    const leftWheel = makeModuleMesh('chassis_wheel_L_01', 'leftTrack', 20)
    const rightTrack = makeModuleMesh('chassis_track_R', 'rightTrack', 20)
    const rightWheel = makeModuleMesh('chassis_wheel_R_01', 'rightTrack', 20)
    const hull = makeArmorMesh('hull_armor_13', 'hull', 100)
    const { cvs, armorModel, setCollisionMode } = makeView({
      modules: [leftTrack, leftWheel, rightTrack, rightWheel],
    })
    armorModel.add(hull)
    setCollisionMode(true)
    cvs.applyArmorViewStyle(true)

    cvs.applyArmorHighlight(leftWheel)

    for (const mesh of [leftTrack, leftWheel]) {
      expect(mesh.material.opacity).toBe(1)
      expect(mesh.material.transparent).toBe(false)
      expect(mesh.material.depthWrite).toBe(true)
      expect(mesh.children.find(child => child.isLineSegments).visible).toBe(true)
    }
    for (const mesh of [rightTrack, rightWheel]) {
      expect(mesh.material.opacity).toBe(0.15)
      expect(mesh.material.transparent).toBe(true)
      expect(mesh.material.depthWrite).toBe(false)
      expect(mesh.children.find(child => child.isLineSegments).visible).toBe(false)
    }
    expect(hull.material.opacity).toBe(0.18)
    expect(hull.children.find(child => child.isLineSegments).visible).toBe(false)

    cvs.resetArmorHighlight()
    for (const mesh of [leftTrack, leftWheel, rightTrack, rightWheel]) {
      expect(mesh.material.opacity).toBeCloseTo(0.125)
      expect(mesh.material.depthWrite).toBe(false)
      expect(mesh.children.find(child => child.isLineSegments).visible).toBe(true)
    }
    expect(hull.material.opacity).toBe(1)
    expect(hull.children.find(child => child.isLineSegments).visible).toBe(true)
  })
})
