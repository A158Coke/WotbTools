// @vitest-environment happy-dom

import { describe, expect, it, beforeEach, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useColumns } from './useColumns.js'
import { AGG_DEFAULT_VISIBLE, CW_SUMMARY_DEFAULT_VISIBLE, DEFAULT_VISIBLE, LEGACY_CW_SUMMARY_DEFAULT_VISIBLE, LEGACY_DEFAULT_VISIBLE } from '../utils/helpers.js'

// localStorage 隔离
function freshStorage() {
  const store = new Map()
  const storage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: k => store.delete(k)
  }
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
  return store
}

// B6：contribution/kast/impact/account_id/tank_id/alpha_damage/traded_deaths/victory_points_seized 已退役；
// tanks 仍在 wire 上但列层不展示。
const PLAYER_COLS = [
  { key: 'nickname', num: false },
  { key: 'kills', num: true },
  { key: 'damage_dealt', num: true },
  { key: 'damage_assisted', num: true },
  { key: 'damage_received', num: true },
  { key: 'hit_rate', num: true },
  { key: 'pen_rate', num: true }
]

const AGG_COLS = [
  { key: 'nickname', num: false },
  { key: 'battles', num: true },
  { key: 'win_rate', num: true },
  { key: 'damage_avg', num: true },
  { key: 'multi_damage_rate', num: true },
  { key: 'survival_time_avg', num: true },
  { key: 'tanks', num: false }
]

function mountCols(storage) {
  const playerCols = ref(PLAYER_COLS)
  const aggCols = ref(AGG_COLS)
  const dataViewMode = ref('SINGLE')
  const leagueMode = ref(false)
  const c = useColumns(playerCols, aggCols, dataViewMode, leagueMode)
  c.initFromResponse({ playerColumns: PLAYER_COLS, aggregateColumns: AGG_COLS, leagueMode: false })
  return c
}

