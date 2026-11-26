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

interface PaletteLike {
  gridStrokeStrong: string
  regionStroke: string
  spawnFriendly: string
  spawnEnemy: string
  routeOutline: string
}

interface MapSemanticsLike {
  verified?: boolean
  mapCodes?: string[]
  sceneEvidence?: {
    battlePoints?: Array<{ type: string; confidence: string; position: [number, number] }>
  }
}

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

type BaseId = 'A' | 'B' | 'C' | 'D' | 'BASE'
interface BaseGeometry {
  baseId: string
  x: number
  y: number
  radius?: number | null
}

const MAP_BASES: Record<string, { supremacy?: BaseGeometry[] }> = mapBases

export function bpE(S: BpEParts, props: BpEProps): void {
  const authoritativeEvents = computed<BattleEvent[]>(() => (S.playback.value ? S.playback.value.events : []))
  const to2dTick = (tick: { t: number }) => ({ ...tick, t: tick.t - (props.clockOffset ?? 0) })
  const shotTicks = computed(() => buildShotTicks(props.facetShots, props.clockOffset ?? 0, (props.clockOffset ?? 0) + S.duration.value).map(to2dTick))
  const killTicks = computed(() => buildKillTicks(props.facetKills, props.clockOffset ?? 0, (props.clockOffset ?? 0) + S.duration.value).map(to2dTick))
  const userVisibleEvents = computed(() => authoritativeEvents.value.filter((event) => (
    event.type === 'DAMAGE' || event.type === 'KILL' || event.type === 'DESTROYED'
  )))

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

  const destroyedNow = computed(() => new Set(
    (props.playbackV2?.vehicles || []).filter(vehicle => healthDisplayAt(vehicle, S.currentTime.value)?.destroyed === true).map(vehicle => vehicle.accountId)))

  const rosterLanes = computed(() => S.showRosterPresentation.value && !S.isPhonePortrait.value && S.rosterLanesOpen.value)
  const rosterEntryVisible = computed(() => S.showRosterPresentation.value && !S.isPhonePortrait.value)
  const hudClockVisible = computed(() => !S.uiHidden.value && S.uiPrefs.showTopbar === true)
  const inlineStack = computed(() => S.isPhonePortrait.value)
  const detailsFloating = computed(() => !S.isPhonePortrait.value)
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

  const labelLayout = computed(() => {
    const W = S.mapWidth()
    if (!W || S.mapView.value.W <= 0) return new Map()
    const coreSize = Math.max(
      ...S.vehicleStates.value.map((st) => S.hpPrefs.showHp && S.hpPrefs.mode === 'ring' && !st.destroyed
        ? healthRingDiameter(st, S.markerPrefs.classIcons) : st.markerSize?.renderBox?.width || 0),
      MARKER_CORE_PX,
    )
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
        tankNameExtraWidth: (st.gunMarks ?? 0) > 0 ? 16 : 0,
        playerName: st.playerName,
        coreSize: S.hpPrefs.showHp && S.hpPrefs.mode === 'ring' && !st.destroyed ? healthRingDiameter(st, S.markerPrefs.classIcons) : undefined,
        hpRing: S.hpPrefs.showHp && S.hpPrefs.mode === 'ring' && !st.destroyed,
        hpRendered: !S.uiHidden.value && S.hpPrefs.showHp && S.hpPrefs.mode === 'bar' && !st.destroyed && hp != null,
        hpDisplayText: hp ? S.hpDisplayNumText(hp) : '',
        hpBoxW,
        hpBoxH,
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

  function baseStatus(state: BaseStateTransition | undefined): string {
    if (!state || state.ownerTeam == null) return 'neutral'
    if (S.friendlyTeam.value == null) return 'controlled'
    return state.ownerTeam === S.friendlyTeam.value ? 'friendly_controlled' : 'enemy_controlled'
  }

  function capturedBy(state: BaseStateTransition | undefined): string {
    if (!state || state.capturingTeam == null || S.friendlyTeam.value == null) return 'unknown'
    return state.capturingTeam === S.friendlyTeam.value ? 'friendly' : 'enemy'
  }

  const hudBaseStates = computed(() => S.baseStatesAt.value)

  const ASSAULT_BASE_RADIUS_FALLBACK_M = 20

  const basesAt = computed(() => {
    const states = new Map(S.baseStatesAt.value.map((state) => [state.baseId, state]))
    const assaultState = states.get('BASE')
    const assaultView = baseView(assaultState || { baseId: 'BASE' }, S.friendlyTeam.value)
    if (S.playback.value?.assaultObjectivePresent === true) {
      const mapCode = S.pbOverview.value?.mapCode
      const semantics = S.mapSemantics.find(map => map.verified && map.mapCodes?.includes(mapCode ?? ''))
      const geometry = (semantics?.sceneEvidence?.battlePoints || [])
        .filter(point => point.type === 'controlpoint' && point.confidence === 'EXACT_SCENE_DATA')
        .map(point => ({ x: point.position[0], y: point.position[1], radius: null as number | null }))
      if (geometry.length !== 1) return []
      return geometry.map((base) => ({
        ...base,
        baseId: 'BASE',
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
    '--map-grid-stroke': S.palette.value.gridStrokeStrong,
    '--map-region-stroke': S.palette.value.regionStroke,
    '--map-spawn-friendly': S.palette.value.spawnFriendly,
    '--map-spawn-enemy': S.palette.value.spawnEnemy,
    '--map-route-outline': S.palette.value.routeOutline,
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