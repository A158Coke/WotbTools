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
  ratingMedian: 850.4,
  dimensionMedians: [342, 60, 70, 110, 40, 80, 100],
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
  dimensionMedians: [250, 50, 60, 90, 30, 70, 80],
  cells: {
    account_id: 2001, damage_dealt: 3000, damage_assisted: 900, kills: 3,
    damage_blocked: 1200, n_shots: 20, n_hits_dealt: 14, n_penetrations_dealt: 9,
    survived_label: 'SURVIVED', victory_points_earned: 180,
    contribution: 18.1, kast: 80, impact: 120.5,
  },
}

/** 雷达 stub：透传 metrics 数组（断言 axis 数量/顺序用），真实渲染由 PlayerRatingRadar 负责。 */
const RADAR_STUB = {
  props: ['metrics'],
  template: '<div class="radar-stub">{{ metrics.map(m => m.label).join(",") }}</div>',
}

/** League 维度满分 metadata（resp.league.columns：key → max；Radar 归一化唯一事实源）。 */
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

beforeEach(() => {
  localStorage.clear()
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

  it('emits close on backdrop click and close button', async () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    await wrapper.find('.drawer-backdrop').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('emits close on Escape keydown', async () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('shows raw facts including earned avg (获取点数/场)', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const text = wrapper.text()
    expect(text).toContain('league.drawer.earned_avg')
    expect(text).toContain('80')
    expect(text).toContain('66.7%')
  })

  it('does not show seized points', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    expect(wrapper.text()).not.toContain('league.drawer.points_seized')
  })

  it('shows -- for missing rating instead of 0', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 },
      { ...SUMMARY_PLAYER, ratingMedian: null })
    expect(wrapper.text()).toContain('--')
    expect(wrapper.text()).not.toMatch(/\b0\b ·/)
  })
})

describe('PlayerDetailDrawer scope semantics', () => {
  it('summary: scope label 当前批次中位数 + 比赛事实 title + 评分场次', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const text = wrapper.text()
    expect(text).toContain('league.drawer.scope_summary')
    expect(text).toContain('league.drawer.facts_title_summary')
    // 场次（解析 12）与评分场次（rated 8）分开显示
    expect(text).toContain('league.drawer.battles')
    expect(text).toContain('league.drawer.rated_battles')
    expect(text).toContain('12')
    expect(text).toContain('8')
  })

  it('summary: radar title 不写「本场」语义', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    expect(wrapper.text()).toContain('league.drawer.radar_title_summary')
    // 旧 key league.drawer.radar_title（无后缀）不得再出现；新 key 带 _summary/_battle 后缀
    expect(wrapper.text()).not.toMatch(/league\.drawer\.radar_title($|[^_])/)
  })

  it('battle: scope label 本场表现 + 单场 facts（阻挡/射击/命中/击穿/存活/获取点数）', () => {
    const wrapper = mountDrawer({ scope: 'battle', accountId: 2001 }, BATTLE_PLAYER)
    const text = wrapper.text()
    expect(text).toContain('league.drawer.scope_battle')
    expect(text).toContain('league.drawer.facts_title_battle')
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
    expect(text).toContain('100%')
    expect(text).toContain('151.2%')
  })

  it('performance null → --（不冒充 0%），Rating-ineligible 场同样显示表现指标', () => {
    const ineligible = {
      ...BATTLE_PLAYER,
      rating: null,
      dimensionMedians: [null, null, null, null, null, null, null],
      cells: { ...BATTLE_PLAYER.cells, contribution: null, kast: null, impact: null },
    }
    const wrapper = mountDrawer({ scope: 'battle', accountId: 2001 }, ineligible)
    const text = wrapper.text()
    expect(text).toContain('--')
    expect(text).not.toContain('0%')
  })
})

