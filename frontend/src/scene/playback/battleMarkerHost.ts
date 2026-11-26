import type { Scene } from 'three'
import type { RuntimeVehicle, VehicleRuntimeHandle } from './vehicleRuntime.js'
import { tankNamesStatic } from '../replaySource.js'
import { createMarkerRuntime, type MarkerData, type MarkerRuntimeHandle } from './markerRuntime.js'

export interface BattleMarkerHostDeps {
  getScene: () => Scene
  mapWorld: { groundY(x: number, z: number): number; mapKey(): string | null }
  vehicles: VehicleRuntimeHandle
  visibleAt: (v: RuntimeVehicle, t: number) => boolean
  replacedAt: (eid: number, t: number) => boolean
  getT: () => number
  getData: () => MarkerData | null
  invalidate: () => void
}

export type BattleMarkerHost = MarkerRuntimeHandle & { buildMarkers(): void }

export function createBattleMarkerHost(deps: BattleMarkerHostDeps): BattleMarkerHost {
  const { mapWorld, vehicles } = deps
  const tankNames = new Map<number, string>()
  tankNamesStatic().then((m) => { for (const [id, name] of m) tankNames.set(id, name); }).catch(() => {})
  const runtime = createMarkerRuntime({
    getScene: deps.getScene,
    groundY: (x, z) => mapWorld.groundY(x, z),
    getVehiclePose: (eid, t, out) => {
      const v = vehicles.getVehicles().find((x) => x.def.eid === eid);
      if (!v || !v.group.visible) return false;
      vehicles.posAt(v, t, out);
      return true;
    },
    getPoseAt: (eid, t, out) => {
      const v = vehicles.getVehicles().find((x) => x.def.eid === eid);
      if (!v || !deps.visibleAt(v, t)) return false;
      vehicles.posAt(v, t, out);
      return true;
    },
    describeSource: (eid, accountId, t) => {
      const vs = vehicles.getVehicles();
      const exact = eid ? vs.find((x) => x.def.eid === eid) : undefined;
      if (exact) return exact.def;
      if (!accountId) return null;
      if (t == null) return vs.find((x) => x.def.account_id === accountId)?.def ?? null;
      return resolveActiveAccount(vs, accountId, t, deps.visibleAt, deps.replacedAt)?.def ?? null;
    },
    findByNickname: (nickname, t) => resolveActiveSender(vehicles.getVehicles(), deps.visibleAt, (x) => x.def.nickname, nickname, t ?? Number.NEGATIVE_INFINITY)?.def ?? null,
    tankNameOf: (tankId) => tankNames.get(tankId),
    getT: deps.getT,
    invalidate: deps.invalidate,
  })

  return { ...runtime, buildMarkers: () => runtime.buildSession(deps.getData(), mapWorld.mapKey()) }
}

export function resolveActiveAccount<V extends { def: { eid: number; account_id?: number | null } }>(
  vehicles: readonly V[],
  accountId: number,
  t: number,
  visibleAt: (v: V, t: number) => boolean,
  replacedAt: (eid: number, t: number) => boolean,
): V | null {
  const same = vehicles.filter((v) => v.def.account_id === accountId)
  if (same.length === 0) return null
  const active = same.filter((v) => !replacedAt(v.def.eid, t))
  const visible = active.filter((v) => visibleAt(v, t))
  return visible[0] ?? active[0] ?? null
}

export function resolveActiveSender<V>(
  vehicles: readonly V[],
  visibleAt: (vehicle: V, t: number) => boolean,
  nicknameOf: (vehicle: V) => string | undefined,
  nickname: string,
  t: number,
): V | null {
  return vehicles.filter((v) => nicknameOf(v) === nickname).find((v) => visibleAt(v, t)) ?? null
}
