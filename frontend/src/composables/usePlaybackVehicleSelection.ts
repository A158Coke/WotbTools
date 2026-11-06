import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { cumulativeStatsAtV2, healthDisplayAt } from '../utils/battlePlaybackV2.js'
import { detailsDamageLogAtV2 } from '../utils/playbackDetails.js'
import { healthRingDiameter } from '../utils/vehicleMarkerSizing.js'
import type { PlaybackCamera } from './usePlaybackCamera.js'

/**
 * 2D 回放车辆选中 / 详情编排（#820 Agent C 拆分）：selected / details 状态的**唯一 owner**。
 *
 * 选中与详情可见性是两个状态（不是「选中了 ⟺ 详情开着」）：
 *   选车 → selectedAccountId = 车，detailsOpen = true
 *   详情 × → 只有 detailsOpen = false；选中、跟随、时间轴、倍速、名册与地图视图都不动
 *   再点同一台 / 另一台车 → 同一个详情窗重新打开（或换内容），永远只有一个窗
 *
 * hit-test / 屏幕定位经由 usePlaybackCamera 的 view/MapRenderRect（与 marker/标注同一变换），
 * 语义投影由宿主注入（projectedSemanticNorm / markerScreen，owner 在车辆投影层）。
 */
export function usePlaybackVehicleSelection(
  camera: Pick<PlaybackCamera, 'view' | 'mapEl' | 'mapRenderRect' | 'mapWidth'>,
  deps: {
    /** 时间相关渲染状态（hit-test 与 selectedState 的来源）。 */
    vehicleStates: Ref<any[]>
    /** canonical tracks（selectedTrack / roster 投影源）。 */
    playback: Ref<any>
    currentTime: Ref<number>
    /** authoritative playback events（详情统计/伤害日志消费源）。 */
    authoritativeEvents: Ref<any[]>
    hpVehicles: Ref<any[]>
    uiHidden: Ref<boolean>
    hpPrefs: { showHp: boolean; mode: string }
    markerPrefs: { classIcons: boolean }
    /** 详情浮窗的定位祖先 / 拖动宿主（.pb-main）。 */
    battlefieldWorkspaceEl: Ref<HTMLElement | null>
    /** 标记中心 → 屏幕坐标（车辆投影层提供，与地图/标注同一变换）。 */
    markerScreen: (st: any) => { x: number; y: number } | null
    /** 语义坐标 → normalized viewport 坐标（含地形起伏回退）。 */
    projectedSemanticNorm: (x: number, y: number) => { xNorm: number; yNorm: number }
    /** mobile overlay reveal（选中后保持 overlay 可见性计时）。 */
    mobileOverlay: Ref<{ reveal?: () => void } | null>
    t: (key: string) => string
  },
) {
  const selectedAccountId = ref<number | null>(null)
  const detailsOpen = ref(false)
  /** 浮窗初始落位偏好：由**这次选择的来源**决定（点左车道 → 落右侧，点右车道 → 落左侧，
   *  点地图上的车 → 与它在 workspace 里相对的一侧）。用户拖过之后不再生效。 */
  const detailsSide = ref('right')

  const { view } = camera

  function openDetails(accountId: number | null, side: string | null = null) {
    selectedAccountId.value = accountId
    if (side) detailsSide.value = side
    detailsOpen.value = true
    // §右侧 only 车辆详情：不再开左侧 vehicle 二级，详情由 detailsOpen + selectedState 驱动。
  }
  /** 屏幕横坐标在战场 workspace 的哪一半 → 浮窗落到另一半。 */
  function sideAwayFromClientX(clientX?: number) {
    const host = deps.battlefieldWorkspaceEl.value
    if (!host || !Number.isFinite(clientX)) return null
    const rect = host.getBoundingClientRect()
    return clientX! > rect.left + rect.width / 2 ? 'left' : 'right'
  }

  const selectedState = computed(() => {
    if (selectedAccountId.value == null) return null
    return deps.vehicleStates.value.find(st => st.vehicle.accountId === selectedAccountId.value) || null
  })
  /** 详情真正呈现的对象：选中了**且**详情开着。关掉详情不清选中。 */
  const detailsState = computed(() => (detailsOpen.value ? selectedState.value : null))

  // Selected vehicle details consume the canonical track directly by accountId.
  const selectedTrack = computed(() => {
    if (!deps.playback.value || !selectedState.value) return null
    const accountId = selectedState.value.vehicle.accountId
    const tracks = deps.playback.value.vehicles || []
    return tracks.find((t: any) => t.accountId === accountId) || null
  })

  // The summary and full inspector consume the same canonical state at replay time.
  const selectedHealth = computed(() => {
    const health = healthDisplayAt(selectedTrack.value, deps.currentTime.value)
    return health ? { currentHp: health.currentHp, maxHp: health.displayCapacityHp, state: health.state } : null
  })

  // Details Panel 车型图：仅在选中车辆后按 tankId 懒加载；图片随站点发布，production 不访问 BlitzKit。
  // token 防止快速切换车辆时旧请求覆盖新选择；非 Tier X / 缺图 / chunk 失败均静默降级为无图。
  const selectedPortraitUrl = ref<string | null>(null)
  let portraitLoadToken = 0
  watch(
    () => selectedState.value?.vehicle?.tankId,
    async (tankId) => {
      const token = ++portraitLoadToken
      selectedPortraitUrl.value = null
      if (tankId == null) return
      try {
        const { loadVehiclePortrait } = await import('../vehicle-portraits/runtime.js')
        const url = await loadVehiclePortrait(tankId)
        if (token === portraitLoadToken) selectedPortraitUrl.value = url
      } catch {
        if (token === portraitLoadToken) selectedPortraitUrl.value = null
      }
    },
  )

  /** 详情 ×：只关详情。选中（名册高亮 / 地图标记选中态）、跟随、时间轴、倍速、名册与视图都保留。 */
  function closeSidebar() {
    detailsOpen.value = false
  }

  const selLastKnownSec = computed(() => {
    const st = selectedState.value
    return st && st.lastKnown && Number.isFinite(st.pos.timeSec) ? st.pos.timeSec : null
  })
  // §16/§17：当前统计 = 权威 HP loss 重建（dealt 仅计可 attribution 的掉血——
  // incomplete observation 不冒充完整统计，文案用「已记录伤害」；received 含全部掉血）
  const selCurStats = computed(() => {
    const st = selectedState.value
    if (!st) return { dealt: 0, received: 0, kills: 0 }
    return cumulativeStatsAtV2(deps.authoritativeEvents.value, st.vehicle, deps.currentTime.value, deps.hpVehicles.value)
  })
  /** 最近伤害记录：incoming 使用 canonical HP decrease，outgoing 使用 observedHpLoss；attacker 不可证明时
   *  显示「来源未知」；raw Type-8 协议值不参与。Blocker 2：只消费 toSec <= currentTime 的记录
   *  （forward/backward seek 与任意 timestamp 重建天然正确，未来事件绝不泄漏）；取最近 8 条。 */
  const selDamageLog = computed(() => {
    const st = selectedState.value
    if (!st) return []
    return detailsDamageLogAtV2(deps.playback.value, st.vehicle, deps.currentTime.value, deps.t('recon.map.playback.source_unknown'))
  })

  function onMarkerSelect(vehicle: any, event?: { target?: EventTarget | null; clientX?: number; clientY?: number }) {
    // §36：label 块（含 PlayerName tooltip 悬停区）不是 hitbox——点标签不选中车辆；
    // .pb-label-player 为触发原生 title 需要 pointer-events:auto，点击事件会冒泡到这里，须拦截。
    const target = event && event.target
    if (target && typeof (target as HTMLElement).closest === 'function' && (target as HTMLElement).closest('.pb-labels')) return
    selectAt(vehicle.accountId, event ? event.clientX : undefined, event ? event.clientY : undefined)
  }

  function selectAt(accountId: number | null, clientX?: number, clientY?: number) {
    const states = deps.vehicleStates.value
    const hasPoint = Number.isFinite(clientX) && camera.mapEl.value && camera.mapWidth() > 0
    const rect = camera.mapEl.value ? camera.mapEl.value.getBoundingClientRect() : { left: 0, top: 0 }
    const px = hasPoint ? clientX! - rect.left : NaN
    const py = hasPoint ? clientY! - rect.top : NaN
    // Hit-test uses the final vehicle-aware hit target at the marker's true position
    // (markers are never displaced). Selection still returns the canonical vehicle.
    const hitTest = (s: any) => {
      const cx = (px - view.tx) / view.scale
      const cy = (py - view.ty) / view.scale
      const mapRect = camera.mapRenderRect()
      const projected = deps.projectedSemanticNorm(s.pos.x, s.pos.y)
      const x = projected.xNorm * mapRect.width
      const y = projected.yNorm * mapRect.height
      const hitTarget = s.hitTargetSize || s.markerSize?.hitTarget
      const ringSize = !deps.uiHidden.value && deps.hpPrefs.showHp && deps.hpPrefs.mode === 'ring' && !s.destroyed
        ? healthRingDiameter(s, deps.markerPrefs.classIcons) / view.scale : 0
      const hw = Math.max(hitTarget?.width || 20, ringSize) / 2
      const hh = Math.max(hitTarget?.height || 20, ringSize) / 2
      return Math.abs(cx - x) <= hw && Math.abs(cy - y) <= hh
    }
    let candidates
    if (hasPoint) {
      candidates = states.filter(hitTest)
      // 真实点击必然落在某 hitbox 内（label 点击已在 onMarkerSelect 拦截）；
      // 此处兜底只为合成事件/坐标与布局瞬时不一致（既有 toggle 行为）
      if (candidates.length === 0) {
        const target = states.find((s: any) => s.vehicle.accountId === accountId)
        candidates = target ? [target] : []
      }
    } else {
      const target = states.find((s: any) => s.vehicle.accountId === accountId)
      candidates = target ? [target] : []
    }
    if (candidates.length === 0) return
    let best = candidates[0]
    if (candidates.length > 1) {
      const dist = (s: any) => {
        const p = deps.markerScreen(s)
        return p ? Math.hypot(p.x - px, p.y - py) : Infinity
      }
      candidates.sort((a: any, b: any) => (dist(a) - dist(b)) || (states.indexOf(a) - states.indexOf(b)))
      best = candidates[0]
      // tie（与前二近者距离几乎一致）且已有 selected 在候选内 → 保持当前 selected，不切换
      if (selectedAccountId.value != null && candidates.length > 1
          && Math.abs(dist(best) - dist(candidates[1])) < 1) {
        const sel = candidates.find((s: any) => s.vehicle.accountId === selectedAccountId.value)
        if (sel) { openDetails(selectedAccountId.value, sideAwayFromClientX(clientX)); return }
      }
    }
    // PR5 §8.1：点击 marker 恒选中/直接切换（不 toggle-off）；点击空白不关闭；必须 × 显式关闭
    // §details-float：浮窗落在**不遮住**这台车的一侧（按它在战场 workspace 里的屏幕位置）。
    openDetails(best.vehicle.accountId, sideAwayFromClientX(clientX))
    deps.mobileOverlay.value?.reveal?.()
  }

  function selectFromRoster(accountId: number, event?: { target?: EventTarget | null }) {
    // §details-float：左边的己方名册 → 浮窗落右侧，右边的敌方名册 → 浮窗落左侧，
    // 都不会盖住刚点的那一行（竖屏纵向流里详情是流内内容块，落位偏好不起作用）。
    const row = (event?.target as HTMLElement | null)?.closest?.('[data-test="pb-roster-row"]')
    let side: string | null = null
    if (row?.closest?.('.pb-team-lane-left')) side = 'right'
    else if (row?.closest?.('.pb-team-lane-right')) side = 'left'
    else if (row) side = sideAwayFromClientX(row.getBoundingClientRect().left)
    openDetails(accountId, side)
  }

  return {
    selectedAccountId,
    detailsOpen,
    detailsSide,
    selectedState,
    detailsState,
    selectedTrack,
    selectedHealth,
    selectedPortraitUrl,
    selLastKnownSec,
    selCurStats,
    selDamageLog,
    openDetails,
    closeSidebar,
    sideAwayFromClientX,
    onMarkerSelect,
    selectAt,
    selectFromRoster,
  }
}

export type PlaybackVehicleSelection = ReturnType<typeof usePlaybackVehicleSelection>
