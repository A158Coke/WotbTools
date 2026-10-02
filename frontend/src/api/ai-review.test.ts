// @vitest-environment happy-dom

import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AI_REVIEWS_PATH,
  buildAiReviewRequest,
  cancelAiReview,
  cancelAiReviewUrl,
  openAiReviewStream,
} from './ai-review.js'
import { toAiReviewLocale, type AiReviewProjection } from '../types/ai-review.js'

const auth = {
  token: () => 'test-token',
  ensureToken: vi.fn().mockResolvedValue(true),
}

const CORRELATION_ID = '5c2b1f4e-9a0d-4f6b-8f1e-2b3c4d5e6f70'

const projection: AiReviewProjection = {
  battle: { players: [] },
  projection: {
    projectionVersion: 1,
    engine: { agentRelease: 'v0.3.8', agentCommit: 'abc' },
    clock: { battleStartRawClockSec: 10, battleDurationSec: 120, estimated: false, battleEndRawClockSec: 130, streamEndRawClockSec: 131 },
    perspective: { recorderAccountId: 1, perspectiveTeam: 1, recorderEntityIds: [7], winnerTeam: 1 },
    participants: [{ entityId: 7, accountId: 1, nickname: 'a', team: 1, tankId: 1, recorder: true }],
    observationWindows: [],
    positions: [],
    turrets: [],
    prop3Health: [],
    healthEvents: [],
    damageNotices: [],
    periods: [],
    objectives: { supremacyPoints: [], supremacyBases: [], assaultObjectivePresent: false, assaultBases: [] },
    limitations: [],
    unavailableEvidence: ['PACKET_DECODE_COVERAGE'],
  },
}

function responseStub(status: number, body = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body,
    json: async () => JSON.parse(body || '{}'),
  } as unknown as Response
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildAiReviewRequest', () => {
  it('freezes schemaVersion at the contract constant and carries only the projection', () => {
    const request = buildAiReviewRequest({
      ...projection,
      locale: 'zh-CN',
      correlationId: CORRELATION_ID,
    })

    expect(request.schemaVersion).toBe(2)
    expect(request.locale).toBe('zh-CN')
    expect(request.correlationId).toBe(CORRELATION_ID)
    expect(request.battle).toBe(projection.battle)
    expect(request.projection).toBe(projection.projection)
    // 只有结算事实 + client canonical 投影：不携带回放字节，也不携带 Agent 原始切面
    expect(Object.keys(request).sort()).toEqual([
      'battle', 'correlationId', 'locale', 'projection', 'schemaVersion',
    ])
  })
})

describe('toAiReviewLocale', () => {
  it('accepts only contract locales and falls back to zh-CN', () => {
    expect(toAiReviewLocale('en-US')).toBe('en-US')
    expect(toAiReviewLocale('ru-RU')).toBe('ru-RU')
    expect(toAiReviewLocale('zh')).toBe('zh-CN')
    expect(toAiReviewLocale(undefined)).toBe('zh-CN')
  })
})

describe('AI Review transport', () => {
  it('opens the SSE stream against /api/ai/reviews with the bearer JWT', async () => {
    const fetchMock = stubFetch(responseStub(200))

    await openAiReviewStream(auth, buildAiReviewRequest({
      ...projection,
      locale: 'zh-CN',
      correlationId: CORRELATION_ID,
    }))

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(AI_REVIEWS_PATH)
    expect(AI_REVIEWS_PATH).toBe('/api/ai/reviews')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    // 请求体 gzip 压缩发送，服务端限额解压后得到原样 JSON
    expect((init.headers as Record<string, string>)['Content-Encoding']).toBe('gzip')
    const inflated = gunzipSync(new Uint8Array(await (init.body as Blob).arrayBuffer())).toString('utf8')
    expect(JSON.parse(inflated)).toEqual(JSON.parse(JSON.stringify(buildAiReviewRequest({
      ...projection, locale: 'zh-CN', correlationId: CORRELATION_ID,
    }))))
  })

  it('cancels by correlationId path parameter (not the retired query form)', async () => {
    const fetchMock = stubFetch(responseStub(204))

    await cancelAiReview(auth, CORRELATION_ID)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/ai/reviews/${CORRELATION_ID}/cancel`)
    expect(cancelAiReviewUrl(CORRELATION_ID)).toBe(url)
    expect(url).not.toContain('?')
    expect(init.method).toBe('POST')
    expect(init.keepalive).toBe(true)
  })

  it('treats an already-finished review (404) as a best-effort no-op', async () => {
    stubFetch(responseStub(404, '{"errorCode":"RESOURCE_NOT_FOUND","status":404}'))

    await expect(cancelAiReview(auth, CORRELATION_ID)).resolves.toBeUndefined()
  })

  it('does not call the backend when there is no correlationId', async () => {
    const fetchMock = stubFetch(responseStub(204))

    await cancelAiReview(auth, '')

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
