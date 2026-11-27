import * as THREE from 'three'
import type { Material, Mesh, Object3D, Plane, Side } from 'three'
import { assignSpacedStencilBits, isClosedSurfaceGeometry, spacedDedupKey, SPACED_STENCIL_BIT_LIMIT } from '../armorMeshTopology.js'

export function addClone(scene: Object3D, src: Mesh, mat: Material, renderOrder: number): Mesh {
  const m = new THREE.Mesh(src.geometry, mat)
  m.renderOrder = renderOrder
  m.userData._src = src
  src.updateWorldMatrix(true, false)
  m.matrixAutoUpdate = false
  m.matrix.copy(src.matrixWorld)
  scene.add(m)
  return m
}

function tagStateClone(clone: Mesh, src: Mesh | null | undefined): void {
  if (src && src.userData.armorStateKey) {
    clone.userData._armorStateKey = src.userData.armorStateKey
    clone.visible = src.userData.armorStateHidden !== true
  }
}

export interface SpacedArmorSceneMats {
  omit: Material
  spacedOmit: Material
  externalDepth: Material
  spacedMaterial(t: number, pen: number, side: Side): Material
  externalMaterial(t: number, pen: number, clip: Plane | null): Material
}

function applySpacedFrontStencil(m: Material, bit: number): void {
  m.stencilWrite = true
  m.stencilFunc = THREE.AlwaysStencilFunc
  m.stencilRef = bit
  m.stencilWriteMask = bit
  m.stencilFail = THREE.KeepStencilOp
  m.stencilZFail = THREE.KeepStencilOp
  m.stencilZPass = THREE.ReplaceStencilOp
}
function applySpacedBackStencil(m: Material, bit: number): void {
  m.stencilWrite = true
  m.stencilWriteMask = 0
  m.stencilFunc = THREE.NotEqualStencilFunc
  m.stencilFuncMask = bit
  m.stencilRef = bit
  m.stencilFail = THREE.KeepStencilOp
  m.stencilZFail = THREE.KeepStencilOp
  m.stencilZPass = THREE.KeepStencilOp
}
function openSpacedKey(node: Mesh): string {
  return spacedDedupKey(node.userData.armorSectionOrig, node.userData.armorSection, node.userData.armorPlateId)
}

export function populateSpacedArmorScene(scene: Object3D, meshes: { primary: readonly Mesh[]; spaced: readonly Mesh[]; external: readonly Mesh[] }, mats: SpacedArmorSceneMats, pen: number, gunClipPlane: Plane | null | undefined): void {
  meshes.primary.forEach(function(node) {
    const c = addClone(scene, node, mats.omit, 0)
    tagStateClone(c, node)
  })
  const openSpacedKeys = meshes.spaced
    .filter(function(node) { return !isClosedSurfaceGeometry(node.geometry) })
    .map(openSpacedKey)
  const openBits = assignSpacedStencilBits(openSpacedKeys)
  if (openBits.overflow) {
    console.error('[armor-heatmap] spaced dedup keys exceed ' + SPACED_STENCIL_BIT_LIMIT +
      ' stencil bits — falling back to double-sided accumulation (known double-count on open shells):' +
      ' keys=' + JSON.stringify([...new Set(openSpacedKeys)]))
  }
  const addSingleSpacedClone = (node: Mesh, t: number, side: Side) => {
    const cm = addClone(scene, node, mats.spacedMaterial(t, pen, side), 2)
    cm.userData._baseThickness = t
    tagStateClone(cm, node)
    const od = addClone(scene, node, mats.spacedOmit, 5)
    tagStateClone(od, node)
  }
  meshes.spaced.forEach(function(node) {
    const t = node.userData.armorThickness || 0
    const closed = isClosedSurfaceGeometry(node.geometry)
    if (closed || openBits.overflow) {
      addSingleSpacedClone(node, t, closed ? THREE.FrontSide : THREE.DoubleSide)
      return
    }
    const bit = openBits.bits.get(openSpacedKey(node))
    if (bit == null) {
      addSingleSpacedClone(node, t, THREE.DoubleSide)
      return
    }
    const fm = mats.spacedMaterial(t, pen, THREE.FrontSide)
    applySpacedFrontStencil(fm, bit)
    const cf = addClone(scene, node, fm, 2)
    cf.userData._baseThickness = t
    tagStateClone(cf, node)
    const bm = mats.spacedMaterial(t, pen, THREE.BackSide)
    applySpacedBackStencil(bm, bit)
    const cb = addClone(scene, node, bm, 2.1)
    cb.userData._baseThickness = t
    tagStateClone(cb, node)
    const od = addClone(scene, node, mats.spacedOmit, 5)
    tagStateClone(od, node)
  })
  meshes.external.forEach(function(node) {
    const t = node.userData.armorThickness ?? 20
    const clipped = node.userData.armorSection === 'gunBarrel' && gunClipPlane
    const side = node.userData.moduleDoubleSided ? THREE.DoubleSide : THREE.FrontSide
    const dmat = (clipped || side === THREE.DoubleSide)
      ? (() => {
        const m = mats.externalDepth.clone()
        m.side = side
        m.clippingPlanes = (clipped ? [gunClipPlane] : null) as Plane[] | null
        return m
      })()
      : mats.externalDepth
    const cmat = mats.externalMaterial(t, pen, clipped ? gunClipPlane : null)
    cmat.side = side
    const od = addClone(scene, node, mats.omit, 3)
    od.material = dmat
    const cm2 = addClone(scene, node, cmat, 4)
    cm2.userData._baseThickness = t
  })
}

export function populateSpacedStateScene(scene: Object3D, meshes: { primary: readonly Mesh[]; spaced: readonly Mesh[]; external: readonly Mesh[] }, mats: {
  omit: Material
  spacedStateMaterial(t: number, pen: number): Material
  moduleStateMaterial(clip: Plane | null): Material
}, pen: number, gunClipPlane: Plane | null | undefined): void {
  meshes.primary.forEach(function(node) {
    const c = addClone(scene, node, mats.omit, 0)
    tagStateClone(c, node)
  })
  meshes.spaced.forEach(function(node) {
    const t = node.userData.armorThickness || 0
    const sm = addClone(scene, node, mats.spacedStateMaterial(t, pen), 2)
    sm.userData._baseThickness = t
    tagStateClone(sm, node)
  })
  meshes.external.forEach(function(node) {
    const clipped = node.userData.armorSection === 'gunBarrel' && gunClipPlane
    const sm = mats.moduleStateMaterial(clipped ? gunClipPlane : null)
    sm.side = node.userData.moduleDoubleSided ? THREE.DoubleSide : THREE.FrontSide
    addClone(scene, node, sm, 3)
  })
}

export function populatePrimaryArmorScene(scene: Object3D, meshes: { primary: readonly Mesh[] }, mats: {
  exclude: Material
  penetrationMaterial(t: number): Material
}): void {
  meshes.primary.forEach(function(node) {
    const t = node.userData.armorThickness
    const d = addClone(scene, node, mats.exclude, 0)
    const cm = addClone(scene, node, mats.penetrationMaterial(t == null ? 0 : t), 1)
    cm.userData._baseThickness = t == null ? 0 : t
    tagStateClone(d, node)
    tagStateClone(cm, node)
  })
}
