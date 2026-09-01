import type {
  AiReviewCapability,
  AiReviewDoneEvent,
  AiReviewErrorEvent,
  AiReviewEvent,
  AiReviewResult,
  AiReviewStageEvent,
  AiReviewTokenEvent,
} from '../types/ai-review.js'
import type { ServerErrorCode } from '../types/api.js'
import { isAiReviewCapability } from '../types/ai-review.js'
import { isContractCode, isRecord } from '../types/guards.js'

const STAGE_EVENTS = new Set<AiReviewStageEvent['type']>([
  'call1_start',
  'call1_done',
  'evidence_done',
  'autopsy_start',
  'autopsy_done',
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

function resultFromPayload(payload: unknown): AiReviewResult | null {
  if (!isRecord(payload) || typeof payload.analysis !== 'string' || !payload.analysis.trim()) {
    return null
  }

  const preBattleSection = optionalString(payload, 'preBattleSection')
  if ('preBattleSection' in payload && preBattleSection === undefined) return null

  let capability: AiReviewCapability | undefined
  if ('capability' in payload) {
    if (!isAiReviewCapability(payload.capability)) return null
    capability = payload.capability
  }

  return {
    analysis: payload.analysis,
    preBattleSection,
    ...(capability === undefined ? {} : { capability }),
  }
}

/** Runtime guard for the terminal analysis result carried by a `done` event. */
export function isAiReviewResult(value: unknown): value is AiReviewResult {
  return resultFromPayload(value) !== null
}

/** Runtime guard for the `call1_*`, `evidence_done`, and `autopsy_*` events. */
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

  return isRecord(payload) && isContractCode(payload.code)
    ? { type: 'error', code: payload.code as ServerErrorCode }
    : null
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
