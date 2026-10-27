// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import AgentTankopedia from './AgentTankopedia.vue'

const data = vi.hoisted(() => ({
  fetchTankEncyclopedia: vi.fn(),
  fetchTankData: vi.fn(),
  tankImageUrl: vi.fn(id => `https://assets.test/tank_images/${id}.webp`),
  loadTankIconCrops: vi.fn(async () => null),
}))
vi.mock('../scene/agentData.js', () => data)

/** 集成态模块夹具：只替换懒加载 chunk（目录/预设/过滤器仍用仓库真实数据）。 */
const research = vi.hoisted(() => ({ loadTankModules: vi.fn() }))
vi.mock('../utils/researchCatalog.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadTankModules: research.loadTankModules,
}))

function moduleFixture() {
  const gunStats = reload => ({
    reloadTime: reload, aimingTime: 2.5, shotDispersionRadius: 0.4, weight: 2500,
    invisibilityFactorAtShot: 0.3, pitchLimits: { min: -6, max: 15 },
    dispersionFactors: { turretRotation: 0.1, afterShot: 3.5, whileGunDamaged: 2 },
  })
  return {
    tankId: 999, name: 'IS-7', tier: 10, tags: [],
    consumableSlots: 2, provisionSlots: 1,
    optDevicePreset: 'defaultPreset',
    speedLimits: { forward: 50, backward: 15 },
    invisibility: { still: 0.1, moving: 0.08, firePenalty: 0.4 },
    hull: { hp: 2000, weight: 50000 },
    // 尺寸/维修（BI 11.21 同口径字段）：包围盒 [x 宽, y 长, z 高]，挂点 [x, 上, 前]
    turretOrigin: [0, 0.3, 1.5],
    bbox: {
      chassis: { min: [-1.75, -3.6, 0], max: [1.75, 3.6, 1.2] },
      hull: { min: [-1.7, -3.5, 0.4], max: [1.7, 3.5, 1.7] },
    },
    crewRoles: ['commander', 'driver', 'gunner', 'loader'],
    chassis: [
      { stem: 'track0', localId: 0, name_en: 'Track 0', stats: { rotationSpeed: 30, terrainResistance: [1.2, 1.4, 2], maxLoad: 55000, weight: 10000, hysteresisHealth: 24, healthRegenPerSec: 3.5, hullPosition: [0, 0, 0], dispersionFactors: { vehicleMovement: 0.19, vehicleRotation: 0.19 } } },
      { stem: 'track1', localId: 1, name_en: 'Track 1', stats: { rotationSpeed: 35, terrainResistance: [1, 1.2, 1.8], maxLoad: 60000, weight: 11000, hysteresisHealth: 24, healthRegenPerSec: 3.5, hullPosition: [0, 0, 0], dispersionFactors: { vehicleMovement: 0.17, vehicleRotation: 0.17 } } },
    ],
    engines: [
      { stem: 'eng0', localId: 0, name_en: 'Engine 0', stats: { power: 1000, fireStartingChance: 0.15, weight: 1000 } },
      { stem: 'eng1', localId: 1, name_en: 'Engine 1', stats: { power: 1200, fireStartingChance: 0.15, weight: 1200 } },
    ],
    turrets: [
      {
        stem: 't0', localId: 0, name_en: 'Turret 0',
        stats: { rotationSpeed: 25, circularVisionRadius: 400, maxHealth: 400, weight: 3000, bbox: { min: [-1.4, -2, 0], max: [1.4, 2, 1] } },
        guns: [{ stem: 'g0', localId: 0, name_en: 'Gun 0', stats: gunStats(12) }],
      },
      {
        stem: 't1', localId: 1, name_en: 'Turret 1',
        stats: { rotationSpeed: 30, circularVisionRadius: 450, maxHealth: 500, weight: 3500, bbox: { min: [-1.4, -2, 0], max: [1.4, 2, 1] } },
        guns: [
          { stem: 'g0', localId: 0, name_en: 'Gun 0', stats: gunStats(12) },
          { stem: 'g1', localId: 1, name_en: 'Gun 1', stats: gunStats(10) },
        ],
      },
    ],
  }
}

/** 与 modules 夹具同形的 3 档配置（0 = 初始炮塔+首炮，2 = 顶级）。 */
function configFixture() {
  const shell = { type: 'ap', damage: 490, penetration: 250, penetration_far: 230, velocity: 900, normalization: 5, ricochet: 70 }
  const he = { type: 'he', damage: 600, penetration: 90, penetration_far: 90, velocity: 700, normalization: 0, ricochet: 70 }
  return [
    { label: 'Stock', turret_local: 0, gun_local: 0, shells: [shell, he] },
    { label: 'Mid', turret_local: 1, gun_local: 0, shells: [shell, he] },
    {
      label: 'Top',
      turret_local: 1,
      gun_local: 1,
      shells: [shell, he],
      // 顶级炮后向俯角受限（BlitzInfo Gun arcs 同源字段）
      pitch_limits: { max: 6, min: -18, back: { max: 3, min: -18, range: 30 } },
    },
  ]
}

