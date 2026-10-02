import type { ApiErrorWirePayload, ApplicationErrorCode, JsonObject, KnownServerErrorCode } from './api.js'
import type { AggregateRow, Battle, ColumnDef, ReplayResult } from './replay.js'
import { API_ERROR_CODES } from '../api/generated/api-error-codes'
import { validateApiError } from '../api/contract-runtime.js'

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value)
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value)
}

export function isSourceId(value: unknown): value is string {
  return isString(value) && /^r\d+$/.test(value)
}

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set(API_ERROR_CODES)

export function isContractCode(value: unknown): value is string {
  return isString(value) && /^[A-Z][A-Z0-9_]*$/.test(value)
}

export function toErrorCode(value: unknown): ApplicationErrorCode | null {
  return isContractCode(value) ? value as ApplicationErrorCode : null
}

export function isKnownErrorCode(value: unknown): value is KnownServerErrorCode {
  return isString(value) && KNOWN_ERROR_CODES.has(value)
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

function isColumnDef(value: unknown): value is ColumnDef {
  return isRecord(value) && isString(value.key) && typeof value.num === 'boolean'
}

export function isApiErrorWirePayload(value: unknown): value is ApiErrorWirePayload {
  return validateApiError(value).data !== null
}

/** Backward-compatible name; validation now targets the generated HTTP wire schema. */
export const isApiErrorPayload = isApiErrorWirePayload

function isPlayerRow(value: unknown): boolean {
  return isRecord(value) && isRecord(value.cells) && isInteger(value.team)
}

function isAggregateRow(value: unknown): value is AggregateRow {
  return isRecord(value) && isRecord(value.cells) && isInteger(value.team)
}

function isBattle(value: unknown): value is Battle {
  return isRecord(value) && isNullableString(value.arenaId) && isNullableString(value.mapName)
    && isNullableString(value.version) && isNullableFiniteNumber(value.durationS)
    && (value.startTime === null || isInteger(value.startTime))
    && (value.winnerTeam === null || isInteger(value.winnerTeam)) && isSourceId(value.sourceId)
    && isNullableString(value.sourceName) && Array.isArray(value.players)
    && value.players.every(isPlayerRow) && (value.league === null || isRecord(value.league))
}

export function isReplayResult(value: unknown): value is ReplayResult {
  return isRecord(value) && Array.isArray(value.battles) && value.battles.every(isBattle)
    && Array.isArray(value.aggregate) && value.aggregate.every(isAggregateRow)
    && Array.isArray(value.duplicates) && value.duplicates.every(isStringArray)
    && Array.isArray(value.failures) && value.failures.every(isStringArray)
    && Array.isArray(value.playerColumns) && value.playerColumns.every(isColumnDef)
    && Array.isArray(value.aggregateColumns) && value.aggregateColumns.every(isColumnDef)
    && (value.league === null || isRecord(value.league))
    && isNullableString(value.leagueUnavailableCode) && typeof value.leagueMode === 'boolean'
}
