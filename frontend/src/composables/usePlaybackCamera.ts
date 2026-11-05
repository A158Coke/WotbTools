import { computed, reactive, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { clampViewPan } from '../utils/battlePlayback.js'

/** 本 composable 消费的 map 视图最小结构（createMapView 的返回值，无 TS 源）。 */
export interface PlaybackMapViewLike {
  W: number
  H: number
}

/** 相机操作的宿主形态（camera state 的唯一写入方仍是本 composable）。 */
export interface PlaybackCameraHost {
  /** 地图组件实例（提供 mapEl / textInputRef 等模板桥）。 */
  mapComponent: Ref<any>
  /** 正方形 Stage 元素（fit/reset 的垂直安全区依据）。 */
  mapStageEl: Ref<HTMLElement | null>
  /** 布局模式参与 fit signature：mode 变化时重新应用默认 contain。 */
  isFullscreen: () => boolean
  wideLayout: () => boolean
  isMobileDevice: () => boolean
}

/**
 * 2D 回放视口相机（#820 Agent C 拆分）：zoom/pan/fit 的**唯一 owner**。
 *
 * - `view`（scale/tx/ty）是唯一 camera layer，地图/网格/炮线/标记/标注共享同一变换；
 * - MapRenderRect（§1 SSoT）是地图实际绘制矩形（相对 `.pb-map` origin）的唯一来源，
 *   所有 presentation geometry（marker/碰撞/hitbox/label/float/semantic 换算）都经由它；
 * - 用户相机（user-modified）只被真实手势改写，Reset View / 几何 signature 变化才恢复默认 fit。
 *
 * 不持有 pointer/gesture 状态（那是 usePlaybackMapGestures 的输入），也不做播放时间推进。
 */
export function usePlaybackCamera(
  mapView: Ref<PlaybackMapViewLike>,
  host: PlaybackCameraHost,
) {
  const mapComponent = host.mapComponent
  const mapStageEl = host.mapStageEl
  const mapEl = computed(() => mapComponent.value?.mapEl || null)

  // ---- 地图容器真实渲染尺寸（reactive）：fullscreen enter/exit / 窗口缩放等任何尺寸变化
  // 由 ResizeObserver 更新 → 依赖容器尺寸的 screen-space 布局（markerScreen/labelLayout/
  // hitbox/textInput）在新尺寸下重新计算；无 RO 环境（测试/旧浏览器）回退 clientWidth 读取。
  const mapSize = ref({ w: 0, h: 0 })
  let mapResizeObserver: ResizeObserver | null = null
  function mapWidth() {
    return mapSize.value.w || (mapEl.value ? mapEl.value.clientWidth : 0)
  }
  function mapHeight() {
    return mapSize.value.h || (mapEl.value ? mapEl.value.clientHeight : 0)
  }

  // §1：MapRenderRect SSoT —— 当前地图实际绘制的矩形（相对 .pb-map origin）。
  // 所有 presentation geometry（marker/碰撞/hitbox/label/float/screenToSemantic）都经由它换算，
  // 保证 SVG map 与 HTML overlay 共享同一坐标系（fullscreen/contain 下 marker 不再跑进 gutter）。
  // 用读取即时值而非缓存 computed：依赖（mapSize/mapView）由调用方 computed/watch 追踪，实时重算。
  function mapRenderRect() {
    const width = mapWidth()
    const ratio = mapView.value.H / mapView.value.W
    return { left: 0, top: 0, width, height: width * ratio }
  }

  const view = reactive({ scale: 1, tx: 0, ty: 0 })
  // Default contain follows geometry; a user camera stays owned by their gestures until Reset View.
  let cameraUserModified = false

  // HUD and Transport live outside Stage; the raster uses the whole square viewport.
  function applyView(next: { scale: number; tx: number; ty: number }, userGesture = false) {
    // stage = 可见 map-stage；map = rendered map rect。pan bounds / reset fit 都以二者为据。
    // HUD 与传输控件在 Stage 外，地图可使用整个正方形。
    const stageW = mapWidth()
    const fullH = mapStageEl.value ? mapStageEl.value.clientHeight : mapHeight()
    const safeH = Math.max(0, fullH)
    const rect = mapRenderRect()
    // §对称：地图在安全区内垂直居中，顶部/底部黑边完全对称（无向下偏移）。
    const clamped = clampViewPan(next, stageW, safeH, rect.width, rect.height)
    if (userGesture && (clamped.scale !== view.scale || clamped.tx !== view.tx || clamped.ty !== view.ty)) {
      cameraUserModified = true
    }
    view.scale = clamped.scale
    view.tx = clamped.tx
    view.ty = clamped.ty
  }

  // Raster camera fallback: enlarge the layout box before the browser paints the HD image,
  // then translate that box for pan. Keeping view.scale as the SSOT preserves all anchor math
  // while avoiding a compositor-only scale of an already-painted raster layer.
  const viewportStyle = computed(() => [
    `transform: translate(${view.tx}px, ${view.ty}px)`,
    `width: ${view.scale * 100}%`,
  ])

  // 车辆标记随地图缩放（用户确认「坦克随地图一起放大，相对地图比例不变」）：
  // 标记中心锚定在地图坐标（left/top % 经 viewport 变换），本体不再反缩放；
  // 坦克名/阵亡 ✕ 等 UI 叠加层单独反缩放（overlayInverseScale）保持屏幕恒定；
  // hull/turret 的方向旋转在子元素 img 上，不受缩放影响。
  const markerTransform = computed(() => `translate(-50%, -50%)`)
  // overlay 反缩放数值（=1/view.scale）：元素尺寸（transform scale）与 layout offset（bottom/top calc）
  // 都按它反缩放 → zoom 下 selected/recorder 与车辆的屏幕间距恒定，不随 1×/2×/4× 增长
  const overlayInverse = computed(() => 1 / view.scale)
  const overlayInverseScale = computed(() => `scale(${overlayInverse.value})`)

  /** 指针 client 坐标 → 相对地图容器的**屏幕坐标**（zoomViewAt 契约，不参与任何变换）。 */
  function screenPoint(clientX: number, clientY: number) {
    const rect = mapEl.value ? mapEl.value.getBoundingClientRect() : { left: 0, top: 0 }
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  /** 完整地图视图（contain/fit）的 scale：把整张 rendered map 放进安全区的最小缩放。
   *  缩放下限（minScale）应为它——zoomed 后回到的就是它，避免「放大后再缩不回原样」。 */
  // fit 后四周留一圈窄黑边：不顶到边缘，同时尽量少浪费宽屏空间。
  const FIT_MARGIN = 0.98

  function fitScale() {
    const stageW = mapWidth()
    const fullH = mapStageEl.value ? mapStageEl.value.clientHeight : mapHeight()
    const safeH = Math.max(0, fullH)
    const rect = mapRenderRect()
    if (stageW > 0 && safeH > 0 && rect.width > 0 && rect.height > 0) {
      return Math.min(stageW / rect.width, safeH / rect.height) * FIT_MARGIN
    }
    return 1
  }

  function resetView() {
    cameraUserModified = false
    // Reset View：恢复整张地图在正方形 Stage 内 contain 居中。
    const stageW = mapWidth()
    const fullH = mapStageEl.value ? mapStageEl.value.clientHeight : mapHeight()
    const safeH = Math.max(0, fullH)
    const rect = mapRenderRect()
    if (stageW > 0 && safeH > 0 && rect.width > 0 && rect.height > 0) {
      const scale = fitScale()
      const tx = (stageW - rect.width * scale) / 2
      const ty = (safeH - rect.height * scale) / 2
      applyView({ scale, tx, ty })
      return
    }
    applyView({ scale: 1, tx: 0, ty: 0 })
  }

  // §3：默认视图 = 完整地图 contain（fit 居中、完整可见，无需手动调整）。
  // HUD/Transport 在正方形 Stage 外，地图在整个 Stage 中 contain 居中。
  // §geometry-signature：以 mode + stage/map/safe 尺寸为 signature，变化即重新 fit，
  // 不锁住旧几何：mode 或 Stage 尺寸改变时更新默认 contain。
  let lastFitSignature = ''
  function fitViewIfReady(force = false) {
    if (force) lastFitSignature = ''
    const stageW = mapWidth()
    const fullH = mapStageEl.value ? mapStageEl.value.clientHeight : mapHeight()
    const safeH = Math.max(0, fullH)
    const rect = mapRenderRect()
    if (stageW <= 0 || safeH <= 0 || rect.width <= 0 || rect.height <= 0) return
    const signature = [host.isFullscreen(), host.wideLayout(), host.isMobileDevice(), stageW, safeH, rect.width, rect.height].join('|')
    if (!force && signature === lastFitSignature) return
    lastFitSignature = signature
    if (!cameraUserModified) resetView()
  }

  // 地图容器尺寸观察：fullscreen enter/exit / 窗口缩放 → ResizeObserver 更新 mapSize
  //（reactive）→ markerScreen/labelLayout/selectAt/textInput 以新尺寸重算；不依赖 magic delay。
  watch(() => mapEl.value, (el) => {
    if (!el || mapResizeObserver) return
    if (typeof ResizeObserver === 'function') {
      mapResizeObserver = new ResizeObserver((entries) => {
        for (const e of entries || []) {
          if (e && e.target === el) {
            mapSize.value = { w: e.contentRect.width, h: e.contentRect.height }
          }
        }
        // §fullscreen-exit：地图或 stage 尺寸就绪（布局稳定）后，以新 mode 的几何重新应用默认 fit
        //（contain 居中）。mode change 会 re-arm fitInitialized；非 mode 的 resize 保持已生效的 view。
        fitViewIfReady()
      })
      mapResizeObserver.observe(el)
      if (mapStageEl.value) mapResizeObserver.observe(mapStageEl.value)
    }
  })

  function disposeCamera() {
    if (mapResizeObserver) {
      mapResizeObserver.disconnect()
      mapResizeObserver = null
    }
  }

  return {
    mapEl,
    mapSize,
    mapWidth,
    mapHeight,
    mapRenderRect,
    view,
    applyView,
    viewportStyle,
    markerTransform,
    overlayInverse,
    overlayInverseScale,
    screenPoint,
    fitScale,
    resetView,
    fitViewIfReady,
    disposeCamera,
  }
}

export type PlaybackCamera = ReturnType<typeof usePlaybackCamera>