// 搜索别名数据集（common/tank_aliases.json）在这里替换成确定性夹具：断言的是
// 「alias 能把车搜出来、展示的仍是正式车名」这条契约，而不是仓库当前录了哪些 alias。
vi.mock('../../../common/tank_aliases.json', () => ({ default: { 999: ['大白兔', 'Death Star'] } }))

const layout = vi.hoisted(() => ({ compact: false }))
vi.mock('../composables/useBreakpoint.js', async () => {
  const { computed } = await import('vue')
  return { useBreakpoint: () => ({ isCompact: computed(() => layout.compact), isExpanded: computed(() => !layout.compact) }) }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('zh'),
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    te: key => key === 'agentTanks.nations.ussr',
  }),
}))

/** 120 辆车：验证增量渲染只渲染第一页 */
function makeCache(count = 120) {
  const cache = {}
  for (let i = 1; i <= count; i += 1) {
    cache[i] = {
      name: `Tank ${String(i).padStart(3, '0')}`,
      tier: (i % 10) + 1,
      nation: i % 2 ? 'ussr' : 'germany',
      type: i % 3 ? 'heavyTank' : 'mediumTank',
      hp: 1000 + i,
      shells: [{ penetration: 100 + i }],
    }
  }
  cache[999] = { name: 'IS-7', tier: 10, nation: 'ussr', type: 'heavyTank', hp: 2400, shells: [{ penetration: 300 }] }
  return cache
}

async function mountAt(query = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push({ path: '/', query: { view: 'agent-tankopedia', ...query } })
  const wrapper = mount(AgentTankopedia, { global: { plugins: [router], provide: { [DIALOG_INLINE_KEY]: true } } })
  await flushPromises()
  return { wrapper, router }
}

