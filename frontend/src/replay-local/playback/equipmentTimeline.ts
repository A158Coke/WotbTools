import type { AgentPlaybackFacet, AgentVehicleTrack } from '../../api/agent-replay-facets.js'
import type { ConsumableTransition, ModuleCrewTransition, PlaybackConfidence, VehicleBattleLoadout } from '../../types/playback-v2.js'
import { EPS, type CanonicalReplayFacts, type ReplayClock } from '../canonical/facts.js'
import { consumableItemId, consumableStateName, provisionItemId } from './itemCodes.js'


export function toLoadout(vehicles: AgentVehicleTrack[], replayVersion: string | null): VehicleBattleLoadout | null {
  const decoded = vehicles.find((x) => x.loadout
    && Array.isArray(x.loadout.consumables) && Array.isArray(x.loadout.provisions))
    ?.loadout
  if (decoded) {
    let unknown = false
    const consumables: Array<string | null> = []
    const consumableWireCodes: Array<number | null> = []
    const provisions: Array<string | null> = []
    const provisionWireCodes: Array<number | null> = []
    for (let i = 0; i < 3; i++) {
      const item = decoded.consumables[i]
      const wire = item?.wire_code ?? null
      const id = item?.logical_id ?? (wire !== null ? consumableItemId(wire) : null)
      if (id === null && wire !== null && wire !== 0) unknown = true
      consumables.push(id)
      consumableWireCodes.push(wire)
      const p = decoded.provisions[i]
      const pw = p?.wire_code ?? null
      const pid = p?.logical_id ?? (pw !== null ? provisionItemId(pw) : null)
      if (pid === null && pw !== null && pw !== 0) unknown = true
      provisions.push(pid)
      provisionWireCodes.push(pw)
    }
    const equipmentIds = Array.isArray(decoded.equipment) && decoded.equipment.length === 9
      ? decoded.equipment
      : [...(decoded.equipment_ids ?? []), ...Array(9).fill(0)].slice(0, 9)
    return {
      replayVersion,
      consumables,
      consumableWireCodes,
      provisions,
      provisionWireCodes,
      equipmentIds,
      confidence: unknown ? 'LOW' : 'HIGH',
    }
  }
  const v = vehicles.find((x) => Array.isArray(x.loadout_items) && x.loadout_items.length === 6
    && Array.isArray(x.equipment) && x.equipment.length === 9)
  if (!v) return null
  const items = v.loadout_items!
  let unknown = false
  const consumables: Array<string | null> = []
  const consumableWireCodes: Array<number | null> = []
  const provisions: Array<string | null> = []
  const provisionWireCodes: Array<number | null> = []
  items.forEach((item, i) => {
    const wire = item[0] ?? 0
    const id = i < 3 ? consumableItemId(wire) : provisionItemId(wire)
    if (id === null && wire !== 0) unknown = true
    if (i < 3) { consumables.push(id); consumableWireCodes.push(wire) } else { provisions.push(id); provisionWireCodes.push(wire) }
  })
  return {
    replayVersion,
    consumables,
    consumableWireCodes,
    provisions,
    provisionWireCodes,
    equipmentIds: v.equipment!.map((e) => e),
    confidence: unknown ? 'LOW' : 'HIGH',
  }
}

function consumableSlot(loadout: VehicleBattleLoadout | null, wire: number | null): number | null {
  if (!loadout || wire === null) return null
  let match: number | null = null
  for (let i = 0; i < loadout.consumableWireCodes.length; i++) {
    if (loadout.consumableWireCodes[i] === wire) {
      if (match !== null) return null
      match = i
    }
  }
  return match
}

