// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import BattleTable from './BattleTable.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: key => key, te: () => false, locale: { value: 'zh' } })
}))

// ResizeObserver mock（happy-dom 无真实布局）：捕获回调供 Test D/E 手动触发宽度变化
let roCallback = null
class MockResizeObserver {
  constructor(cb) { roCallback = cb }
  observe() {}
  disconnect() {}
  unobserve() {}
}
globalThis.ResizeObserver = MockResizeObserver

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

// ---- League Rating（plan §15/§10：概览、Rating 单元格、MVP 徽标、sticky 列、队名编辑） ----

function makeLeagueBattle() {
  return {
    arenaId: '111',
    mapName: 'Lagoon',
    durationS: 300,
    winnerTeam: 1,
    players: [
      { team: 1, cells: { nickname: 'A', account_id: 1001, league_rating: 927.4, league_damage_score: 342.1, damage_dealt: 3000 } },
      { team: 2, cells: { nickname: 'B', account_id: 2001, league_rating: 812.6, league_damage_score: 250.2, damage_dealt: 2500 } }
    ],
    league: {
      mvpNickname: 'A', mvpAccountId: 1001,
      team1BestNickname: 'A', team1BestAccountId: 1001,
      team2BestNickname: 'B', team2BestAccountId: 2001,
      team1: { team: 1, teamKey: 'clan:AAA', teamRating: 880.5, autoName: 'AAA', nameSource: 'CLAN_MAJORITY' },
      team2: { team: 2, teamKey: 'clan:BBB', teamRating: 700.2, autoName: 'BBB', nameSource: 'CLAN_MAJORITY' }
    }
  }
}

const LEAGUE_COLUMN_DEFS = [
  { key: 'league_rating', num: true, max: 1000, fixed: true, defaultVisible: true, group: 'rating' },
  { key: 'league_damage_score', num: true, max: 400, fixed: false, defaultVisible: false, group: 'rating' }
]

function leagueCols() {
  return [
    { key: 'nickname', num: false },
    { key: 'league_rating', num: true },
    { key: 'league_damage_score', num: true },
    { key: 'damage_dealt', num: true }
  ]
}

function mountLeague(battle, cols, teamNames, extraProps = {}) {
  return mount(BattleTable, {
    props: {
      battle,
      shownCols: cols || leagueCols(),
      leagueColumns: LEAGUE_COLUMN_DEFS,
      league: battle.league,
      leagueMode: true,
      teamNames: teamNames || {},
      ...extraProps
    },
    global: { mocks: { $t: key => key } }
  })
}

