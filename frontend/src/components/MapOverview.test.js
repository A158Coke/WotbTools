// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import MapOverview from './MapOverview.vue'
import { luminanceOfImage } from '../utils/mapPalette'

const i18n = vi.hoisted(() => ({
  t: vi.fn(key => key)
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: i18n.t, locale: { value: 'zh' } })
}))

// 受控素材表：holland 带 coordinateBounds（世界坐标 -300..300），
// desert_train 无 coordinateBounds（验证旧配置回退 playableBounds 的兼容策略）。
vi.mock('../data/mapImages', () => ({
  mapImages: {
    desert_train: { src: 'desert-sands.png', width: 765, height: 772 },
    holland: {
      src: 'molendijk.png',
      width: 766,
      height: 769,
      coordinateBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 }
    }
  }
}))

vi.mock('../utils/mapPalette.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    luminanceOfImage: vi.fn()
  }
})

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

/** 与 MapOverview.vue 相同的世界坐标 → SVG 像素换算（y 反转）。 */
function toSvg(x, y, bounds, w, h) {
  return {
    x: ((x - bounds.xMin) / (bounds.xMax - bounds.xMin)) * w,
    y: ((bounds.yMax - y) / (bounds.yMax - bounds.yMin)) * h
  }
}

const MOLENDIJK_WORLD = { xMin: -300, xMax: 300, yMin: -300, yMax: 300 }
const MOLENDIJK_PLAYABLE = { xMin: -255.5, xMax: 263.1, yMin: -260.0, yMax: 266.9 }
const MOLENDIJK_CELL_F1 = { xMin: -255.5, xMax: -169.07, yMin: -260.0, yMax: -172.18 }

