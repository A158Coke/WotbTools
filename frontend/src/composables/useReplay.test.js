// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
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

// ---- 最终终审：REGISTERING/UPLOADING 取消语义 / unmount ownership / stale async / READY reuse ----

describe('useReplay 最终终审 lifecycle（BLOCKER 1/2/3）', () => {
  let replay

  function deferred() {
    let resolve
    let reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  function apiError(code, status) {
    return Object.assign(new Error(code), { name: 'ApiError', code, status })
  }

  /** 挂载一个使用 useReplay 的组件（让 onUnmounted 真实执行），返回 replay + unmount。 */
  function mountReplayHarness() {
    let captured
    const wrapper = mount(defineComponent({
      setup() {
        captured = useReplay()
        return () => h('div')
      }
    }))
    return { wrapper, replay: captured }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    replay = useReplay()
    replay.files.value = [new File(['a'], 'a.wotbreplay')]
    api.cancelProcessingJob.mockResolvedValue(undefined)
    api.getProcessingJobResult.mockResolvedValue({ battles: [] })
    // 默认主 poll 挂起：避免 bind 后立即 tick 拿到 undefined 覆盖 processingJob（各测试按需覆盖）。
    api.getProcessingJob.mockReturnValue(new Promise(() => {}))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('REGISTERING cancel：不 abort request、标记取消；202 返回后 cancel 且永不绑定（无 orphan）', async () => {
    const dCreate = deferred()
    let capturedOpts
    api.createProcessingJob.mockImplementation((body, opts) => {
      capturedOpts = opts
      opts.onProgress({ loaded: 100, total: 100, percent: 100 }) // REGISTERING
      return dCreate.promise
    })
    api.getProcessingJob.mockReturnValue(new Promise(() => {})) // 主 poll 挂起

    const pStart = replay.startProcessingJob(null)
    expect(replay.uploadState.value?.phase).toBe('REGISTERING')
    replay.cancelProcessing()
    expect(capturedOpts.signal.aborted).toBe(false, 'REGISTERING cancel 不得 abort HTTP request（会丢 jobId）')

    dCreate.resolve({ jobId: 'p1', status: 'QUEUED', total: 1 })
    await pStart
    expect(api.cancelProcessingJob).toHaveBeenCalledTimes(1)
    expect(api.cancelProcessingJob).toHaveBeenCalledWith('p1')
    expect(replay.processingJob.value).toBeNull('p1 不得绑定 processingJob')
    expect(replay.processingJobId.value).toBeNull('p1 不得成为当前 Dataset')
    expect(api.getProcessingJob.mock.calls.some(([id]) => id === 'p1')).toBe(false, 'p1 无主 poll')
    expect(replay.uploadState.value).toBeNull()
  })

  it('REGISTERING cancel + 立即重试：旧 create settle 前 create 只调 1 次，settle 后才允许 p2', async () => {
    const dP1 = deferred()
    let capturedOpts
    api.createProcessingJob.mockImplementation((body, opts) => {
      capturedOpts = opts
      opts.onProgress({ loaded: 100, total: 100, percent: 100 })
      return dP1.promise
    })
    api.getProcessingJob.mockReturnValue(new Promise(() => {}))

    const pOld = replay.startProcessingJob(null) // p1 REGISTERING
    replay.cancelProcessing() // REGISTERING cancel
    const pRetry = replay.startProcessingJob(null) // 立即重试
    expect(api.createProcessingJob).toHaveBeenCalledTimes(1, 'p1 settle 前不得 create p2（single-flight）')

    dP1.resolve({ jobId: 'p1', status: 'QUEUED', total: 1 })
    await pOld
    expect(api.cancelProcessingJob).toHaveBeenCalledWith('p1')
    await vi.advanceTimersByTimeAsync(0)
    expect(api.createProcessingJob).toHaveBeenCalledTimes(2, 'p1 lifecycle 结束后才允许 p2')
    expect(capturedOpts.signal.aborted).toBe(false)
    await pRetry
  })

  it('ReplayPage unmount：owned QUEUED/PROCESSING job 必须 best-effort cancel', async () => {
    const { wrapper, replay: mountedReplay } = mountReplayHarness()
    mountedReplay.files.value = [new File(['a'], 'a.wotbreplay')]
    api.createProcessingJob.mockResolvedValue({ jobId: 'p1', status: 'QUEUED', total: 1 })
    api.getProcessingJob.mockReturnValue(new Promise(() => {}))

    await mountedReplay.startProcessingJob(null)
    expect(mountedReplay.processingJob.value?.jobId).toBe('p1')
    wrapper.unmount()
    expect(api.cancelProcessingJob).toHaveBeenCalledWith('p1')
  })

  it('REGISTERING unmount：不 abort，202 返回后 cancel（绝不 orphan）', async () => {
    const { wrapper, replay: mountedReplay } = mountReplayHarness()
    mountedReplay.files.value = [new File(['a'], 'a.wotbreplay')]
    const dCreate = deferred()
    let capturedOpts
    api.createProcessingJob.mockImplementation((body, opts) => {
      capturedOpts = opts
      opts.onProgress({ loaded: 100, total: 100, percent: 100 })
      return dCreate.promise
    })
    api.getProcessingJob.mockReturnValue(new Promise(() => {}))

    const pStart = mountedReplay.startProcessingJob(null)
    wrapper.unmount() // REGISTERING unmount：不得 abort
    expect(capturedOpts.signal.aborted).toBe(false)

    dCreate.resolve({ jobId: 'p1', status: 'QUEUED', total: 1 })
    await pStart
    expect(api.cancelProcessingJob).toHaveBeenCalledWith('p1')
  })

  it('stale status resolve：A poll 迟到 resolve 不得写 B 的 loading/job/error（零写入）', async () => {
    const dPollA = deferred()
    api.createProcessingJob.mockResolvedValueOnce({ jobId: 'pA', status: 'QUEUED', total: 1 })
    api.getProcessingJob.mockReturnValueOnce(dPollA.promise) // A 主 poll 挂起
    const pA = replay.startProcessingJob(null)
    await vi.advanceTimersByTimeAsync(0)
    expect(replay.processingJob.value?.jobId).toBe('pA')

    replay.updateFiles([new File(['b'], 'b.wotbreplay')]) // selection → B
    const dB = deferred()
    api.createProcessingJob.mockReturnValueOnce(dB.promise)
    const pB = replay.startProcessingJob(null) // B loading=true
    expect(replay.loading.value).toBe(true)

    dPollA.resolve({ jobId: 'pA', status: 'READY', total: 1, sources: [] }) // A 迟到 resolve
    await vi.advanceTimersByTimeAsync(0)
    expect(replay.loading.value).toBe(true, 'stale A 不得清 B loading')
    expect(replay.processingJob.value).toBeNull()
    expect(replay.processingError.value).toBe('')
    expect(replay.resp.value).toBeNull()
    dB.resolve({ jobId: 'pB', status: 'QUEUED', total: 1 })
    await pA
    await pB
  })

  it('stale status reject：A poll 迟到 reject 不得影响 B', async () => {
    const dPollA = deferred()
    api.createProcessingJob.mockResolvedValueOnce({ jobId: 'pA', status: 'QUEUED', total: 1 })
    api.getProcessingJob.mockReturnValueOnce(dPollA.promise)
    const pA = replay.startProcessingJob(null)
    await vi.advanceTimersByTimeAsync(0)

    replay.updateFiles([new File(['b'], 'b.wotbreplay')])
    const dB = deferred()
    api.createProcessingJob.mockReturnValueOnce(dB.promise)
    const pB = replay.startProcessingJob(null)

    dPollA.reject(apiError('HTTP_500', 500)) // A 迟到 reject
    await vi.advanceTimersByTimeAsync(0)
    expect(replay.loading.value).toBe(true)
    expect(replay.processingError.value).toBe('')
    dB.resolve({ jobId: 'pB', status: 'QUEUED', total: 1 })
    await pA
    await pB
  })

  it('stale READY result：A result 迟到 resolve 不得覆盖 B（resp/id/activeTab/loading 零写入）', async () => {
    const dResultA = deferred()
    api.createProcessingJob.mockResolvedValueOnce({ jobId: 'pA', status: 'QUEUED', total: 1 })
    api.getProcessingJob.mockResolvedValueOnce({
      jobId: 'pA', status: 'READY', total: 1,
      sources: [{ sourceId: 'r0', status: 'READY' }]
    })
    api.getProcessingJobResult.mockReturnValueOnce(dResultA.promise)
    const pA = replay.startProcessingJob(null)
    await vi.advanceTimersByTimeAsync(0) // 主 poll 立即 tick → READY → result fetch 挂起

    replay.updateFiles([new File(['b'], 'b.wotbreplay')]) // A result 期间 selection → B
    const dB = deferred()
    api.createProcessingJob.mockReturnValueOnce(dB.promise)
    const pB = replay.startProcessingJob(null)
    expect(replay.loading.value).toBe(true)

    dResultA.resolve({ battles: [{ mapName: 'A' }] }) // A 迟到 result
    await vi.advanceTimersByTimeAsync(0)
    expect(replay.loading.value).toBe(true, 'stale A result 不得清 B loading')
    expect(replay.resp.value).toBeNull('stale A result 不得写 resp')
    expect(replay.processingJobId.value).toBeNull()
    expect(replay.activeTab.value).toBe('aggregate')
    dB.resolve({ jobId: 'pB', status: 'QUEUED', total: 1 })
    await pA
    await pB
  })

  it('READY 后普通 Preview 复用现有 result：不重新 create / upload / parse', async () => {
    const result = { battles: [{ mapName: 'A' }] }
    api.createProcessingJob.mockResolvedValue({ jobId: 'p1', status: 'QUEUED', total: 1 })
    api.getProcessingJob.mockResolvedValue({
      jobId: 'p1', status: 'READY', total: 1,
      sources: [{ sourceId: 'r0', status: 'READY' }]
    })
    api.getProcessingJobResult.mockResolvedValue(result)
    const onColumnsInit = vi.fn()

    await replay.startProcessingJob(onColumnsInit) // 首次 parse → READY
    await vi.advanceTimersByTimeAsync(1500)
    expect(replay.processingJobId.value).toBe('p1')
    expect(replay.resp.value).toEqual(result)

    const callsBefore = api.createProcessingJob.mock.calls.length
    await replay.startProcessingJob(onColumnsInit) // 再次 Preview
    expect(api.createProcessingJob.mock.calls.length).toBe(callsBefore, 'READY 后不得重新 create')
    expect(replay.processingJobId.value).toBe('p1')
    expect(replay.resp.value).toEqual(result)
    expect(onColumnsInit).toHaveBeenCalledWith(result)
  })

  it('READY direct action 复用现有 dataset：不 create', async () => {
    api.createProcessingJob.mockResolvedValue({ jobId: 'p1', status: 'QUEUED', total: 1 })
    api.getProcessingJob.mockResolvedValue({
      jobId: 'p1', status: 'READY', total: 1,
      sources: [{ sourceId: 'r0', status: 'READY' }]
    })
    api.getProcessingJobResult.mockResolvedValue({ battles: [] })
    await replay.startProcessingJob(null)
    await vi.advanceTimersByTimeAsync(1500)
    expect(replay.processingJobId.value).toBe('p1')

    const callsBefore = api.createProcessingJob.mock.calls.length
    const ref = await replay.requestDirectAction(replay.files.value[0], 'ai')
    expect(ref).toEqual({ processingJobId: 'p1', sourceId: 'r0' })
    expect(api.createProcessingJob.mock.calls.length).toBe(callsBefore)
  })

  it('GET p1 transient 502：传播错误、不重建 Dataset、processingJobId 保留', async () => {
    replay.processingJobId.value = 'p1'
    api.getProcessingJob.mockRejectedValue(apiError('HTTP_502', 502))
    await expect(replay.requestDirectAction(replay.files.value[0], 'ai')).rejects.toMatchObject({ code: 'HTTP_502' })
    expect(api.createProcessingJob).not.toHaveBeenCalled()
    expect(replay.processingJobId.value).toBe('p1')
  })

  it('GET p1 network failure：同样传播、不重建', async () => {
    replay.processingJobId.value = 'p1'
    api.getProcessingJob.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(replay.requestDirectAction(replay.files.value[0], 'ai')).rejects.toThrow()
    expect(api.createProcessingJob).not.toHaveBeenCalled()
    expect(replay.processingJobId.value).toBe('p1')
  })

  it('GET p1 稳定 JOB_NOT_FOUND：invalidate 后重建 p2 exactly once（single-flight）', async () => {
    replay.processingJobId.value = 'p1'
    api.getProcessingJob
      .mockRejectedValueOnce(apiError('JOB_NOT_FOUND', 404))
      .mockResolvedValue({
        jobId: 'p2', status: 'READY', total: 1,
        sources: [{ sourceId: 'r0', status: 'READY' }]
      })
    api.createProcessingJob.mockResolvedValue({ jobId: 'p2', status: 'QUEUED', total: 1 })

    const ref = await replay.requestDirectAction(replay.files.value[0], 'ai')
    expect(api.createProcessingJob).toHaveBeenCalledTimes(1)
    expect(ref).toEqual({ processingJobId: 'p2', sourceId: 'r0' })
  })

  it('TTL expired：processingJob snapshot 也指向过期 p1 → 强制失效 snapshot，重建 p2 且绝不再返回 p1', async () => {
    // 完整复现生产 TTL-expiry：processingJobId 与 processingJob.value 都持有 p1 READY snapshot。
    // 旧实现只清 processingJobId，随后步骤 2 会从 READY snapshot 重新返回已过期的 p1。
    replay.processingJobId.value = 'p1'
    replay.processingJob.value = {
      jobId: 'p1', status: 'READY', total: 1,
      sources: [{ sourceId: 'r0', status: 'READY' }]
    }
    replay.resp.value = { battles: [{ mapName: 'ORIGINAL_P1_RESULT' }] }
    api.getProcessingJob
      .mockRejectedValueOnce(apiError('JOB_NOT_FOUND', 404)) // authoritative GET p1 → expired
      .mockResolvedValue({
        jobId: 'p2', status: 'READY', total: 1,
        sources: [{ sourceId: 'r0', status: 'READY' }]
      })
    api.createProcessingJob.mockResolvedValue({ jobId: 'p2', status: 'QUEUED', total: 1 })

    const ref = await replay.requestDirectAction(replay.files.value[0], 'ai')

    expect(api.createProcessingJob).toHaveBeenCalledTimes(1, 'TTL 过期重建只 create 一次（single-flight）')
    expect(ref).toEqual({ processingJobId: 'p2', sourceId: 'r0' }, '必须返回 p2/r0，绝不能再返回 p1')

    // p1 永远不能重新成为 Dataset reference / processingJob snapshot
    expect(replay.processingJob.value?.jobId).toBe('p2', 'processingJob snapshot 必须是重建后的 p2，不是过期 p1')
    expect(replay.processingJobId.value).not.toBe('p1', 'Dataset reference 不得回指过期 p1')

    // resp 保留（TTL 过期不无必要清空用户已展示的解析结果）
    expect(replay.resp.value).not.toBeNull('过期只失效 dataset identity，不清空 resp')
  })
})

// ---- BLOCKER：pollSourceReady 取消必须 exactly-once settle（绝不永久 pending / 双 terminal）----

describe('useReplay source poll exactly-once settlement（pollSourceReady cancellation）', () => {
  let replay

  function deferred() {
    let resolve
    let reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  function mountReplayHarness() {
    let captured
    const wrapper = mount(defineComponent({
      setup() {
        captured = useReplay()
        return () => h('div')
      }
    }))
    return { wrapper, replay: captured }
  }

  /** 当前 active Processing Job（requestDirectAction 路径 2：无预检查 GET，直接进入 pollSourceReady）。 */
  function activeJob(jobId = 'p1', sourceStatus = 'PROCESSING') {
    return { jobId, status: 'PROCESSING', total: 1, sources: [{ sourceId: 'r0', status: sourceStatus }] }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    replay = useReplay()
    replay.files.value = [new File(['a'], 'a.wotbreplay')]
    replay.processingJob.value = activeJob('p1')
    api.cancelProcessingJob.mockResolvedValue(undefined)
    api.getProcessingJobResult.mockResolvedValue({ battles: [] })
    api.getProcessingJob.mockReturnValue(new Promise(() => {})) // 默认 GET 挂起
  })

  afterEach(() => {
    vi.useRealTimers()
    replay.dismissProcessingJob()
  })

  it('Test 1 — GET pending 时 abort，迟到 resolve → 以 SOURCE_POLL_CANCELLED settle（exactly once、旧响应零写入）', async () => {
    const dGet = deferred()
    api.getProcessingJob.mockReturnValueOnce(dGet.promise)

    const pDirect = replay.requestDirectAction(replay.files.value[0], 'ai')
    expect(api.getProcessingJob).toHaveBeenCalledTimes(1, 'pollSourceReady 已发起第一次 GET')

    let settledWith = null
    pDirect.catch(e => { settledWith = e.message })

    replay.updateFiles([new File(['b'], 'b.wotbreplay')]) // selection change → stopSourcePolls → abort
    await vi.advanceTimersByTimeAsync(0) // flush microtask：abort 的 rejection 已送达
    expect(settledWith).toBe('SOURCE_POLL_CANCELLED', 'abort 后立即 settle，不等迟到 GET')

    dGet.resolve({ jobId: 'p1', status: 'READY', sources: [{ sourceId: 'r0', status: 'READY' }] }) // 迟到响应
    await vi.advanceTimersByTimeAsync(0)
    expect(settledWith).toBe('SOURCE_POLL_CANCELLED', '迟到 resolve 不得改变 terminal（exactly once）')
    await expect(pDirect).rejects.toMatchObject({ message: 'SOURCE_POLL_CANCELLED' })
    expect(replay.processingError.value).toBe('')
    expect(replay.processingJobId.value).toBeNull()
    expect(replay.resp.value).toBeNull()
    expect(replay.processingJob.value).toBeNull()
  })

  it('Test 2 — GET pending 时 abort，迟到 reject → 仍以 cancellation settle（不写错误、不重建 job）', async () => {
    const dGet = deferred()
    api.getProcessingJob.mockReturnValueOnce(dGet.promise)

    const pDirect = replay.requestDirectAction(replay.files.value[0], 'ai')
    pDirect.catch(() => {}) // 预挂 handler：abort 先于断言触发时避免 unhandled rejection
    replay.updateFiles([new File(['b'], 'b.wotbreplay')]) // abort

    dGet.reject(new TypeError('Failed to fetch')) // 迟到网络失败
    await vi.advanceTimersByTimeAsync(0)
    await expect(pDirect).rejects.toMatchObject({ message: 'SOURCE_POLL_CANCELLED' })
    expect(replay.processingError.value).toBe('')
    expect(api.createProcessingJob).not.toHaveBeenCalled()
  })

  it('Test 3 — timer 等待中 abort：timer 清除、Promise reject、不再发 GET', async () => {
    api.getProcessingJob.mockResolvedValue({
      jobId: 'p1', status: 'QUEUED',
      sources: [{ sourceId: 'r0', status: 'PROCESSING' }]
    })

    const pDirect = replay.requestDirectAction(replay.files.value[0], 'ai')
    await vi.advanceTimersByTimeAsync(0) // 第一次 GET → QUEUED → 注册 750ms timer
    const callsBefore = api.getProcessingJob.mock.calls.length

    let settledWith = null
    pDirect.catch(e => { settledWith = e.message })
    replay.updateFiles([new File(['b'], 'b.wotbreplay')]) // stopSourcePolls → clear timer + abort
    await vi.advanceTimersByTimeAsync(0)
    expect(settledWith).toBe('SOURCE_POLL_CANCELLED')

    await vi.advanceTimersByTimeAsync(5000)
    expect(api.getProcessingJob.mock.calls.length).toBe(callsBefore, '取消后不得再发 GET')
    await expect(pDirect).rejects.toMatchObject({ message: 'SOURCE_POLL_CANCELLED' })
  })

  it('Test 4 — READY 与 abort 紧邻交错：只出现一个 terminal（READY resolve 或 cancellation reject，绝不 both/neither）', async () => {
    // 4a：READY resolve 先于 abort → resolve；随后的 abort 不得改 terminal
    const dReady = deferred()
    api.getProcessingJob.mockReturnValueOnce(dReady.promise)
    const pReady = replay.requestDirectAction(replay.files.value[0], 'ai')
    dReady.resolve({ jobId: 'p1', status: 'READY', sources: [{ sourceId: 'r0', status: 'READY' }] })
    await vi.advanceTimersByTimeAsync(0) // poll 续体先于 abort 运行 → READY resolve
    replay.updateFiles([new File(['b'], 'b.wotbreplay')]) // abort 迟到 → 不得二次 terminal
    await expect(pReady).resolves.toEqual({ processingJobId: 'p1', sourceId: 'r0' })

    // 4b：abort 先于 READY resolve → cancellation reject；迟到的 READY 不得二次 terminal
    replay.processingJob.value = activeJob('p1') // updateFiles 已清空，重建当前 active job
    const dAbort = deferred()
    api.getProcessingJob.mockReturnValueOnce(dAbort.promise)
    const pAbort = replay.requestDirectAction(replay.files.value[0], 'ai')
    pAbort.catch(() => {}) // 预挂 handler：abort 先于断言触发时避免 unhandled rejection
    replay.updateFiles([new File(['c'], 'c.wotbreplay')]) // abort 先到
    dAbort.resolve({ jobId: 'p1', status: 'READY', sources: [{ sourceId: 'r0', status: 'READY' }] }) // 迟到 READY
    await vi.advanceTimersByTimeAsync(0)
    await expect(pAbort).rejects.toMatchObject({ message: 'SOURCE_POLL_CANCELLED' })
    expect(replay.processingError.value).toBe('')
  })

  it('Test 5 — 多个 Direct Action（AI + Playback）selection change：两个 poll 都 settle cancellation、registry 清空、无 lifecycle 泄漏', async () => {
    const fileA = new File(['a'], 'a.wotbreplay')
    const fileB = new File(['b'], 'b.wotbreplay')
    replay.files.value = [fileA, fileB]
    replay.processingJob.value = {
      jobId: 'p1', status: 'PROCESSING', total: 2,
      sources: [
        { sourceId: 'r0', status: 'PROCESSING' },
        { sourceId: 'r1', status: 'PROCESSING' }
      ]
    }
    api.getProcessingJob.mockReturnValue(new Promise(() => {})) // 两个 poll 的 GET 都 pending

    const abortSpy = vi.spyOn(AbortController.prototype, 'abort')
    try {
      const pA = replay.requestDirectAction(fileA, 'ai')
      const pB = replay.requestDirectAction(fileB, 'playback')
      expect(api.getProcessingJob).toHaveBeenCalledTimes(2)

      const results = []
      pA.catch(e => results.push(e.message))
      pB.catch(e => results.push(e.message))

      replay.updateFiles([new File(['c'], 'c.wotbreplay')]) // selection change → stopSourcePolls
      await vi.advanceTimersByTimeAsync(0)
      expect(results).toEqual(['SOURCE_POLL_CANCELLED', 'SOURCE_POLL_CANCELLED'])

      const abortsAfterFirstStop = abortSpy.mock.calls.length
      await vi.advanceTimersByTimeAsync(5000)
      expect(api.getProcessingJob.mock.calls.length).toBe(2, '取消后无 timer/request 泄漏')

      replay.updateFiles([new File(['d'], 'd.wotbreplay')]) // registry 已清空 → 不再 abort 任何 poll
      expect(abortSpy.mock.calls.length).toBe(abortsAfterFirstStop, 'settle 后 registry 必须清空')

      await expect(pA).rejects.toMatchObject({ message: 'SOURCE_POLL_CANCELLED' })
      await expect(pB).rejects.toMatchObject({ message: 'SOURCE_POLL_CANCELLED' })
      expect(api.createProcessingJob).not.toHaveBeenCalled()
      expect(replay.processingError.value).toBe('')
    } finally {
      abortSpy.mockRestore()
    }
  })

  it('teardown（unmount）中止 source poll：以 cancellation settle', async () => {
    const { wrapper, replay: mountedReplay } = mountReplayHarness()
    mountedReplay.files.value = [new File(['a'], 'a.wotbreplay')]
    mountedReplay.processingJob.value = activeJob('p1')
    api.getProcessingJob.mockReturnValue(new Promise(() => {}))

    const pDirect = mountedReplay.requestDirectAction(mountedReplay.files.value[0], 'ai')
    pDirect.catch(() => {}) // 预挂 handler：unmount 的 abort 先于断言触发时避免 unhandled rejection
    wrapper.unmount() // onUnmounted → stopSourcePolls → abort
    await vi.advanceTimersByTimeAsync(0)
    await expect(pDirect).rejects.toMatchObject({ message: 'SOURCE_POLL_CANCELLED' })
  })

  it('source FAILED → SOURCE_PROCESSING_FAILED（业务语义保留）', async () => {
    api.getProcessingJob.mockResolvedValue({
      jobId: 'p1', status: 'PROCESSING',
      sources: [{ sourceId: 'r0', status: 'FAILED' }]
    })
    await expect(replay.requestDirectAction(replay.files.value[0], 'ai'))
      .rejects.toMatchObject({ message: 'SOURCE_PROCESSING_FAILED' })
  })

  it('job terminal 但 source 未 READY → SOURCE_NOT_READY', async () => {
    api.getProcessingJob.mockResolvedValue({
      jobId: 'p1', status: 'READY',
      sources: [{ sourceId: 'r0', status: 'PROCESSING' }]
    })
    await expect(replay.requestDirectAction(replay.files.value[0], 'ai'))
      .rejects.toMatchObject({ message: 'SOURCE_NOT_READY' })
  })

  it('GET 网络失败未取消 → 原样传播（不是 cancellation）', async () => {
    api.getProcessingJob.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(replay.requestDirectAction(replay.files.value[0], 'ai')).rejects.toThrow('Failed to fetch')
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
