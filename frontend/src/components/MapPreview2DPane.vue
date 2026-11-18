<script setup>
/**
 * 地图预览 2D 面板：底图双源（打包 mapImages 注册表 / 资产包 ground.webp 回退）
 * + 拖拽/捏合/滚轮缩放 + 标注绘制（pen/eraser，与 2D 回放同一坐标体系与撤销栈），
 * 无车辆、无回放。
 *
 * 手势与坐标管线复用回放的纯函数（zoomViewAt / clampViewPan / screenToSemantic /
 * utils/annotation 全套）；渲染复用 BattleMap.vue（纯展示，车辆/浮层以空数组 +
 * 桩函数传入）。标注与 Playback 2D 同一 schema/renderer/toolbar；本面板只负责
 * static-map 上下文的 orchestration、会话内保存 + 完整 JSON 导入导出 + 当前视角 PNG。
 */
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

// 地图语义档案读取已收敛到 data/mapSemantics.js（与 3D 预览/回放同一入口；
// 出生点取 `sceneEvidence.battlePoints`，边界表由 `playableBoundsMeters` 生成，缺档 fail-closed）。

const props = defineProps({
  /** 资产面 key（= 标注导入/导出归属校验） */
  mapKey: { type: String, required: true },
  /**
   * 底图描述符（页面对照双源解析后下发）：
   * { kind:'bundled', image } —— 打包注册表条目（src/width/height/coordinateBounds）；
   * { kind:'ground', mapKey } —— 资产包 ground.webp（异步加载，±300 契约框：
   * 3D 内核 meta 恒等回退与打包图同框，坐标体系一致）。
   */
  basemap: { type: Object, required: true },
  /**
   * 基地点位组键（页面 ?bases= 解析后下发）：'supremacy' | 'assault' | null。
   * null / 组无几何 → 不渲染（fail-closed，绝不从内容猜坐标）。
   */
  basesKind: { type: String, default: null },
  /**
   * 该变体的基地点位条目（页面按 index 的 variant 标签从 mapBases[key].variants 解析）；
   * 缺省回退 mapBases[mapKey]（单变体地图/旧调用）。
   */
  bases: { type: Object, default: null },
  /** 当前变体标签（nt0/nt1…）：与语义档案 battleVariant 不符时隐藏该档出生点/边界。 */
  variant: { type: String, default: null },
  /** 选中条目是否基础（首个）index 条目：额外条目缺变体归属时不得复用基础档案。 */
  variantIsBase: { type: Boolean, default: true },
  /** 页面 v-show 生命周期闸门：失活时退出全屏，避免全屏落在隐藏面板上 */
  active: { type: Boolean, default: true },
})

const { t } = useI18n()

// ---------- 底图与坐标映射 ----------
const basemapImage = ref(null)   // { src, width, height, coordinateBounds }
const basemapError = ref(false)
const image = computed(() => basemapImage.value)
/** 2D 预览只读消费 canonical 地图事实，不新增第二份数据：spawn 来自语义
 *  `sceneEvidence.battlePoints`（预览无战局上下文 → 不传 friendlyTeam；spawnColorMode
 *  'scene-team' 让 BattleMap 按场景分组 team 画固定身份色，非 friendly/enemy 相对语义），
 *  边界来自 generated `playableBounds`（与 3D 边界 fallback 同一份）；缺档不猜。 */
const overview = computed(() => {
  const key = String(props.mapKey).toLowerCase()
  const bounds = playableBounds[key]
  const profile = mapGridProfile(key)
  // 语义档案的 battleVariant 只代表该变体；不匹配 = 该变体没有已验证的出生点/可玩
  // 边界 ⇒ 两者都隐藏（不能把 nt0 的档案画到 nt1/nt2 上）。
  const variantOk = profileMatchesVariant(profile, props.variant, props.variantIsBase)
  return {
    mapCode: props.mapKey,
    spawnPoints: variantOk ? (profile?.spawnPoints ?? []) : [],
    ...(variantOk && bounds ? { playableBounds: bounds } : {}),
  }
})
const mapView = computed(() => createMapView(image.value, overview.value))

// ---------- 基地点位（BattleMap :bases，与 2D 回放同一渲染与口径）----------
// 静态预览没有占领状态：固定 neutral、progress null（不渲染水位）。
// 半径是世界坐标米：supremacy 条目缺省 15m、assault 缺省 20m（与回放同一
// presentation fallback，BattleMap.baseRadius 负责米→SVG 像素换算）。
// assault 组多 candidate 无证据 fail-closed（与 3D/回放同式）：几何不唯一就不画。
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

