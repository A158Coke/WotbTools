import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { computeVehicleMarkerSize } from '../utils/vehicleMarkerSizing.js'
import { projectVehicleState } from '../utils/playbackVehicleState.js'
import { recentPositionTrails, recentPositionTrailsFromPose, tracerLines } from '../utils/battlePlayback.js'
import { healthDisplayAt } from '../utils/battlePlaybackV2.js'
import enemyHull from '../assets/tank-icons/tank-marker-enemy-hull.png'
import enemyTurret from '../assets/tank-icons/tank-marker-enemy-turret.png'
import friendlyHull from '../assets/tank-icons/tank-marker-friendly-hull.png'
import friendlyTurret from '../assets/tank-icons/tank-marker-friendly-turret.png'
import { positionCoveredAtV2 } from '../utils/battlePlaybackV2.js'
import type { PlaybackReplayData } from './usePlaybackReplayData.js'

/**
 * 2D 回放车辆呈现投影（#820 Agent C 拆分）：dedicated model preload、车辆渲染状态
 * （baseVehicleStates/vehicleStates）、车队着色、轨迹/炮线与 marker 屏幕定位的唯一 owner。
 *
 * 时间只读：currentTime 由播放时钟 owner（usePlaybackClock）提供；位置/位姿事实源来自
 * usePlaybackReplayData（canonical 观测 + 位姿通道）。屏幕定位经由 MapRenderRect + view
 * 变换（与标注/选中同一相机），标记不做防重叠位移（车体严格落在真实位置）。
 */