describe('useColumns derived metric columns', () => {
  beforeEach(() => { freshStorage(); vi.clearAllMocks() })

  it('B6：DEFAULT_VISIBLE 已不含退役列（contribution/kast/impact/alpha_damage）', () => {
    expect(DEFAULT_VISIBLE).not.toContain('contribution')
    expect(DEFAULT_VISIBLE).not.toContain('kast')
    expect(DEFAULT_VISIBLE).not.toContain('impact')
    expect(DEFAULT_VISIBLE).not.toContain('alpha_damage')
    // 真实默认可见列仍在
    expect(DEFAULT_VISIBLE).toContain('damage_dealt')
  })

  it('审计 BZ-07：各表默认只显示 6–8 个核心列', () => {
    for (const defaults of [DEFAULT_VISIBLE, AGG_DEFAULT_VISIBLE, CW_SUMMARY_DEFAULT_VISIBLE]) {
      expect(defaults.length).toBeGreaterThanOrEqual(6)
      expect(defaults.length).toBeLessThanOrEqual(8)
    }
  })

  it('initFromResponse shows DEFAULT_VISIBLE columns for fresh users', () => {
    const c = mountCols(freshStorage())
    // 可见 = playerColumns ∩ DEFAULT_VISIBLE（保持响应列顺序）
    expect(c.visibleKeys.value).toEqual(['nickname', 'kills', 'damage_dealt', 'damage_assisted'])
  })

  it('从未改过列的老用户（存档 = 旧默认值）迁到新的核心列；自定义过的保持不变', async () => {
    const store = freshStorage()
    store.set('wotb-replay-player-visible-cols', JSON.stringify(LEGACY_DEFAULT_VISIBLE[0]))
    store.set('wotb-replay-player-order', JSON.stringify(PLAYER_COLS.map(c => c.key)))
    const migrated = mountCols(store)
    expect(migrated.visibleKeys.value).toEqual(['nickname', 'kills', 'damage_dealt', 'damage_assisted'])

    store.set('wotb-replay-player-visible-cols', JSON.stringify(['nickname', 'hit_rate']))
    const custom = mountCols(store)
    expect(custom.visibleKeys.value).toEqual(['nickname', 'hit_rate'])
  })

  it('toggleCol hides/shows a column', async () => {
    const c = mountCols(freshStorage())
    c.toggleCol({ key: 'damage_received', scope: 'player' })
    expect(c.visibleKeys.value).toContain('damage_received')
    c.toggleCol({ key: 'damage_received', scope: 'player' })
    expect(c.visibleKeys.value).not.toContain('damage_received')
  })

  it('resetCols restores the DEFAULT_VISIBLE columns', () => {
    const c = mountCols(freshStorage())
    c.toggleCol({ key: 'damage_received', scope: 'player' })
    c.toggleCol({ key: 'damage_dealt', scope: 'player' })
    expect(c.visibleKeys.value).toContain('damage_received')
    expect(c.visibleKeys.value).not.toContain('damage_dealt')
    c.resetCols('player')
    expect(c.visibleKeys.value).not.toContain('damage_received')
    expect(c.visibleKeys.value).toContain('damage_dealt')
  })

  it('aggregate：默认只显示核心列，跨场派生指标在列面板里可打开', () => {
    const c = mountCols(freshStorage())
    expect(c.aggVisibleKeys.value).toEqual(['nickname', 'battles', 'win_rate', 'damage_avg'])
    expect(c.aggOrder.value).toContain('multi_damage_rate')
    expect(c.aggOrder.value).toContain('survival_time_avg')
    c.toggleCol({ key: 'multi_damage_rate', scope: 'agg' })
    expect(c.aggVisibleKeys.value).toContain('multi_damage_rate')
    c.resetCols('agg')
    expect(c.aggVisibleKeys.value).toEqual(['nickname', 'battles', 'win_rate', 'damage_avg'])
  })

  it('B6：aggregate universe 排除 tanks（wire 上仍在，但不是展示列）', () => {
    const c = mountCols(freshStorage())
    expect(c.aggOrder.value).not.toContain('tanks')
    expect(c.aggVisibleKeys.value).not.toContain('tanks')
    // reset 也不得把 tanks 复活
    c.resetCols('agg')
    expect(c.aggOrder.value).not.toContain('tanks')
    expect(c.aggVisibleKeys.value).not.toContain('tanks')
  })
})

// ---- League Rating 列 scope（普通与 League 列偏好互不污染） ----

const LEAGUE_PLAYER_COLS = [
  { key: 'nickname', num: false },
  { key: 'league_rating', num: true },
  { key: 'clan', num: false },
  { key: 'tank_name', num: false },
  { key: 'kills', num: true },
  { key: 'damage_dealt', num: true },
  { key: 'damage_assisted', num: true },
  // League 单场列 universe 里的可选事实列（非默认可见）
  { key: 'victory_points_earned', num: true },
  { key: 'league_damage_score', num: true }
]

function mountLeagueCols(storage) {
  const playerCols = ref(LEAGUE_PLAYER_COLS)
  const aggCols = ref(AGG_COLS)
  const dataViewMode = ref('SINGLE')
  const leagueMode = ref(true)
  const c = useColumns(playerCols, aggCols, dataViewMode, leagueMode)
  c.initFromResponse({ playerColumns: LEAGUE_PLAYER_COLS, aggregateColumns: AGG_COLS, leagueMode: true })
  return c
}

