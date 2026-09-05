import { describe, expect, it } from 'vitest'
import {
  createAiReviewSseParser,
  isAiReviewDoneEvent,
  isAiReviewErrorEvent,
  isAiReviewEvent,
  isAiReviewResult,
  isAiReviewStageEvent,
  isAiReviewTokenEvent,
  parseAiReviewEvent,
  parseAiReviewEventData,
} from './aiReviewSse.js'

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

describe('aiReviewSse runtime guards', () => {
  it('accepts the real stage event names and ignores unknown stages', () => {
    for (const type of ['call1_start', 'call1_done', 'evidence_done']) {
      const event = parseAiReviewEvent(type, {})
      expect(event).toEqual({ type })
      expect(isAiReviewStageEvent(event)).toBe(true)
    }

    expect(parseAiReviewEvent('call1_start', null)).toBeNull()
    expect(parseAiReviewEvent('future_stage', {})).toBeNull()
  })

  it('guards token payloads without coercing arbitrary values', () => {
    const event = parseAiReviewEvent('call2_token', { delta: '逐段输出' })
    expect(event).toEqual({ type: 'call2_token', delta: '逐段输出' })
    expect(isAiReviewTokenEvent(event)).toBe(true)

    expect(parseAiReviewEvent('call2_token', { delta: 42 })).toBeNull()
    expect(parseAiReviewEvent('call2_token', {})).toBeNull()
  })

  it('requires a non-empty done analysis and validates additive fields', () => {
    const event = parseAiReviewEvent('done', {
      analysis: '完整复盘',
      preBattleSection: null,
      capability: 'AVAILABLE_WITH_LIMITED_TIMELINE',
    })
    expect(event).toEqual({
      type: 'done',
      result: {
        analysis: '完整复盘',
        preBattleSection: null,
        capability: 'AVAILABLE_WITH_LIMITED_TIMELINE',
      },
    })
    expect(isAiReviewDoneEvent(event)).toBe(true)
    if (!event || event.type !== 'done') throw new Error('expected done event')
    expect(isAiReviewResult(event.result)).toBe(true)
    expect(isAiReviewEvent(event)).toBe(true)

    // Current ReplaySseWriter omits capability and old responses may omit both optional fields.
    expect(parseAiReviewEvent('done', { analysis: '兼容结果' })).toEqual({
      type: 'done',
      result: { analysis: '兼容结果', preBattleSection: undefined },
    })
    expect(parseAiReviewEvent('done', { analysis: 'x', capability: 'NOT_A_CAPABILITY' })).toBeNull()
    expect(isAiReviewResult({ analysis: 'x', capability: 'NOT_A_CAPABILITY' })).toBe(false)
    expect(parseAiReviewEvent('done', { analysis: '   ' })).toBeNull()
    expect(parseAiReviewEvent('done', { analysis: 123 })).toBeNull()
  })

  it('accepts the structured Team Review v0.5 result and omits empty sections in the renderer contract', () => {
    const event = parseAiReviewEvent('done', {
      analysis: null,
      teamPlayers: [{ playerKey: 'P1', displayName: 'Alice', tankName: 'Kranvagn' }],
      teamReview: {
        summary: { verdict: '团队结论', primaryDiagnosis: '主要诊断' },
        episodes: [{
          id: 'E1', startSec: 10, endSec: 20, title: '关键交火', analysis: '复盘', playerKeys: ['P1'],
        }],
        trainingSuggestions: [],
        reviewFocus: [],
        highContributors: [],
      },
    })
    expect(event?.type).toBe('done')
    expect(isAiReviewResult(event?.type === 'done' ? event.result : null)).toBe(true)
    expect(event?.type === 'done' ? event.result.teamPlayers : undefined).toEqual([
      { playerKey: 'P1', displayName: 'Alice', tankName: 'Kranvagn' },
    ])
    expect(parseAiReviewEvent('done', {
      analysis: null,
      teamReview: {
        summary: { verdict: 'x', primaryDiagnosis: 'y' }, episodes: [],
        trainingSuggestions: [], reviewFocus: [{ playerKey: 'P1', episodeId: 'missing', reason: 'x' }], highContributors: [],
      },
    })).toBeNull()
    expect(parseAiReviewEvent('done', {
      analysis: null,
      teamPlayers: [
        { playerKey: 'P1', displayName: 'Alice', tankName: 'Kranvagn' },
        { playerKey: 'P1', displayName: 'Duplicate', tankName: 'Kranvagn' },
      ],
      teamReview: {
        summary: { verdict: 'x', primaryDiagnosis: 'y' }, episodes: [],
        trainingSuggestions: [], reviewFocus: [], highContributors: [],
      },
    })).toBeNull()
  })

  it('accepts stable uppercase future error codes and rejects malformed ones', () => {
    const event = parseAiReviewEventData('error', '{"code":"AI_REVIEW_GROUNDING_FAILED"}')
    expect(event).toEqual({ type: 'error', id: null, code: 'AI_REVIEW_GROUNDING_FAILED', errorMsg: null })
    expect(isAiReviewErrorEvent(event)).toBe(true)
    expect(isAiReviewEvent(event)).toBe(true)
    expect(parseAiReviewEvent('error', { code: 'lowercase' })).toBeNull()
    expect(parseAiReviewEvent('error', { code: 503 })).toBeNull()
  })

  it('parses the canonical SSE error envelope without exposing provider details', () => {
    const event = parseAiReviewEvent('error', {
      id: 'corr-1',
      errorCode: 'AI_REVIEW_GROUNDING_FAILED',
      errorMsg: null,
    })
    expect(event).toEqual({
      type: 'error', id: 'corr-1', code: 'AI_REVIEW_GROUNDING_FAILED', errorMsg: null,
    })
    expect(parseAiReviewEvent('error', {
      id: 'corr-1', errorCode: 'AI_REVIEW_GROUNDING_FAILED', errorMsg: 'raw provider response',
    })).toMatchObject({ id: 'corr-1', code: 'AI_REVIEW_GROUNDING_FAILED' })
  })

  it('ignores invalid JSON and unknown event names', () => {
    expect(parseAiReviewEventData('call2_token', '{bad json')).toBeNull()
    expect(parseAiReviewEventData('unknown', '{}')).toBeNull()
    expect(isAiReviewEvent({ type: 'call2_token', delta: 1 })).toBe(false)
  })
})

