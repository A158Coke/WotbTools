import type { Object3D } from 'three'
import { createWaterReflection, type WaterReflection } from './waterReflection.js'
import { qualityFeatures } from './quality.js'

export interface WaterReflectionRuntimeDeps {
  getWaterMeshes: () => Object3D[] | null | undefined
  getWaterLevel: () => number | null | undefined
  getExcludedRoots: () => Array<Object3D | null | undefined>
  qualityKey: () => string
  debug: boolean
}

export interface WaterReflectionRuntime {
  apply(): void
  update: WaterReflection['update']
  requestRefresh(): void
  dispose(): void
}

export function createWaterReflectionRuntime(deps: WaterReflectionRuntimeDeps): WaterReflectionRuntime {
  const initial = qualityFeatures(deps.qualityKey()).water
  const reflection = createWaterReflection({
    getWaterMeshes: deps.getWaterMeshes,
    getWaterLevel: deps.getWaterLevel,
    getExcludedRoots: deps.getExcludedRoots,
    scale: initial.reflectionScale,
    intervalFrames: initial.reflectionIntervalFrames,
  })
  const apply = () => {
    const water = qualityFeatures(deps.qualityKey()).water
    reflection.configure({ scale: water.reflectionScale, intervalFrames: water.reflectionIntervalFrames })
    reflection.setEnabled(water.reflection)
  }
  apply()
  if (deps.debug && typeof window !== 'undefined') {
    window.__waterReflection = reflection
  }
  return { apply, update: reflection.update, requestRefresh: reflection.requestRefresh, dispose: reflection.dispose }
}
