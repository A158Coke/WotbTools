export const ASSAULT_BASE_ID = 'BASE'
export const SUPREMACY_BASE_IDS = Object.freeze(['A', 'B', 'C', 'D'])

export function baseSide(team, friendlyTeam) {
  if ((team !== 1 && team !== 2) || (friendlyTeam !== 1 && friendlyTeam !== 2)) return 'neutral'
  return team === friendlyTeam ? 'friendly' : 'enemy'
}

function clampProgress(value) {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null
}

export function baseView(state, friendlyTeam) {
  const baseId = state?.baseId
  if (baseId === ASSAULT_BASE_ID) {
    const progress = clampProgress(state?.captureProgress)
    return {
      baseId,
      kind: 'assault',
      owner: 'neutral',
      capturing: null,
      progress: progress != null && progress > 0 ? progress : null,
    }
  }
  const capturingSide = state?.capturingTeam == null ? null : baseSide(state.capturingTeam, friendlyTeam)
  const capturing = capturingSide === 'neutral' ? null : capturingSide
  return {
    baseId,
    kind: 'supremacy',
    owner: baseSide(state?.ownerTeam ?? null, friendlyTeam),
    capturing,
    progress: state?.capturingTeam != null ? clampProgress(state.captureProgress) : null,
  }
}

export function foldSupremacyTransitions(transitions, t, baseIds = SUPREMACY_BASE_IDS) {
  const latest = new Map()
  for (const tr of transitions || []) {
    if (tr.clock > t) break
    latest.set(tr.base_id, tr)
  }
  return baseIds.map((baseId, index) => {
    const tr = latest.get(index)
    return {
      baseId,
      ownerTeam: tr?.owner_team ?? null,
      capturingTeam: tr?.capturing_team ?? null,
      captureProgress: tr?.capture_progress ?? null,
    }
  })
}

export function foldAssaultProgress(transitions, t) {
  let progress = null
  for (const tr of transitions || []) {
    if (tr.clock > t) break
    progress = tr.progress ?? null
  }
  return { baseId: ASSAULT_BASE_ID, ownerTeam: null, capturingTeam: null, captureProgress: progress }
}
