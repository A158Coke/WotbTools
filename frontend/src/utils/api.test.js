import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './http.js'

// 只 mock useAuth（避免实例化 Keycloak）与全局 fetch——
// 绝不 mock ../utils/api.js 本身，否则会漏掉 hofUpload() 的真实实现 bug。
const auth = vi.hoisted(() => ({
  token: vi.fn(() => 'test-token'),
  ensureToken: vi.fn(async () => true),
  login: vi.fn(),
}))

const connectivityState = vi.hoisted(() => ({ state: null }))
vi.mock('../composables/useConnectivity.js', async () => {
  const { ref } = await import('vue')
  connectivityState.state = ref('online')
  return { useConnectivity: () => ({ connectivity: connectivityState.state, isSettled: () => true, whenSettled: () => Promise.resolve() }) }
})

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => auth,
}))

// 服务器没有 parser：HoF 提交前在本机解析回放得到结算事实。mock 最底层的 WASM 解析入口，
// 保留真实 submissionFacts（facts 顺序 / 失败映射都在那里）。
const localParse = vi.hoisted(() => ({
  parseAgentResultFromBytes: vi.fn(async (bytes) => ({ text: new TextDecoder().decode(bytes) })),
}))
vi.mock('../api/agent-replay-facets.js', () => localParse)
vi.mock('../replay-local/battleFacts.js', () => ({
  toBattleFacts: (result) => ({ source: result.text }),
}))

import {
  hofAdminHundredApprove,
  hofAdminMark3Approve,
  hofDownload,
  hofMark3Submit,
  hofHundredSubmit,
  hofUpload,
} from './api.js'

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }
}

describe('authenticated HoF API requests (real api.js, fetch mocked)', () => {
  const file = new File(['bytes'], 'battle.wotbreplay', { type: 'application/octet-stream' })

  beforeEach(() => {
    connectivityState.state.value = 'online'
    vi.stubGlobal('fetch', vi.fn())
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localParse.parseAgentResultFromBytes.mockClear()
    auth.login.mockClear()
    auth.ensureToken.mockClear()
    auth.token.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rejects offline uploads before local parsing, token refresh, login or HTTP', async () => {
    connectivityState.state.value = 'offline'
    await expect(hofUpload(file)).rejects.toBeInstanceOf(ApiError)
    expect(localParse.parseAgentResultFromBytes).not.toHaveBeenCalled()
    expect(auth.ensureToken).not.toHaveBeenCalled()
    expect(auth.login).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rechecks connectivity after token refresh before HTTP', async () => {
    auth.ensureToken.mockImplementationOnce(async () => { connectivityState.state.value = 'offline'; return true })
    await expect(hofDownload(1)).rejects.toBeInstanceOf(ApiError)
    expect(fetch).not.toHaveBeenCalled()
    expect(auth.login).not.toHaveBeenCalled()
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

  it('keeps 401 → login("hof") + canonical auth error without regressing', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }))

    const err = await hofUpload(file).catch(e => e)

    expect(auth.login).toHaveBeenCalledWith('hof')
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('AUTH_UNAUTHENTICATED')
    expect(err.status).toBe(401)
  })

  it('hofDownload 401 → login("hof") + canonical auth error, no download side effects', async () => {
    const objectUrlSpy = vi.fn(() => 'blob:fake')
    URL.createObjectURL = objectUrlSpy
    vi.mocked(fetch).mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }))

    const err = await hofDownload(42).catch(e => e)

    expect(auth.login).toHaveBeenCalledWith('hof')
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('AUTH_UNAUTHENTICATED')
    expect(err.status).toBe(401)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/hof/42/replay',
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    )
    // 401 在创建 blob / object URL / 触发下载之前抛错，不得有任何下载副作用
    expect(objectUrlSpy).not.toHaveBeenCalled()
  })

  it('approves a hundred-battle submission without a score payload', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { status: 'CURRENT' }))

    await hofAdminHundredApprove(17)

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/admin/hof/hundred/submissions/17/approve',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
      }),
    )
    const [, options] = vi.mocked(fetch).mock.calls[0]
    expect(options).not.toHaveProperty('body')
    expect(options.headers).not.toHaveProperty('Content-Type')
  })

  it('submits Mark 3 evidence with the exact repeated multipart keys', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { id: 23, status: 'PENDING' }))
    const formData = new FormData()
    formData.append('vehicleId', '385')
    formData.append('battleCount', '86')
    formData.append('averageDamage', '4123')
    formData.append('winRate', '67.25')
    formData.append('proofScreenshots', 'data:image/png;base64,one')
    formData.append('proofScreenshots', 'data:image/png;base64,two')
    formData.append('replays', file)

    const result = await hofMark3Submit(formData)

    expect(result).toEqual({ id: 23, status: 'PENDING' })
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/hof/mark3/submissions',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
        body: formData,
      }),
    )
    expect(formData.getAll('proofScreenshots')).toHaveLength(2)
    expect(formData.getAll('replays')).toHaveLength(1)
  })

  it('approves a Mark 3 submission without a score payload', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { status: 'CURRENT' }))

    await hofAdminMark3Approve(23)

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/admin/hof/mark3/submissions/23/approve',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
      }),
    )
    const [, options] = vi.mocked(fetch).mock.calls[0]
    expect(options).not.toHaveProperty('body')
    expect(options.headers).not.toHaveProperty('Content-Type')
  })

  it('hofUpload appends locally parsed facts next to the raw replay', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { status: 'ok' }))

    await hofUpload(file)

    const [, options] = vi.mocked(fetch).mock.calls[0]
    expect(options.body.get('file')).toBe(file)
    expect(JSON.parse(options.body.get('facts'))).toEqual({ source: 'bytes' })
  })

  it('hofUpload maps a local parse failure to INVALID_REPLAY_FILE and never hits the server', async () => {
    localParse.parseAgentResultFromBytes.mockRejectedValueOnce(new Error('wasm: bad replay'))

    const error = await hofUpload(file).catch(e => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('INVALID_REPLAY_FILE')
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('hofHundredSubmit appends one facts entry per replay in the same order', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { id: 5, status: 'PENDING' }))
    const formData = new FormData()
    formData.append('vehicleId', '385')
    for (const name of ['r1', 'r2', 'r3']) {
      formData.append('replays', new File([name], `${name}.wotbreplay`))
    }

    await hofHundredSubmit(formData)

    expect(formData.getAll('facts').map(f => JSON.parse(f).source)).toEqual(['r1', 'r2', 'r3'])
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/hof/hundred/submissions')
    expect(options.body).toBe(formData)
  })

  it('hofMark3Submit replaces stale facts and maps a parse failure to INVALID_REPLAY_FILE', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { id: 1 }))
    const formData = new FormData()
    formData.append('facts', 'stale')
    formData.append('replays', new File(['a'], 'a.wotbreplay'))
    formData.append('replays', new File(['b'], 'b.wotbreplay'))

    await hofMark3Submit(formData)
    expect(formData.getAll('facts').map(f => JSON.parse(f).source)).toEqual(['a', 'b'])

    vi.mocked(fetch).mockClear()
    localParse.parseAgentResultFromBytes.mockRejectedValueOnce(new Error('corrupt'))
    const error = await hofMark3Submit(formData).catch(e => e)
    expect(error.code).toBe('INVALID_REPLAY_FILE')
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})
