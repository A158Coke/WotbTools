// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { state, columnsState, makeResp, mountPage } from './ReplayPage.test.fixture.js'

describe('ReplayPage Excel export menu (client-side xlsx)', () => {
  async function openExportMenu(wrapper) {
    await wrapper.get('[data-testid="export-menu"]').trigger('click')
    await flushPromises()
  }

  beforeEach(() => {
    state.clear()
    state.init = { activeTab: 'aggregate', resp: makeResp(), error: '', loading: false, locale: 'en', files: [] }
  })

  it('aggregate calls exportExcel("aggregate", null) when no team names are overridden', async () => {
    const wrapper = mountPage()
    await openExportMenu(wrapper)
    await wrapper.get('[data-testid="export-aggregate"]').trigger('click')
    await flushPromises()
    expect(state.replay.exportExcel).toHaveBeenCalledWith('aggregate', null)
    wrapper.unmount()
  })

  it('each calls exportExcel("each", null)', async () => {
    const wrapper = mountPage()
    await openExportMenu(wrapper)
    await wrapper.get('[data-testid="export-each"]').trigger('click')
    await flushPromises()
    expect(state.replay.exportExcel).toHaveBeenCalledWith('each', null)
    wrapper.unmount()
  })

  it('while exporting: menu label shows replay.excel_exporting, Excel items disabled, no second export', async () => {
    let finish
    const wrapper = mountPage()
    state.replay.exportExcel.mockImplementation(() => new Promise((res) => { finish = res }))
    await openExportMenu(wrapper)
    await wrapper.get('[data-testid="export-aggregate"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="export-menu"]').text()).toContain('replay.excel_exporting')

    await openExportMenu(wrapper)
    const aggregate = wrapper.get('[data-testid="export-aggregate"]')
    expect(aggregate.attributes('data-disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="export-each"]').attributes('data-disabled')).toBeDefined()
    await aggregate.trigger('click')
    expect(state.replay.exportExcel).toHaveBeenCalledTimes(1)

    finish()
    await flushPromises()
    expect(wrapper.get('[data-testid="export-menu"]').text()).not.toContain('replay.excel_exporting')
    wrapper.unmount()
  })

  it('failure surfaces replay.excel_export_failed and re-enables the menu', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mountPage()
    state.replay.exportExcel.mockRejectedValue(new Error('exceljs failed'))
    await openExportMenu(wrapper)
    await wrapper.get('[data-testid="export-each"]').trigger('click')
    await flushPromises()

    expect(state.getError()).toBe('replay.excel_export_failed')
    expect(consoleError).toHaveBeenCalled()
    await openExportMenu(wrapper)
    expect(wrapper.get('[data-testid="export-each"]').attributes('disabled')).toBeUndefined()
    consoleError.mockRestore()
    wrapper.unmount()
  })
})


