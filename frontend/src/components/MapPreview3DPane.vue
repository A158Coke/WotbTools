<script setup>
/**
 * 地图预览 3D 面板：playbackScene.loadMapOnly 的宿主——地图面资产
 * （ground/terrain/lighting/IBL/scenery/destructibles 完好预状态）+ 相机（俯视 / 自由飞行）
 * + 地形锚定标注绘制，无车辆、无传输、不依赖回放文件。
 *
 * 会话生命周期与 Replay3DPane 同一不变量（sceneApi 存在 ⟺ 活的 stage DOM ∧ WebGL 可用
 * ∧ 资产连通），加载纪律（loading/err/assetStage/assetProgress 唯一写入权）归内核
 * `loadMapOnly`，本组件只发命令。标注状态机与 3D 回放同源（utils/annotation 全套），
 * 差异只有就绪门控（mapReady 而非 hasData）与标注的文件导入/导出。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, Maximize, Minimize, PencilRuler, TriangleAlert, Upload } from 'lucide-vue-next'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { createPlaybackStore } from '../scene/playbackStore.js'
import { initPlayback, QUALITY_PRESETS } from '../scene/playbackScene.js'
import { detectWebGL } from '../scene/webglSupport.js'
import { useSceneFlyControls } from '../composables/useSceneFlyControls.js'
import { usePlaybackFullscreen } from '../composables/usePlaybackFullscreen.js'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import { isInteractiveTarget } from '../composables/usePlaybackTransport.js'
import { usePaneFillHeight } from '../composables/usePaneFillHeight.js'
import Scene3DStatus from './Scene3DStatus.vue'
import AnnotationToolbar from './AnnotationToolbar.vue'
import {
  ANNOT_COLORS, ANNOT_ERASER_RADIUS_DEFAULT, ANNOT_ERASER_RADIUS_MAX, ANNOT_ERASER_RADIUS_MIN,
  ANNOT_WIDTH_DEFAULT, ANNOT_WIDTH_MAX, ANNOT_WIDTH_MIN,
  applyEraser, canRedo, canUndo, commit, redo, undo,
} from '../utils/annotation.js'

const props = defineProps({
  /** 资产面数字地图 id（loadMapOnly 'id=' 解析入口） */
  mapId: { type: Number, required: true },
  /** 已本地化的地图名（picker 侧解析；内核只用于顶栏名） */
  mapName: { type: String, default: '' },
  /** 资产面 key（标注导入/导出归属校验） */
  mapKey: { type: String, required: true },
  /** 隐藏时停帧不销毁（页面 v-show 切 2D/3D） */
  active: { type: Boolean, default: true },
})

const { t } = useI18n()
const { availability, requireFeature } = useFeatureGate()
const online = computed(() => availability(Feature.PLAYBACK_3D))
const webgl = detectWebGL()

const store = createPlaybackStore()
const stage = ref(null)
let sceneApi = null
// Stage 高度（usePaneFillHeight：视口剩余高度的 JS 度量，全屏吃满）。
// rootEl 必须先于 fullscreen/fly 等 composable 声明——它们的 option getter 同步读取它。
const rootEl = ref(null)
const { height: stageH } = usePaneFillHeight(rootEl)

// ---------- 相机 / 画质 / 全屏 / 飞行 ----------
const CAMERAS = computed(() => [
  { value: 'free', label: t('agentReplay.cam_free') },
  // 俯视是持续模式（OrbitControls 绕地图中心旋转/缩放），与自由并列；地图预览无跟随
  { value: 'top', label: t('agentReplay.cam_top') },
])
function chooseCamera(mode) {
  sceneApi?.setCam(mode)
}
const QUALITY_ORDER = Object.keys(QUALITY_PRESETS)
const qualityOptions = computed(() =>
  QUALITY_ORDER.map((k) => ({ value: k, label: t('agentReplay.q_' + k) })),
)
/** 画质切换：地图会话不整页 reload——拆场景重建（DATA=null 时 setQuality 直改档），重载当前图。
 *  标注状态跨重建保留（拆场景只回收 GPU 资源；撤销栈与画面归属是会话级的）。 */
