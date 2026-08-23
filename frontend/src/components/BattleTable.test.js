// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import BattleTable from './BattleTable.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: key => key, te: () => false, locale: { value: 'zh' } })
}))

function makeBattle(players) {
  return {
    mapName: 'Lagoon',
    durationS: 300,
    winnerTeam: 1,
    players
  }
}

function makeCols() {
  return [
    { key: 'nickname', num: false },
    { key: 'damage_dealt', num: true },
    { key: 'contribution', num: true },
    { key: 'kast', num: true },
    { key: 'impact', num: true }
  ]
}

function mountTable(battle, cols) {
  return mount(BattleTable, {
    props: { battle, shownCols: cols },
    global: { mocks: { $t: key => key } }
  })
}

describe('BattleTable derived metrics', () => {
  it('renders contribution/kast/impact columns with % formatting (no performance tab needed)', () => {
    const wrapper = mountTable(makeBattle([
      { team: 1, cells: { nickname: 'A', damage_dealt: 3000, contribution: 22.4, kast: 100, impact: 151.2 } }
    ]), makeCols())

    const text = wrapper.text()
    expect(text).toContain('22.4%')
    expect(text).toContain('100%')
    expect(text).toContain('151.2%')
  })

  it('renders -- for null metrics (HP unknown, not fake 0)', () => {
    const wrapper = mountTable(makeBattle([
      { team: 1, cells: { nickname: 'A', damage_dealt: 3000, contribution: null, kast: null, impact: 120.5 } }
    ]), makeCols())

    const text = wrapper.text()
    expect(text).toContain('--')
    expect(text).toContain('120.5%')
  })

  it('sorts contribution numerically (not lexicographically)', async () => {
    const wrapper = mountTable(makeBattle([
      { team: 1, cells: { nickname: 'A', damage_dealt: 3000, contribution: 100, kast: 100, impact: 200 } },
      { team: 1, cells: { nickname: 'B', damage_dealt: 2000, contribution: 9, kast: 50, impact: 80 } },
      { team: 1, cells: { nickname: 'C', damage_dealt: 1000, contribution: 21, kast: 60, impact: 90 } }
    ]), makeCols())

    // click contribution header -> ascending numeric
    const th = wrapper.findAll('th').find(t => t.text().includes('contribution'))
    await th.trigger('click')
    let firstCols = wrapper.findAll('tbody tr').at(0).findAll('td')
    expect(firstCols.at(2).text()).toBe('9%')

    // click again -> descending
    await th.trigger('click')
    firstCols = wrapper.findAll('tbody tr').at(0).findAll('td')
    expect(firstCols.at(2).text()).toBe('100%')
  })
})
