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

  it('league default visible excludes legacy metrics and includes rating', () => {
    const c = mountLeagueCols(freshStorage())
    expect(c.visibleKeys.value).not.toContain('contribution')
    expect(c.visibleKeys.value).not.toContain('kast')
    expect(c.visibleKeys.value).not.toContain('impact')
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
    expect(league.visibleKeys.value).not.toContain('kast')
    league.toggleCol({ key: 'league_damage_score', scope: 'player' })
    await nextTick()

    // 切回普通模式：旧偏好保留，且不受 league 改动影响
    const standardAgain = mountCols(store)
    expect(standardAgain.playerOrder.value).toEqual(standardOrder)
    expect(standardAgain.visibleKeys.value).toEqual(standardVisible)
  })
})