describe('PlayerDetailDrawer custom Radar', () => {
  it('default: 7 League dimension axes（无偏好时默认体验不变）', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const radar = wrapper.find('.radar-stub')
    const labels = radar.text().split(',')
    expect(labels).toHaveLength(7)
    expect(labels[0]).toBe('player_labels.league_damage_score')
    expect(labels[6]).toBe('player_labels.league_shooting_score')
  })

  it('custom selection + reorder：kast/contribution/damage/kill → axis 顺序严格一致', () => {
    localStorage.setItem('wotb-radar-metric-order', JSON.stringify(
      ['kast', 'contribution', 'league_damage_score', 'league_kill_score']))
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const labels = wrapper.find('.radar-stub').text().split(',')
    expect(labels).toEqual(['player_labels.kast', 'player_labels.contribution',
      'player_labels.league_damage_score', 'player_labels.league_kill_score'])
  })

  it('invalid saved keys filtered; too few → fallback default seven', () => {
    localStorage.setItem('wotb-radar-metric-order', JSON.stringify(['removed_metric', 'kast']))
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const labels = wrapper.find('.radar-stub').text().split(',')
    expect(labels).toHaveLength(7)
    expect(labels[0]).toBe('player_labels.league_damage_score')
  })

  it('picker: toggle adds metric, radar updates and persists', async () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    await wrapper.find('[data-testid="radar-settings"]').trigger('click')
    expect(wrapper.find('[data-testid="radar-picker"]').exists()).toBe(true)
    // 添加 kast（默认未选中）
    const kastLi = wrapper.findAll('.radar-picker-list li').find(li => li.text().includes('player_labels.kast'))
    await kastLi.find('input').setValue(true)
    let labels = wrapper.find('.radar-stub').text().split(',')
    expect(labels).toContain('player_labels.kast')
    expect(labels).toHaveLength(8)
    // 持久化（独立于 table column preference）
    const saved = JSON.parse(localStorage.getItem('wotb-radar-metric-order'))
    expect(saved).toContain('kast')
    expect(localStorage.getItem('wotb-league-cw-visible-cols')).toBeNull()
  })

  it('picker min 3：不能取消到 3 个以下', async () => {
    localStorage.setItem('wotb-radar-metric-order', JSON.stringify(['kast', 'contribution', 'league_damage_score']))
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    await wrapper.find('[data-testid="radar-settings"]').trigger('click')
    const kastLi = wrapper.findAll('.radar-picker-list li').find(li => li.text().includes('player_labels.kast'))
    await kastLi.find('input').setValue(false) // 尝试取消第 3 个
    // 仍保留 3 个 + 提示
    const labels = wrapper.find('.radar-stub').text().split(',')
    expect(labels).toHaveLength(3)
    expect(wrapper.find('.radar-hint').exists()).toBe(true)
  })

  it('picker max 8：不能加到 9 个', async () => {
    localStorage.setItem('wotb-radar-metric-order', JSON.stringify(
      ['league_damage_score', 'league_assist_score', 'league_kill_score', 'league_exchange_score',
        'league_blocked_score', 'league_survival_score', 'league_shooting_score', 'kast']))
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    await wrapper.find('[data-testid="radar-settings"]').trigger('click')
    const contribLi = wrapper.findAll('.radar-picker-list li').find(li => li.text().includes('player_labels.contribution'))
    await contribLi.find('input').setValue(true) // 尝试第 9 个
    const labels = wrapper.find('.radar-stub').text().split(',')
    expect(labels).toHaveLength(8)
    expect(wrapper.find('.radar-hint').exists()).toBe(true)
  })

  it('reorder via up/down arrows changes radar axis order', async () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    await wrapper.find('[data-testid="radar-settings"]').trigger('click')
    const assistLi = wrapper.findAll('.radar-picker-list li').find(li => li.text().includes('player_labels.league_assist_score'))
    await assistLi.find('.rp-arrow').trigger('click') // ↑ 上移
    const labels = wrapper.find('.radar-stub').text().split(',')
    expect(labels[0]).toBe('player_labels.league_assist_score')
    expect(labels[1]).toBe('player_labels.league_damage_score')
  })

  it('Rating-ineligible（所有 League axes null）：radar 显示 无评分数据 空态', () => {
    const ineligible = {
      ...BATTLE_PLAYER,
      rating: null,
      dimensionMedians: [null, null, null, null, null, null, null],
      cells: { ...BATTLE_PLAYER.cells, contribution: 18.1, kast: 80, impact: 120.5 },
    }
    const wrapper = mountDrawer({ scope: 'battle', accountId: 2001 }, ineligible)
    expect(wrapper.find('[data-testid="radar-empty"]').text()).toBe('league.drawer.radar_unavailable')
  })

  it('partial availability：雷达照常绘制 performance axes，并提示部分指标无评分数据', () => {
    // 用户把 KAST/Contribution 加入 Radar；本场 League 维度无评分（null）但 performance 有值
    localStorage.setItem('wotb-radar-metric-order', JSON.stringify(
      ['kast', 'league_damage_score', 'contribution', 'league_kill_score']))
    const mixed = {
      ...BATTLE_PLAYER,
      rating: null,
      dimensionMedians: [null, null, null, null, null, null, null],
      cells: { ...BATTLE_PLAYER.cells },
    }
    const wrapper = mountDrawer({ scope: 'battle', accountId: 2001 }, mixed)
    expect(wrapper.find('[data-testid="radar-partial"]').text()).toBe('league.drawer.radar_partial')
    // 有 available 轴（kast/contribution）→ 雷达照常绘制，轴序一致（League 缺失轴显示 --，不崩溃）
    const labels = wrapper.find('.radar-stub').text().split(',')
    expect(labels).toEqual(['player_labels.kast', 'player_labels.league_damage_score',
      'player_labels.contribution', 'player_labels.league_kill_score'])
  })

  describe('Drawer stacking / layout contract', () => {
    it('desktop top 使用 --topbar-h token（无 56px 硬编码）；≤1080px Drawer 提升到 modal 层、面板从视口顶部开始', () => {
      // happy-dom 环境下 import.meta.url 指向 vite-node 缓存路径，改从项目根解析源码
      const source = readFileSync(resolve(process.cwd(), 'src/components/PlayerDetailDrawer.vue'), 'utf8')
      // desktop：top = calc(var(--topbar-h) + 8px)，禁止 56px magic number
      expect(source).toContain('top: calc(var(--topbar-h) + 8px)')
      expect(source).not.toContain('top: 56px')
      // ≤1080px：backdrop 提升到 --z-modal（200，高于 --z-topbar 100），面板 top: 8px
      const mobileBlock = source.match(/@media \(max-width: 1080px\) \{[\s\S]*?\n\}/)?.[0] || ''
      expect(mobileBlock).toContain('.drawer-backdrop { z-index: var(--z-modal); }')
      expect(mobileBlock).toContain('.player-drawer { top: 8px; }')
    })

    it('关闭按钮仍在 drawer header（移动端也始终可见可操作）', () => {
      const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
      const head = wrapper.find('.pd-head')
      expect(head.exists()).toBe(true)
      const close = head.find('.pd-close')
      expect(close.exists()).toBe(true)
      expect(close.attributes('aria-label')).toBe('league.drawer.close')
    })
  })

  it('Impact 不出现在 Radar picker，但 Performance 区仍显示 Impact', async () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    await wrapper.find('[data-testid="radar-settings"]').trigger('click')
    const pickerText = wrapper.find('[data-testid="radar-picker"]').text()
    expect(pickerText).toContain('player_labels.kast')
    expect(pickerText).toContain('player_labels.contribution')
    expect(pickerText).not.toContain('player_labels.impact')
    // 存储的旧偏好含 impact → 加载时被过滤（不崩溃）；过滤后仍 ≥3 轴 → 保留剩余
    localStorage.setItem('wotb-radar-metric-order',
      JSON.stringify(['kast', 'impact', 'contribution', 'league_damage_score']))
    const wrapper2 = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const labels = wrapper2.find('.radar-stub').text().split(',')
    expect(labels).toEqual(['player_labels.kast', 'player_labels.contribution',
      'player_labels.league_damage_score'])
    // Performance 区仍显示 Impact
    const perfText = wrapper2.find('[data-testid="perf-facts"]').text()
    expect(perfText).toContain('player_labels.impact')
    expect(perfText).toContain('151.2%')
  })
})
