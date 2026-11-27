// @vitest-environment happy-dom


import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useReplay } from '../composables/useReplay.js'
import ReplayPage from './ReplayPage.vue'

const i18n = vi.hoisted(() => ({
  t: vi.fn((key, values) => values
    ? `${key}:${Object.values(values).join(',')}`
    : key),
}))

vi.mock('vue-i18n', async () => {
  const { ref } = await import('vue')
  const locale = ref('en')
  return {
    useI18n: () => ({ locale, t: i18n.t, te: key => i18n.t.mock.calls.some(c => c[0] === key) })
  }
})

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

function baseResp(overrides = {}) {
  return {
    battles: [],
    aggregate: [],
    duplicates: [],
    failures: [],
    playerColumns: [{ key: 'nickname', label: '昵称' }],
    aggregateColumns: [{ key: 'nickname', label: '昵称' }],
    league: null,
    ...overrides,
  }
}

const twoBattles = [
  { mapName: 'Lagoon', sourceName: 'a.wotbreplay', players: [{ cells: { nickname: 'P1', damage_dealt: 5000 } }] },
  { mapName: 'Frozen', sourceName: 'b.wotbreplay', players: [{ cells: { nickname: 'P2', damage_dealt: 4000 } }] },
]
const league = { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] }

const TEST_FILES = [new File(['x'], 'a.wotbreplay'), new File(['y'], 'b.wotbreplay')]

let replay
const Host = defineComponent({
  setup() {
    replay = useReplay()
    return () => h(ReplayPage, { embedded: true, replayContext: replay })
  },
})

function mountPage() {
  return mount(Host, {
    global: {
      mocks: { $t: i18n.t },
      provide: {
        navigate: vi.fn(),
        isAuthenticated: () => true,
        login: vi.fn(),
      },
      stubs: {
        ColumnPicker: { template: '<div class="col-picker-stub" />' },
        AggregateTable: {
          props: ['shownCols'],
          template: '<div class="agg-table-stub"><span v-for="col in shownCols" :key="col.key" :data-testid="`agg-col-${col.key}`">{{ col.key }}</span></div>',
        },
        BattleTable: {
          props: ['shownCols'],
          template: '<div class="battle-table-stub"><span v-for="col in shownCols" :key="col.key" :data-testid="`battle-col-${col.key}`">{{ col.key }}</span></div>',
        },
        LeagueSummaryTable: { template: '<div class="league-summary-stub" />' },
        CwPlayerSummaryTable: { template: '<div class="cw-player-summary-stub" />' },
        PlayerDetailDrawer: { props: ['context', 'player'], template: '<div class="drawer-stub" />' },
      },
    },
  })
}

describe('ReplayPage READY 第一帧渲染（同一提交周期内结果立即可见）', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  async function runReadyFlow(result) {
    local.parseReplayFiles.mockImplementation(async files => files.map(f => ({ name: f.name, result: {}, error: null })))
    local.analyzeReplayBatch.mockReturnValue({ dataset: {}, preview: result })

    const wrapper = mountPage()
    replay.updateFiles(TEST_FILES)
    await flushPromises()
    await expect(replay.analyze()).resolves.toEqual({ completed: true })
    await flushPromises()
    return wrapper
  }

  it('多场 + aggregate 空 + 无 league：READY 后 Battle #1 立即可见（无点击、无重新分析、不空白）', async () => {
    const wrapper = await runReadyFlow(baseResp({ battles: twoBattles, aggregate: [] }))
    expect(wrapper.find('.battle-table-stub').element.parentElement.style.display).not.toBe('none')
    expect(wrapper.find('.agg-table-stub').exists()).toBe(false)
    expect(wrapper.find('.league-summary-stub').exists()).toBe(false)
    wrapper.unmount()
  })

  it('READY 后第一次进入 Data 即完成 columns/result hydration，且只解析一次', async () => {
    const wrapper = await runReadyFlow(baseResp({
      battles: [twoBattles[0]],
      aggregate: [{ cells: { nickname: 'P1', damage_avg: 5000 } }],
      playerColumns: [
        { key: 'nickname', label: '昵称' },
        { key: 'damage_dealt', label: '伤害' },
      ],
      aggregateColumns: [
        { key: 'nickname', label: '昵称' },
        { key: 'damage_avg', label: '场均伤害' },
      ],
    }))

    expect(wrapper.find('[data-testid="agg-col-damage_avg"]').exists()).toBe(true)
    await wrapper.find('[data-testid="data-view-single"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="battle-col-damage_dealt"]').exists()).toBe(true)
    expect(local.parseReplayFiles).toHaveBeenCalledTimes(1)

    await flushPromises()
    expect(local.parseReplayFiles).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('league 批次（aggregate 空 + leagueMode=true、summaries 全空）：READY 后 League 明确空态可见', async () => {
    const wrapper = await runReadyFlow(baseResp({ battles: twoBattles, aggregate: [], league, leagueMode: true }))
    expect(wrapper.find('[data-testid="league-summary-empty"]').exists()).toBe(true)
    expect(wrapper.find('.league-summary-stub').exists()).toBe(false)
    expect(wrapper.find('.battle-table-stub').exists()).toBe(false)
    wrapper.unmount()
  })

  it('普通多场 + aggregate 有数据：READY 后 Aggregate 立即可见', async () => {
    const wrapper = await runReadyFlow(baseResp({
      battles: twoBattles,
      aggregate: [{ cells: { nickname: 'P1', damage_dealt: 5000 } }],
    }))
    expect(wrapper.find('.agg-table-stub').element.parentElement.style.display).not.toBe('none')
    expect(wrapper.find('.battle-table-stub').exists()).toBe(false)
    expect(wrapper.find('.league-summary-stub').exists()).toBe(false)
    wrapper.unmount()
  })

  it('league 批次 + aggregate 有数据（partial）：统一玩家表可见，基础 AggregateTable 与 League 玩家表都不得出现', async () => {
    const wrapper = await runReadyFlow(baseResp({
      battles: twoBattles,
      aggregate: [{ cells: { nickname: 'P1', damage_dealt: 5000 } }],
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING',
        columns: [],
        playerSummaries: [{ nickname: 'P1', rating: 795.7, observedMean: 900 }],
        teamSummaries: [{ teamKey: 'clan:AAA', rating: 850, observedMean: 850 }],
        failures: [],
      },
    }))
    expect(wrapper.find('.cw-player-summary-stub').element.parentElement.style.display).not.toBe('none')
    expect(wrapper.find('.agg-table-stub').exists()).toBe(false)
    expect(wrapper.find('.league-summary-stub').exists()).toBe(true)
    wrapper.unmount()
  })

  it('league 批次 0/30（aggregate 非空 + playerSummaries 空）：统一玩家表仍可见（缺失 League 补 --）+ 战队空态', async () => {
    const wrapper = await runReadyFlow(baseResp({
      battles: twoBattles,
      aggregate: [{ cells: { nickname: 'P1', damage_dealt: 5000 } }],
      leagueMode: true,
      league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] },
    }))
    expect(wrapper.find('.cw-player-summary-stub').element.parentElement.style.display).not.toBe('none')
    expect(wrapper.find('.agg-table-stub').exists()).toBe(false)
    expect(wrapper.find('[data-testid="league-summary-empty"]').exists()).toBe(true)
    expect(wrapper.find('.league-summary-stub').exists()).toBe(false)
    wrapper.unmount()
  })
})
