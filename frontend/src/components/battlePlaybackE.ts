import { computed, nextTick, watch } from 'vue'
import type { Ref } from 'vue'
import { buildKillTicks, buildShotTicks } from '../utils/playbackShortcuts.ts'
import { usePlaybackVehicleSelection } from '../composables/usePlaybackVehicleSelection.js'
import { rosterLanesFor } from '../scene/rosterState.js'
import { healthDisplayAt } from '../utils/battlePlaybackV2.js'
import { healthRingDiameter } from '../utils/vehicleMarkerSizing.js'
import { MARKER_CORE_PX, computeLabelLayout } from '../utils/labelLayout'
import { baseView } from '../utils/baseStatus.js'
import { mapBases } from '../data/mapBases'
import { teamCssVars } from '../data/mapTeamColors'
import type { BattleEvent, BattlePlaybackDataset, VehiclePlaybackTrack, BaseStateTransition } from '../types/playback-v2.js'
import type { PlaybackVehicleProjection } from '../composables/usePlaybackVehicleProjection.js'

type SelectionCamera = Parameters<typeof usePlaybackVehicleSelection>[0]
type SelectionDeps = Parameters<typeof usePlaybackVehicleSelection>[1]
type VehicleState = PlaybackVehicleProjection['vehicleStates']['value'][number]
type HpDisplay = { current: number | null; maxHp: number | null; pct: number | null }

/** aspect/颜色板视图（owner 在 mapPalette.js，字段为呈现侧固定契约）。 */
interface PaletteLike {
  gridStrokeStrong: string
  regionStroke: string
  spawnFriendly: string
  spawnEnemy: string
  routeOutline: string
}

/** 语义档案里 E 段消费的最小结构（sceneEvidence.battlePoints）。 */
interface MapSemanticsLike {
  verified?: boolean
  mapCodes?: string[]
  sceneEvidence?: {
    battlePoints?: Array<{ type: string; confidence: string; position: [number, number] }>
  }
}

/** 名册行血条投影。 */
interface RosterHealthEntry {
  currentHp: number | null
  maxHp: number | null
  pct: number | null
  relativeFull: boolean
  state: unknown
}

export interface BpEParts {
  playback: Ref<BattlePlaybackDataset | null>
  duration: Ref<number>
  currentTime: Ref<number>
  friendlyTeam: Ref<number | null>
  uiHidden: Ref<boolean>
  uiPrefs: { showTopbar?: boolean; showBaseStatus?: boolean }
  hpPrefs: { showHp: boolean; mode: string }
  markerPrefs: { classIcons: boolean; showStatus: boolean }
  labelPrefs: { showTankName: boolean; showPlayerName: boolean; showReload: boolean }
  isPhonePortrait: Ref<boolean>
  showRosterPresentation: Ref<boolean>
  rosterLanesOpen: Ref<boolean>
  view: SelectionCamera['view']
  mapEl: SelectionCamera['mapEl']
  mapRenderRect: SelectionCamera['mapRenderRect']
  mapWidth: SelectionCamera['mapWidth']
  vehicleStates: PlaybackVehicleProjection['vehicleStates']
  markerScreen: SelectionDeps['markerScreen']
  projectedSemanticNorm: SelectionDeps['projectedSemanticNorm']
  battlefieldWorkspaceEl: SelectionDeps['battlefieldWorkspaceEl']
  mobileOverlay: SelectionDeps['mobileOverlay']
  hpVehicles: SelectionDeps['hpVehicles']
  hpFor: (vehicle: VehicleState['vehicle']) => HpDisplay | null
  hpDisplayNumText: (hp: HpDisplay) => string
  vehicleReloadAt: (accountId: number | null, seconds: number) => unknown[] | null
  mapView: Ref<{ W: number; H: number }>
  mapSemantics: MapSemanticsLike[]
  baseStatesAt: Ref<BaseStateTransition[]>
  pbOverview: Ref<{ mapCode: string | null }>
  palette: Ref<PaletteLike>
  pbRoot: Ref<HTMLElement | null>
  stageResizeObserver: ResizeObserver | null
  writeSquareAvailHeight: () => void
  t: (key: string) => string
}

