// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import CwPlayerSummaryTable from './CwPlayerSummaryTable.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: key => key })
}))

const COLS = [
  { key: 'league_rating', num: true },
  { key: 'league_damage_score', num: true },
  { key: 'nickname', num: false },
  { key: 'battles', num: true },
  { key: 'earned_avg', num: true },
  { key: 'win_rate', num: true },
]

const LEAGUE_COLUMNS = [
  { key: 'league_rating', max: 1000, fixed: true },
  { key: 'league_damage_score', max: 400, fixed: false },
  { key: 'league_assist_score', max: 100, fixed: false },
  { key: 'league_kill_score', max: 100, fixed: false },
  { key: 'league_exchange_score', max: 150, fixed: false },
  { key: 'league_blocked_score', max: 50, fixed: false },
  { key: 'league_survival_score', max: 100, fixed: false },
  { key: 'league_shooting_score', max: 100, fixed: false },
]

const ROWS = [
  { team: 1, accountId: 1001, league: { accountId: 1001 }, cells: { nickname: 'A', battles: 3, earned_avg: 80, win_rate: 66.7, league_rating: 850.4, league_damage_score: 342.1, mvp_count: 2 } },
  { team: 2, accountId: 2001, league: null, cells: { nickname: 'B', battles: 2, earned_avg: 40, win_rate: 50, league_rating: null, league_damage_score: null, mvp_count: null } },
]

function mountTable(overrides = {}) {
  return mount(CwPlayerSummaryTable, {
    props: {
      title: '玩家汇总', rows: ROWS, columns: COLS, leagueColumns: LEAGUE_COLUMNS, leagueMode: true,
      ...overrides
    },
    global: { mocks: { $t: key => key } }
  })
}

describe('CwPlayerSummaryTable', () => {
  it('renders rating cells with score/max percentage format', () => {
    const wrapper = mountTable()
    const text = wrapper.text()
    expect(text).toContain('850.4')
    expect(text).not.toContain('850 ·')
    expect(text).not.toContain('85% ·')
    expect(text).toContain('342 / 400 · 85.5%')
  })

  it('shows -- for missing league fields (aggregate-only player)', () => {
    const wrapper = mountTable()
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    const second = rows[1]
    expect(second.text()).toContain('--')
    expect(second.text()).toContain('40')
    expect(second.text()).toContain('B')
  })

  it('renders earned_avg raw value', () => {
    const wrapper = mountTable()
    expect(wrapper.text()).toContain('80')
  })

  it('emits select-player with accountId on row click', async () => {
    const wrapper = mountTable()
    await wrapper.findAll('tbody tr')[0].trigger('click')
    const emitted = wrapper.emitted('select-player')
    expect(emitted).toBeTruthy()
    expect(emitted[0][0]).toMatchObject({ scope: 'summary', accountId: 1001 })
  })

  it('shows empty state when no rows', () => {
    const wrapper = mountTable({ rows: [] })
    expect(wrapper.find('td.league-summary-empty').text()).toBe('league.summary.no_rateable')
  })

  it('sorts numeric asc then desc, missing last', async () => {
    const wrapper = mountTable({
      rows: [
        { team: 1, accountId: 1001, league: null, cells: { nickname: 'A', earned_avg: 80, league_rating: null, mvp_count: null } },
        { team: 2, accountId: 2001, league: null, cells: { nickname: 'B', earned_avg: 40, league_rating: null, mvp_count: null } },
        { team: 1, accountId: 3001, league: null, cells: { nickname: 'C', earned_avg: null, league_rating: null, mvp_count: null } },
      ]
    })
    const th = wrapper.findAll('th').find(t => t.text().includes('earned_avg'))
    await th.trigger('click')
    let rows = wrapper.findAll('tbody tr')
    expect(rows.at(0).text()).toContain('40')
    expect(rows.at(1).text()).toContain('80')
    expect(rows.at(2).text()).toContain('C')
    await th.trigger('click')
    rows = wrapper.findAll('tbody tr')
    expect(rows.at(0).text()).toContain('80')
    expect(rows.at(1).text()).toContain('40')
    expect(rows.at(2).text()).toContain('C')
  })

  it('sorts rating by raw value (formatted cell)', async () => {
    const wrapper = mountTable()
    const th = wrapper.findAll('th').find(t => t.text().includes('league_rating'))
    await th.trigger('click')
    const rows = wrapper.findAll('tbody tr')
    expect(rows.at(0).text()).toContain('850')
    expect(rows.at(1).text()).toContain('--')
  })

  it('player summary sorting uses full-precision raw Rating when display values tie', async () => {
    const wrapper = mountTable({
      rows: [
        { team: 1, accountId: 1001, league: { accountId: 1001 }, cells: {
          nickname: 'HighRaw', league_rating: 700.24,
        } },
        { team: 1, accountId: 1002, league: { accountId: 1002 }, cells: {
          nickname: 'LowRaw', league_rating: 700.21,
        } },
      ],
      columns: [
        { key: 'nickname', num: false },
        { key: 'league_rating', num: true },
      ],
    })
    const th = wrapper.findAll('th').find(t => t.text().includes('league_rating'))
    await th.trigger('click')
    const rows = wrapper.findAll('tbody tr')
    expect(rows.at(0).text()).toContain('LowRaw')
    expect(rows.at(1).text()).toContain('HighRaw')
    expect(rows.at(0).text()).toContain('700.2')
    expect(rows.at(1).text()).toContain('700.2')
  })

  it('B6：已退役的 Performance Metrics（contribution/kast/impact）不再被 % 特殊化', () => {
    const wrapper = mountTable({
      columns: [
        { key: 'nickname', num: false },
        { key: 'contribution', num: true },
        { key: 'kast', num: true },
        { key: 'impact', num: true },
      ],
      rows: [
        { team: 1, accountId: 1001, league: null, cells: { nickname: 'A', contribution: 22.4, kast: 100, impact: 151.2 } },
        { team: 2, accountId: 2001, league: null, cells: { nickname: 'B', contribution: null, kast: null, impact: null } },
      ],
    })
    const text = wrapper.text()
    expect(text).not.toContain('22.4%')
    expect(text).not.toContain('151.2%')
    expect(text).toContain('22.4')
    expect(text).toContain('B------')
    expect(text).not.toMatch(/(^|\D)0%/)
  })

  it('displays rated_battles separately from battles', () => {
    const wrapper = mountTable({
      columns: [
        { key: 'nickname', num: false },
        { key: 'battles', num: true },
        { key: 'rated_battles', num: true },
      ],
      rows: [
        { team: 1, accountId: 1001, league: null, cells: { nickname: 'A', battles: 12, rated_battles: 8 } },
      ],
    })
    const text = wrapper.text()
    expect(text).toContain('12')
    expect(text).toContain('8')
  })
})

