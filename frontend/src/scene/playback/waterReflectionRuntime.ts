// 水面反射运行时接线（#820 行数预算拆分，2026-11-17）：把 createWaterReflection 的
// 构造 + 画质档应用（W1/P1/W3）收口到一处；playbackScene 只保留依赖注入与 update。
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
  /** 按当前画质档重配 RT 比例 / 更新间隔 / 开关（建场景与运行时切档共用）。 */
  apply(): void
  update: WaterReflection['update']
  /** 单次 dirty frame（seek / 静态地图切图）强制刷新反射。 */
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