export function usePlaybackVehicleProjection(
  mapView: Ref<any>,
  camera: {
    view: { scale: number; tx: number; ty: number }
    mapWidth: () => number
    mapHeight: () => number
    mapRenderRect: () => { left: number; top: number; width: number; height: number }
    markerTransform: ComputedRef<string>
    overlayInverse: ComputedRef<number>
    overlayInverseScale: ComputedRef<string>
  },
  replayData: Pick<PlaybackReplayData, 'poseAtTime' | 'poseSource' | 'vehicleReloadAt' | 'vehicleConsumablesAt' | 'routesByAccount' | 'vehiclesByAccount' | 'projectedSemanticNorm'>,
  deps: {
    playbackV2: () => any
    recorderAccountId: () => unknown
    currentTime: Ref<number>
    speed: Ref<number>
    authoritativeEvents: () => any[]
    hpVehicles: () => any[]
    gunMarks: () => Map<number, any> | null
    isMobileDevice: Ref<boolean>
    trailPrefs: { showTrail: boolean }
    palette: Ref<{ friendlyColors: string[]; enemyColors: string[]; routeOutline: string }>
    t: (key: string, ...args: any[]) => string
  },
) {
  // ---- PR2：Tier X dedicated model preload----
  // runtime.js 含全部车型资产引用（import.meta.glob），必须动态 import 保持主 bundle 分离
  // （scripts/check-bundle-separation.mjs 门禁：主入口不得含 'vehicle-models/assets'）。
  // preload 完成前不渲染车辆（asset decision 先于渲染，禁止 generic 闪现后替换）。
  const preload = ref({ phase: 'idle', resolved: new Map(), failed: new Set(), failureReasons: new Map(), byTank: new Map() })
  // 竞态令牌：快速切换战局时，过期 preload 完成不得覆盖新战局结果
  let preloadToken = 0
  watch(
    () => [deps.playbackV2()],
    async () => {
      const token = ++preloadToken
      preload.value = { phase: 'loading', resolved: new Map(), failed: new Set(), failureReasons: new Map(), byTank: new Map() }
      const vehicles = deps.playbackV2()?.vehicles || []
      if (vehicles.length === 0) {
        preload.value = { phase: 'ready', resolved: new Map(), failed: new Set(), failureReasons: new Map(), byTank: new Map() }
        return
      }
      try {
        const { preloadBattleModels } = await import('../vehicle-models/runtime.js')
        const result = await preloadBattleModels(vehicles.map((v: any) => v.tankId))
        if (token !== preloadToken) return // 过期结果丢弃
        preload.value = { phase: 'ready', ...result }
      } catch {
        // 模块加载异常 → 保持单场 generic fallback，但保留稳定诊断原因。
        console.error('[vehicle-models] fallback reason=MODULE_IMPORT_FAILURE')
        if (token !== preloadToken) return
        const failureReasons = new Map((vehicles || []).map((v: any) => [String(v.tankId), 'MODULE_IMPORT_FAILURE']))
        preload.value = { phase: 'ready', resolved: new Map(), failed: new Set(), failureReasons, byTank: new Map() }
      }
    },
    { immediate: true },
  )

  /** PR2：该车辆的 dedicated model 决策（preload 结果）——
   * 非 Tier X / preload 失败 / 模块加载失败 → null（generic marker 单车 fallback）。 */
  function vehicleModel(vehicle: any) {
    const p = preload.value
    if (p.phase !== 'ready') return null
    const modelKey = p.byTank.get(String(vehicle.tankId))
    if (!modelKey || p.failed.has(modelKey)) return null
    return p.resolved.get(modelKey) || null
  }

  /** 标记水平位置（%）：地图用户坐标 → 容器百分比。 */
  function markerLeft(x: number) {
    return `${((mapView.value.toX(x)) / mapView.value.W) * 100}%`
  }

  /** 标记垂直位置（%）。 */
  function markerTop(y: number) {
    return `${((mapView.value.toY(y)) / mapView.value.H) * 100}%`
  }

  const friendlyColors = computed(() => deps.palette.value.friendlyColors)
  const enemyColors = computed(() => deps.palette.value.enemyColors)

  // 车辆在队伍内的着色序号缓存：从**完整花名册**（hpVehicles，时间无关且对象稳定）派生
  // 队伍内序号——vehicleStates 是时间相关的渲染子集（车辆首观测前缺席），从中缓存会把
  // 部分序号永久固化（Codex review 2026-10-31：seek 历史不同 → 颜色不同，且多车共享
  // 同色）。颜色列表仍逐调用读取（调色板可变）。
  const vehicleColorIndexCache = new WeakMap()

  function vehicleColor(vehicle: any) {
    let index = vehicleColorIndexCache.get(vehicle)
    if (index === undefined) {
      const teamVehicles = deps.hpVehicles().filter((v: any) => v.team === vehicle.team)
      if (teamVehicles.length > 0) {
        index = Math.max(0, teamVehicles.indexOf(vehicle))
        vehicleColorIndexCache.set(vehicle, index)
      } else {
        index = 0 // 花名册尚未构建：退回首色且不缓存，避免毒化序号
      }
    }
    const list = vehicle.friendly === true ? friendlyColors.value : enemyColors.value
    return list[index % list.length]
  }

  const baseVehicleStates = computed(() => {
    // preload 未完成（asset decision 未定）时不渲染车辆——禁止 generic 闪现后替换
    if (preload.value.phase !== 'ready') return []
    // V2-only：V2 track 为唯一事实源；无 V2 车辆 → 空（不再有 legacy overview.playback 兜底）。
    const tracks = deps.playbackV2()?.vehicles || []
    if (tracks.length === 0) return []
    return tracks
      .map((track: any) => {
        const vehicle = track
        const model = vehicleModel(track)
        const mobile = deps.isMobileDevice.value
        // computeVehicleMarkerSize 为 JS 工具，options 按运行时形状消费。
        const markerSize = (computeVehicleMarkerSize as any)(vehicle, {
          model,
          mapView: mapView.value,
          mapWidthPx: camera.mapWidth(),
          mapHeightPx: camera.mapHeight(),
          mobile,
        })
        // projectVehicleState 为 JS 工具（PNG 资产/翻译注入按运行时形状消费）。
        const state = (projectVehicleState as any)({
          vehicle,
          track,
          time: deps.currentTime.value,
          // 位姿通道（与 3D 同源同插值）；缺失时 projectVehicleState 回退 canonical 观测
          pose: replayData.poseAtTime(track, deps.currentTime.value),
          recorderAccountId: deps.recorderAccountId(),
          model,
          markerSize,
          // Unknown perspective keeps neutral CSS state; enemy assets are only a
          // visual fallback because the asset pack has no neutral hull/turret.
          hullImage: track.friendly === true ? friendlyHull : enemyHull,
          turretImage: track.friendly === true ? friendlyTurret : enemyTurret,
          markerLeft: markerLeft,
          markerTop: markerTop,
          markerTransform: camera.markerTransform.value,
          overlayInverseScale: camera.overlayInverseScale.value,
          overlayInverse: camera.overlayInverse.value,
          translate: deps.t,
        })
        if (!state) return null
        // 2D 是严格俯视投影（2026-10-16）：不再呈现"多出的维度"（俯仰/侧倾），
        // 故不产出 terrainAttitude（原地形高度场合成倾斜已删）。
        return { ...state, gunMarks: deps.gunMarks()?.get(track.accountId) ?? null, reloadShells: replayData.vehicleReloadAt(track.accountId, deps.currentTime.value), consumables: replayData.vehicleConsumablesAt(track, deps.currentTime.value) }
      })
      .filter(Boolean)
  })

  // 标记**不做**防重叠位移（2026-10-16 用户裁定）：车体严格落在真实位置，密集处允许图标互相压盖；
  // 早前的"整盒推开 + 虚线指回真实位置"在 2D 里读起来就是"坦克模型与真实位置有偏移"，且 3D 从不
  // 移动车体模型 ⇒ 两侧不一致。名牌 / HP 的防重叠仍由 labelLayout 的车道机制承担（与 3D 同构）。
  const vehicleStates = computed(() => baseVehicleStates.value.map((state: any) => {
    const scale = camera.view.scale || 1
    return {
      ...state,
      markerStyle: {
        ...state.markerStyle,
        width: `${state.markerSize.renderBox.width}px`,
        height: `${state.markerSize.renderBox.height}px`,
        // The camera content is layout-scaled rather than transform-scaled. Keep the marker's
        // existing scale so vehicle artwork and screen-space inverse overlays retain their contract.
        transform: `translate(-50%, -50%) scale(${scale})`,
        left: markerLeft(state.pos.x),
        top: markerTop(state.pos.y),
      },
    }
  }))

  // 炮线：仅来自真实事件流中的已知射击（DAMAGE/KILL），两端可信位置，随播放时间与倍速确定性呈现
  const visibleTracers = computed(() => tracerLines(
    deps.authoritativeEvents(),
    replayData.routesByAccount.value,
    deps.currentTime.value,
    deps.speed.value,
    replayData.poseSource.value ? (route: any, t: number) => replayData.poseAtTime(route, t) : null,
  ))

  function tracerColor(accountId: number) {
    const vehicle = replayData.vehiclesByAccount.value.get(accountId)
    return vehicle ? vehicleColor(vehicle) : deps.palette.value.routeOutline
  }

  // 最近 2 秒位置轨迹只消费 canonical observed positionSegments；显示偏好由 usePlaybackPreferences 持久化。
  const visibleTrails = computed(() => deps.trailPrefs.showTrail
    ? (replayData.poseSource.value
        // 位姿通道：与 3D 同源的位置序列；可信度门控仍取 canonical 观测区间
        ? recentPositionTrailsFromPose(
            deps.hpVehicles(),
            (vehicle: any, t: number) => replayData.poseAtTime(vehicle, t),
            (vehicle: any, t: number) => positionCoveredAtV2(vehicle.positionSegments, t),
            deps.currentTime.value, 2)
        : recentPositionTrails(deps.hpVehicles(), deps.currentTime.value, 2))
    : [])

  // projectedSemanticNorm 由 replayData 提供（地形起伏 + 线性回退同一 owner）。
  const { projectedSemanticNorm: replayDataProjected } = replayData

  /** 标记中心 → 相对地图容器的屏幕 px（viewport 变换后）。 */
  function canonicalMarkerScreen(st: any) {
    const rect = camera.mapRenderRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return null
    const point = replayDataProjected(st.pos.x, st.pos.y)
    return {
      x: point.xNorm * rect.width * camera.view.scale + camera.view.tx,
      y: point.yNorm * rect.height * camera.view.scale + camera.view.ty,
    }
  }

  function markerScreen(st: any) {
    // 标记严格落在真实位置（无防重叠位移），屏幕位置 = 语义位置。
    return canonicalMarkerScreen(st)
  }

  // ---- 单车 HP HUD 数据（§4/§5/§6/§7）----
  function hpFor(vehicle: any) {
    const display = healthDisplayAt(vehicle, deps.currentTime.value)
    if (!display) return null
    return {
      current: display.currentHp,
      maxHp: display.displayCapacityHp,
      pct: display.pct,
      knowledge: display.knowledge,
      destroyed: display.destroyed,
      state: display.state,
    }
  }
  /** marker HP HUD 数字区实际渲染文本（VehicleMarker .pb-hp-num 同款：current 有值→数字，否则 —）。
   *  labelLayout 碰撞用：数字文本可能影响 HUD 盒宽（不同状态不同文本），必须按实际文本估算。 */
  function hpDisplayNumText(hp: { current: number | null }) {
    return hp.current != null ? String(hp.current) : '—'
  }

  return {
    preload,
    vehicleModel,
    markerLeft,
    markerTop,
    friendlyColors,
    enemyColors,
    vehicleColor,
    baseVehicleStates,
    vehicleStates,
    visibleTracers,
    tracerColor,
    visibleTrails,
    canonicalMarkerScreen,
    markerScreen,
    hpFor,
    hpDisplayNumText,
  }
}

export type PlaybackVehicleProjection = ReturnType<typeof usePlaybackVehicleProjection>