describe('ReplayPage data picker visibility (workspace capability v-show)', () => {
  beforeEach(() => {
    state.clear()
    state.init = {
      activeTab: 'b0',
      resp: makeResp({
        battles: [
          { sourceId: 'r0', mapName: 'Lagoon', players: [] },
          { sourceId: 'r1', mapName: 'Frozen', players: [] }
        ]
      }),
      error: '', loading: false, locale: 'en', files: []
    }
  })

  it('capability 隐藏（active=false）时关闭已打开的数据模式 BattlePicker', async () => {
    const wrapper = mountPage({ props: { active: true } })
    await flushPromises()
    await wrapper.get('[data-testid="battle-picker"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="battle-picker-panel"]').exists()).toBe(true)
    await wrapper.setProps({ active: false })
    await flushPromises()
    expect(wrapper.find('[data-testid="battle-picker-panel"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('ReplayPage data hydration (embedded-only)', () => {
  beforeEach(() => {
    state.clear()
    state.init = { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'en', files: [] }
  })

  it('embedded-only: no standalone uploader / processing panel / task card', async () => {
    state.init.files = [new File(['x'], 'a.wotbreplay')]
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.findComponent({ name: 'FileDrop' }).exists()).toBe(false)
    expect(wrapper.find('[data-testid="replay-processing-panel"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('hydrates Data columns immediately when a READY response already exists', async () => {
    const result = makeResp()
    state.init.resp = result
    const wrapper = mountPage()
    await flushPromises()
    expect(columnsState.calls.at(-1)).toEqual(result)
    wrapper.unmount()
  })

  it('hydrates Data columns when a later local analysis commits resp, including League columns', async () => {
    const result = makeResp({
      leagueMode: true,
      league: { playerSummaryColumns: [{ key: 'league_rating', label: 'Rating' }], playerSummaries: [] },
    })
    const wrapper = mountPage()
    expect(columnsState.calls).toHaveLength(0)
    state.setResp(result)
    await flushPromises()
    expect(columnsState.calls.at(-1)).toEqual(result)
    wrapper.unmount()
  })
})

describe('ReplayPage League Rating', () => {
  beforeEach(() => {
    state.clear()
    state.init = { activeTab: 'b0', resp: null, error: '', loading: false, locale: 'zh', files: [] }
  })

  it('renders league validation failures as collapsible summary, details on expand', async () => {
    state.init.resp = makeResp({
      battles: [
        { mapName: 'Lagoon', league: null, players: [] },
      ],
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING',
        failures: [
          { fileName: 'bad.wotbreplay', arenaId: '111', code: 'LEAGUE_NOT_SEVEN_VS_SEVEN' }
        ]
      }
    })
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('[data-testid="league-failure-summary"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="league-failure-summary"]').classes()).not.toContain('is-danger')
    expect(wrapper.find('[data-testid="league-failure-summary"]').classes()).toContain('is-warning')
    expect(wrapper.text()).toContain('league.rated_count')
    expect(wrapper.find('[data-testid="league-failure-detail"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="result-failures"]').exists()).toBe(false)
    await wrapper.find('[data-testid="league-failure-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="league-failure-detail"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('LEAGUE_NOT_SEVEN_VS_SEVEN')
    expect(wrapper.find('[data-testid="league-failure-files"]').exists()).toBe(false)
    await wrapper.find('[data-testid="league-failure-group"]').trigger('click')
    expect(wrapper.text()).toContain('bad.wotbreplay')
    expect(wrapper.text()).toContain('111')
  })

  it('does not render death-time provenance as League business warning', async () => {
    state.init.resp = makeResp({
      battles: [
        { mapName: 'Lagoon', league: { mvp: { nickname: 'X' }, team1: {}, team2: {} }, players: [] },
      ],
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING',
        failures: [],
        ratingQuality: { unknownDeathTimePlayers: 5 }
      }
    })
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('[data-testid="league-failure-summary"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="league-quality-warning"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('league.summary.no_rateable')
    expect(wrapper.text()).not.toContain('league.rated_count')
    expect(wrapper.text()).not.toContain('league.unrated_count')
    expect(wrapper.text()).not.toContain('LEAGUE_MISSING_DEATH_TIME')
    expect(wrapper.find('[data-testid="league-failure-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="league-failure-detail"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="result-failures"]').exists()).toBe(false)
  })

  it('shows aggregate tab in league mode (resp.leagueMode is the page source of truth)', async () => {
    state.init.resp = makeResp({
      aggregate: [],
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING',
        columns: [],
        playerSummaries: [],
        playerSummaryColumns: [],
        teamSummaries: [],
        teamSummaryColumns: [],
        failures: []
      }
    })
    const wrapper = mountPage()
    await flushPromises()
    const tabs = wrapper.findAll('[data-testid="data-view"] [role="radio"]')
    expect(tabs.some(b => b.text().includes('result.aggregate_tab'))).toBe(true)
  })

  it('battle rename only updates battle overrides (no summary pollution)', async () => {
    state.init.resp = makeResp({ leagueMode: true, league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } })
    const wrapper = mountPage()
    await flushPromises()
    wrapper.vm.battleTeamNames['111:1'] = 'CHRD'
    expect(wrapper.vm.battleTeamNames['111:1']).toBe('CHRD')
    expect(wrapper.vm.summaryTeamNames).toEqual({})
  })

  it('summary rename only updates teamKey overrides (no battle pollution)', async () => {
    state.init.resp = makeResp({ leagueMode: true, league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } })
    const wrapper = mountPage()
    await flushPromises()
    wrapper.vm.summaryTeamNames['clan:CHRD'] = 'CHRD A队'
    expect(wrapper.vm.summaryTeamNames['clan:CHRD']).toBe('CHRD A队')
    expect(wrapper.vm.battleTeamNames).toEqual({})
  })

  it('export passes battle + summary overrides payload', async () => {
    state.init.resp = makeResp({ leagueMode: true, league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } })
    const wrapper = mountPage()
    await flushPromises()
    wrapper.vm.battleTeamNames['111:1'] = 'CHRD'
    wrapper.vm.summaryTeamNames['clan:CHRD'] = 'CHRD A队'
    await wrapper.get('[data-testid="export-menu"]').trigger('click')
    await flushPromises()
    const exportBtn = wrapper.get('[data-testid="export-aggregate"]')
    await exportBtn.trigger('click')
    await flushPromises()
    expect(state.replay.exportExcel).toHaveBeenCalledWith('aggregate', {
      battle: { '111:1': 'CHRD' },
      summary: { 'clan:CHRD': 'CHRD A队' }
    })
  })

  it('clears both overrides when replay selection changes', async () => {
    state.init.resp = makeResp({ leagueMode: true, league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } })
    const wrapper = mountPage()
    await flushPromises()
    wrapper.vm.battleTeamNames['arenaA:1'] = 'CHRD'
    wrapper.vm.summaryTeamNames['clan:CHRD'] = 'CHRD A队'
    expect(wrapper.vm.battleTeamNames).not.toEqual({})
    state.replay.updateFiles(['b.wotbreplay'])
    await nextTick()
    expect(wrapper.vm.battleTeamNames).toEqual({})
    expect(wrapper.vm.summaryTeamNames).toEqual({})
  })

  it('removing a single replay also clears overrides', async () => {
    state.init.resp = makeResp({ leagueMode: true, league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } })
    const wrapper = mountPage()
    await flushPromises()
    wrapper.vm.battleTeamNames['arenaA:1'] = 'CHRD'
    wrapper.vm.summaryTeamNames['clan:CHRD'] = 'CHRD A队'
    state.replay.updateFiles(['a.wotbreplay'])
    await nextTick()
    expect(wrapper.vm.battleTeamNames).toEqual({})
    expect(wrapper.vm.summaryTeamNames).toEqual({})
  })

  it('re-analysing the same selection does NOT clear overrides', async () => {
    state.init.resp = makeResp({ leagueMode: true, league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } })
    const wrapper = mountPage()
    await flushPromises()
    wrapper.vm.battleTeamNames['arenaA:1'] = 'CHRD'
    wrapper.vm.summaryTeamNames['clan:CHRD'] = 'CHRD A队'
    await state.replay.analyze()
    await nextTick()
    expect(wrapper.vm.battleTeamNames['arenaA:1']).toBe('CHRD')
    expect(wrapper.vm.summaryTeamNames['clan:CHRD']).toBe('CHRD A队')
  })
})

