import * as THREE from 'three'

export interface ProjectedCardAnchor {
  x: number
  y: number
  inFront: boolean
}

export function projectCardAnchor(
  anchor: THREE.Vector3,
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number,
): ProjectedCardAnchor | null {
  if (!(viewportWidth > 0) || !(viewportHeight > 0)) return null
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) || !Number.isFinite(anchor.z)) return null
  const view = anchor.clone().applyMatrix4(camera.matrixWorldInverse)
  const near = (camera as THREE.PerspectiveCamera).near
  const nearPlane = Number.isFinite(near) && near > 0 ? near : 0.1
  const inFront = view.z < -nearPlane
  const ndc = anchor.clone().project(camera)
  if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) return null
  return {
    x: (ndc.x * 0.5 + 0.5) * viewportWidth,
    y: (-ndc.y * 0.5 + 0.5) * viewportHeight,
    inFront,
  }
}
