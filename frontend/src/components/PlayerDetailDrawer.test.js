// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PlayerDetailDrawer from './PlayerDetailDrawer.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: key => key, locale: { value: 'zh' } })
}))

const SUMMARY_PLAYER = {
  accountId: 1001,
  nickname: 'Alpha',
  clan: 'AAA',
  rating: 850.4,
  rawMedian: 850.4,
  dimensionMedians: [342, 60, 70, 110, 40, 80, 100],
  dimensionMeans: [250, 40, 30, 75, 10, 50, 65],
  mvpCount: 2,
  battles: 3,
  wins: 2,
  cells: {
    account_id: 1001, battles: 12, rated_battles: 8, wins: 2, win_rate: 66.7,
    damage_avg: 500, assisted_avg: 120, kills_avg: 3.2, earned_avg: 80,
    contribution: 22.4, kast: 100, impact: 151.2,
  },
}

const BATTLE_PLAYER = {
  accountId: 2001,
  nickname: 'Beta',
  clan: 'BBB',
  rating: 812.6,
  dimensionScores: [320, 55, 70, 110, 40, 75, 82],
  cells: {
    account_id: 2001, damage_dealt: 3000, damage_assisted: 900, kills: 3,
    damage_blocked: 1200, n_shots: 20, n_hits_dealt: 14, n_penetrations_dealt: 9,
    survived_label: 'SURVIVED', victory_points_earned: 180,
    contribution: 18.1, kast: 80, impact: 120.5,
  },
}

const RADAR_STUB = {
  props: ['metrics', 'reference', 'referenceLabel'],
  template: '<div class="radar-stub" :data-metrics="JSON.stringify(metrics.map(m=>({key:m.key,rawValue:m.rawValue,normalized:m.normalized,displayValue:m.displayValue,available:m.available})))" :data-reference="JSON.stringify((reference||[]).map(m=>({key:m.key,rawValue:m.rawValue,normalized:m.normalized,displayValue:m.displayValue,available:m.available})))" :data-reference-label="referenceLabel">{{ metrics.map(m => m.label).join(",") }}</div>',
}

function radarValues(wrapper) {
  return Object.fromEntries(JSON.parse(wrapper.find('.radar-stub').attributes('data-metrics')).map(m => [m.key, m]))
}
function radarReference(wrapper) {
  return JSON.parse(wrapper.find('.radar-stub').attributes('data-reference'))
}

const LEAGUE_COLUMNS = [
  { key: 'league_rating', max: 1000, fixed: true },
  { key: 'league_damage_score', max: 400 },
  { key: 'league_assist_score', max: 100 },
  { key: 'league_kill_score', max: 100 },
  { key: 'league_exchange_score', max: 150 },
  { key: 'league_blocked_score', max: 50 },
  { key: 'league_survival_score', max: 100 },
  { key: 'league_shooting_score', max: 100 },
]

function mountDrawer(context, player, extraProps = {}) {
  return mount(PlayerDetailDrawer, {
    props: { context, player, leagueColumns: LEAGUE_COLUMNS, ...extraProps },
    global: {
      stubs: { PlayerRatingRadar: RADAR_STUB, teleport: true },
      mocks: { $t: key => key },
    }
  })
}

beforeEach(() => { localStorage.clear() })

describe('PlayerDetailDrawer', () => {
  it('closed when context or player is null', () => {
    const wrapper = mountDrawer(null, null)
    expect(wrapper.find('.player-drawer').exists()).toBe(false)
  })

  it('opens with player data when context and player present', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    expect(wrapper.find('.player-drawer').exists()).toBe(true)
    expect(wrapper.text()).toContain('Alpha')
    expect(wrapper.text()).toContain('AAA')
    expect(wrapper.text()).toContain('850')
    expect(wrapper.find('.radar-stub').exists()).toBe(true)
  })

  it('emits close on backdrop click（先 slide-out 再 emit close，§34）', async () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    vi.useFakeTimers()
    await wrapper.find('.drawer-backdrop').trigger('click')
    // 关闭动画期间 drawer 仍在 DOM，带 pd-closing
    expect(wrapper.find('.player-drawer').exists()).toBe(true)
    expect(wrapper.find('.player-drawer').classes()).toContain('pd-closing')
    vi.advanceTimersByTime(220)
    expect(wrapper.emitted('close')).toBeTruthy()
    vi.useRealTimers()
  })

  it('emits close on Escape keydown', async () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    vi.useFakeTimers()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    vi.advanceTimersByTime(220)
    expect(wrapper.emitted('close')).toBeTruthy()
    vi.useRealTimers()
  })

  it('shows raw facts including earned avg', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const text = wrapper.text()
    expect(text).toContain('league.drawer.earned_avg')
    expect(text).toContain('80')
    expect(text).toContain('66.7%')
  })

  it('shows -- for missing rating instead of 0', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 },
      { ...SUMMARY_PLAYER, rating: null })
    expect(wrapper.text()).toContain('--')
    expect(wrapper.text()).not.toMatch(/\b0\b ·/)
  })
})

