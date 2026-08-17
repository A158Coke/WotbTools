import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './http.js'

// 只 mock useAuth（避免实例化 Keycloak）与全局 fetch——
// 绝不 mock ../utils/api.js 本身，否则会漏掉 leaderboardUpload() 的真实实现 bug。
const auth = vi.hoisted(() => ({
  token: vi.fn(() => 'test-token'),
  ensureToken: vi.fn(async () => true),
  login: vi.fn(),
}))

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => auth,
}))

import { leaderboardUpload } from './api.js'

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }
}

describe('leaderboardUpload (real api.js, fetch mocked)', () => {
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

    const result = await leaderboardUpload(file)

    expect(result).toEqual({ status: 'ok', arenaId: 'arena-1' })
    expect(auth.ensureToken).toHaveBeenCalledWith(30)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/leaderboard/upload',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
      }),
    )
    // 旧实现 return requireOk(r).json()（requireOk 是 async → Promise 无 .json）会抛
    // TypeError，本用例直接 fail，正是该回归测试的意义。
  })

  it('rejects with ApiError NON_RANDOM_BATTLE on HTTP 400, not a generic network failure', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(400, { error: 'NON_RANDOM_BATTLE', timestamp: '2026-01-01T00:00:00Z' }),
    )

    const err = await leaderboardUpload(file).catch(e => e)

    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('NON_RANDOM_BATTLE')
    expect(err.status).toBe(400)
    expect(err.code).not.toBe('NETWORK_ERROR')
    expect(err.code).not.toBe('HTTP_400')
  })

  it('keeps 401 → login("leaderboard") + AUTH_REQUIRED without regressing', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }))

    const err = await leaderboardUpload(file).catch(e => e)

    expect(auth.login).toHaveBeenCalledWith('leaderboard')
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('AUTH_REQUIRED')
    expect(err.status).toBe(401)
  })
})
