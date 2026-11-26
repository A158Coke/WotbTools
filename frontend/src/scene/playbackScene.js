/**
 * 拆分模块共享的宿主对象类型（迁移期声明：宿主字段由各 owner 模块安装，逐字段类型化随迁移推进）。
 * @typedef {Record<string, any>} Host
 */

import { createSceneHost } from './playback/sceneHost.js'
import { installSceneState } from './playback/sceneState.js'
import { installSceneAssembly } from './playback/sceneAssembly.js'
import { installRenderLoop, installPerfProbe } from './playback/renderLoop.js'
import { installTransport } from './playback/transport.js'
import { installSessionRuntime, createPlaybackSession } from './playback/sessionRuntime.js'
import { createPlaybackApi } from './playback/publicApi.js'
import { QUALITY_PRESETS } from './playback/quality.js'
import { tracerSpanSecs, occlusionCells, occlusionFootprintCells } from './playback/pure.js'
import { COLOR_FRIENDLY, COLOR_ENEMY, COLOR_UNKNOWN, TRACER_FRIENDLY, TRACER_ENEMY } from './playback/palette.ts'

export { QUALITY_PRESETS, tracerSpanSecs, occlusionCells, occlusionFootprintCells }
export { COLOR_FRIENDLY, COLOR_ENEMY, COLOR_UNKNOWN, TRACER_FRIENDLY, TRACER_ENEMY }




/**
 * @param {HTMLElement} container
 * @param {ReturnType<import('./playbackStore').createPlaybackStore>} store
 * @param {HTMLElement | null} labelOverlay
 * @param {{onVehicleSelect?: (eid: number | null, event: MouseEvent | null) => void, onAnnotationCommit?: ReturnType<import('../composables/useSceneAnnotations').useSceneAnnotations>['commitAnnotationFromScene'], onAnnotationErase?: ReturnType<import('../composables/useSceneAnnotations').useSceneAnnotations>['eraseFromScene'], recorderReticle?: HTMLElement | null}} [options]
 */

export function initPlayback(container, store, labelOverlay = null, { onVehicleSelect, onAnnotationCommit, onAnnotationErase, recorderReticle = null } = {}) {
  const S = createSceneHost({
    container, store, labelOverlay, onVehicleSelect, onAnnotationCommit, onAnnotationErase, recorderReticle,
  })
  installSceneState(S)
  installRenderLoop(S)
  installTransport(S)
  installSessionRuntime(S)
  installSceneAssembly(S)
  installPerfProbe(S)
  createPlaybackSession(S)
  S.animate()
  S.applyGlbGate()

  return createPlaybackApi(S)
}
