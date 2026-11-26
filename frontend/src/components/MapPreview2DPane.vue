<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, Image as ImageIcon, PencilRuler, Upload } from 'lucide-vue-next'
import BattleMap from './BattleMap.vue'
import AnnotationToolbar from './AnnotationToolbar.vue'
import SceneFullscreenButton from './SceneFullscreenButton.vue'
import { mapBases } from '../data/mapBases.js'
import { playableBounds } from '../data/playableBounds.js'
import { WORLD_BOUNDS_300 } from '../data/mapImages.js'
import { mapGridProfile, profileMatchesVariant } from '../data/mapSemantics.js'
import { resolveMap2dBasemap } from '../scene/replaySource.js'
import { createMapView } from '../utils/mapView.js'
import {
  ANNOT_COLORS, ANNOT_ERASER_RADIUS_MAX, ANNOT_ERASER_RADIUS_MIN, ANNOT_FONT_SIZE,
  ANNOT_WIDTH_MAX, ANNOT_WIDTH_MIN, canRedo, canUndo, isValidAnnotation,
} from '../utils/annotation.js'
import { useMapPreviewAnnotationFile } from '../composables/useMapPreviewAnnotationFile.js'
import { computeExportDimensions, downloadBlob, sanitizeFilename } from '../utils/exportReplayPng.js'
import { useMapPreview2DCamera } from '../composables/useMapPreview2DCamera.js'
import { useMapPreview2DEditor } from '../composables/useMapPreview2DEditor.js'


const props = defineProps({
  mapKey: { type: String, required: true },
  basemap: { type: Object, required: true },
  basesKind: { type: String, default: null },
  bases: { type: Object, default: null },
  variant: { type: String, default: null },
  variantIsBase: { type: Boolean, default: true },
  active: { type: Boolean, default: true },
})

const { t } = useI18n()

const basemapImage = ref(null)
const basemapError = ref(false)
const image = computed(() => basemapImage.value)
const overview = computed(() => {
  const key = String(props.mapKey).toLowerCase()
  const bounds = playableBounds[key]
  const profile = mapGridProfile(key)
  const variantOk = profileMatchesVariant(profile, props.variant, props.variantIsBase)
  return {
    mapCode: props.mapKey,
    spawnPoints: variantOk ? (profile?.spawnPoints ?? []) : [],
    ...(variantOk && bounds ? { playableBounds: bounds } : {}),
  }
})
const mapView = computed(() => createMapView(image.value, overview.value))

const baseMarkers = computed(() => {
  const kind = props.basesKind
  if (kind !== 'supremacy' && kind !== 'assault') return []
  const pts = (props.bases || mapBases[props.mapKey])?.[kind] || []
  if (kind === 'assault' && pts.length !== 1) return []
  return pts.map((b) => ({
    baseId: kind === 'supremacy' ? b.baseId : 'BASE',
    x: b.x,
    y: b.y,
    radius: b.radius || (kind === 'supremacy' ? 15 : 20),
    status: 'neutral',
    progress: null,
    capturedBy: 'unknown',
  }))
})

