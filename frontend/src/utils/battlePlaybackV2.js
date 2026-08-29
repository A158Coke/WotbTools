/**
 * Battle Playback V2（canonical sparse transition tracks）纯查询工具。
 *
 * 设计原则（docs/current-plan.md / plan §18/§20/§23）：
 * - 前端<b>不再</b>做 HP/AoI/death/loadout 业务推理 —— 只消费 backend 已标注的
 *   knowledge / provenance / observation boundary；
 * - {@code displayCapacityHp} 是 presentation-only HP bar 量程（anti-future-leak），
 *   不是 canonical max HP；绝不用未来采样；
 * - loadout 是持久配置（离开 AoI 仍 KNOWN）；consumable runtime 在 hidden interval = UNKNOWN。
 */

/** 二分查找：最近一次 <= t 的 transition（列表按 timeSec 升序）。无 → null。 */
function lastAtOrBefore(items, t, key) {
  if (!Array.isArray(items) || items.length === 0) return null
  let lo = 0
  let hi = items.length - 1
  let ans = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (items[mid][key] <= t + 1e-6) {
      ans = items[mid]
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

/** 最近一次 <= t 的 health transition（含 knowledge / displayCapacityHp）。 */
export function healthAt(track, t) {
  const tr = lastAtOrBefore(track?.healthTransitions, t, 'timeSec')
  if (!tr) return null
  return {
    currentHp: tr.currentHp ?? null,
    knowledge: tr.knowledge ?? 'UNKNOWN',
    source: tr.source ?? 'UNKNOWN',
    displayCapacityHp: tr.displayCapacityHp ?? null,
    confidence: tr.confidence ?? 'UNKNOWN',
  }
}

/** 最近一次 <= t 的 life transition。 */
export function lifeAt(track, t) {
  const tr = lastAtOrBefore(track?.lifeTransitions, t, 'timeSec')
  if (!tr) return null
  return {
    lifeState: tr.lifeState ?? 'UNKNOWN',
    destroyedKnownAtSec: tr.destroyedKnownAtSec ?? null,
  }
}

/** t 是否落在任一 OBSERVED position segment 内（AoI boundary，非 5s 规则）。 */
export function positionCoveredAtV2(segments, t) {
  if (!Array.isArray(segments)) return false
  return segments.some(s => s.knowledge === 'OBSERVED'
    && t >= s.startSec - 1e-6 && t <= s.endSec + 1e-6)
}

/**
 * t 时刻方向知识（backend 已切 CURRENT/LAST_KNOWN；不存在 → UNKNOWN）。
 * LAST_KNOWN 表示敌方离开 AoI，前端<b>不得</b>把它当实时炮塔方向。
 */
export function orientationKnownAt(track, t) {
  if (!Array.isArray(track?.orientationSegments) || track.orientationSegments.length === 0) {
    return 'UNKNOWN'
  }
  // 找到覆盖 t 的段；若 t 落在最后观测段之后 → 离开 AoI → LAST_KNOWN。
  let lastSeen = null
  for (const seg of track.orientationSegments) {
    if (t >= seg.startSec - 1e-6 && t <= seg.endSec + 1e-6) {
      return seg.knowledge ?? 'UNKNOWN'
    }
    if (seg.startSec <= t) {
      lastSeen = seg
    }
  }
  return (lastSeen && t > lastSeen.endSec + 1e-6) ? 'LAST_KNOWN' : 'UNKNOWN'
}

/**
 * “在 t 时刻我们到底知道什么” —— Vehicle Inspector 的单一确定性视图
 * （plan §24 / §40）。返回纯事实 + knowledge/provenance，不猜测。
 */
export function inspectVehicleAt(track, t) {
  if (!track) return null
  const health = healthAt(track, t)
  const life = lifeAt(track, t)
  const loadoutKnown = Boolean(track.loadout) && track.loadout !== null
  return {
    identity: {
      accountId: track.accountId,
      playerName: track.playerName,
      tankId: track.tankId,
      tankName: track.tankName,
      tankClass: track.tankClass,
      team: track.team,
      friendly: track.friendly,
    },
    health,
    lifeState: life?.lifeState ?? 'UNKNOWN',
    destroyedKnownAtSec: life?.destroyedKnownAtSec ?? null,
    positionCovered: positionCoveredAtV2(track.positionSegments, t),
    orientationKnowledge: orientationKnownAt(track, t),
    // loadout 是持久配置：一旦 materialized combat vehicle 被观察，离开 AoI 仍 KNOWN。
    loadout: loadoutKnown ? track.loadout : null,
    loadoutKnown,
  }
}

/**
 * t 时刻 consumable runtime 状态。hidden interval（AoI 未观测）= UNKNOWN，
 * 绝不因“没看到 activation”显示 READY。返回 { logicalItemId, state, wireCode }。
 */
export function consumableRuntimeAt(transitions, t) {
  const tr = lastAtOrBefore(transitions, t, 'timeSec')
  if (!tr) return { state: 'UNKNOWN', logicalItemId: null, wireCode: null }
  return {
    state: tr.state ?? 'UNKNOWN',
    logicalItemId: tr.logicalItemId ?? null,
    wireCode: tr.wireCode ?? null,
  }
}

/** t 时刻 module/crew 状态（recorder-visible provenance）。 */
export function moduleCrewAt(transitions, t) {
  const tr = lastAtOrBefore(transitions, t, 'timeSec')
  if (!tr) return null
  return {
    component: tr.component,
    state: tr.state,
    recorderVisible: tr.recorderVisible,
    confidence: tr.confidence,
  }
}
