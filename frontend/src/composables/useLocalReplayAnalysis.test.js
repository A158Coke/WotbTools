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
}))

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
    const { session, updateFiles, analyze, parsedFiles } = setup()
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
    expect(parsedFiles()).toBe(parsed)
  })

  it('a second analyze while parsing is rejected as ALREADY_ACTIVE', async () => {
    local.parseReplayFiles.mockReturnValue(new Promise(() => {}))
    const { updateFiles, analyze } = setup()
    updateFiles([replayFile('a.wotbreplay')])

    analyze()
    await expect(analyze()).resolves.toEqual({ completed: false, reason: 'ALREADY_ACTIVE' })
    expect(local.parseReplayFiles).toHaveBeenCalledTimes(1)
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

  it('dismiss resets a terminal state but is ignored while parsing', async () => {
    local.parseReplayFiles.mockRejectedValueOnce(new Error('x')).mockReturnValueOnce(new Promise(() => {}))
    const { session, updateFiles, analyze, dismiss } = setup()
    updateFiles([replayFile('a.wotbreplay')])
    await analyze()

    dismiss()
    expect(session.analysis.value).toEqual({ phase: 'idle', done: 0, total: 0, failure: null })

    analyze()
    dismiss()
    expect(session.analysis.value.phase).toBe('parsing')
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
      expect(api.parsedFiles()).toEqual([])
    })
  })
})