async function resolveBasemap(bm) {
  const gen = ++basemapGen
  releasePublishedUrl()
  basemapImage.value = null
  basemapError.value = false
  if (!bm) return
  if (bm.kind === 'bundled') {
    basemapImage.value = bm.image
    return
  }
  const key = bm.mapKey || props.mapKey
  const resolved = await (async () => {
    try {
      return await resolveMap2dBasemap(key, WORLD_BOUNDS_300)
    } catch (e) {
      return { error: 'offline', detail: String(e && e.message || e) }
    }
  })()
  if (gen !== basemapGen) return
  if (resolved.error) {
    if (bm.fallbackImage) {
      basemapImage.value = bm.fallbackImage
      if (import.meta.env.DEV) {
        console.warn(`[map-preview] map2d 底图拒绝（${key}），回落 bundled:`, resolved.error, resolved.detail || '')
      }
      return
    }
    if (import.meta.env.DEV) {
      console.warn(`[map-preview] map2d 底图拒绝（${key}）:`, resolved.error, resolved.detail || '')
    }
    basemapError.value = true
    return
  }
  const blobUrl = URL.createObjectURL(new Blob([resolved.bytes], { type: 'image/webp' }))
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('basemap decode failed'))
      el.src = blobUrl
    })
    if (gen !== basemapGen) {
      URL.revokeObjectURL(blobUrl)
      return
    }
    if (img.naturalWidth !== resolved.width || img.naturalHeight !== resolved.height) {
      if (import.meta.env.DEV) {
        console.warn(`[map-preview] map2d 底图尺寸漂移（${key}）:`, img.naturalWidth, 'x', img.naturalHeight, '!= manifest', resolved.width, 'x', resolved.height)
      }
      URL.revokeObjectURL(blobUrl)
      basemapError.value = true
      return
    }
    releasePublishedUrl()
    publishedUrl.value = blobUrl
    basemapImage.value = {
      src: blobUrl,
      width: resolved.width,
      height: resolved.height,
      coordinateBounds: resolved.worldBounds || WORLD_BOUNDS_300,
    }
  } catch {
    URL.revokeObjectURL(blobUrl)
    if (gen === basemapGen) basemapError.value = true
  }
}

onBeforeUnmount(() => {
  basemapGen++
  releasePublishedUrl()
})

const rootEl = ref(null)
const stageEl = ref(null)
const squareEl = ref(null)
const controlsEl = ref(null)
const mapComponent = ref(null)
const importFile = ref(null)
const camera = useMapPreview2DCamera({ props, rootEl, stageEl, squareEl, controlsEl, mapComponent, image, mapView })
const { mapEl, stageHeight, isPhone, isFullscreen, fullscreenSupported, toggleFullscreen, view, squareSide, fitObserved, stageWidth, stageHeightPx, mapWidth, mapHeight, renderRect, fitScale, applyView, fitView, viewportStyle, screenPoint, onWheel, PAN_THRESHOLD_PX } = camera
const editor = useMapPreview2DEditor({ mapView, camera, mapComponent })
const { annotationOpen, annotationTool, annotationColor, annotationsVisible, routePoints, textSession, exportingImage, exportError, annotWidthSlider, annotationEraserRadius, annotationHistory, annotationIndex, annotations, draft, selectedAnnotationIndex, selectedAnnotation, replaceAnnotations, commitDraft, clearAll, deleteSelected, updateSelected, semPerSvgX, annotWidth, renderedAnnotations, resetAnnotationState, undoAnnotation, redoAnnotation, clearAnnotations, renameSelected, setAnnotationTool, setAnnotationColor, toggleAnnotations, openAnnotation, closeAnnotation, cancelRoute, finishRoute, onPointerDown, onPointerMove, onPointerUp, onStageKeydown, updateTextSession, commitTextSession, cancelTextSession, textInputStyle, mapTouchPan } = editor

let basemapGen = 0
const publishedUrl = ref(null)
function releasePublishedUrl() {
  if (publishedUrl.value) {
    URL.revokeObjectURL(publishedUrl.value)
    publishedUrl.value = null
  }
}

watch(() => props.basemap, (bm) => {
  fitObserved.value = false
  resetAnnotationState()
  resolveBasemap(bm)
}, { immediate: true })

const { importMessage, exportAnnotations, importAnnotations } = useMapPreviewAnnotationFile({
  mapKey: () => props.mapKey,
  annotations,
  validate: isValidAnnotation,
  suffix: '2d',
  apply: (items) => {
    replaceAnnotations(items)
    selectedAnnotationIndex.value = -1
  },
  t,
})

function mapPngFilename() {
  const now = new Date()
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('')
  const time = [String(now.getHours()).padStart(2, '0'), String(now.getMinutes()).padStart(2, '0'), String(now.getSeconds()).padStart(2, '0')].join('')
  return `wotb-map-${sanitizeFilename(props.mapKey)}-${date}-${time}.png`
}