function changeQuality(k) {
  if (k === store.qualityKey) return
  const savedHistory = annotationHistory.value
  const savedIndex = annotationIndex.value
  const savedVisible = annotationsVisible.value
  destroyScene()
  ensureScene()
  sceneApi?.setQuality?.(k)
  annotationHistory.value = savedHistory
  annotationIndex.value = savedIndex
  annotationsVisible.value = savedVisible
  pushAnnotationProjection()
  pushAnnotationVisibility()
  reloadMap()
}
const { isPhone } = usePlaybackPhoneForm()
const { isFullscreen, fullscreenSupported, toggleFullscreen } = usePlaybackFullscreen({
  target: () => rootEl.value,
  isPhone,
  isActive: () => props.active,
})
const fly = useSceneFlyControls({
  setFlySpeed: (n) => sceneApi?.setFlySpeed(n),
  isActive: () => props.active,
  canFly: () => !!sceneApi && store.mapReady,
  getSceneApi: () => sceneApi,
})

// ---------- 标注（terrain-anchored drawing）----------
const annotationOpen = ref(false)
const annotationTool = ref(null)
const annotationColor = ref(ANNOT_COLORS[0])
const annotationWidthSlider = ref(ANNOT_WIDTH_DEFAULT)
const annotationEraserRadius = ref(ANNOT_ERASER_RADIUS_DEFAULT)
const annotationsVisible = ref(true)
const annotationHistory = ref([[]])
const annotationIndex = ref(0)
const annotations = computed(() => annotationHistory.value[annotationIndex.value] || [])

function pushAnnotationProjection() {
  sceneApi?.setAnnotations?.(annotations.value)
}
function pushAnnotationInteraction() {
  sceneApi?.setAnnotationInteraction?.({
    enabled: annotationOpen.value && !!annotationTool.value && store.mapReady,
    tool: annotationTool.value,
    color: annotationColor.value,
    width: annotationWidthSlider.value,
    eraserWidth: annotationEraserRadius.value,
  })
}
function pushAnnotationVisibility() {
  sceneApi?.setAnnotationsVisible?.(annotationsVisible.value)
}
function replaceAnnotations(next) {
  const state = commit(annotationHistory.value, annotationIndex.value, next)
  annotationHistory.value = state.history
  annotationIndex.value = state.index
}
function commitAnnotationFromScene(annotation) {
  replaceAnnotations([...annotations.value, annotation])
}
function eraseFromScene(path) {
  const next = applyEraser(annotations.value, path.points, path.radius)
  if (next !== annotations.value) replaceAnnotations(next)
}
function undoAnnotation() {
  const state = undo(annotationHistory.value, annotationIndex.value)
  annotationHistory.value = state.history
  annotationIndex.value = state.index
}
function redoAnnotation() {
  const state = redo(annotationHistory.value, annotationIndex.value)
  annotationHistory.value = state.history
  annotationIndex.value = state.index
}
function clearAnnotations() {
  if (annotations.value.length) replaceAnnotations([])
}
function toggleAnnotationsVisible() {
  annotationsVisible.value = !annotationsVisible.value
}
function setAnnotationTool(tool) {
  annotationTool.value = tool
  if (!annotationsVisible.value) annotationsVisible.value = true
}
function openAnnotation() {
  if (annotationOpen.value) return
  annotationOpen.value = true
  annotationTool.value = 'pen'
  annotationsVisible.value = true
  pushAnnotationProjection()
  pushAnnotationInteraction()
  pushAnnotationVisibility()
}
function closeAnnotation() {
  annotationOpen.value = false
  annotationTool.value = null
  pushAnnotationInteraction()
}
function resetAnnotationState() {
  annotationHistory.value = [[]]
  annotationIndex.value = 0
  annotationOpen.value = false
  annotationTool.value = null
  annotationsVisible.value = true
  sceneApi?.setAnnotations?.([])
  sceneApi?.setAnnotationInteraction?.({ enabled: false, tool: null })
  sceneApi?.setAnnotationsVisible?.(true)
}