export interface BpEProps {
  playbackV2: BattlePlaybackDataset | null
  clockOffset: number | null
  facetShots: Parameters<typeof buildShotTicks>[0]
  facetKills: Parameters<typeof buildKillTicks>[0]
  reloadTelemetry: unknown
}

/** 2D 基地几何（mapBases 数据形状；radius 缺省表示该 client scene 未声明）。 */
type BaseId = 'A' | 'B' | 'C' | 'D' | 'BASE'
interface BaseGeometry {
  baseId: string
  x: number
  y: number
  radius?: number | null
}

const MAP_BASES: Record<string, { supremacy?: BaseGeometry[] }> = mapBases

export function bpE(S: BpEParts, props: BpEProps): void {
  /**
   * authoritative playback events：全部回放事件。
   * deterministic state（当前累计伤害/击杀）与 combat feedback（floating damage / hit flash / ghost /
   * destruction burst / kill feed / damage log）必须消费本源——「战斗事实有没有发生」不取决于事件列表
   * UI 是否折叠。Event Panel 只消费 presentation-only 的 userVisibleEvents；炮线仍消费
   * 同一份完整真实事件。
   */
  const authoritativeEvents = computed<BattleEvent[]>(() => (S.playback.value ? S.playback.value.events : []))
  // 2D 时间轴刻度 = 3D 同款（scenePlayback 的 shots/kills）：原始秒按 canonical startRaw 换算成相对秒。
  // 2D 时间轴是战斗相对轴（PlaybackControls.seek 收相对秒）：pct 沿原始秒轴 [clockOffset, +duration]
  // 换算，位置正确；但 buildShotTicks/buildKillTicks 返回的 t 仍是原始秒，点击吸附会跳到错误时刻
  // （开战原点 30s、炮击原始 60s → 刻度画在战斗第 30s 处，点击却返回 60）。传给 2D 控件前把 t
  // 减去 clockOffset；3D 场景刻度不经此路径（seekTime 收原始秒），不受影响。
  const to2dTick = (tick: { t: number }) => ({ ...tick, t: tick.t - (props.clockOffset ?? 0) })
  const shotTicks = computed(() => buildShotTicks(props.facetShots, props.clockOffset ?? 0, (props.clockOffset ?? 0) + S.duration.value).map(to2dTick))
  const killTicks = computed(() => buildKillTicks(props.facetKills, props.clockOffset ?? 0, (props.clockOffset ?? 0) + S.duration.value).map(to2dTick))
  const userVisibleEvents = computed(() => authoritativeEvents.value.filter((event) => (
    event.type === 'DAMAGE' || event.type === 'KILL' || event.type === 'DESTROYED'
  )))

  // ---- 车辆选中 / 详情编排：selected / details 状态的唯一 owner = usePlaybackVehicleSelection
  // （#820 Agent C Step 2）；hit-test 与浮窗落位经由同一相机变换与 workspace 坐标系。
  const {
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
    onMarkerSelect,
    selectAt,
    selectFromRoster,
  } = usePlaybackVehicleSelection(
    { view: S.view, mapEl: S.mapEl, mapRenderRect: S.mapRenderRect, mapWidth: S.mapWidth },
    {
      vehicleStates: S.vehicleStates,
      playback: S.playback,
      currentTime: S.currentTime,
      authoritativeEvents,
      hpVehicles: S.hpVehicles,
      uiHidden: S.uiHidden,
      hpPrefs: S.hpPrefs,
      markerPrefs: S.markerPrefs,
      battlefieldWorkspaceEl: S.battlefieldWorkspaceEl,
      markerScreen: S.markerScreen,
      projectedSemanticNorm: S.projectedSemanticNorm,
      mobileOverlay: S.mobileOverlay,
      t: S.t,
    },
  )

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

  const rosterTeams = computed(() => rosterLanesFor(teamVehicles.value, S.friendlyTeam.value))

  /**
   * Both physical team rosters use current destruction state from the same authoritative projection.
   */
  const destroyedNow = computed(() => new Set(
    (props.playbackV2?.vehicles || []).filter(vehicle => healthDisplayAt(vehicle, S.currentTime.value)?.destroyed === true).map(vehicle => vehicle.accountId)))

  /**
   * 正方形 Stage 的呈现决策（见 styles/playback-workspace.css 的权威契约）：
   *
   *   名册浮层 ＝ showRoster 开 且 不是手机竖屏 且 会话级浮层开关展开。
   *     浮层锚在 `.pb-map-stage` 内侧左右边缘，不再占据固定 Grid 列——地图列始终是全宽。
   *   手机竖屏 ＝ 纵向流：名册排在传输控件之下的 `.pb-inline-area`，跟着页面滚。
   *
   * 名册**只是呈现**：关掉不重置名册数据、选中车辆、跟随目标、时间轴与相机。
   */
  const rosterLanes = computed(() => S.showRosterPresentation.value && !S.isPhonePortrait.value && S.rosterLanesOpen.value)
  /** 名册浮层入口（传输条上的 roster 按钮）：竖屏纵向流里的名册始终可见，不需要这个入口。 */
  const rosterEntryVisible = computed(() => S.showRosterPresentation.value && !S.isPhonePortrait.value)
  /**
   * §2d-shellnav 窄容器时钟让位的前提：HUD 里真的有同一时钟（showSummary = showTopbar）。
   * showTopbar 关闭（或 HUD 隐藏）时窄容器 CSS 必须保留传输条时钟，否则播放期间没有任何可见时间
   * （F6）：root class 驱动 playback-workspace.css 的窄容器分支。
   */
  const hudClockVisible = computed(() => !S.uiHidden.value && S.uiPrefs.showTopbar === true)
  /** 竖屏的纵向流里，名册排在传输控件之后的 `.pb-inline-area`；详情则是流内内容块。
      竖屏以外，详情是 workspace 顶层的可拖动浮窗。 */
  const inlineStack = computed(() => S.isPhonePortrait.value)
  const detailsFloating = computed(() => !S.isPhonePortrait.value)
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
    const out: Record<number, RosterHealthEntry> = {}
    for (const vehicle of props.playbackV2?.vehicles || []) {
      const display = healthDisplayAt(vehicle, S.currentTime.value)
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
    const out: Record<number, unknown[]> = {}
    for (const vehicle of props.playbackV2?.vehicles || []) {
      const shells = S.vehicleReloadAt(vehicle.accountId, S.currentTime.value)
      if (shells && shells.length > 0) out[vehicle.accountId] = shells
    }
    return out
  })

  function floatTeamClass(friendly: boolean | null | undefined): string {
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
    const W = S.mapWidth()
    if (!W || S.mapView.value.W <= 0) return new Map()
    // Label geometry stays screen-space; only a representative core size is needed here.
    const coreSize = Math.max(
      ...S.vehicleStates.value.map((st) => S.hpPrefs.showHp && S.hpPrefs.mode === 'ring' && !st.destroyed
        ? healthRingDiameter(st, S.markerPrefs.classIcons) : st.markerSize?.renderBox?.width || 0),
      MARKER_CORE_PX,
    )
    // HP HUD 真实渲染尺寸（屏幕恒定；无布局回退 null）：第一辆车 HUD 只是测量基准，
    // labelLayout 侧按每车 hpDisplayText 估算并取 max（保守覆盖数字/—的宽度差）。
    const hpHudEl = S.mapEl.value?.querySelector('.pb-hp-hud') as HTMLElement | null
    const hpBoxW = hpHudEl ? Number(hpHudEl.offsetWidth) : null
    const hpBoxH = hpHudEl ? Number(hpHudEl.offsetHeight) : null
    const items = S.vehicleStates.value.map((st) => {
      const p = S.markerScreen(st)
      if (!p) return null
      const hp = S.hpFor(st.vehicle)
      return {
        accountId: st.vehicle.accountId,
        x: p.x,
        y: p.y,
        tankName: st.tankName,
        // Badge width (space-3) + inline gap (space-1), in fixed screen pixels.
        tankNameExtraWidth: (st.gunMarks ?? 0) > 0 ? 16 : 0,
        playerName: st.playerName,
        // PR #107 Blocker 4：HP footprint 是否存在 = DOM 是否实际渲染 HUD（showHp 开且
        // health selector 有结果），不是 current 是否为 null——relativeFull（current=null）
        // 与 UNKNOWN 都会渲染 HUD（数字 — + bar），碰撞系统必须为它们建模真实盒。
        coreSize: S.hpPrefs.showHp && S.hpPrefs.mode === 'ring' && !st.destroyed ? healthRingDiameter(st, S.markerPrefs.classIcons) : undefined,
        hpRing: S.hpPrefs.showHp && S.hpPrefs.mode === 'ring' && !st.destroyed,
        hpRendered: !S.uiHidden.value && S.hpPrefs.showHp && S.hpPrefs.mode === 'bar' && !st.destroyed && hp != null,
        // 实际渲染的数字文本（VehicleMarker .pb-hp-num 同款：current 有值→数字，否则 —）；
        // labelLayout 用它做「覆盖所有状态的保守盒宽」估算（与第一辆车实测宽取 max）
        hpDisplayText: hp ? S.hpDisplayNumText(hp) : '',
        hpBoxW,
        hpBoxH,
        // Hidden badges have no collision footprint in the compact presentation.
        selected: S.markerPrefs.showStatus && selectedAccountId.value === st.vehicle.accountId,
        destroyed: S.markerPrefs.showStatus && st.destroyed === true,
        recorder: S.markerPrefs.showStatus && st.recorder === true,
      }
    }).filter(Boolean)
    return computeLabelLayout(items, {
      showTank: !S.uiHidden.value && S.labelPrefs.showTankName,
      showPlayer: !S.uiHidden.value && S.labelPrefs.showPlayerName,
      viewportW: W,
      viewportH: W * (S.mapView.value.H / S.mapView.value.W),
      coreSize,
    })
  })

  /** VehicleMarker label prop（每 marker 一个：显示开关 + 碰撞位移 +
   *  §25 blockHidden/hpHidden：不可分离碰撞时的优先级隐藏兼容输出，恒 false）。 */
  function markerLabel(accountId: number | null) {
    const l = labelLayout.value.get(accountId)
    return {
      showPlayer: !S.uiHidden.value && S.labelPrefs.showPlayerName,
      showTank: !S.uiHidden.value && S.labelPrefs.showTankName,
      showReload: !S.uiHidden.value && S.hpPrefs.mode !== 'ring' && S.labelPrefs.showReload,
      tankDy: l ? l.tankDy : 0,
      blockHidden: l ? l.blockHidden : false,
      hpHidden: l ? l.hpHidden : false,
    }
  }

  // 圆圈颜色只表示当前归属；正在占领由进度弧单独表达，不覆盖归属。
  function baseStatus(state: BaseStateTransition | undefined): string {
    if (!state || state.ownerTeam == null) return 'neutral'
    if (S.friendlyTeam.value == null) return 'controlled'
    return state.ownerTeam === S.friendlyTeam.value ? 'friendly_controlled' : 'enemy_controlled'
  }

  function capturedBy(state: BaseStateTransition | undefined): string {
    if (!state || state.capturingTeam == null || S.friendlyTeam.value == null) return 'unknown'
    return state.capturingTeam === S.friendlyTeam.value ? 'friendly' : 'enemy'
  }

  // 顶部基地状态条（与 3D 共用 BaseStatusBar）：始终显示，地图缺该图几何时它也是唯一的基地信息来源。
  const hudBaseStates = computed(() => S.baseStatesAt.value)

  const ASSAULT_BASE_RADIUS_FALLBACK_M = 20

  const basesAt = computed(() => {
    // Objective existence is independent of capture activity; geometry never infers mode.
    const states = new Map(S.baseStatesAt.value.map((state) => [state.baseId, state]))
    const assaultState = states.get('BASE')
    const assaultView = baseView(assaultState || { baseId: 'BASE' }, S.friendlyTeam.value)
    if (S.playback.value?.assaultObjectivePresent === true) {
      const mapCode = S.pbOverview.value?.mapCode
      const semantics = S.mapSemantics.find(map => map.verified && map.mapCodes?.includes(mapCode ?? ''))
      const geometry = (semantics?.sceneEvidence?.battlePoints || [])
        .filter(point => point.type === 'controlpoint' && point.confidence === 'EXACT_SCENE_DATA')
        .map(point => ({ x: point.position[0], y: point.position[1], radius: null as number | null }))
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

    if (!S.baseStatesAt.value.some(state => state.baseId !== 'BASE')) return []
    const mapCode = S.pbOverview.value?.mapCode
    const geometry = (mapCode ? MAP_BASES[mapCode]?.supremacy : undefined) || []
    return geometry
      .filter((base) => base.radius != null)
      .map((base) => {
        const state = states.get(base.baseId as BaseId)
        return {
          ...base,
          status: baseStatus(state),
          // Supremacy 水位只有 capturingTeam 存在时才显示；离开基地后旧 progress 不得继续挂着。
          progress: state?.capturingTeam != null ? (state.captureProgress ?? null) : null,
          capturedBy: capturedBy(state),
        }
      })
  })

  watch([S.uiHidden, () => S.uiPrefs.showTopbar, () => S.uiPrefs.showBaseStatus, () => hudBaseStates.value.length], async () => {
    await nextTick()
    const hud = S.pbRoot.value?.querySelector('.pb-hud')
    if (hud && S.stageResizeObserver) S.stageResizeObserver.observe(hud)
    S.writeSquareAvailHeight()
  })

  const mapStyle = computed(() => ({
    '--pb-map-aspect': `${S.mapView.value.W} / ${S.mapView.value.H}`,
    // Battle Playback 6x6 网格：用显式强对比线，保证每一列可见地隔开（热力图鸟瞰用弱 gridStroke）。
    '--map-grid-stroke': S.palette.value.gridStrokeStrong,
    '--map-region-stroke': S.palette.value.regionStroke,
    '--map-spawn-friendly': S.palette.value.spawnFriendly,
    '--map-spawn-enemy': S.palette.value.spawnEnemy,
    '--map-route-outline': S.palette.value.routeOutline,
    // Playback root 作用域角色色（SSOT = data/mapTeamColors.js；不随地图分叉）
    ...teamCssVars(S.pbOverview.value.mapCode),
  }))

  Object.assign(S, {
    authoritativeEvents,
    shotTicks,
    killTicks,
    userVisibleEvents,
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
    onMarkerSelect,
    selectAt,
    selectFromRoster,
    teamVehicles,
    rosterTeams,
    destroyedNow,
    rosterLanes,
    rosterEntryVisible,
    hudClockVisible,
    inlineStack,
    detailsFloating,
    rosterHealth,
    rosterReload,
    floatTeamClass,
    labelLayout,
    markerLabel,
    baseStatus,
    capturedBy,
    hudBaseStates,
    ASSAULT_BASE_RADIUS_FALLBACK_M,
    basesAt,
    mapStyle,
  })
}