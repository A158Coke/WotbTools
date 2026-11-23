import type { computed, nextTick, watch, Ref } from 'vue'
import type { PlaybackModelProps } from './useBattlePlaybackModel'
import type { useBattlePlaybackMapModel } from './useBattlePlaybackMapModel'
import type { usePlaybackVehicleProjection } from '../composables/usePlaybackVehicleProjection'
import type { usePlaybackReplayData } from '../composables/usePlaybackReplayData'
import type { usePlaybackPreferences } from '../composables/usePlaybackPreferences'
import type { VehiclePlaybackTrack } from '../types/playback-v2'
import { mapBases } from '../data/mapBases.js'
import { teamCssVars } from '../data/mapTeamColors.js'
import { rosterLanesFor } from '../scene/rosterState.js'
import { healthDisplayAt } from '../utils/battlePlaybackV2.js'
import { healthRingDiameter } from '../utils/vehicleMarkerSizing.js'
import { baseView } from '../utils/baseStatus.js'
import { MARKER_CORE_PX, computeLabelLayout } from '../utils/labelLayout.js'

type MapModel = ReturnType<typeof useBattlePlaybackMapModel>
type Projection = ReturnType<typeof usePlaybackVehicleProjection>
type Preferences = ReturnType<typeof usePlaybackPreferences>
export type SceneSemantics = { verified?: boolean; mapCodes?: string[]; sceneEvidence?: { battlePoints?: Array<{ type: string; confidence: string; position: number[] }> } }
type RosterDeps = {
  computed: typeof computed; watch: typeof watch; nextTick: typeof nextTick
  props: PlaybackModelProps
  currentTime: Ref<number>; playback: MapModel['playback']; pbOverview: MapModel['pbOverview']
  baseStatesAt: MapModel['baseStatesAt']; friendlyTeam: MapModel['friendlyTeam']
  mapSemantics: SceneSemantics[]; showRosterPresentation: Ref<boolean>; isPhonePortrait: Ref<boolean>
  rosterLanesOpen: Ref<boolean>; uiHidden: Ref<boolean>; uiPrefs: Preferences['uiPrefs']
  pbRoot: Ref<HTMLElement | null>; stageResizeObserver: () => ResizeObserver | null
  writeSquareAvailHeight: () => void; vehicleReloadAt: ReturnType<typeof usePlaybackReplayData>['vehicleReloadAt']
  vehicleStates: Projection['vehicleStates']; mapWidth: () => number
  mapView: MapModel['mapView']; hpPrefs: Preferences['hpPrefs']; markerPrefs: Preferences['markerPrefs']
  mapEl: Ref<HTMLElement | null>; markerScreen: Projection['markerScreen']; hpFor: Projection['hpFor']
  hpDisplayNumText: Projection['hpDisplayNumText']; selectedAccountId: Ref<number | null>
  labelPrefs: Preferences['labelPrefs']; palette: MapModel['palette']
}