describe('PlayerDetailDrawer header / scope（V4.1 vs V5）', () => {
  it('summary: header shows Rating label + V5 + Observed Median + Rated Battles', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const text = wrapper.text()
    expect(text).toContain('league.drawer.rating_label')
    expect(text).toContain('850')
    expect(text).toContain('league.drawer.observed_median')
    expect(text).toContain('league.drawer.rated_battles')
    expect(text).toContain('8')
    // 头部不再依赖 facts 重复展示 median/rated_battles
    const rating = wrapper.find('[data-testid="drawer-rating"]')
    expect(rating.exists()).toBe(true)
    expect(rating.text()).toBe('850')
  })

  it('battle: V4.1 single-battle Rating (not replaced by V5)', () => {
    const wrapper = mountDrawer({ scope: 'battle', accountId: 2001 }, BATTLE_PLAYER)
    const rating = wrapper.find('[data-testid="drawer-rating"]')
    expect(rating.text()).toBe('813') // 812.6 rounded
    expect(wrapper.text()).not.toContain('league.drawer.observed_median')
  })

  it('summary facts: battles/wins/mvp/averages but NOT rated_battles/observed_median（已移入头部）', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const facts = wrapper.find('[data-testid="player-facts"]').text()
    expect(facts).toContain('league.drawer.battles')
    expect(facts).toContain('league.drawer.wins')
    expect(facts).toContain('league.drawer.mvp')
    expect(facts).toContain('league.drawer.damage_avg')
    expect(facts).not.toContain('league.drawer.rated_battles')
    expect(facts).not.toContain('league.drawer.observed_median')
  })

  it('battle facts: blocked/shots/hits/pens/survived/points_earned', () => {
    const wrapper = mountDrawer({ scope: 'battle', accountId: 2001 }, BATTLE_PLAYER)
    const text = wrapper.text()
    expect(text).toContain('league.drawer.blocked')
    expect(text).toContain('1200')
    expect(text).toContain('league.drawer.shots')
    expect(text).toContain('20')
    expect(text).toContain('league.drawer.hits')
    expect(text).toContain('14')
    expect(text).toContain('league.drawer.pens')
    expect(text).toContain('9')
    expect(text).toContain('survived.alive')
    expect(text).toContain('league.drawer.points_earned')
    expect(text).toContain('180')
  })

  it('performance section shows Contribution/KAST/Impact with %（独立区域，不是 Rating）', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const text = wrapper.text()
    expect(text).toContain('league.drawer.perf_title')
    expect(text).toContain('player_labels.contribution')
    expect(text).toContain('player_labels.kast')
    expect(text).toContain('player_labels.impact')
    expect(text).toContain('22.4%')
    expect(text).toContain('151.2%')
  })
})

