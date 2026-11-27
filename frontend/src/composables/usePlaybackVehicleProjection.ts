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
import { playbackTracerColor } from '../data/mapTeamColors.js'
import type { PlaybackReplayData } from './usePlaybackReplayData.js'
import type { PlaybackMapViewLike } from './usePlaybackCamera.js'
import type { BattlePlaybackDataset, BattleEvent, VehiclePlaybackTrack } from '../types/playback-v2.js'
import type { RouteLike } from '../utils/battlePlayback.js'

type ComputedMarkerSize = {
  renderBox: { width: number; height: number }
  collisionFootprint: { width: number; height: number }
  hitTarget: { width: number; height: number }
  source: string
  footprint: { width: number; length: number }
}
type ComputeVehicleMarkerSize = (
  vehicle: VehiclePlaybackTrack,
  options: { model?: unknown; mapView?: unknown; mapWidthPx?: number | null; mapHeightPx?: number | null; mobile?: boolean },
) => ComputedMarkerSize
const computeVehicleMarkerSizeTyped = computeVehicleMarkerSize as ComputeVehicleMarkerSize

export type VehicleRenderState = NonNullable<ReturnType<typeof projectVehicleState>> & {
  vehicle: VehiclePlaybackTrack
  gunMarks: number | null
  reloadShells: unknown
  consumables: unknown
}
type ProjectedVehicleState = VehicleRenderState


export function usePlaybackVehicleProjection(
  mapView: Ref<PlaybackMapViewLike>,
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
    playbackV2: () => BattlePlaybackDataset | null
    recorderAccountId: () => number | null
    currentTime: Ref<number>
    speed: Ref<number>
    authoritativeEvents: () => BattleEvent[]
    hpVehicles: () => VehiclePlaybackTrack[]
    gunMarks: () => Map<number, number> | null
    isMobileDevice: Ref<boolean>
    trailPrefs: { showTrail: boolean }
    t: (key: string) => string
  },
) {
  const preload = ref({ phase: 'idle', resolved: new Map(), failed: new Set(), failureReasons: new Map(), byTank: new Map() })
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
        const result = await preloadBattleModels(vehicles.map(v => v.tankId))
        if (token !== preloadToken) return
        preload.value = { phase: 'ready', ...result }
      } catch {
        console.error('[vehicle-models] fallback reason=MODULE_IMPORT_FAILURE')
        if (token !== preloadToken) return
        const failureReasons = new Map((vehicles || []).map(v => [String(v.tankId), 'MODULE_IMPORT_FAILURE']))
        preload.value = { phase: 'ready', resolved: new Map(), failed: new Set(), failureReasons, byTank: new Map() }
      }
    },
    { immediate: true },
  )

  function vehicleModel(vehicle: VehiclePlaybackTrack) {
    const p = preload.value
    if (p.phase !== 'ready') return null
    const modelKey = p.byTank.get(String(vehicle.tankId))
    if (!modelKey || p.failed.has(modelKey)) return null
    return p.resolved.get(modelKey) || null
  }

  function markerLeft(x: number) {
    return `${((mapView.value.toX(x)) / mapView.value.W) * 100}%`
  }

  function markerTop(y: number) {
    return `${((mapView.value.toY(y)) / mapView.value.H) * 100}%`
  }

  const baseVehicleStates = computed(() => {
    if (preload.value.phase !== 'ready') return []
    const tracks = deps.playbackV2()?.vehicles || []
    if (tracks.length === 0) return []
    return tracks
      .map((track: VehiclePlaybackTrack): ProjectedVehicleState | null => {
        const vehicle = track
        const model = vehicleModel(track)
        const mobile = deps.isMobileDevice.value
            const markerSize = computeVehicleMarkerSizeTyped(vehicle, {
          model,
          mapView: mapView.value,
          mapWidthPx: camera.mapWidth(),
          mapHeightPx: camera.mapHeight(),
          mobile,
        })
            const state = projectVehicleState({
          vehicle,
          track,
          time: deps.currentTime.value,
          pose: replayData.poseAtTime(track, deps.currentTime.value),
          recorderAccountId: deps.recorderAccountId(),
          model,
          markerSize,
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
        return { ...state, vehicle, gunMarks: deps.gunMarks()?.get(track.accountId) ?? null, reloadShells: replayData.vehicleReloadAt(track.accountId, deps.currentTime.value), consumables: replayData.vehicleConsumablesAt(track, deps.currentTime.value) }
      })
      .filter((item): item is ProjectedVehicleState => item != null)
  })

  const vehicleStates = computed(() => baseVehicleStates.value.map((state: ProjectedVehicleState) => {
    const scale = camera.view.scale || 1
    if (!state.markerSize) return state
    return {
      ...state,
      markerStyle: {
        ...state.markerStyle,
        width: `${state.markerSize.renderBox.width}px`,
        height: `${state.markerSize.renderBox.height}px`,
        transform: `translate(-50%, -50%) scale(${scale})`,
        left: markerLeft(state.pos.x),
        top: markerTop(state.pos.y),
      },
    }
  }))

  const visibleTracers = computed(() => tracerLines(
    deps.authoritativeEvents(),
    replayData.routesByAccount.value,
    deps.currentTime.value,
    deps.speed.value,
    replayData.poseSource.value ? (route: RouteLike, t: number) => replayData.poseAtTime(route as VehiclePlaybackTrack, t) : null,
  ))

  function tracerColor(accountId: number) {
    const vehicle = replayData.vehiclesByAccount.value.get(accountId)
    return vehicle ? playbackTracerColor(vehicle.friendly) : playbackTracerColor(null)
  }

  const visibleTrails = computed(() => deps.trailPrefs.showTrail
    ? (replayData.poseSource.value
        ? recentPositionTrailsFromPose(
            deps.hpVehicles(),
            (vehicle: RouteLike, t: number) => replayData.poseAtTime(vehicle as VehiclePlaybackTrack, t),
            (vehicle: RouteLike, t: number) => positionCoveredAtV2(vehicle.positionSegments, t),
            deps.currentTime.value, 2)
        : recentPositionTrails(deps.hpVehicles(), deps.currentTime.value, 2))
    : [])

  const { projectedSemanticNorm: replayDataProjected } = replayData

  function canonicalMarkerScreen(st: ProjectedVehicleState) {
    const rect = camera.mapRenderRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return null
    const point = replayDataProjected(st.pos.x, st.pos.y)
    return {
      x: point.xNorm * rect.width * camera.view.scale + camera.view.tx,
      y: point.yNorm * rect.height * camera.view.scale + camera.view.ty,
    }
  }

  function markerScreen(st: ProjectedVehicleState) {
    return canonicalMarkerScreen(st)
  }

  function hpFor(vehicle: VehiclePlaybackTrack) {
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
  function hpDisplayNumText(hp: { current: number | null }) {
    return hp.current != null ? String(hp.current) : '—'
  }

  return {
    preload,
    vehicleModel,
    markerLeft,
    markerTop,
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
