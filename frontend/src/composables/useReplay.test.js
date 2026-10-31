// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useReplay, chooseInitialResultTab } from './useReplay.js'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: { value: 'en' }, t: key => key, te: () => false }),
}))

// facade 只编排 session + 本机分析；mock 解析 / 计算边界（服务器没有 parser，也没有 job API）。
const local = vi.hoisted(() => ({
  parseReplayFiles: vi.fn(),
  analyzeReplayBatch: vi.fn(),
  loadTankopedia: vi.fn(async () => ({})),
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

const base = { duplicates: [], failures: [], playerColumns: [], aggregateColumns: [] }

/** 按解析出的文件名构造 Preview：每个文件一场 */
function previewFor(parsed, extra = {}) {
  return {
    ...base,
    aggregate: [],
    leagueMode: false,
    battles: parsed.map((p, i) => ({ sourceId: `r${i}`, sourceName: p.name, mapName: 'Lagoon', players: [] })),
    ...extra,
  }
}

let wrapper
function setup() {
  let replay
  wrapper = mount(defineComponent({
    setup() {
      replay = useReplay()
      return () => h('div')
    },
  }))
  return replay
}

describe('useReplay facade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    local.parseReplayFiles.mockImplementation(async files => files.map(f => ({ name: f.name, result: {}, error: null })))
    local.analyzeReplayBatch.mockImplementation(parsed => ({ dataset: {}, preview: previewFor(parsed) }))
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  it('exposes the local analysis API and no server job members', () => {
    const replay = setup()
    for (const key of ['analysis', 'analysisActive', 'updateFiles', 'analyze', 'cancelAnalysis', 'changeFiles', 'exportExcel']) {
      expect(replay[key], key).toBeDefined()
    }
    for (const key of ['processingJob', 'processingJobId', 'exportJob', 'uploadState', 'startProcessingJob', 'startExportJob']) {
      expect(replay[key], key).toBeUndefined()
    }
  })

  it('updateFiles + analyze runs the local pipeline and commits the result', async () => {
    const replay = setup()
    const files = [new File(['a'], 'a.wotbreplay'), new File(['b'], 'b.wotbreplay')]
    replay.updateFiles(files)

    await expect(replay.analyze()).resolves.toEqual({ completed: true })
    expect(local.parseReplayFiles).toHaveBeenCalledWith(files, expect.anything())
    expect(replay.analysis.value.phase).toBe('ready')
    expect(replay.parsedBattles.value.map(b => b.sourceName)).toEqual(['a.wotbreplay', 'b.wotbreplay'])
  })

  it('confirmRemove recomputes without parsing; removing the last file clears', async () => {
    const replay = setup()
    const a = new File(['a'], 'a.wotbreplay')
    const b = new File(['b'], 'b.wotbreplay')
    replay.updateFiles([a, b])
    await replay.analyze()
    const revision = replay.selectionRevision.value

    replay.askRemoveFile(a)
    expect(replay.pendingRemove.value).toMatchObject({ file: a, label: 'a.wotbreplay' })
    replay.confirmRemove()
    await flushPromises()
    expect(replay.pendingRemove.value).toBeNull()
    expect(replay.files.value).toEqual([b])
    expect(replay.selectionRevision.value).toBe(revision + 1)
    expect(local.parseReplayFiles).toHaveBeenCalledTimes(1)
    expect(replay.parsedBattles.value.map(x => x.sourceName)).toEqual(['b.wotbreplay'])

    replay.askRemoveFile(b)
    replay.confirmRemove()
    await flushPromises()
    expect(replay.files.value).toEqual([])
    expect(replay.resp.value).toBeNull()
    expect(replay.analysis.value.phase).toBe('idle')
    expect(local.parseReplayFiles).toHaveBeenCalledTimes(1)
  })

  it('cancelRemove never touches the selection', async () => {
    const replay = setup()
    const a = new File(['a'], 'a.wotbreplay')
    replay.updateFiles([a])

    replay.askRemoveFile(a)
    replay.cancelRemove()
    expect(replay.pendingRemove.value).toBeNull()
    expect(replay.files.value).toEqual([a])
    expect(local.parseReplayFiles).not.toHaveBeenCalled()
  })
})
