import type { PlaybackDirection, PlaybackPosition } from '../types/playback.js'
import type {
  ConsumableRuntimeResult,
  ConsumableTransition,
  BattleEvent,
  DamageLoss,
  DamageDealtSample,
  HealthAtResult,
  HealthTransition,
  LifeAtResult,
  LifeTransition,
  ModuleCrewResult,
  ModuleCrewTransition,
  OrientationKnowledge,
  OrientationSample,
  OrientationSegment,
  PositionSample,
  PositionSegment,
  VehiclePlaybackTrack,
} from '../types/playback-v2.js'

/**
 * Battle Playback V2（canonical sparse transition tracks）纯查询工具。
 *
 * 设计原则（见 docs/features/battle-playback-hp-authority.md 与 docs/architecture/battle-timeline.md）：
 * - 前端<b>不再</b>做 HP/AoI/death/loadout 业务推理 —— 只消费 canonical projection 已标注的
 *   knowledge / provenance / observation boundary；
 * - {@code displayCapacityHp} 是 presentation-only HP bar 量程（anti-future-leak），
 *   不是 canonical max HP；绝不用未来采样；
 * - loadout 是持久配置（离开 AoI 仍 KNOWN）；consumable runtime 在 hidden interval = UNKNOWN。
 */

/** 二分查找：最近一次 <= t 的 transition（列表按 timeSec 升序）。无 → null。 */
function lastAtOrBefore<T extends { timeSec: number }>(
  items: readonly T[] | null | undefined,
  t: number,
): T | null {
  if (!Array.isArray(items) || items.length === 0) return null
  let lo = 0
  let hi = items.length - 1
  let ans: T | null = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const item = items[mid]
    if (item.timeSec <= t + 1e-6) {
      ans = item
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

/** 最近一次 <= t 的 canonical health fact。 */
export function healthAt(
  track: Pick<VehiclePlaybackTrack, 'healthTransitions'> | null | undefined,
  t: number,
): HealthAtResult | null {
  const tr = lastAtOrBefore(track?.healthTransitions, t)
  if (!tr || tr.knowledge == null
    || (tr.knowledge !== 'CURRENT' && tr.knowledge !== 'LAST_KNOWN')) return null
  if (tr.currentHp != null && (typeof tr.currentHp !== 'number' || !Number.isFinite(tr.currentHp))) return null
  if (tr.currentHp == null && tr.relativeFull !== true) return null
  return {
    currentHp: tr.currentHp,
    knowledge: tr.knowledge,
    source: tr.source ?? 'UNKNOWN',
    displayCapacityHp: tr.displayCapacityHp ?? null,
    relativeFull: tr.relativeFull === true,
    confidence: tr.confidence ?? 'UNKNOWN',
  }
}

/** 最近一次 <= t 的 life transition。 */
export function lifeAt(
  track: Pick<VehiclePlaybackTrack, 'lifeTransitions'> | null | undefined,
  t: number,
): LifeAtResult | null {
  const tr = lastAtOrBefore(track?.lifeTransitions, t)
  if (!tr || (tr.lifeState !== 'ALIVE' && tr.lifeState !== 'DESTROYED')) return null
  return {
    lifeState: tr.lifeState,
    destroyedKnownAtSec: tr.destroyedKnownAtSec ?? null,
  }
}

export type DefLifeState = {
  lifeState: 'ALIVE' | 'DESTROYED'
  destroyedKnownAtSec: number | null
}

type DefLifeFields = {
  death_t: number | null
  /** 上游 additive：仅该车死亡 ≥2 次（复活模式）才输出 */
  death_times?: number[]
  /** 上游 additive：仅非空才输出 */
  resurrection_times?: number[]
}

/**
 * def 层生命状态（PlaybackData 车辆字段直读；canonical 轨道缺位时的权威回退）。
 *
 * 消费上游复活轨道（issue #622，2026-10-15 additive）：复活字段缺省 = 死亡终态语义
 * （`t >= death_t → DESTROYED`，行为与既往逐位一致）；字段在场 = 死亡/复活交替，
 * 最后一次 ≤t 的事件决定状态（首死前 ALIVE）。纯 def 字段推导，不读 canonical。
 */
export function defLifeAt(def: DefLifeFields | null | undefined, t: number): DefLifeState | null {
  if (def == null || !Number.isFinite(t)) return null
  const death = def.death_t
  if (typeof death !== 'number' || !Number.isFinite(death)) return null
  const res = def.resurrection_times ?? []
  const deaths = def.death_times && def.death_times.length > 1 ? def.death_times : [death]
  if (deaths.length <= 1 && res.length === 0) {
    return { lifeState: t >= death ? 'DESTROYED' : 'ALIVE', destroyedKnownAtSec: death }
  }
  let state: 'ALIVE' | 'DESTROYED' = 'ALIVE'
  let destroyedAt: number | null = null
  let di = 0
  let ri = 0
  while (di < deaths.length || ri < res.length) {
    const nextDeath = di < deaths.length ? deaths[di] : Infinity
    const nextRes = ri < res.length ? res[ri] : Infinity
    if (nextDeath <= t && nextDeath <= nextRes) {
      state = 'DESTROYED'
      destroyedAt = nextDeath
      di += 1
    } else if (nextRes <= t) {
      state = 'ALIVE'
      destroyedAt = null
      ri += 1
    } else {
      break
    }
  }
  return { lifeState: state, destroyedKnownAtSec: destroyedAt }
}

/**
 * Canonical HP presentation for one track at t.
 *
 * `relativeFull` is a client-projection presentation-safe fact: it never
 * invents an actual current/max HP pair. A missing enemy fact remains UNKNOWN.
 */
export function healthDisplayAt(
  track: Pick<VehiclePlaybackTrack, 'healthTransitions' | 'lifeTransitions'> | null | undefined,
  t: number,
) {
  if (!track || !Number.isFinite(t)) return null
  const life = lifeAt(track, t)
  const health = healthAt(track, t)
  const destroyed = life?.lifeState === 'DESTROYED'
  if (destroyed) {
    const capacity = health?.displayCapacityHp ?? null
    return {
      currentHp: 0,
      displayCapacityHp: capacity,
      pct: capacity && capacity > 0 ? 0 : null,
      knowledge: 'CURRENT',
      source: 'DESTROYED',
      confidence: health?.confidence ?? 'UNKNOWN',
      destroyed: true,
      relativeFull: false,
      state: 'DESTROYED',
    }
  }

  if (health?.currentHp != null && Number.isFinite(health.currentHp)) {
    const rawCapacity = health.displayCapacityHp
    const capacity = typeof rawCapacity === 'number' && Number.isFinite(rawCapacity) && rawCapacity > 0
      ? rawCapacity
      : null
    const pct = capacity == null ? null : Math.max(0, Math.min(100, (health.currentHp / capacity) * 100))
    const relativeFull = health.relativeFull === true
    return {
      currentHp: health.currentHp,
      displayCapacityHp: capacity,
      pct,
      knowledge: health.knowledge,
      source: health.source,
      confidence: health.confidence,
      destroyed: false,
      relativeFull,
      state: relativeFull && capacity == null ? 'RELATIVE_FULL' : health.knowledge,
    }
  }

  const relativeFull = health?.relativeFull === true
  return {
    currentHp: null,
    displayCapacityHp: null,
    pct: null,
    knowledge: null,
    source: null,
    confidence: health?.confidence ?? 'UNKNOWN',
    destroyed: false,
    relativeFull,
    state: relativeFull ? 'RELATIVE_FULL' : 'UNKNOWN',
  }
}

/** Aggregate canonical health by the canonical friendly perspective. */
export function friendlyHealthAt(
  tracks: readonly VehiclePlaybackTrack[] | null | undefined,
  friendly: boolean,
  t: number,
) {
  const perspectiveTracks = (tracks || []).filter(track => track && track.friendly === friendly)
  return aggregateHealth(perspectiveTracks, t)
}

/**
 * Presentation scale is a sticky, already-disclosed fact: a later canonical HP transition with
 * displayCapacityHp=null means "this transition does not provide a new capacity", not "forget the
 * previously disclosed scale". This is deliberately separate from current HP authority so an
 * enemy switching from tankopedia provisional HP to replay HP cannot make the team bar jump to
 * PARTIAL/100%. A later positive replay capacity replaces the older scale naturally.
 */
function presentationCapacityAt(track, t) {
  let capacity = null
  for (const tr of track?.healthTransitions || []) {
    if (!tr || !Number.isFinite(tr.timeSec) || tr.timeSec > t + 1e-6) continue
    if (typeof tr.displayCapacityHp === 'number'
      && Number.isFinite(tr.displayCapacityHp) && tr.displayCapacityHp > 0) {
      capacity = tr.displayCapacityHp
    }
  }
  return capacity
}

function aggregateHealth(teamTracks, t) {
  if (teamTracks.length === 0) {
    return { totalMax: 0, knownRemaining: 0, unknownMax: 0, spawnFullCount: 0, openingFullCount: 0, state: 'UNKNOWN' }
  }

  const displays = teamTracks.map(track => healthDisplayAt(track, t))
  const capacities = teamTracks.map(track => presentationCapacityAt(track, t))
  const hasCompletePresentationScale = capacities.every(capacity => capacity != null && capacity > 0)
  const exact = displays.every(display => display
    && display.currentHp != null
    && display.displayCapacityHp != null
    && display.displayCapacityHp > 0
    && (display.knowledge === 'CURRENT' || display.destroyed))
  const allRelativeFull = displays.every(display => display
    && display.relativeFull === true && display.destroyed !== true)
  const knownRemaining = displays.reduce((sum, display) =>
    sum + (display?.currentHp != null && Number.isFinite(display.currentHp) ? display.currentHp : 0), 0)
  // Keep a stable presentation denominator when every member has already disclosed one. A null
  // capacity on the latest replay HP transition does not erase the older scale and therefore cannot
  // turn a real 80% bar into a fake 100% PARTIAL bar. This never fabricates capacity from currentHp.
  const totalMax = hasCompletePresentationScale
    ? capacities.reduce((sum, capacity) => sum + capacity, 0)
    : 0
  const hasKnownEvidence = displays.some(display => display && (
    display.currentHp != null || display.destroyed || display.knowledge === 'LAST_KNOWN'))
  let state = 'UNKNOWN'
  if (exact) {
    state = 'EXACT'
  } else if (allRelativeFull) {
    state = 'FULL_RELATIVE'
  } else if (hasKnownEvidence) {
    state = 'PARTIAL'
  }
  const relativeCount = displays.filter(display => display?.relativeFull === true).length
  return {
    totalMax,
    knownRemaining,
    unknownMax: 0,
    spawnFullCount: relativeCount,
    openingFullCount: relativeCount,
    state,
  }
}

/** Recorded totals are authoritative where available; victim attribution still supplies received damage. */
/**
 * 承受伤害 = HP 条（healthTransitions）上可信读数在 t 之前的累计下降——与详情里「当前 HP」同源。
 * canonical DamageLoss 按 Java 口径只用相邻 prop3 采样，会漏掉车辆点亮 / 重新进入视野时 materialization
 * 读数参与的那段掉血（HP 条已经掉了、承受伤害却没算）。车辆库 provisional 开局种子不是观测值，不作下降起点；
 * 无效读数（null）不打断链条：跨失效边界的下降仍按前后两个可信读数计算。
 */
function receivedFromHealthAt(transitions: readonly HealthTransition[] | null | undefined, t: number): number {
  let received = 0
  let last: number | null = null
  for (const h of transitions || []) {
    if (!h || !Number.isFinite(h.timeSec) || h.timeSec > t + 1e-6) break
    if (typeof h.currentHp !== 'number' || !Number.isFinite(h.currentHp)) continue
    if (last !== null && h.currentHp < last) received += last - h.currentHp
    last = h.source === 'TANKOPEDIA_BASE_PROVISIONAL' ? null : h.currentHp
  }
  return received
}

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
  events: readonly BattleEvent[] | null | undefined,
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

/** V2 feedback anchor check: the canonical position segment must cover event time. */
export function victimFeedbackAllowedV2(
  track: Pick<VehiclePlaybackTrack, 'positionSegments'> | null | undefined,
  eventTimeSec: number,
) {
  return Number.isFinite(eventTimeSec) && positionCoveredAtV2(track?.positionSegments, eventTimeSec)
}

/** Lost-HP ghost percentages from client-projected canonical facts. */
export function ghostAroundV2(
  loss: Pick<DamageLoss, 'fromHp' | 'toHp' | 'displayCapacityHp'> | null | undefined,
) {
  if (!loss || typeof loss.fromHp !== 'number' || !Number.isFinite(loss.fromHp)
    || typeof loss.toHp !== 'number' || !Number.isFinite(loss.toHp)
    || typeof loss.displayCapacityHp !== 'number' || !Number.isFinite(loss.displayCapacityHp)
    || loss.displayCapacityHp <= 0 || loss.fromHp < loss.toHp) return null
  return {
    prevPct: (loss.fromHp / loss.displayCapacityHp) * 100,
    nextPct: (loss.toHp / loss.displayCapacityHp) * 100,
  }
}

/** t 是否落在任一 OBSERVED position segment 内（AoI boundary，非 5s 规则）。 */
export function positionCoveredAtV2(
  segments: readonly PositionSegment[] | null | undefined,
  t: number,
): boolean {
  if (!Array.isArray(segments)) return false
  return segments.some(s => s.knowledge === 'OBSERVED'
    && t >= s.startSec - 1e-6 && t <= s.endSec + 1e-6)
}

/**
 * 位姿渲染的**采样时刻**（battle-relative 秒）：观测区间内 = t 本身；失察区间内 = 该时刻之前
 * 最后一个 OBSERVED 段的结束时刻（即"停在最后观测点"，**不跟随**滤波器在失察区的预测延续）。
 *
 * 2026-10-16 用户裁定：2D 图标在车辆离开视野后必须停在原地（3D 里该车模型直接不显示，两者语义
 * 一致）。从未被观测（t 之前没有 OBSERVED 段）→ null（调用方不显示该标记）。
 *
 * 只返回时刻，取值由调用方（位姿通道 / canonical 观测）决定——本函数不碰任何位姿数据。
 */
export function observedFreezeTimeAt(
  segments: readonly PositionSegment[] | null | undefined,
  t: number,
): number | null {
  if (!Array.isArray(segments) || segments.length === 0 || !Number.isFinite(t)) return null
  let freeze: number | null = null
  for (const s of segments) {
    if (!s || s.knowledge !== 'OBSERVED' || !Number.isFinite(s.startSec)) continue
    if (s.startSec > t + 1e-6) break
    const end = Number.isFinite(s.endSec) ? s.endSec : s.startSec
    if (t <= end + 1e-6) return t              // 区间内：正常采样
    freeze = Math.max(freeze ?? Number.NEGATIVE_INFINITY, end)
  }
  return freeze
}

/**
 * V2 位置解析：t 落在 OBSERVED segment 内 → 段内插值（后端允许的边界内）；
 * 落在 UNKNOWN_AOI gap / 段外 → 最后已知位置（LAST_KNOWN，绝不跨 gap 插值/连真实轨迹）。
 * 语义 = canonical AoI boundary，不是 5 秒 packet-gap 规则。
 */
export function positionAtV2(
  positionSegments: readonly PositionSegment[] | null | undefined,
  t: number,
): PlaybackPosition | null {
  if (!Array.isArray(positionSegments) || positionSegments.length === 0 || !Number.isFinite(t)) return null
  let lastSeen: PositionSample | null = null
  for (const seg of positionSegments) {
    // anti-future-leak：整个 segment 在 t 之后 → 对当前查询完全不可见（不得取该段任何样本）。
    if (seg.startSec > t + 1e-6) continue
    const samples = seg.samples || []
    if (samples.length === 0) continue
    if (seg.knowledge === 'OBSERVED' && seg.interpolationAllowed !== false) {
      // 段内插值
      const lo = samples[0]
      const hi = samples[samples.length - 1]
      if (t >= lo.timeSec - 1e-6 && t <= hi.timeSec + 1e-6) {
        // 命中首个样本点 / 单样本段（插值循环只处理 i>=1，需显式返回 lo）。
        if (lo.timeSec >= t - 1e-6) return { x: lo.x, y: lo.y, timeSec: lo.timeSec }
        let p = samples[0]
        for (let i = 1; i < samples.length; i++) {
          const n = samples[i]
          if (t <= n.timeSec + 1e-6) {
            if (t >= n.timeSec - 1e-6) return { x: n.x, y: n.y, timeSec: n.timeSec }
            const gap = n.timeSec - p.timeSec
            if (gap <= 0) return { x: p.x, y: p.y, timeSec: p.timeSec }
            const ratio = Math.min(1, Math.max(0, (t - p.timeSec) / gap))
            return {
              x: p.x + (n.x - p.x) * ratio,
              y: p.y + (n.y - p.y) * ratio,
              timeSec: t,
            }
          }
          p = n
        }
      }
      // 记录本段最后样本，供段外 last-known 兜底（按时间序；只接受 <= t 的样本，防未来泄漏）
      if (t > hi.timeSec + 1e-6 && hi.timeSec <= t + 1e-6
          && (lastSeen == null || hi.timeSec > lastSeen.timeSec)) {
        lastSeen = hi
      }
    } else {
      // LAST_KNOWN 段：整段即最后已知范围，冻结在「最后一个 <= t」的样本。
      // 绝不能因为段标记为 LAST_KNOWN 就取未来样本（anti-future-leak）。
      let cand: PositionSample | null = null
      for (const s of samples) {
        if (s.timeSec <= t + 1e-6 && (cand == null || s.timeSec > cand.timeSec)) cand = s
      }
      if (cand && (lastSeen == null || cand.timeSec > lastSeen.timeSec)) lastSeen = cand
    }
  }
  return lastSeen ? { x: lastSeen.x, y: lastSeen.y, timeSec: lastSeen.timeSec } : null
}

/**
 * t 时刻方向知识（canonical projection 已切 CURRENT/LAST_KNOWN；不存在 → UNKNOWN）。
 * LAST_KNOWN 表示敌方离开 AoI，前端<b>不得</b>把它当实时炮塔方向。
 */
export function orientationKnownAt(
  track: Pick<VehiclePlaybackTrack, 'orientationSegments'> | null | undefined,
  t: number,
): OrientationKnowledge | 'UNKNOWN' {
  if (!Array.isArray(track?.orientationSegments) || track.orientationSegments.length === 0) {
    return 'UNKNOWN'
  }
  // 找到覆盖 t 的段；若 t 落在最后观测段之后 → 离开 AoI → LAST_KNOWN。
  let lastSeen: OrientationSegment | null = null
  for (const seg of track.orientationSegments) {
    if (t >= seg.startSec - 1e-6 && t <= seg.endSec + 1e-6) {
      return seg.knowledge === 'CURRENT' || seg.knowledge === 'LAST_KNOWN'
        ? seg.knowledge : 'UNKNOWN'
    }
    if (seg.startSec <= t) {
      lastSeen = seg
    }
  }
  return (lastSeen && t > lastSeen.endSec + 1e-6) ? 'LAST_KNOWN' : 'UNKNOWN'
}

/** V2 方向插值：在 orientationSegments 内按最短圆弧插值 hull/turret（CURRENT 段）；
 * LAST_KNOWN/段外 → 最后结束样本（冻结，不插值实时方向）。 */
export function orientationAtV2(
  orientationSegments: readonly OrientationSegment[] | null | undefined,
  t: number,
): PlaybackDirection | null {
  if (!Array.isArray(orientationSegments) || orientationSegments.length === 0 || !Number.isFinite(t)) return null
  let lastSeen: OrientationSample | null = null
  for (const seg of orientationSegments) {
    // anti-future-leak：整个 segment 在 t 之后 → 对当前查询完全不可见。
    if (seg.startSec > t + 1e-6) continue
    const samples = seg.samples || []
    if (samples.length === 0) continue
    const lo = samples[0]
    const hi = samples[samples.length - 1]
    if (t >= lo.timeSec - 1e-6 && t <= hi.timeSec + 1e-6) {
      if (seg.knowledge !== 'CURRENT' && seg.knowledge !== 'LAST_KNOWN') continue
      if (seg.knowledge === 'LAST_KNOWN') {
        // LAST_KNOWN 段：冻结在「最后一个 <= t」的样本（绝不返回未来方向）。
        let cand: OrientationSample | null = null
        for (const s of samples) {
          if (s.timeSec <= t + 1e-6 && (cand == null || s.timeSec > cand.timeSec)) cand = s
        }
        if (cand) {
          return { hullYawDeg: cand.hullYawDeg, turretRelativeYawDeg: cand.turretRelativeYawDeg, timeSec: cand.timeSec }
        }
      }
      // 命中首个样本点 / 单样本段
      if (lo.timeSec >= t - 1e-6) {
        return { hullYawDeg: lo.hullYawDeg, turretRelativeYawDeg: lo.turretRelativeYawDeg, timeSec: lo.timeSec }
      }
      let p = samples[0]
      for (let i = 1; i < samples.length; i++) {
        const n = samples[i]
        if (t <= n.timeSec + 1e-6) {
          if (t >= n.timeSec - 1e-6) {
            return { hullYawDeg: n.hullYawDeg, turretRelativeYawDeg: n.turretRelativeYawDeg, timeSec: n.timeSec }
          }
          const gap = n.timeSec - p.timeSec
          if (gap <= 0) return { hullYawDeg: p.hullYawDeg, turretRelativeYawDeg: p.turretRelativeYawDeg, timeSec: p.timeSec }
          const ratio = Math.min(1, Math.max(0, (t - p.timeSec) / gap))
          const norm = (a: number) => ((a + 180) % 360 + 360) % 360 - 180
          const shortest = (a: number, b: number) => norm(a - b)
          const interpolate = (previous: number | null, next: number | null) => {
            if (typeof previous !== 'number' || !Number.isFinite(previous)
              || typeof next !== 'number' || !Number.isFinite(next)) return null
            return norm(previous + shortest(next, previous) * ratio)
          }
          return {
            hullYawDeg: interpolate(p.hullYawDeg, n.hullYawDeg),
            turretRelativeYawDeg: interpolate(p.turretRelativeYawDeg, n.turretRelativeYawDeg),
            timeSec: t,
          }
        }
        p = n
      }
    }
    if (t > hi.timeSec && hi.timeSec <= t + 1e-6
        && (lastSeen == null || hi.timeSec > lastSeen.timeSec)) lastSeen = hi
  }
  return lastSeen
    ? { hullYawDeg: lastSeen.hullYawDeg, turretRelativeYawDeg: lastSeen.turretRelativeYawDeg, timeSec: lastSeen.timeSec }
    : null
}

/** Current runtime state keyed by canonical consumable slot, not array position or wire code. */
export function consumableRuntimeSlotsAt(
  transitions: readonly ConsumableTransition[] | null | undefined,
  t: number,
): Map<number, ConsumableRuntimeResult> {
  const states = new Map<number, ConsumableRuntimeResult>()
  for (const tr of transitions || []) {
    if (!tr || !Number.isFinite(tr.timeSec) || tr.timeSec > t + 1e-6) continue
    if (tr.invalidation === true) {
      states.clear()
      continue
    }
    if (tr.consumableSlot === null || tr.consumableSlot === undefined
      || typeof tr.state !== 'string') continue
    states.set(tr.consumableSlot, {
      state: tr.state,
      logicalItemId: tr.logicalItemId ?? null,
      wireCode: tr.wireCode ?? null,
    })
  }
  return states
}

/** Current recorder-visible state per module/crew component. */
export function moduleCrewStatesAt(
  transitions: readonly ModuleCrewTransition[] | null | undefined,
  t: number,
): ModuleCrewResult[] {
  if (!Array.isArray(transitions)) return []
  const byComponent = new Map<string, ModuleCrewResult>()
  for (const tr of transitions) {
    if (!tr || !Number.isFinite(tr.timeSec) || tr.timeSec > t + 1e-6) continue
    if (!tr.component) continue
    if (tr.state == null) {
      byComponent.delete(tr.component)
      continue
    }
    byComponent.set(tr.component, {
      component: tr.component,
      state: tr.state,
      recorderVisible: tr.recorderVisible,
      confidence: tr.confidence ?? 'UNKNOWN',
    })
  }
  return [...byComponent.values()].sort((a, b) => a.component.localeCompare(b.component))
}