describe('useColumns League Rating scope', () => {
  beforeEach(() => { freshStorage(); vi.clearAllMocks() })

  it('league mode pins nickname + league_rating first and marks mode', () => {
    const c = mountLeagueCols(freshStorage())
    expect(c.leagueMode.value).toBe(true)
    expect(c.playerOrder.value.slice(0, 2)).toEqual(['nickname', 'league_rating'])
  })

  it('leagueMode 唯一事实源：playerColumns 含 league_rating 但 leagueMode=false → 普通模式', async () => {
    const store = freshStorage()
    const c = useColumns(ref(LEAGUE_PLAYER_COLS), ref(AGG_COLS), ref('SINGLE'), ref(false))
    c.initFromResponse({ playerColumns: LEAGUE_PLAYER_COLS, aggregateColumns: AGG_COLS, leagueMode: false })
    expect(c.leagueMode.value).toBe(false)
    // 普通可见列默认（DEFAULT_VISIBLE）：league_rating 不默认显示、kills 默认显示
    expect(c.visibleKeys.value).not.toContain('league_rating')
    expect(c.visibleKeys.value).toContain('kills')
    // 持久化走普通 storage scope，不污染 league scope
    c.toggleCol({ key: 'victory_points_earned', scope: 'player' })
    await nextTick()
    expect(store.get('wotb-replay-player-visible-cols')).toBeTruthy()
    expect(store.has('wotb-league-player-visible-cols')).toBe(false)
  })

  it('leagueMode=true 即使 playerColumns 不含 league_rating 也是 CW 列契约', () => {
    const c = useColumns(ref(PLAYER_COLS), ref(AGG_COLS), ref('SINGLE'), ref(true))
    c.initFromResponse({ playerColumns: PLAYER_COLS, aggregateColumns: AGG_COLS, leagueMode: true })
    expect(c.leagueMode.value).toBe(true)
    // league_rating 不在列 universe，固定对不强制出现；但 cw scope（汇总 tab）仍可用
    const agg = useColumns(ref(PLAYER_COLS), ref(CW_AGG_COLS), ref('SUMMARY'), ref(true))
    agg.initFromResponse({
      playerColumns: PLAYER_COLS, aggregateColumns: CW_AGG_COLS, leagueMode: true,
      league: { playerSummaryColumns: LEAGUE_SUMMARY_COLS },
    })
    expect(agg.colScope.value).toBe('cw')
    expect(agg.cwOrder.value.slice(0, 2)).toEqual(['nickname', 'league_rating'])
  })

  it('league rating column is always visible and not hideable', () => {
    const c = mountLeagueCols(freshStorage())
    c.toggleCol({ key: 'league_rating', scope: 'player' })
    expect(c.visibleKeys.value).toContain('league_rating')
    c.resetCols('player')
    expect(c.visibleKeys.value).toContain('league_rating')
  })

  it('league battle columns keep optional facts in universe, not default-visible, toggleable', () => {
    const c = mountLeagueCols(freshStorage())
    // 存在于列 universe（ColumnPicker 可显示）
    expect(c.playerOrder.value).toContain('victory_points_earned')
    // 默认不显示（LEAGUE_DEFAULT_VISIBLE 不含占点原始字段）
    expect(c.visibleKeys.value).not.toContain('victory_points_earned')
    // 可 toggle
    c.toggleCol({ key: 'victory_points_earned', scope: 'player' })
    expect(c.visibleKeys.value).toContain('victory_points_earned')
    expect(c.visibleKeys.value).toContain('league_rating')
    expect(c.visibleKeys.value).toContain('damage_dealt')
  })

  it('league dimension columns are toggleable and hidden by default', () => {
    const c = mountLeagueCols(freshStorage())
    expect(c.visibleKeys.value).not.toContain('league_damage_score')
    c.toggleCol({ key: 'league_damage_score', scope: 'player' })
    expect(c.visibleKeys.value).toContain('league_damage_score')
    c.toggleCol({ key: 'league_damage_score', scope: 'player' })
    expect(c.visibleKeys.value).not.toContain('league_damage_score')
  })

  it('reorder re-pins fixed columns to the front', () => {
    const c = mountLeagueCols(freshStorage())
    c.handleReorder(['league_rating', 'kills', 'nickname', 'clan'])
    expect(c.playerOrder.value.slice(0, 2)).toEqual(['nickname', 'league_rating'])
    expect(c.playerOrder.value).toContain('kills')
  })

  it('standard and league scopes do not pollute each other', async () => {
    const store = freshStorage()
    const standard = mountCols(store)
    standard.toggleCol({ key: 'damage_received', scope: 'player' })
    await nextTick() // 等 storage watcher flush（异步）
    const standardOrder = [...standard.playerOrder.value]
    const standardVisible = [...standard.visibleKeys.value]

    const league = mountLeagueCols(store)
    expect(league.playerOrder.value.slice(0, 2)).toEqual(['nickname', 'league_rating'])
    league.toggleCol({ key: 'league_damage_score', scope: 'player' })
    await nextTick()

    // 切回普通模式：旧偏好保留，且不受 league 改动影响
    const standardAgain = mountCols(store)
    expect(standardAgain.playerOrder.value).toEqual(standardOrder)
    expect(standardAgain.visibleKeys.value).toEqual(standardVisible)
  })
})

