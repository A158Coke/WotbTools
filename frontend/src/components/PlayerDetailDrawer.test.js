// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PlayerDetailDrawer from './PlayerDetailDrawer.vue'
import { loadVehiclePortrait } from '../vehicle-portraits/runtime.js'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: key => key, locale: { value: 'zh' } })
}))

// 坦克贴图懒加载 mock 成可控 promise（未知 tankId → null，缺图文字降级）。
vi.mock('../vehicle-portraits/runtime.js', () => ({
  loadVehiclePortrait: vi.fn(() => Promise.resolve(null)),
}))

// html2canvas / downloadBlob mock harness（导出行为测试，捕获 offscreen 卡与文件名）。
const h2c = vi.hoisted(() => {
  const calls = []
  let impl
  return {
    setImpl: (fn) => { impl = fn },
    getCalls: () => calls,
    resetCalls: () => { calls.length = 0 },
    call: (...args) => {
      calls.push(args)
      return impl ? impl(...args) : Promise.resolve({ toBlob: (cb) => cb('blob:data') })
    },
  }
})
const dl = vi.hoisted(() => ({ downloadBlob: vi.fn(() => Promise.resolve()) }))
vi.mock('html2canvas', () => ({ default: (...args) => h2c.call(...args) }))
vi.mock('../utils/exportReplayPng.js', async (importOriginal) => {
  const orig = await importOriginal()
  return { ...orig, sanitizeFilename: (s) => (s || 'player'), downloadBlob: dl.downloadBlob }
})

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
  template: '<div class="radar-stub" :data-metrics="JSON.stringify(metrics.map(m=>({key:m.key,rawValue:m.rawValue,visualValue:m.visualValue,normalized:m.normalized,displayValue:m.displayValue,available:m.available})))" :data-reference="JSON.stringify((reference||[]).map(m=>({key:m.key,rawValue:m.rawValue,visualValue:m.visualValue,normalized:m.normalized,displayValue:m.displayValue,available:m.available})))" :data-reference-label="referenceLabel">{{ metrics.map(m => m.label).join(",") }}</div>',
}

function radarValues(wrapper) {
  return Object.fromEntries(JSON.parse(wrapper.find('.radar-stub').attributes('data-metrics')).map(m => [m.key, m]))
}
function radarReference(wrapper) {
  return JSON.parse(wrapper.find('.radar-stub').attributes('data-reference'))
}

const LEAGUE_COLUMNS = [
  { key: 'league_rating', max: 1000, fixed: true },
  { key: 'league_damage_score', max: 365 },
  { key: 'league_assist_score', max: 110 },
  { key: 'league_kill_score', max: 110 },
  { key: 'league_exchange_score', max: 180 },
  { key: 'league_blocked_score', max: 50 },
  { key: 'league_survival_score', max: 75 },
  { key: 'league_shooting_score', max: 110 },
]

function mountDrawer(context, player, extraProps = {}, mountOptions = {}) {
  const defaultScopePlayers = context?.scope === 'summary'
    ? [{ cells: { account_id: player?.accountId }, league: { dimensionMeans: player?.dimensionMeans } }]
    : [{ cells: {
        account_id: player?.accountId,
        league_rating: player?.rating,
        ...Object.fromEntries((player?.dimensionScores || []).map((value, index) => [
          ['league_damage_score', 'league_assist_score', 'league_kill_score', 'league_exchange_score',
            'league_blocked_score', 'league_survival_score', 'league_shooting_score'][index], value,
        ])),
      } }]
  const stubs = { teleport: true }
  if (!mountOptions.realRadar) stubs.PlayerRatingRadar = RADAR_STUB
  return mount(PlayerDetailDrawer, {
    props: { context, player, leagueColumns: LEAGUE_COLUMNS, scopePlayers: defaultScopePlayers, ...extraProps },
    global: {
      stubs,
      mocks: { $t: key => key },
    }
  })
}