export function useBattlePlaybackRoster(deps: RosterDeps) {
  const {
    computed, watch, nextTick, props, currentTime, playback, pbOverview, baseStatesAt, friendlyTeam,
    mapSemantics, showRosterPresentation, isPhonePortrait, rosterLanesOpen, uiHidden,
    uiPrefs, pbRoot, stageResizeObserver, writeSquareAvailHeight, vehicleReloadAt,
    vehicleStates, mapWidth, mapView, hpPrefs, markerPrefs, mapEl, markerScreen, hpFor,
    hpDisplayNumText, selectedAccountId, labelPrefs, palette,
  } = deps
// §队伍阵容：从 result 全量名单（playbackV2.vehicles）取，不依赖回放事件流/vehicleStates。
// 按权威 vehicle.team 保留物理身份；rosterTeams 按 Recorder 视角决定左右。
const teamVehicles = computed(() => {
  const vehicles = props.playbackV2?.vehicles || []
  const team1: VehiclePlaybackTrack[] = []
  const team2: VehiclePlaybackTrack[] = []
  const unknown: VehiclePlaybackTrack[] = []
  for (const v of vehicles) {
    if (v.team === 1) team1.push(v)
    else if (v.team === 2) team2.push(v)
    else unknown.push(v)
  }
  return { team1, team2, unknown }
})

const rosterTeams = computed(() => rosterLanesFor(teamVehicles.value, friendlyTeam.value))

/**
 * Both physical team rosters use current destruction state from the same authoritative projection.
 */
const destroyedNow = computed(() => new Set(
  (props.playbackV2?.vehicles || []).filter(vehicle => healthDisplayAt(vehicle, currentTime.value)?.destroyed === true).map(vehicle => vehicle.accountId)))

/**
 * 正方形 Stage 的呈现决策（见 styles/playback-workspace.css 的权威契约）：
 *
 *   名册浮层 ＝ showRoster 开 且 不是手机竖屏 且 会话级浮层开关展开。
 *     浮层锚在 `.pb-map-stage` 内侧左右边缘，不再占据固定 Grid 列——地图列始终是全宽。
 *   手机竖屏 ＝ 纵向流：名册排在传输控件之下的 `.pb-inline-area`，跟着页面滚。
 *
 * 名册**只是呈现**：关掉不重置名册数据、选中车辆、跟随目标、时间轴与相机。
 */
const rosterLanes = computed(() => showRosterPresentation.value && !isPhonePortrait.value && rosterLanesOpen.value)
/** 名册浮层入口（传输条上的 roster 按钮）：竖屏纵向流里的名册始终可见，不需要这个入口。 */
const rosterEntryVisible = computed(() => showRosterPresentation.value && !isPhonePortrait.value)
/**
 * §2d-shellnav 窄容器时钟让位的前提：HUD 里真的有同一时钟（showSummary = showTopbar）。
 * showTopbar 关闭（或 HUD 隐藏）时窄容器 CSS 必须保留传输条时钟，否则播放期间没有任何可见时间
 * （F6）：root class 驱动 playback-workspace.css 的窄容器分支。
 */
const hudClockVisible = computed(() => !uiHidden.value && uiPrefs.showTopbar === true)
/** 竖屏的纵向流里，名册排在传输控件之后的 `.pb-inline-area`；详情则是流内内容块。
    竖屏以外，详情是 workspace 顶层的可拖动浮窗。 */
const inlineStack = computed(() => isPhonePortrait.value)
const detailsFloating = computed(() => !isPhonePortrait.value)
/**
 * 选中与详情可见性是**两个状态**（不是「选中了 ⟺ 详情开着」）：
 *   选车 → selectedAccountId = 车，detailsOpen = true
 *   详情 × → 只有 detailsOpen = false；选中、跟随、时间轴、倍速、名册与地图视图都不动
 *   再点同一台 / 另一台车 → 同一个详情窗重新打开（或换内容），永远只有一个窗
 */
/**
 * 名册每行显示的当前 HP（与地图标记同一个权威投影：healthDisplayAt）。
 *
 * 传的是**完整投影**而不只是 current/max：名册的 HP 呈现模型要区分 exact / relative /
 * unknown / destroyed（见 scene/rosterState.ts 的 hpPresentationFor）。`pct` 只在
 * `displayCapacityHp` 可信时才有值，`relativeFull` 是 backend 标注的「相对满状态」事实——
 * 两者都不可用时呈现层落到 unknown（`—`），绝不伪造 current/max。
 *
 * `pct` 直接取投影的原始比例，不预先取整：取整是呈现层的事（避免累积误差）。
 */
const rosterHealth = computed(() => {
  const out: Record<number, { currentHp: number | null; maxHp: number | null; pct: number | null; relativeFull: boolean; state: string }> = {}
  for (const vehicle of props.playbackV2?.vehicles || []) {
    const display = healthDisplayAt(vehicle, currentTime.value)
    if (!display) continue
    out[vehicle.accountId] = {
      currentHp: display.currentHp,
      maxHp: display.displayCapacityHp,
      pct: display.pct,
      relativeFull: display.relativeFull === true,
      state: display.state,
    }
  }
  return out
})
/**
 * 名册每行的 reload（次级瞬时状态），按 accountId。
 *
 * 与地图名牌**同一个 resolver 调用**（`vehicleReloadAt` → 共享 `reloadStateAt`），
 * 所以「弹夹有几发、哪一发在装填、locked / empty 怎么显示」只有一份语义——
 * 名册不自己重算 reload。没有 telemetry 时值为 null，呈现层据此不显示 reload（不假设满弹）。
 */
const rosterReload = computed(() => {
  if (!props.reloadTelemetry) return null
  const out: Record<number, NonNullable<ReturnType<RosterDeps['vehicleReloadAt']>>> = {}
  for (const vehicle of props.playbackV2?.vehicles || []) {
    const shells = vehicleReloadAt(vehicle.accountId, currentTime.value)
    if (shells && shells.length > 0) out[vehicle.accountId] = shells
  }
  return out
})

function floatTeamClass(friendly: boolean | null | undefined) {
  if (friendly === true) return 'pb-float-friendly'
  if (friendly === false) return 'pb-float-enemy'
  return 'pb-float-neutral'
}

// ---- PR4 §32–§35：标签碰撞布局（纯函数；screen px；碰撞永不隐藏标签/HP）----
// §21–§28 + PR #107 Blocker 1：碰撞基于真实 screen-space visual footprint。
// 坐标空间（统一约定）：
//   - marker core 本体在 viewport 内随地图缩放：每辆车的 vehicle-aware CSS footprint
//     × view.scale；coreSize 仅作为 label 几何的代表值，不参与 model collision。
//   - inverse-scaled 叠加层（selected 三角 / destroyed ✕ / recorder 菱形 / 名称 / HP HUD）
//     用 scale(1/view.scale) 保持屏幕恒定，labelLayout 用屏幕恒定常量描述其盒。
//   - viewport resize / fullscreen / mobile media query / zoom / 显示开关变化都会经
//     view.scale / mapWidth / prefs 触发本 computed 重算。
const labelLayout = computed(() => {
  const W = mapWidth()
  if (!W || mapView.value.W <= 0) return new Map()
  // Label geometry remains screen-space and only needs a representative core size;
  // the model collision solver above uses each vehicle's real display footprint.
  const coreSize = Math.max(
    ...vehicleStates.value.map((st) => hpPrefs.showHp && hpPrefs.mode === 'ring' && !st.destroyed
      ? healthRingDiameter(st, markerPrefs.classIcons) : st.markerSize?.renderBox?.width || 0),
    MARKER_CORE_PX,
  )
  // HP HUD 真实渲染尺寸（.pb-hp-hud 屏幕恒定；测试环境无布局 → 回退 null 走 CSS 常量）。
  // PR #107 Blocker 4：querySelector 第一辆车的 HUD 只作测量基准——不同车辆的显示文本不同
  //（数字 vs —）可能影响宽度，labelLayout 侧再按每车 hpDisplayText 估算并取 max（保守覆盖全部状态）。
  const hpHudEl = mapEl.value?.querySelector<HTMLElement>('.pb-hp-hud')
  const hpBoxW = hpHudEl ? Number(hpHudEl.offsetWidth) : null
  const hpBoxH = hpHudEl ? Number(hpHudEl.offsetHeight) : null
  const items = vehicleStates.value.map((st) => {
    const p = markerScreen(st)
    if (!p) return null
    const hp = hpFor(st.vehicle)
    return {
      accountId: st.vehicle.accountId,
      x: p.x,
      y: p.y,
      tankName: st.tankName,
      // Badge width (space-3) + inline gap (space-1), in fixed screen pixels.
      tankNameExtraWidth: (st.gunMarks as number) > 0 ? 16 : 0,
      playerName: st.playerName,
      // PR #107 Blocker 4：HP footprint 是否存在 = DOM 是否实际渲染 HUD（showHp 开且
      // health selector 有结果），不是 current 是否为 null——relativeFull（current=null）
      // 与 UNKNOWN 都会渲染 HUD（数字 — + bar），碰撞系统必须为它们建模真实盒。
      coreSize: hpPrefs.showHp && hpPrefs.mode === 'ring' && !st.destroyed ? healthRingDiameter(st, markerPrefs.classIcons) : undefined,
      hpRing: hpPrefs.showHp && hpPrefs.mode === 'ring' && !st.destroyed,
      hpRendered: !uiHidden.value && hpPrefs.showHp && hpPrefs.mode === 'bar' && !st.destroyed && hp != null,
      // 实际渲染的数字文本（VehicleMarker .pb-hp-num 同款：current 有值→数字，否则 —）；
      // labelLayout 用它做「覆盖所有状态的保守盒宽」估算（与第一辆车实测宽取 max）
      hpDisplayText: hp ? hpDisplayNumText(hp) : '',
      hpBoxW,
      hpBoxH,
      // Hidden badges have no collision footprint in the compact presentation.
      selected: markerPrefs.showStatus && selectedAccountId.value === st.vehicle.accountId,
      destroyed: markerPrefs.showStatus && st.destroyed === true,
      recorder: markerPrefs.showStatus && st.recorder === true,
    }
  }).filter(Boolean)
  return computeLabelLayout(items, {
    showTank: !uiHidden.value && labelPrefs.showTankName,
    showPlayer: !uiHidden.value && labelPrefs.showPlayerName,
    viewportW: W,
    viewportH: W * (mapView.value.H / mapView.value.W),
    coreSize,
  })
})

/** VehicleMarker label prop（每 marker 一个：显示开关 + 碰撞位移 +
 *  §25 blockHidden/hpHidden：不可分离碰撞时的优先级隐藏兼容输出，恒 false）。 */
function markerLabel(accountId: number) {
  const l = labelLayout.value.get(accountId)
  return {
    showPlayer: !uiHidden.value && labelPrefs.showPlayerName,
    showTank: !uiHidden.value && labelPrefs.showTankName,
    showReload: !uiHidden.value && hpPrefs.mode !== 'ring' && labelPrefs.showReload,
    tankDy: l ? l.tankDy : 0,
    blockHidden: l ? l.blockHidden : false,
    hpHidden: l ? l.hpHidden : false,
  }
}

// 圆圈颜色只表示当前归属；正在占领由进度弧单独表达，不覆盖归属。
function baseStatus(state: MapModel['baseStatesAt']['value'][number] | undefined) {
  if (!state || state.ownerTeam == null) return 'neutral'
  if (friendlyTeam.value == null) return 'controlled'
  return state.ownerTeam === friendlyTeam.value ? 'friendly_controlled' : 'enemy_controlled'
}

function capturedBy(state: MapModel['baseStatesAt']['value'][number] | undefined) {
  if (!state || state.capturingTeam == null || friendlyTeam.value == null) return 'unknown'
  return state.capturingTeam === friendlyTeam.value ? 'friendly' : 'enemy'
}

// 顶部基地状态条（与 3D 共用 BaseStatusBar）：始终显示，地图缺该图几何时它也是唯一的基地信息来源。
const hudBaseStates = computed(() => baseStatesAt.value)

const ASSAULT_BASE_RADIUS_FALLBACK_M = 20

const basesAt = computed(() => {
  // Objective existence is independent of capture activity; geometry never infers mode.
  const states = new Map<string, MapModel['baseStatesAt']['value'][number]>(baseStatesAt.value.map((state) => [state.baseId, state]))
  const assaultState = states.get('BASE')
  const assaultView = baseView(assaultState || { baseId: 'BASE' }, friendlyTeam.value)
  if (playback.value?.assaultObjectivePresent === true) {
    const mapCode = pbOverview.value?.mapCode
    const semantics = mapSemantics.find(map => map.verified && map.mapCodes?.includes(mapCode as string))
    const geometry = (semantics?.sceneEvidence?.battlePoints || [])
      .filter(point => point.type === 'controlpoint' && point.confidence === 'EXACT_SCENE_DATA')
      .map(point => ({ x: point.position[0], y: point.position[1], radius: null }))
    // Ambiguous geometry cannot select an objective; retain the canonical HUD fallback.
    if (geometry.length !== 1) return []
    return geometry.map((base) => ({
      ...base,
      baseId: 'BASE',
      // 部分 client scene 未声明 controlpoint radius。20m 仅是 presentation fallback，
      // 不进入 protocol/canonical truth，也不根据车辆距离推导半径。
      radius: base.radius ?? ASSAULT_BASE_RADIUS_FALLBACK_M,
      status: assaultView.owner === 'friendly'
        ? 'friendly_controlled'
        : (assaultView.owner === 'enemy' ? 'enemy_controlled' : 'neutral'),
      progress: assaultView.progress,
      capturedBy: assaultView.capturing ?? 'unknown',
    }))
  }

  if (!baseStatesAt.value.some(state => ['A', 'B', 'C', 'D'].includes(state.baseId))) return []
  const geometry = (mapBases as Record<string, { supremacy?: Array<{ baseId: string; x: number; y: number; radius: number | null }> }>)[pbOverview.value?.mapCode ?? '']?.supremacy || []
  return geometry
    .filter((base) => base.radius != null)
    .map((base) => {
      const state = states.get(base.baseId)
      return {
        ...base,
        status: baseStatus(state),
        // Supremacy 水位只有 capturingTeam 存在时才显示；离开基地后旧 progress 不得继续挂着。
        progress: state?.capturingTeam != null ? (state.captureProgress ?? null) : null,
        capturedBy: capturedBy(state),
      }
    })
})

watch([uiHidden, () => uiPrefs.showTopbar, () => uiPrefs.showBaseStatus, () => hudBaseStates.value.length], async () => {
  await nextTick()
  const hud = pbRoot.value?.querySelector('.pb-hud')
  const observer = stageResizeObserver()
  if (hud && observer) observer.observe(hud)
  writeSquareAvailHeight()
})

const mapStyle = computed(() => ({
  '--pb-map-aspect': `${mapView.value.W} / ${mapView.value.H}`,
  // Battle Playback 6x6 网格：用显式强对比线，保证每一列可见地隔开（热力图鸟瞰用弱 gridStroke）。
  '--map-grid-stroke': palette.value.gridStrokeStrong,
  '--map-region-stroke': palette.value.regionStroke,
  '--map-spawn-friendly': palette.value.spawnFriendly,
  '--map-spawn-enemy': palette.value.spawnEnemy,
  '--map-route-outline': palette.value.routeOutline,
  // Playback root 作用域角色色（SSOT = data/mapTeamColors.js；不随地图分叉）
  ...teamCssVars(pbOverview.value.mapCode)
}))
  return {
    teamVehicles, rosterTeams, destroyedNow, rosterLanes, rosterEntryVisible, hudClockVisible,
    inlineStack, detailsFloating, rosterHealth, rosterReload, floatTeamClass, labelLayout,
    markerLabel, baseStatus, capturedBy, hudBaseStates, basesAt, mapStyle,
  }
}