// ---------- 标注导入 / 导出（会话内的文件落盘；fail-closed 校验）----------
const IMPORT_KIND = 'map-preview-annotations-3d'
const importMessage = ref('')
let importMessageTimer = 0
function flashImportMessage(key, values) {
  importMessage.value = t(key, values)
  clearTimeout(importMessageTimer)
  importMessageTimer = setTimeout(() => { importMessage.value = '' }, 4000)
}
function exportAnnotations() {
  if (!annotations.value.length) {
    flashImportMessage('mapPreview.annotations.noAnnotations')
    return
  }
  const payload = {
    version: 1,
    kind: IMPORT_KIND,
    mapKey: props.mapKey,
    exportedAt: new Date().toISOString(),
    annotations: annotations.value,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `map-annotations-${props.mapKey}-3d.json`
  a.click()
  URL.revokeObjectURL(url)
}
async function importAnnotations(event) {
  const file = event.target.files?.[0] || null
  event.target.value = ''
  if (!file) return
  let payload = null
  try {
    payload = JSON.parse(await file.text())
  } catch {
    flashImportMessage('mapPreview.annotations.importFailed', { reason: t('mapPreview.annotations.importReasonFormat') })
    return
  }
  if (!payload || payload.version !== 1 || payload.kind !== IMPORT_KIND || !Array.isArray(payload.annotations)) {
    flashImportMessage('mapPreview.annotations.importFailed', { reason: t('mapPreview.annotations.importReasonFormat') })
    return
  }
  if (payload.mapKey !== props.mapKey) {
    flashImportMessage('mapPreview.annotations.importFailed', { reason: t('mapPreview.annotations.importReasonMap') })
    return
  }
  const items = payload.annotations.filter((a) => a && typeof a === 'object')
  replaceAnnotations(items)
  flashImportMessage('mapPreview.annotations.importedCount', { count: items.length })
}

// ---------- 会话生命周期 ----------
function destroyScene() {
  resetAnnotationState()
  fly.stopLoop()
  if (!sceneApi) return
  sceneApi.destroy?.()
  sceneApi = null
}
function shouldHaveScene() {
  return online.value.available && !!webgl.supported
}
function ensureScene() {
  if (sceneApi || !shouldHaveScene()) return false
  // stage 必须已挂在文档上：canvas append 到游离节点会静默丢失（模板切换的残留防护）
  if (!stage.value?.isConnected) return false
  sceneApi = initPlayback(stage.value, store, null, {
    onAnnotationCommit: commitAnnotationFromScene,
    onAnnotationErase: eraseFromScene,
  })
  sceneApi?.setPaused?.(!props.active)
  sceneApi?.setFlySpeed?.(fly.flySpeedIndex())
  pushAnnotationProjection()
  pushAnnotationInteraction()
  pushAnnotationVisibility()
  return true
}
function reloadMap() {
  if (!sceneApi || !props.mapId || !requireFeature(Feature.PLAYBACK_3D)) return
  sceneApi.loadMapOnly({ mapId: props.mapId, mapName: props.mapName })
}
// 换图判定只看 mapId（图身份）：mapName 是 locale 派生的显示名——切语言会变，
// 但图没换，标注与撤销栈不得清空（名称更新由页面 header 的 computed 承担）。
watch(() => props.mapId, () => {
  resetAnnotationState()   // 换图 = 换标注语义；旧标注不跨图残留
  if (shouldHaveScene()) {
    ensureScene()
    reloadMap()
  }
})
watch(() => props.active, (active) => {
  sceneApi?.setPaused?.(!active)
  if (!active && annotationOpen.value) closeAnnotation()
})
// annotation 投影 / 交互 / 可见性的唯一推送方向（pane → scene）——与 Replay3DPane
// 同一接线。没有这组 watch，画笔提交/导入/撤销/擦除/工具与可见性变化只改 refs，
// 内核侧画面永远不更新。
watch(annotations, pushAnnotationProjection)
watch(
  [annotationOpen, annotationTool, annotationColor, annotationWidthSlider, annotationEraserRadius, () => store.mapReady],
  pushAnnotationInteraction,
)
watch(annotationsVisible, pushAnnotationVisibility)
watch(() => store.mapReady, (ready) => {
  if (!ready && annotationOpen.value) closeAnnotation()
  // loadMapOnly 的 teardown 清空内核侧标注数组（会话纪律与回放一致）；pane 的
  // 撤销栈是权威——就绪后把当前标注整体补推回内核（换图/画质重建同样经过这里）。
  if (ready) {
    pushAnnotationProjection()
    pushAnnotationVisibility()
  }
})
/**
 * 连通性翻转兜底（矿井阵地空白页根因）：组件可能在连通性检测仍 pending 时挂载
 * （`online.available=false` → `shouldHaveScene()` false），而 onMounted 只拍一次、
 * available 翻转后没有任何人拉起场景——stage 留空、零错误。这里对
 * available/active 的每次变化做 reconcile：首次可建（含 pending→available 翻转）
 * 装载当前图，active 翻转只改暂停态，离线则拆场景。
 */
watch(
  () => [online.value.available, props.active],
  ([available, active], [prevAvailable] = []) => {
    if (!shouldHaveScene()) {
      destroyScene()
      return
    }
    nextTick(() => {
      const created = ensureScene()
      if (!sceneApi) return
      sceneApi.setPaused?.(!active)
      // 首次可建（含 pending→available 翻转）才装载；active 翻转不重复装图
      if (created || (available === true && prevAvailable === false)) reloadMap()
    })
  },
  { immediate: true },
)

// ---------- 「隐藏全部 UI」（与 3D 回放同一语义，不持久化）----------
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

// ---------- 帧率角标（与 3D 回放同源 store 字段）----------
const fpsText = computed(() => (store.fps > 0
  ? `${store.fps.toFixed(1)} FPS · ${store.frameMs.toFixed(1)}/${store.framePeakMs.toFixed(1)} ms`
  : '— FPS'))
const fpsJanky = computed(() => store.fps > 0
  && (store.fps < 45 || (store.framePeakMs > 0 && store.framePeakMs > store.frameMs * 2.5)))

// ---------- 就绪 / 状态投影（加载纪律在内核，组件只读）----------
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
  // 场景拉起归上面的 immediate reconcile watcher（覆盖连通性 pending 竞态）
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onUiToggleKeydown)
  destroyScene()
})

