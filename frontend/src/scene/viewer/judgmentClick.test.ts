// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createJudgmentClick } from './judgmentClick.js'

function makeHarness() {
  const fxScene = new THREE.Scene()
  const armorModel = new THREE.Group()
  const tankModel = new THREE.Group()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
  mesh.name = 'hull_armor_13'
  mesh.userData.armorSection = 'hull'
  mesh.userData.armorPlateId = '13'
  mesh.userData.armorThickness = 100
  armorModel.add(mesh)
  armorModel.updateMatrixWorld(true)
  fxScene.add(armorModel)

  const marker = new THREE.Object3D()
  window.__hitMarker = marker
  fxScene.add(marker)

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(0, 0, 5)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  const raycaster = new THREE.Raycaster()
  const tc = { tidyTrajectory: vi.fn() }
  const cvs = { applyArmorHighlight: vi.fn(), resetArmorHighlight: vi.fn() }
  const deps = {
    models: { armorModel, tankModel },
    hm: { getGunClipPlane: () => null },
    tc,
    cvs,
    getRenderer: () => ({ domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }) } }),
    getCamera: () => camera,
    getControls: () => ({ target: new THREE.Vector3() }),
    getRaycaster: () => raycaster,
    getMouse: () => new THREE.Vector2(),
    getFxScene: () => fxScene,
    getCurrentConfigIdx: () => 0,
    getCollisionMode: () => true,
    getPenetrationMode: () => false,
    getWorldOverviewMode: () => false,
    getTankData: () => null,
    getCurrentConfig: () => null,
    getActiveGunNumber: () => 0,
    getSelectedShell: () => null,
    getShooterShells: () => [],
    getShooterCaliber: () => null,
    getShooterData: () => null,
    isDestroyed: () => false,
    isShooterLoading: () => false,
    isShotReplay: () => false,
    armorDebug: () => false,
    getModuleMeshes: () => [],
    getWorldMetersPerUnit: () => 1,
    getPlateThickness: () => 100,
    equipmentCoeffs: () => ({ penMul: 1, thickMul: 1 }),
    effectiveCalibrated: () => 1,
    effectiveEnhanced: () => 1,
    shellPenMul: () => 1,
    L: { partName: (name: string) => name, shellUnavailable: 'shell unavailable' },
    showShotError: vi.fn(),
  }
  const classifyHit = () => ({
    section: 'hull',
    plateId: '13',
    thickness: 100,
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 0, 1),
    partName: 'Hull Plate 13',
    distance: 1,
    object: mesh,
    backface: false,
  })
  const invalidate = vi.fn()
  const click = createJudgmentClick(
    deps as unknown as Parameters<typeof createJudgmentClick>[0],
    classifyHit as Parameters<typeof createJudgmentClick>[1],
    () => ({ angleDeg: 0, effective: 100 }),
    () => {},
    invalidate,
  )
  return { click, fxScene, marker, tc, cvs, invalidate }
}

beforeEach(() => {
  document.body.innerHTML = '<div id="click-info"></div>'
  window.__hitMarker = null
})

describe('showArmorPartInfo (thickness mode)', () => {
  it('厚度模式点击先失效在途判定，再清轨迹与上一发命中点', () => {
    const { click, fxScene, marker, tc, cvs, invalidate } = makeHarness()
    window.__hitMarker = marker
    fxScene.add(marker)

    click.showArmorPartInfo(new MouseEvent('click'), 0, 0)

    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(tc.tidyTrajectory).toHaveBeenCalledTimes(1)
    expect(fxScene.children).not.toContain(marker)
    expect(window.__hitMarker).toBeNull()
    expect(cvs.applyArmorHighlight).toHaveBeenCalledTimes(1)
  })
})