// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { useReplaySession } from './useReplaySession.js'
import { useLocalReplayAnalysis } from './useLocalReplayAnalysis.js'
import { TANKOPEDIA, replayFile, preview, parsedOf } from '../test/LocalReplayAnalysisTestHelpers.js'

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