/**
 * 底图解析：bundled 同步就位；map2d（全部 43 张的 canonical 1254² 校准战术底图，
 * ~900KB）异步经 map2d/index.json 的几何 + 完整性契约解析，失败 fail-visible。
 * 请求代际见 publishedUrl 注释：快速切图 A→B 时旧请求只清理自己的资源。
 */
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
  // map2d/index.json 契约（schema/generated、worldBounds/orientation、图片字节 sha256）：
  // 任一不成立 fail-visible，绝不"能加载就当 ±300"。世界框取自索引声明
  // （geometryMatches 已保证与注册表逐值相等）。
  const resolved = await (async () => {
    try {
      return await resolveMap2dBasemap(key, WORLD_BOUNDS_300)
    } catch (e) {
      return { error: 'offline', detail: String(e && e.message || e) }
    }
  })()
  if (gen !== basemapGen) return   // 过期（换图/卸载已介入）：未创建任何资源，直接退出
  if (resolved.error) {
    // 显式选择 dataset 时 map2d 优先；该 dataset 缺图/契约失败仍回落 bundled，
    // 不让 2D 预览因为版本切换而整块失败。
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
  // 校验通过的字节转 blob URL 供 <img> 使用（避免二次拉取；释放见代际模型注释）
  const blobUrl = URL.createObjectURL(new Blob([resolved.bytes], { type: 'image/webp' }))
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('basemap decode failed'))
      el.src = blobUrl
    })
    // 代际核验必须先于任何状态写入：过期请求只释放自己的 URL 后退出——
    // 否则旧请求的尺寸失败/错误状态会误置到新代已发布的底图上。
    if (gen !== basemapGen) {
      URL.revokeObjectURL(blobUrl)   // 过期：只清理自己创建的 URL，新代的 owner 不归我管
      return
    }
    // 解码尺寸必须与 manifest 声明一致：index↔图片发布漂移（重导出/裁切）在此 fail-visible，
    // 不静默改用解码尺寸渲染（那会让 ±300 映射整体错位且无任何提示）。
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
    URL.revokeObjectURL(blobUrl)     // 解码失败：自己清理自己的 URL
    if (gen === basemapGen) basemapError.value = true
  }
}

/** 卸载：在途请求全部过期，已发布 URL 释放（900KB/张不常驻）。 */
onBeforeUnmount(() => {
  basemapGen++
  releasePublishedUrl()
})
// 底图解析的 watch 注册在标注状态声明之后（见文件后部）——immediate 首评需要完整状态

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

/**
 * blob URL 生命周期（请求代际模型）：换图/卸载递增 `basemapGen` 使所有在途请求过期；
 * 每个请求只清理**自己创建**的资源——过期请求 revoke 自己的 URL 后退出，绝不触碰
 * 新代已发布的 URL；`publishedUrl` 是唯一已发布 owner（revoke 它 = 换图/卸载释放）。
 * 快速切图 A→B 的正确性：旧请求在每个 await 后核验代际，发布前再核验一次。
 */
let basemapGen = 0
const publishedUrl = ref(null)
function releasePublishedUrl() {
  if (publishedUrl.value) {
    URL.revokeObjectURL(publishedUrl.value)
    publishedUrl.value = null
  }
}

// ---------- 底图切换 = 换图：标注清空（语义随图）+ 重解析底图 + 重新 fit ----------
watch(() => props.basemap, (bm) => {
  fitObserved.value = false
  resetAnnotationState()
  resolveBasemap(bm)
}, { immediate: true })

// ---------- 标注导入 / 导出（完整 schema；旧 pen-only / -2d / -3d 兼容）----------
// 文件 schema owner = useMapPreviewAnnotationFile（与 3D 预览共用，可互导）。
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

// ---------- 当前视角 PNG 导出（html2canvas 捕获 BattleMap 的 .pb-map）----------
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

// BattleMap 必填的呈现函数在空车辆/浮层下不会被调用（预览无实体）
const stubText = () => ''
const stubNull = () => null
const stubFloatClass = () => ''
</script>

<template>
  <!-- 观察层（rootEl）与固定高度层（.map2d-body）分离：usePaneFillHeight 的 RO 观察
       外层——高度写在外层自身会让 RO 失活（固定盒不再 resize，陈旧测量死锁）。 -->
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
      <!-- 居中方形舞台（边长 JS 实测 = min(舞台宽, 舞台高)）：底图 1:1 契约框是
           正方形，contain fit 以舞台为界（与回放正方形 stage 同构）——宽屏不留
           裁切、窄屏不留横滚，标注语义坐标不变。 -->
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
      <!-- 页面级操作帮助（Map Preview 无正式教程入口，本提示即最小帮助入口） -->
      <p class="map2d-hint" data-testid="map-2d-controls-hint">{{ t('mapPreview.controlsHint2d') }}</p>
    </div>
    </div>
  </div>
</template>

<style scoped src="./MapPreview2DPane.css"></style>
