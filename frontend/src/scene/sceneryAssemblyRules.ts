import type { Material, Mesh, Object3D } from 'three'
import { isWaterName } from './sceneryMaterials.js'

export type SurfaceMaterial = Material | Material[]

export function strictSurfacesOf(gltfScene: Object3D | null | undefined): boolean {
  return !!(gltfScene && gltfScene.userData && gltfScene.userData.surfaceFlags)
}

export function materialIsWater(mat: SurfaceMaterial | null | undefined): boolean {
  const m0 = Array.isArray(mat) ? mat[0] : mat
  return !!(m0 && m0.userData && m0.userData.water)
}

export function materialHasSky(mat: SurfaceMaterial | null | undefined): boolean {
  const ms = Array.isArray(mat) ? mat : [mat]
  return ms.some((m) => !!(m && m.userData && m.userData.sky))
}

export function materialAllSky(mat: SurfaceMaterial | null | undefined): boolean {
  const ms = Array.isArray(mat) ? mat : [mat]
  return ms.length > 0 && ms.every((m) => !!(m && m.userData && m.userData.sky))
}

export function sceneHasSkyFlags(root: Object3D | null | undefined): boolean {
  let found = false
  const walk = (o: Object3D | null | undefined): void => {
    if (found || !o) return
    const mesh = o as Mesh
    if (mesh.isMesh && materialHasSky(mesh.material)) { found = true; return }
    for (const c of o.children || []) walk(c)
  }
  walk(root)
  return found
}

export function isWaterNode(name: string, mat: SurfaceMaterial | null | undefined, { strictSurfaces }: { strictSurfaces?: boolean }): boolean {
  if (!strictSurfaces) return isWaterName(name)
  return materialIsWater(mat)
}

export function isSkyShellName(name: string | null | undefined): boolean {
  return /sky/i.test(name || '')
}

export function isSkyShell(name: string, mat: SurfaceMaterial | null | undefined, { skyFlagsAvailable = false }: { skyFlagsAvailable?: boolean } = {}): boolean {
  if (skyFlagsAvailable) return materialAllSky(mat)
  return isSkyShellName(name)
}

export function isNonIntactStateName(name: string | null | undefined): boolean {
  return /^D_|State ?[1-9]/i.test(name || '')
}

export function bakeDropNode(name: string, mat: SurfaceMaterial | null | undefined, {
  strictSurfaces, mdVariant = false, keepWater = false, skyFlagsAvailable = false,
}: { strictSurfaces?: boolean; mdVariant?: boolean; keepWater?: boolean; skyFlagsAvailable?: boolean } = {}): boolean {
  if (mdVariant) return true
  if (isNonIntactStateName(name)) return true
  if (/invisible/i.test(name || '')) return true
  if (!keepWater && isWaterNode(name, mat, { strictSurfaces })) return true
  if (isSkyShell(name, mat, { skyFlagsAvailable }) && !materialIsWater(mat)) return true
  return false
}
