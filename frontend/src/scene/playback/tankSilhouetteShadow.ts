import * as THREE from 'three'
import type { Material, Object3D, Scene } from 'three'

interface Vec3Like { x: number, y: number, z: number }

const MIN_INCIDENCE = 0.05

export function planarShadowMatrix(normal: Vec3Like, d: number, light: Vec3Like, out: THREE.Matrix4): THREE.Matrix4 {
  let lx = light.x, ly = light.y, lz = light.z
  let k = normal.x * lx + normal.y * ly + normal.z * lz
  if (!(k <= -MIN_INCIDENCE)) { lx = -normal.x; ly = -normal.y; lz = -normal.z; k = -1 }
  const nx = normal.x / k, ny = normal.y / k, nz = normal.z / k
  return out.set(
    1 - lx * nx, -lx * ny, -lx * nz, -lx * d / k,
    -ly * nx, 1 - ly * ny, -ly * nz, -ly * d / k,
    -lz * nx, -lz * ny, 1 - lz * nz, -lz * d / k,
    0, 0, 0, 1,
  )
}

export function makeSilhouetteMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, toneMapped: false,
    depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.ReplaceStencilOp,
  })
}

export interface SilhouetteShadow {
  readonly projection: THREE.Matrix4
  setVisible(visible: boolean): void
  count(): number
  dispose(): void
}

function visibleWithin(node: Object3D, root: Object3D): boolean {
  for (let n: Object3D | null = node; n && n !== root; n = n.parent) if (!n.visible) return false
  return true
}

export function createSilhouetteShadow(scene: Scene, root: Object3D, material: Material): SilhouetteShadow {
  const projection = new THREE.Matrix4()
  const pairs: { part: THREE.Mesh, shadow: THREE.Mesh }[] = []
  root.traverse((node) => {
    const part = node as THREE.Mesh
    if (!part.isMesh || !part.geometry) return
    const shadow = new THREE.Mesh(part.geometry, material)
    shadow.name = 'tankSilhouetteShadow'
    shadow.matrixAutoUpdate = false
    shadow.matrixWorldAutoUpdate = false
    shadow.frustumCulled = false
    shadow.visible = false
    shadow.onBeforeRender = () => { shadow.matrixWorld.multiplyMatrices(projection, part.matrixWorld) }
    scene.add(shadow)
    pairs.push({ part, shadow })
  })
  return {
    projection,
    setVisible(visible) {
      for (const { part, shadow } of pairs) shadow.visible = visible && visibleWithin(part, root)
    },
    count() {
      let n = 0
      for (const { shadow } of pairs) if (shadow.visible) n++
      return n
    },
    dispose() {
      for (const { shadow } of pairs) scene.remove(shadow)
      pairs.length = 0
    },
  }
}
