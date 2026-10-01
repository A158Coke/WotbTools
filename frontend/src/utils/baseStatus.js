/**
 * 基地状态的唯一口径（2D 地图、3D 贴地标记、顶部基地状态条共用）。
 *
 * 输入统一成 canonical 形状 { baseId, ownerTeam, capturingTeam, captureProgress }：
 * - 2D 直接来自 Battle Playback V2 dataset 的基地状态；
 * - 3D 由 foldBaseTransitions 把 Agent 契约的 sparse 转换（snake_case）折叠到时刻 t。
 * 输出视图模型 { baseId, kind, owner, capturing, progress }：
 * - owner：'friendly' | 'enemy' | 'neutral'（友方队伍未知时一律 neutral，不猜阵营）；
 * - capturing：'friendly' | 'enemy' | null；
 * - progress：0–100 | null。争霸基地只有存在占领方时才给进度（离开基地后旧进度不再挂着）。
 * 单基地（攻防 / 遭遇战，baseId 'BASE'）协议不给 owner / capturing（恒为 null），
 * 一律中性，不据静态 scene 推断归属（docs/research/replay/assault-base-state.md）。
 */
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
    return { baseId, kind: 'assault', owner: 'neutral', capturing: null, progress: clampProgress(state?.captureProgress) }
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

/**
 * 3D：Agent 契约 supremacy_bases（base_id 0–3，按 clock 升序）折叠到时刻 t。
 * 返回按 A–D 排序的 canonical 状态；从未出现过的基地按无主处理。
 */
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

/** 3D：单基地进度（assault_bases 按 clock 升序）折叠到时刻 t；无广播 → null。 */
export function foldAssaultProgress(transitions, t) {
  let progress = null
  for (const tr of transitions || []) {
    if (tr.clock > t) break
    progress = tr.progress ?? null
  }
  return { baseId: ASSAULT_BASE_ID, ownerTeam: null, capturingTeam: null, captureProgress: progress }
}
