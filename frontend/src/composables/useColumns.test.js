// @vitest-environment happy-dom

import { describe, expect, it, beforeEach, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useColumns } from './useColumns.js'
import { DEFAULT_VISIBLE } from '../utils/helpers.js'

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

const PLAYER_COLS = [
  { key: 'nickname', num: false },
  { key: 'kills', num: true },
  { key: 'damage_dealt', num: true },
  { key: 'damage_assisted', num: true },
  { key: 'contribution', num: true },
  { key: 'kast', num: true },
  { key: 'impact', num: true },
  { key: 'damage_received', num: true },
  { key: 'account_id', num: true }
]

const AGG_COLS = [
  { key: 'nickname', num: false },
  { key: 'contribution', num: true },
  { key: 'kast', num: true },
  { key: 'impact', num: true },
  { key: 'multi_damage_rate', num: true },
  { key: 'traded_deaths', num: true }
]

function mountCols(storage) {
  const playerCols = ref(PLAYER_COLS)
  const aggCols = ref(AGG_COLS)
  const activeTab = ref('b0')
  const c = useColumns(playerCols, aggCols, activeTab)
  c.initFromResponse({ playerColumns: PLAYER_COLS, aggregateColumns: AGG_COLS })
  return c
}

describe('useColumns derived metric columns', () => {
  beforeEach(() => { freshStorage(); vi.clearAllMocks() })

  it('DEFAULT_VISIBLE includes contribution/kast/impact (default visible per product goal)', () => {
    expect(DEFAULT_VISIBLE).toContain('contribution')
    expect(DEFAULT_VISIBLE).toContain('kast')
    expect(DEFAULT_VISIBLE).toContain('impact')
  })

  it('initFromResponse shows the three columns by default for fresh users', () => {
    const c = mountCols(freshStorage())
    expect(c.visibleKeys.value).toContain('contribution')
    expect(c.visibleKeys.value).toContain('kast')
    expect(c.visibleKeys.value).toContain('impact')
  })

  it('toggleCol hides/shows a derived column', async () => {
    const c = mountCols(freshStorage())
    c.toggleCol({ key: 'kast', scope: 'player' })
    expect(c.visibleKeys.value).not.toContain('kast')
    c.toggleCol({ key: 'kast', scope: 'player' })
    expect(c.visibleKeys.value).toContain('kast')
  })

  it('resetCols restores the three core columns', () => {
    const c = mountCols(freshStorage())
    c.toggleCol({ key: 'contribution', scope: 'player' })
    c.toggleCol({ key: 'impact', scope: 'player' })
    expect(c.visibleKeys.value).not.toContain('contribution')
    c.resetCols('player')
    expect(c.visibleKeys.value).toContain('contribution')
    expect(c.visibleKeys.value).toContain('kast')
    expect(c.visibleKeys.value).toContain('impact')
  })

  it('aggregate columns include cross-battle metrics and default to visible', () => {
    const c = mountCols(freshStorage())
    expect(c.aggVisibleKeys.value).toContain('contribution')
    expect(c.aggVisibleKeys.value).toContain('kast')
    expect(c.aggVisibleKeys.value).toContain('impact')
    expect(c.aggVisibleKeys.value).toContain('multi_damage_rate')
    expect(c.aggVisibleKeys.value).toContain('traded_deaths')
  })
})

// ---- League Rating 列 scope（plan §16：普通与 League 列偏好互不污染） ----

const LEAGUE_PLAYER_COLS = [
  { key: 'nickname', num: false },
  { key: 'league_rating', num: true },
  { key: 'clan', num: false },
  { key: 'tank_name', num: false },
  { key: 'kills', num: true },
  { key: 'damage_dealt', num: true },
  { key: 'damage_assisted', num: true },
  // review PR#134 BLOCKER 1：Performance Metrics 保留在 CW 单场列 universe
  { key: 'contribution', num: true },
  { key: 'kast', num: true },
  { key: 'impact', num: true },
  { key: 'league_damage_score', num: true },
  { key: 'victory_points_earned', num: true }
]

function mountLeagueCols(storage) {
  const playerCols = ref(LEAGUE_PLAYER_COLS)
  const aggCols = ref(AGG_COLS)
  const activeTab = ref('b0')
  const c = useColumns(playerCols, aggCols, activeTab)
  c.initFromResponse({ playerColumns: LEAGUE_PLAYER_COLS, aggregateColumns: AGG_COLS })
  return c
}