describe('AgentTankopedia', () => {
  beforeEach(() => {
    layout.compact = false
    data.fetchTankEncyclopedia.mockReset().mockResolvedValue(makeCache())
    data.fetchTankData.mockReset().mockResolvedValue({
      name: 'IS-7', tier: 10, nation: 'ussr', type: 'heavyTank', hp: 2400,
      configs: [{ label: 'Stock', shells: [{ type: 'ap', penetration: 250 }] }, { label: 'Top', shells: [{ type: 'ap', penetration: 300 }] }],
    })
  })
  afterEach(() => vi.useRealTimers())

  it('首屏只渲染一页卡片，图片懒加载并带固定尺寸；可继续加载', async () => {
    const { wrapper } = await mountAt()
    const cards = wrapper.findAll('[data-testid="tank-card"]')
    expect(cards).toHaveLength(48)
    const img = cards[0].find('img')
    expect(img.attributes('loading')).toBe('lazy')
    expect(img.attributes('width')).toBeTruthy()
    expect(img.attributes('height')).toBeTruthy()
    // 卡片是按钮：键盘可聚焦（审计 3D-18）
    expect(cards[0].element.tagName).toBe('BUTTON')
    await wrapper.find('[data-testid="tank-load-more"]').trigger('click')
    expect(wrapper.findAll('[data-testid="tank-card"]')).toHaveLength(96)
  })

  it('封面图按内容框数据做展示裁剪；数据缺失时回退原始 contain', async () => {
    // 有内容框：卡片与详情 hero 都带 transform（数据驱动展示裁剪，见 utils/tankIconCrop.js）
    data.loadTankIconCrops.mockResolvedValue({
      1: { canvas_w: 256, canvas_h: 128, x: 0, y: 0, w: 141, h: 101 },
      999: { canvas_w: 256, canvas_h: 128, x: 0, y: 0, w: 148, h: 101 },
    })
    const { wrapper } = await mountAt({ tank: '999' })
    const hero = wrapper.find('[data-testid="tank-detail"] img, .tp-media-lg img').exists()
      ? wrapper.find('.tp-media-lg img')
      : wrapper.find('img')
    expect(hero.attributes('style')).toContain('translate(')
    expect(hero.attributes('style')).toContain('scale(')
    wrapper.unmount()

    // 数据缺失（旧包/资产源未配置）：无 transform，保持原 contain 展示
    data.loadTankIconCrops.mockResolvedValue(null)
    const { wrapper: w2 } = await mountAt({ tank: '999' })
    const hero2 = w2.find('.tp-media-lg img')
    expect(hero2.attributes('style') ?? '').not.toContain('scale(')
    w2.unmount()
  })

  it('筛选读写 URL：从 query 恢复，修改时 replace 写回', async () => {
    const { wrapper, router } = await mountAt({ nation: 'germany', tier: '5' })
    const names = wrapper.findAll('[data-testid="tank-card"]')
    expect(names.length).toBeGreaterThan(0)
    expect(wrapper.find('[data-testid="filter-nation"]').element.value).toBe('germany')
    // 显示名走 i18n，不直接显示原始枚举值
    expect(wrapper.find('[data-testid="filter-nation"]').text()).toContain('agentTanks.nations.ussr')

    const replace = vi.spyOn(router, 'replace')
    const tier = wrapper.find('[data-testid="filter-tier"]')
    tier.element.value = ''
    await tier.trigger('change')
    await flushPromises()
    expect(replace).toHaveBeenCalled()
    expect(router.currentRoute.value.query).toEqual({ view: 'agent-tankopedia', nation: 'germany' })
  })

  it('搜索即时筛选，防抖后写进 URL；无结果时显示空状态并可清除', async () => {
    vi.useFakeTimers()
    const { wrapper, router } = await mountAt({ tier: '10' })
    await wrapper.find('[data-testid="tank-search"]').setValue('is7')
    expect(wrapper.findAll('[data-testid="tank-card"]').map(card => card.find('.tp-card-name').text())).toEqual(['IS-7'])
    vi.advanceTimersByTime(300)
    await flushPromises()
    expect(router.currentRoute.value.query.q).toBe('is7')

    await wrapper.find('[data-testid="tank-search"]').setValue('zzzz-no-match')
    expect(wrapper.find('[data-testid="tank-empty"]').exists()).toBe(true)
    await wrapper.find('[data-testid="tank-clear-filters"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ view: 'agent-tankopedia' })
    expect(wrapper.findAll('[data-testid="tank-card"]')).toHaveLength(48)
  })

  it('别名搜索命中目标车辆；卡片与详情标题都显示正式车名', async () => {
    vi.useFakeTimers()
    const { wrapper, router } = await mountAt()
    // 车名里没有「大白兔」，只有 alias 有：命中说明 alias 进了召回链。
    await wrapper.find('[data-testid="tank-search"]').setValue('大白兔')
    const cards = wrapper.findAll('[data-testid="tank-card"]')
    expect(cards.map(card => card.find('.tp-card-name').text())).toEqual(['IS-7'])
    // ?q= 机制不变：alias 和正式车名一样写进 URL（刷新后别名搜索重新执行）。
    vi.advanceTimersByTime(300)
    await flushPromises()
    expect(router.currentRoute.value.query.q).toBe('大白兔')

    await cards[0].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tank).toBe('999')
    expect(wrapper.find('h1').text()).toBe('IS-7')
    expect(wrapper.text()).not.toContain('大白兔')
    wrapper.unmount()

    // 刷新/分享链接：?q= 恢复后别名搜索重新执行（没有新增 alias= 参数）。
    const { wrapper: restored } = await mountAt({ q: '大白兔' })
    expect(restored.findAll('[data-testid="tank-card"]').map(card => card.find('.tp-card-name').text()))
      .toEqual(['IS-7'])
    restored.unmount()
  })

  it('加载失败显示错误态，重试后恢复', async () => {
    data.fetchTankEncyclopedia.mockRejectedValueOnce(new Error('offline'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { wrapper } = await mountAt()
    expect(wrapper.find('[data-testid="tank-list-error"]').attributes('role')).toBe('alert')
    await wrapper.find('[data-testid="tank-list-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="tank-list-error"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="tank-card"]')).toHaveLength(48)
  })

  it('加载中显示骨架屏', async () => {
    data.fetchTankEncyclopedia.mockReturnValueOnce(new Promise(() => {}))
    const { wrapper } = await mountAt()
    expect(wrapper.find('[data-testid="tank-skeleton"]').attributes('aria-busy')).toBe('true')
  })

  it('点击卡片 push 详情，返回保留筛选；配置写进 ?config=，入口携带配置', async () => {
    const { wrapper, router } = await mountAt({ nation: 'ussr', q: 'is7' })
    const push = vi.spyOn(router, 'push')
    await wrapper.find('[data-testid="tank-card"]').trigger('click')
    await flushPromises()
    expect(push).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.query).toEqual({ view: 'agent-tankopedia', nation: 'ussr', q: 'is7', tank: '999' })
    expect(data.fetchTankData).toHaveBeenCalledWith(999)
    expect(wrapper.find('h1').text()).toBe('IS-7')

    // 默认顶级配置（末位）；切换后写进 URL
    const config = wrapper.find('[data-testid="tank-config"]')
    expect(config.element.value).toBe('1')
    await config.setValue('0')
    await flushPromises()
    expect(router.currentRoute.value.query.config).toBe('0')

    await wrapper.find('[data-testid="tank-open3d"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ view: 'agent-armor', tank: '999', config: '0' })
  })

  it('加载更多 → 详情 → 返回保留增量条数', async () => {
    const { wrapper } = await mountAt()
    expect(wrapper.findAll('[data-testid="tank-card"]')).toHaveLength(48)
    await wrapper.find('[data-testid="tank-load-more"]').trigger('click')
    expect(wrapper.findAll('[data-testid="tank-card"]')).toHaveLength(96)
    await wrapper.findAll('[data-testid="tank-card"]')[0].trigger('click')
    await flushPromises()
    expect(wrapper.find('h1').text()).toBe('IS-7')
    await wrapper.find('[data-testid="tank-back"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-testid="tank-card"]')).toHaveLength(96)
  })

  it('防抖窗口内进入详情：计时器继续提交 q，返回列表保留搜索', async () => {
    vi.useFakeTimers()
    const { wrapper, router } = await mountAt()
    await wrapper.find('[data-testid="tank-search"]').setValue('is7')
    const cards = wrapper.findAll('[data-testid="tank-card"]')
    expect(cards).toHaveLength(1)
    await cards[0].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tank).toBe('999')
    expect(router.currentRoute.value.query.q).toBeUndefined()
    // 列表保持挂载：250ms 防抖在详情态继续提交 q，不会因组件卸载清掉 timer。
    vi.advanceTimersByTime(300)
    await flushPromises()
    expect(router.currentRoute.value.query.q).toBe('is7')
    await wrapper.find('[data-testid="tank-back"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('#tp-search').element.value).toBe('is7')
    expect(wrapper.findAll('[data-testid="tank-card"]').map(card => card.find('.tp-card-name').text())).toEqual(['IS-7'])
  })

  it('装甲查看器入口对全员可见（匿名 / 非管理员也不缺席）；返回列表保留筛选', async () => {
    const { wrapper, router } = await mountAt({ nation: 'ussr', tank: '999' })
    expect(wrapper.find('[data-testid="tank-open3d-card"]').exists()).toBe(true)
    await wrapper.find('[data-testid="tank-back"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ view: 'agent-tankopedia', nation: 'ussr' })
    expect(wrapper.findAll('[data-testid="tank-card"]').length).toBeGreaterThan(0)

    // The in-app back replaces the detail entry instead of pushing another list entry.
    // Browser Back must therefore not resurrect the detail that was just closed.
    router.back()
    await flushPromises()
    expect(router.currentRoute.value.query.tank).toBeUndefined()
  })

  it('详情加载失败显示错误态与重试', async () => {
    data.fetchTankData.mockRejectedValueOnce(new Error('404'))
    const { wrapper } = await mountAt({ tank: '5' })
    expect(wrapper.find('[data-testid="tank-detail-error"]').exists()).toBe(true)
  })

  it('手机：筛选收进 sheet，已生效条件显示为 chip，可移除', async () => {
    layout.compact = true
    const { wrapper, router } = await mountAt({ nation: 'ussr' })
    expect(wrapper.find('[data-testid="tank-filters"]').exists()).toBe(false)
    const chips = wrapper.findAll('[data-testid="filter-chip"]')
    expect(chips).toHaveLength(1)
    await chips[0].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ view: 'agent-tankopedia' })
    await wrapper.find('[data-testid="filter-toggle"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="dialog"] [data-testid="tank-filters"]').exists()).toBe(true)
  })

  it('俯仰角与弹种数值按紧凑小数呈现，不直出 f32 扩宽尾数', async () => {
    // 上游 per-tank JSON 把 f32 以 f64 直出：2.3f32 → 2.299999952316284
    data.fetchTankData.mockResolvedValue({
      name: 'SU-100M1', tier: 7, nation: 'ussr', type: 'AT-SPG', hp: 1150,
      speed_forward: 50, speed_reverse: 14,
      gun_depression: 2.299999952316284, gun_elevation: 18.5,
      configs: [{
        label: 'Top', view_range: 240,
        shells: [{ type: 'ap', penetration: 155.3000030517578, damage: 310, penetration_far: 194, velocity: 1015 }],
      }],
    })
    const { wrapper } = await mountAt({ tank: '999' })
    const text = wrapper.text()
    expect(text).toContain('2.3° / 18.5°')
    expect(text).toContain('155.3')
    expect(text).toContain('240 m')
    expect(text).not.toContain('2.299999952316284')
    expect(text).not.toContain('155.3000030517578')
  })

  it('俯仰角字段缺失时回退当前配置 pitch_limits（dep=max、ele=−min）', async () => {
    data.fetchTankData.mockResolvedValue({
      name: 'IS-7', tier: 10, nation: 'ussr', type: 'heavyTank', hp: 2400,
      configs: [{ label: 'Top', view_range: 250, pitch_limits: { max: 6, min: -18 }, shells: [] }],
    })
    const { wrapper } = await mountAt({ tank: '999' })
    expect(wrapper.text()).toContain('6° / 18°')
  })

  it('俯仰角三层来源都缺失时显示 -，不显示 NaN', async () => {
    data.fetchTankData.mockResolvedValue({
      name: 'IS-7', tier: 10, nation: 'ussr', type: 'heavyTank', hp: 2400,
      configs: [{ label: 'Top', shells: [] }],
    })
    const { wrapper } = await mountAt({ tank: '999' })
    expect(wrapper.text()).toContain('-° / -°')
  })
})