describe('PlayerDetailDrawer Radar（仅 League 七维 + 参考平均）', () => {
  it('default: 7 League dimension axes，顺序 = 计划 §10（Damage/Shooting/Kill/RC/Blocked/Exchange/Assist）', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const labels = wrapper.find('.radar-stub').text().split(',')
    expect(labels).toHaveLength(7)
    expect(labels[0]).toBe('radar_labels.league_damage_score')
    expect(labels[1]).toBe('radar_labels.league_shooting_score')
    expect(labels[3]).toBe('radar_labels.league_survival_score')
    expect(labels[6]).toBe('radar_labels.league_assist_score')
  })

  it('custom selection + reorder of League dims only（无 kast/contribution）', () => {
    localStorage.setItem('wotb-radar-metric-order', JSON.stringify(
      ['league_kill_score', 'league_damage_score', 'league_assist_score']))
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const labels = wrapper.find('.radar-stub').text().split(',')
    expect(labels).toEqual(['radar_labels.league_kill_score',
      'radar_labels.league_damage_score', 'radar_labels.league_assist_score'])
    // picker 不含 kast/contribution/impact
    expect(labels.join(',')).not.toContain('kast')
  })

  it('invalid saved keys (kast/contribution/impact) filtered; too few -> fallback default seven', () => {
    localStorage.setItem('wotb-radar-metric-order', JSON.stringify(['removed_metric', 'kast', 'impact']))
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const labels = wrapper.find('.radar-stub').text().split(',')
    expect(labels).toHaveLength(7)
    expect(labels[0]).toBe('radar_labels.league_damage_score')
  })

  it('picker: only League dims listed; toggle persists', async () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    await wrapper.find('[data-testid="radar-settings"]').trigger('click')
    const pickerText = wrapper.find('[data-testid="radar-picker"]').text()
    expect(pickerText).toContain('radar_labels.league_damage_score')
    expect(pickerText).not.toContain('player_labels.kast')
    expect(pickerText).not.toContain('player_labels.contribution')
    expect(pickerText).not.toContain('player_labels.impact')
    // 取消一个维度 → 持久化
    const killLi = wrapper.findAll('.radar-picker-list li').find(li => li.text().includes('radar_labels.league_kill_score'))
    await killLi.find('input').setValue(false)
    const saved = JSON.parse(localStorage.getItem('wotb-radar-metric-order'))
    expect(saved).not.toContain('league_kill_score')
  })

  it('picker min 3 / max 7 constraint', async () => {
    localStorage.setItem('wotb-radar-metric-order', JSON.stringify(
      ['league_damage_score', 'league_kill_score', 'league_assist_score']))
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    await wrapper.find('[data-testid="radar-settings"]').trigger('click')
    const damageLi = wrapper.findAll('.radar-picker-list li').find(li => li.text().includes('radar_labels.league_damage_score'))
    await damageLi.find('input').setValue(false) // 尝试减到 2
    expect(wrapper.find('.radar-hint').exists()).toBe(true)
  })

  it('Rating-ineligible（所有 axes null）→ 整图 unavailable（radar_dim_unavailable）', () => {
    const ineligible = {
      ...BATTLE_PLAYER,
      rating: null,
      dimensionScores: [null, null, null, null, null, null, null],
      cells: { ...BATTLE_PLAYER.cells },
    }
    const wrapper = mountDrawer({ scope: 'battle', accountId: 2001 }, ineligible)
    expect(wrapper.find('[data-testid="radar-unavailable"]').text()).toBe('league.drawer.radar_dim_unavailable')
    expect(wrapper.find('.radar-stub').exists()).toBe(false)
  })

  it('partial missing（仅一维缺失）→ 整图 unavailable（§24 字面）', () => {
    const mixed = { ...BATTLE_PLAYER, dimensionScores: [320, null, 70, 110, 40, 75, 82] }
    const wrapper = mountDrawer({ scope: 'battle', accountId: 2001 }, mixed)
    expect(wrapper.find('[data-testid="radar-unavailable"]').exists()).toBe(true)
    expect(wrapper.find('.radar-stub').exists()).toBe(false)
  })
})

describe('PlayerDetailDrawer reference average', () => {
  const scopes = (meansA, meansB) => [
    { cells: { account_id: 1001 }, league: { dimensionMeans: meansA } },
    { cells: { account_id: 1002 }, league: { dimensionMeans: meansB } },
  ]

  it('summary: reference passed = Global Average（global_average label），V5 不影响几何', () => {
    const row = scopes(
      [250, 40, 30, 75, 10, 50, 65],
      [150, 20, 10, 25, 0, 30, 35],
    )
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER, { scopePlayers: row })
    const ref = radarReference(wrapper)
    // 两玩家等权：(250+150)/2 = 200
    expect(ref.find(r => r.key === 'league_damage_score').rawValue).toBeCloseTo(200, 6)
    expect(wrapper.find('.radar-stub').attributes('data-reference')).toBeTruthy()
    expect(wrapper.find('.radar-stub').attributes('data-reference-label')).toBe('league.drawer.global_average')
  })

  it('battle: reference passed = Battle Average（battle_average label）, selected player included', () => {
    const players = [
      { cells: { account_id: 2001, league_rating: 812.6, league_damage_score: 320, league_assist_score: 55, league_kill_score: 70, league_exchange_score: 110, league_blocked_score: 40, league_survival_score: 75, league_shooting_score: 82 } },
      { cells: { account_id: 2002, league_rating: 780, league_damage_score: 200, league_assist_score: 45, league_kill_score: 50, league_exchange_score: 90, league_blocked_score: 30, league_survival_score: 55, league_shooting_score: 40 } },
    ]
    const wrapper = mountDrawer({ scope: 'battle', accountId: 2001 }, BATTLE_PLAYER, { scopePlayers: players })
    const ref = radarReference(wrapper)
    expect(ref.find(r => r.key === 'league_damage_score').rawValue).toBeCloseTo(260, 6)
    expect(wrapper.find('.radar-stub').attributes('data-reference-label')).toBe('league.drawer.battle_average')
  })
})