async function exportImage() {
  if (exportingImage.value) return
  const target = mapComponent.value?.mapEl
  if (!target || !image.value) {
    exportError.value = t('mapPreview.annotations.exportFailed')
    return
  }
  if (textSession.value) commitTextSession(textSession.value)
  exportingImage.value = true
  exportError.value = ''
  let container = null
  try {
    await nextTick()
    const rect = target.getBoundingClientRect()
    if (!(rect.width > 0 && rect.height > 0)) throw new Error('map viewport has no size')
    const clone = target.cloneNode(true)
    clone.querySelectorAll('.pb-annot-item.is-selected').forEach((element) => element.classList.remove('is-selected'))
    clone.querySelectorAll('.pb-text-input').forEach((element) => element.remove())
    clone.style.width = `${rect.width}px`
    clone.style.height = `${rect.height}px`
    container = document.createElement('div')
    container.style.position = 'fixed'
    container.style.left = '-10000px'
    container.style.top = '0'
    container.style.pointerEvents = 'none'
    container.setAttribute('aria-hidden', 'true')
    container.appendChild(clone)
    document.body.appendChild(container)
    const dims = computeExportDimensions({ width: rect.width, height: rect.height })
    const stageBackground = stageEl.value ? getComputedStyle(stageEl.value).backgroundColor : ''
    const canvasBackground = stageBackground && stageBackground !== 'rgba(0, 0, 0, 0)'
      ? stageBackground
      : (getComputedStyle(document.documentElement).getPropertyValue('--color-canvas').trim() || '#000')
    const html2canvas = (await import('html2canvas')).default
    const canvas = await html2canvas(clone, {
      scale: dims.scale,
      useCORS: true,
      backgroundColor: canvasBackground,
      width: dims.width,
      height: dims.height,
    })
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('canvas.toBlob returned null')
    await downloadBlob(blob, mapPngFilename())
  } catch (error) {
    console.error('[Map Preview PNG Export] failed', error)
    exportError.value = t('mapPreview.annotations.exportFailed')
  } finally {
    if (container?.parentNode) container.parentNode.removeChild(container)
    exportingImage.value = false
  }
}

const stubText = () => ''
const stubNull = () => null
const stubFloatClass = () => ''
</script>