describe('createAiReviewSseParser', () => {
  it('keeps event framing across string chunks and preserves event order', () => {
    const parser = createAiReviewSseParser()
    expect(parser.push('event: call1_start\ndata: {}\n')).toEqual([])
    expect(parser.push('\nevent: call2_token\ndata: {"delta":"A')).toEqual([{ type: 'call1_start' }])
    expect(parser.push('"}\n\n')).toEqual([{ type: 'call2_token', delta: 'A' }])
    expect(parser.push(frame('evidence_done', {}))).toEqual([{ type: 'evidence_done' }])
    expect(parser.finish()).toEqual([])
  })

  it('handles UTF-8 byte boundaries, CRLF, comments, and a final unterminated frame', () => {
    const encoded = new TextEncoder().encode(frame('call2_token', { delta: '中文' }))
    const split = encoded.findIndex(byte => byte >= 0x80)
    const parser = createAiReviewSseParser()
    expect(parser.push(encoded.slice(0, split + 1))).toEqual([])
    expect(parser.push(encoded.slice(split + 1))).toEqual([{ type: 'call2_token', delta: '中文' }])

    const second = createAiReviewSseParser()
    expect(second.push(': keep-alive\r\nevent: call1_done\r\ndata: {}\r\n\r\n')).toEqual([
      { type: 'call1_done' },
    ])
    expect(second.push('event: call2_token\ndata: {"delta":"tail"}')).toEqual([])
    expect(second.finish()).toEqual([{ type: 'call2_token', delta: 'tail' }])
    expect(second.finish()).toEqual([])
  })

  it('drops malformed known events while continuing to parse later events', () => {
    const parser = createAiReviewSseParser()
    const events = parser.push([
      frame('call2_token', { delta: 1 }),
      frame('not-yet-supported', {}),
      frame('done', { analysis: 'final' }),
    ].join(''))
    expect(events).toEqual([{ type: 'done', result: { analysis: 'final', preBattleSection: undefined } }])
  })
})
