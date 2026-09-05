import type {
  AiReviewCapability,
  AiReviewDoneEvent,
  AiReviewErrorEvent,
  AiReviewEvent,
  AiReviewResult,
  AiReviewStageEvent,
  AiReviewTokenEvent,
  TeamAiPlayerIdentity,
  TeamAiReviewResult,
} from '../types/ai-review.js'
import type { ServerErrorCode } from '../types/api.js'
import { isAiReviewCapability } from '../types/ai-review.js'
import { isContractCode, isRecord } from '../types/guards.js'

const STAGE_EVENTS = new Set<AiReviewStageEvent['type']>([
  'call1_start',
  'call1_done',
  'evidence_done',
])

const KNOWN_EVENTS = new Set([
  ...STAGE_EVENTS,
  'call2_token',
  'done',
  'error',
])

function optionalString(record: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in record)) return undefined
  return record[key] === null ? null : typeof record[key] === 'string' ? record[key] : undefined
}

function nullableString(record: Record<string, unknown>, key: string): string | null {
  const value = optionalString(record, key)
  return value === undefined ? null : value
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isBoundedNonEmptyString(value: unknown, maxLength: number): value is string {
  return isNonEmptyString(value) && value.length <= maxLength
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 8
    && value.every(item => isBoundedNonEmptyString(item, 64))
}

function isTeamPlayerIdentity(value: unknown): value is TeamAiPlayerIdentity {
  return isRecord(value)
    && isBoundedNonEmptyString(value.playerKey, 64)
    && typeof value.displayName === 'string' && value.displayName.length <= 240
    && typeof value.tankName === 'string' && value.tankName.length <= 240
}

function isTeamPlayerMapping(value: unknown): value is TeamAiPlayerIdentity[] {
  if (!Array.isArray(value)) return false
  const keys = new Set<string>()
  return value.every(item => isTeamPlayerIdentity(item) && !keys.has(item.playerKey)
    && keys.add(item.playerKey))
}

function isNullableNonnegativeInteger(value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && (value as number) >= 0)
}

function isTeamReviewResult(value: unknown): value is TeamAiReviewResult {
  if (!isRecord(value) || !isRecord(value.summary)
    || !isBoundedNonEmptyString(value.summary.verdict, 4000)
    || !isBoundedNonEmptyString(value.summary.primaryDiagnosis, 4000)) return false
  if (!Array.isArray(value.episodes) || value.episodes.length > 6
    || !Array.isArray(value.trainingSuggestions)
    || !Array.isArray(value.reviewFocus) || value.reviewFocus.length > 2
    || !Array.isArray(value.highContributors) || value.highContributors.length > 2) return false
  const episodeIds = new Set<string>()
  for (const item of value.episodes) {
    if (!isRecord(item)) return false
    const startSec = item.startSec
    const endSec = item.endSec
    if (!Object.prototype.hasOwnProperty.call(item, 'startSec')
      || !Object.prototype.hasOwnProperty.call(item, 'endSec')
      || !isBoundedNonEmptyString(item.id, 64) || episodeIds.has(item.id)
      || !isBoundedNonEmptyString(item.title, 240)
      || !isBoundedNonEmptyString(item.analysis, 8000)
      || !isStringArray(item.playerKeys)
      || !isNullableNonnegativeInteger(startSec)
      || !isNullableNonnegativeInteger(endSec)
      || (startSec !== null && endSec !== null
        && (endSec as number) < (startSec as number))) return false
    episodeIds.add(item.id)
  }
  if (value.trainingSuggestions.length > 12) return false
  for (const item of value.trainingSuggestions) {
    if (!isRecord(item) || !Object.prototype.hasOwnProperty.call(item, 'episodeId')
      || !isBoundedNonEmptyString(item.title, 240)
      || !isBoundedNonEmptyString(item.content, 6000)
      || (item.episodeId !== null
        && (!isBoundedNonEmptyString(item.episodeId, 64) || !episodeIds.has(item.episodeId)))) return false
  }
  for (const list of [value.reviewFocus, value.highContributors]) {
    for (const item of list) {
      if (!isRecord(item) || !isBoundedNonEmptyString(item.playerKey, 64)
        || !isBoundedNonEmptyString(item.episodeId, 64) || !episodeIds.has(item.episodeId)
        || !isBoundedNonEmptyString(item.reason, 2000)) return false
    }
  }
  return true
}

function resultFromPayload(payload: unknown): AiReviewResult | null {
  if (!isRecord(payload)) return null
  if ('teamPlayers' in payload && payload.teamPlayers !== undefined
    && !isTeamPlayerMapping(payload.teamPlayers)) return null
  const hasTeam = isTeamReviewResult(payload.teamReview)
  const hasText = isNonEmptyString(payload.analysis)
  if (!hasTeam && !hasText) {
    return null
  }

  const preBattleSection = optionalString(payload, 'preBattleSection')
  // JSON cannot carry undefined; an explicitly malformed non-undefined value is rejected.
  if ('preBattleSection' in payload && payload.preBattleSection !== undefined
    && preBattleSection === undefined) return null

  let capability: AiReviewCapability | undefined
  if ('capability' in payload) {
    if (!isAiReviewCapability(payload.capability)) return null
    capability = payload.capability
  }

  return {
    ...((hasText || (hasTeam && payload.analysis === null))
      ? { analysis: payload.analysis as string | null } : {}),
    preBattleSection,
    ...(hasTeam ? { teamReview: payload.teamReview as TeamAiReviewResult } : {}),
    ...(('teamPlayers' in payload && payload.teamPlayers !== undefined)
      ? { teamPlayers: payload.teamPlayers as TeamAiPlayerIdentity[] } : {}),
    ...(capability === undefined ? {} : { capability }),
  }
}

