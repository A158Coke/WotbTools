// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useReplay, chooseInitialResultTab } from './useReplay.js'

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
    replay.processingJobId.value = 'p1'
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
    replay.processingJobId.value = 'p1'
    api.createExportJob.mockResolvedValue({ jobId: 'j1', status: 'QUEUED', total: 1 })
    api.getExportJob.mockResolvedValue(job({ status: 'PROCESSING', processed: 1 }))

    await replay.startExportJob('aggregate')
    await vi.advanceTimersByTimeAsync(0)
    expect(replay.exportActive.value).toBe(true)
    await replay.startExportJob('each')
    expect(api.createExportJob).toHaveBeenCalledTimes(1)
  })

  it('polls until FAILED then stops', async () => {
    replay.processingJobId.value = 'p1'
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
    replay.processingJobId.value = 'p1'
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
    replay.processingJobId.value = 'p1'
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

// ---- BLOCKER 1：Processing create single-flight（同一 selection 至多一个 backend Job）----

describe('useReplay Processing create single-flight（BLOCKER 1）', () => {
  let replay

  function deferred() {
    let resolve
    let reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  function readyJobPoll(jobId, total) {
    return {
      jobId,
      status: 'PROCESSING',
      total,
      sources: Array.from({ length: total }, (_, i) => ({
        sourceId: `r${i}`,
        status: 'READY'
      }))
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    replay = useReplay()
    api.getProcessingJobResult.mockResolvedValue({ battles: [] })
    api.cancelProcessingJob.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    replay.dismissProcessingJob()
  })

  it('A/B 两个 Direct Action 在 create 未返回期间并发 → 共享同一 job（create 恰好 1 次）', async () => {
    const fileA = new File(['a'], 'a.wotbreplay')
    const fileB = new File(['b'], 'b.wotbreplay')
    replay.files.value = [fileA, fileB]
    const dCreate = deferred()
    api.createProcessingJob.mockReturnValueOnce(dCreate.promise)
    api.getProcessingJob.mockResolvedValue(readyJobPoll('p1', 2))

    const pA = replay.requestDirectAction(fileA, 'ai')
    const pB = replay.requestDirectAction(fileB, 'playback')
    expect(api.createProcessingJob).toHaveBeenCalledTimes(1)

    dCreate.resolve({ jobId: 'p1', status: 'QUEUED', total: 2 })
    const [refA, refB] = await Promise.all([pA, pB])
    expect(refA).toEqual({ processingJobId: 'p1', sourceId: 'r0' })
    expect(refB).toEqual({ processingJobId: 'p1', sourceId: 'r1' })
    expect(api.createProcessingJob).toHaveBeenCalledTimes(1)
    expect(api.cancelProcessingJob).not.toHaveBeenCalled()
  })

  it('manual Parse + Direct Action 重叠 → create 只调用一次', async () => {
    const file = new File(['a'], 'a.wotbreplay')
    replay.files.value = [file]
    const dCreate = deferred()
    api.createProcessingJob.mockReturnValueOnce(dCreate.promise)
    api.getProcessingJob.mockResolvedValue(readyJobPoll('p1', 1))

    const pManual = replay.startProcessingJob(null)
    const pDirect = replay.requestDirectAction(file, 'ai')
    expect(api.createProcessingJob).toHaveBeenCalledTimes(1)

    dCreate.resolve({ jobId: 'p1', status: 'QUEUED', total: 1 })
    await pManual
    const ref = await pDirect
    expect(api.createProcessingJob).toHaveBeenCalledTimes(1)
    expect(ref).toEqual({ processingJobId: 'p1', sourceId: 'r0' })
    expect(replay.processingJob.value.jobId).toBe('p1')
  })

  it('selection change during create：stale jobId best-effort cancel、不绑定、不 poll', async () => {
    const fileA = new File(['a'], 'a.wotbreplay')
    replay.files.value = [fileA]
    const dCreate = deferred()
    api.createProcessingJob.mockReturnValueOnce(dCreate.promise)
    api.getProcessingJob.mockResolvedValue(readyJobPoll('pA', 1))

    const pStart = replay.startProcessingJob(null)
    replay.updateFiles([new File(['b'], 'b.wotbreplay')]) // selection 变化 → abort in-flight create

    dCreate.resolve({ jobId: 'pA', status: 'QUEUED', total: 1 }) // server 已接受 → stale 返回
    await pStart
    expect(api.cancelProcessingJob).toHaveBeenCalledWith('pA')
    expect(replay.processingJob.value).toBeNull()
    expect(replay.processingJobId.value).toBeNull()
    expect(replay.uploadState.value).toBeNull()
    expect(api.getProcessingJob.mock.calls.some(([id]) => id === 'pA')).toBe(false)
  })

  it('stale create 迟到 resolve 不清当前 B 的 uploadState/loading（cancel 后不绑定）', async () => {
    const dA = deferred()
    api.createProcessingJob.mockReturnValueOnce(dA.promise)
    api.getProcessingJob.mockReturnValue(new Promise(() => {})) // 主 poll 挂起，避免覆盖绑定断言
    replay.files.value = [new File(['a'], 'a.wotbreplay')]
    const pOld = replay.startProcessingJob(null)

    replay.updateFiles([new File(['b'], 'b.wotbreplay')]) // A 失效
    const dB = deferred()
    api.createProcessingJob.mockReturnValueOnce(dB.promise)
    const pNew = replay.startProcessingJob(null) // B 成为 current creation
    expect(replay.uploadState.value?.phase).toBe('UPLOADING')
    expect(replay.loading.value).toBe(true)

    dA.resolve({ jobId: 'pA', status: 'QUEUED', total: 1 }) // A 迟到成功（server 已接受）
    await pOld
    expect(api.cancelProcessingJob).toHaveBeenCalledWith('pA')
    expect(replay.uploadState.value?.phase).toBe('UPLOADING', 'A 的迟到 resolve 不得清 B uploadState')
    expect(replay.loading.value).toBe(true, 'A 的迟到 resolve 不得清 B loading')
    expect(replay.processingJob.value).toBeNull()

    dB.resolve({ jobId: 'pB', status: 'QUEUED', total: 1 })
    await pNew
    expect(replay.processingJob.value.jobId).toBe('pB')
  })

  it('stale create 迟到 catch（AbortError）不清当前 B 的 uploadState/loading/processingError', async () => {
    const dA = deferred()
    api.createProcessingJob.mockReturnValueOnce(dA.promise)
    api.getProcessingJob.mockReturnValue(new Promise(() => {})) // 主 poll 挂起，避免覆盖绑定断言
    replay.files.value = [new File(['a'], 'a.wotbreplay')]
    const pOld = replay.startProcessingJob(null)

    replay.updateFiles([new File(['b'], 'b.wotbreplay')]) // A 失效
    const dB = deferred()
    api.createProcessingJob.mockReturnValueOnce(dB.promise)
    const pNew = replay.startProcessingJob(null)
    expect(replay.uploadState.value?.phase).toBe('UPLOADING')
    expect(replay.loading.value).toBe(true)

    dA.reject(Object.assign(new Error('UPLOAD_ABORTED'), { name: 'AbortError' })) // A 迟到 abort
    await pOld
    expect(replay.uploadState.value?.phase).toBe('UPLOADING', 'A 的迟到 catch 不得清 B uploadState')
    expect(replay.loading.value).toBe(true, 'A 的迟到 catch 不得清 B loading')
    expect(replay.processingError.value).toBe('')

    dB.resolve({ jobId: 'pB', status: 'QUEUED', total: 1 })
    await pNew
    expect(replay.processingJob.value.jobId).toBe('pB')
  })

  it('并发 start/direct 后只有一个主 poll interval；终态后 interval 全部释放', async () => {
    const fileA = new File(['a'], 'a.wotbreplay')
    const fileB = new File(['b'], 'b.wotbreplay')
    replay.files.value = [fileA, fileB]
    const dCreate = deferred()
    api.createProcessingJob.mockReturnValueOnce(dCreate.promise)
    api.getProcessingJob.mockResolvedValue({
      jobId: 'p1', status: 'PROCESSING', total: 2,
      sources: [
        { sourceId: 'r0', status: 'PROCESSING' },
        { sourceId: 'r1', status: 'PROCESSING' }
      ]
    })

    const intervalSpy = vi.spyOn(globalThis, 'setInterval')
    try {
      const pA = replay.requestDirectAction(fileA, 'ai')
      const pB = replay.requestDirectAction(fileB, 'playback')
      dCreate.resolve({ jobId: 'p1', status: 'QUEUED', total: 2 })
      await vi.advanceTimersByTimeAsync(0) // doCreate 绑定 + 主 poll 立即 tick + source polls 立即 tick

      const mainIntervals = intervalSpy.mock.calls.filter(([, ms]) => ms === 1500)
      expect(mainIntervals.length).toBe(1, '一个 Processing Job 至多一个主 poll interval')
      expect(api.createProcessingJob).toHaveBeenCalledTimes(1)

      // 主 interval 确实在 tick（不是 lost interval）：推进后 getProcessingJob 增加
      const pollsBefore = api.getProcessingJob.mock.calls.length
      await vi.advanceTimersByTimeAsync(1500)
      expect(api.getProcessingJob.mock.calls.length).toBeGreaterThan(pollsBefore)

      // 转 READY：主 poll 停止 + source polls 各自 resolve（pA/pB 完成）
      api.getProcessingJob.mockResolvedValue({
        jobId: 'p1', status: 'READY', total: 2,
        sources: [
          { sourceId: 'r0', status: 'READY' },
          { sourceId: 'r1', status: 'READY' }
        ]
      })
      await vi.advanceTimersByTimeAsync(3000)
      await Promise.all([pA, pB])
      const settled = api.getProcessingJob.mock.calls.length
      await vi.advanceTimersByTimeAsync(6000)
      expect(api.getProcessingJob.mock.calls.length).toBe(settled,
        'READY 后 interval 全部释放（无 lost interval / 无残留 tick）')
    } finally {
      intervalSpy.mockRestore()
    }
  })
})


describe('useReplay processing job flow', () => {
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
    // 第一次轮询：真实 18/34 + 计数（processing 真实显示）
    expect(replay.processingJob.value.status).toBe('PROCESSING')
    expect(replay.processingJob.value.processed).toBe(18)
    expect(replay.processingJob.value.valid).toBe(16)
    expect(replay.processingJob.value.duplicates).toBe(2)
    expect(replay.processingJob.value.failures).toBe(1)

    await vi.advanceTimersByTimeAsync(1500)
    // READY：自动拉取 result 展示，不强迫用户再点「加载结果」
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

  it('processing FAILED with MIXED league/standard shows specific message', async () => {
    api.createProcessingJob.mockResolvedValue({ jobId: 'p1', status: 'QUEUED', total: 2 })
    api.getProcessingJob.mockResolvedValue(pJob({
      status: 'FAILED', phase: null, errorCode: 'MIXED_LEAGUE_AND_STANDARD_REPLAYS', failures: 2
    }))

    await replay.startProcessingJob()
    await vi.advanceTimersByTimeAsync(0)
    expect(replay.processingJob.value.status).toBe('FAILED')
    expect(replay.processingError.value).toContain('replay.processing_job.mixed_league_standard')
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

  it('tracks UPLOADING → REGISTERING → QUEUED with real upload progress', async () => {
    let resolveCreate
    const pending = new Promise(r => { resolveCreate = r })
    api.getProcessingJob.mockReturnValue(new Promise(() => {})) // 轮询挂起，避免 READY 覆盖断言
    api.createProcessingJob.mockImplementation((body, { onProgress }) => {
      onProgress({ loaded: 33_554_432, total: 67_108_864, percent: 50 })
      return pending
    })

    const p = replay.startProcessingJob()
    expect(replay.processingUiState.value).toBe('UPLOADING')
    expect(replay.uploadState.value.percent).toBe(50)

    // 上传体已发完、202 未返回 → REGISTERING（plan §28）
    const opts = api.createProcessingJob.mock.calls[0][1]
    opts.onProgress({ loaded: 67_108_864, total: 67_108_864, percent: 100 })
    expect(replay.processingUiState.value).toBe('REGISTERING')

    resolveCreate({ jobId: 'p1', status: 'QUEUED', total: 34 })
    await p
    expect(replay.processingUiState.value).toBe('QUEUED')
    expect(replay.uploadState.value).toBeNull()
  })

  it('cancelProcessing aborts active upload without ghost job state', async () => {
    api.getProcessingJob.mockReturnValue(new Promise(() => {}))
    api.createProcessingJob.mockImplementation((body, { onProgress, signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('UPLOAD_ABORTED')
          err.name = 'AbortError'
          reject(err)
        })
      }))

    const p = replay.startProcessingJob()
    expect(replay.processingUiState.value).toBe('UPLOADING')
    replay.cancelProcessing()
    await p

    expect(replay.processingUiState.value).not.toBe('UPLOADING')
    expect(replay.processingJob.value).toBeNull()
    expect(replay.processingError.value).toBe('')
  })

  it('requestDirectAction creates job with priority and resolves when source READY', async () => {
    api.createProcessingJob.mockResolvedValue({ jobId: 'p1', status: 'QUEUED', total: 2 })
    api.getProcessingJob.mockResolvedValue({
      jobId: 'p1', status: 'PROCESSING', total: 2,
      sources: [{ sourceId: 'r0', status: 'READY' }, { sourceId: 'r1', status: 'READY' }]
    })
    replay.files.value = [new File(['a'], 'a.wotbreplay'), new File(['b'], 'b.wotbreplay')]

    const ref = await replay.requestDirectAction(replay.files.value[1], 'ai')

    expect(ref).toEqual({ processingJobId: 'p1', sourceId: 'r1' })
    const fd = api.createProcessingJob.mock.calls[0][0]
    expect(fd.get('prioritySourceIndex')).toBe('1')
  })

  it('export after READY reuses processingJobId without re-uploading', async () => {
    // 模拟已 READY（轮询 → READY → processingJobId 完整链路由上一用例覆盖）；
    // resultMatchesSelection 要求 resp 与 processingJobId 成对存在。
    replay.processingJobId.value = 'p1'
    replay.resp.value = { battles: [], aggregate: [], duplicates: [], failures: [], playerColumns: [], aggregateColumns: [] }

    api.createExportJob.mockResolvedValue({ jobId: 'e1', status: 'QUEUED', total: 2 })
    api.getExportJob.mockResolvedValue({ jobId: 'e1', status: 'READY', phase: null, total: 2, processed: 2, duplicates: 0, failures: 0, filename: 'x.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await replay.startExportJob('aggregate')
    // 关键：不重新上传（body=null）、带 processingJobId；无覆盖时 teamNamesJson=null
    expect(api.createExportJob).toHaveBeenCalledWith(null, 'aggregate', 'p1', null)
    await vi.advanceTimersByTimeAsync(0)
    expect(replay.exportJob.value.status).toBe('READY')
  })

  it('startExportJob passes league team name overrides to api', async () => {
    replay.processingJobId.value = 'p1'
    replay.resp.value = { battles: [], aggregate: [], duplicates: [], failures: [], playerColumns: [], aggregateColumns: [] }
    api.createExportJob.mockResolvedValue({ jobId: 'e1', status: 'QUEUED', total: 2 })
    api.getExportJob.mockResolvedValue({ jobId: 'e1', status: 'READY', phase: null, total: 2, processed: 2, duplicates: 0, failures: 0, filename: 'x.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

    await replay.startExportJob('aggregate', {
      battle: { 'arena-1:1': 'CHRD' },
      summary: { 'clan:CHRD': 'CHRD A队' }
    })
    expect(api.createExportJob).toHaveBeenCalledTimes(1)
    const [body, mode, jobId, teamNamesJson] = api.createExportJob.mock.calls[0]
    expect(body).toBeNull() // 复用 processingJobId：不重新上传
    expect(mode).toBe('aggregate')
    expect(jobId).toBe('p1')
    expect(JSON.parse(teamNamesJson)).toEqual({
      battle: { 'arena-1:1': 'CHRD' },
      summary: { 'clan:CHRD': 'CHRD A队' }
    })
  })

  it('export without processing result is rejected (dataset-only, BLOCKER-free 收敛)', async () => {
    api.createExportJob.mockResolvedValue({ jobId: 'e1', status: 'QUEUED', total: 2 })
    api.getExportJob.mockResolvedValue({ jobId: 'e1', status: 'READY', phase: null, total: 2, processed: 2, duplicates: 0, failures: 0, filename: 'x.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await replay.startExportJob('each')
    expect(api.createExportJob).not.toHaveBeenCalled()
    expect(replay.exportError.value).toBe('replay.export_job.require_processing')
  })
})
describe('useReplay file-selection invalidation', () => {
  let replay

  function pJob(overrides = {}) {
    return { jobId: 'p1', status: 'QUEUED', phase: null, total: 9, processed: 0, valid: 0,
      duplicates: 0, failures: 0, errorCode: null, currentFile: null, ...overrides }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    replay = useReplay()
  })

  afterEach(() => {
    vi.useRealTimers()
    replay.dismissProcessingJob()
    replay.dismissExportJob()
  })

  it('Case A: READY 后 add 文件 → processingJobId 立即失效，Export 不得复用旧 dataset', async () => {
    replay.files.value = Array.from({ length: 9 }, (_, i) => new File(['x'], `r${i}.wotbreplay`))
    const result = { battles: [{ mapName: 'Lagoon', sourceName: 'r0.wotbreplay' }], aggregate: [], duplicates: [], failures: [], playerColumns: [], aggregateColumns: [] }
    api.createProcessingJob.mockResolvedValue({ jobId: 'p1', status: 'QUEUED', total: 9 })
    // 状态化 mock（不用 ONCE 队列）：第 1 次轮询 PROCESSING，之后一律 READY——
    // 对 fake-timer 可能多出的 interval tick 幂等（避免 ONCE 队列 + 残留实现交错）。
    api.getProcessingJob.mockImplementation(() => {
      const n = api.getProcessingJob.mock.calls.length
      return Promise.resolve(n === 1
        ? pJob({ status: 'PROCESSING', processed: 5, valid: 5 })
        : pJob({ status: 'READY', processed: 9, valid: 9 }))
    })
    api.getProcessingJobResult.mockResolvedValue(result)

    await replay.startProcessingJob()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1500)
    expect(replay.processingJobId.value).toBe('p1')
    expect(replay.resp.value).toEqual(result)

    // add 第 10 个文件（FileUploader 任意 update:files 事件）→ 旧结果必须立即失效
    replay.updateFiles([...replay.files.value, new File(['x'], 'r9.wotbreplay')])
    expect(replay.processingJobId.value).toBeNull()
    expect(replay.resp.value).toBeNull()

    // Export 只允许 dataset 复用：processingJobId 失效后必须拒绝，绝不 legacy 重新上传
    api.createExportJob.mockResolvedValue({ jobId: 'e1', status: 'QUEUED', total: 10 })
    api.getExportJob.mockResolvedValue({ jobId: 'e1', status: 'READY', phase: null, total: 10, processed: 10, duplicates: 0, failures: 0, filename: 'x.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await replay.startExportJob('aggregate')
    expect(api.createExportJob).not.toHaveBeenCalled()
    expect(replay.exportError.value).toBe('replay.export_job.require_processing')
  })

  it('Case B: P1 处理中 files 改变 → P1 迟到 READY 不得覆盖当前 selection', async () => {
    replay.files.value = [new File(['x'], 'a.wotbreplay')]
    let resolvePoll
    api.createProcessingJob.mockResolvedValue({ jobId: 'p1', status: 'QUEUED', total: 1 })
    // 第一次轮询挂起：模拟 P1 仍在处理中（响应迟到）
    api.getProcessingJob.mockReturnValueOnce(new Promise(r => { resolvePoll = r }))

    await replay.startProcessingJob()
    await vi.advanceTimersByTimeAsync(0)
    expect(replay.processingJob.value.status).toBe('QUEUED')

    // files 改变 → 停止轮询 + 后台取消旧 job + 结果失效
    replay.updateFiles([new File(['y'], 'b.wotbreplay')])
    expect(replay.processingJob.value).toBeNull()
    expect(api.cancelProcessingJob).toHaveBeenCalledWith('p1')

    // P1 迟到 READY（轮询响应在 stop 之后才 resolve）→ 必须被丢弃
    api.getProcessingJobResult.mockResolvedValue({ battles: [], aggregate: [], duplicates: [], failures: [], playerColumns: [], aggregateColumns: [] })
    resolvePoll(pJob({ status: 'READY', processed: 1, valid: 1 }))
    await vi.advanceTimersByTimeAsync(0)
    expect(replay.processingJobId.value).toBeNull()
    expect(replay.resp.value).toBeNull()
    expect(replay.loading.value).toBe(false)
  })

  it('Case C: READY 后 remove / clear → 旧 processingJobId 不得复用', async () => {
    replay.files.value = [new File(['x'], 'a.wotbreplay'), new File(['y'], 'b.wotbreplay')]
    api.createProcessingJob.mockResolvedValue({ jobId: 'p1', status: 'QUEUED', total: 2 })
    api.getProcessingJob
      .mockResolvedValueOnce(pJob({ status: 'PROCESSING', processed: 1, valid: 1 }))
      .mockResolvedValueOnce(pJob({ status: 'READY', processed: 2, valid: 2 }))
    api.getProcessingJobResult.mockResolvedValue({ battles: [], aggregate: [], duplicates: [], failures: [], playerColumns: [], aggregateColumns: [] })

    await replay.startProcessingJob()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1500)
    expect(replay.processingJobId.value).toBe('p1')

    // remove 一个文件（FileUploader remove 事件 → updateFiles）
    replay.updateFiles(replay.files.value.slice(1))
    expect(replay.processingJobId.value).toBeNull()
    expect(replay.resp.value).toBeNull()

    // clear（清空按钮 → updateFiles([])）
    replay.updateFiles([])
    expect(replay.processingJobId.value).toBeNull()
    expect(replay.resp.value).toBeNull()
    expect(replay.files.value.length).toBe(0)
  })

  it('confirmRemove 经 updateFiles 失效旧结果并重新解析（新 job 覆盖旧 id）', async () => {
    replay.files.value = [new File(['x'], 'a.wotbreplay'), new File(['y'], 'b.wotbreplay')]
    api.createProcessingJob.mockResolvedValue({ jobId: 'p1', status: 'QUEUED', total: 2 })
    api.getProcessingJob.mockResolvedValue(pJob({ status: 'READY', processed: 2, valid: 2 }))
    api.getProcessingJobResult.mockResolvedValue({ battles: [], aggregate: [], duplicates: [], failures: [], playerColumns: [], aggregateColumns: [] })
    await replay.startProcessingJob()
    await vi.advanceTimersByTimeAsync(0)
    expect(replay.processingJobId.value).toBe('p1')

    api.createProcessingJob.mockResolvedValue({ jobId: 'p2', status: 'QUEUED', total: 1 })
    replay.askRemoveFile(replay.files.value[0])
    replay.confirmRemove()
    expect(replay.files.value.length).toBe(1)
    // 旧结果立即失效 + 剩余文件自动重新解析
    await vi.advanceTimersByTimeAsync(0)
    expect(api.createProcessingJob).toHaveBeenCalledTimes(2)
    expect(replay.processingJobId.value).toBe('p2')
  })
  it('Case: stale P1 reject 不停止 P2 polling（stale error race）', async () => {
    replay.files.value = [new File(['x'], 'a.wotbreplay')]
    let rejectP1
    api.createProcessingJob.mockResolvedValueOnce({ jobId: 'p1', status: 'QUEUED', total: 1 })
    // P1 第一次轮询挂起（pending promise，模拟 P1 request 在途）
    api.getProcessingJob.mockReturnValueOnce(new Promise((_, rej) => { rejectP1 = rej }))
    await replay.startProcessingJob()
    await vi.advanceTimersByTimeAsync(0)
    expect(replay.processingJob.value.status).toBe('QUEUED')

    // files 改变 → P1 invalidated + 后台取消 + 停止 P1 polling
    replay.updateFiles([new File(['y'], 'b.wotbreplay')])

    // P2 建立 polling（状态化 mock：第 1 次 PROCESSING，之后 READY）
    api.createProcessingJob.mockReset()
    api.createProcessingJob.mockResolvedValue({ jobId: 'p2', status: 'QUEUED', total: 1 })
    api.getProcessingJob.mockReset()
    api.getProcessingJob.mockImplementation(() => {
      const n = api.getProcessingJob.mock.calls.length
      return Promise.resolve(n === 1
        ? { jobId: 'p2', status: 'PROCESSING', phase: 'PROCESSING_REPLAYS', total: 1, processed: 0, valid: 0, duplicates: 0, failures: 0, errorCode: null, currentFile: 'b.wotbreplay' }
        : { jobId: 'p2', status: 'READY', phase: null, total: 1, processed: 1, valid: 1, duplicates: 0, failures: 0, errorCode: null, currentFile: null })
    })
    api.getProcessingJobResult.mockReset()
    api.getProcessingJobResult.mockResolvedValue({ battles: [{ mapName: 'Lagoon', sourceName: 'b.wotbreplay' }], aggregate: [], duplicates: [], failures: [], playerColumns: [], aggregateColumns: [] })
    await replay.startProcessingJob()
    await vi.advanceTimersByTimeAsync(0)
    expect(replay.processingJob.value.status).toBe('PROCESSING')

    // 旧 P1 request 迟到 reject → 不得清掉 P2 timer/token、不得覆盖 P2 processingError
    rejectP1(new Error('network'))
    await vi.advanceTimersByTimeAsync(0)
    expect(replay.processingError.value).toBe('')

    // P2 后续轮询不受影响：READY → 自动加载 result
    await vi.advanceTimersByTimeAsync(1500)
    expect(replay.processingJob.value.status).toBe('READY')
    expect(replay.processingJobId.value).toBe('p2')
    expect(replay.resp.value.battles[0].sourceName).toBe('b.wotbreplay')
    expect(replay.processingError.value).toBe('')
  })
})

describe('useReplay initial result tab (activeTab must point to a renderable panel)', () => {
  let replay

  function pJob(overrides = {}) {
    return { jobId: 'p1', status: 'QUEUED', phase: null, total: 2, processed: 0, valid: 0,
      duplicates: 0, failures: 0, errorCode: null, currentFile: null, ...overrides }
  }

  function readyWith(result) {
    api.createProcessingJob.mockResolvedValue({ jobId: 'p1', status: 'QUEUED', total: 2 })
    api.getProcessingJob
      .mockResolvedValueOnce(pJob({ status: 'PROCESSING', processed: 1, valid: 1 }))
      .mockResolvedValueOnce(pJob({ status: 'READY', processed: 2, valid: 2 }))
    api.getProcessingJobResult.mockResolvedValue(result)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    replay = useReplay()
    replay.files.value = [new File(['x'], 'a.wotbreplay'), new File(['y'], 'b.wotbreplay')]
  })

  afterEach(() => {
    vi.useRealTimers()
    replay.dismissProcessingJob()
    replay.dismissExportJob()
  })

  const base = { duplicates: [], failures: [], playerColumns: [], aggregateColumns: [] }
  const twoBattles = [
    { mapName: 'Lagoon', sourceName: 'a.wotbreplay' },
    { mapName: 'Frozen', sourceName: 'b.wotbreplay' }
  ]
  const league = { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] }

  it('Test A: 多场 + aggregate 空 + 无 league → READY 后 activeTab=b0', async () => {
    readyWith({ ...base, battles: twoBattles, aggregate: [] })
    await replay.startProcessingJob()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1500)
    expect(replay.resp.value.battles).toHaveLength(2)
    expect(replay.activeTab.value).toBe('b0')
  })

  it('Test B: 多场 + aggregate 有数据 + 无 league → READY 后 activeTab=aggregate', async () => {
    readyWith({ ...base, battles: twoBattles, aggregate: [{ cells: { nickname: 'P1', damage_dealt: 5000 } }] })
    await replay.startProcessingJob()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1500)
    expect(replay.activeTab.value).toBe('aggregate')
  })

  it('Test C: 多场 + aggregate 空 + leagueMode=true → READY 后 activeTab=aggregate（不 fallback 到 b0）', async () => {
    readyWith({ ...base, battles: twoBattles, aggregate: [], league, leagueMode: true })
    await replay.startProcessingJob()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1500)
    expect(replay.activeTab.value).toBe('aggregate')
  })

  it('Test D: 单场 + aggregate 空 + 无 league → READY 后 activeTab=b0', async () => {
    readyWith({ ...base, battles: [twoBattles[0]], aggregate: [] })
    await replay.startProcessingJob()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1500)
    expect(replay.activeTab.value).toBe('b0')
  })

  it('chooseInitialResultTab 纯函数：所有已知 response 的 activeTab 都指向真实 panel（invariant）', () => {
    const cases = [
      { result: { battles: twoBattles, aggregate: [], leagueMode: false }, expectTab: 'b0' },
      { result: { battles: twoBattles, aggregate: [{ cells: {} }], leagueMode: false }, expectTab: 'aggregate' },
      { result: { battles: twoBattles, aggregate: [], league, leagueMode: true }, expectTab: 'aggregate' },
      { result: { battles: [twoBattles[0]], aggregate: [], leagueMode: false }, expectTab: 'b0' },
      { result: { battles: [], aggregate: [], leagueMode: false }, expectTab: 'aggregate' }
    ]
    for (const { result, expectTab } of cases) {
      const tab = chooseInitialResultTab(result)
      expect(tab).toBe(expectTab)
      if (tab === 'aggregate') {
        // aggregate 有真实 panel 或（空结果）由页面空态兜底——绝不允许「指向不存在 panel 导致空白」
        const panelExists = result.leagueMode === true || (result.aggregate || []).length > 0
        const emptyStateCovers = !(result.battles || []).length && !panelExists
        expect(panelExists || emptyStateCovers).toBe(true)
      } else {
        const idx = parseInt(tab.replace('b', ''), 10)
        expect((result.battles || [])[idx]).toBeDefined()
      }
    }
  })
})