if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) {
  window.__mapPreviewPane = {
    store,
    get sceneApi() { return sceneApi },
  }
}
</script>

<template>
  <div ref="rootEl" class="map3d" :data-pane-ready="paneReady ? 'true' : undefined" data-testid="map-3d-pane">
    <!-- 连通性不可用是环境事实，stage 不渲染（available 翻转后由 reconcile watcher 建场景）。
         注意 loading/error **不得**走模板分支：initScene 的 canvas append 在 loadMapOnly
         开跑时执行，分支切换会卸载 stage、把 canvas 丢进游离 DOM（矿井阵地空白页根因）。
         因此 stage 常驻，加载/错误是覆盖层（与回放 3D 的 pb-root 同一结构）。 -->
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
        <!-- 资产降级是非阻塞状态（与回放 3D 同一口径）：场景可交互，但缺失必须可见 -->
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
          <AnnotationToolbar
            :open="annotationOpen"
            compact
            :active-tool="annotationTool"
            :annot-colors="ANNOT_COLORS"
            :annot-color="annotationColor"
            :annot-visible="annotationsVisible"
            :annot-width-slider="annotationWidthSlider"
            :annot-width-min="ANNOT_WIDTH_MIN"
            :annot-width-max="ANNOT_WIDTH_MAX"
            :allowed-tools="['pen', 'eraser']"
            :eraser-radius-slider="annotationEraserRadius"
            :eraser-radius-min="ANNOT_ERASER_RADIUS_MIN"
            :eraser-radius-max="ANNOT_ERASER_RADIUS_MAX"
            :history-index="annotationIndex"
            :history="annotationHistory"
            :can-undo="canUndo"
            :can-redo="canRedo"
            @toggle-tool="setAnnotationTool"
            @set-annot-color="annotationColor = $event"
            @update:annot-width="annotationWidthSlider = $event"
            @update:eraser-radius="annotationEraserRadius = $event"
            @undo="undoAnnotation"
            @redo="redoAnnotation"
            @clear-annotations="clearAnnotations"
            @toggle-annotations="toggleAnnotationsVisible"
            @close="closeAnnotation"
          />
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
          <label class="map3d-quality">
            <span class="map3d-quality-label">{{ $t('agentReplay.quality') }}</span>
            <select
              data-testid="map-3d-quality"
              :value="store.qualityKey"
              @change="changeQuality($event.target.value)"
            >
              <option v-for="opt in qualityOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </label>
          <select
            data-testid="map-3d-camera"
            class="map3d-cam"
            :value="store.cam === 'follow' ? 'free' : store.cam"
            :aria-label="$t('agentReplay.camera')"
            @change="chooseCamera($event.target.value)"
          >
            <option v-for="c in CAMERAS" :key="c.value" :value="c.value">{{ c.label }}</option>
          </select>
          <button
            v-if="fullscreenSupported"
            type="button"
            class="map3d-btn map3d-btn-icon"
            data-testid="map-3d-fullscreen"
            :aria-label="t(isFullscreen ? 'recon.map.playback.exit_fullscreen' : 'recon.map.playback.enter_fullscreen')"
            @click="toggleFullscreen()"
          >
            <component :is="isFullscreen ? Minimize : Maximize" :size="16" aria-hidden="true" />
          </button>
        </div>
        <p v-if="importMessage" class="map3d-import-note" role="status" data-testid="map-3d-import-note">{{ importMessage }}</p>
      </div>
      <button
        v-if="uiHidden"
        type="button"
        class="map3d-restore map3d-btn"
        data-testid="map-3d-restore-ui"
        :title="t('agentReplay.show_all_ui_hint')"
        @click="toggleUiHidden"
      >{{ t('agentReplay.show_all_ui') }}</button>
    </div>
  </div>