<template>
  <div ref="rootEl" class="map2d" :class="{ 'map2d-phone': isPhone }" data-testid="map-2d-pane">
    <SceneFullscreenButton
      v-if="fullscreenSupported"
      floating
      :is-fullscreen="isFullscreen"
      data-testid="map-2d-fullscreen"
      @toggle="toggleFullscreen()"
    />
    <div class="map2d-body" :style="isPhone ? null : { height: stageHeight }">
      <div
        ref="stageEl"
        class="map2d-stage"
        data-testid="map-2d-stage"
        :style="isPhone && squareSide ? { height: squareSide + 'px' } : null"
        tabindex="0"
        @wheel="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @keydown="onStageKeydown"
      >
      <div
        ref="squareEl"
        class="map2d-square"
        :style="squareSide ? { width: squareSide + 'px', height: squareSide + 'px' } : null"
      >
        <p v-if="basemapError" class="map2d-error" data-testid="map-2d-basemap-error">{{ $t('mapPreview.basemapFailed') }}</p>
        <BattleMap
          v-if="image"
          ref="mapComponent"
          class="map2d-battlemap"
          :image="image"
          :map-view="mapView"
          :pb-overview="overview"
          spawn-color-mode="scene-team"
          :show-playable-boundary="true"
          :bases="baseMarkers"
          :view-scale="view.scale"
          :viewport-style="viewportStyle"
          :touch-pan="mapTouchPan"
          :terrain-relief="false"
          :annot-visible="annotationsVisible"
          :rendered-annotations="renderedAnnotations"
          :annot-font-size="ANNOT_FONT_SIZE"
          :active-tool="annotationTool"
          :text-session="textSession"
          :text-input-style="textInputStyle"
          :marker-label="stubText"
          :hp-for="stubNull"
          :hp-prefs="{}"
          :translate="t"
          :ghost-for="stubNull"
          :flash-for="stubNull"
          :float-team-class="stubFloatClass"
          @update-text="updateTextSession"
          @commit-text="commitTextSession"
          @cancel-text="cancelTextSession"
        />
      </div>
    </div>
    <div ref="controlsEl" class="map2d-controls">
      <div v-if="annotationOpen" class="map2d-annotations" data-testid="map-2d-annotations">
        <AnnotationToolbar
          :open="annotationOpen"
          :compact="isPhone && isFullscreen"
          :active-tool="annotationTool"
          :annot-colors="ANNOT_COLORS"
          :annot-color="annotationColor"
          :annot-visible="annotationsVisible"
          :annot-width-slider="annotWidthSlider"
          :annot-width-min="ANNOT_WIDTH_MIN"
          :annot-width-max="ANNOT_WIDTH_MAX"
          :selected-annotation="selectedAnnotation"
          :route-point-count="routePoints.length"
          :eraser-radius-slider="annotationEraserRadius"
          :eraser-radius-min="ANNOT_ERASER_RADIUS_MIN"
          :eraser-radius-max="ANNOT_ERASER_RADIUS_MAX"
          :history-index="annotationIndex"
          :history="annotationHistory"
          :can-undo="canUndo"
          :can-redo="canRedo"
          @toggle-tool="setAnnotationTool"
          @set-annot-color="setAnnotationColor"
          @update:annot-width="annotWidthSlider = $event"
          @update:eraser-radius="annotationEraserRadius = $event"
          @undo="undoAnnotation"
          @redo="redoAnnotation"
          @clear-annotations="clearAnnotations"
          @toggle-annotations="toggleAnnotations"
          @rename-selected="renameSelected"
          @delete-selected="deleteSelected"
          @finish-route="finishRoute"
          @cancel-route="cancelRoute"
          @close="closeAnnotation"
        />
      </div>
      <div v-else class="map2d-toolrow">
        <button
          type="button"
          class="map2d-btn"
          data-testid="map-2d-drawing-entry"
          :aria-label="t('recon.map.playback.annot.mode')"
          :title="t('recon.map.playback.annot.mode')"
          @click="openAnnotation"
        >
          <PencilRuler :size="16" aria-hidden="true" /> {{ t('recon.map.playback.annot.mode') }}
        </button>
        <button
          type="button"
          class="map2d-btn"
          data-testid="map-2d-import"
          :title="$t('mapPreview.annotations.import')"
          @click="importFile.click()"
        >
          <Upload :size="16" aria-hidden="true" /> {{ $t('mapPreview.annotations.import') }}
        </button>
        <button
          type="button"
          class="map2d-btn"
          data-testid="map-2d-export"
          :title="$t('mapPreview.annotations.export')"
          @click="exportAnnotations"
        >
          <Download :size="16" aria-hidden="true" /> {{ $t('mapPreview.annotations.export') }}
        </button>
        <input
          ref="importFile"
          type="file"
          accept="application/json,.json"
          class="map2d-file-input"
          aria-hidden="true"
          tabindex="-1"
          @change="importAnnotations"
        />
      </div>
      <div class="map2d-image-row">
        <button
          type="button"
          class="map2d-btn"
          data-testid="map-2d-export-image"
          :disabled="exportingImage || !image"
          @click="exportImage"
        >
          <ImageIcon :size="16" aria-hidden="true" />
          {{ exportingImage ? $t('mapPreview.annotations.exporting') : $t('mapPreview.annotations.exportImage') }}
        </button>
        <p v-if="exportError" class="map2d-export-error" role="alert" data-testid="map-2d-export-error">{{ exportError }}</p>
      </div>
      <p v-if="importMessage" class="map2d-import-note" role="status" data-testid="map-2d-import-note">{{ importMessage }}</p>
      <p class="map2d-hint" data-testid="map-2d-controls-hint">{{ t('mapPreview.controlsHint2d') }}</p>
    </div>
    </div>
  </div>
</template>

<style scoped src="./MapPreview2DPane.css"></style>
