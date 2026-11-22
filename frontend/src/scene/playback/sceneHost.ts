// 场景宿主对象 owner（2026-11-22 自 playbackScene.js 出仓）：跨模块可变状态与函数的唯一宿主。
// initPlayback 构造 S 后按序安装各模块（state → renderLoop → transport → sessionRuntime →
// assembly → perfProbe → session），模块只在安装时向 S 写入自己拥有的字段/函数。
import type { createPlaybackStore } from '../playbackStore.ts'
import type { useSceneAnnotations } from '../../composables/useSceneAnnotations.ts'

type AnnotationApi = ReturnType<typeof useSceneAnnotations>

/** initPlayback 入参契约（与 facade 的 JSDoc 一致）。 */
export interface SceneHostOptions {
  container: HTMLElement
  store: ReturnType<typeof createPlaybackStore>
  labelOverlay?: HTMLElement | null
  onVehicleSelect?: (eid: number | null, event: MouseEvent | null) => void
  onAnnotationCommit?: AnnotationApi['commitAnnotationFromScene']
  onAnnotationErase?: AnnotationApi['eraseFromScene']
  recorderReticle?: HTMLElement | null
}

export function createSceneHost({
  container,
  store,
  labelOverlay,
  onVehicleSelect,
  onAnnotationCommit,
  onAnnotationErase,
  recorderReticle,
}: SceneHostOptions) {
  return {
    container,
    store,
    labelOverlay,
    onVehicleSelect,
    onAnnotationCommit,
    onAnnotationErase,
    recorderReticle,
  }
}
