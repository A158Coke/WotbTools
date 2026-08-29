// legacy overview.playback → V2 BattlePlaybackDataset 转换（测试辅助；让 legacy 数据语义仍能驱动 V2-only 组件）。
export function coveredAt(intervals, t) {
  return (intervals || []).some(iv => t >= iv.startSec - 1e-6 && t <= iv.endSec + 1e-6)
}

export function legacyPlaybackToV2Dataset(overview) {
  const playback = overview && overview.playback
  if (!playback) return { durationSec: 0, vehicles: [], events: [], shots: [], pointsSamples: [], limitations: [] }
  const pointsByAccount = new Map((overview.routes || []).map(r => [r.accountId, r.points || []]))
  const vehicles = (playback.vehicles || []).map(v => {
    const hpSamples = v.hpSamples || []
    const maxCap = hpSamples.reduce((m, s) => (s.hp > m ? s.hp : m), 0)
    const healthTransitions = hpSamples.map(s => ({
      timeSec: s.timeSec, currentHp: s.hp,
      knowledge: coveredAt(v.positionIntervals, s.timeSec) ? 'CURRENT' : 'LAST_KNOWN',
      displayCapacityHp: maxCap > 0 ? maxCap : null, source: 'EXACT_BATTLE_EVENT',
    }))
    const lifeTransitions = []
    if (v.deathSec != null) {
      lifeTransitions.push({ timeSec: v.deathSec, lifeState: 'DESTROYED', destroyedKnownAtSec: v.deathSec })
    }
    const pts = pointsByAccount.get(v.accountId) || []
    const posSegs = (v.positionIntervals || []).map(iv => {
      const inRange = pts.filter(p => p.timeSec >= iv.startSec - 1e-6 && p.timeSec <= iv.endSec + 1e-6)
      const samples = inRange.length > 0
        ? inRange.map(p => ({ timeSec: p.timeSec, x: p.x, y: p.y, knowledge: 'OBSERVED' }))
        : [{ timeSec: iv.startSec, x: 0, y: 0, knowledge: 'OBSERVED' }]
      return { knowledge: 'OBSERVED', startSec: iv.startSec, endSec: iv.endSec, samples }
    })
    const orientSegs = (v.directionSamples || []).length > 0 ? [{
      knowledge: 'CURRENT', startSec: (v.directionSamples[0] || {}).timeSec ?? 0,
      endSec: (v.directionSamples[v.directionSamples.length - 1] || {}).timeSec ?? 0,
      samples: v.directionSamples.map(s => ({ timeSec: s.timeSec, hullYawDeg: s.hullYawDeg, turretRelativeYawDeg: s.turretRelativeYawDeg })),
    }] : []
    return {
      accountId: v.accountId, playerName: v.playerName, tankId: v.tankId,
      tankName: v.tankName, tankClass: '', team: v.team, friendly: v.team === 1,
      loadout: null, positionSegments: posSegs, orientationSegments: orientSegs,
      healthTransitions, lifeTransitions, hpLosses: v.hpLosses || [],
      consumableTransitions: [], moduleCrewTransitions: [],
    }
  })
  const events = (playback.events || []).map(e => ({
    type: e.type, timeSec: e.timeSec, accountId: e.accountId ?? null,
    targetAccountId: e.targetAccountId ?? null, observedHpLoss: e.observedHpLoss ?? null,
  })).sort((a, b) => a.timeSec - b.timeSec)
  return { durationSec: playback.durationSec, vehicles, events,
    shots: [], pointsSamples: playback.pointsSamples || [], limitations: [] }
}