describe('BattleTable League Rating', () => {
  it('renders league overview with auto team names and ratings', () => {
    const wrapper = mountLeague(makeLeagueBattle())
    // 自动多数军团标签在队名输入框 value 中
    const inputs = wrapper.findAll('input.team-name-input')
    expect(inputs[0].element.value).toBe('AAA')
    expect(inputs[1].element.value).toBe('BBB')
    // 战队 Rating「881 · 88.1%」在概览文本中
    const text = wrapper.text()
    expect(text).toContain('881')
    expect(text).toContain('88.1%')
  })

  it('renders MVP and team best badges', () => {
    const wrapper = mountLeague(makeLeagueBattle())
    const text = wrapper.text()
    expect(text).toContain('MVP')          // A 全场 MVP
    expect(text).toContain('★')            // B 队2 队内最佳
  })

  it('formats rating cell as total and percentage', () => {
    const wrapper = mountLeague(makeLeagueBattle())
    const text = wrapper.text()
    expect(text).toContain('927 · 92.7%')
    expect(text).toContain('813 · 81.3%')
  })

  it('formats dimension cell as score / max · percentage', () => {
    const wrapper = mountLeague(makeLeagueBattle())
    const text = wrapper.text()
    expect(text).toContain('342 / 400 · 85.5%')
    expect(text).toContain('250 / 400 · 62.6%')
  })

  it('sticks nickname and league_rating columns', () => {
    const wrapper = mountLeague(makeLeagueBattle())
    const ths = wrapper.findAll('th')
    const nicknameTh = ths.find(t => t.text().includes('nickname'))
    const ratingTh = ths.find(t => t.text().includes('league_rating'))
    const damageTh = ths.find(t => t.text().includes('damage_dealt'))
    expect(nicknameTh.classes()).toContain('sticky-col')
    expect(ratingTh.classes()).toContain('sticky-col')
    expect(damageTh.classes()).not.toContain('sticky-col')
  })

  // ---- P0 sticky lifecycle（plan §19 Test A–F；Test F：/left:\s*\d+px/ 不能再作为成功标准，
  //      因为 left:0px 也会通过——必须断言具体测量值） ----

  function stubNickWidth(wrapper, width) {
    const nickTh = wrapper.findAll('th').find(t => t.text().includes('nickname'))
    nickTh.element.getBoundingClientRect = () => ({ width, height: 24, top: 0, left: 0, right: width, bottom: 24 })
    return nickTh
  }

  async function flushSticky() {
    // 组件：nextTick → rAF（happy-dom 用 setTimeout 模拟）→ stickyLeft 写入 → 下一次 render 反映到 style
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 20))
    await nextTick()
  }

  it('hidden mount（active=false，nickname width=0）不得把 Rating sticky left 写成有效的 0（plan §19 Test A）', async () => {
    const wrapper = mountLeague(makeLeagueBattle())
    await wrapper.setProps({ active: false })
    await flushSticky()
    const ratingTh = wrapper.findAll('th').find(t => t.text().includes('league_rating'))
    expect(ratingTh.attributes('style') || '').not.toContain('left')
  })

  it('hidden → visible：真实 width=132 时 nickname left=0、rating left=132px（plan §19 Test B）', async () => {
    const wrapper = mountLeague(makeLeagueBattle())
    await wrapper.setProps({ active: false })
    stubNickWidth(wrapper, 132)
    await wrapper.setProps({ active: true })
    await flushSticky()
    const nickTh = wrapper.findAll('th').find(t => t.text().includes('nickname'))
    const ratingTh = wrapper.findAll('th').find(t => t.text().includes('league_rating'))
    expect(nickTh.attributes('style')).toContain('left: 0px')
    expect(ratingTh.attributes('style')).toContain('left: 132px')
    // 两队的 sticky 玩家/Rating cell 必须带 team semantic class（plan §18：不丢队色）
    const stickyT1 = wrapper.findAll('tbody td').filter(td => td.classes().includes('sticky-t1'))
    const stickyT2 = wrapper.findAll('tbody td').filter(td => td.classes().includes('sticky-t2'))
    expect(stickyT1.length).toBeGreaterThan(0)
    expect(stickyT2.length).toBeGreaterThan(0)
  })

  it('重新激活：inactive 时列宽变化、active 后重测到新宽度 148（plan §19 Test C）', async () => {
    const wrapper = mountLeague(makeLeagueBattle())
    stubNickWidth(wrapper, 132)
    await flushSticky()
    let ratingTh = wrapper.findAll('th').find(t => t.text().includes('league_rating'))
    expect(ratingTh.attributes('style')).toContain('left: 132px')
    await wrapper.setProps({ active: false })
    stubNickWidth(wrapper, 148)
    await wrapper.setProps({ active: true })
    await flushSticky()
    ratingTh = wrapper.findAll('th').find(t => t.text().includes('league_rating'))
    expect(ratingTh.attributes('style')).toContain('left: 148px')
  })

  it('ResizeObserver：132 → 150 时 sticky offset 更新（plan §19 Test D）', async () => {
    const wrapper = mountLeague(makeLeagueBattle())
    stubNickWidth(wrapper, 132)
    await flushSticky()
    let ratingTh = wrapper.findAll('th').find(t => t.text().includes('league_rating'))
    expect(ratingTh.attributes('style')).toContain('left: 132px')
    stubNickWidth(wrapper, 150)
    if (roCallback) roCallback()
    await flushSticky()
    ratingTh = wrapper.findAll('th').find(t => t.text().includes('league_rating'))
    expect(ratingTh.attributes('style')).toContain('left: 150px')
  })

  it('ResizeObserver width=0：已有有效 150 不得被覆盖成 0（plan §19 Test E）', async () => {
    const wrapper = mountLeague(makeLeagueBattle())
    stubNickWidth(wrapper, 150)
    await flushSticky()
    const ratingTh = wrapper.findAll('th').find(t => t.text().includes('league_rating'))
    expect(ratingTh.attributes('style')).toContain('left: 150px')
    stubNickWidth(wrapper, 0)
    if (roCallback) roCallback()
    await flushSticky()
    expect(ratingTh.attributes('style')).toContain('left: 150px')
  })

  it('emits update-team-name on team name input', async () => {
    const battle = makeLeagueBattle()
    const wrapper = mountLeague(battle)
    const inputs = wrapper.findAll('input.team-name-input')
    expect(inputs.length).toBe(2)
    await inputs[0].setValue('MyTeam')
    const emitted = wrapper.emitted('update-team-name')
    expect(emitted).toBeTruthy()
    expect(emitted[0][0]).toEqual({ arenaId: '111', team: 1, name: 'MyTeam' })
  })

  it('displays override team names from props', () => {
    const battle = makeLeagueBattle()
    const wrapper = mountLeague(battle, leagueCols(), { '111:1': '我的战队' })
    const inputs = wrapper.findAll('input.team-name-input')
    expect(inputs[0].element.value).toBe('我的战队')
  })

  it('emits select-player with accountId on league row click (plan §8/§13)', async () => {
    const wrapper = mountLeague(makeLeagueBattle())
    const rowA = wrapper.findAll('tbody tr').find(r => r.text().includes('A'))
    await rowA.trigger('click')
    const emitted = wrapper.emitted('select-player')
    expect(emitted).toBeTruthy()
    expect(emitted[0][0]).toEqual({ scope: 'battle', accountId: 1001, arenaId: '111' })
  })

  it('does not emit select-player in standard (non-league) mode (plan §8.1)', async () => {
    const wrapper = mountTable(makeBattle([
      { team: 1, cells: { nickname: 'A', damage_dealt: 3000, contribution: 22.4, kast: 100, impact: 151.2 } }
    ]), makeCols())
    await wrapper.find('tbody tr').trigger('click')
    expect(wrapper.emitted('select-player')).toBeUndefined()
  })

  it('header click sorts but does not open drawer (plan §13)', async () => {
    const wrapper = mountLeague(makeLeagueBattle())
    const th = wrapper.findAll('th').find(t => t.text().includes('league_rating'))
    await th.trigger('click')
    expect(wrapper.emitted('select-player')).toBeUndefined()
  })

  // ---- review PR#134 BLOCKER 3：leagueMode（CW UI）与 league（Rating 结果）是两个独立状态 ----

  it('leagueMode=true + league=null（Rating-ineligible CW 场）：仍是 CW——点击打开 Drawer、Rating 显示 --、sticky 契约保持', async () => {
    const battle = makeLeagueBattle()
    battle.league = null // 本场未评分（如名册不完整），但仍是 CW
    const wrapper = mountLeague(battle, leagueCols())
    // 概览仍渲染（CW UI），但 Rating/MVP 不伪造
    const text = wrapper.text()
    expect(text).toContain('league.title')
    expect(text).not.toContain('88.1%') // 战队 Rating 不得伪造
    expect(text).not.toContain('MVP')   // 无 MVP 徽标（league null）
    // Rating 单元格显示 '--'（不得 0 · 0%）
    expect(text).toContain('--')
    // sticky 契约：nickname + league_rating 仍 sticky
    const ths = wrapper.findAll('th')
    expect(ths.find(t => t.text().includes('nickname')).classes()).toContain('sticky-col')
    expect(ths.find(t => t.text().includes('league_rating')).classes()).toContain('sticky-col')
    // 点击玩家行 → 仍打开 Drawer（BLOCKER 3.3）
    const rowA = wrapper.findAll('tbody tr').find(r => r.text().includes('A'))
    await rowA.trigger('click')
    const emitted = wrapper.emitted('select-player')
    expect(emitted).toBeTruthy()
    expect(emitted[0][0]).toEqual({ scope: 'battle', accountId: 1001, arenaId: '111' })
  })

  it('Rating-ineligible 场 Rating 单元格显示 -- 而不是 0（BLOCKER 3.3 不冒充 0）', async () => {
    const battle = makeLeagueBattle()
    battle.league = null
    battle.players = battle.players.map(p => ({
      ...p, cells: { ...p.cells, league_rating: undefined, league_damage_score: undefined }
    }))
    const wrapper = mountLeague(battle, leagueCols())
    expect(wrapper.text()).not.toMatch(/0 · 0%/)
  })

  it('column reorder（shownCols 变化）→ sticky 重测到新昵称列宽（BLOCKER 2.10）', async () => {
    const wrapper = mountLeague(makeLeagueBattle())
    stubNickWidth(wrapper, 132)
    await flushSticky()
    let ratingTh = wrapper.findAll('th').find(t => t.text().includes('league_rating'))
    expect(ratingTh.attributes('style')).toContain('left: 132px')
    // reorder 后昵称列变宽 → 必须重测（不得假设 nickname 宽度不变）
    stubNickWidth(wrapper, 148)
    await wrapper.setProps({ shownCols: [...leagueCols()].reverse() })
    await flushSticky()
    ratingTh = wrapper.findAll('th').find(t => t.text().includes('league_rating'))
    expect(ratingTh.attributes('style')).toContain('left: 148px')
  })
})