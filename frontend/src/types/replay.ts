/** Replay API DTOs and opaque identifiers. Nested cell payloads remain JSON data. */

export type BrandedString<Name extends string> = string & { readonly __brand: Name }
export type ProcessingJobId = BrandedString<'ProcessingJobId'>
export type ExportJobId = BrandedString<'ExportJobId'>
export type SourceId = BrandedString<'SourceId'>
export type ArenaId = BrandedString<'ArenaId'>

export function processingJobId(value: string): ProcessingJobId {
  return value as ProcessingJobId
}

export function sourceId(value: string): SourceId {
  return value as SourceId
}

export function exportJobId(value: string): ExportJobId {
  return value as ExportJobId
}

export type JsonObject = Record<string, unknown>

export interface ColumnDef {
  key: string
  num: boolean
}

/** 单场玩家行。B6：accountId/vehicleId 是结构性身份，不在 cells 里。 */
export interface PlayerRow {
  cells: JsonObject
  team: number
  accountId: number
  vehicleId: number
}

/** 汇总行。B6：accountId 是结构性身份，不在 cells 里。 */
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

export interface ReplayDatasetRef {
  processingJobId: ProcessingJobId
  sourceId: SourceId
}
