// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useReplay } from './useReplay.js'

const i18n = vi.hoisted(() => ({
  t: vi.fn((key) => key),
  te: vi.fn(() => true),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: { value: 'en' }, t: i18n.t, te: i18n.te })
}))

const api = vi.hoisted(() => ({
  createExportJob: vi.fn(),
  getExportJob: vi.fn(),
  cancelExportJob: vi.fn(),
  downloadExportJob: vi.fn(),
  preview: vi.fn(),
}))

vi.mock('../utils/api.js', () => api)

function job(overrides = {}) {
  return { jobId: 'j1', status: 'QUEUED', phase: null, total: 2, processed: 0,
    duplicates: 0, failures: 0, errorCode: null, filename: null, contentType: null, ...overrides }
}

describe('useReplay export job flow', () => {
  let replay

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    replay = useReplay()
    replay.files.value = [new File(['x'], 'a.wotbreplay')]
  })

  afterEach(() => {
    vi.useRealTimers()
    replay.dismissExportJob()
  })

  it('startExportJob creates job and polls until terminal', async () => {
    api.createExportJob.mockResolvedValue({ jobId: 'j1', status: 'QUEUED', total: 2 })
    api.getExportJob
      .mockResolvedValueOnce(job({ status: 'PROCESSING', phase: 'PROCESSING_REPLAYS', processed: 1 }))
      .mockResolvedValueOnce(job({ status: 'READY', phase: null, processed: 2, filename: 'x.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))

    await replay.startExportJob('aggregate')
    expect(api.createExportJob).toHaveBeenCalledTimes(1)
    // 首次轮询立即执行：拿到 PROCESSING(1/2)
    await vi.advanceTimersByTimeAsync(0)
    expect(replay.exportJob.value.status).toBe('PROCESSING')
    expect(replay.exportJob.value.processed).toBe(1)

    await vi.advanceTimersByTimeAsync(1500)
    expect(replay.exportJob.value.status).toBe('READY')
  })

  it('prevents duplicate export while job active', async () => {
    api.createExportJob.mockResolvedValue({ jobId: 'j1', status: 'QUEUED', total: 1 })
    api.getExportJob.mockResolvedValue(job({ status: 'PROCESSING', processed: 1 }))

    await replay.startExportJob('aggregate')
    await vi.advanceTimersByTimeAsync(0)
    expect(replay.exportActive.value).toBe(true)
    await replay.startExportJob('each')
    expect(api.createExportJob).toHaveBeenCalledTimes(1)
  })

  it('polls until FAILED then stops', async () => {
    api.createExportJob.mockResolvedValue({ jobId: 'j1', status: 'QUEUED', total: 1 })
    api.getExportJob.mockResolvedValue(job({ status: 'FAILED', phase: null, errorCode: 'NO_VALID_REPLAYS' }))

    await replay.startExportJob('aggregate')
    await vi.advanceTimersByTimeAsync(0)
    expect(replay.exportJob.value.status).toBe('FAILED')
    const callsAfterFailure = api.getExportJob.mock.calls.length
    await vi.advanceTimersByTimeAsync(3000)
    expect(api.getExportJob.mock.calls.length).toBe(callsAfterFailure)
  })

  it('cancel stops polling and marks CANCELLED', async () => {
    api.createExportJob.mockResolvedValue({ jobId: 'j1', status: 'QUEUED', total: 1 })
    api.getExportJob.mockResolvedValue(job({ status: 'PROCESSING', processed: 1 }))
    api.cancelExportJob.mockResolvedValue(undefined)

    await replay.startExportJob('aggregate')
    await replay.cancelExportJob()
    expect(api.cancelExportJob).toHaveBeenCalledWith('j1')
    expect(replay.exportJob.value.status).toBe('CANCELLED')
    const calls = api.getExportJob.mock.calls.length
    await vi.advanceTimersByTimeAsync(3000)
    expect(api.getExportJob.mock.calls.length).toBe(calls)
  })

  it('download only when READY', async () => {
    api.createExportJob.mockResolvedValue({ jobId: 'j1', status: 'QUEUED', total: 1 })
    api.getExportJob.mockResolvedValue(job({ status: 'PROCESSING', processed: 1 }))
    await replay.startExportJob('aggregate')
    await replay.downloadExportResult()
    expect(api.downloadExportJob).not.toHaveBeenCalled()

    replay.exportJob.value = job({ status: 'READY', filename: 'x.zip', contentType: 'application/zip' })
    await replay.downloadExportResult()
    expect(api.downloadExportJob).toHaveBeenCalledWith('j1', 'x.zip')
  })

  it('poll failure clears job and surfaces error', async () => {
    api.createExportJob.mockResolvedValue({ jobId: 'j1', status: 'QUEUED', total: 1 })
    api.getExportJob.mockRejectedValue({ code: 'JOB_NOT_FOUND', status: 404 })
    await replay.startExportJob('aggregate')
    await vi.advanceTimersByTimeAsync(1500)
    expect(replay.exportJob.value).toBeNull()
    expect(replay.exportError.value.length).toBeGreaterThan(0)
  })
})
