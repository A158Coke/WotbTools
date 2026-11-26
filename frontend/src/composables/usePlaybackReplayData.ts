import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { createReloadStateResolver, magazineSizeForVehicle } from '../scene/reloadBar.js'
import { assetProvider } from '../scene/assetProvider.js'
import { consumableRuntimeAt } from '../utils/consumableRuntime.js'
import { observedFreezeTimeAt } from '../utils/battlePlaybackV2.js'
import { poseCoveredAt, selectActiveDef, sampleVehiclePoseGame } from '../replay-local/pose/vehiclePose.js'
import { activeTerrainRelief, projectTerrainPoint, unprojectTerrainPoint } from '../utils/terrainReliefProjection.js'
import type { BattlePlaybackDataset, PlaybackReloadTelemetry, VehiclePlaybackTrack } from '../types/playback-v2.js'
import type { PlaybackMapViewLike } from './usePlaybackCamera.js'
import type { PoseFacet, PoseFacetVehicle } from '../replay-local/pose/vehiclePose.js'

interface PoseSource {
  grid: { tStart: number; samples: number }
  offset: number
  defFor: (accountId: number, t: number) => PoseFacet['vehicles'][number] | null
}

export function usePlaybackReplayData(
  mapView: Ref<PlaybackMapViewLike>,
  deps: {
    playback: ComputedRef<BattlePlaybackDataset | null>
    playbackV2: () => BattlePlaybackDataset | null
    reloadTelemetry: () => PlaybackReloadTelemetry | null
    poseFacet: () => PoseFacet | null
    clockOffset: () => number | null
    mapCode: () => unknown
  },
) {
  const reloadStateAt = computed(() => createReloadStateResolver(deps.reloadTelemetry()))
  const reloadVehiclesByAccount = computed(() => {
    const byAccount = new Map<number, PlaybackReloadTelemetry['vehicles'][number] | null>()
    for (const vehicle of deps.reloadTelemetry()?.vehicles || []) {
      if (byAccount.has(vehicle.account_id)) byAccount.set(vehicle.account_id, null)
      else byAccount.set(vehicle.account_id, vehicle)
    }
    return byAccount
  })

  const tankConfigs = ref(new Map())
  let tankConfigsToken = 0
  watch(() => deps.reloadTelemetry(), async (telemetry) => {
    const token = ++tankConfigsToken
    tankConfigs.value = new Map()
    if (!telemetry || !assetProvider.configured()) return
    const ids = new Set<number>(telemetry.vehicles
      .filter(v => v.team === telemetry.friendlyTeam && v.tank_id > 0)
      .map(v => v.tank_id))
    const entries = await Promise.all([...ids].map(async (tid): Promise<[number, unknown]> => {
      try { return [tid, await assetProvider.json(`/tank/${tid}.json`)] }
      catch { return [tid, null] }
    }))
    if (token !== tankConfigsToken) return
    tankConfigs.value = new Map(entries)
  }, { immediate: true })

  function vehicleReloadAt(accountId: number, time: number) {
    const telemetry = deps.reloadTelemetry()
    const vehicle = reloadVehiclesByAccount.value.get(accountId)
    if (!telemetry || !vehicle) return null
    const size = magazineSizeForVehicle(vehicle, tankConfigs.value.get(vehicle.tank_id))
    return reloadStateAt.value(vehicle.eid, time + telemetry.timeOrigin, size)
  }

  function vehicleConsumablesAt(track: VehiclePlaybackTrack, time: number) {
    return consumableRuntimeAt(track?.consumableTransitions, time)
  }

  const routesByAccount = computed(() => {
    const map = new Map()
    for (const track of deps.playback.value?.vehicles || []) map.set(track.accountId, track)
    return map
  })

  const vehiclesByAccount = computed(() => {
    const map = new Map()
    for (const vehicle of (deps.playback.value ? deps.playback.value.vehicles : [])) {
      map.set(vehicle.accountId, vehicle)
    }
    return map
  })

  const poseSource = computed<PoseSource | null>(() => {
    const facet = deps.poseFacet()
    const offset = deps.clockOffset()
    if (!facet || offset == null || !Number.isFinite(offset)) return null
    const byAccount = new Map<number, PoseFacetVehicle[]>()
    for (const def of facet.vehicles || []) {
      const list = byAccount.get(def.account_id)
      if (list) list.push(def)
      else byAccount.set(def.account_id, [def])
    }
    return {
      grid: { tStart: Number(facet.tStart) || 0, samples: Number(facet.samples) || 0 },
      offset,
      defFor: (accountId: number, t: number) => selectActiveDef(
        byAccount.get(accountId) || [], facet.entityStartsByAccount?.get(accountId), t,
      ),
    }
  })
  const _poseScratch = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, turretAbs: 0, turretRel: 0, gunPitch: 0 }
  function poseAtTime(track: VehiclePlaybackTrack, t: number) {
    const source = poseSource.value
    if (!source) return null
    const freezeAt = observedFreezeTimeAt(track.positionSegments, t)
    if (freezeAt == null) return null
    const rawAt = freezeAt + source.offset
    const def = source.defFor(track.accountId, freezeAt)
    if (!def || !poseCoveredAt(def, rawAt)) return null
    const pose = sampleVehiclePoseGame(def, source.grid, rawAt, _poseScratch, def.visibility ?? def.coverage)
    return { x: pose.x, y: pose.z, yawRad: pose.yaw, turretRelRad: pose.turretRel }
  }

  function reliefModelForPlayback() {
    const model = activeTerrainRelief.value as { mapCode: string } | null
    return model && model.mapCode === String(deps.mapCode() || '') ? model : null
  }

  function projectedSemanticNorm(x: number, y: number) {
    const model = reliefModelForPlayback()
    if (model) {
      const point = projectTerrainPoint(model, Number(x), Number(y))
      if (point) return { xNorm: point.xNorm, yNorm: point.yNorm }
    }
    return {
      xNorm: mapView.value.toX(x) / mapView.value.W,
      yNorm: mapView.value.toY(y) / mapView.value.H,
    }
  }

  function reliefUnproject(xNorm: number, yNorm: number) {
    const model = reliefModelForPlayback()
    if (!model) return null
    return unprojectTerrainPoint(model, xNorm, yNorm)
  }

  return {
    tankConfigs,
    vehicleReloadAt,
    vehicleConsumablesAt,
    routesByAccount,
    vehiclesByAccount,
    poseSource,
    poseAtTime,
    reliefModelForPlayback,
    projectedSemanticNorm,
    reliefUnproject,
  }
}

export type PlaybackReplayData = ReturnType<typeof usePlaybackReplayData>