describe('AgentTankopedia — 整合配置器（客户端模块数据）', () => {
  beforeEach(() => {
    research.loadTankModules.mockReset().mockResolvedValue({ tanks: { 'IS-7': moduleFixture() } })
    data.fetchTankData.mockResolvedValue({
      tank_id: 999, name: 'IS-7', tier: 10, nation: 'ussr', type: 'heavyTank', hp: 2400,
      armor: { hull: { front: 150, sides: 100, rear: 60 }, turret: { front: 250, sides: 150, rear: 80 } },
      configs: configFixture(),
    })
  })

  it('模块对号成立时渲染配置面板；默认顶级配置，参数区用引擎值 + 上次值 delta（BK useDelta）', async () => {
    const { wrapper } = await mountAt({ tank: '999' })
    expect(wrapper.find('[data-testid="tank-configurator"]').exists()).toBe(true)
    // 模块选择是图标格（客户端 ModulesTechTree 类型图），选中态用 aria-pressed 表达
    expect(wrapper.find('[data-testid="tank-turret-1"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="tank-gun-1"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="tank-engine-1"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="tank-track-1"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="tank-turret-0"] img').attributes('src')).toBeTruthy()
    // 装备/补给/消耗品格显示客户端图标（不是文字）
    expect(wrapper.find('[data-testid="tank-device-0-attack-0"] img').attributes('src')).toContain('items/devices/rammer')
    const provisionTile = wrapper.findAll('[data-testid^="tank-provision-"] img')
    expect(provisionTile.length).toBeGreaterThan(0)
    // 顶级炮塔 500 + 车体 2000 = 2500；初次加载无 delta（BK useDelta：只比较上一次值）
    const hpRow = wrapper.find('[data-testid="tank-param-maxHealth"]')
    expect(hpRow.text()).toContain('2500')
    expect(hpRow.find('.tp-param-delta').exists()).toBe(false)
    // 换输弹机后装填变快：delta 显示绝对差值 + ▼，颜色绿色（biggerIsBetter=false）
    await wrapper.find('[data-testid="tank-device-0-attack-0"]').trigger('click')
    await flushPromises()
    const reloadRow = wrapper.find('[data-testid="tank-param-gunShellReloadTime"]')
    expect(reloadRow.find('.tp-param-delta').classes()).toContain('is-good')
    expect(reloadRow.find('.tp-param-delta').text()).toContain('▼')
    expect(reloadRow.find('.tp-param-delta').text()).not.toContain('+')
    // 装甲表来自引擎（100 顶板 = 150×1.04 无装备时不变）
    expect(wrapper.find('[data-testid="tank-params-protectability"]').text()).toContain('250')
    // BlitzInfo 同构的紧凑卡片列：三组参数是同一 grid 的卡片（不是整栏宽的行）
    const grid = wrapper.find('[data-testid="tank-param-grid"]')
    expect(grid.exists()).toBe(true)
    expect(grid.findAll('.tp-param-group')).toHaveLength(3)
  })

  it('无炮塔车把炮塔转速行换成火炮转向速度（客户端 hasTurret=false）', async () => {
    const fixture = moduleFixture()
    fixture.hasTurret = false
    for (const turret of fixture.turrets) {
      for (const gun of turret.guns) gun.stats.rotationSpeed = 26.25
    }
    research.loadTankModules.mockResolvedValue({ tanks: { 'IS-7': fixture } })
    const { wrapper } = await mountAt({ tank: '999' })
    expect(wrapper.find('[data-testid="tank-param-turretRotationSpeed"]').exists()).toBe(false)
    const row = wrapper.find('[data-testid="tank-param-gunTraverseSpeed"]')
    expect(row.exists()).toBe(true)
    expect(row.find('.tp-param-value').text()).toContain('27.38') // 26.25×1.042857（炮手 1.1）
    expect(row.text()).toContain('agentTanks.units.DEGREE_PER_SECOND')
  })

  it('参数区展示履带维修/车体尺寸/隐蔽状态（BI 11.21 同口径）', async () => {
    const { wrapper } = await mountAt({ tank: '999' })
    const repair = wrapper.find('[data-testid="tank-param-chassisRepairTime"]')
    expect(repair.exists()).toBe(true)
    expect(repair.text()).toContain('6.86') // 24 / 3.5
    expect(wrapper.find('[data-testid="tank-param-tankLength"]').text()).toContain('7.2')
    expect(wrapper.find('[data-testid="tank-param-tankWidth"]').text()).toContain('3.5')
    expect(wrapper.find('[data-testid="tank-param-tankHeight"]').text()).toContain('1.7')
    expect(wrapper.find('[data-testid="tank-param-tankVolume"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tank-param-movingShotInvisibility"]').text()).toContain('2.4')
    expect(wrapper.find('[data-testid="tank-param-fireInvisibility"]').text()).toContain('4')
  })

  it('概览条 / 火炮元信息 / 消耗品冷却 / 初始-顶级快捷', async () => {
    const { wrapper, router } = await mountAt({ tank: '999' })
    expect(wrapper.find('[data-testid="tank-summary-hp"]').text()).toContain('2500')
    expect(wrapper.find('[data-testid="tank-summary-pen"]').text()).toContain('250')
    expect(wrapper.find('[data-testid="tank-gun-meta"]').exists()).toBe(true)
    // 客户端 consumable script 的 cooldown（自动灭火器 70s）与 duration（超速传动器 12s）
    expect(wrapper.find('[data-testid="tank-consumable-autoExtinguisher"] .tp-icon-badge').text()).toBe('70s')
    expect(wrapper.find('[data-testid="tank-consumable-autoExtinguisher"] .tp-icon-duration').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tank-consumable-duration-afterburning"]').text()).toBe('12s')
    expect(wrapper.find('[data-testid="tank-consumable-afterburning"] .tp-icon-badge').text()).toBe('65s')
    // 交互射界图：初始 0°（仰 18 / 俯 6），悬停车尾方向俯角只剩 3°
    const arc = wrapper.find('[data-testid="tank-gun-arc"]')
    expect(arc.exists()).toBe(true)
    expect(wrapper.find('[data-testid="tank-arc-barrel"]').text()).toContain('0°')
    expect(wrapper.find('[data-testid="tank-arc-bearing"]').text()).toContain('0°')
    expect(wrapper.find('[data-testid="tank-arc-up"]').text()).toContain('+18°')
    expect(wrapper.find('[data-testid="tank-arc-down"]').text()).toContain('−6°')
    const svg = wrapper.find('.tp-ga-svg')
    svg.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 204, height: 204, right: 204, bottom: 204, x: 0, y: 0, toJSON: () => ({}) })
    await svg.trigger('pointermove', { clientX: 102, clientY: 163.2 })
    expect(wrapper.find('[data-testid="tank-arc-bearing"]').text()).toContain('180°')
    expect(wrapper.find('[data-testid="tank-arc-down"]').text()).toContain('−3°')
    svg.element.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))
    await flushPromises()
    expect(wrapper.find('[data-testid="tank-arc-bearing"]').text()).toContain('0°')
    expect(wrapper.find('[data-testid="tank-arc-down"]').text()).toContain('−6°')
    // 弹种表在火力卡内：点 HE 行 → URL shell=1，概览伤害/穿透/DPM 换到该弹
    const shellTable = wrapper.find('[data-testid="tank-shell-table"]')
    expect(shellTable.exists()).toBe(true)
    expect(wrapper.find('[data-testid="tank-shell-0"]').classes()).toContain('is-on')
    expect(wrapper.find('[data-testid="tank-shell-0"] img').attributes('src')).toContain('/shells/ap.webp')
    await wrapper.find('[data-testid="tank-shell-1"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.shell).toBe('1')
    expect(wrapper.find('[data-testid="tank-summary-damage"]').text()).toContain('600')
    expect(wrapper.find('[data-testid="tank-summary-pen"]').text()).toContain('90')
    expect(wrapper.find('[data-testid="tank-shell-1"]').classes()).toContain('is-on')
    await wrapper.find('[data-testid="tank-preset-stock"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ config: '0', engine: '0', track: '0' })
    expect(router.currentRoute.value.query.shell).toBeUndefined()
    expect(wrapper.find('[data-testid="tank-summary-damage"]').text()).toContain('490')
    expect(wrapper.find('[data-testid="tank-summary-hp"]').text()).toContain('2400')
    await wrapper.find('[data-testid="tank-preset-top"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ config: '2', engine: '1', track: '1' })
  })

  it('坦克模块矩阵按 4 列逐行对齐（炮塔|火炮|发动机|履带）', async () => {
    const { wrapper } = await mountAt({ tank: '999' })
    const matrix = wrapper.find('.tp-module-matrix')
    expect(matrix.exists()).toBe(true)
    expect(matrix.findAll('.tp-module-head')).toHaveLength(4)
    const cells = matrix.findAll('.tp-module-cell')
    expect(cells.slice(0, 4).map(cell => cell.find('button').exists() ? cell.find('button').attributes('data-testid') : null))
      .toEqual(['tank-turret-0', 'tank-gun-0', 'tank-engine-0', 'tank-track-0'])
  })

  it('高端消耗品 / 配送系统联动消耗品计时徽标', async () => {
    // 默认预设 level2 specialization：左 = 配送系统 118，右 = 高端消耗品 101
    const high = await mountAt({ tank: '999', dev: '--------1' })
    expect(high.wrapper.find('[data-testid="tank-consumable-duration-afterburning"]').text()).toBe('15.96s') // 12 × 1.33
    const delivery = await mountAt({ tank: '999', dev: '--------0' })
    expect(delivery.wrapper.find('[data-testid="tank-consumable-afterburning"] .tp-icon-badge').text()).toBe('55.56s') // 65 ÷ 1.17
  })

  it('乘员技能：图标切换写 ?skills=，平滑驾驶降低移动扩圈，清空恢复', async () => {
    const { wrapper, router } = await mountAt({ tank: '999' })
    const moving = () => wrapper.find('[data-testid="tank-param-dispersionMoving"] .tp-param-value').text()
    const before = moving()
    expect(wrapper.findAll('.tp-skill-btn')).toHaveLength(20)
    await wrapper.find('[data-testid="tank-skill-smooth_driving"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.skills).toBe('smooth_driving:1')
    expect(wrapper.find('[data-testid="tank-skill-smooth_driving"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="tank-skill-smooth_driving"] .tp-skill-level').text()).toBe('1')
    await wrapper.find('[data-testid="tank-skill-smooth_driving"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.skills).toBe('smooth_driving:2')
    expect(wrapper.find('[data-testid="tank-skill-smooth_driving"] .tp-skill-level').text()).toBe('2')
    expect(moving()).not.toBe(before)
    await wrapper.find('[data-testid="tank-skills-max"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.tp-skill-btn.is-on')).toHaveLength(20)
    await wrapper.find('[data-testid="tank-skills-clear"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.tp-skill-btn.is-on')).toHaveLength(0)
    expect(router.currentRoute.value.query.skills).toBeUndefined()
    expect(moving()).toBe(before)
  })

  it('条件技能也联动：近战大师提高炮塔转速，写 ?skills=', async () => {
    const { wrapper, router } = await mountAt({ tank: '999' })
    const turret = () => wrapper.find('[data-testid="tank-param-turretRotationSpeed"] .tp-param-value').text()
    const before = turret()
    await wrapper.find('[data-testid="tank-skill-close_combat_master"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.skills).toBe('close_combat_master:1')
    expect(turret()).not.toBe(before)
  })

  it('装备点击写 ?dev= 并实时改参数；再点卸下', async () => {
    const { wrapper, router } = await mountAt({ tank: '999' })
    await wrapper.find('[data-testid="tank-device-1-defence-1"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.dev).toBe('----1')
    // 伪装网在夹具的 defaultPreset 第 0 级专业右格
    await wrapper.find('[data-testid="tank-device-0-specialization-1"]').trigger('click')
    await flushPromises()
    const summary = wrapper.find('[data-testid="tank-camo-summary"]')
    expect(summary.exists()).toBe(true)
    expect(summary.text()).toContain('net_bonus')
    expect(summary.text()).toContain('"still":"4"') // 夹具是重坦：移动 2% / 静止 4%
    // improved assembly 111：HP ×1.05（2500 → 2625）
    expect(wrapper.find('[data-testid="tank-param-maxHealth"]').text()).toContain('2625')
    // 强化装甲 110：装甲表 +4%（炮塔正面 250 → 260，车体正面 150 → 156）
    await wrapper.find('[data-testid="tank-device-1-defence-0"]').trigger('click')
    await flushPromises()
    const armorTable = wrapper.find('.tp-armor-table')
    expect(armorTable.text()).toContain('260')
    expect(armorTable.text()).toContain('156')
    // 卸下伪装网、改进装配与强化装甲 → dev 键消失
    await wrapper.find('[data-testid="tank-device-0-specialization-1"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="tank-device-1-defence-0"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.dev).toBeUndefined()
    expect(wrapper.find('[data-testid="tank-param-maxHealth"]').text()).toContain('2500')
  })

  it('装备 tooltip 占位符按当前车型/百分比格式化', async () => {
    const { wrapper } = await mountAt({ tank: '999' })
    const title = id => wrapper.find(`[data-testid="${id}"]`).attributes('title')
    // 输弹机：script percent = -5（displayParams 只有 -5）
    expect(title('tank-device-0-attack-0')).toContain('−5%')
    // 改进模块：+20% 履带耐久 / −40% 撞击伤害，并带“不进入参数表”说明
    const protectedTitle = title('tank-device-0-defence-0')
    expect(protectedTitle).toContain('+20%')
    expect(protectedTitle).toContain('−40%')
    expect(protectedTitle).toContain('equipment_no_stat_note')
    // 光学：当前重坦取 Heavy=6%，不是 [object Object]
    const opticsTitle = title('tank-device-0-specialization-0')
    expect(opticsTitle).toContain('+6%')
    expect(opticsTitle).not.toContain('[object Object]')
    // 瞄准镜 104：displayParams 只有 12，script percent 是 -12
    expect(title('tank-device-1-attack-0')).toContain('−12%')
    // 操控 116：+12%；超负荷 107：+35% 弹速 / −60% 距离衰减；校准弹 103：+6%/+7%
    expect(title('tank-device-1-specialization-0')).toContain('+12%')
    expect(title('tank-device-1-attack-1')).toContain('+35%')
    expect(title('tank-device-1-attack-1')).toContain('−60%')
    expect(title('tank-device-0-attack-1')).toContain('+6%')
    // 履带载重：客户端 maxLoad 是 kg（55000），tooltip 显示 55 吨
    expect(title('tank-track-0')).toContain('"load":"55"')
    expect(title('tank-track-0')).not.toContain('55000')
    // 全部装备槽位：不应残留占位符/对象字符串/双百分号
    const titles = wrapper.findAll('[data-testid^="tank-device-"]').map(button => button.attributes('title') || '')
    expect(titles.some(text => text.includes('%('))).toBe(false)
    expect(titles.some(text => text.includes('[object Object]'))).toBe(false)
    expect(titles.some(text => text.includes('%%'))).toBe(false)
  })

  it('弹种明细联动校准弹/超负荷：近远穿深与弹速', async () => {
    const { wrapper } = await mountAt({ tank: '999' })
    const detail = () => wrapper.find('[data-testid="tank-shell-detail"]').text()
    expect(detail()).toContain('250')
    expect(detail()).toContain('230')
    expect(detail()).toContain('900')
    // 校准弹 103：近/远穿深都 ×1.06（250→265、230→243.8）
    await wrapper.find('[data-testid="tank-device-0-attack-1"]').trigger('click')
    await flushPromises()
    expect(detail()).toContain('265')
    expect(detail()).toContain('243.8')
    // 超负荷 107：弹速 ×1.35（900→1215）；远距衰减量 ×0.4（265−21.2×0.4=256.52）
    await wrapper.find('[data-testid="tank-device-1-attack-1"]').trigger('click')
    await flushPromises()
    expect(detail()).toContain('1215')
    expect(detail()).toContain('256.5')
  })

  it('重置清空对比值（previous 同步到重置后的特性）', async () => {
    const { wrapper } = await mountAt({ tank: '999' })
    await wrapper.find('[data-testid="tank-device-1-defence-1"]').trigger('click') // improved assembly 111
    await flushPromises()
    const hp = () => wrapper.find('[data-testid="tank-param-maxHealth"]')
    expect(hp().text()).toContain('2625')
    expect(hp().find('.tp-param-delta').exists()).toBe(true)
    await wrapper.find('[data-testid="tank-config-reset"]').trigger('click')
    await flushPromises()
    expect(hp().text()).toContain('2500')
    expect(hp().find('.tp-param-delta').exists()).toBe(false)
  })

  it('涂装开关写 ?camo=1 并改静止隐蔽（客户端 HT +2 个百分点）', async () => {
    const { wrapper, router } = await mountAt({ tank: '999' })
    const still = () => wrapper.find('[data-testid="tank-param-stillInvisibility"] .tp-param-value').text()
    expect(still()).toContain('10')
    await wrapper.find('[data-testid="tank-camo"]').setValue(true)
    await flushPromises()
    expect(router.currentRoute.value.query.camo).toBe('1')
    expect(still()).toContain('12') // 10% + 2 个百分点（重坦标准涂装）
    // 面板显示生效的加成比例（重坦涂装 +2%；伪装网未选时不出现）
    const summary = wrapper.find('[data-testid="tank-camo-summary"]')
    expect(summary.text()).toContain('paint_bonus')
    expect(summary.text()).toContain('"paint":"2"')
    expect(summary.text()).not.toContain('net_bonus')
  })

  it('切炮塔 → 写 ?config=，炮候选保留全车集、当前塔不可装配置灰', async () => {
    const { wrapper, router } = await mountAt({ tank: '999' })
    await wrapper.find('[data-testid="tank-turret-0"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.config).toBe('0')
    expect(wrapper.find('[data-testid="tank-gun-0"]').attributes('aria-pressed')).toBe('true')
    // 当前炮塔只有 g0；g1 来自另一炮塔，保留为灰色不可选
    const unavailable = wrapper.find('[data-testid="tank-gun-unavailable-g1"]')
    expect(unavailable.exists()).toBe(true)
    expect(unavailable.attributes('disabled')).toBeDefined()
    expect(unavailable.classes()).toContain('is-disabled')
    await unavailable.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.config).toBe('0')
    expect(wrapper.find('[data-testid="tank-param-maxHealth"]').text()).toContain('2400')
    await wrapper.find('[data-testid="tank-gun-0"]').trigger('click')
    await flushPromises()
    const push = vi.spyOn(router, 'push')
    await wrapper.find('[data-testid="tank-open3d"]').trigger('click')
    await flushPromises()
    expect(push).toHaveBeenCalled()
    expect(router.currentRoute.value.query.config).toBe('0')
  })

  it('消耗品默认空；点选写入 URL，满槽不再追加，取消后写回', async () => {
    const { wrapper, router } = await mountAt({ tank: '999' })
    const chips = () => wrapper.findAll('[data-testid^="tank-consumable-"]')
    const active = () => wrapper.findAll('[data-testid^="tank-consumable-"][aria-pressed="true"]')
    expect(active()).toHaveLength(0)
    const first = chips()[0].attributes('data-testid').replace('tank-consumable-', '')
    const second = chips()[1].attributes('data-testid').replace('tank-consumable-', '')
    await wrapper.find(`[data-testid="tank-consumable-${first}"]`).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.cons).toBe(first)
    await wrapper.find(`[data-testid="tank-consumable-${second}"]`).trigger('click')
    await flushPromises()
    expect(active()).toHaveLength(2) // 夹具槽位 2
    const idle = chips().find(chip => chip.attributes('aria-pressed') === 'false')
    await idle.trigger('click')
    await flushPromises()
    expect(active()).toHaveLength(2)
    await wrapper.find(`[data-testid="tank-consumable-${first}"]`).trigger('click')
    await flushPromises()
    expect(active()).toHaveLength(1)
    expect(router.currentRoute.value.query.cons).toBe(second)
  })
})
