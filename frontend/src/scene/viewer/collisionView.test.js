// @vitest-environment happy-dom
// 装甲视图 owner 的行为回归（#820 review P1-B / P2-A / P2-B / P2-C / P2-E）：
// 动态装甲状态必须经 armorMeshState.applyArmorStateToMesh 落到网格；
// 热力图 clone 更新/跳弹重建必须真正执行并携带新激活板集；
// 分类过滤通过 collisionView 的显式操作完成，judgment 仍是有有效可见性的唯一口径。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createCollisionView } from './collisionView.js'
import { createJudgment } from './judgment.js'
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

    // 默认态 0：armor_13 激活、armor_14 按 deco 口径摘除。
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

    // 切到非默认态 1：板集互换，厚度/材质重新落到网格上。
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
    expect(inactive.material.transparent).toBe(true)
    expect(inactive.material.opacity).toBe(0.95)
    expect(inactive.material.depthWrite).toBe(true)
    expect(inactive.material.color.getHex()).toBe(0x123456)
    expect(activeDefault.visible).toBe(false)
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

    // façade 不再持有 hiddenCategories：唯一状态在 collisionView。
    const facade = readFileSync(resolve(process.cwd(), 'src/scene/tankViewer.js'), 'utf8')
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
    // judgment 是有效可见性的唯一 owner；collisionView 只消费它。
    cvs.setHighlightedArmorNode(spaced)
    expect(judgment.isEffectivelyVisible(spaced)).toBe(true)

    cvs.toggleCategory('spaced')

    expect(spaced.visible).toBe(false)
    expect(judgment.isEffectivelyVisible(spaced)).toBe(false)
    expect(cvs.getHighlightedArmorNode()).toBeNull()
    expect(clickInfoCard().style.display).toBe('none')
  })
})