</template>

<style scoped>
.map3d {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.map3d-note {
  padding: var(--space-4);
  color: var(--color-text-secondary);
  font: var(--type-body);
}

.map3d-root {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.map3d:fullscreen {
  padding: 0;
  background: var(--color-canvas);
}

/* root 高度 = 视口剩余高度（usePaneFillHeight）：stage 吃剩余、controls 固有高
   ——场景与下方绘制菜单同屏，不把菜单挤出视口。 */
.map3d-stage {
  position: relative;
  flex: 1 1 0;
  min-height: 0;
}

/* 加载/错误覆盖层：stage 常驻（canvas 不可被模板切换卸载），状态浮在其上 */
.map3d-status-overlay {
  position: absolute;
  inset: 0;
  z-index: var(--z-sticky);
}

.map3d-stage .scene {
  width: 100%;
  height: 100%;
}

.map3d-stage .scene :deep(canvas) {
  display: block;
  touch-action: none;
}

.map3d-fps {
  position: absolute;
  inset-block-start: var(--space-2);
  inset-inline-start: var(--space-2);
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-scrim);
  color: var(--color-text-primary);
  font: var(--type-caption-xs);
  line-height: var(--line-height-caption-xs);
  pointer-events: none;
}

.map3d-fps-low {
  color: var(--color-warning);
}

.map3d-controls {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
}

.map3d-degraded {
  position: absolute;
  inset-block-start: var(--space-2);
  inset-inline-end: var(--space-2);
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  max-width: calc(100% - var(--space-4));
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-warning);
  font: var(--type-caption);
  pointer-events: none;
}

.map3d-toolrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.map3d-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--control-h-sm);
  padding: 0 var(--space-2);
  border: var(--border-width) solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
  font: var(--type-caption);
  cursor: pointer;
}

.map3d-btn:hover {
  border-color: var(--color-border-strong);
}

.map3d-btn:focus-visible {
  outline: var(--focus-outline);
  outline-offset: var(--focus-outline-offset);
}

.map3d-btn-icon {
  padding: 0 var(--space-2);
}

.map3d-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

.map3d-spacer {
  flex: 1;
}

.map3d-quality {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--color-text-secondary);
  font: var(--type-caption);
}

.map3d-quality select,
.map3d-cam {
  min-height: var(--control-h-sm);
  border: var(--border-width) solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
  font: var(--type-caption);
}

.map3d-quality select:focus-visible,
.map3d-cam:focus-visible {
  outline: var(--focus-outline);
  outline-offset: var(--focus-outline-offset);
}

.map3d-import-note {
  margin: 0;
  color: var(--color-text-secondary);
  font: var(--type-caption);
}

.map3d-annotations {
  min-width: 0;
}

.map3d-restore {
  position: absolute;
  inset-block-start: var(--space-2);
  inset-inline-end: var(--space-2);
  z-index: var(--z-sticky);
}
</style>
