import { patchTankMaterial } from './sceneryMaterials.js'

// Replay seconds: leave the destruction burst its first 0.30s, then fade over 0.50s.
const DESTROYED_DELAY_SEC = 0.30
const DESTROYED_FADE_SEC = 0.50

/** life and time must use the same clock domain; this module never infers death from HP. */
export function destroyedVisualAmount(life, timeSec) {
  if (life?.lifeState !== 'DESTROYED' || !Number.isFinite(timeSec)) return 0
  if (!Number.isFinite(life.destroyedKnownAtSec)) return 1
  const t = Math.max(0, Math.min(1, (timeSec - life.destroyedKnownAtSec - DESTROYED_DELAY_SEC) / DESTROYED_FADE_SEC))
  return t * t * (3 - 2 * t)
}

/** Prepare body materials once. GLB instances borrow geometry/textures, but own their material clones. */
export function prepareTankDestroyedVisual(root, { cloneMaterials = true } = {}) {
  const bySource = new Map()
  const materials = []
  root.traverse((mesh) => {
    if (!mesh.isMesh || mesh.userData.keepWithGlb || !mesh.material) return
    const prepare = (source) => {
      if (bySource.has(source)) return bySource.get(source)
      const material = cloneMaterials ? source.clone() : source
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
      material.onBeforeCompile = function (shader, renderer) {
        previousCompile.call(this, shader, renderer)
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
      material.customProgramCacheKey = function () {
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
export function applyTankDestroyedVisual(visual, amount) {
  if (!visual) return
  const next = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0
  if (next === visual.amount) return
  visual.amount = next
  for (const entry of visual.materials) {
    const { material, uniform, roughness, metalness, emissive } = entry
    uniform.value = next
    if (Number.isFinite(roughness)) material.roughness = roughness + (Math.min(1, Math.max(0.90, roughness + 0.20)) - roughness) * next
    if (Number.isFinite(metalness)) material.metalness = metalness * (1 - 0.95 * next)
    if (emissive) material.emissive.copy(emissive).multiplyScalar(1 - next)
  }
}

/** GLB instance teardown: never dispose its borrowed maps or geometry. Proxy teardown stays with its group. */
export function disposeTankDestroyedVisual(visual) {
  if (!visual) return
  for (const { material } of visual.materials) material.dispose()
  visual.materials.length = 0
}
