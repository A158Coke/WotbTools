// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { ReplayEngineUnavailableError } from '../replay-local/parseReplays.js'
import { NoValidReplaysError } from '../replay-local/compute/index.js'
import { useReplaySession } from './useReplaySession.js'
import { useLocalReplayAnalysis } from './useLocalReplayAnalysis.js'

// 服务器没有 parser：分析 = 本机 Worker 解析 + 批次计算。mock 两个边界，保留真实错误类型。
const local = vi.hoisted(() => ({
  parseReplayFiles: vi.fn(),
  analyzeReplayBatch: vi.fn(),
  loadTankopedia: vi.fn(),
  exportAggregateXlsx: vi.fn(),
  exportEachZip: vi.fn(),
  downloadBlob: vi.fn(),
  recordUsage: vi.fn(),
}))

vi.mock('./useUsageTelemetry.js', () => ({ recordUsage: local.recordUsage }))

vi.mock('../replay-local/parseReplays.js', async (importOriginal) => ({
  ...(await importOriginal()),
  parseReplayFiles: local.parseReplayFiles,
}))
vi.mock('../replay-local/analyzeReplays.js', () => ({ analyzeReplayBatch: local.analyzeReplayBatch }))
vi.mock('../replay-local/compute/index.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadTankopedia: local.loadTankopedia,
}))
vi.mock('../replay-local/export/index.js', () => ({
  exportAggregateXlsx: local.exportAggregateXlsx,
  exportEachZip: local.exportEachZip,
}))
vi.mock('../utils/exportReplayPng.js', () => ({ downloadBlob: local.downloadBlob }))

const t = (key) => key
const TANKOPEDIA = { tanks: 'tankopedia' }

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function replayFile(name) {
  return new File([name], name)
}

function preview(battleCount = 1) {
  return {
    battles: Array.from({ length: battleCount }, (_, i) => ({ sourceId: `r${i}`, sourceName: `${i}.wotbreplay`, mapName: 'Lagoon', players: [] })),
    aggregate: [], duplicates: [], failures: [], playerColumns: [], aggregateColumns: [], leagueMode: false,
  }
}

function parsedOf(files) {
  return files.map(f => ({ name: f.name, result: { file: f.name }, error: null }))
}

let wrapper
function setup() {
  let api
  wrapper = mount(defineComponent({
    setup() {
      const session = useReplaySession()
      api = { session, ...useLocalReplayAnalysis(session, { t }) }
      return () => h('div')
    },
  }))
  return api
}

