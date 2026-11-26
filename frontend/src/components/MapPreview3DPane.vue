<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, PencilRuler, TriangleAlert, Upload } from 'lucide-vue-next'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { createPlaybackStore } from '../scene/playbackStore.js'
import { QUALITY_PRESETS } from '../scene/playbackScene.js'
import { detectWebGL } from '../scene/webglSupport.js'
import { useSceneFlyControls } from '../composables/useSceneFlyControls.js'
import { useSceneActivity } from '../composables/useSceneActivity'
import { usePlaybackFullscreen } from '../composables/usePlaybackFullscreen.js'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import { usePlaybackPortraitViewport } from '../composables/usePlaybackPortraitViewport.js'
import { isInteractiveTarget } from '../composables/usePlaybackTransport.js'
import { usePaneFillHeight } from '../composables/usePaneFillHeight.js'
import SegmentedControl from './SegmentedControl.vue'
import Scene3DStatus from './Scene3DStatus.vue'
import AnnotationToolbar from './AnnotationToolbar.vue'
import SceneFullscreenButton from './SceneFullscreenButton.vue'
import SceneDistanceSlider from './SceneDistanceSlider.vue'
import { stripSurfaceAnchors } from '../utils/annotation.js'
import { useSceneAnnotations } from '../composables/useSceneAnnotations.js'
import { useMapPreviewAnnotationFile } from '../composables/useMapPreviewAnnotationFile.js'
import { useMapPreview3DSession } from '../composables/useMapPreview3DSession.js'

const props = defineProps({
  mapId: { type: Number, required: true },
  mapName: { type: String, default: '' },
  mapKey: { type: String, required: true },
  basesKind: { type: String, default: null },
  spawnPoints: { type: Array, default: null },
  active: { type: Boolean, default: true },
})

const { t } = useI18n()
const { availability, requireFeature } = useFeatureGate()
const online = computed(() => availability(Feature.PLAYBACK_3D))
const webgl = detectWebGL()

const store = createPlaybackStore()
const stage = ref(null)
const sceneApi = ref(null)
const getSceneApi = () => sceneApi.value
const rootEl = ref(null)
const { height: stageH } = usePaneFillHeight(rootEl)

const CAMERAS = computed(() => [
  { value: 'free', label: t('agentReplay.cam_free') },
  { value: 'top', label: t('agentReplay.cam_top') },
])
function chooseCamera(mode) {
  sceneApi.value?.setCam(mode)
}
const QUALITY_ORDER = Object.keys(QUALITY_PRESETS)
const qualityOptions = computed(() =>
  QUALITY_ORDER.map((k) => ({ value: k, label: t('agentReplay.q_' + k) })),
)
const { isPhone } = usePlaybackPhoneForm()
const { isPortrait } = usePlaybackPortraitViewport()
const { isFullscreen, fullscreenSupported, toggleFullscreen } = usePlaybackFullscreen({
  target: () => rootEl.value,
  isPhone,
  isActive: () => props.active,
})
const renderActive = useSceneActivity(() => props.active)
const fly = useSceneFlyControls({
  setFlySpeed: (n) => sceneApi.value?.setFlySpeed(n),
  isActive: () => renderActive.value,
  canFly: () => !!sceneApi.value && store.mapReady,
  getSceneApi: () => sceneApi.value,
})

const {
  annotationOpen, annotations, replaceAnnotations, pushAnnotationProjection, pushAnnotationInteraction,
  pushAnnotationVisibility, commitAnnotationFromScene, eraseFromScene, openAnnotation, closeAnnotation,
  resetAnnotationState, toolbarProps: annotationToolbarProps, toolbarHandlers: annotationToolbarHandlers,
} = useSceneAnnotations({ getSceneApi: () => sceneApi.value, interactionReady: () => store.mapReady })

const { importMessage, exportAnnotations, importAnnotations } = useMapPreviewAnnotationFile({
  mapKey: () => props.mapKey,
  annotations,
  validate: isImportableAnnotation,
  sanitize: stripSurfaceAnchors,
  suffix: '3d',
  apply: replaceAnnotations,
  t,
})

function isImportableAnnotation(a) {
  return !!a && a.type === 'pen'
    && typeof a.color === 'string'
    && Number.isFinite(a.width) && a.width > 0
    && Array.isArray(a.points) && a.points.length >= 2
    && a.points.every((p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y))
}

const { destroyScene, reloadMap, changeQuality } = useMapPreview3DSession({
  props, online, webgl, renderActive, stage, store, requireFeature, fly, isPhone, sceneApi,
  resetAnnotationState,
  pushAnnotationProjection,
  pushAnnotationInteraction,
  pushAnnotationVisibility,
  commitAnnotationFromScene,
  eraseFromScene,
})

watch(() => props.active, (active) => {
  if (!active && annotationOpen.value) closeAnnotation()
})
const uiHidden = ref(false)
const importFile = ref(null)
function toggleUiHidden() {
  uiHidden.value = !uiHidden.value
  if (uiHidden.value) closeAnnotation()
}
function onUiToggleKeydown(event) {
  if (event.key !== 'h' && event.key !== 'H') return
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (!props.active || !store.mapReady) return
  if (isInteractiveTarget(event.target)) return
  event.preventDefault()
  toggleUiHidden()
}

const fpsText = computed(() => (store.fps > 0
  ? `${store.fps.toFixed(1)} FPS · ${store.frameMs.toFixed(1)}/${store.framePeakMs.toFixed(1)} ms`
  : '— FPS'))
const fpsJanky = computed(() => store.fps > 0
  && (store.fps < 45 || (store.framePeakMs > 0 && store.framePeakMs > store.frameMs * 2.5)))

