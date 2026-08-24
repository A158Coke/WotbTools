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

const ROWS = [
  { team: 1, cells: { nickname: 'A', account_id: 1, damage_avg: 100, win_rate: 50, earned_avg: 80 } },
  { team: 2, cells: { nickname: 'B', account_id: 2, damage_avg: 9, win_rate: 90, earned_avg: 40 } },
  { team: 1, cells: { nickname: 'C', account_id: 3, damage_avg: 21, win_rate: null, earned_avg: null } },
]

function mountTable(overrides = {}) {
  return mount(AggregateTable, {
    props: { aggregate: ROWS, shownCols: COLS, aggStats: null, ...overrides },
    global: { mocks: { $t: key => key } }
  })
}

describe('AggregateTable sorting (plan §25)', () => {
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
        { team: 1, cells: { nickname: 'Player10', account_id: 10, damage_avg: 1, win_rate: 1, earned_avg: 1 } },
        { team: 1, cells: { nickname: 'Player2', account_id: 2, damage_avg: 1, win_rate: 1, earned_avg: 1 } },
        { team: 1, cells: { nickname: 'Player1', account_id: 1, damage_avg: 1, win_rate: 1, earned_avg: 1 } },
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
