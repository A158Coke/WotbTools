import type {
  BattleEvent,
  DamageDealtSample,
  VehiclePlaybackTrack,
} from '../types/playback-v2.js'
import { receivedFromHealthAt } from './battlePlaybackHealthInternals.js'



const killsIndexCache = new WeakMap<object, Map<PropertyKey, number[]>>()

function killsIndexFor(events: readonly BattleEvent[] | null | undefined) {
  if (!events || !Array.isArray(events)) return null
  let index = killsIndexCache.get(events)
  if (!index) {
    index = new Map()
    for (const event of events) {
      if (!event || event.type !== 'KILL' || !Number.isFinite(event.timeSec)) continue
      if (typeof event.accountId !== 'number' || !Number.isFinite(event.accountId)) continue
      const times = index.get(event.accountId)
      if (times) times.push(event.timeSec)
      else index.set(event.accountId, [event.timeSec])
    }
    for (const times of index.values()) times.sort((a, b) => a - b)
    killsIndexCache.set(events, index)
  }
  return index
}

function countAtMost(times: number[], t: number) {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

type OutLossPrefix = { times: number[]; prefix: number[] }
const outLossesCache = new WeakMap<object, Map<PropertyKey, OutLossPrefix>>()

function outLossesIndexFor(track: Pick<VehiclePlaybackTrack, 'accountId' | 'damageLosses'> | null | undefined) {
  if (!track) return null
  let index = outLossesCache.get(track)
  if (!index) {
    index = new Map()
    for (const loss of track?.damageLosses || []) {
      if (!loss || !Number.isFinite(loss.toSec) || loss.attackerReliable !== true
        || typeof loss.attackerAccountId !== 'number' || !Number.isFinite(loss.attackerAccountId)
        || !Number.isFinite(loss.hpLoss)) continue
      const list = index.get(loss.attackerAccountId)
      if (list) {
        list.times.push(loss.toSec)
        list.prefix.push(loss.hpLoss)
      } else {
        index.set(loss.attackerAccountId, { times: [loss.toSec], prefix: [loss.hpLoss] })
      }
    }
    for (const list of index.values()) {
      const order = list.times.map((toSec, i) => [toSec, i] as const)
        .sort((a, b) => a[0] - b[0])
      const times = order.map(([, i]) => list.times[i])
      const prefix: number[] = new Array(times.length)
      let sum = 0
      order.forEach(([, i], k) => {
        sum += list.prefix[i]
        prefix[k] = sum
      })
      list.times = times
      list.prefix = prefix
    }
    outLossesCache.set(track, index)
  }
  return index
}

function prefixSumAt(list: OutLossPrefix | undefined, t: number) {
  if (!list || list.times.length === 0) return 0
  const idx = countAtMost(list.times, t)
  return idx === 0 ? 0 : list.prefix[idx - 1]
}

export function cumulativeStatsAtV2(
  events: readonly BattleEvent[] | null | undefined,
  selectedTrack: Pick<VehiclePlaybackTrack, 'accountId' | 'damageLosses' | 'damageDealtSamples' | 'healthTransitions'> | null | undefined,
  t: number,
  tracks: readonly Pick<VehiclePlaybackTrack, 'accountId' | 'damageLosses'>[] | null | undefined = [],
) {
  if (!selectedTrack || !Number.isFinite(t)) return { dealt: 0, received: 0, kills: 0 }
  const accountId = selectedTrack.accountId
  const received = receivedFromHealthAt(selectedTrack.healthTransitions, t)
  const latestTotal = (selectedTrack.damageDealtSamples || [])
    .filter(sample => sample && Number.isFinite(sample.timeSec) && sample.timeSec >= 0 && sample.timeSec <= t + 1e-6
      && Number.isSafeInteger(sample.total) && sample.total >= 0)
    .reduce<DamageDealtSample | null>((latest, sample) => !latest || sample.timeSec > latest.timeSec
      || (sample.timeSec === latest.timeSec && sample.total > latest.total) ? sample : latest, null)
  const dealt = latestTotal?.total ?? (() => {
    if (typeof accountId !== 'number' || !Number.isFinite(accountId)) return 0
    let sum = 0
    for (const track of tracks || []) {
      sum += prefixSumAt(outLossesIndexFor(track)?.get(accountId), t + 1e-6)
    }
    return sum
  })()
  let kills = 0
  if (typeof accountId === 'number' && Number.isFinite(accountId)) {
    const times = killsIndexFor(events)?.get(accountId)
    if (times) kills = countAtMost(times, t + 1e-6)
  }
  return { dealt, received, kills }
}

export function damageLogAtV2(
  _events: readonly BattleEvent[] | null | undefined,
  selectedTrack: Pick<VehiclePlaybackTrack, 'accountId' | 'damageLosses'> | null | undefined,
  t: number,
  maxRows = 8,
  tracks: readonly Pick<VehiclePlaybackTrack, 'accountId' | 'damageLosses'>[] | null | undefined = [],
) {
  if (!selectedTrack || !Number.isFinite(t)) return []
  const selectedAccountId = selectedTrack.accountId
  const rows: Array<{
    timeSec: number
    dir: 'in' | 'out'
    hpLoss: number
    attackerAccountId?: number | null
    attackerReliable?: boolean
    victimAccountId?: number
  }> = []
  for (const loss of selectedTrack.damageLosses || []) {
    if (!loss || loss.toSec > t + 1e-6) continue
    rows.push({
      timeSec: loss.toSec,
      dir: 'in',
      hpLoss: loss.hpLoss,
      attackerAccountId: loss.attackerAccountId ?? null,
      attackerReliable: loss.attackerReliable === true,
    })
  }
  for (const track of tracks || []) {
    for (const loss of track?.damageLosses || []) {
      if (!loss || loss.toSec > t + 1e-6 || loss.attackerReliable !== true
          || loss.attackerAccountId !== selectedAccountId || track.accountId === selectedAccountId) continue
      rows.push({ timeSec: loss.toSec, dir: 'out', hpLoss: loss.hpLoss, victimAccountId: track.accountId })
    }
  }
  rows.sort((a, b) => a.timeSec - b.timeSec)
  const limit = Number.isFinite(maxRows) && maxRows > 0 ? Math.floor(maxRows) : 8
  return rows.slice(-limit)
}
