import { nextTick, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { initPlayback } from '../scene/playbackScene.js'
import { Feature } from '../app/featureCapabilities.js'
import { uiProfile } from './useUiProfile.js'
import { createPlaybackStore } from '../scene/playbackStore.js'
import type { useFeatureGate } from './useFeatureGate.js'
import type { useSceneFlyControls } from './useSceneFlyControls.js'

export interface MapPreviewSceneApi {
  destroy?(): void
  setPaused?(paused: boolean): void
  setFlySpeed?(speed: number): void
  setMobileTouch?(mobile: boolean): void
  setMapBasesKind?(kind: string | null): void
  setMapSpawns?(points: unknown[] | null): void
  refreshSpawnColors?(): void
  setCam?(mode: string): void
  setQuality?(key: string): void
  loadMapOnly(options: { mapId: number; mapName: string }): void
}

type MapPreviewSessionOptions = {
  props: { mapId: number; mapName: string; basesKind: string | null; spawnPoints: unknown[] | null }
  online: ComputedRef<{ available: boolean }>
  webgl: { supported: boolean }
  renderActive: ComputedRef<boolean>
  stage: Ref<HTMLElement | null>
  store: ReturnType<typeof createPlaybackStore>
  requireFeature: ReturnType<typeof useFeatureGate>['requireFeature']
  fly: ReturnType<typeof useSceneFlyControls>
  isPhone: ComputedRef<boolean>
  sceneApi: Ref<MapPreviewSceneApi | null>
  resetAnnotationState: () => void
  pushAnnotationProjection: () => void
  pushAnnotationInteraction: () => void
  pushAnnotationVisibility: () => void
  commitAnnotationFromScene: (annotation: { type: string; color: string; [key: string]: unknown }) => void
  eraseFromScene: (path: { points: { x: number; y: number }[]; radius: number }) => void
}

type SceneFactory = (
  stage: HTMLElement,
  store: ReturnType<typeof createPlaybackStore>,
  labelOverlay: null,
  callbacks: {
    onAnnotationCommit: (annotation: { type: string; color: string; [key: string]: unknown }) => void
    onAnnotationErase: (path: { points: { x: number; y: number }[]; radius: number }) => void
  },
) => MapPreviewSceneApi
const createMapPreviewScene = initPlayback as SceneFactory

export function useMapPreview3DSession({
  props, online, webgl, renderActive, stage, store, requireFeature, fly, isPhone, sceneApi,
  resetAnnotationState,
  pushAnnotationProjection, pushAnnotationInteraction, pushAnnotationVisibility,
  commitAnnotationFromScene, eraseFromScene,
}: MapPreviewSessionOptions) {
  function destroyScene() {
    fly.stopLoop()
    if (!sceneApi.value) return
    sceneApi.value.destroy?.()
    sceneApi.value = null
  }

  function shouldHaveScene() {
    return online.value.available && !!webgl.supported
  }

  function pushBasesKind() {
    sceneApi.value?.setMapBasesKind?.(props.basesKind || null)
  }

  function pushSpawnPoints() {
    sceneApi.value?.setMapSpawns?.(props.spawnPoints || null)
  }

  function ensureScene() {
    if (sceneApi.value || !renderActive.value || !shouldHaveScene()) return false
    if (!stage.value?.isConnected) return false
    sceneApi.value = createMapPreviewScene(stage.value, store, null, {
      onAnnotationCommit: commitAnnotationFromScene,
      onAnnotationErase: eraseFromScene,
    })
    sceneApi.value?.setPaused?.(!renderActive.value)
    sceneApi.value?.setFlySpeed?.(fly.flySpeedIndex())
    sceneApi.value?.setMobileTouch?.(isPhone.value)
    pushAnnotationProjection()
    pushAnnotationInteraction()
    pushAnnotationVisibility()
    pushBasesKind()
    pushSpawnPoints()
    return true
  }

  function reloadMap() {
    if (!sceneApi.value || !props.mapId || !requireFeature(Feature.PLAYBACK_3D)) return
    sceneApi.value.loadMapOnly({ mapId: props.mapId, mapName: props.mapName })
  }

  function changeQuality(key: string) {
    if (key === store.qualityKey) return
    destroyScene()
    ensureScene()
    sceneApi.value?.setQuality?.(key)
    reloadMap()
  }

  watch(isPhone, (value) => sceneApi.value?.setMobileTouch?.(value))
  watch(() => props.basesKind, pushBasesKind)
  watch(() => props.spawnPoints, pushSpawnPoints)
  watch(uiProfile, () => sceneApi.value?.refreshSpawnColors?.())
  watch(() => store.mapReady, (ready) => {
    if (!ready) return
    pushAnnotationProjection()
    pushAnnotationVisibility()
    pushBasesKind()
    pushSpawnPoints()
  })
  watch(() => props.mapId, () => {
    resetAnnotationState()
    if (sceneApi.value && shouldHaveScene()) reloadMap()
  })
  watch(renderActive, (active) => {
    sceneApi.value?.setPaused?.(!active)
    if (!active) fly.stopLoop()
  })
  watch(
    (): [boolean, boolean] => [online.value.available, renderActive.value],
    ([available], previous) => {
      const prevAvailable = previous?.[0]
      if (!shouldHaveScene()) {
        destroyScene()
        return
      }
      if (!renderActive.value) return
      nextTick(() => {
        if (!renderActive.value || !shouldHaveScene()) return
        const created = ensureScene()
        if (!sceneApi.value) return
        sceneApi.value.setPaused?.(!renderActive.value)
        if (created || (available === true && prevAvailable === false)) reloadMap()
      })
    },
    { immediate: true },
  )

  return { sceneApi, destroyScene, ensureScene, reloadMap, changeQuality }
}