describe('ReplayPage result visibility (no blank results; league mode from resp.leagueMode)', () => {
  beforeEach(() => {
    state.clear()
    state.init = { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'en', files: [] }
  })

  it('多场 + aggregate 空 + 无 league：单场视图默认展示且 BattleTable panel 可见（不再空白）', async () => {
    state.init.resp = makeResp({
      aggregate: [],
      battles: [
        { mapName: 'Lagoon', players: [{ cells: { nickname: 'P1', damage_dealt: 5000 } }] },
        { mapName: 'Frozen', players: [{ cells: { nickname: 'P2', damage_dealt: 4000 } }] }
      ]
    })
    state.init.activeTab = 'b0'
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('[data-testid="data-view-summary"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-view"]').exists()).toBe(false)
    expect(wrapper.findAll('button').some(b => b.text().includes('Lagoon #1'))).toBe(false)
    expect(wrapper.findAll('button').some(b => b.text().includes('Frozen #2'))).toBe(false)
    const battlePanels = wrapper.findAll('.battle-table-stub')
    expect(battlePanels.length).toBeGreaterThan(0)
    expect(battlePanels[0].isVisible()).toBe(true)
    expect(wrapper.find('.agg-table-stub').exists()).toBe(false)
  })

  it('league 模式以 resp.leagueMode 为唯一事实源：即使 playerColumns 无 league_rating，aggregate tab + 统一玩家表也显示', async () => {
    delete window.__testLeagueMode
    state.init.resp = makeResp({
      aggregate: [],
      playerColumns: [{ key: 'nickname', label: '昵称' }],
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING',
        columns: [],
        playerSummaries: [{ nickname: 'P1', rating: 1000, observedMean: 1000, ratedBattles: 5, wins: 3, damageTotal: 25000, killsTotal: 10, dimensionMeans: [] }],
        playerSummaryColumns: [{ key: 'nickname', label: '昵称' }, { key: 'league_rating', label: 'Rating' }],
        teamSummaries: [],
        teamSummaryColumns: [],
        failures: []
      }
    })
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    const tabs = wrapper.findAll('[data-testid="data-view"] [role="radio"]')
    expect(tabs.some(b => b.text().includes('result.aggregate_tab'))).toBe(true)
    expect(wrapper.find('.cw-player-summary').exists()).toBe(true)
    expect(wrapper.find('.league-summary').exists()).toBe(false)
    expect(wrapper.find('.agg-table-stub').exists()).toBe(false)
  })

  it('league 模式 + aggregate 有数据：统一玩家表唯一存在，战队表独立', async () => {
    state.init.resp = makeResp({
      aggregate: [
        { cells: { nickname: 'P1', damage_dealt: 5000 } },
        { cells: { nickname: 'P2', damage_dealt: 3000 } }
      ],
      playerColumns: [{ key: 'nickname', label: '昵称' }],
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING',
        columns: [],
        playerSummaries: [{ nickname: 'P1', rating: 795.7, observedMean: 900, ratedBattles: 2, wins: 1, damageTotal: 9000, killsTotal: 4, dimensionMeans: [] }],
        playerSummaryColumns: [{ key: 'nickname', label: '昵称' }, { key: 'league_rating', label: 'Rating' }],
        teamSummaries: [],
        teamSummaryColumns: [],
        failures: []
      }
    })
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.cw-player-summary').exists()).toBe(true)
    expect(wrapper.find('.agg-table-stub').exists()).toBe(false)
    expect(wrapper.find('.league-summary').exists()).toBe(false)
    expect(wrapper.find('[data-testid="base-aggregate-title"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="league-summary-title"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('league 0/30：统一玩家表仍显示全部 aggregate 玩家（缺失 League 补 --），战队显示空态，tab 人数来自 resp.aggregate', async () => {
    state.init.resp = makeResp({
      aggregate: [
        { cells: { nickname: 'P1', damage_dealt: 5000 } },
        { cells: { nickname: 'P2', damage_dealt: 3000 } }
      ],
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING',
        columns: [],
        playerSummaries: [],
        playerSummaryColumns: [{ key: 'nickname', label: '昵称' }],
        teamSummaries: [],
        teamSummaryColumns: [],
        failures: []
      }
    })
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.cw-player-summary').exists()).toBe(true)
    expect(wrapper.find('.agg-table-stub').exists()).toBe(false)
    expect(wrapper.find('[data-testid="league-summary-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="league-summary-empty"]').classes()).not.toContain('error')
    expect(wrapper.find('.league-summary').exists()).toBe(false)
    const tabs = wrapper.findAll('[data-testid="data-view"] [role="radio"]')
    const aggTab = tabs.find(b => b.text().includes('result.aggregate_tab'))
    expect(aggTab.text()).toContain('result.aggregate_tab:2')
    wrapper.unmount()
  })

  it('无 battles 无 aggregate 无 league：显示空态提示，不崩溃不空白', async () => {
    state.init.resp = makeResp({ aggregate: [], battles: [], league: null })
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.text()).toContain('replay.no_results')
    expect(wrapper.findAll('.battle-table-stub').length).toBe(0)
    expect(wrapper.find('.agg-table-stub').exists()).toBe(false)
  })

  it('leagueMode=false 即使构造异常 league metadata + playerColumns 含 league_rating → 仍是标准模式（第二事实源不得改变 mode）', async () => {
    state.init.resp = makeResp({
      aggregate: [
        { cells: { nickname: 'P1', damage_dealt: 5000 } },
      ],
      battles: [
        { mapName: 'Lagoon', players: [{ cells: { nickname: 'P1', damage_dealt: 5000 } }] },
      ],
      playerColumns: [{ key: 'nickname', label: '昵称' }, { key: 'league_rating', label: 'Rating' }],
      league: {
        mode: 'LEAGUE_RATING',
        columns: [{ key: 'league_rating', max: 1000, fixed: true }],
        playerSummaries: [],
        playerSummaryColumns: [], teamSummaries: [], teamSummaryColumns: [], failures: [],
      },
      // leagueMode 缺省 = false
    })
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.cw-player-summary').exists()).toBe(false)
    expect(wrapper.find('[data-testid="league-summary-title"]').exists()).toBe(false)
    expect(wrapper.find('.agg-table-stub').exists()).toBe(true)
  })

  it('leagueMode=true + league envelope 存在但 0 评分（battle.league=null、playerSummaries=[]）：CW UI + 统一表保留 aggregate 玩家', async () => {
    state.init.resp = makeResp({
      aggregate: [
        { team: 1, accountId: 1001, cells: { nickname: 'P1', damage_dealt: 5000 } },
      ],
      battles: [
        { mapName: 'Lagoon', league: null, players: [{ team: 1, accountId: 1001, vehicleId: 7169, cells: { nickname: 'P1', damage_dealt: 5000 } }] },
      ],
      playerColumns: [{ key: 'nickname', label: '昵称' }],
      league: {
        mode: 'LEAGUE_RATING',
        columns: [{ key: 'league_rating', max: 1000, fixed: true }],
        playerSummaries: [],
        playerSummaryColumns: [{ key: 'nickname', label: '昵称' }],
        teamSummaries: [], teamSummaryColumns: [], failures: [],
      },
      leagueMode: true,
    })
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('[data-testid="league-summary-title"]').exists()).toBe(true)
    expect(wrapper.find('.agg-table-stub').exists()).toBe(false)
    expect(wrapper.find('.cw-player-summary').exists()).toBe(true)
    const rows = wrapper.findAll('.cw-player-summary tbody tr')
    expect(rows.length).toBeGreaterThan(0)
    expect(wrapper.text()).toContain('P1')
    expect(wrapper.find('[data-testid="league-summary-empty"]').exists()).toBe(true)
    expect(wrapper.find('.league-summary').exists()).toBe(false)
  })
})
describe('ReplayPage Player Detail Drawer', () => {
  beforeEach(() => {
    state.clear()
    state.init = { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'zh', files: [] }
  })

  function leagueResp() {
    return makeResp({
      aggregate: [
        { team: 1, accountId: 1001, cells: { nickname: 'Alpha', clan: 'AAA', battles: 3, wins: 2, damage_avg: 500, earned_avg: 80 } },
        { team: 2, accountId: 2001, cells: { nickname: 'Beta', clan: 'BBB', battles: 2, wins: 0, damage_avg: 300, earned_avg: 40 } },
      ],
      playerColumns: [{ key: 'nickname', label: '昵称' }],
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING',
        columns: [{ key: 'league_rating', max: 1000, fixed: true }],
        playerSummaries: [
          { accountId: 1001, nickname: 'Alpha', clan: 'AAA', ratedBattles: 3, rating: 779.3, observedMean: 850.4,
            dimensionMeans: [250, 40, 30, 75, 10, 50, 65], mvpCount: 2, wins: 2 },
        ],
        playerSummaryColumns: [{ key: 'nickname', label: '昵称' }, { key: 'league_rating', label: 'Rating' }],
        teamSummaries: [],
        teamSummaryColumns: [],
        failures: []
      }
    })
  }

  it('默认关闭', async () => {
    state.init.resp = leagueResp()
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    const drawer = wrapper.find('.drawer-stub')
    expect(drawer.text()).toBe('closed')
    wrapper.unmount()
  })

  it('点击统一表玩家行 → 打开 Drawer 并带 accountId', async () => {
    state.init.resp = leagueResp()
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    const rows = wrapper.findAll('.cw-player-summary tbody tr')
    expect(rows.length).toBe(2)
    await rows[0].trigger('click')
    const drawer = wrapper.find('.drawer-stub')
    expect(drawer.text()).toContain('open:1001')
    wrapper.unmount()
  })

  it('点击另一玩家 → Drawer 不关闭，内容切换', async () => {
    state.init.resp = leagueResp()
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    const rows = wrapper.findAll('.cw-player-summary tbody tr')
    await rows[0].trigger('click')
    await rows[1].trigger('click')
    const drawer = wrapper.find('.drawer-stub')
    expect(drawer.text()).toContain('open:2001')
    wrapper.unmount()
  })

  it('Summary Drawer：player 携带 dimensionMeans（Radar mean 契约），不带单场 dimensionScores', async () => {
    state.init.resp = leagueResp()
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.findAll('.cw-player-summary tbody tr')[0].trigger('click')
    const text = wrapper.find('.drawer-stub').text()
    expect(text).toContain('"dimensionMeans":[250,40,30,75,10,50,65]')
    expect(text).not.toContain('"dimensionScores"')
    wrapper.unmount()
  })

  it('Battle Drawer：player 携带本场 dimensionScores，绝不携带跨场 dimensionMeans', async () => {
    state.init.resp = makeResp({
      aggregate: [],
      battles: [{
        arenaId: '111', mapName: 'Lagoon',
        players: [{ team: 1, accountId: 1001, vehicleId: 7169, cells: {
          nickname: 'P1', league_rating: 812.6,
          league_damage_score: 320, league_assist_score: 55, league_kill_score: 70,
          league_exchange_score: 110, league_blocked_score: 40,
          league_survival_score: 75, league_shooting_score: 82,
        } }],
      }],
      leagueMode: true,
      league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [],
        playerSummaryColumns: [], teamSummaries: [], teamSummaryColumns: [], failures: [] },
    })
    state.init.activeTab = 'b0'
    const wrapper = mountPage({
      stubs: {
        BattleTable: {
          props: ['battle', 'league', 'leagueMode'],
          emits: ['select-player'],
          template: '<div class="battle-table-stub" @click="$emit(&quot;select-player&quot;, { scope: &apos;battle&apos;, accountId: 1001, arenaId: &apos;111&apos; })">battle</div>'
        }
      }
    })
    await flushPromises()
    await wrapper.find('.battle-table-stub').trigger('click')
    const text = wrapper.find('.drawer-stub').text()
    expect(text).toContain('"dimensionScores":[320,55,70,110,40,75,82]')
    expect(text).not.toContain('"dimensionMeans"')
    wrapper.unmount()
  })

  it('排序后 selected accountId 不变', async () => {
    state.init.resp = leagueResp()
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    const rows = wrapper.findAll('.cw-player-summary tbody tr')
    await rows[0].trigger('click')
    const th = wrapper.findAll('.cw-player-summary th').find(t => t.text().includes('nickname'))
    await th.trigger('click')
    const drawer = wrapper.find('.drawer-stub')
    expect(drawer.text()).toContain('open:1001')
    wrapper.unmount()
  })

  it('Tab 切换关闭 Drawer', async () => {
    state.init.resp = leagueResp()
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    const rows = wrapper.findAll('.cw-player-summary tbody tr')
    await rows[0].trigger('click')
    state.setActiveTab('b0')
    await nextTick()
    const drawer = wrapper.find('.drawer-stub')
    expect(drawer.text()).toBe('closed')
    wrapper.unmount()
  })
})
describe('ReplayPage CW unified table column contract + CW/Rating boundary', () => {
  beforeEach(() => {
    state.clear()
    state.init = { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'zh', files: [] }
    delete window.__testCwVisible
    delete window.__testCwOrder
  })

  function cwResp() {
    return makeResp({
      aggregate: [
        { team: 1, accountId: 1001, cells: { nickname: 'Alpha', clan: 'AAA', battles: 12, wins: 8, win_rate: 66.7, damage_avg: 500, earned_avg: 80, multi_damage_rate: 62.5, survival_time_avg: 120 } },
        { team: 2, accountId: 2001, cells: { nickname: 'Beta', clan: 'BBB', battles: 12, wins: 4, win_rate: 33.3, damage_avg: 300, earned_avg: 40, multi_damage_rate: 40.5, survival_time_avg: 95 } },
      ],
      aggregateColumns: [
        { key: 'nickname', num: false }, { key: 'clan', num: false }, { key: 'battles', num: true },
        { key: 'wins', num: true }, { key: 'win_rate', num: true }, { key: 'damage_avg', num: true },
        { key: 'earned_avg', num: true }, { key: 'multi_damage_rate', num: true },
        { key: 'survival_time_avg', num: true },
        { key: 'tanks', num: false },
      ],
      playerColumns: [{ key: 'nickname', label: '昵称' }, { key: 'league_rating', label: 'Rating' }],
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING',
        columns: [
          { key: 'league_rating', max: 1000, fixed: true },
          { key: 'league_damage_score', max: 400 },
          { key: 'league_shooting_score', max: 100 },
        ],
        playerSummaries: [
          { accountId: 1001, nickname: 'Alpha', clan: 'AAA', ratedBattles: 8, rating: 826.1, observedMean: 850.4, dimensionMeans: [342, 60, 70, 110, 40, 80, 100], mvpCount: 2, wins: 8 },
        ],
        playerSummaryColumns: [
          { key: 'nickname', num: false }, { key: 'clan', num: false }, { key: 'battles', num: true },
          { key: 'rated_battles', num: true },
          { key: 'league_rating', num: true }, { key: 'league_damage_score', num: true },
          { key: 'league_shooting_score', num: true }, { key: 'mvp_count', num: true },
          { key: 'wins', num: true },
        ],
        teamSummaries: [], teamSummaryColumns: [], failures: [],
      }
    })
  }

  function cwThKeys(wrapper) {
    return wrapper.findAll('.cw-player-summary th').map(t =>
      t.text().replace(/[▼▲]/g, '').replace(/^agg_labels\./, ''))
  }

  it('统一表列 = cw scope 可见列：七维/MVP 不是 forced visible', async () => {
    window.__testCwVisible = ['nickname', 'league_rating', 'clan', 'battles', 'rated_battles', 'wins', 'win_rate',
      'damage_avg', 'earned_avg', 'multi_damage_rate', 'survival_time_avg']
    state.init.resp = cwResp()
    const wrapper = mountPage()
    await flushPromises()
    const keys = cwThKeys(wrapper)
    expect(keys).not.toContain('league_damage_score')
    expect(keys).not.toContain('mvp_count')
    expect(keys[0]).toBe('nickname')
    expect(keys[1]).toBe('league_rating')
    expect(keys).toContain('multi_damage_rate')
    expect(keys).toContain('survival_time_avg')
    expect(keys).toContain('earned_avg')
    expect(keys).toContain('rated_battles')
    expect(keys).not.toContain('tanks')
    wrapper.unmount()
  })

  it('用户自定义顺序生效：nickname + league_rating 固定前两位，其余按偏好顺序', async () => {
    window.__testCwVisible = window.__testCwOrder = ['nickname', 'league_rating',
      'multi_damage_rate', 'rated_battles', 'damage_avg', 'league_damage_score', 'earned_avg', 'survival_time_avg']
    state.init.resp = cwResp()
    const wrapper = mountPage()
    await flushPromises()
    const keys = cwThKeys(wrapper)
    expect(keys).toEqual(['nickname', 'league_rating', 'multi_damage_rate', 'rated_battles', 'damage_avg', 'league_damage_score', 'earned_avg', 'survival_time_avg'])
    wrapper.unmount()
  })

  it('leagueMode=true + 该场 league=null（Rating-ineligible CW 场）：battle 点击仍打开 Drawer', async () => {
    state.init.resp = makeResp({
      aggregate: [],
      battles: [
        { arenaId: '111', mapName: 'Lagoon', league: null, players: [{ team: 1, accountId: 1001, vehicleId: 7169, cells: { nickname: 'P1', damage_dealt: 5000 } }] },
      ],
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING',
        columns: [{ key: 'league_rating', max: 1000, fixed: true }],
        playerSummaries: [], playerSummaryColumns: [], teamSummaries: [], teamSummaryColumns: [], failures: [],
      }
    })
    state.init.activeTab = 'b0'
    window.__testCwVisible = ['nickname', 'league_rating']
    const wrapper = mountPage({
      stubs: {
        BattleTable: {
          props: ['battle', 'league', 'leagueMode'],
          emits: ['select-player'],
          template: '<div class="battle-table-stub" data-testid="battle-stub" @click="$emit(&quot;select-player&quot;, { scope: &apos;battle&apos;, accountId: 1001, arenaId: &apos;111&apos; })">battle</div>'
        }
      }
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="league-summary-title"]').exists()).toBe(true)
    await wrapper.find('.battle-table-stub').trigger('click')
    const drawer = wrapper.find('.drawer-stub')
    expect(drawer.text()).toContain('open:1001')
    wrapper.unmount()
  })
})
describe('ReplayPage Drawer 玩家坦克数据透传', () => {
  beforeEach(() => {
    state.clear()
    state.init = { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'zh', files: [] }
  })
  afterEach(() => { delete window.__testCwVisible })

  it('Summary Drawer：透传 playerSummary 的 mostUsedVehicle + ratedBattles（数据源 row.league，不解析 cells.tanks）', async () => {
    state.init.resp = makeResp({
      aggregate: [{ team: 1, accountId: 1001, cells: { nickname: 'Alpha', clan: 'AAA', battles: 12 } }],
      battles: [],
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING', columns: [],
        playerSummaries: [
          { accountId: 1001, nickname: 'Alpha', clan: 'AAA', ratedBattles: 8, rating: 850, observedMean: 850,
            dimensionMeans: [2, 3, 4, 5, 6, 7, 8],
            mostUsedVehicle: { tankId: 7169, tankName: 'IS-7', battles: 3 } },
        ],
        playerSummaryColumns: [], teamSummaries: [], teamSummaryColumns: [], failures: [],
      }
    })
    state.init.activeTab = 'aggregate'
    window.__testCwVisible = ['nickname', 'league_rating']
    const wrapper = mountPage({
      stubs: {
        CwPlayerSummaryTable: {
          emits: ['select-player'],
          template: '<div class="cw-sum-stub" data-testid="cw-sum-stub" @click="$emit(&quot;select-player&quot;, { scope: &apos;summary&apos;, accountId: 1001 })">sum</div>'
        }
      }
    })
    await flushPromises()
    await wrapper.find('[data-testid="cw-sum-stub"]').trigger('click')
    const drawer = wrapper.find('.drawer-stub')
    expect(drawer.text()).toContain('open:1001')
    const player = JSON.parse(drawer.text().replace(/^open:\d+:/, ''))
    expect(player.mostUsedVehicle).toEqual({ tankId: 7169, tankName: 'IS-7', battles: 3 })
    expect(player.ratedBattles).toBe(8)
    wrapper.unmount()
  })

  it('Battle Drawer：透传本场 vehicleId/tank_name（battles=1）', async () => {
    state.init.resp = makeResp({
      aggregate: [],
      battles: [
        { arenaId: '111', mapName: 'Lagoon', league: {}, players: [
          { team: 1, accountId: 1001, vehicleId: 7169, cells: { nickname: 'P1', clan: 'AAA', tank_name: 'IS-7', damage_dealt: 5000 } },
        ] },
      ],
      leagueMode: true,
      league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], playerSummaryColumns: [], teamSummaries: [], teamSummaryColumns: [], failures: [] }
    })
    state.init.activeTab = 'b0'
    window.__testCwVisible = ['nickname', 'league_rating']
    const wrapper = mountPage({
      stubs: {
        BattleTable: {
          emits: ['select-player'],
          template: '<div class="battle-stub" data-testid="battle-stub" @click="$emit(&quot;select-player&quot;, { scope: &apos;battle&apos;, accountId: 1001, arenaId: &apos;111&apos; })">battle</div>'
        }
      }
    })
    await flushPromises()
    await wrapper.find('[data-testid="battle-stub"]').trigger('click')
    const drawer = wrapper.find('.drawer-stub')
    expect(drawer.text()).toContain('open:1001')
    const player = JSON.parse(drawer.text().replace(/^open:\d+:/, ''))
    expect(player.tankId).toBe(7169)
    expect(player.tankName).toBe('IS-7')
    expect(player.tankBattles).toBe(1)
    wrapper.unmount()
  })
})

