<script setup>
/**
 * 地图预览 3D 面板：playbackScene.loadMapOnly 的宿主——地图面资产
 * （ground/terrain/lighting/IBL/scenery/destructibles 完好预状态）+ 相机（俯视 / 自由飞行）
 * + 表面锚定标注绘制（无 scenery 锚点时回落地形），无车辆、无传输、不依赖回放文件。
 *
 * 会话生命周期与 Replay3DPane 同一不变量（sceneApi 存在 ⟺ 活的 stage DOM ∧ WebGL 可用
 * ∧ 资产连通），加载纪律（loading/err/assetStage/assetProgress 唯一写入权）归内核
 * `loadMapOnly`，本组件只发命令。标注状态机与 3D 回放同源（utils/annotation 全套），
 * 差异只有就绪门控（mapReady 而非 hasData）与标注的文件导入/导出。
 */
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
  /** 资产面数字地图 id（loadMapOnly 'id=' 解析入口） */
  mapId: { type: Number, required: true },
  /** 已本地化的地图名（picker 侧解析；内核只用于顶栏名） */
  mapName: { type: String, default: '' },
  /** 资产面 key（标注导入/导出归属校验） */
  mapKey: { type: String, required: true },
  /**
   * 基地点位组键（页面 ?bases= 解析后下发）：'supremacy' | 'assault' | null。
   * 推给内核 setMapBasesKind——画哪组贴地基地环由宿主显式指定，渲染与回放
   * 同一条管线（playback/bases.js），几何 fail-closed 在内核。
   */
  basesKind: { type: String, default: null },
  /**
   * 出生点列（#835；页面按 mapKey 从语义档案解析后下发）：内核 setMapSpawns
   * 建贴地标记——缺档/非数组不画（fail-closed 在内核与解析器两端）。
   */
  spawnPoints: { type: Array, default: null },
  /** 隐藏时停帧不销毁（页面 v-show 切 2D/3D） */
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

// ---------- 标注（selected-surface drawing；无 surfaceY/surfaceN 时 terrain fallback）----------
// 会话唯一 owner = useSceneAnnotations（与 3D 回放共用）；就绪门 = store.mapReady。
const {
  annotationOpen, annotations, replaceAnnotations, pushAnnotationProjection, pushAnnotationInteraction,
  pushAnnotationVisibility, commitAnnotationFromScene, eraseFromScene, openAnnotation, closeAnnotation,
  resetAnnotationState, toolbarProps: annotationToolbarProps, toolbarHandlers: annotationToolbarHandlers,
} = useSceneAnnotations({ getSceneApi: () => sceneApi.value, interactionReady: () => store.mapReady })

// ---------- 标注导入 / 导出（会话内的文件落盘；fail-closed 校验）----------
// 文件 schema owner = useMapPreviewAnnotationFile（与 2D 预览共用，可互导）。
// surfaceY / surfaceN 是 session-local 3D 锚点，不进入文件 schema：导入导出都剥离。
const { importMessage, exportAnnotations, importAnnotations } = useMapPreviewAnnotationFile({
  mapKey: () => props.mapKey,
  annotations,
  // 内核标注只支持 pen，半校验条目（如 route+null 点）会在渲染或 applyEraser 里 TypeError。
  validate: isImportableAnnotation,
  sanitize: stripSurfaceAnchors,
  suffix: '3d',
  apply: replaceAnnotations,
  t,
})

/** 本面板的标注几何只有 pen（表面锚定画笔，缺锚点时回落地形）：点列 ≥2、坐标有限、宽度为正。 */
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
    get sceneApi() { return sceneApi.value },
  }
}
</script>

<template>
  <div ref="rootEl" class="map3d" data-scene-surface :data-pane-ready="paneReady ? 'true' : undefined" data-testid="map-3d-pane">
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
        <!-- #835：飞行/缩放操作提示（速度档 1–6 此前完全不可发现；桌面手感验收见 PR 清单） -->
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
    <!-- 全屏入口统一右上角浮动（四个场景宿主同一契约；位置在 uiHidden 之外，
         Hide All UI 不得造成无法退出全屏） -->
    <SceneFullscreenButton
      v-if="fullscreenSupported"
      floating
      :is-fullscreen="isFullscreen"
      data-testid="map-3d-fullscreen"
      @toggle="toggleFullscreen()"
    />
    <!-- 移动端竖向距离滑条：仅手机横屏显示（竖屏隐藏，判据与回放同一
         usePlaybackPortraitViewport）；全屏按钮正下方，free/top 可用，follow/recorder
         场景返回 unavailable（这里以 cam 判定隐藏）；Hide All UI 时随控件一起隐藏。 -->
    <SceneDistanceSlider
      :get-scene-api="getSceneApi"
      :visible="isPhone && !isPortrait && !uiHidden && (store.cam === 'free' || store.cam === 'top')"
    />
  </div>
</template>

<style scoped src="./MapPreview3DPane.css"></style>
