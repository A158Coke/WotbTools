// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './http.js'

// 只 mock useAuth（避免实例化 Keycloak）与全局 fetch——绝不 mock api.js 本身。
const auth = vi.hoisted(() => ({
  token: vi.fn(() => 'test-token'),
  ensureToken: vi.fn(async () => true),
  login: vi.fn(),
}))

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => auth,
}))

import { createExportJob, getExportJob, cancelExportJob, downloadExportJob } from './api.js'

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }
}

function blobResponse(status, { cd = '', type = 'application/octet-stream' } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => (name === 'Content-Disposition' ? cd : null) },
    blob: async () => new Blob(['xlsx'], { type }),
  }
}

describe('replay export job api', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('createExportJob posts multipart and returns 202 job payload', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(202, { jobId: 'j1', status: 'QUEUED', total: 2 }))
    const body = new FormData()
    const result = await createExportJob(body, 'aggregate')
    expect(result).toEqual({ jobId: 'j1', status: 'QUEUED', total: 2 })
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/replay/export-jobs?mode=aggregate',
      expect.objectContaining({ method: 'POST', body }),
    )
  })

  it('createExportJob appends teamNames multipart field when provided (PR #123 Blocker 1)', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(202, { jobId: 'j1', status: 'QUEUED', total: 1 }))
    // 复用 processingJobId 路径：body=null + teamNames → 构造含 teamNames 字段的 FormData
    await createExportJob(null, 'aggregate', 'p1', '{"battle":{"a:1":"X"}}')
    const [url, opts] = vi.mocked(fetch).mock.calls[0]
    expect(url).toContain('mode=aggregate')
    expect(url).toContain('processingJobId=p1')
    expect(opts.body).toBeInstanceOf(FormData)
    expect(opts.body.get('teamNames')).toBe('{"battle":{"a:1":"X"}}')

    // 有 files body 时保留原字段并追加 teamNames
    vi.mocked(fetch).mockClear()
    const body = new FormData()
    body.append('files', new Blob(['x']), 'a.wotbreplay')
    await createExportJob(body, 'each', undefined, '{"summary":{"clan:CHRD":"Y"}}')
    const [, opts2] = vi.mocked(fetch).mock.calls[0]
    expect(opts2.body.get('files')).toBeTruthy()
    expect(opts2.body.get('teamNames')).toBe('{"summary":{"clan:CHRD":"Y"}}')
  })

  it('createExportJob reuses processing result with bodyless POST (no teamNames)', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(202, { jobId: 'j1', status: 'QUEUED', total: 34 }))
    // 生产 500 回归：reuse 解析结果 + 无战队名称覆盖 → body=null + processingJobId。
    // HTTP contract：bodyless POST 合法（backend 不强制 multipart），不得伪造空 FormData。
    const result = await createExportJob(null, 'aggregate', 'p1', null)
    expect(result).toEqual({ jobId: 'j1', status: 'QUEUED', total: 34 })
    const [url, opts] = vi.mocked(fetch).mock.calls[0]
    expect(url).toContain('mode=aggregate')
    expect(url).toContain('processingJobId=p1')
    expect(opts.method).toBe('POST')
    expect(opts.body).toBeNull()
    expect(opts.body).not.toBeInstanceOf(FormData)
  })

  it('createExportJob propagates 503 EXPORT_QUEUE_FULL as ApiError', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(503, { error: 'EXPORT_QUEUE_FULL' }))
    const err = await createExportJob(new FormData(), 'aggregate').catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('EXPORT_QUEUE_FULL')
    expect(err.status).toBe(503)
  })

  it('getExportJob returns progress payload', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { jobId: 'j1', status: 'PROCESSING', processed: 5, total: 10 }))
    const result = await getExportJob('j1')
    expect(result.processed).toBe(5)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/replay/export-jobs/j1')
  })

  it('getExportJob maps 404 JOB_NOT_FOUND to ApiError', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(404, { error: 'JOB_NOT_FOUND' }))
    const err = await getExportJob('nope').catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('JOB_NOT_FOUND')
  })

  it('cancelExportJob sends DELETE and resolves on 204', async () => {
    vi.mocked(fetch).mockResolvedValue({ status: 204, ok: true })
    await cancelExportJob('j1')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/replay/export-jobs/j1', expect.objectContaining({ method: 'DELETE' }))
  })

  it('downloadExportJob triggers blob download on READY', async () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.mocked(fetch).mockResolvedValue(blobResponse(200, {
      cd: "attachment; filename=\"export.xlsx\"; filename*=UTF-8''export.xlsx",
    }))

    await downloadExportJob('j1', 'export.xlsx')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/replay/export-jobs/j1/download')
    expect(appendSpy).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
  })

  it('downloadExportJob maps 409 JOB_NOT_READY to ApiError', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(409, { error: 'JOB_NOT_READY' }))
    const err = await downloadExportJob('j1', 'export.xlsx').catch(e => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('JOB_NOT_READY')
    expect(err.status).toBe(409)
  })
})