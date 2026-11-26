
import type { AgentShotReplay, AgentShellTable } from './shotTypes.js'
import { isObject } from './validation.js'
import { wasmFn } from './wasm.js'

function assertShotArray(v: unknown): AgentShotReplay[] {
  if (!Array.isArray(v)) throw new Error('agent shots: 顶层必须是 shots 数组')
  for (const s of v) {
    if (!isObject(s) || typeof s.index !== 'number') {
      throw new Error('agent shots: 每发必须是有数值 index 的对象')
    }
  }
  return v as AgentShotReplay[]
}


export interface AgentShotsOthersStats {
  total_launches: number
  skipped_no_endpoint: number
  skipped_no_target_state: number
  muzzle_fallback: number
}

export interface AgentShotsOutcome {
  shots: AgentShotReplay[]
  author_path: 'ok' | 'error'
  author_error?: string
  author_eid: number
  others?: AgentShotsOthersStats
  others_error?: string
}

const ZERO_OTHERS: AgentShotsOthersStats = {
  total_launches: 0,
  skipped_no_endpoint: 0,
  skipped_no_target_state: 0,
  muzzle_fallback: 0,
}

export function normalizeAgentShotsOutcome(v: unknown): AgentShotsOutcome {
  if (Array.isArray(v)) {
    return { shots: assertShotArray(v), author_path: 'ok', author_eid: 0, others: { ...ZERO_OTHERS } }
  }
  if (!isObject(v) || !Array.isArray(v.shots)) {
    throw new Error('agent shots: 顶层必须是 shots 数组或 {shots, ...} 包装对象')
  }
  if (v.author_path !== 'ok' && v.author_path !== 'error') {
    throw new Error('agent shots: author_path 必须是 "ok" | "error"')
  }
  const authorPath = v.author_path
  if (authorPath === 'error' && typeof v.author_error !== 'string') {
    throw new Error('agent shots: author_path="error" 必须携带 author_error')
  }
  const o = (isObject(v.others) ? v.others : {}) as Record<string, unknown>
  const num = (x: unknown) => (typeof x === 'number' && x >= 0 ? x : 0)
  if (v.others === undefined && v.others_error === undefined) {
    throw new Error('agent shots: others 与 others_error 必须有其一（上游 v0.4.20 互斥契约）')
  }
  return {
    shots: assertShotArray(v.shots),
    author_path: authorPath,
    ...(authorPath === 'error' ? { author_error: v.author_error as string } : {}),
    author_eid: typeof v.author_eid === 'number' ? v.author_eid : 0,
    ...(typeof v.others_error === 'string' ? { others_error: v.others_error } : {}),
    ...(v.others === undefined
      ? {}
      : {
          others: {
            total_launches: num(o.total_launches),
            skipped_no_endpoint: num(o.skipped_no_endpoint),
            skipped_no_target_state: num(o.skipped_no_target_state),
            muzzle_fallback: num(o.muzzle_fallback),
          },
        }),
  }
}

export function isShotHit(s: Pick<AgentShotReplay, 'target_eid'>): boolean {
  return s.target_eid != null
}

export function enrichShotsFromRoster(parsedShots: AgentShotReplay[], vehicles: Array<{ eid: number; nickname?: string; team?: number; tank_id?: number; is_author?: boolean }>): void {
  const byEid = new Map<number, { team?: number; tank_id?: number }>()
  for (const r of vehicles || []) {
    if (r && typeof r.eid === 'number') byEid.set(r.eid, r)
  }
  const authorTeamRaw = (vehicles || []).find((r) => r.is_author)?.team
  const authorTeam = authorTeamRaw === 1 || authorTeamRaw === 2 ? authorTeamRaw : undefined
  const knownSide = (t?: number): t is 1 | 2 => t === 1 || t === 2
  for (const s of parsedShots) {
    const target = s.target_eid != null ? byEid.get(s.target_eid) : undefined
    if (target?.tank_id) s.target_tank_id = target.tank_id
    const shooterEntry = byEid.get(s.shooter_eid)
    if (shooterEntry?.tank_id) {
      s.shooter_tank_id = shooterEntry.tank_id
    }
    if (authorTeam != null && knownSide(shooterEntry?.team)) {
      s.shooter_team = shooterEntry.team === authorTeam ? 'ally' : 'enemy'
    }
  }
}

export function normalizeAgentShotIndices(shots: AgentShotReplay[]): AgentShotReplay[] {
  const sorted = shots.slice().sort((a, b) => {
    const ta = a.time_s ?? a.fire_time ?? 0
    const tb = b.time_s ?? b.fire_time ?? 0
    return ta - tb
  })
  sorted.forEach((s, i) => {
    s.index = i + 1
  })
  return sorted
}

export async function parseAgentShotsFromBytes(
  bytes: Uint8Array,
  pitchLimits?: Record<string, unknown>,
  shellTable?: AgentShellTable,
): Promise<AgentShotsOutcome> {
  const parse = await wasmFn('parseShotReplays')
  const limitsJson = pitchLimits ? JSON.stringify(pitchLimits) : undefined
  const shellsJson = shellTable ? JSON.stringify(shellTable) : undefined
  const raw = parse(bytes, limitsJson, shellsJson)
  const outcome = normalizeAgentShotsOutcome(JSON.parse(raw) as unknown)
  outcome.shots = normalizeAgentShotIndices(outcome.shots)
  return outcome
}