// ---- CW 统一玩家表 cw scope（nickname + rating 固定，其余用户自由）----

const LEAGUE_SUMMARY_COLS = [
  { key: 'nickname', num: false },
  { key: 'clan', num: false },
  { key: 'battles', num: true },
  // rated_battles 进入生产 Column contract（后端 ColumnDef → merge → cw universe）
  { key: 'rated_battles', num: true },
  { key: 'league_rating', num: true },
  { key: 'league_damage_score', num: true },
  { key: 'league_shooting_score', num: true },
  { key: 'mvp_count', num: true },
  { key: 'wins', num: true },
]

const CW_AGG_COLS = [
  { key: 'nickname', num: false },
  { key: 'battles', num: true },
  { key: 'wins', num: true },
  { key: 'win_rate', num: true },
  { key: 'damage_avg', num: true },
  { key: 'earned_avg', num: true },
  { key: 'tanks', num: false },
  { key: 'multi_damage_rate', num: true },
]

function mountCwCols(storage) {
  const playerCols = ref(LEAGUE_PLAYER_COLS)
  const aggCols = ref(CW_AGG_COLS)
  const dataViewMode = ref('SUMMARY')
  const leagueMode = ref(true)
  const c = useColumns(playerCols, aggCols, dataViewMode, leagueMode)
  c.initFromResponse({
    playerColumns: LEAGUE_PLAYER_COLS,
    aggregateColumns: CW_AGG_COLS,
    leagueMode: true,
    league: { playerSummaryColumns: LEAGUE_SUMMARY_COLS },
  })
  return c
}

