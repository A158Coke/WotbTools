import { lifeAt, defLifeAt } from '../../utils/battlePlaybackV2.js'
import { activeEntityAt } from '../../replay-local/canonical/facts.js'
import type { LocalPlayback } from '../../replay-local/playback/parseLocalPlayback.js'
import type { RuntimeVehicle } from './vehicleRuntimeTypes.js'
import type { VehiclePlaybackTrack } from '../../types/playback-v2.js'

export function createVehicleLife({ getCanonical, getVehicles }: {
  getCanonical: () => LocalPlayback | null | undefined
  getVehicles: () => RuntimeVehicle[]
}) {
  let lifeTracks: VehiclePlaybackTrack[] | null = null
  let lifeTracksByAccount = new Map<number, VehiclePlaybackTrack>()
  function canonicalLifeTrack(v: RuntimeVehicle, dataset: NonNullable<LocalPlayback['dataset']>) {
    const tracks = dataset.vehicles;
    if (tracks !== lifeTracks) {
      lifeTracks = tracks;
      lifeTracksByAccount = new Map(tracks.map(track => [track.accountId, track]));
    }
    return lifeTracksByAccount.get(v.def.account_id);
  }
  function canonicalDeathAppliesTo(v: RuntimeVehicle, rawDeath: number, canonical: LocalPlayback, startRaw: number) {
    const starts = canonical.entityStartsByAccount?.get(v.def.account_id);
    if (starts) return activeEntityAt(starts, rawDeath - startRaw) === v.def.eid;
    const siblings = getVehicles().filter(candidate => candidate.def.account_id === v.def.account_id);
    if (siblings.length === 1) return Number.isFinite(rawDeath);
    const legacyStarts = new Map(siblings.map(candidate => [candidate.def.eid, candidate.def.coverage?.[0] ?? null]));
    return activeEntityAt(legacyStarts, rawDeath) === v.def.eid;
  }
  function sceneLifeAt(v: RuntimeVehicle, t: number) {
    const canonical = getCanonical();
    const dataset = canonical?.dataset;
    const clock = canonical?.clock;
    if (canonical && dataset?.vehicles && clock && Number.isFinite(clock.startRaw)) {
      const track = canonicalLifeTrack(v, dataset);
      const life = lifeAt(track, t - clock.startRaw);
      if (!life) return null;
      const destroyedKnownAtSec = life.destroyedKnownAtSec;
      if (life.lifeState === 'DESTROYED') {
        const transition = track?.lifeTransitions.find(item => item.lifeState === 'DESTROYED');
        const death = (destroyedKnownAtSec ?? transition?.timeSec ?? NaN) + clock.startRaw;
        if (!canonicalDeathAppliesTo(v, death, canonical, clock.startRaw)) return null;
      }
      return {
        lifeState: life.lifeState,
        destroyedKnownAtSec: typeof destroyedKnownAtSec === 'number' && Number.isFinite(destroyedKnownAtSec)
          ? destroyedKnownAtSec + clock.startRaw : null,
      };
    }
    return defLifeAt(v.def, t);
  }
  function deathAt(v: RuntimeVehicle, t: number) { return sceneLifeAt(v, t)?.lifeState === 'DESTROYED'; }
  function deathTimesOf(v: RuntimeVehicle) {
    const canonical = getCanonical();
    const dataset = canonical?.dataset;
    const clock = canonical?.clock;
    const times = [];
    if (canonical && dataset?.vehicles && clock && Number.isFinite(clock.startRaw)) {
      const seenDeaths = new Set();
      for (const life of canonicalLifeTrack(v, dataset)?.lifeTransitions ?? []) {
        if (life.lifeState !== 'DESTROYED' || !Number.isFinite(life.timeSec)) continue;
        const destroyedKnownAtSec = life.destroyedKnownAtSec;
        const identityTime = (destroyedKnownAtSec ?? life.timeSec) + clock.startRaw;
        if (!canonicalDeathAppliesTo(v, identityTime, canonical, clock.startRaw)) continue;
        const key = typeof destroyedKnownAtSec === 'number' && Number.isFinite(destroyedKnownAtSec) ? destroyedKnownAtSec : life.timeSec;
        if (seenDeaths.has(key)) continue;
        seenDeaths.add(key);
        times.push(life.timeSec + clock.startRaw);
      }
    } else {
      const death = v.def.death_t;
      if (Number.isFinite(death)) {
        times.push(death);
        for (const d of v.def.death_times ?? []) {
          if (Number.isFinite(d) && d !== death) times.push(d);
        }
      }
    }
    return times;
  }

  function reset() { lifeTracks = null; lifeTracksByAccount.clear() }
  return { sceneLifeAt, deathAt, deathTimesOf, reset }
}