function makeHollandOverview(overrides = {}) {
  return makeOverview({
    mapCode: 'holland',
    displayName: 'Molendijk',
    playableBounds: MOLENDIJK_PLAYABLE,
    gridCells: [{
      id: 'F1',
      nineGridRegion: 7,
      bounds: MOLENDIJK_CELL_F1
    }],
    spawnPoints: [
      { name: 'Spawn_1_02', team: 2, x: -180.6257, y: -241.2817 },
      { name: 'Spawn_2_14', team: 1, x: 180.2034, y: 252.0772 }
    ],
    routes: [{
      accountId: 1,
      playerName: 'MolendijkTank',
      tankId: 100,
      team: 2,
      points: [
        { x: -180.6257, y: -241.2817, timeSec: 0 },
        { x: 0, y: 0, timeSec: 2 }
      ],
      firstObservedSec: 0,
      lastObservedSec: 2,
      deathSec: 0
    }],
    ...overrides
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

  it('scales the map to two-thirds width and draws nine-grid boxes without numeric labels', () => {
    const wrapper = mountOverview(makeOverview())
    // 9 个九宫格分区框保留（region-line），数字标注（region-label）不再渲染。
    expect(wrapper.findAll('.region-line').length).toBe(9)
    expect(wrapper.find('.region-label').exists()).toBe(false)
    // 等比例缩小三分之一：SVG 宽度 = 容器 66.7%。
    expect(wrapper.find('.map-svg').attributes('style')).toContain('66.7%')
  })

  it('renders nothing when the map has no image asset (素材开关)', () => {
    const wrapper = mountOverview(makeOverview({ mapCode: 'holmeisk' }))
    expect(wrapper.find('[data-test="map-overview"]').exists()).toBe(false)
  })

  it('shows the localized (zh) title from displayNames, falling back to displayName', () => {
    const overview = makeOverview({
      displayNames: { zh: '黄沙荒漠', en: 'Desert Sands', ru: 'Пустынные пески' }
    })
    const wrapper = mountOverview(overview)
    expect(wrapper.find('.map-title').text()).toBe('黄沙荒漠')

    // 无 displayNames 时回退 displayName
    const fallback = mountOverview(makeOverview())
    expect(fallback.find('.map-title').text()).toBe('Desert Sands')
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

    expect(wrapper.findAll('.routes .route-line').length).toBe(2)
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
    expect(wrapper.findAll('.routes .route-line').length).toBeGreaterThan(0)
  })

  it('shows the player-only filter for random battles and renders only the recorder route', async () => {
    luminanceOfImage.mockResolvedValue(null)
    const overview = makeOverview({ arenaBonusType: 1, recorderAccountId: 1 })
    const wrapper = mountOverview(overview)
    await wrapper.findAll('.map-tab')[1].trigger('click')

    const teamButtons = wrapper.findAll('.filter-group')[0].findAll('button')
    expect(teamButtons.map(b => b.text())).toEqual([
      'recon.map.team_friendly',
      'recon.map.team_enemy',
      'recon.map.team_all',
      'recon.map.team_player'
    ])

    await teamButtons[3].trigger('click')
    await flushPromises()
    // 仅渲染录像者（accountId=1）一条路线（含对比描边，route-line 只有一条主路线）
    expect(wrapper.findAll('.routes .route-line').length).toBe(1)
  })

  it('hides the player-only filter for non-random battles or unresolved recorder', async () => {
    luminanceOfImage.mockResolvedValue(null)

    const nonRandom = mountOverview(makeOverview())
    await nonRandom.findAll('.map-tab')[1].trigger('click')
    expect(nonRandom.findAll('.filter-group')[0].findAll('button').map(b => b.text()))
      .toEqual(['recon.map.team_friendly', 'recon.map.team_enemy', 'recon.map.team_all'])

    const unresolved = mountOverview(makeOverview({ arenaBonusType: 1, recorderAccountId: null }))
    await unresolved.findAll('.map-tab')[1].trigger('click')
    expect(unresolved.findAll('.filter-group')[0].findAll('button').map(b => b.text()))
      .toEqual(['recon.map.team_friendly', 'recon.map.team_enemy', 'recon.map.team_all'])
  })

  it('applies the light palette on bright maps and falls back to dark when brightness is unknown', async () => {
    luminanceOfImage.mockResolvedValue(0.8)
    const light = mountOverview(makeOverview())
    await flushPromises()
    expect(light.find('.map-overview').attributes('style')).toContain('--map-region-stroke: rgba(0,0,0,.55)')

    luminanceOfImage.mockResolvedValue(null)
    const dark = mountOverview(makeOverview())
    await flushPromises()
    expect(dark.find('.map-overview').attributes('style')).toContain('--map-region-stroke: rgba(255,255,255,.55)')
  })

  it('calibrates Molendijk against worldBounds: Spawn_1_02 maps to ~(152.4, 693.7)', () => {
    const wrapper = mountOverview(makeHollandOverview())
    // 用 playableBounds 映射会得到 (110.6, 741.7)——若回归到旧行为本断言即失败。
    const spawn = wrapper.findAll('.spawns circle')[0]
    expect(Number(spawn.attributes('cx'))).toBeCloseTo(152.4, 1)
    expect(Number(spawn.attributes('cy'))).toBeCloseTo(693.7, 1)
  })

  it('maps the map center (0,0) to the image center and does not push the top-right spawn to the edge', async () => {
    const wrapper = mountOverview(makeHollandOverview())
    await wrapper.findAll('.map-tab')[1].trigger('click')

    // 中心点 (0,0) → (383.0, 384.5)：出现在路线 polyline 中。
    const polyline = wrapper.find('.routes .route-line')
    expect(polyline.attributes('points')).toContain('383.0,384.5')

    // Molendijk 右上出生点 Spawn_2_14（真实世界坐标）不再被推近图片边缘。
    const spawn = wrapper.findAll('.spawns circle')[1]
    const expected = toSvg(180.2034, 252.0772, MOLENDIJK_WORLD, 766, 769)
    expect(Number(spawn.attributes('cx'))).toBeCloseTo(expected.x, 1)
    expect(Number(spawn.attributes('cy'))).toBeCloseTo(expected.y, 1)
    expect(Number(spawn.attributes('cx'))).toBeLessThan(766 - 20)
    expect(Number(spawn.attributes('cy'))).toBeGreaterThan(20)
  })

  it('uses the same world-to-SVG transform for routes, spawns, death marks and grid cells', async () => {
    const wrapper = mountOverview(makeHollandOverview())
    await wrapper.findAll('.map-tab')[1].trigger('click')

    const spawn = toSvg(-180.6257, -241.2817, MOLENDIJK_WORLD, 766, 769)
    const routePolyline = wrapper.find('.routes .route-line')
    expect(routePolyline.attributes('points')).toContain(`${spawn.x.toFixed(1)},${spawn.y.toFixed(1)}`)
    expect(routePolyline.attributes('points')).toContain('383.0,384.5')

    const death = wrapper.find('.death-mark')
    expect(Number(death.attributes('x'))).toBeCloseTo(spawn.x, 1)
    expect(Number(death.attributes('y'))).toBeCloseTo(spawn.y, 1)

    // 分析网格 F1 仍由 playableBounds 系坐标绘制，但经 coordinateBounds 换算：
    // 只覆盖可玩区左上角，不再被拉伸铺满整张图片。
    const cell = wrapper.find('.grid-cell')
    const xMin = toSvg(MOLENDIJK_CELL_F1.xMin, MOLENDIJK_CELL_F1.yMax, MOLENDIJK_WORLD, 766, 769)
    const xMax = toSvg(MOLENDIJK_CELL_F1.xMax, MOLENDIJK_CELL_F1.yMin, MOLENDIJK_WORLD, 766, 769)
    expect(Number(cell.attributes('x'))).toBeCloseTo(xMin.x, 1)
    expect(Number(cell.attributes('y'))).toBeCloseTo(xMin.y, 1)
    expect(Number(cell.attributes('width'))).toBeCloseTo(xMax.x - xMin.x, 1)
    expect(Number(cell.attributes('height'))).toBeCloseTo(xMax.y - xMin.y, 1)
    expect(Number(cell.attributes('width'))).toBeLessThan(766)
  })

  it('falls back to playableBounds when a map config has no coordinateBounds', () => {
    // desert_train 无 coordinateBounds：明确回退 playableBounds（旧行为兼容）。
    const wrapper = mountOverview(makeOverview())
    const spawn = wrapper.find('.spawns circle')
    const expected = toSvg(-200, 200, { xMin: -256, xMax: 260, yMin: -251, yMax: 254.3 }, 765, 772)
    expect(Number(spawn.attributes('cx'))).toBeCloseTo(expected.x, 1)
    expect(Number(spawn.attributes('cy'))).toBeCloseTo(expected.y, 1)
  })
})
