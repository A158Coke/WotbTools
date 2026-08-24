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

  it('export after READY reuses processingJobId without re-uploading (plan §30)', async () => {
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

  it('startExportJob passes league team name overrides to api (PR #123 Blocker 1)', async () => {
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
describe('useReplay file-selection invalidation (review BLOCKER 1)', () => {
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

    // Export 不得传 p1：未重新解析的新 selection 走 legacy 上传当前 files
    api.createExportJob.mockResolvedValue({ jobId: 'e1', status: 'QUEUED', total: 10 })
    api.getExportJob.mockResolvedValue({ jobId: 'e1', status: 'READY', phase: null, total: 10, processed: 10, duplicates: 0, failures: 0, filename: 'x.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await replay.startExportJob('aggregate')
    expect(api.createExportJob).toHaveBeenCalledTimes(1)
    const [body, mode, jobId] = api.createExportJob.mock.calls[0]
    expect(body).not.toBeNull()
    expect(mode).toBe('aggregate')
    expect(jobId).toBeUndefined()
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
  it('Case: stale P1 reject 不停止 P2 polling（review BLOCKER 1 stale error race）', async () => {
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

describe('useReplay initial result tab (P0: activeTab must point to a renderable panel)', () => {
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

  it('Test A: 多场 + aggregate 空 + 无 league → READY 后 activeTab=b0（P0 核心回归）', async () => {
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

  it('Test C: 多场 + aggregate 空 + league 存在 → READY 后 activeTab=aggregate（不 fallback 到 b0）', async () => {
    readyWith({ ...base, battles: twoBattles, aggregate: [], league })
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
      { result: { battles: twoBattles, aggregate: [], league: null }, expectTab: 'b0' },
      { result: { battles: twoBattles, aggregate: [{ cells: {} }], league: null }, expectTab: 'aggregate' },
      { result: { battles: twoBattles, aggregate: [], league }, expectTab: 'aggregate' },
      { result: { battles: [twoBattles[0]], aggregate: [], league: null }, expectTab: 'b0' },
      { result: { battles: [], aggregate: [], league: null }, expectTab: 'aggregate' }
    ]
    for (const { result, expectTab } of cases) {
      const tab = chooseInitialResultTab(result)
      expect(tab).toBe(expectTab)
      if (tab === 'aggregate') {
        // aggregate 有真实 panel 或（空结果）由页面空态兜底——绝不允许「指向不存在 panel 导致空白」
        const panelExists = !!result.league || (result.aggregate || []).length > 0
        const emptyStateCovers = !(result.battles || []).length && !panelExists
        expect(panelExists || emptyStateCovers).toBe(true)
      } else {
        const idx = parseInt(tab.replace('b', ''), 10)
        expect((result.battles || [])[idx]).toBeDefined()
      }
    }
  })
})