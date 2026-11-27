import * as THREE from 'three'
import type { Vector3 } from 'three'

export interface OrbitControlsLike {
  target: Vector3
  minDistance: number
  maxDistance: number
}

export interface CameraLike {
  position: Vector3
  lookAt(target: Vector3): void
}

export interface HeightMetaLike {
  size: number
  span: number
}

export interface WorldCenterLike {
  cx: number
  cz: number
  ext: number
}

export interface CameraTerrainClampDeps {
  getCamera: () => CameraLike | null
  getControls: () => OrbitControlsLike | null
  cameraDriven: () => boolean
  getTerrainMesh: () => unknown | null
  getHeightField: () => unknown | null
  getHeightMeta: () => HeightMetaLike | null
  sampleRenderedTerrainHeight: (x: number, z: number) => number | null
  sampleHeight: (x: number, z: number) => number
  clearance: number
  getWorldCenter: () => WorldCenterLike
  isFollowing: () => boolean
  followMinDistance?: () => number
}

export interface CameraTerrainClamp {
  applyCameraClamp: (ext: number) => void
  baseMinDistance: () => number
  terrainHeightForCameraClamp: (x: number, z: number) => number | null
  /** @returns 本帧是否改动了相机位置 / minDistance。 */
  clampOrbitCameraToTerrain: () => boolean
  clampCameraTarget: () => void
}

export function createCameraTerrainClamp(deps: CameraTerrainClampDeps): CameraTerrainClamp {
  let baseMinDistance = 1
  const scratchDir = new THREE.Vector3()

  function activeMinDistance(): number {
    if (deps.isFollowing()) {
      const follow = deps.followMinDistance?.()
      if (typeof follow === 'number' && Number.isFinite(follow) && follow > 0) {
        return Math.max(baseMinDistance, follow)
      }
    }
    return baseMinDistance
  }

  function applyCameraClamp(ext: number): void {
    const controls = deps.getControls()
    if (!controls) return
    controls.minDistance = activeMinDistance()
    controls.maxDistance = ext * 2.2
  }

  function terrainHeightForCameraClamp(x: number, z: number): number | null {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null
    const rendered = deps.getTerrainMesh() ? deps.sampleRenderedTerrainHeight(x, z) : null
    if (typeof rendered === 'number' && Number.isFinite(rendered)) return rendered
    const heightField = deps.getHeightField()
    const heightMeta = deps.getHeightMeta()
    if (!heightField || !heightMeta) return null
    const n = Number(heightMeta.size), span = Number(heightMeta.span)
    if (!Number.isInteger(n) || n < 2 || !Number.isFinite(span) || span <= 0) return null
    const half = span / 2
    if (x < -half || x >= half || z < -half || z >= half) return null
    const h = deps.sampleHeight(x, z)
    return Number.isFinite(h) ? h : null
  }

  function clampOrbitCameraToTerrain(): boolean {
    const camera = deps.getCamera()
    const controls = deps.getControls()
    if (deps.cameraDriven() || !camera || !controls || !deps.getHeightField() || !deps.getHeightMeta()) return false
    const t = controls.target
    if (!Number.isFinite(t.y) || !Number.isFinite(camera.position.y)) return false
    const dir = scratchDir.subVectors(camera.position, t)
    const dist = dir.length()
    if (!(dist > 1e-6)) { controls.minDistance = activeMinDistance(); return false }
    dir.divideScalar(dist)
    const clearance = deps.clearance

    let safeDist = dist
    let safeTerrain: number | null = null
    let found = false
    for (let i = 0; i < 24; i++) {
      const px = t.x + dir.x * safeDist
      const pz = t.z + dir.z * safeDist
      const py = t.y + dir.y * safeDist
      const terrainY = terrainHeightForCameraClamp(px, pz)
      if (typeof terrainY !== 'number' || !Number.isFinite(terrainY)) break
      safeTerrain = terrainY
      if (py + 1e-3 >= terrainY + clearance) { found = true; break }
      if (!(dir.y > 1e-4)) break
      const next = (terrainY + clearance - t.y) / dir.y
      if (!Number.isFinite(next) || next <= safeDist + 1e-6) break
      safeDist = next
    }
    if (found && safeDist > controls.maxDistance) found = false

    if (!found) {
      const camTerrain = terrainHeightForCameraClamp(camera.position.x, camera.position.z)
      if (typeof camTerrain !== 'number' || !Number.isFinite(camTerrain)) {
        controls.minDistance = activeMinDistance()
        return false
      }
      const lift = camTerrain + clearance
      if (camera.position.y < lift) {
        camera.position.y = lift
        camera.lookAt(t)
        const locked = Math.max(activeMinDistance(), camera.position.distanceTo(t))
        controls.minDistance = locked
        controls.maxDistance = Math.max(controls.maxDistance, locked)
        return true
      }
      controls.minDistance = activeMinDistance()
      return false
    }

    const camDist = camera.position.distanceTo(t)
    const limit = (safeTerrain as number) + clearance
    if (camDist < safeDist - 1e-6 || camera.position.y < limit - 0.02) {
      camera.position.copy(t).addScaledVector(dir, safeDist)
      camera.lookAt(t)
      controls.minDistance = Math.max(activeMinDistance(), safeDist)
      return true
    }
    if (camera.position.y <= limit + 0.02) {
      controls.minDistance = Math.max(activeMinDistance(), safeDist)
      return false
    }
    controls.minDistance = activeMinDistance()
    return false
  }

  function clampCameraTarget(): void {
    if (deps.isFollowing()) return
    const controls = deps.getControls()
    if (!controls) return
    const { cx, cz, ext } = deps.getWorldCenter()
    const lim = Math.max(ext * 1.1, 340)
    const t = controls.target
    const nx = Math.min(cx + lim, Math.max(cx - lim, t.x))
    const nz = Math.min(cz + lim, Math.max(cz - lim, t.z))
    if (nx !== t.x) t.x = nx
    if (nz !== t.z) t.z = nz
  }

  return {
    applyCameraClamp,
    baseMinDistance: () => baseMinDistance,
    terrainHeightForCameraClamp,
    clampOrbitCameraToTerrain,
    clampCameraTarget,
  }
}