import type { ApiErrorPayload, ErrorCode, JsonObject, KnownErrorCode } from './api.js'
import type {
  ActiveSource,
  ExportJob,
  ExportJobCreateResponse,
  ProcessingJob,
  ProcessingJobCreateResponse,
  ProcessingSource,
  SourceStatus,
} from './jobs.js'
import type { AggregateRow, Battle, ColumnDef, ReplayResult } from './replay.js'
import { API_ERROR_CODES } from '../api/generated/api-error-codes'

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

export function isJobId(value: unknown): value is string {
  return isString(value) && value.trim().length > 0
}

export function isSourceId(value: unknown): value is string {
  return isString(value) && /^r\d+$/.test(value)
}

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set(API_ERROR_CODES)

export function isContractCode(value: unknown): value is string {
  return isString(value) && /^[A-Z][A-Z0-9_]*$/.test(value)
}

export function toErrorCode(value: unknown): ErrorCode | null {
  return isContractCode(value) ? value as ErrorCode : null
}

export function isKnownErrorCode(value: unknown): value is KnownErrorCode {
  return isString(value) && KNOWN_ERROR_CODES.has(value)
}

export function isSourceStatus(value: unknown): value is SourceStatus {
  return value === 'PENDING' || value === 'PROCESSING' || value === 'READY' || value === 'FAILED'
}

export function isProcessingStatus(value: unknown): value is ProcessingJob['status'] {
  return value === 'QUEUED' || value === 'PROCESSING' || value === 'READY'
    || value === 'FAILED' || value === 'CANCELLED'
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

function isSource(value: unknown): value is ProcessingSource {
  return isRecord(value) && isSourceId(value.sourceId) && isInteger(value.sourceIndex)
    && isString(value.displayName) && isSourceStatus(value.status)
    && isNullableString(value.errorCode)
}

function isActiveSource(value: unknown): value is ActiveSource {
  return isRecord(value) && isSourceId(value.sourceId) && isInteger(value.sourceIndex)
    && isString(value.displayName)
}

export function isProcessingJob(value: unknown): value is ProcessingJob {
  return isRecord(value) && isJobId(value.jobId) && isProcessingStatus(value.status)
    && isNullableString(value.phase) && isInteger(value.total) && isInteger(value.processed)
    && isInteger(value.valid) && isInteger(value.duplicates) && isInteger(value.failures)
    && isNullableString(value.errorCode) && isNullableString(value.currentFile)
    && isInteger(value.parseCompleted) && isInteger(value.parseSucceeded)
    && isInteger(value.parseFailed) && Array.isArray(value.sources) && value.sources.every(isSource)
    && Array.isArray(value.activeSources) && value.activeSources.every(isActiveSource)
}

export function isExportJob(value: unknown): value is ExportJob {
  return isRecord(value) && isJobId(value.jobId) && isProcessingStatus(value.status)
    && isNullableString(value.phase) && isInteger(value.total) && isInteger(value.processed)
    && isInteger(value.duplicates) && isInteger(value.failures)
    && isNullableString(value.errorCode) && isNullableString(value.filename)
    && isNullableString(value.contentType)
}

export function isJobCreateResponse(value: unknown): value is ProcessingJobCreateResponse {
  return isRecord(value) && isJobId(value.jobId) && isProcessingStatus(value.status)
    && isInteger(value.total)
}

export function isExportJobCreateResponse(value: unknown): value is ExportJobCreateResponse {
  return isRecord(value) && isJobId(value.jobId) && isProcessingStatus(value.status)
    && isInteger(value.total)
}

export function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return isRecord(value) && (value.id === null || isString(value.id))
    && isContractCode(value.errorCode) && isNullableString(value.errorMsg)
    && (value.status === null || isInteger(value.status)) && typeof value.retryable === 'boolean'
    && isRecord(value.details) && (value.timestamp === null || isString(value.timestamp))
}

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
