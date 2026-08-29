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
 * V2 位置解析：t 落在 OBSERVED segment 内 → 段内插值（后端允许的边界内）；
 * 落在 UNKNOWN_AOI gap / 段外 → 最后已知位置（LAST_KNOWN，绝不跨 gap 插值/连真实轨迹）。
 * 语义 = canonical AoI boundary，不是 5 秒 packet-gap 规则。
 */
export function positionAtV2(positionSegments, t) {
  if (!Array.isArray(positionSegments) || positionSegments.length === 0 || !Number.isFinite(t)) return null
  let lastSeen = null
  for (const seg of positionSegments) {
    const samples = seg.samples || []
    if (samples.length === 0) continue
    if (seg.knowledge === 'OBSERVED') {
      // 段内插值
      const lo = samples[0]
      const hi = samples[samples.length - 1]
      if (t >= lo.timeSec - 1e-6 && t <= hi.timeSec + 1e-6) {
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
      // 记录本段最后样本，供段外 last-known 兜底（按时间序）
      if (t > hi.timeSec + 1e-6 && (lastSeen == null || hi.timeSec > lastSeen.timeSec)) {
        lastSeen = hi
      }
    } else {
      // LAST_KNOWN 段：整段即最后已知范围，取最后一个样本
      const last = samples[samples.length - 1]
      if (lastSeen == null || last.timeSec > lastSeen.timeSec) lastSeen = last
    }
  }
  return lastSeen ? { x: lastSeen.x, y: lastSeen.y, timeSec: lastSeen.timeSec } : null
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

/** V2 方向插值：在 orientationSegments 内按最短圆弧插值 hull/turret（CURRENT 段）；
 * LAST_KNOWN/段外 → 最后结束样本（冻结，不插值实时方向）。 */
export function orientationAtV2(orientationSegments, t) {
  if (!Array.isArray(orientationSegments) || orientationSegments.length === 0 || !Number.isFinite(t)) return null
  let lastSeen = null
  for (const seg of orientationSegments) {
    const samples = seg.samples || []
    if (samples.length === 0) continue
    const lo = samples[0]
    const hi = samples[samples.length - 1]
    if (t >= lo.timeSec - 1e-6 && t <= hi.timeSec + 1e-6) {
      if (seg.knowledge !== 'CURRENT') {
        // LAST_KNOWN 段：冻结在最后样本
        return { hullYawDeg: hi.hullYawDeg, turretRelativeYawDeg: hi.turretRelativeYawDeg, timeSec: hi.timeSec }
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
          const norm = (a) => ((a + 180) % 360 + 360) % 360 - 180
          const shortest = (a, b) => norm(a - b)
          return {
            hullYawDeg: norm(p.hullYawDeg + shortest(n.hullYawDeg, p.hullYawDeg) * ratio),
            turretRelativeYawDeg: norm(p.turretRelativeYawDeg + shortest(n.turretRelativeYawDeg, p.turretRelativeYawDeg) * ratio),
            timeSec: t,
          }
        }
        p = n
      }
    }
    if (t > hi.timeSec && (lastSeen == null || hi.timeSec > lastSeen.timeSec)) lastSeen = hi
  }
  return lastSeen
    ? { hullYawDeg: lastSeen.hullYawDeg, turretRelativeYawDeg: lastSeen.turretRelativeYawDeg, timeSec: lastSeen.timeSec }
    : null
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

/**
 * 从 canonical healthTransitions 推导每辆车到 t 的 HP losses（相邻 transition 的 currentHp 下降）。
 * 用于累积统计 / 伤害日志（legacy vehicle.hpLosses 的 V2 等价），只消费 <= t 的 transition。
 * @returns [{ fromSec, toSec, hpLoss }]
 */
export function deriveHpLosses(healthTransitions, t) {
  if (!Array.isArray(healthTransitions) || healthTransitions.length === 0) return []
  const out = []
  let prev = null
  for (const tr of healthTransitions) {
    if (tr.timeSec > t + 1e-6) break
    if (prev != null && Number.isFinite(prev.currentHp) && Number.isFinite(tr.currentHp)
        && tr.currentHp < prev.currentHp) {
      out.push({ fromSec: prev.timeSec, toSec: tr.timeSec, hpLoss: prev.currentHp - tr.currentHp })
    }
    prev = tr
  }
  return out
}

/**
 * V2 canonical vehicle view：把 VehiclePlaybackTrack 规范化为与既有
 * vehicleHpAt/teamHp/cumulativeStatsAt/damageLogAt/hpDisplay 兼容的对象
 * （携带 healthTransitions/lifeTransitions/team/accountId/deathSec/hpLosses）。
 */
export function v2VehicleView(track) {
  if (!track) return null
  const lt = track.lifeTransitions || []
  const lastLife = lt[lt.length - 1] || null
  return {
    accountId: track.accountId,
    playerName: track.playerName || '',
    tankId: track.tankId,
    tankName: track.tankName || '',
    team: track.team,
    tankType: track.tankClass || '',
    healthTransitions: track.healthTransitions || [],
    lifeTransitions: lt,
    deathSec: lastLife && lastLife.lifeState === 'DESTROYED' ? lastLife.destroyedKnownAtSec : null,
    hpLosses: deriveHpLosses(track.healthTransitions, Number.POSITIVE_INFINITY),
    positionSegments: track.positionSegments || [],
    orientationSegments: track.orientationSegments || [],
    loadout: track.loadout || null,
  }
}
