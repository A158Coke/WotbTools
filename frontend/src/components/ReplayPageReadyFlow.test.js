// @vitest-environment happy-dom

// 端到端：ReplayPage 挂载真实 useReplay + useColumns（仅 mock api / i18n / 重型子组件）。
// 验证 Processing READY 后**同一提交周期内**：resp、League 模式、aggregate 可见性与 activeTab
// 一致，正确结果 panel 第一帧即渲染——不需要用户再点 tab、不需要第二次 poll、
// 不需要等待 column preference 初始化。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { h, ref } from 'vue'
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

const api = vi.hoisted(() => ({
  createProcessingJob: vi.fn(),
  getProcessingJob: vi.fn(),
  getProcessingJobResult: vi.fn(),
  cancelProcessingJob: vi.fn(),
}))

vi.mock('../utils/api.js', () => api)

function pJob(overrides = {}) {
  return { jobId: 'p1', status: 'QUEUED', phase: null, total: 2, processed: 0, valid: 0,
    duplicates: 0, failures: 0, errorCode: null, currentFile: null, ...overrides }
}

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

const FileUploaderStub = {
  name: 'FileUploader',
  emits: ['update:files', 'preview', 'remove-request'],
  setup(_, { emit }) {
    return () => h('div', { class: 'fu-stub' }, [
      h('button', { class: 'fu-add', onClick: () => emit('update:files', TEST_FILES) }, 'add'),
      h('button', { class: 'fu-preview', onClick: () => emit('preview') }, 'preview'),
    ])
  },
}

function mountPage() {
  return mount(ReplayPage, {
    global: {
      mocks: { $t: i18n.t },
      provide: {
        navigate: vi.fn(),
        isAuthenticated: () => true,
        login: vi.fn(),
      },
      stubs: {
        FileUploader: FileUploaderStub,
        ColumnPicker: { template: '<div class="col-picker-stub" />' },
        AggregateTable: { template: '<div class="agg-table-stub" />' },
        BattleTable: { template: '<div class="battle-table-stub" />' },
        LeagueSummaryTable: { template: '<div class="league-summary-stub" />' },
        CwPlayerSummaryTable: { template: '<div class="cw-player-summary-stub" />' },
        RemoveConfirmModal: { template: '<div class="remove-modal-stub" />' },
        ReplayTaskCard: { template: '<div class="replay-task-stub" />' },
        PlayerDetailDrawer: { props: ['context', 'player'], template: '<div class="drawer-stub" />' },
      },
    },
  })
}

describe('ReplayPage READY 第一帧渲染（同一提交周期内结果立即可见）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function runReadyFlow(result) {
    api.createProcessingJob.mockResolvedValue({ jobId: 'p1', status: 'QUEUED', total: 2 })
    api.getProcessingJob
      .mockResolvedValueOnce(pJob({ status: 'PROCESSING', processed: 1, valid: 1 }))
      .mockResolvedValueOnce(pJob({ status: 'READY', processed: 2, valid: 2 }))
    api.getProcessingJobResult.mockResolvedValue(result)

    const wrapper = mountPage()
    await wrapper.find('.fu-add').trigger('click')
    await flushPromises()
    await wrapper.find('.fu-preview').trigger('click')
    await flushPromises() // createProcessingJob + 首次轮询（PROCESSING）
    await vi.advanceTimersByTimeAsync(1500) // interval → READY → 拉取 result → 设置 resp + activeTab
    await flushPromises() // Vue 渲染 flush：同一提交周期内结果 panel 立即可见
    return wrapper
  }

  it('多场 + aggregate 空 + 无 league：READY 后 Battle #1 立即可见（无点击、无二次 poll、不空白）', async () => {
    const wrapper = await runReadyFlow(baseResp({ battles: twoBattles, aggregate: [] }))
    // 不需要用户点击 tab：b0 面板已可见
    expect(wrapper.find('.battle-table-stub').element.parentElement.style.display).not.toBe('none')
    // aggregate 空 → AggregateTable 不渲染（v-if 由 resp.aggregate 驱动）
    expect(wrapper.find('.agg-table-stub').exists()).toBe(false)
    expect(wrapper.find('.league-summary-stub').exists()).toBe(false)
    wrapper.unmount()
  })

  it('league 批次（aggregate 空 + leagueMode=true、summaries 全空）：READY 后 League 明确空态可见', async () => {
    const wrapper = await runReadyFlow(baseResp({ battles: twoBattles, aggregate: [], league, leagueMode: true }))
    // league summaries 全空 → 区块显示 neutral 空态，不渲染 LeagueSummaryTable
    expect(wrapper.find('[data-testid="league-summary-empty"]').exists()).toBe(true)
    expect(wrapper.find('.league-summary-stub').exists()).toBe(false)
    expect(wrapper.find('.battle-table-stub').element.parentElement.style.display).toBe('none')
    wrapper.unmount()
  })

  it('普通多场 + aggregate 有数据：READY 后 Aggregate 立即可见', async () => {
    const wrapper = await runReadyFlow(baseResp({
      battles: twoBattles,
      aggregate: [{ cells: { nickname: 'P1', damage_dealt: 5000 } }],
    }))
    expect(wrapper.find('.agg-table-stub').element.parentElement.style.display).not.toBe('none')
    expect(wrapper.find('.battle-table-stub').element.parentElement.style.display).toBe('none')
    expect(wrapper.find('.league-summary-stub').exists()).toBe(false)
    wrapper.unmount()
  })

  it('league 批次 + aggregate 有数据（partial）：统一玩家表可见，基础 AggregateTable 与 League 玩家表都不得出现', async () => {
    // Case C：partial League（aggregate 非空 + playerSummaries 非空）→ 统一玩家表 + 独立战队表
    const wrapper = await runReadyFlow(baseResp({
      battles: twoBattles,
      aggregate: [{ cells: { nickname: 'P1', damage_dealt: 5000 } }],
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING',
        columns: [],
        playerSummaries: [{ nickname: 'P1', ratingMedian: 900 }],
        teamSummaries: [{ teamKey: 'clan:AAA', ratingMedian: 850 }],
        failures: [],
      },
    }))
    expect(wrapper.find('.cw-player-summary-stub').element.parentElement.style.display).not.toBe('none')
    expect(wrapper.find('.agg-table-stub').exists()).toBe(false)
    // 战队表独立存在；League 玩家表不再单独出现（已并入统一表）
    expect(wrapper.find('.league-summary-stub').exists()).toBe(true)
    wrapper.unmount()
  })

  it('league 批次 0/30（aggregate 非空 + playerSummaries 空）：统一玩家表仍可见（缺失 League 补 --）+ 战队空态', async () => {
    // Case A：30 parsed / 0 rated → 统一玩家表正常显示 aggregate 玩家，战队区块显示明确空态
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