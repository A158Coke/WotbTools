
export type EntryHpSource = 'OBSERVED_EXACT' | 'BASE_FALLBACK' | 'UNKNOWN'

export interface PlayerResult {
  accountId: number
  team: number
  tankId: number
  nShots: number
  nHitsDealt: number
  nPenetrationsDealt: number
  damageDealt: number
  damageAssisted: number
  damageReceived: number
  nHitsReceived: number
  nPenetrationsReceived: number
  nEnemiesDamaged: number
  kills: number
  damageBlocked: number
  victoryPointsEarned: number
  victoryPointsSeized: number
  survived: boolean
  xp: number
  credits: number

  nickname: string
  clan: string
  prebattleGroupId: number | null
  rank: number | null
  gunMarks?: number | null

  tankName: string

  contribution: number | null
  kast: number | null
  impact: number | null
  observedMaxHp: number | null
  entryHpSource: EntryHpSource | null
  entryHp: number | null
  tankTier: number | string
  tankType: string
  tankNation: string
  alphaDamage: number | string

  deathTimeMillis: number

  settlementResultEntityId: number
  settlementLifeTimeSec: number
  settlementKillerResultEntityId: number | null
  settlementDeathReasonRaw: number | null
  killerAccountId: number | null

  survivalTimeSec: number

  raw: Record<string, unknown[]> | null
}

export interface Battle {
  arenaId: string
  winnerTeam: number | null
  arenaBonusType: number | null
  version: string
  mapName: string
  durationS: number | null
  startTime: number | null
  settlementStartTime: number | null
  settlementFinishReasonRaw: number | null
  settlementDurationSec: number | null
  recorder: string
  recorderVehicle: string
  clientVersion: string
  players: PlayerResult[]
  rosterComplete: boolean | null
}

export interface ParsedEntry {
  sourceIndex: number
  sourceName: string
  battle: Battle | null
  failureMessage: string | null
}

export interface PlayerVehicleUsage {
  tankId: number
  battles: number
}