beforeEach(() => {
  localStorage.clear()
  loadVehiclePortrait.mockReset()
  loadVehiclePortrait.mockResolvedValue(null)
})

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

  it('mobile(<768px) backdrop 点击关闭（modal，§34）；desktop backdrop 点击不关闭（非模态）', async () => {
    // 桌面：backdrop 是 click-through，点击不应关闭
    window.innerWidth = 1024
    const desktop = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    await desktop.find('.drawer-backdrop').trigger('click')
    expect(desktop.find('.player-drawer').classes()).not.toContain('pd-closing')
    expect(desktop.emitted('close')).toBeFalsy()
    expect(desktop.find('.drawer-backdrop').classes()).not.toContain('pd-modal')

    // 移动端：isMobile=true → modal backdrop 点击关闭（slide-out 后 emit close）
    window.innerWidth = 375
    const mobile = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    vi.useFakeTimers()
    await mobile.find('.drawer-backdrop').trigger('click')
    expect(mobile.find('.player-drawer').exists()).toBe(true)
    expect(mobile.find('.player-drawer').classes()).toContain('pd-closing')
    expect(mobile.find('.drawer-backdrop').classes()).toContain('pd-modal')
    vi.advanceTimersByTime(220)
    expect(mobile.emitted('close')).toBeTruthy()
    vi.useRealTimers()
    window.innerWidth = 1024
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
  it('default: 7 League dimension axes，顺序 =（Damage/Shooting/Kill/RC/Blocked/Exchange/Assist）', () => {
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

  it('battle bounded scale uses the full 75..150 range up to each authoritative dimension max', () => {
    const keys = ['league_damage_score', 'league_assist_score', 'league_kill_score', 'league_exchange_score',
      'league_blocked_score', 'league_survival_score', 'league_shooting_score']
    const selected = Object.fromEntries(keys.map((key, index) => [key, BATTLE_PLAYER.dimensionScores[index]]))
    const low = Object.fromEntries(keys.map((key, index) => [key, [20, 5, 5, 10, 5, 50, 10][index]]))
    const scopePlayers = [
      { cells: { account_id: 2001, league_rating: 812.6, ...selected } },
      ...Array.from({ length: 13 }, (_, index) => ({
        cells: { account_id: 3000 + index, league_rating: 400, ...low },
      })),
    ]
    const wrapper = mountDrawer(
      { scope: 'battle', accountId: 2001 }, BATTLE_PLAYER, { scopePlayers })
    const values = radarValues(wrapper)
    expect(values.league_damage_score.normalized).toBeGreaterThan(2 / 3)
    expect(values.league_kill_score.normalized).toBeGreaterThan(2 / 3)
    expect(values.league_survival_score.visualValue).toBe(150)
    expect(values.league_survival_score.normalized).toBe(1)
    expect(radarReference(wrapper).every(axis => axis.normalized === 0.5)).toBe(true)
  })

  it('summary maps every authoritative V5 dimension max to 150 and the current cohort average to 75', () => {
    const maxes = [365, 110, 110, 180, 50, 75, 110]
    const player = { ...SUMMARY_PLAYER, dimensionMeans: maxes }
    const scopePlayers = scopes(maxes, maxes.map(max => max / 2))
    const wrapper = mountDrawer(
      { scope: 'summary', accountId: 1001 }, player, { scopePlayers })

    expect(Object.values(radarValues(wrapper)).map(axis => axis.visualValue)).toEqual(Array(7).fill(150))
    expect(Object.values(radarValues(wrapper)).map(axis => axis.normalized)).toEqual(Array(7).fill(1))
    expect(radarReference(wrapper).every(axis => axis.visualValue === 75 && axis.normalized === 0.5)).toBe(true)
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

  it('aria-modal 只在移动端 modal 生效（桌面非模态，不误导辅助技术）', async () => {
    window.innerWidth = 1024
    const desktop = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    await flushPromises()
    expect(desktop.find('.player-drawer').attributes('aria-modal')).toBeUndefined()
    window.innerWidth = 375
    const mobile = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    await flushPromises()
    expect(mobile.find('.player-drawer').attributes('aria-modal')).toBe('true')
    window.innerWidth = 1024
  })

  it('关闭按钮保留在 drawer（退出动画期间仍可关闭）', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const close = wrapper.find('.pd-close')
    expect(close.exists()).toBe(true)
    expect(close.attributes('aria-label')).toBe('league.drawer.close')
  })
})

describe('Radar scope-aware data source contract', () => {
  it('Summary：League 七维取 dimensionMeans（非 median），相对自身 reference=75，displayValue 无百分比', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const values = radarValues(wrapper)
    expect(values.league_damage_score.rawValue).toBe(250)
    expect(values.league_assist_score.rawValue).toBe(40)
    expect(values.league_kill_score.rawValue).toBe(30)
    expect(values.league_blocked_score.rawValue).toBe(10)
    expect(values.league_survival_score.rawValue).toBe(50)
    expect(values.league_assist_score.rawValue).not.toBe(60)
    expect(values.league_damage_score.normalized).toBe(0.5)
    expect(values.league_assist_score.normalized).toBe(0.5)
    expect(values.league_assist_score.displayValue).toBe('40 / 110')
    expect(values.league_assist_score.displayValue).not.toContain('%')
  })

  it('Battle：League 七维取本场 dimensionScores，绝不使用跨场 means/medians', () => {
    const battle = {
      ...BATTLE_PLAYER,
      dimensionScores: [320, 55, 70, 110, 40, 70, 82],
      dimensionMeans: [1, 2, 3, 4, 5, 6, 7],
      dimensionMedians: [8, 9, 10, 11, 12, 13, 14],
    }
    const wrapper = mountDrawer({ scope: 'battle', accountId: 2001 }, battle)
    const values = radarValues(wrapper)
    expect(values.league_damage_score.rawValue).toBe(320)
    expect(values.league_damage_score.normalized).toBe(0.5)
    expect(values.league_assist_score.rawValue).not.toBe(2)
    expect(values.league_kill_score.rawValue).not.toBe(10)
  })

  it('column.max 缺失时 V5 bounded geometry fail-closed，不回退旧 relative scale', () => {
    const columnsWithoutMax = LEAGUE_COLUMNS.map(column => ({ key: column.key, fixed: column.fixed }))
    const wrapper = mountDrawer(
      { scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER, { leagueColumns: columnsWithoutMax })
    expect(wrapper.find('[data-testid="radar-unavailable"]').exists()).toBe(true)
    expect(wrapper.find('.radar-stub').exists()).toBe(false)
  })
})

describe('PlayerDetailDrawer 坦克展示（Summary=最常使用；Battle=本场）', () => {
  it('Summary：显示最常使用坦克（名称 + 场次 + 比例 = battles/ratedBattles）', async () => {
    const player = {
      ...SUMMARY_PLAYER,
      mostUsedVehicle: { tankId: 7169, tankName: 'IS-7', battles: 3 },
      ratedBattles: 8,
    }
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, player)
    await flushPromises()
    expect(wrapper.find('[data-testid="player-vehicle"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('league.drawer.most_used_vehicle')
    expect(wrapper.text()).toContain('IS-7')
    expect(wrapper.text()).toContain('league.drawer.vehicle_battles')
    // 3 / 8 = 37.5%
    expect(wrapper.find('[data-testid="player-vehicle-rate"]').text()).toBe('37.5%')
  })

  it('Battle：显示本场坦克；不显示 1场·100%', async () => {
    const player = { ...BATTLE_PLAYER, tankId: 4481, tankName: 'Heavy Tank', tankBattles: 1 }
    const wrapper = mountDrawer({ scope: 'battle', accountId: 2001 }, player)
    await flushPromises()
    expect(wrapper.find('[data-testid="player-vehicle"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('league.drawer.battle_vehicle')
    expect(wrapper.text()).toContain('Heavy Tank')
    // 单场不显示无意义的“1 场 · 100%”
    expect(wrapper.find('[data-testid="player-vehicle-battles"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="player-vehicle-rate"]').exists()).toBe(false)
  })

  it('无坦克数据 → 不渲染坦克区', async () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    await flushPromises()
    expect(wrapper.find('[data-testid="player-vehicle"]').exists()).toBe(false)
  })

  it('缺图/非 Tier X → 仅文字降级，无破图图标，名称与统计保留', async () => {
    loadVehiclePortrait.mockResolvedValue(null)
    const player = {
      ...SUMMARY_PLAYER,
      mostUsedVehicle: { tankId: 999999, tankName: 'Strange', battles: 2 },
      ratedBattles: 8,
    }
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, player)
    await flushPromises()
    expect(wrapper.find('[data-testid="player-vehicle-img"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="player-vehicle"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Strange')
    expect(wrapper.find('[data-testid="player-vehicle-rate"]').text()).toBe('25%')
  })

  it('异步加载不闪回上一位玩家图片（token 防旧结果覆盖）', async () => {
    const deferred = {}
    loadVehiclePortrait.mockImplementation((tankId) => new Promise((resolve) => {
      deferred[tankId] = resolve
    }))
    const playerA = { ...SUMMARY_PLAYER, mostUsedVehicle: { tankId: 111, tankName: 'A', battles: 3 }, ratedBattles: 8 }
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, playerA)
    await flushPromises() // 动态 import 完成，loadVehiclePortrait(111) 已注册
    expect(typeof deferred[111]).toBe('function')
    // 切到玩家 B
    const playerB = { ...SUMMARY_PLAYER, mostUsedVehicle: { tankId: 222, tankName: 'B', battles: 2 }, ratedBattles: 8 }
    await wrapper.setProps({ player: playerB })
    await flushPromises()
    expect(typeof deferred[222]).toBe('function')
    // 旧玩家 A 的图晚到：必须被丢弃（token 已变）
    deferred[111]('http://a.png')
    await flushPromises()
    expect(wrapper.find('[data-testid="player-vehicle-img"]').exists()).toBe(false)
    // 新玩家 B 的图到：正确显示
    deferred[222]('http://b.png')
    await flushPromises()
    expect(wrapper.find('[data-testid="player-vehicle-img"]').attributes('src')).toBe('http://b.png')
  })

  it('导出卡包含坦克信息（与 Drawer 同数据源）+ 动态 import runtime', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/PlayerDetailDrawer.vue'), 'utf8')
    expect(source).toContain('rp-vehicle')
    expect(source).toContain('exportPortrait')
    expect(source).toContain('ensureVehiclePortraitForExport')
    // Blocker 2：不得顶层静态 import vehicle-portraits runtime（须动态 import 保持分离）
    expect(source).not.toContain("import { loadVehiclePortrait } from '../vehicle-portraits/runtime.js'")
    expect(source).toContain("import('../vehicle-portraits/runtime.js')")
  })

  it('Battle：tankId=0 / null / 空名 / 占位名 不渲染坦克区（无空卡片）', async () => {
    const cases = [
      { tankId: 0, tankName: 'Zero' },
      { tankId: null, tankName: 'Null' },
      { tankId: 4481, tankName: '' },
      { tankId: 4481, tankName: '#4481' },
    ]
    for (const c of cases) {
      const player = { ...BATTLE_PLAYER, tankId: c.tankId, tankName: c.tankName }
      const wrapper = mountDrawer({ scope: 'battle', accountId: 2001 }, player)
      await flushPromises()
      expect(wrapper.find('[data-testid="player-vehicle"]').exists()).toBe(false)
      wrapper.unmount()
    }
  })

  it('Battle：合法 tankId + 名称 正常显示', async () => {
    const player = { ...BATTLE_PLAYER, tankId: 7169, tankName: 'IS-7' }
    const wrapper = mountDrawer({ scope: 'battle', accountId: 2001 }, player)
    await flushPromises()
    expect(wrapper.find('[data-testid="player-vehicle"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('IS-7')
  })
})

describe('Rating Profile PNG 导出不可变快照', () => {
  // happy-dom 不加载图片，stub 全局 Image 使 onload 触发，否则 ensureImageLoaded 悬挂卡住导出。
  class MockImage {
    set src(v) { this._src = v; queueMicrotask(() => this.onload && this.onload()) }
    get src() { return this._src }
  }
  beforeEach(() => {
    h2c.resetCalls()
    dl.downloadBlob.mockClear()
    h2c.setImpl(null)
    vi.stubGlobal('Image', MockImage)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('导出期间切换玩家：offscreen 卡与文件名仍为玩家 A（不混入玩家 B）', async () => {
    const deferred = {}
    loadVehiclePortrait.mockImplementation((tankId) => new Promise((resolve) => { deferred[tankId] = resolve }))
    const playerA = { ...SUMMARY_PLAYER, mostUsedVehicle: { tankId: 7169, tankName: 'IS-7', battles: 3 }, ratedBattles: 8 }
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, playerA)
    await flushPromises()

    await wrapper.find('[data-testid="export-profile"]').trigger('click')
    await flushPromises()
    expect(typeof deferred[7169]).toBe('function') // 导出正在等待坦克 A 图

    // 导出等待期间切换为玩家 B（坦克 B=9999 "Maus"）
    const playerB = { ...SUMMARY_PLAYER, nickname: 'Beta', mostUsedVehicle: { tankId: 9999, tankName: 'Maus', battles: 1 }, ratedBattles: 8 }
    await wrapper.setProps({ player: playerB })
    await flushPromises()

    // resolve 坦克 A 的图
    deferred[7169]('http://a.png')
    await flushPromises()

    expect(h2c.getCalls().length).toBe(1)
    const card = h2c.getCalls()[0][0]
    const cardText = card.textContent
    expect(cardText).toContain('Alpha') // 玩家 A
    expect(cardText).toContain('IS-7')  // 坦克 A
    expect(cardText).toContain('850')   // 玩家 A 总 Rating
    expect(cardText).not.toContain('Beta')
    expect(cardText).not.toContain('Maus')
    const img = card.querySelector('img.rp-vehicle-img')
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toBe('http://a.png') // 坦克 A 图

    expect(dl.downloadBlob.mock.calls.length).toBe(1)
    expect(dl.downloadBlob.mock.calls[0][1]).toContain('Alpha') // 文件名用玩家 A
    wrapper.unmount()
  })

  it('导出图片失败：仍导出玩家 A 纯文字版（不阻塞 PNG，不含破图）', async () => {
    loadVehiclePortrait.mockResolvedValue(null)
    const playerA = { ...SUMMARY_PLAYER, mostUsedVehicle: { tankId: 7169, tankName: 'IS-7', battles: 3 }, ratedBattles: 8 }
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, playerA)
    await flushPromises()

    await wrapper.find('[data-testid="export-profile"]').trigger('click')
    await flushPromises()

    expect(h2c.getCalls().length).toBe(1)
    const card = h2c.getCalls()[0][0]
    expect(card.textContent).toContain('Alpha')
    expect(card.textContent).toContain('IS-7')
    expect(card.querySelector('img.rp-vehicle-img')).toBeNull() // 纯文字降级
    expect(dl.downloadBlob).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('页面与 PNG 导出消费相同的雷达点位、顶点分数和分数明细', async () => {
    const wrapper = mountDrawer(
      { scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER, {}, { realRadar: true })
    await flushPromises()
    const pagePlayerPoints = wrapper.find('.radar-data').attributes('points')
    const pageReferencePoints = wrapper.find('.radar-ref').attributes('points')
    const pageScores = wrapper.findAll('.radar-score').map(node => node.text())
    const badgeAttrs = node => ['x', 'y', 'width', 'height', 'rx'].map(name => node.getAttribute(name))
    const pageBadges = wrapper.findAll('.radar-score-bg').map(node => badgeAttrs(node.element))

    await wrapper.find('[data-testid="export-profile"]').trigger('click')
    await flushPromises()
    const card = h2c.getCalls()[0][0]
    expect(card.querySelector('.rp-data').getAttribute('points')).toBe(pagePlayerPoints)
    expect(card.querySelector('.rp-ref').getAttribute('points')).toBe(pageReferencePoints)
    expect([...card.querySelectorAll('.rp-score')].map(node => node.textContent)).toEqual(pageScores)
    expect([...card.querySelectorAll('.rp-score-bg')].map(badgeAttrs)).toEqual(pageBadges)
    expect(card.querySelector('.rp-detail').textContent).toContain('radarScale.playerScore')
    expect(card.querySelector('.rp-detail').textContent).toContain('radarScale.averageScore')
    expect([...card.querySelectorAll('.rp-scale')].map(node => node.textContent)).toEqual(['25', '50', '75', '100'])
    expect(card.querySelectorAll('.rp-grid').length).toBe(3)
    expect(card.querySelector('[class*="outer"]')).toBeNull()
    wrapper.unmount()
  })

  it('导出失败：snapshot/portrait/exporting 状态清理后可再次导出（同一玩家）', async () => {
    const spyErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    loadVehiclePortrait.mockResolvedValue(null)
    let fail = true
    h2c.setImpl(() => {
      if (fail) return Promise.reject(new Error('boom'))
      return Promise.resolve({ toBlob: (cb) => cb('blob:data') })
    })
    const playerA = { ...SUMMARY_PLAYER, mostUsedVehicle: { tankId: 7169, tankName: 'IS-7', battles: 3 }, ratedBattles: 8 }
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, playerA)
    await flushPromises()

    await wrapper.find('[data-testid="export-profile"]').trigger('click')
    await flushPromises()
    expect(dl.downloadBlob).not.toHaveBeenCalled()

    // 首次失败后状态被清理，可再次导出
    fail = false
    const btn = wrapper.find('[data-testid="export-profile"]')
    expect(btn.attributes('disabled')).toBeUndefined()
    await btn.trigger('click')
    await flushPromises()
    expect(dl.downloadBlob).toHaveBeenCalled()
    expect(dl.downloadBlob.mock.calls[0][1]).toContain('Alpha')
    wrapper.unmount()
    h2c.setImpl(null)
    spyErr.mockRestore()
  })
})

describe('PlayerDetailDrawer Side Panel resize（仅桌面）', () => {
  const DEFAULT_W = 380
  function widthNum(wrapper) {
    const st = wrapper.find('.player-drawer').attributes('style') || ''
    const m = st.match(/width:\s*(\d+)px/)
    return m ? parseInt(m[1], 10) : null
  }
  afterEach(() => { localStorage.clear(); window.innerWidth = 1024 })

  it('Desktop >=1200 shows resizer; drag widens panel and persists width', async () => {
    window.innerWidth = 1400
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const resizer = wrapper.find('[data-testid="drawer-resizer"]')
    expect(resizer.exists()).toBe(true)
    expect(resizer.attributes('role')).toBe('separator')
    expect(widthNum(wrapper)).toBe(DEFAULT_W)
    await resizer.trigger('pointerdown', { clientX: 320, pointerId: 1 })
    await resizer.trigger('pointermove', { clientX: 260 })
    await resizer.trigger('pointerup')
    expect(widthNum(wrapper)).toBe(DEFAULT_W + 60)
    expect(localStorage.getItem('radarSidePanelWidth')).toBe(String(DEFAULT_W + 60))
  })

  it('clamps to min(320) and dynamic max(≈45% viewport)', async () => {
    window.innerWidth = 1400
    const max = Math.floor(1400 * 0.45)
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const resizer = wrapper.find('[data-testid="drawer-resizer"]')
    await resizer.trigger('pointerdown', { clientX: 500, pointerId: 1 })
    await resizer.trigger('pointermove', { clientX: 5000 })
    await resizer.trigger('pointerup')
    expect(widthNum(wrapper)).toBe(320)
    await resizer.trigger('pointerdown', { clientX: 400, pointerId: 1 })
    await resizer.trigger('pointermove', { clientX: -5000 })
    await resizer.trigger('pointerup')
    expect(widthNum(wrapper)).toBe(max)
  })

  it('restores saved width clamped to current viewport max', async () => {
    window.innerWidth = 1400
    const max = Math.floor(1400 * 0.45)
    localStorage.setItem('radarSidePanelWidth', '800')
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    await flushPromises() // onMounted 异步写入 drawerWidth，需 flush 后读取
    expect(widthNum(wrapper)).toBe(max)
  })

  it('tablet(<=1199) and mobile(<768) hide resizer and keep fixed width (no inline width)', () => {
    window.innerWidth = 1024
    const tablet = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    expect(tablet.find('[data-testid="drawer-resizer"]').exists()).toBe(false)
    expect(widthNum(tablet)).toBe(null)
    window.innerWidth = 375
    const mobile = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    expect(mobile.find('[data-testid="drawer-resizer"]').exists()).toBe(false)
    expect(widthNum(mobile)).toBe(null)
  })

  it('resize then switch player keeps user width (不恢复默认宽度)', async () => {
    window.innerWidth = 1400
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const resizer = wrapper.find('[data-testid="drawer-resizer"]')
    await resizer.trigger('pointerdown', { clientX: 300, pointerId: 1 })
    await resizer.trigger('pointermove', { clientX: 200 })
    await resizer.trigger('pointerup')
    expect(widthNum(wrapper)).toBe(480)
    await wrapper.setProps({ player: { ...SUMMARY_PLAYER, accountId: 2001, nickname: 'Beta' } })
    expect(widthNum(wrapper)).toBe(480)
  })

  it('resizer keyboard ArrowLeft/Right adjusts width and does not trigger player switch', async () => {
    window.innerWidth = 1400
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const resizer = wrapper.find('[data-testid="drawer-resizer"]')
    await resizer.trigger('keydown', { key: 'ArrowRight' })
    expect(widthNum(wrapper)).toBe(400)
    expect(wrapper.emitted('next')).toBeFalsy()
    await resizer.trigger('keydown', { key: 'ArrowLeft' })
    expect(widthNum(wrapper)).toBe(380)
    expect(wrapper.emitted('prev')).toBeFalsy()
  })

  it('reflow：桌面开启时暴露 --pd-drawer-offset 供 workspace 预留；拖宽后同步；mobile 恒 0px；unmount 清除', async () => {
    window.innerWidth = 1400
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    await flushPromises()
    expect(document.documentElement.style.getPropertyValue('--pd-drawer-offset')).toBe('388px')
    const resizer = wrapper.find('[data-testid="drawer-resizer"]')
    await resizer.trigger('pointerdown', { clientX: 320, pointerId: 1 })
    await resizer.trigger('pointermove', { clientX: 260 })
    await resizer.trigger('pointerup')
    expect(document.documentElement.style.getPropertyValue('--pd-drawer-offset')).toBe('448px')
    wrapper.unmount()
    expect(document.documentElement.style.getPropertyValue('--pd-drawer-offset')).toBe('')
    window.innerWidth = 1024
    const tablet = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    await flushPromises()
    expect(document.documentElement.style.getPropertyValue('--pd-drawer-offset')).toBe('0px')
  })
})
