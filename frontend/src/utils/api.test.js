import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './http.js'

// 只 mock useAuth（避免实例化 Keycloak）与全局 fetch——
// 绝不 mock ../utils/api.js 本身，否则会漏掉 hofUpload() 的真实实现 bug。
const auth = vi.hoisted(() => ({
  token: vi.fn(() => 'test-token'),
  ensureToken: vi.fn(async () => true),
  login: vi.fn(),
}))

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => auth,
}))

import { hofDownload, hofUpload } from './api.js'

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }
}

describe('hofUpload (real api.js, fetch mocked)', () => {
  const file = new File(['bytes'], 'battle.wotbreplay', { type: 'application/octet-stream' })

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    auth.login.mockClear()
    auth.ensureToken.mockClear()
    auth.token.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves parsed JSON on HTTP 200 — must catch old requireOk(r).json() Promise bug', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { status: 'ok', arenaId: 'arena-1' }))

    const result = await hofUpload(file)

    expect(result).toEqual({ status: 'ok', arenaId: 'arena-1' })
    expect(auth.ensureToken).toHaveBeenCalledWith(30)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/hof/upload',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
      }),
    )
    // 旧实现 return requireOk(r).json()（requireOk 是 async → Promise 无 .json）会抛
    // TypeError，本用例直接 fail，正是该回归测试的意义。
  })

  it('rejects with ApiError UNSUPPORTED_BATTLE_TYPE on HTTP 400, not a generic network failure', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(400, { error: 'UNSUPPORTED_BATTLE_TYPE', timestamp: '2026-01-01T00:00:00Z' }),
    )

    const err = await hofUpload(file).catch(e => e)

    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('UNSUPPORTED_BATTLE_TYPE')
    expect(err.status).toBe(400)
    expect(err.code).not.toBe('NETWORK_ERROR')
    expect(err.code).not.toBe('HTTP_400')
  })

  it('keeps 401 → login("hof") + AUTH_REQUIRED without regressing', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }))

    const err = await hofUpload(file).catch(e => e)

    expect(auth.login).toHaveBeenCalledWith('hof')
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('AUTH_REQUIRED')
    expect(err.status).toBe(401)
  })

  it('hofDownload 401 → login("hof") + AUTH_REQUIRED, no download side effects', async () => {
    const objectUrlSpy = vi.fn(() => 'blob:fake')
    URL.createObjectURL = objectUrlSpy
    vi.mocked(fetch).mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }))

    const err = await hofDownload(42).catch(e => e)

    expect(auth.login).toHaveBeenCalledWith('hof')
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('AUTH_REQUIRED')
    expect(err.status).toBe(401)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/hof/42/replay',
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    )
    // 401 在创建 blob / object URL / 触发下载之前抛错，不得有任何下载副作用
    expect(objectUrlSpy).not.toHaveBeenCalled()
  })
})