export function consumableTransitions(
  pb: AgentPlaybackFacet, facts: CanonicalReplayFacts, entityIds: number[], clock: ReplayClock, loadout: VehicleBattleLoadout | null,
): ConsumableTransition[] {
  const eids = new Set(entityIds)
  const obs = (pb.consumables ?? [])
    .filter((c) => eids.has(c.eid))
    .map((c) => {
      const logicalItemId = c.logical_item_id ?? consumableItemId(c.wire_code)
      const state = c.state_name ?? consumableStateName(c.state)
      const durationSec = Number.isFinite(c.duration_s) ? Math.max(0, Number(c.duration_s)) : null
      const endsAt = Number.isFinite(c.ends_at) ? Number(c.ends_at) - clock.startRaw : null
      const everActivated = c.ever_activated === true
      const proven = logicalItemId !== null && state !== 'UNKNOWN'
      return {
        t: c.clock - clock.startRaw,
        eid: c.eid,
        wire: c.wire_code,
        slot: Number.isInteger(c.slot) ? Number(c.slot) : null,
        logicalItemId,
        state,
        durationSec,
        endsAt,
        everActivated,
        confidence: (proven ? 'HIGH' : 'LOW') as PlaybackConfidence,
      }
    })
    .sort((a, b) => a.t - b.t || a.eid - b.eid)
  const out: ConsumableTransition[] = []
  const seeds = new Map<string, typeof obs[number]>()
  for (const o of obs) {
    if (o.t < 0 && o.state === 'INITIALIZED') {
      const key = `${o.eid}:${o.wire}`
      const prev = seeds.get(key)
      if (!prev || o.t >= prev.t) seeds.set(key, o)
      continue
    }
    if (!Number.isFinite(o.t) || o.t < 0) continue
    const invalidation = o.state === 'UNKNOWN'
    out.push({
      timeSec: o.t,
      consumableSlot: invalidation ? null : (o.slot ?? consumableSlot(loadout, o.wire)),
      logicalItemId: invalidation ? null : o.logicalItemId,
      wireCode: invalidation ? null : o.wire,
      state: o.state,
      durationSec: invalidation ? null : o.durationSec,
      endsAt: invalidation ? null : o.endsAt,
      everActivated: invalidation ? false : o.everActivated,
      invalidation,
      confidence: o.confidence,
    })
  }
  for (const o of seeds.values()) {
    out.push({
      timeSec: 0,
      consumableSlot: o.slot ?? consumableSlot(loadout, o.wire),
      logicalItemId: o.logicalItemId,
      wireCode: o.wire,
      state: 'INITIALIZED',
      durationSec: null,
      endsAt: null,
      everActivated: false,
      invalidation: false,
      confidence: o.confidence,
    })
  }
  for (const id of entityIds) {
    for (const w of facts.observation.get(id) ?? []) {
      const absent = w.toSec
      if (absent === null || !Number.isFinite(absent) || absent < 0) continue
      const hadKnownBefore = obs.some((o) => o.t < absent - EPS && (o.logicalItemId !== null || o.state !== 'UNKNOWN'))
      if (hadKnownBefore) {
        out.push({
          timeSec: absent,
          consumableSlot: null,
          logicalItemId: null,
          wireCode: null,
          state: 'UNKNOWN',
          durationSec: null,
          endsAt: null,
          everActivated: false,
          invalidation: true,
          confidence: 'UNKNOWN',
        })
      }
    }
  }
  return out
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.timeSec - b.t.timeSec || (a.t.wireCode ?? -1) - (b.t.wireCode ?? -1) || a.i - b.i)
    .map(({ t }) => t)
}

const MODULE_COMPONENTS = new Set([
  'ENGINE', 'AMMO_RACK', 'FUEL_TANK', 'RIGHT_TRACK', 'LEFT_TRACK', 'GUN', 'TURRET_ROTATOR',
  'OBSERVATION_DEVICE', 'COMMANDER', 'DRIVER', 'GUNNER', 'LOADER', 'RADIOMAN', 'RADIO',
])

export function moduleCrewTransitions(
  pb: AgentPlaybackFacet, entityIds: number[], clock: ReplayClock, recorderVisible: boolean,
): ModuleCrewTransition[] {
  if (!recorderVisible) return []
  const eids = new Set(entityIds)
  const out: ModuleCrewTransition[] = []
  for (const m of pb.module_crew_states ?? []) {
    if (!eids.has(m.vehicle_eid)) continue
    const t = m.clock - clock.startRaw
    if (!Number.isFinite(t) || t < 0) continue
    const component = String(m.component ?? '').toUpperCase()
    if (!MODULE_COMPONENTS.has(component)) continue
    let state: string | null
    switch (String(m.state ?? '').toUpperCase()) {
      case 'FULL_REPAIRED_CLEAR':
      case 'CREW_HEALED': state = null; break
      case 'AUTO_REPAIRED_TO_DAMAGED': state = 'DAMAGED_DEGRADED'; break
      case 'DAMAGED_DEGRADED': state = 'DAMAGED_DEGRADED'; break
      case 'CRITICAL_DISABLED': state = 'CRITICAL_DISABLED'; break
      case 'CREW_SHELL_SHOCKED': state = 'CREW_SHELL_SHOCKED'; break
      default: continue
    }
    out.push({ timeSec: t, component, state, recorderVisible: true, confidence: 'HIGH' })
  }
  return out.sort((a, b) => a.timeSec - b.timeSec)
}
