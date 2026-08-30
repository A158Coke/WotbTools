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

import {
  hofAdminHundredApprove,
  hofAdminMark3Approve,
  hofDownload,
  hofHundredSubmitWargaming,
  hofMark3Submit,
  hofUpload,
  ratingV2Admin,
  createProcessingJob,
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

  it('WG hundred submission sends authenticated JSON without multipart data', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, {
      id: 9,
      status: 'CURRENT',
      decision: 'AUTO_APPROVED',
      verifiedAverageDamage: 3800,
      verifiedBattleCount: 120,
    }))
    const body = { vehicleId: 385, averageDamage: 3750, battleCount: 120 }

    const result = await hofHundredSubmitWargaming(body)

    expect(result.decision).toBe('AUTO_APPROVED')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/hof/hundred/submissions/wargaming',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify(body),
      }),
    )
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

  it('requests Rating V2 only through the admin job endpoint with a Bearer token', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { rows: [], columns: [] }))

    const result = await ratingV2Admin('ready-job')

    expect(result).toEqual({ rows: [], columns: [] })
    expect(auth.ensureToken).toHaveBeenCalledWith(30)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/admin/rating-v2/processing-jobs/ready-job',
      expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer test-token' } }),
    )
  })

  it('Rating V2 401 returns to the hidden deep link', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }))

    const err = await ratingV2Admin('ready-job').catch(error => error)

    expect(auth.login).toHaveBeenCalledWith('rating-v2')
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ code: 'AUTH_UNAUTHENTICATED', status: 401 })
  })
})

// ── Replay Processing Job create：XHR 真实上传进度──

/** 可控的 XHR 替身：手动触发 progress / load / abort。 */
class FakeXhr {
  constructor() {
    this.upload = {}
    this.status = 0
    this.responseText = ''
    this.headers = {}
    this.aborted = false
  }

  open(method, url) {
    this.method = method
    this.url = url
  }

  send(body) {
    this.body = body
  }

  abort() {
    this.aborted = true
    if (typeof this.onabort === 'function') this.onabort()
  }

  progress(loaded, total) {
    if (typeof this.upload.onprogress === 'function') {
      this.upload.onprogress({ lengthComputable: true, loaded, total })
    }
  }

  respond(status, text) {
    this.status = status
    this.responseText = text
    if (typeof this.onload === 'function') this.onload()
  }
}

describe('createProcessingJob XHR upload progress', () => {
  let xhr

  beforeEach(() => {
    xhr = null
    vi.stubGlobal('XMLHttpRequest', class {
      constructor() {
        xhr = new FakeXhr()
        return xhr
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports real upload progress 0→100 and resolves on 202', async () => {
    const progressCalls = []
    const fd = new FormData()
    const promise = createProcessingJob(fd, {
      onProgress: (p) => progressCalls.push(p)
    })
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('/api/replay/processing-jobs')

    xhr.progress(33_554_432, 67_108_864)
    xhr.progress(67_108_864, 67_108_864)
    expect(progressCalls).toEqual([
      { loaded: 33_554_432, total: 67_108_864, percent: 50 },
      { loaded: 67_108_864, total: 67_108_864, percent: 100 },
    ])

    xhr.respond(202, JSON.stringify({ jobId: 'p1', status: 'QUEUED', total: 2 }))
    await expect(promise).resolves.toEqual({ jobId: 'p1', status: 'QUEUED', total: 2 })
    expect(xhr.body).toBe(fd)
  })

  it('rejects with stable ApiError code on non-2xx', async () => {
    const promise = createProcessingJob(new FormData())
    xhr.respond(503, JSON.stringify({ code: 'PROCESSING_QUEUE_FULL' }))
    await expect(promise).rejects.toMatchObject({ code: 'PROCESSING_QUEUE_FULL', status: 503 })
  })

  it('aborts the XHR when signal fires and rejects with canonical ApiError', async () => {
    const controller = new AbortController()
    const promise = createProcessingJob(new FormData(), { signal: controller.signal })
    controller.abort()
    expect(xhr.aborted).toBe(true)
    await expect(promise).rejects.toMatchObject({
      name: 'ApiError', code: 'REQUEST_ABORTED', status: null, retryable: false
    })
  })
})
