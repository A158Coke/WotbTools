// @vitest-environment happy-dom

import { describe, expect, it, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
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