const statusMode = computed(() => {
  if (store.err) return 'error'
  if (store.loading || store.assetStage) return 'loading'
  return null
})
const statusMessage = computed(() => {
  if (store.err) return store.err
  return t(store.assetStage ? 'agentReplay.loading_assets' : 'agentReplay.parsing')
})
const paneReady = computed(() => !online.value.available || !webgl.supported
  || !!store.err || !!store.mapReady)

onMounted(() => {
  window.addEventListener('keydown', onUiToggleKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onUiToggleKeydown)
  destroyScene()
})

if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) {
  window.__mapPreviewPane = {
    store,
    get sceneApi() { return sceneApi.value },
  }
}
</script>

<template>
  <div ref="rootEl" class="map3d" data-scene-surface :data-pane-ready="paneReady ? 'true' : undefined" data-testid="map-3d-pane">
    <template v-if="!online.available">
      <p v-if="!online.pending" class="map3d-note" data-testid="map-3d-connectivity">{{ $t(online.messageKey) }}</p>
    </template>
    <Scene3DStatus
      v-else-if="!webgl.supported"
      mode="unsupported"
      :webgl-status="webgl.status"
    />
    <div v-else class="map3d-root" :style="{ height: stageH }" data-testid="map-3d-root">
      <div class="map3d-stage" data-testid="map-3d-stage">
        <div ref="stage" class="scene"></div>
        <Scene3DStatus
          v-if="statusMode"
          class="map3d-status-overlay"
          :mode="statusMode"
          :progress="store.assetProgress"
          :message="statusMessage"
          @retry="reloadMap"
        />
        <div
          v-if="!uiHidden && store.mapReady && store.assetDegraded"
          class="map3d-degraded"
          data-testid="map-3d-asset-degraded"
          role="status"
          aria-live="polite"
        >
          <TriangleAlert :size="16" aria-hidden="true" />
          <span>{{ t('agentReplay.asset_degraded') }}</span>
        </div>
        <div
          v-if="!uiHidden && store.mapReady"
          class="map3d-fps"
          :class="{ 'map3d-fps-low': fpsJanky }"
          data-testid="map-3d-fps"
          aria-hidden="true"
        >{{ fpsText }}</div>
      </div>
      <div v-if="!uiHidden" class="map3d-controls">
        <div v-if="annotationOpen" class="map3d-annotations" data-testid="map-3d-annotations">
          <AnnotationToolbar v-bind="annotationToolbarProps" compact v-on="annotationToolbarHandlers" />
        </div>
        <div v-else class="map3d-toolrow">
          <button
            type="button"
            class="map3d-btn"
            data-testid="map-3d-drawing-entry"
            :aria-label="t('recon.map.playback.annot.mode')"
            :title="t('recon.map.playback.annot.mode')"
            @click="openAnnotation()"
          >
            <PencilRuler :size="16" aria-hidden="true" /> {{ t('recon.map.playback.annot.mode') }}
          </button>
          <button
            type="button"
            class="map3d-btn"
            data-testid="map-3d-import"
            :title="$t('mapPreview.annotations.import')"
            @click="importFile.click()"
          >
            <Upload :size="16" aria-hidden="true" /> {{ $t('mapPreview.annotations.import') }}
          </button>
          <button
            type="button"
            class="map3d-btn"
            data-testid="map-3d-export"
            :title="$t('mapPreview.annotations.export')"
            @click="exportAnnotations"
          >
            <Download :size="16" aria-hidden="true" /> {{ $t('mapPreview.annotations.export') }}
          </button>
          <input
            ref="importFile"
            type="file"
            accept="application/json,.json"
            class="map3d-file-input"
            aria-hidden="true"
            tabindex="-1"
            @change="importAnnotations"
          />
          <span class="map3d-spacer"></span>
          <div class="map3d-quality">
            <span class="map3d-quality-label" aria-hidden="true">{{ $t('agentReplay.quality') }}</span>
            <SegmentedControl
              :model-value="store.qualityKey"
              :options="qualityOptions"
              :aria-label="$t('agentReplay.quality')"
              data-testid="map-3d-quality"
              @update:model-value="changeQuality"
            />
          </div>
          <SegmentedControl
            :model-value="store.cam === 'follow' ? 'free' : store.cam"
            :options="CAMERAS"
            :aria-label="$t('agentReplay.camera')"
            data-testid="map-3d-camera"
            @update:model-value="chooseCamera"
          />
        </div>
        <p v-if="importMessage" class="map3d-import-note" role="status" data-testid="map-3d-import-note">{{ importMessage }}</p>
        <p class="map3d-hint" data-testid="map-3d-controls-hint">{{ t('mapPreview.controlsHint') }}</p>
      </div>
      <button
        v-if="uiHidden"
        type="button"
        class="map3d-restore map3d-btn"
        :class="{ 'map3d-restore-shifted': fullscreenSupported }"
        data-testid="map-3d-restore-ui"
        :title="t('agentReplay.show_all_ui_hint')"
        @click="toggleUiHidden"
      >{{ t('agentReplay.show_all_ui') }}</button>
    </div>
    <SceneFullscreenButton
      v-if="fullscreenSupported"
      floating
      :is-fullscreen="isFullscreen"
      data-testid="map-3d-fullscreen"
      @toggle="toggleFullscreen()"
    />
    <SceneDistanceSlider
      :get-scene-api="getSceneApi"
      :visible="isPhone && !isPortrait && !uiHidden && (store.cam === 'free' || store.cam === 'top')"
    />
  </div>
</template>

<style scoped src="./MapPreview3DPane.css"></style>