describe('PlayerDetailDrawer navigation', () => {
  it('emits prev/next when hasPrev/hasNext enabled; buttons disabled at boundaries', async () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER, { hasPrev: false, hasNext: true })
    const next = wrapper.find('[data-testid="drawer-next"]')
    const prev = wrapper.find('[data-testid="drawer-prev"]')
    expect(prev.attributes('disabled')).toBeDefined()
    expect(next.attributes('disabled')).toBeUndefined()
    await next.trigger('click')
    expect(wrapper.emitted('next')).toBeTruthy()
    expect(wrapper.emitted('prev')).toBeUndefined()
  })

  it('ArrowRight/ArrowLeft keyboard nav; not intercepted in input/textarea', async () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER, { hasPrev: true, hasNext: true })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(wrapper.emitted('next')).toBeTruthy()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    expect(wrapper.emitted('prev')).toBeTruthy()
  })
})

describe('PlayerDetailDrawer export', () => {
  it('export button exists in rating profile area; disabled when playerUnavailable', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const btn = wrapper.find('[data-testid="export-profile"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeUndefined()
    const ineligible = mountDrawer({ scope: 'battle', accountId: 2001 },
      { ...BATTLE_PLAYER, rating: null, dimensionScores: [null, null, null, null, null, null, null] })
    expect(ineligible.find('[data-testid="export-profile"]').attributes('disabled')).toBeDefined()
  })
})

describe('Drawer stacking / layout contract', () => {
  it('desktop top 使用 --topbar-h token；≤1080px Drawer 提升到 modal 层、面板从视口顶部开始', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/PlayerDetailDrawer.vue'), 'utf8')
    expect(source).toContain('top: calc(var(--topbar-h) + 8px)')
    expect(source).not.toContain('top: 56px')
    const mobileBlock = source.match(/@media \(max-width: 1080px\) \{[\s\S]*?\n\}/)?.[0] || ''
    expect(mobileBlock).toContain('.drawer-backdrop { z-index: var(--z-modal); }')
    expect(mobileBlock).toContain('.player-drawer { top: 8px; }')
  })

  it('关闭按钮保留在 drawer（退出动画期间仍可关闭）', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const close = wrapper.find('.pd-close')
    expect(close.exists()).toBe(true)
    expect(close.attributes('aria-label')).toBe('league.drawer.close')
  })
})

describe('Radar scope-aware data source contract', () => {
  it('Summary：League 七维取 dimensionMeans（非 median），归一化=raw/后端 max，displayValue 无百分比', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const values = radarValues(wrapper)
    expect(values.league_damage_score.rawValue).toBe(250)
    expect(values.league_assist_score.rawValue).toBe(40)
    expect(values.league_kill_score.rawValue).toBe(30)
    expect(values.league_blocked_score.rawValue).toBe(10)
    expect(values.league_survival_score.rawValue).toBe(50)
    expect(values.league_assist_score.rawValue).not.toBe(60)
    expect(values.league_damage_score.normalized).toBeCloseTo(0.625, 3)
    expect(values.league_assist_score.normalized).toBeCloseTo(0.4, 3)
    expect(values.league_assist_score.displayValue).toBe('40 / 100')
    expect(values.league_assist_score.displayValue).not.toContain('%')
  })

  it('Battle：League 七维取本场 dimensionScores，绝不使用跨场 means/medians', () => {
    const battle = {
      ...BATTLE_PLAYER,
      dimensionScores: [320, 55, 70, 110, 40, 75, 82],
      dimensionMeans: [1, 2, 3, 4, 5, 6, 7],
      dimensionMedians: [8, 9, 10, 11, 12, 13, 14],
    }
    const wrapper = mountDrawer({ scope: 'battle', accountId: 2001 }, battle)
    const values = radarValues(wrapper)
    expect(values.league_damage_score.rawValue).toBe(320)
    expect(values.league_damage_score.normalized).toBeCloseTo(0.8, 3)
    expect(values.league_assist_score.rawValue).not.toBe(2)
    expect(values.league_kill_score.rawValue).not.toBe(10)
  })
})