describe('useColumns League Rating scope', () => {
  beforeEach(() => { freshStorage(); vi.clearAllMocks() })

  it('league mode pins nickname + league_rating first and marks mode', () => {
    const c = mountLeagueCols(freshStorage())
    expect(c.leagueMode.value).toBe(true)
    expect(c.playerOrder.value.slice(0, 2)).toEqual(['nickname', 'league_rating'])
  })

  it('league rating column is always visible and not hideable', () => {
    const c = mountLeagueCols(freshStorage())
    c.toggleCol({ key: 'league_rating', scope: 'player' })
    expect(c.visibleKeys.value).toContain('league_rating')
    c.resetCols('player')
    expect(c.visibleKeys.value).toContain('league_rating')
  })

  it('league battle columns keep contribution/kast/impact in universe (BLOCKER 1), not default-visible, toggleable', () => {
    const c = mountLeagueCols(freshStorage())
    // 存在于列 universe（ColumnPicker 可显示）
    expect(c.playerOrder.value).toContain('contribution')
    expect(c.playerOrder.value).toContain('kast')
    expect(c.playerOrder.value).toContain('impact')
    // 默认不显示（LEAGUE_DEFAULT_VISIBLE 不含表现指标）
    expect(c.visibleKeys.value).not.toContain('contribution')
    // 可 toggle
    c.toggleCol({ key: 'kast', scope: 'player' })
    expect(c.visibleKeys.value).toContain('kast')
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
    standard.toggleCol({ key: 'kast', scope: 'player' })
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

// ---- review PR#134 BLOCKER 2：CW 统一玩家表 cw scope（nickname + rating 固定，其余用户自由）----

const LEAGUE_SUMMARY_COLS = [
  { key: 'nickname', num: false },
  { key: 'clan', num: false },
  { key: 'battles', num: true },
  // review PR#134 BLOCKER 2：rated_battles 进入生产 Column contract（后端 ColumnDef → merge → cw universe）
  { key: 'rated_battles', num: true },
  { key: 'league_rating', num: true },
  { key: 'league_damage_score', num: true },
  { key: 'league_shooting_score', num: true },
  { key: 'mvp_count', num: true },
  { key: 'wins', num: true },
  { key: 'contribution', num: true },
  { key: 'kast', num: true },
  { key: 'impact', num: true },
]

const CW_AGG_COLS = [
  { key: 'nickname', num: false },
  { key: 'battles', num: true },
  { key: 'wins', num: true },
  { key: 'win_rate', num: true },
  { key: 'damage_avg', num: true },
  { key: 'earned_avg', num: true },
  { key: 'tanks', num: false },
  { key: 'contribution', num: true },
  { key: 'kast', num: true },
  { key: 'impact', num: true },
]

function mountCwCols(storage) {
  const playerCols = ref(LEAGUE_PLAYER_COLS)
  const aggCols = ref(CW_AGG_COLS)
  const activeTab = ref('aggregate')
  const c = useColumns(playerCols, aggCols, activeTab)
  c.initFromResponse({
    playerColumns: LEAGUE_PLAYER_COLS,
    aggregateColumns: CW_AGG_COLS,
    league: { playerSummaryColumns: LEAGUE_SUMMARY_COLS },
  })
  return c
}

describe('useColumns CW unified summary scope (review PR#134 BLOCKER 2)', () => {
  beforeEach(() => { freshStorage(); vi.clearAllMocks() })

  it('cw scope: nickname + league_rating pinned first, dims/mvp/perf default-visible, facts toggleable', () => {
    const c = mountCwCols(freshStorage())
    expect(c.cwOrder.value.slice(0, 2)).toEqual(['nickname', 'league_rating'])
    // 七维/MVP/表现指标默认可见（延续旧体验），但属于用户可控制列
    expect(c.cwVisibleKeys.value).toContain('league_damage_score')
    expect(c.cwVisibleKeys.value).toContain('mvp_count')
    expect(c.cwVisibleKeys.value).toContain('contribution')
    expect(c.cwVisibleKeys.value).toContain('kast')
    expect(c.cwVisibleKeys.value).toContain('impact')
    // 纯 facts 列默认可见
    expect(c.cwVisibleKeys.value).toContain('damage_avg')
    expect(c.cwVisibleKeys.value).toContain('earned_avg')
  })

  it('nickname + league_rating cannot be hidden in cw scope', () => {
    const c = mountCwCols(freshStorage())
    c.toggleCol({ key: 'league_rating', scope: 'cw' })
    c.toggleCol({ key: 'nickname', scope: 'cw' })
    expect(c.cwVisibleKeys.value).toContain('league_rating')
    expect(c.cwVisibleKeys.value).toContain('nickname')
  })

  it('seven dimensions / MVP / perf can be hidden and re-shown', () => {
    const c = mountCwCols(freshStorage())
    c.toggleCol({ key: 'league_damage_score', scope: 'cw' })
    expect(c.cwVisibleKeys.value).not.toContain('league_damage_score')
    c.toggleCol({ key: 'league_damage_score', scope: 'cw' })
    expect(c.cwVisibleKeys.value).toContain('league_damage_score')
    c.toggleCol({ key: 'kast', scope: 'cw' })
    expect(c.cwVisibleKeys.value).not.toContain('kast')
  })

  it('user custom order applies: impact, kast, damage_avg, league_damage_score, earned_avg → nickname, league_rating 前置（BLOCKER 2.11）', () => {
    const c = mountCwCols(freshStorage())
    c.pickerScope.value = 'cw' // 真实流程：toggleColPicker 先设 pickerScope 再 handleReorder
    c.handleReorder(['impact', 'kast', 'damage_avg', 'league_damage_score', 'earned_avg'])
    expect(c.cwOrder.value).toEqual([
      'nickname', 'league_rating',
      'impact', 'kast', 'damage_avg', 'league_damage_score', 'earned_avg',
    ])
  })

  it('another custom order proves not hardcoded (BLOCKER 2.11)', () => {
    const c = mountCwCols(freshStorage())
    c.pickerScope.value = 'cw'
    c.handleReorder(['kast', 'contribution', 'league_damage_score', 'league_assist_score', 'battles'])
    expect(c.cwOrder.value).toEqual([
      'nickname', 'league_rating',
      'kast', 'contribution', 'league_damage_score', 'league_assist_score', 'battles',
    ])
  })

  it('cw preference persists across remount (BLOCKER 2.4)', async () => {
    const store = freshStorage()
    const c1 = mountCwCols(store)
    c1.toggleCol({ key: 'league_damage_score', scope: 'cw' }) // 隐藏 → visible 持久化
    // 完整 order reorder（ColumnPicker 语义：拖拽后 emit 完整数组）
    const reordered = ['nickname', 'league_rating', 'impact', 'kast', 'earned_avg', 'clan', 'battles',
      'wins', 'win_rate', 'damage_avg', 'contribution', 'mvp_count', 'league_shooting_score',
      'league_damage_score', 'league_assist_score', 'league_kill_score', 'league_exchange_score',
      'league_blocked_score', 'league_survival_score', 'tanks']
    c1.pickerScope.value = 'cw'
    c1.handleReorder(reordered)
    await nextTick()
    const c2 = mountCwCols(store)
    expect(c2.cwVisibleKeys.value).not.toContain('league_damage_score') // visible 持久化
    expect(c2.cwOrder.value.slice(0, 2)).toEqual(['nickname', 'league_rating'])
    expect(c2.cwOrder.value[2]).toBe('impact')
    expect(c2.cwOrder.value[3]).toBe('kast')
  })

  it('colScope: league summary tab → cw; league battle tab → player', () => {
    const activeTab = ref('aggregate')
    const c = useColumns(ref(LEAGUE_PLAYER_COLS), ref(CW_AGG_COLS), activeTab)
    c.initFromResponse({
      playerColumns: LEAGUE_PLAYER_COLS,
      aggregateColumns: CW_AGG_COLS,
      league: { playerSummaryColumns: LEAGUE_SUMMARY_COLS },
    })
    expect(c.colScope.value).toBe('cw')
    activeTab.value = 'b0'
    expect(c.colScope.value).toBe('player')
  })

  it('resetCols cw restores defaults with fixed pair front', () => {
    const c = mountCwCols(freshStorage())
    c.toggleCol({ key: 'league_shooting_score', scope: 'cw' })
    c.pickerScope.value = 'cw'
    c.handleReorder(['impact', 'kast'])
    c.resetCols('cw')
    expect(c.cwOrder.value.slice(0, 2)).toEqual(['nickname', 'league_rating'])
    expect(c.cwVisibleKeys.value).toContain('league_shooting_score')
    expect(c.cwVisibleKeys.value).toContain('impact')
  })

  it('rated_battles 进入生产 cw column contract（BLOCKER 2）：universe/order/visible/toggle/reorder', () => {
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
    // reorder：rated_battles 可放在任意非固定位置（如 impact 之后）
    c.pickerScope.value = 'cw'
    c.handleReorder(['impact', 'rated_battles', 'kast', 'league_damage_score'])
    expect(c.cwOrder.value).toEqual([
      'nickname', 'league_rating', 'impact', 'rated_battles', 'kast', 'league_damage_score',
    ])
  })
})
