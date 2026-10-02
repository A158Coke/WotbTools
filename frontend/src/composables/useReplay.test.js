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
    for (const key of ['analysis', 'analysisActive', 'updateFiles', 'analyze', 'cancelAnalysis', 'dismissAnalysis', 'exportExcel', 'parsedFiles']) {
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

  it('confirmRemoveBattle drops the battle source file and re-analyses the remaining selection', async () => {
    const replay = setup()
    const a = new File(['a'], 'a.wotbreplay')
    const b = new File(['b'], 'b.wotbreplay')
    replay.updateFiles([a, b])
    await replay.analyze()
    const revision = replay.selectionRevision.value

    replay.askRemoveBattle(replay.parsedBattles.value[0], 0)
    expect(replay.pendingRemove.value).toMatchObject({ type: 'battle', label: expect.stringContaining('#1') })
    replay.confirmRemoveBattle()
    await flushPromises()

    expect(replay.pendingRemove.value).toBeNull()
    expect(replay.files.value).toEqual([b])
    expect(replay.selectionRevision.value).toBe(revision + 1)
    expect(local.parseReplayFiles).toHaveBeenCalledTimes(2)
    expect(local.parseReplayFiles).toHaveBeenLastCalledWith([b], expect.anything())
    expect(replay.parsedBattles.value.map(b => b.sourceName)).toEqual(['b.wotbreplay'])
  })

  it('confirmRemove for a file re-analyses; removing the last file clears without analysing', async () => {
    const replay = setup()
    const a = new File(['a'], 'a.wotbreplay')
    const b = new File(['b'], 'b.wotbreplay')
    replay.updateFiles([a, b])
    await replay.analyze()

    replay.askRemoveFile(a)
    expect(replay.pendingRemove.value).toMatchObject({ type: 'file', label: 'a.wotbreplay' })
    replay.confirmRemove()
    await flushPromises()
    expect(replay.files.value).toEqual([b])
    expect(local.parseReplayFiles).toHaveBeenCalledTimes(2)

    replay.askRemoveFile(b)
    replay.confirmRemove()
    await flushPromises()
    expect(replay.files.value).toEqual([])
    expect(replay.resp.value).toBeNull()
    expect(replay.analysis.value.phase).toBe('idle')
    expect(local.parseReplayFiles).toHaveBeenCalledTimes(2)
  })

  it('cancelRemove / confirmRemoveBattle without a battle pending never touch the selection', async () => {
    const replay = setup()
    const a = new File(['a'], 'a.wotbreplay')
    replay.updateFiles([a])

    replay.askRemoveFile(a)
    replay.cancelRemove()
    expect(replay.pendingRemove.value).toBeNull()

    replay.askRemoveFile(a)
    replay.confirmRemoveBattle()
    expect(replay.pendingRemove.value).toBeNull()
    expect(replay.files.value).toEqual([a])
    expect(local.parseReplayFiles).not.toHaveBeenCalled()
  })
})

describe('useReplay initial result tab (activeTab must point to a renderable panel)', () => {
  const twoBattles = [
    { mapName: 'Lagoon', sourceName: 'a.wotbreplay' },
    { mapName: 'Frozen', sourceName: 'b.wotbreplay' },
  ]
  const league = { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] }

  async function analyzeWith(result, fileCount = 2) {
    local.parseReplayFiles.mockImplementation(async files => files.map(f => ({ name: f.name, result: {}, error: null })))
    local.analyzeReplayBatch.mockReturnValue({ dataset: {}, preview: result })
    const replay = setup()
    replay.updateFiles(Array.from({ length: fileCount }, (_, i) => new File([String(i)], `${i}.wotbreplay`)))
    await replay.analyze()
    return replay
  }

  afterEach(() => {
    wrapper?.unmount()
  })

  it('Test A: 多场 + aggregate 空 + 无 league → activeTab=b0', async () => {
    const replay = await analyzeWith({ ...base, battles: twoBattles, aggregate: [] })
    expect(replay.resp.value.battles).toHaveLength(2)
    expect(replay.activeTab.value).toBe('b0')
  })

  it('Test B: 多场 + aggregate 有数据 + 无 league → activeTab=aggregate', async () => {
    const replay = await analyzeWith({ ...base, battles: twoBattles, aggregate: [{ cells: { nickname: 'P1', damage_dealt: 5000 } }] })
    expect(replay.activeTab.value).toBe('aggregate')
  })

  it('Test C: 多场 + aggregate 空 + leagueMode=true → activeTab=aggregate（不 fallback 到 b0）', async () => {
    const replay = await analyzeWith({ ...base, battles: twoBattles, aggregate: [], league, leagueMode: true })
    expect(replay.activeTab.value).toBe('aggregate')
  })

  it('Test D: 单场 + aggregate 空 + 无 league → activeTab=b0', async () => {
    const replay = await analyzeWith({ ...base, battles: [twoBattles[0]], aggregate: [] }, 1)
    expect(replay.activeTab.value).toBe('b0')
  })

  it('chooseInitialResultTab 纯函数：所有已知 response 的 activeTab 都指向真实 panel（invariant）', () => {
    const cases = [
      { result: { battles: twoBattles, aggregate: [], leagueMode: false }, expectTab: 'b0' },
      { result: { battles: twoBattles, aggregate: [{ cells: {} }], leagueMode: false }, expectTab: 'aggregate' },
      { result: { battles: twoBattles, aggregate: [], league, leagueMode: true }, expectTab: 'aggregate' },
      { result: { battles: [twoBattles[0]], aggregate: [], leagueMode: false }, expectTab: 'b0' },
      { result: { battles: [], aggregate: [], leagueMode: false }, expectTab: 'aggregate' },
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