describe('useLocalReplayAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    local.loadTankopedia.mockResolvedValue(TANKOPEDIA)
    local.analyzeReplayBatch.mockImplementation((parsed) => ({ dataset: { parsed }, preview: preview(parsed.length) }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.restoreAllMocks()
  })

  it('empty selection → replay.no_files, nothing parsed, not completed', async () => {
    const { session, analyze } = setup()

    await expect(analyze()).resolves.toEqual({ completed: false, reason: 'EMPTY_SELECTION' })
    expect(session.error.value).toBe('replay.no_files')
    expect(local.parseReplayFiles).not.toHaveBeenCalled()
  })

  it('reports per-file parsing progress, then commits the preview and returns completed', async () => {
    const parse = deferred()
    let onProgress
    local.parseReplayFiles.mockImplementation((files, options) => { onProgress = options.onProgress; return parse.promise })
    const { session, updateFiles, analyze } = setup()
    const files = [replayFile('a.wotbreplay'), replayFile('b.wotbreplay')]
    updateFiles(files)

    const running = analyze()
    expect(session.analysis.value).toEqual({ phase: 'parsing', done: 0, total: 2, failure: null })
    expect(session.analysisActive.value).toBe(true)
    expect(session.loading.value).toBe(true)
    expect(local.parseReplayFiles).toHaveBeenCalledWith(files, expect.objectContaining({ signal: expect.any(AbortSignal) }))

    onProgress(1, 2)
    expect(session.analysis.value).toEqual({ phase: 'parsing', done: 1, total: 2, failure: null })

    const parsed = parsedOf(files)
    parse.resolve(parsed)
    await expect(running).resolves.toEqual({ completed: true })

    expect(local.analyzeReplayBatch).toHaveBeenCalledWith(parsed, TANKOPEDIA)
    expect(session.analysis.value).toEqual({ phase: 'ready', done: 2, total: 2, failure: null })
    expect(session.resp.value.battles).toHaveLength(2)
    expect(session.activeTab.value).toBe('b0')
    expect(session.loading.value).toBe(false)
  })

  it('a second analyze while parsing is rejected as ALREADY_ACTIVE', async () => {
    local.parseReplayFiles.mockReturnValue(new Promise(() => {}))
    const { updateFiles, analyze } = setup()
    updateFiles([replayFile('a.wotbreplay')])

    analyze()
    await expect(analyze()).resolves.toEqual({ completed: false, reason: 'ALREADY_ACTIVE' })
    expect(local.parseReplayFiles).toHaveBeenCalledTimes(1)
  })

  it('counts ten file attempts independently, including failures, without leaking file/error text', async () => {
    local.parseReplayFiles.mockImplementation(async (files, { onFile }) => {
      const parsed = parsedOf(files)
      parsed[4] = { name: files[4].name, result: null, error: 'private raw error' }
      parsed.forEach((result, index) => onFile(index, result))
      return parsed
    })
    const { updateFiles, analyze } = setup()
    updateFiles(Array.from({ length: 10 }, (_, i) => replayFile(`private-${i}.wotbreplay`)))
    await analyze()
    const events = local.recordUsage.mock.calls.map(([event]) => event)
    expect(events.filter(e => e.outcome === 'start')).toHaveLength(10)
    expect(events.filter(e => e.outcome === 'success')).toHaveLength(9)
    expect(events.filter(e => e.outcome === 'failure')).toHaveLength(1)
    expect(new Set(events.map(e => e.operation_id)).size).toBe(10)
    expect(JSON.stringify(events)).not.toContain('private')
  })

  it('settles only unfinished files when a batch fails after a per-file result', async () => {
    local.parseReplayFiles.mockImplementation(async (files, { onFile }) => {
      onFile(1, parsedOf(files)[1])
      throw new ReplayEngineUnavailableError('private worker failure')
    })
    const { updateFiles, analyze } = setup()
    updateFiles([replayFile('a'), replayFile('b'), replayFile('c')])
    await analyze()
    const events = local.recordUsage.mock.calls.map(([event]) => event)
    expect(events.filter(e => e.outcome === 'success')).toHaveLength(1)
    expect(events.filter(e => e.outcome === 'failure')).toHaveLength(2)
    expect(events.filter(e => e.error_code === 'RESOURCE_UNAVAILABLE')).toHaveLength(2)
  })

  it('cancel settles unfinished files once and ignores late per-file completion', async () => {
    const pending = deferred()
    let onFile
    local.parseReplayFiles.mockImplementation((files, options) => {
      onFile = options.onFile
      return pending.promise
    })
    const { updateFiles, analyze, cancel } = setup()
    const files = [replayFile('a'), replayFile('b')]
    updateFiles(files)
    const running = analyze()
    onFile(0, parsedOf(files)[0])
    cancel()
    onFile(1, parsedOf(files)[1])
    pending.resolve(parsedOf(files))
    await running
    const events = local.recordUsage.mock.calls.map(([event]) => event)
    expect(events.filter(e => e.outcome === 'success')).toHaveLength(1)
    expect(events.filter(e => e.outcome === 'cancelled')).toHaveLength(1)
    expect(events).toHaveLength(4)
  })

  it('engine unavailable → ENGINE_UNAVAILABLE failure and NOT completed (Android must not ACK)', async () => {
    local.parseReplayFiles.mockRejectedValue(new ReplayEngineUnavailableError('wasm missing'))
    const { session, updateFiles, analyze } = setup()
    updateFiles([replayFile('a.wotbreplay')])

    await expect(analyze()).resolves.toEqual({ completed: false, reason: 'ENGINE_UNAVAILABLE' })
    expect(session.analysis.value).toMatchObject({ phase: 'failed', failure: 'ENGINE_UNAVAILABLE' })
    expect(session.resp.value).toBeNull()
    expect(session.loading.value).toBe(false)
  })

  it('zero valid replays → NO_VALID_REPLAYS failure but completed (re-import would not differ)', async () => {
    local.parseReplayFiles.mockImplementation(async files => parsedOf(files))
    local.analyzeReplayBatch.mockImplementation(() => { throw new NoValidReplaysError() })
    const { session, updateFiles, analyze } = setup()
    updateFiles([replayFile('a.wotbreplay')])

    await expect(analyze()).resolves.toEqual({ completed: true })
    expect(session.analysis.value).toMatchObject({ phase: 'failed', failure: 'NO_VALID_REPLAYS' })
    expect(console.error).not.toHaveBeenCalled()
  })

  it('unexpected error → UNKNOWN failure, logged, completed', async () => {
    local.parseReplayFiles.mockImplementation(async files => parsedOf(files))
    local.analyzeReplayBatch.mockImplementation(() => { throw new TypeError('boom') })
    const { session, updateFiles, analyze } = setup()
    updateFiles([replayFile('a.wotbreplay')])

    await expect(analyze()).resolves.toEqual({ completed: true })
    expect(session.analysis.value).toMatchObject({ phase: 'failed', failure: 'UNKNOWN' })
    expect(console.error).toHaveBeenCalled()
  })

  it('cancel aborts the worker parse, marks CANCELLED and discards the late result', async () => {
    const parse = deferred()
    let signal
    local.parseReplayFiles.mockImplementation((files, options) => { signal = options.signal; return parse.promise })
    const { session, updateFiles, analyze, cancel } = setup()
    const files = [replayFile('a.wotbreplay')]
    updateFiles(files)

    const running = analyze()
    cancel()
    expect(signal.aborted).toBe(true)
    expect(session.analysis.value.phase).toBe('cancelled')
    expect(session.loading.value).toBe(false)

    parse.resolve(parsedOf(files))
    await expect(running).resolves.toEqual({ completed: false, reason: 'SUPERSEDED' })
    expect(session.resp.value).toBeNull()
    expect(session.analysis.value.phase).toBe('cancelled')
    expect(local.analyzeReplayBatch).not.toHaveBeenCalled()
  })

  it('a superseded selection discards the late result / failure of the old analysis', async () => {
    const parseA = deferred()
    const parseB = deferred()
    local.parseReplayFiles.mockReturnValueOnce(parseA.promise).mockReturnValueOnce(parseB.promise)
    const { session, updateFiles, analyze } = setup()
    const filesA = [replayFile('a.wotbreplay')]
    const filesB = [replayFile('b1.wotbreplay'), replayFile('b2.wotbreplay')]

    updateFiles(filesA)
    const runA = analyze()
    updateFiles(filesB)
    expect(session.analysis.value.phase).toBe('idle')
    const runB = analyze()

    parseA.reject(new ReplayEngineUnavailableError('late'))
    await expect(runA).resolves.toEqual({ completed: false, reason: 'SUPERSEDED' })
    expect(session.analysis.value).toEqual({ phase: 'parsing', done: 0, total: 2, failure: null })
    expect(session.loading.value).toBe(true)

    parseB.resolve(parsedOf(filesB))
    await expect(runB).resolves.toEqual({ completed: true })
    expect(session.resp.value.battles).toHaveLength(2)
  })

  it('updateFiles aborts the in-flight parse', async () => {
    let signal
    local.parseReplayFiles.mockImplementation((files, options) => { signal = options.signal; return new Promise(() => {}) })
    const { updateFiles, analyze } = setup()
    updateFiles([replayFile('a.wotbreplay')])
    analyze()

    updateFiles([replayFile('b.wotbreplay')])
    expect(signal.aborted).toBe(true)
  })

  it('unmount aborts the in-flight parse', async () => {
    let signal
    local.parseReplayFiles.mockImplementation((files, options) => { signal = options.signal; return new Promise(() => {}) })
    const { updateFiles, analyze } = setup()
    updateFiles([replayFile('a.wotbreplay')])
    analyze()

    wrapper.unmount()
    wrapper = null
    expect(signal.aborted).toBe(true)
  })

  describe('changeFiles', () => {
    async function ready(names) {
      local.parseReplayFiles.mockImplementation(async files => parsedOf(files))
      const api = setup()
      const files = names.map(replayFile)
      api.updateFiles(files)
      await api.analyze()
      await nextTick()
      local.parseReplayFiles.mockClear()
      return { ...api, files }
    }

    it('adding parses only the new file and keeps the old result on screen until commit', async () => {
      const api = await ready(['a.wotbreplay', 'b.wotbreplay'])
      api.session.selectBattle('r1')
      const pending = deferred()
      local.parseReplayFiles.mockReturnValueOnce(pending.promise)
      const c = replayFile('c.wotbreplay')
      const previous = api.session.resp.value

      const running = api.changeFiles([...api.files, c])
      await nextTick()
      expect(api.session.resp.value).toBe(previous)
      expect(api.session.loading.value).toBe(false)
      expect(api.session.analysis.value.phase).toBe('parsing')
      expect(api.session.currentTargetFile.value.name).toBe('b.wotbreplay')

      pending.resolve(parsedOf([c]))
      await running
      expect(local.parseReplayFiles).toHaveBeenCalledTimes(1)
      expect(local.parseReplayFiles.mock.calls[0][0]).toEqual([c])
      expect(api.session.resp.value.battles).toHaveLength(3)
      expect(api.session.analysis.value.phase).toBe('ready')
      await nextTick()
      expect(api.session.currentTargetFile.value.name).toBe('b.wotbreplay')
    })

    it('removing is a synchronous commit with no parse', async () => {
      const api = await ready(['a.wotbreplay', 'b.wotbreplay', 'c.wotbreplay'])
      api.session.selectBattle('r2')
      api.changeFiles(api.files.slice(1))
      expect(local.parseReplayFiles).not.toHaveBeenCalled()
      expect(api.session.resp.value.battles).toHaveLength(2)
      expect(api.session.currentTargetFile.value.name).toBe('c.wotbreplay')
    })

    it('a second add supersedes the first and keeps every accumulated file', async () => {
      const api = await ready(['a.wotbreplay'])
      let firstSignal
      local.parseReplayFiles.mockImplementationOnce((_files, { signal }) => {
        firstSignal = signal
        return new Promise(() => {})
      })
      const b = replayFile('b.wotbreplay')
      const c = replayFile('c.wotbreplay')
      void api.changeFiles([...api.files, b])
      await api.changeFiles([...api.files, b, c])
      expect(firstSignal.aborted).toBe(true)
      expect(local.parseReplayFiles.mock.calls[1][0]).toEqual([b, c])
      expect(api.session.files.value).toHaveLength(3)
      expect(api.session.resp.value.battles).toHaveLength(3)
    })

    it('an engine failure while adding keeps the battles that already work', async () => {
      const api = await ready(['a.wotbreplay'])
      const previous = api.session.resp.value
      local.parseReplayFiles.mockRejectedValueOnce(new ReplayEngineUnavailableError('wasm'))
      await expect(api.changeFiles([...api.files, replayFile('b.wotbreplay')]))
        .resolves.toEqual({ completed: false, reason: 'ENGINE_UNAVAILABLE' })
      expect(api.session.resp.value).toBe(previous)
      expect(api.session.analysis.value.phase).toBe('ready')
      expect(api.session.error.value).toBe('replay.analysis.engine_unavailable')
    })

    it('removing the last valid replay leaves the failure state', async () => {
      const api = await ready(['a.wotbreplay', 'b.wotbreplay'])
      local.analyzeReplayBatch.mockImplementationOnce(() => { throw new NoValidReplaysError() })
      await api.changeFiles(api.files.slice(1))
      expect(api.session.resp.value).toBeNull()
      expect(api.session.analysis.value).toMatchObject({ phase: 'failed', failure: 'NO_VALID_REPLAYS' })
    })

    it('explicit retry parses failed files again and reuses the good ones', async () => {
      const [good, bad] = [replayFile('good.wotbreplay'), replayFile('bad.wotbreplay')]
      local.parseReplayFiles.mockResolvedValueOnce([
        { name: good.name, result: { ok: true }, error: null },
        { name: bad.name, result: null, error: 'broken' },
      ])
      local.analyzeReplayBatch.mockImplementationOnce(() => { throw new NoValidReplaysError() })
      const api = setup()
      api.updateFiles([good, bad])
      await api.analyze()
      expect(api.session.analysis.value.phase).toBe('failed')

      local.parseReplayFiles.mockResolvedValueOnce(parsedOf([bad]))
      await api.analyze()
      expect(local.parseReplayFiles.mock.calls[1][0]).toEqual([bad])
      expect(api.session.analysis.value.phase).toBe('ready')
    })
  })

  describe('exportExcel', () => {
    async function analyzed() {
      local.parseReplayFiles.mockImplementation(async files => parsedOf(files))
      const api = setup()
      api.updateFiles([replayFile('a.wotbreplay')])
      await api.analyze()
      return api
    }

    it('aggregate exports the last analysed dataset (no re-parse) with team names and downloads it', async () => {
      const blob = new Blob(['xlsx'])
      local.exportAggregateXlsx.mockResolvedValue({ blob, filename: '联赛汇总.xlsx' })
      const { exportExcel } = await analyzed()
      const dataset = local.analyzeReplayBatch.mock.results[0].value.dataset

      await exportExcel('aggregate', { A: 'Alpha' })

      expect(local.exportAggregateXlsx).toHaveBeenCalledWith(dataset, TANKOPEDIA, { teamNames: { A: 'Alpha' } })
      expect(local.exportEachZip).not.toHaveBeenCalled()
      expect(local.downloadBlob).toHaveBeenCalledWith(blob, '联赛汇总.xlsx')
      expect(local.parseReplayFiles).toHaveBeenCalledTimes(1)
    })

    it('each exports the per-battle zip', async () => {
      const blob = new Blob(['zip'])
      local.exportEachZip.mockResolvedValue({ blob, filename: '逐场导出.zip' })
      const { exportExcel } = await analyzed()

      await exportExcel('each')

      expect(local.exportEachZip).toHaveBeenCalledWith(expect.anything(), TANKOPEDIA, { teamNames: undefined })
      expect(local.downloadBlob).toHaveBeenCalledWith(blob, '逐场导出.zip')
    })

    it('export failures propagate to the caller', async () => {
      local.exportAggregateXlsx.mockRejectedValue(new Error('exceljs failed'))
      const { exportExcel } = await analyzed()

      await expect(exportExcel('aggregate')).rejects.toThrow('exceljs failed')
      expect(local.downloadBlob).not.toHaveBeenCalled()
    })

    it('download failures propagate too (awaited), so the page can show the export error', async () => {
      local.exportAggregateXlsx.mockResolvedValue({ blob: new Blob(['x']), filename: 'a.xlsx' })
      local.downloadBlob.mockRejectedValueOnce(new Error('click blocked'))
      const { exportExcel } = await analyzed()

      await expect(exportExcel('aggregate')).rejects.toThrow('click blocked')
    })

    it('rejects (instead of silently succeeding) before any analysis and after the selection changes', async () => {
      const api = await analyzed()
      api.updateFiles([replayFile('b.wotbreplay')])
      await nextTick()

      await expect(api.exportExcel('aggregate')).rejects.toThrow(/no analysis result/)
      expect(local.exportAggregateXlsx).not.toHaveBeenCalled()
    })
  })
})
