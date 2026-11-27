
import type { AiHpStateField } from '../../api/agent-replay-facets.js'

export type HpRawState =
  | 'CURRENT_HP'
  | 'HP_ZERO_TERMINAL'
  | 'DEATH_TERMINAL_FFFD'
  | 'DEATH_TERMINAL'
  | 'UNKNOWN_FFFF'
  | 'UNKNOWN_OTHER'

export function classifyHpRaw(rawValue: number, hpState?: AiHpStateField | null): HpRawState {
  if (hpState === 'current') return 'CURRENT_HP'
  if (hpState === 'zero') return 'HP_ZERO_TERMINAL'
  if (hpState === 'terminal') return 'DEATH_TERMINAL'
  const raw = rawValue & 0xffff
  if (raw === 0x0000) return 'HP_ZERO_TERMINAL'
  if (raw === 0xfffd) return 'DEATH_TERMINAL_FFFD'
  if (raw === 0xffff) return 'UNKNOWN_FFFF'
  if (raw === 0xfffe) return 'UNKNOWN_OTHER'
  return toSignedShort(raw) > 0 ? 'CURRENT_HP' : 'UNKNOWN_OTHER'
}

export function isTerminalHpState(state: HpRawState): boolean {
  return state === 'HP_ZERO_TERMINAL' || state === 'DEATH_TERMINAL_FFFD' || state === 'DEATH_TERMINAL'
}

export function isPlausibleHp(hp: number | null | undefined): hp is number {
  return typeof hp === 'number' && hp > 0 && hp < 0xff00
}

export function knownHpOf(rawValue: number, hpState?: AiHpStateField | null): number | null {
  const state = classifyHpRaw(rawValue, hpState)
  if (state === 'CURRENT_HP') return toSignedShort(rawValue & 0xffff)
  if (state === 'HP_ZERO_TERMINAL') return 0
  return null
}

function toSignedShort(raw: number): number {
  return raw >= 0x8000 ? raw - 0x10000 : raw
}

export type HealthCause = 'DIRECT' | 'FIRE' | 'RAMMING' | 'WORLD_OR_ENVIRONMENT' | 'DROWNING'

export function semanticCauseOf(causeFlag: number, sourceEid: number, victimEid: number): HealthCause | null {
  const external = sourceEid !== victimEid
  switch (causeFlag) {
    case 0: return 'DIRECT'
    case 1: return external ? 'FIRE' : null
    case 2: return external ? 'RAMMING' : null
    case 3: return external ? null : 'WORLD_OR_ENVIRONMENT'
    case 5: return external ? null : 'DROWNING'
    default: return null
  }
}