describe('useColumns CW unified summary scope', () => {
  beforeEach(() => { freshStorage(); vi.clearAllMocks() })

  it('cw scope: nickname + league_rating pinned first；默认核心列，七维 / 观察均值在列面板里', () => {
    const c = mountCwCols(freshStorage())
    expect(c.cwOrder.value.slice(0, 2)).toEqual(['nickname', 'league_rating'])
    expect(c.cwVisibleKeys.value).toContain('mvp_count')
    expect(c.cwVisibleKeys.value).toContain('damage_avg')
    expect(c.cwVisibleKeys.value).toContain('rated_battles')
    // 七维与观察均值不再默认显示（审计 BZ-07），仍在列 universe 里
    expect(c.cwVisibleKeys.value).not.toContain('league_damage_score')
    expect(c.cwVisibleKeys.value).not.toContain('earned_avg')
    expect(c.cwOrder.value).toContain('league_damage_score')
  })

  it('cw：存档 = 旧默认值时迁到新核心列', () => {
    const store = freshStorage()
    store.set('wotb-league-cw-visible-cols', JSON.stringify(LEGACY_CW_SUMMARY_DEFAULT_VISIBLE[0]))
    const c = mountCwCols(store)
    expect(c.cwVisibleKeys.value).not.toContain('league_damage_score')
    expect(c.cwVisibleKeys.value).toContain('mvp_count')
  })

  it('B6：tanks 不进 cw 列 universe（aggregate wire 上仍在）', () => {
    const c = mountCwCols(freshStorage())
    expect(CW_AGG_COLS.map(x => x.key)).toContain('tanks')
    expect(c.cwOrder.value).not.toContain('tanks')
    expect(c.cwVisibleKeys.value).not.toContain('tanks')
  })

  it('nickname + league_rating cannot be hidden in cw scope', () => {
    const c = mountCwCols(freshStorage())
    c.toggleCol({ key: 'league_rating', scope: 'cw' })
    c.toggleCol({ key: 'nickname', scope: 'cw' })
    expect(c.cwVisibleKeys.value).toContain('league_rating')
    expect(c.cwVisibleKeys.value).toContain('nickname')
  })

  it('dimensions / MVP / performance columns can be hidden and re-shown', () => {
    const c = mountCwCols(freshStorage())
    c.toggleCol({ key: 'league_damage_score', scope: 'cw' })
    expect(c.cwVisibleKeys.value).toContain('league_damage_score')
    c.toggleCol({ key: 'league_damage_score', scope: 'cw' })
    expect(c.cwVisibleKeys.value).not.toContain('league_damage_score')
    // B6 后仅剩的 Performance Metrics（multi_damage_rate）可 toggle
    expect(c.cwVisibleKeys.value).not.toContain('multi_damage_rate')
    c.toggleCol({ key: 'multi_damage_rate', scope: 'cw' })
    expect(c.cwVisibleKeys.value).toContain('multi_damage_rate')
    c.toggleCol({ key: 'multi_damage_rate', scope: 'cw' })
    expect(c.cwVisibleKeys.value).not.toContain('multi_damage_rate')
  })

  it('user custom order applies: multi_damage_rate, league_shooting_score, damage_avg, league_damage_score, earned_avg → nickname, league_rating 前置', () => {
    const c = mountCwCols(freshStorage())
    c.pickerScope.value = 'cw' // 真实流程：toggleColPicker 先设 pickerScope 再 handleReorder
    c.handleReorder(['multi_damage_rate', 'league_shooting_score', 'damage_avg', 'league_damage_score', 'earned_avg'])
    expect(c.cwOrder.value).toEqual([
      'nickname', 'league_rating',
      'multi_damage_rate', 'league_shooting_score', 'damage_avg', 'league_damage_score', 'earned_avg',
    ])
  })

  it('another custom order proves not hardcoded', () => {
    const c = mountCwCols(freshStorage())
    c.pickerScope.value = 'cw'
    c.handleReorder(['mvp_count', 'win_rate', 'league_damage_score', 'league_shooting_score', 'battles'])
    expect(c.cwOrder.value).toEqual([
      'nickname', 'league_rating',
      'mvp_count', 'win_rate', 'league_damage_score', 'league_shooting_score', 'battles',
    ])
  })

  it('cw preference persists across remount', async () => {
    const store = freshStorage()
    const c1 = mountCwCols(store)
    c1.toggleCol({ key: 'mvp_count', scope: 'cw' }) // 隐藏 → visible 持久化
    // 完整 order reorder（ColumnPicker 语义：拖拽后 emit 完整数组）
    const reordered = ['nickname', 'league_rating', 'multi_damage_rate', 'league_shooting_score', 'earned_avg', 'clan',
      'battles', 'wins', 'win_rate', 'damage_avg', 'mvp_count', 'rated_battles',
      'league_damage_score', 'tanks']
    c1.pickerScope.value = 'cw'
    c1.handleReorder(reordered)
    await nextTick()
    const c2 = mountCwCols(store)
    expect(c2.cwVisibleKeys.value).not.toContain('mvp_count') // visible 持久化
    expect(c2.cwOrder.value.slice(0, 2)).toEqual(['nickname', 'league_rating'])
    expect(c2.cwOrder.value[2]).toBe('multi_damage_rate')
    expect(c2.cwOrder.value[3]).toBe('league_shooting_score')
    // 持久化偏好里的 tanks 被 universe 过滤，不复活
    expect(c2.cwOrder.value).not.toContain('tanks')
  })

  it('colScope: league summary tab → cw; league battle tab → player', () => {
    const dataViewMode = ref('SUMMARY')
    const c = useColumns(ref(LEAGUE_PLAYER_COLS), ref(CW_AGG_COLS), dataViewMode, ref(true))
    c.initFromResponse({
      playerColumns: LEAGUE_PLAYER_COLS,
      aggregateColumns: CW_AGG_COLS,
      leagueMode: true,
      league: { playerSummaryColumns: LEAGUE_SUMMARY_COLS },
    })
    expect(c.colScope.value).toBe('cw')
    dataViewMode.value = 'SINGLE'
    expect(c.colScope.value).toBe('player')
  })

  it('resetCols cw restores defaults with fixed pair front', () => {
    const c = mountCwCols(freshStorage())
    c.toggleCol({ key: 'multi_damage_rate', scope: 'cw' })
    c.pickerScope.value = 'cw'
    c.handleReorder(['multi_damage_rate', 'league_shooting_score'])
    expect(c.cwVisibleKeys.value).toContain('multi_damage_rate')
    c.resetCols('cw')
    expect(c.cwOrder.value.slice(0, 2)).toEqual(['nickname', 'league_rating'])
    expect(c.cwVisibleKeys.value).toContain('mvp_count')
    expect(c.cwVisibleKeys.value).not.toContain('multi_damage_rate')
  })

  it('rated_battles 进入生产 cw column contract：universe/order/visible/toggle/reorder', () => {
    const c = mountCwCols(freshStorage())
    // 真实 response-like 链：league.playerSummaryColumns（含 rated_battles）→ mergeCwPlayerColumns
    // → cwOrder/cwVisibleKeys（默认可见 + 固定对前置）
    expect(c.cwOrder.value).toContain('rated_battles')
    expect(c.cwVisibleKeys.value).toContain('rated_battles')
    // 不可隐藏的固定对仍是 nickname + league_rating；rated_battles 可 toggle
    c.toggleCol({ key: 'rated_battles', scope: 'cw' })
    expect(c.cwVisibleKeys.value).not.toContain('rated_battles')
    c.toggleCol({ key: 'rated_battles', scope: 'cw' })
    expect(c.cwVisibleKeys.value).toContain('rated_battles')
    // reorder：rated_battles 可放在任意非固定位置（如 multi_damage_rate 之后）
    c.pickerScope.value = 'cw'
    c.handleReorder(['multi_damage_rate', 'rated_battles', 'league_shooting_score', 'league_damage_score'])
    expect(c.cwOrder.value).toEqual([
      'nickname', 'league_rating', 'multi_damage_rate', 'rated_battles', 'league_shooting_score', 'league_damage_score',
    ])
  })
})

describe('列默认值迁移只做一次（审查：全选后不能被重置）', () => {
  beforeEach(() => { freshStorage(); vi.clearAllMocks() })

  it('迁移后写入版本标记；之后「全选」与「恰好等于旧默认值」的选择都会保留', async () => {
    const store = freshStorage()
    const first = mountCols(store)
    expect(store.get('wotb-columns-defaults-v')).toBe('2')
    first.selectAllCols('agg')
    first.visibleKeys.value = [...LEGACY_DEFAULT_VISIBLE[0]].filter(key => first.playerOrder.value.includes(key))
    await nextTick()
    const second = mountCols(store)
    expect(second.aggVisibleKeys.value).toEqual(second.aggOrder.value)
    expect(second.visibleKeys.value).toEqual(first.visibleKeys.value)
  })
})
