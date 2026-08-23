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
  createProcessingJob: vi.fn(),
  getProcessingJob: vi.fn(),
  cancelProcessingJob: vi.fn(),
  getProcessingJobResult: vi.fn(),
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
    replay.dismissProcessingJob()
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


describe('useReplay processing job flow (plan §13/§20/§30/§63)', () => {
  let replay

  function pJob(overrides = {}) {
    return { jobId: 'p1', status: 'QUEUED', phase: null, total: 34, processed: 0, valid: 0,
      duplicates: 0, failures: 0, errorCode: null, currentFile: null, ...overrides }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    replay = useReplay()
    replay.files.value = [new File(['x'], 'a.wotbreplay'), new File(['y'], 'b.wotbreplay')]
  })

  it('startProcessingJob creates job, polls real progress, auto-loads result on READY', async () => {
    const onColumnsInit = vi.fn()
    const result = { battles: [{ mapName: 'Lagoon', sourceName: 'a.wotbreplay' }], aggregate: [], duplicates: [], failures: [], playerColumns: [], aggregateColumns: [] }
    api.createProcessingJob.mockResolvedValue({ jobId: 'p1', status: 'QUEUED', total: 34 })
    api.getProcessingJob
      .mockResolvedValueOnce(pJob({ status: 'PROCESSING', phase: 'PROCESSING_REPLAYS', processed: 18, valid: 16, duplicates: 2, failures: 1 }))
      .mockResolvedValueOnce(pJob({ status: 'READY', phase: null, processed: 34, valid: 31, duplicates: 2, failures: 1 }))
    api.getProcessingJobResult.mockResolvedValue(result)

    await replay.startProcessingJob(onColumnsInit)
    expect(api.createProcessingJob).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(0)
    // 第一次轮询：真实 18/34 + 计数（plan §63 processing 真实显示）
    expect(replay.processingJob.value.status).toBe('PROCESSING')
    expect(replay.processingJob.value.processed).toBe(18)
    expect(replay.processingJob.value.valid).toBe(16)
    expect(replay.processingJob.value.duplicates).toBe(2)
    expect(replay.processingJob.value.failures).toBe(1)

    await vi.advanceTimersByTimeAsync(1500)
    // READY：自动拉取 result 展示（plan §20），不强迫用户再点「加载结果」
    expect(replay.processingJob.value.status).toBe('READY')
    expect(replay.resp.value).toEqual(result)
    expect(replay.processingJobId.value).toBe('p1')
    expect(onColumnsInit).toHaveBeenCalledWith(result)
    expect(replay.loading.value).toBe(false)
    // 终端后停止轮询
    const calls = api.getProcessingJob.mock.calls.length
    await vi.advanceTimersByTimeAsync(3000)
    expect(api.getProcessingJob.mock.calls.length).toBe(calls)
  })

  it('processing FAILED shows error and stops polling', async () => {
    api.createProcessingJob.mockResolvedValue({ jobId: 'p1', status: 'QUEUED', total: 1 })
    api.getProcessingJob.mockResolvedValue(pJob({ status: 'FAILED', phase: null, errorCode: 'NO_VALID_REPLAYS', failures: 1 }))

    await replay.startProcessingJob()
    await vi.advanceTimersByTimeAsync(0)
    expect(replay.processingJob.value.status).toBe('FAILED')
    expect(replay.processingError.value).toContain('replay.processing_job.no_valid_replays')
    expect(replay.loading.value).toBe(false)
  })

  it('cancelProcessingJob stops polling and marks CANCELLED', async () => {
    api.createProcessingJob.mockResolvedValue({ jobId: 'p1', status: 'QUEUED', total: 34 })
    api.getProcessingJob.mockResolvedValue(pJob({ status: 'PROCESSING', processed: 5 }))
    api.cancelProcessingJob.mockResolvedValue(undefined)

    await replay.startProcessingJob()
    await replay.cancelProcessingJob()
    expect(api.cancelProcessingJob).toHaveBeenCalledWith('p1')
    expect(replay.processingJob.value.status).toBe('CANCELLED')
    expect(replay.loading.value).toBe(false)
    const calls = api.getProcessingJob.mock.calls.length
    await vi.advanceTimersByTimeAsync(3000)
    expect(api.getProcessingJob.mock.calls.length).toBe(calls)
  })

  it('prevents duplicate processing while job active', async () => {
    api.createProcessingJob.mockResolvedValue({ jobId: 'p1', status: 'QUEUED', total: 34 })
    api.getProcessingJob.mockResolvedValue(pJob({ status: 'PROCESSING', processed: 3 }))

    await replay.startProcessingJob()
    await vi.advanceTimersByTimeAsync(0)
    expect(replay.processingActive.value).toBe(true)
    await replay.startProcessingJob()
    expect(api.createProcessingJob).toHaveBeenCalledTimes(1)
  })

  it('export after READY reuses processingJobId without re-uploading (plan §30)', async () => {
    // 模拟已 READY（轮询 → READY → processingJobId 完整链路由上一用例覆盖）
    replay.processingJobId.value = 'p1'

    api.createExportJob.mockResolvedValue({ jobId: 'e1', status: 'QUEUED', total: 2 })
    api.getExportJob.mockResolvedValue({ jobId: 'e1', status: 'READY', phase: null, total: 2, processed: 2, duplicates: 0, failures: 0, filename: 'x.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await replay.startExportJob('aggregate')
    // 关键：不重新上传（body=null）、带 processingJobId
    expect(api.createExportJob).toHaveBeenCalledWith(null, 'aggregate', 'p1')
    await vi.advanceTimersByTimeAsync(0)
    expect(replay.exportJob.value.status).toBe('READY')
  })

  it('export without processing result still uploads (legacy path)', async () => {
    api.createExportJob.mockResolvedValue({ jobId: 'e1', status: 'QUEUED', total: 2 })
    api.getExportJob.mockResolvedValue({ jobId: 'e1', status: 'READY', phase: null, total: 2, processed: 2, duplicates: 0, failures: 0, filename: 'x.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await replay.startExportJob('each')
    expect(api.createExportJob).toHaveBeenCalledTimes(1)
    const [body, mode, jobId] = api.createExportJob.mock.calls[0]
    expect(body).not.toBeNull()
    expect(mode).toBe('each')
    expect(jobId).toBeUndefined()
  })
})
