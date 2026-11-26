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

const destroyedNow = computed(() => new Set(
  (props.playbackV2?.vehicles || []).filter(vehicle => healthDisplayAt(vehicle, currentTime.value)?.destroyed === true).map(vehicle => vehicle.accountId)))

const rosterLanes = computed(() => showRosterPresentation.value && !isPhonePortrait.value && rosterLanesOpen.value)
const rosterEntryVisible = computed(() => showRosterPresentation.value && !isPhonePortrait.value)
const hudClockVisible = computed(() => !uiHidden.value && uiPrefs.showTopbar === true)
const inlineStack = computed(() => isPhonePortrait.value)
const detailsFloating = computed(() => !isPhonePortrait.value)
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

const labelLayout = computed(() => {
  const W = mapWidth()
  if (!W || mapView.value.W <= 0) return new Map()
  const coreSize = Math.max(
    ...vehicleStates.value.map((st) => hpPrefs.showHp && hpPrefs.mode === 'ring' && !st.destroyed
      ? healthRingDiameter(st, markerPrefs.classIcons) : st.markerSize?.renderBox?.width || 0),
    MARKER_CORE_PX,
  )
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
      tankNameExtraWidth: (st.gunMarks as number) > 0 ? 16 : 0,
      playerName: st.playerName,
      coreSize: hpPrefs.showHp && hpPrefs.mode === 'ring' && !st.destroyed ? healthRingDiameter(st, markerPrefs.classIcons) : undefined,
      hpRing: hpPrefs.showHp && hpPrefs.mode === 'ring' && !st.destroyed,
      hpRendered: !uiHidden.value && hpPrefs.showHp && hpPrefs.mode === 'bar' && !st.destroyed && hp != null,
      hpDisplayText: hp ? hpDisplayNumText(hp) : '',
      hpBoxW,
      hpBoxH,
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

function baseStatus(state: MapModel['baseStatesAt']['value'][number] | undefined) {
  if (!state || state.ownerTeam == null) return 'neutral'
  if (friendlyTeam.value == null) return 'controlled'
  return state.ownerTeam === friendlyTeam.value ? 'friendly_controlled' : 'enemy_controlled'
}

function capturedBy(state: MapModel['baseStatesAt']['value'][number] | undefined) {
  if (!state || state.capturingTeam == null || friendlyTeam.value == null) return 'unknown'
  return state.capturingTeam === friendlyTeam.value ? 'friendly' : 'enemy'
}

const hudBaseStates = computed(() => baseStatesAt.value)

const ASSAULT_BASE_RADIUS_FALLBACK_M = 20

const basesAt = computed(() => {
  const states = new Map<string, MapModel['baseStatesAt']['value'][number]>(baseStatesAt.value.map((state) => [state.baseId, state]))
  const assaultState = states.get('BASE')
  const assaultView = baseView(assaultState || { baseId: 'BASE' }, friendlyTeam.value)
  if (playback.value?.assaultObjectivePresent === true) {
    const mapCode = pbOverview.value?.mapCode
    const semantics = mapSemantics.find(map => map.verified && map.mapCodes?.includes(mapCode as string))
    const geometry = (semantics?.sceneEvidence?.battlePoints || [])
      .filter(point => point.type === 'controlpoint' && point.confidence === 'EXACT_SCENE_DATA')
      .map(point => ({ x: point.position[0], y: point.position[1], radius: null }))
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

  if (!baseStatesAt.value.some(state => ['A', 'B', 'C', 'D'].includes(state.baseId))) return []
  const geometry = (mapBases as Record<string, { supremacy?: Array<{ baseId: string; x: number; y: number; radius: number | null }> }>)[pbOverview.value?.mapCode ?? '']?.supremacy || []
  return geometry
    .filter((base) => base.radius != null)
    .map((base) => {
      const state = states.get(base.baseId)
      return {
        ...base,
        status: baseStatus(state),
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
  '--map-grid-stroke': palette.value.gridStrokeStrong,
  '--map-region-stroke': palette.value.regionStroke,
  '--map-spawn-friendly': palette.value.spawnFriendly,
  '--map-spawn-enemy': palette.value.spawnEnemy,
  '--map-route-outline': palette.value.routeOutline,
  ...teamCssVars(pbOverview.value.mapCode)
}))
  return {
    teamVehicles, rosterTeams, destroyedNow, rosterLanes, rosterEntryVisible, hudClockVisible,
    inlineStack, detailsFloating, rosterHealth, rosterReload, floatTeamClass, labelLayout,
    markerLabel, baseStatus, capturedBy, hudBaseStates, basesAt, mapStyle,
  }
}