describe('CwPlayerSummaryTable selected row highlight', () => {
  it('selected 判定按 accountId（禁止 row index）', () => {
    const wrapper = mountTable({ selectedAccountId: 2001 })
    const rows = wrapper.findAll('tbody tr')
    expect(rows[0].classes()).not.toContain('selected')
    expect(rows[1].classes()).toContain('selected')
  })

  it('selectedAccountId 为 null 时不加 highlight（Drawer 关闭 → 清除）', () => {
    const wrapper = mountTable()
    for (const row of wrapper.findAll('tbody tr')) {
      expect(row.classes()).not.toContain('selected')
    }
  })

  it('排序后 highlight 跟随同一 accountId（index 变化不脱靶）', async () => {
    const wrapper = mountTable({ selectedAccountId: 2001 })
    expect(wrapper.findAll('tbody tr')[1].classes()).toContain('selected')
    const th = wrapper.findAll('th').find(t => t.text().includes('nickname'))
    await th.trigger('click')
    await th.trigger('click')
    const rows = wrapper.findAll('tbody tr')
    expect(rows[0].text()).toContain('B')
    expect(rows[0].classes()).toContain('selected')
    expect(rows[1].classes()).not.toContain('selected')
  })
})

describe('CwPlayerSummaryTable sticky core pair', () => {
  function stubNickWidth(wrapper, width) {
    const nickTh = wrapper.findAll('th').find(t => t.text().includes('nickname'))
    nickTh.element.getBoundingClientRect = () => ({ width, height: 24, top: 0, left: 0, right: width, bottom: 24 })
    return nickTh
  }

  async function flushSticky() {
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 20))
    await nextTick()
  }

  const STICKY_COLS = [
    { key: 'nickname', num: false },
    { key: 'league_rating', num: true },
    { key: 'battles', num: true },
  ]

  it('hidden（active=false）不得把 Rating sticky left 写成有效 0', async () => {
    const wrapper = mountTable({ columns: STICKY_COLS, active: false })
    await flushSticky()
    const ratingTh = wrapper.findAll('th').find(t => t.text().includes('league_rating'))
    expect(ratingTh.attributes('style') || '').not.toContain('left')
  })

  it('visible：nickname left=0、rating left=实测昵称列宽', async () => {
    const wrapper = mountTable({ columns: STICKY_COLS })
    stubNickWidth(wrapper, 132)
    await flushSticky()
    const nickTh = wrapper.findAll('th').find(t => t.text().includes('nickname'))
    const ratingTh = wrapper.findAll('th').find(t => t.text().includes('league_rating'))
    expect(nickTh.attributes('style')).toContain('left: 0px')
    expect(ratingTh.attributes('style')).toContain('left: 132px')
  })

  it('column reorder（columns prop 变化）→ 重测到新昵称列宽', async () => {
    const wrapper = mountTable({ columns: STICKY_COLS })
    stubNickWidth(wrapper, 132)
    await flushSticky()
    let ratingTh = wrapper.findAll('th').find(t => t.text().includes('league_rating'))
    expect(ratingTh.attributes('style')).toContain('left: 132px')
    stubNickWidth(wrapper, 148)
    await wrapper.setProps({ columns: [...STICKY_COLS].reverse() })
    await flushSticky()
    ratingTh = wrapper.findAll('th').find(t => t.text().includes('league_rating'))
    expect(ratingTh.attributes('style')).toContain('left: 148px')
  })
})
