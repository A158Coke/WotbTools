
export type BrandedString<Name extends string> = string & { readonly __brand: Name }
export type SourceId = BrandedString<'SourceId'>
export type ArenaId = BrandedString<'ArenaId'>

export function sourceId(value: string): SourceId {
  return value as SourceId
}

export type JsonObject = Record<string, unknown>

export interface ColumnDef {
  key: string
  num: boolean
}

export interface PlayerRow {
  cells: JsonObject
  team: number
  accountId: number
  vehicleId: number
}

export interface AggregateRow {
  cells: JsonObject
  team: number
  accountId: number
}

export interface Battle {
  arenaId: string | null
  mapName: string | null
  version: string | null
  durationS: number | null
  startTime: number | null
  winnerTeam: number | null
  draw?: boolean
  sourceId: SourceId
  sourceName: string | null
  players: PlayerRow[]
  league: JsonObject | null
}

export interface ReplayResult {
  battles: Battle[]
  aggregate: AggregateRow[]
  duplicates: string[][]
  failures: string[][]
  playerColumns: ColumnDef[]
  aggregateColumns: ColumnDef[]
  league: JsonObject | null
  leagueUnavailableCode: string | null
  leagueMode: boolean
}
