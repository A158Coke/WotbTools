// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AggregateTable from './AggregateTable.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: key => key, locale: { value: 'zh' } })
}))

const COLS = [
  { key: 'nickname', num: false },
  { key: 'damage_avg', num: true },
  { key: 'win_rate', num: true },
  { key: 'earned_avg', num: true },
]

// B6：account_id 不再是列——身份是结构化 row.accountId
const ROWS = [
  { team: 1, accountId: 1, cells: { nickname: 'A', damage_avg: 100, win_rate: 50, earned_avg: 80 } },
  { team: 2, accountId: 2, cells: { nickname: 'B', damage_avg: 9, win_rate: 90, earned_avg: 40 } },
  { team: 1, accountId: 3, cells: { nickname: 'C', damage_avg: 21, win_rate: null, earned_avg: null } },
]

function mountTable(overrides = {}) {
  return mount(AggregateTable, {
    props: { aggregate: ROWS, shownCols: COLS, aggStats: null, ...overrides },
    global: { mocks: { $t: key => key } }
  })
}

describe('AggregateTable raw rates', () => {
  it('renders hit_rate/pen_rate raw percentages; null (no shots/no hits) shows -- not 0', () => {
    const cols = [
      { key: 'nickname', num: false },
      { key: 'hit_rate', num: true },
      { key: 'pen_rate', num: true }
    ]
    const rows = [
      { team: 1, accountId: 1, cells: { nickname: 'A', hit_rate: 50, pen_rate: 80 } },
      { team: 1, accountId: 2, cells: { nickname: 'B', hit_rate: null, pen_rate: null } }
    ]
    const wrapper = mountTable({ aggregate: rows, shownCols: cols })
    const text = wrapper.text()
    expect(text).toContain('50')
    expect(text).toContain('80')
    expect((text.match(/--/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('B6：survival_time_avg 走时长格式化（旧 key survival_avg 已退役）', () => {
    const cols = [{ key: 'survival_time_avg', num: true }]
    const rows = [{ team: 1, accountId: 1, cells: { survival_time_avg: 125, survival_avg: 999 } }]
    const wrapper = mountTable({ aggregate: rows, shownCols: cols })
    // fmtDuration → $t('duration', {min, sec})；旧 key 会被当成普通数字渲染成 999
    expect(wrapper.find('tbody td').text()).toBe('duration')
    expect(wrapper.find('th').attributes('title')).toBe('agg_labels.survival_time_avg_tip')
  })
})

describe('AggregateTable sorting', () => {
  it('numeric asc: 9 21 100', async () => {
    const wrapper = mountTable()
    const th = wrapper.findAll('th').find(t => t.text().includes('damage_avg'))
    await th.trigger('click')
    const first = wrapper.findAll('tbody tr').at(0)
    expect(first.text()).toContain('9')
  })

  it('numeric desc: 100 21 9', async () => {
    const wrapper = mountTable()
    const th = wrapper.findAll('th').find(t => t.text().includes('damage_avg'))
    await th.trigger('click')
    await th.trigger('click')
    const first = wrapper.findAll('tbody tr').at(0)
    expect(first.text()).toContain('100')
  })

  it('missing always last (ASC and DESC)', async () => {
    const wrapper = mountTable()
    const th = wrapper.findAll('th').find(t => t.text().includes('win_rate'))
    await th.trigger('click') // ASC: 50 90 --(missing last)
    let rows = wrapper.findAll('tbody tr')
    expect(rows.at(0).text()).toContain('50')
    expect(rows.at(2).text()).toContain('C') // null win_rate last
    await th.trigger('click') // DESC: 90 50 --(still last)
    rows = wrapper.findAll('tbody tr')
    expect(rows.at(0).text()).toContain('90')
    expect(rows.at(2).text()).toContain('C')
  })

  it('string natural order', async () => {
    const wrapper = mountTable({
      aggregate: [
        { team: 1, accountId: 10, cells: { nickname: 'Player10', damage_avg: 1, win_rate: 1, earned_avg: 1 } },
        { team: 1, accountId: 2, cells: { nickname: 'Player2', damage_avg: 1, win_rate: 1, earned_avg: 1 } },
        { team: 1, accountId: 1, cells: { nickname: 'Player1', damage_avg: 1, win_rate: 1, earned_avg: 1 } },
      ]
    })
    const th = wrapper.findAll('th').find(t => t.text().includes('nickname'))
    await th.trigger('click')
    const rows = wrapper.findAll('tbody tr')
    expect(rows.at(0).text()).toContain('Player1')
    expect(rows.at(1).text()).toContain('Player2')
    expect(rows.at(2).text()).toContain('Player10')
  })
})
