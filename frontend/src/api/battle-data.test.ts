import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from '../../../contracts/http/fixtures/battle-data.json'
import { postBattleData } from './battle-data.js'
import type { components } from './generated/http-contract.js'

type Request = components['schemas']['BattleDataRequest']
const payload = () => structuredClone(fixture) as Request
const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 201 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('navigator', { onLine: true })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('匿名 Collector transport', () => {
  it.each([201, 204, 400, 429, 500, 503])('%s 是静默终态，不解析响应也不重试', async status => {
    fetchMock.mockResolvedValue(new Response(null, { status }))
    await expect(postBattleData(payload())).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/battle-data')
    expect(request.credentials).toBe('omit')
    expect(request.redirect).toBe('error')
    expect(request.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(request.body)).toEqual(fixture)
  })

  it('离线和非法 wire payload 不发出请求，包括额外身份字段', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await postBattleData(payload())
    vi.stubGlobal('navigator', { onLine: true })
    await postBattleData({ ...payload(), accountId: 123 } as Request)
    await postBattleData({ ...payload(), arenaId: '18446744073709551616' })
    await postBattleData({ ...payload(), winnerTeam: null } as unknown as Request)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([new TypeError('network'), new DOMException('timeout', 'TimeoutError')])(
    '网络失败不逃逸或重试：%s', async error => {
      fetchMock.mockRejectedValue(error)
      await expect(postBattleData(payload())).resolves.toBeUndefined()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it('使用5秒deadline，abort后仍静默结束', async () => {
    const abort = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(abort.signal)
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    }))
    const pending = postBattleData(payload())
    expect(timeout).toHaveBeenCalledWith(5_000)
    abort.abort()
    await expect(pending).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('Android保持既有business API URL解析，不增加认证', async () => {
    vi.stubEnv('MODE', 'android')
    await postBattleData(payload())
    expect(fetchMock.mock.calls[0][0]).toBe('https://wotbtools.com/api/battle-data')
    expect(fetchMock.mock.calls[0][1].credentials).toBe('omit')
  })
})
