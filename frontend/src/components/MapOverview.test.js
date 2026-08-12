// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import MapOverview from './MapOverview.vue'

const i18n = vi.hoisted(() => ({
  t: vi.fn(key => key)
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: i18n.t })
}))

function zeros(n) {
  return Array.from({ length: n }, () => 0)
}

function makeOverview(overrides = {}) {
  const cells = []
  for (let i = 0; i < 36; i++) {
    const row = Math.floor(i / 6)
    const col = i % 6
    cells.push({
      id: `C${i + 1}`,
      nineGridRegion: Math.floor(row / 2) * 3 + Math.floor(col / 2),
      bounds: {
        xMin: -250 + col * 83.4,
        xMax: -250 + (col + 1) * 83.4,
        yMin: -250 + row * 83.4,
        yMax: -250 + (row + 1) * 83.4
      }
    })
  }
  return {
    mapCode: 'desert_train',
    displayName: 'Desert Sands',
    friendlyTeam: 2,
    playableBounds: { xMin: -256, xMax: 260, yMin: -251, yMax: 254.3 },
    gridCells: cells,
    spawnPoints: [{ name: 'S1', team: 2, x: -200, y: 200 }],
    phases: [
      { key: 'opening', startSec: 0, endSec: 45 },
      { key: 'mid', startSec: 45, endSec: 130 },
      { key: 'late', startSec: 130, endSec: 145 }
    ],
    heatmaps: {
      friendly: { dwell: zeros(36), damage: zeros(36), deaths: zeros(36) },
      enemy: { dwell: zeros(36), damage: zeros(36), deaths: zeros(36) }
    },
    routes: [
      {
        accountId: 1,
        playerName: 'FriendlyTank',
        tankId: 100,
        team: 2,
        points: [
          { x: 0, y: 0, timeSec: 0 },
          { x: 10, y: 10, timeSec: 2 }
        ],
        firstObservedSec: 0,
        lastObservedSec: 2,
        deathSec: null
      },
      {
        accountId: 2,
        playerName: 'LateEnemy',
        tankId: 101,
        team: 1,
        points: [
          { x: -100, y: -100, timeSec: 30 },
          { x: -90, y: -95, timeSec: 32 }
        ],
        firstObservedSec: 30,
        lastObservedSec: 32,
        deathSec: 60
      }
    ],
    ...overrides
  }
}

function mountOverview(overview) {
  return mount(MapOverview, {
    props: { overview },
    global: { mocks: { $t: i18n.t } }
  })
}

describe('MapOverview', () => {
  it('renders the map block with image asset for a registered mapCode', () => {
    const wrapper = mountOverview(makeOverview())
    expect(wrapper.find('[data-test="map-overview"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Desert Sands')
    expect(wrapper.find('svg image').exists()).toBe(true)
    expect(wrapper.findAll('.grid-cell').length).toBe(36)
    expect(wrapper.findAll('.spawns circle').length).toBe(1)
  })

  it('renders nothing when the map has no image asset (素材开关)', () => {
    const wrapper = mountOverview(makeOverview({ mapCode: 'holmeisk' }))
    expect(wrapper.find('[data-test="map-overview"]').exists()).toBe(false)
  })

  it('switches heatmap team and type tabs', async () => {
    const wrapper = mountOverview(makeOverview())
    const buttons = wrapper.findAll('.filter-btn')
    // 阵营：本方/敌方
    await buttons[1].trigger('click')
    expect(buttons[1].classes()).toContain('active')
    // 类型：驻留/伤害/阵亡
    const typeButtons = wrapper.findAll('.filter-group')[1].findAll('button')
    await typeButtons[1].trigger('click')
    expect(typeButtons[1].classes()).toContain('active')
  })

  it('renders routes with per-team colors and death marks', async () => {
    const overview = makeOverview()
    const wrapper = mountOverview(overview)
    const routeTab = wrapper.findAll('.map-tab')[1]
    await routeTab.trigger('click')

    expect(wrapper.findAll('.routes polyline').length).toBe(2)
    expect(wrapper.findAll('.routes .death-mark').length).toBe(1)
    // 迟观测提示（敌方 firstObservedSec=30 > 5）
    expect(wrapper.find('.observed-note').exists()).toBe(true)
    expect(wrapper.text()).toContain('LateEnemy')
  })

  it('filters routes by phase', async () => {
    const overview = makeOverview()
    const wrapper = mountOverview(overview)
    await wrapper.findAll('.map-tab')[1].trigger('click')
    // 阶段 Tab 全部/开局/中期/残局
    const phaseButtons = wrapper.findAll('.filter-group')[1].findAll('button')
    await phaseButtons[1].trigger('click') // 开局
    expect(phaseButtons[1].classes()).toContain('active')
    // 开局 [0,45]：FriendlyTank 有 0/2s 两点 → 有线段；LateEnemy 起点 30s → 也在内
    expect(wrapper.findAll('.routes polyline').length).toBeGreaterThan(0)
  })
})
