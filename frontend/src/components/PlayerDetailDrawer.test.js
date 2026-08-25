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
  // 与 medians 故意不同：Radar 必须用 mean（40/30/10/50 等），不能被 median 的 0 覆盖
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
  // battle scope 只允许单场 dimensionScores（禁止 dimensionMedians/Means 命名复用）
  dimensionScores: [320, 55, 70, 110, 40, 75, 82],
  cells: {
    account_id: 2001, damage_dealt: 3000, damage_assisted: 900, kills: 3,
    damage_blocked: 1200, n_shots: 20, n_hits_dealt: 14, n_penetrations_dealt: 9,
    survived_label: 'SURVIVED', victory_points_earned: 180,
    contribution: 18.1, kast: 80, impact: 120.5,
  },
}

/** 雷达 stub：透传 metrics 数组——label 文本用于 axis 数量/顺序断言；
 *  data-values 暴露 key/rawValue/normalized/displayValue/available 供 value 断言
 *  （polygon 与 detail 必须消费同一个 raw，测试不能只看 label）。 */
const RADAR_STUB = {
  props: ['metrics'],
  template: '<div class="radar-stub" :data-values="JSON.stringify(metrics.map(m => ({key:m.key,rawValue:m.rawValue,normalized:m.normalized,displayValue:m.displayValue,available:m.available})))">{{ metrics.map(m => m.label).join(",") }}</div>',
}

/** 解析 radar stub 的轴值（key → metric）。 */
function radarValues(wrapper) {
  const raw = wrapper.find('.radar-stub').attributes('data-values')
  return Object.fromEntries(JSON.parse(raw).map(m => [m.key, m]))
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
      dimensionScores: [null, null, null, null, null, null, null],
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
      dimensionScores: [null, null, null, null, null, null, null],
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
      dimensionScores: [null, null, null, null, null, null, null],
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

  describe('Radar scope-aware data source contract', () => {
    it('Summary：League 七维取 dimensionMeans（非 median），并断言 raw/normalized', () => {
      const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
      const values = radarValues(wrapper)
      expect(values.league_damage_score.rawValue).toBe(250)
      expect(values.league_assist_score.rawValue).toBe(40)
      expect(values.league_kill_score.rawValue).toBe(30)
      expect(values.league_blocked_score.rawValue).toBe(10)
      expect(values.league_survival_score.rawValue).toBe(50)
      // 不能被 median 的 0/342/60/70/110/80/100 覆盖
      expect(values.league_assist_score.rawValue).not.toBe(60)
      expect(values.league_kill_score.rawValue).not.toBe(70)
      expect(values.league_blocked_score.rawValue).not.toBe(40)
      // 归一化 = raw / 后端 max（250/400=0.625；40/100=0.4）
      expect(values.league_damage_score.normalized).toBeCloseTo(0.625, 3)
      expect(values.league_assist_score.normalized).toBeCloseTo(0.4, 3)
      expect(values.league_assist_score.displayValue).toBe('40 / 100 \u00B7 40%')
    })

    it('Summary 158布丁 型：Assist mean 28.333 而非 median 0', () => {
      // 6 场 rated，assist scores [0,0,0,0,80,90] → median=0，mean=28.333...
      const sparse = {
        ...SUMMARY_PLAYER,
        ratingMedian: 742.6,
        dimensionMedians: [240, 0, 0, 70, 0, 0, 60],
        dimensionMeans: [250, 28.333333333333332, 30, 75, 10, 50, 65],
      }
      const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, sparse)
      const values = radarValues(wrapper)
      expect(values.league_assist_score.rawValue).toBeCloseTo(28.333333, 4)
      expect(values.league_assist_score.normalized).toBeCloseTo(0.28333, 4)
      expect(values.league_assist_score.available).toBe(true)
      expect(values.league_assist_score.rawValue).not.toBe(0)
    })

    it('Battle：League 七维取本场 dimensionScores，绝不使用跨场 means/medians', () => {
      // 故意提供与 battle scores 完全不同的 dimensionMeans/Medians——battle scope 必须忽略
      const battle = {
        ...BATTLE_PLAYER,
        dimensionScores: [320, 55, 70, 110, 40, 75, 82],
        dimensionMeans: [1, 2, 3, 4, 5, 6, 7],
        dimensionMedians: [8, 9, 10, 11, 12, 13, 14],
      }
      const wrapper = mountDrawer({ scope: 'battle', accountId: 2001 }, battle)
      const values = radarValues(wrapper)
      expect(values.league_damage_score.rawValue).toBe(320)
      expect(values.league_assist_score.rawValue).toBe(55)
      expect(values.league_kill_score.rawValue).toBe(70)
      expect(values.league_exchange_score.rawValue).toBe(110)
      expect(values.league_blocked_score.rawValue).toBe(40)
      expect(values.league_survival_score.rawValue).toBe(75)
      expect(values.league_shooting_score.rawValue).toBe(82)
      // 不得被 dimensionMeans [1..7] / dimensionMedians [8..14] 污染
      expect(values.league_assist_score.rawValue).not.toBe(2)
      expect(values.league_kill_score.rawValue).not.toBe(10)
      expect(values.league_damage_score.normalized).toBeCloseTo(0.8, 3) // 320/400
    })
  })
})