describe('ReplayPage League failure UX separation', () => {
  beforeEach(() => {
    state.clear()
    state.init = { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'zh', files: [] }
  })

  function manyBattles(count, leagueFlags = true) {
    const out = []
    for (let i = 0; i < count; i++) {
      out.push({ mapName: 'Lagoon', sourceName: 'b' + i + '.wotbreplay', league: leagueFlags ? null : undefined, players: [{ cells: { nickname: 'P' + i, damage_dealt: 100 } }] })
    }
    return out
  }

  function manyLeagueFailures(count, code) {
    const out = []
    for (let i = 0; i < count; i++) out.push({ fileName: 'b' + i + '.wotbreplay', arenaId: 'arena-' + i, code })
    return out
  }

  it('Test 1: valid=30 duplicate=5 failed=0 + leagueFailures=30 → 无红色「文件解析失败」，League 汇总为 warning', async () => {
    state.init.resp = makeResp({
      battles: manyBattles(30, true),
      leagueMode: true,
      league: { mode: 'LEAGUE_RATING', failures: manyLeagueFailures(30, 'LEAGUE_ROSTER_INCOMPLETE') }
    })
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('[data-testid="result-failures"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('result.failures')
    const summary = wrapper.find('[data-testid="league-failure-summary"]')
    expect(summary.exists()).toBe(true)
    expect(summary.classes()).toContain('is-warning')
    expect(summary.classes()).not.toContain('is-danger')
    wrapper.unmount()
  })

  it('Test 2: League failure 汇总含可评分/未生成计数，可展开分组详情', async () => {
    state.init.resp = makeResp({
      battles: manyBattles(3, true),
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING',
        failures: [
          ...manyLeagueFailures(2, 'LEAGUE_ROSTER_INCOMPLETE'),
          { fileName: 'b2.wotbreplay', arenaId: 'arena-2', code: 'LEAGUE_ROSTER_MISMATCH' }
        ]
      }
    })
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.text()).toContain('league.rated_count:0,3')
    expect(wrapper.text()).toContain('league.unrated_count:3')
    await wrapper.find('[data-testid="league-failure-toggle"]').trigger('click')
    const groups = wrapper.findAll('[data-testid="league-failure-group"]')
    expect(groups.length).toBe(2)
    expect(groups[0].text()).toContain('LEAGUE_ROSTER_INCOMPLETE')
    expect(groups[0].text()).toContain('2')
    wrapper.unmount()
  })

  it('Test 3: League failure 不使用 destructive error 呈现（类为 warn 非 error）', async () => {
    state.init.resp = makeResp({
      battles: manyBattles(1, true),
      leagueMode: true,
      league: { mode: 'LEAGUE_RATING', failures: manyLeagueFailures(1, 'LEAGUE_NOT_SEVEN_VS_SEVEN') }
    })
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('[data-testid="league-failure-summary"]').classes()).toContain('is-warning')
    expect(wrapper.find('[data-testid="league-failure-summary"]').classes()).not.toContain('is-danger')
    expect(wrapper.find('[data-testid="result-failures"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('Test 4: 30 Battle + 0 Rating → battle tabs 全部存在，可逐场查看', async () => {
    state.init.resp = makeResp({
      battles: manyBattles(30, true),
      leagueMode: true,
      league: { mode: 'LEAGUE_RATING', failures: manyLeagueFailures(30, 'LEAGUE_ROSTER_INCOMPLETE') }
    })
    const wrapper = mountPage()
    await flushPromises()
    state.setActiveTab('b0')
    await flushPromises()
    expect(wrapper.findAll('.battle-table-stub').length).toBe(1)
    state.setActiveTab('b29')
    await flushPromises()
    expect(wrapper.findAll('.battle-table-stub').length).toBe(1)
    wrapper.unmount()
  })

  it('Test 5/6: 单场视图正常渲染；toolbar 不含重复 AI 复盘 / 战局回放入口（Workspace tabs 唯一导航）', async () => {
    state.init.resp = makeResp({
      battles: manyBattles(1, true),
      leagueMode: true,
      league: { mode: 'LEAGUE_RATING', failures: manyLeagueFailures(1, 'LEAGUE_ROSTER_INCOMPLETE') }
    })
    state.init.activeTab = 'b0'
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.findAll('.battle-table-stub').length).toBeGreaterThan(0)
    expect(wrapper.find('[data-testid="battle-ai-btn"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="battle-playback-btn"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('Test 7: 部分失败的提醒归工作台，赛后数据页不重复提示', async () => {
    state.init.resp = makeResp({
      failures: [['broken.wotbreplay', 'REPLAY_PROCESSING_FAILED']]
    })
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('[data-testid="result-failures"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('REPLAY_PROCESSING_FAILED')
    wrapper.unmount()
  })

  it('mixed 批次：leagueUnavailableCode 显示琥珀色提示，battles 正常渲染', async () => {
    state.init.resp = makeResp({
      battles: manyBattles(2, false),
      leagueUnavailableCode: 'MIXED_LEAGUE_AND_STANDARD_REPLAYS'
    })
    const wrapper = mountPage()
    await flushPromises()
    const notice = wrapper.find('[data-testid="league-unavailable"]')
    expect(notice.exists()).toBe(true)
    expect(notice.classes()).toContain('is-warning')
    expect(wrapper.text()).toContain('league.unavailable_mixed')
    state.setActiveTab('b0')
    await flushPromises()
    expect(wrapper.findAll('.battle-table-stub').length).toBe(1)
    state.setActiveTab('b1')
    await flushPromises()
    expect(wrapper.findAll('.battle-table-stub').length).toBe(1)
    expect(wrapper.find('[data-testid="result-failures"]').exists()).toBe(false)
    wrapper.unmount()
  })
})


describe('ReplayPage League 算法说明入口', () => {
  afterEach(() => {
    state.clear()
    state.init = { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'en' }
    vi.restoreAllMocks()
  })

  it('普通模式不显示算法说明按钮', () => {
    state.init = { activeTab: 'aggregate', resp: makeResp(), error: '', loading: false, locale: 'en' }
    const wrapper = mountPage()
    expect(wrapper.find('[data-testid="league-docs-btn"]').exists()).toBe(false)
  })

  it('League 模式显示算法说明按钮，点击跳转 rating-docs', async () => {
    const navigate = vi.fn()
    state.init = {
      activeTab: 'aggregate',
      resp: makeResp({ leagueMode: true, league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } }),
      error: '', loading: false, locale: 'en',
    }
    const wrapper = mountPage({ navigate })
    await flushPromises()
    const btn = wrapper.find('[data-testid="league-docs-btn"]')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    expect(navigate).toHaveBeenCalledWith('rating-docs')
  })
})


describe('ReplayPage battleSorts 批次边界', () => {
  beforeEach(() => {
    state.clear()
    state.init = { activeTab: 'aggregate', resp: makeResp(), error: '', loading: false, locale: 'en', files: [] }
  })

  const sortAttr = (wrapper) => wrapper.get('.battle-table-stub').attributes('data-sort-key')

  async function mountSortedAtBattle0() {
    const wrapper = mountPage()
    await flushPromises()
    state.setActiveTab('b0')
    await flushPromises()
    expect(sortAttr(wrapper)).toBe('')
    wrapper.vm.battleSorts[0] = { key: 'damage_dealt', reverse: false }
    await flushPromises()
    expect(sortAttr(wrapper)).toBe('damage_dealt')
    return wrapper
  }

  it('同批次：battle 0 排序 → battle 1 → 回 battle 0，排序仍保留', async () => {
    const wrapper = await mountSortedAtBattle0()
    state.setActiveTab('b1')
    await flushPromises()
    state.setActiveTab('b0')
    await flushPromises()
    expect(sortAttr(wrapper)).toBe('damage_dealt')
    wrapper.unmount()
  })

  it('跨批次：旧批次排序 → replaceSelection → 新批次 battle 0 恢复默认排序', async () => {
    const wrapper = await mountSortedAtBattle0()
    state.setResp(makeResp())
    state.replay.updateFiles(['next.wotbreplay'])
    await flushPromises()
    state.setActiveTab('b0')
    await flushPromises()
    expect(sortAttr(wrapper)).toBe('')
    wrapper.unmount()
  })
})
