import type { Color, Material, Mesh, Object3D } from 'three'
import { patchTankMaterial } from './sceneryMaterials.js'

// Replay seconds: leave the destruction burst its first 0.30s, then fade over 0.50s.
const DESTROYED_DELAY_SEC = 0.30
const DESTROYED_FADE_SEC = 0.50

/** sceneLifeAt 投影里本模块消费的生命判据字段。 */
export interface DestroyedLifeEvidence {
  lifeState?: string | null
  destroyedKnownAtSec?: number | null
}

/** GLB PBR 材质上被残骸渐变改写的参数（MeshStandardMaterial 面；非 PBR 材质字段为 undefined，运行时守卫跳过）。 */
type DestroyedMaterial = Material & { roughness?: number; metalness?: number; emissive?: Color }

export interface TankDestroyedVisual {
  materials: Array<{
    material: DestroyedMaterial
    uniform: { value: number }
    roughness: number | undefined
    metalness: number | undefined
    emissive: Color | undefined
  }>
  amount: number
}

/** life and time must use the same clock domain; this module never infers death from HP. */
export function destroyedVisualAmount(life: DestroyedLifeEvidence | null | undefined, timeSec: number): number {
  if (life?.lifeState !== 'DESTROYED' || !Number.isFinite(timeSec)) return 0
  if (!Number.isFinite(life.destroyedKnownAtSec as number)) return 1
  const t = Math.max(0, Math.min(1, (timeSec - (life.destroyedKnownAtSec as number) - DESTROYED_DELAY_SEC) / DESTROYED_FADE_SEC))
  return t * t * (3 - 2 * t)
}

/** Prepare body materials once. GLB instances borrow geometry/textures, but own their material clones. */
export function prepareTankDestroyedVisual(root: Object3D, { cloneMaterials = true }: { cloneMaterials?: boolean } = {}): TankDestroyedVisual {
  const bySource = new Map<Material, DestroyedMaterial>()
  const materials: TankDestroyedVisual['materials'] = []
  root.traverse((node) => {
    const mesh = node as Mesh
    if (!mesh.isMesh || mesh.userData.keepWithGlb || !mesh.material) return
    const prepare = (source: Material): DestroyedMaterial => {
      const existing = bySource.get(source)
      if (existing) return existing
      const material = (cloneMaterials ? source.clone() : source) as DestroyedMaterial
      // Three.js Material.clone copies userData but does not copy these callbacks.
      // Preserve them together, including an already-applied tank lighting patch.
      if (cloneMaterials) {
        material.onBeforeCompile = source.onBeforeCompile
        material.customProgramCacheKey = source.customProgramCacheKey
      }
      patchTankMaterial(material)
      const uniform = { value: 0 }
      const previousCompile = material.onBeforeCompile
      const previousKey = material.customProgramCacheKey
      material.onBeforeCompile = function (this: unknown, ...args: Parameters<Material['onBeforeCompile']>) {
        previousCompile.apply(this, args)
        const shader = args[0]
        shader.uniforms.uDestroyedAmount = uniform
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uDestroyedAmount;')
          // Balance the two reviewed looks in display space; a small lift keeps
          // shaded armour readable. Fog must not wash the wreck white.
          .replace('#include <fog_fragment>', `#include <fog_fragment>
vec3 destroyedDisplayColor = clamp(gl_FragColor.rgb, 0.0, 1.0);
float destroyedLuma = dot(destroyedDisplayColor, vec3(0.2126, 0.7152, 0.0722));
gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.035 + destroyedLuma * 0.45), uDestroyedAmount);`)
      }
      material.customProgramCacheKey = function (this: unknown) {
        return previousKey.call(this) + '|tank-destroyed-v3'
      }
      material.needsUpdate = true
      materials.push({
        material, uniform,
        roughness: material.roughness,
        metalness: material.metalness,
        emissive: material.emissive?.clone(),
      })
      bySource.set(source, material)
      return material
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(prepare) : prepare(mesh.material)
  })
  return { materials, amount: 0 }
}

/** Update uniforms/PBR parameters, without shader recompilation or cumulative color multiplication. */
export function applyTankDestroyedVisual(visual: TankDestroyedVisual | null | undefined, amount: number): void {
  if (!visual) return
  const next = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0
  if (next === visual.amount) return
  visual.amount = next
  for (const entry of visual.materials) {
    const { material, uniform, roughness, metalness, emissive } = entry
    uniform.value = next
    if (typeof roughness === 'number' && Number.isFinite(roughness)) material.roughness = roughness + (Math.min(1, Math.max(0.90, roughness + 0.20)) - roughness) * next
    if (typeof metalness === 'number' && Number.isFinite(metalness)) material.metalness = metalness * (1 - 0.95 * next)
    if (emissive) (material.emissive as Color).copy(emissive).multiplyScalar(1 - next)
  }
}

/** GLB instance teardown: never dispose its borrowed maps or geometry. Proxy teardown stays with its group. */
export function disposeTankDestroyedVisual(visual: TankDestroyedVisual | null | undefined): void {
  if (!visual) return
  for (const { material } of visual.materials) material.dispose()
  visual.materials.length = 0
}