/** Runtime guard for the terminal analysis result carried by a `done` event. */
export function isAiReviewResult(value: unknown): value is AiReviewResult {
  return resultFromPayload(value) !== null
}

/** Runtime guard for the `call1_*` and `evidence_done` events. */
export function isAiReviewStageEvent(value: unknown): value is AiReviewStageEvent {
  return isRecord(value) && typeof value.type === 'string' && STAGE_EVENTS.has(value.type as AiReviewStageEvent['type'])
}

/** Runtime guard for the streamed main-review token event. */
export function isAiReviewTokenEvent(value: unknown): value is AiReviewTokenEvent {
  return isRecord(value) && value.type === 'call2_token' && typeof value.delta === 'string'
}

/** Runtime guard for the terminal event. `capability` and `preBattleSection` remain additive. */
export function isAiReviewDoneEvent(value: unknown): value is AiReviewDoneEvent {
  return isRecord(value) && value.type === 'done' && isAiReviewResult(value.result)
}

/** Runtime guard for stable error-code events; unknown future uppercase codes remain valid. */
export function isAiReviewErrorEvent(value: unknown): value is AiReviewErrorEvent {
  return isRecord(value) && value.type === 'error' && isContractCode(value.code)
    && (value.id === null || typeof value.id === 'string')
    && (value.errorMsg === null || typeof value.errorMsg === 'string')
}

/** Runtime guard for the discriminated event union. */
export function isAiReviewEvent(value: unknown): value is AiReviewEvent {
  return isAiReviewStageEvent(value)
    || isAiReviewTokenEvent(value)
    || isAiReviewDoneEvent(value)
    || isAiReviewErrorEvent(value)
}

/**
 * Convert one backend SSE event and its decoded JSON payload into a typed event.
 * Unknown event names and malformed payloads are deliberately ignored at this boundary.
 */
export function parseAiReviewEvent(eventName: unknown, payload: unknown): AiReviewEvent | null {
  if (typeof eventName !== 'string' || !KNOWN_EVENTS.has(eventName)) return null

  if (STAGE_EVENTS.has(eventName as AiReviewStageEvent['type'])) {
    return isRecord(payload) ? { type: eventName as AiReviewStageEvent['type'] } : null
  }

  if (eventName === 'call2_token') {
    return isRecord(payload) && typeof payload.delta === 'string'
      ? { type: 'call2_token', delta: payload.delta }
      : null
  }

  if (eventName === 'done') {
    const result = resultFromPayload(payload)
    return result === null ? null : { type: 'done', result }
  }

  if (!isRecord(payload)) return null
  // `code` remains a read-only compatibility alias for older deployed backends;
  // the canonical SSE error contract uses errorCode/id/errorMsg.
  const errorCode = isContractCode(payload.errorCode)
    ? payload.errorCode
    : isContractCode(payload.code) ? payload.code : null
  if (!errorCode) return null
  return {
    type: 'error',
    id: nullableString(payload, 'id'),
    code: errorCode as ServerErrorCode,
    errorMsg: nullableString(payload, 'errorMsg'),
  }
}

/** Decode the JSON data field and parse a single event. */
export function parseAiReviewEventData(eventName: unknown, rawData: string): AiReviewEvent | null {
  let payload: unknown = {}
  if (rawData.trim()) {
    try {
      payload = JSON.parse(rawData) as unknown
    } catch {
      return null
    }
  }
  return parseAiReviewEvent(eventName, payload)
}

export interface AiReviewSseParser {
  /** Feed a UTF-8 chunk (or string in tests) and return complete, validated events. */
  push(chunk: Uint8Array | string): AiReviewEvent[]
  /** Flush decoder and any final frame, returning only validated events. */
  finish(): AiReviewEvent[]
}

/**
 * Small SSE framing parser for the backend's JSON event stream. It handles chunk boundaries,
 * CRLF, multi-line data fields, comments, and ignores unknown/malformed events safely.
 */
export function createAiReviewSseParser(): AiReviewSseParser {
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let eventName = ''
  let dataLines: string[] = []
  let finished = false

  const dispatch = (): AiReviewEvent | null => {
    if (!eventName) {
      eventName = ''
      dataLines = []
      return null
    }
    const event = parseAiReviewEventData(eventName, dataLines.join('\n'))
    eventName = ''
    dataLines = []
    return event
  }

  const consume = (text: string, flush = false): AiReviewEvent[] => {
    if (finished) return []
    buffer += text
    const events: AiReviewEvent[] = []
    let newlineIndex = -1
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
      buffer = buffer.slice(newlineIndex + 1)
      if (line === '') {
        const event = dispatch()
        if (event) events.push(event)
      } else if (line.startsWith(':')) {
        // SSE comment / keep-alive line.
      } else if (line.startsWith('event:')) {
        eventName = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        const value = line.slice(5)
        dataLines.push(value.startsWith(' ') ? value.slice(1) : value)
      }
    }

    if (flush && buffer) {
      // A final line without a trailing newline is valid enough to retain as a frame.
      const line = buffer.replace(/\r$/, '')
      buffer = ''
      if (line.startsWith('event:')) eventName = line.slice(6).trim()
      else if (line.startsWith('data:')) {
        const value = line.slice(5)
        dataLines.push(value.startsWith(' ') ? value.slice(1) : value)
      }
    }
    if (flush) {
      const event = dispatch()
      if (event) events.push(event)
      finished = true
    }
    return events
  }

  return {
    push(chunk) {
      return consume(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }))
    },
    finish() {
      return consume(decoder.decode(), true)
    },
  }
}
