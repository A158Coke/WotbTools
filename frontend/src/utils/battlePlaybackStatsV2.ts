import type {
  BattleEvent,
  DamageDealtSample,
  VehiclePlaybackTrack,
} from '../types/playback-v2.js'
import { receivedFromHealthAt } from './battlePlaybackHealthInternals.js'

/**
 * 详情面板累计统计 / canonical 伤害日志的纯查询工具（自 battlePlaybackV2.ts 出仓，
 * 2026-11-21 结构拆分：代码与搬移前逐字一致，公共入口仍由 battlePlaybackV2 re-export）。
 */

// ---- 详情面板累计统计的惰性预聚合 ----
// cumulativeStatsAtV2 在 HUD 节流频率（~10Hz，详情面板打开时）逐 tick 调用，此前的
// 击杀计数全事件扫描 + dealt 兜底全 tracks×losses flatMap 是 O(事件+Σ损失)/tick 的
// 纯浪费。回放数据解析后不可变：按对象身份（events 数组 / track 对象）WeakMap 缓存。
// 等价性：Map 键用 SameValueZero，与 `===` 仅在 NaN 上不同——构建与查询都跳过 NaN
// 账号（=== 永不匹配 NaN），其余键值逐位一致。

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

/** 升序数组中 ≤ t 的元素个数（upper bound 二分）。 */
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

/** 每条 track 的"可靠归属对外损失"按攻击者分组的前缀和（toSec 升序）。 */
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
        // times 与 prefix（原始 hpLoss，reorder 后再前缀化）必须同序同步 push——
        // 漏 push prefix 会让多损失车辆在第二次查询起读 undefined → NaN
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

/** 前缀表在 ≤ t 处的累计和（无匹配/空表 → 0）。 */
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
  // A cumulative broadcast already includes the attributed hits. Never add the two sources.
  // 兜底走每 track 前缀和索引（等价于原全量 flatMap 过滤求和，见上方预聚合说明）
  const dealt = latestTotal?.total ?? (() => {
    if (typeof accountId !== 'number' || !Number.isFinite(accountId)) return 0
    let sum = 0
    for (const track of tracks || []) {
      sum += prefixSumAt(outLossesIndexFor(track)?.get(accountId), t + 1e-6)
    }
    return sum
  })()
  // 击杀计数走按账号索引的 KILL 时刻表（二分计数，等价于原全事件扫描）
  let kills = 0
  if (typeof accountId === 'number' && Number.isFinite(accountId)) {
    const times = killsIndexFor(events)?.get(accountId)
    if (times) kills = countAtMost(times, t + 1e-6)
  }
  return { dealt, received, kills }
}

/** Canonical damage log: incoming/outgoing rows are direct projections of DamageLoss facts. */
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
