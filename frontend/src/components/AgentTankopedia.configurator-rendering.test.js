// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CATALOG, configFixture, moduleFixture, createMountAt } from '../test/AgentTankopediaTestHelpers.js'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import AgentTankopedia from './AgentTankopedia.vue'

const data = vi.hoisted(() => ({
  fetchTankEncyclopedia: vi.fn(),
  fetchTankData: vi.fn(),
  loadTankMechanics: vi.fn(async () => null),
  tankImageUrl: vi.fn(id => `https://assets.test/tank_images/${id}.webp`),
  loadTankIconCrops: vi.fn(async () => null),
}))
vi.mock('../scene/agentData.js', () => data)

const research = vi.hoisted(() => ({ loadTankModules: vi.fn(), loadResearchCatalog: vi.fn() }))
vi.mock('../utils/researchCatalog.js', async importOriginal => ({
  ...(await importOriginal()),
  loadTankModules: research.loadTankModules,
  loadResearchCatalog: research.loadResearchCatalog,
}))

const layout = vi.hoisted(() => ({ compact: false }))
vi.mock('../composables/useBreakpoint.js', async () => {
  const { computed } = await import('vue')
  return { useBreakpoint: () => ({ isCompact: computed(() => layout.compact), isExpanded: computed(() => !layout.compact) }) }
})
vi.mock('../../../common/tank_aliases.json', () => ({ default: { 999: ['大白兔', 'Death Star'] } }))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('zh'),
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    te: key => key === 'agentTanks.nations.ussr',
  }),
}))
const mountAt = createMountAt(AgentTankopedia)
describe('AgentTankopedia — 整合配置器（客户端模块数据）', () => {
  beforeEach(() => {
    research.loadTankModules.mockReset().mockResolvedValue({ tanks: { 'IS-7': moduleFixture() } })
    research.loadResearchCatalog.mockReset().mockResolvedValue(CATALOG)
    data.fetchTankData.mockResolvedValue({
      tank_id: 999, name: 'IS-7', tier: 10, nation: 'ussr', type: 'heavyTank', hp: 2400,
      armor: { hull: { front: 150, sides: 100, rear: 60 }, turret: { front: 250, sides: 150, rear: 80 } },
      configs: configFixture(),
    })
  })

  it('模块摘要不展示未解析的客户端语言 key，缺可靠名称时显示既有 stem', async () => {
    const modules = moduleFixture()
    modules.turrets[1].name_en = '#usa_vehicles:Turret_2'
    modules.turrets[1]['name_zh-Hans'] = '#usa_vehicles:Turret_2'
    modules.turrets[1].stem = 'Turret_2_Test'
    research.loadTankModules.mockResolvedValue({ tanks: { 'IS-7': modules } })
    const { wrapper } = await mountAt({ tank: '999' })
    expect(wrapper.get('.tp-summary').text()).not.toContain('#usa_vehicles:')
    expect(wrapper.get('.tp-summary').text()).toContain('Turret 2 Test')
    wrapper.unmount()
  })

  it('详情头卡显示机制名称，点击后弹窗显示官方原文说明', async () => {
    data.fetchTankData.mockResolvedValueOnce({
      tank_id: 999, name: 'KV-4 KTTS', tier: 8, nation: 'ussr', type: 'AT-SPG',
      configs: configFixture(),
      mechanics: [{
        name: 'TrayShell',
        kinds: ['ARMOR_PIERCING_CR'],
        sectors: [
          { distance: 50, factor: 1.4 },
          { distance: 120, factor: 1.2 },
          { distance: 200, factor: 1.0 },
          { distance: 720, factor: 0.8 },
        ],
        localizationValues: {
          ParamName1: '50', ParamName2: '140', ParamName3: '50', ParamName4: '120',
          ParamName5: '120', ParamName6: '120', ParamName7: '200', ParamName8: '100',
          ParamName9: '200', ParamName10: '80',
        },
      }],
    })
    data.loadTankMechanics.mockResolvedValueOnce({
      mechanics: {
        TrayShell: {
          title: { 'zh-Hans': '突击弹' },
          description: { 'zh-Hans': '距离 %(ParamName1) 米或以内：平均伤害 x %(ParamName2)%' },
        },
      },
    })
    const { wrapper } = await mountAt({ tank: '999' })
    const strip = wrapper.get('.tp-detail-head [data-testid="tank-mechanics"]')
    expect(strip.text()).toContain('突击弹')
    expect(strip.text()).not.toContain('距离 50 米')
    expect(wrapper.find('[data-testid="tank-mechanic-dialog"]').exists()).toBe(false)

    await wrapper.get('[data-testid="tank-mechanic-TrayShell"]').trigger('click')
    await flushPromises()
    const dialog = wrapper.get('[data-testid="tank-mechanic-dialog"]')
    expect(dialog.text()).toContain('突击弹')
    expect(dialog.text()).toContain('距离 50 米或以内：平均伤害 x 140%')
    expect(dialog.text()).not.toContain('%(ParamName')
    wrapper.unmount()
  })

  it('配置器选了 122（改进型垂直稳定器）→ 装甲查看器入口携带 eqpitch=1', async () => {
    const fixture = moduleFixture()
    fixture.optDevicePreset = 'AlternatePitchGrouserPreset'
    research.loadTankModules.mockResolvedValue({ tanks: { 'IS-7': fixture } })
    const { wrapper, router } = await mountAt({ tank: '999', dev: '--0' })
    await wrapper.find('[data-testid="tank-open3d"]').trigger('click')
    await flushPromises()
    const query = router.currentRoute.value.query
    expect(query.view).toBe('agent-armor')
    expect(query.dev).toBe('--0')
    expect(query.eqpitch).toBe('1')
  })

  it('配置器未选 122 → 入口不带 eqpitch（不把无槽位选项带进装甲页）', async () => {
    const { wrapper, router } = await mountAt({ tank: '999' })
    await wrapper.find('[data-testid="tank-open3d"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.view).toBe('agent-armor')
    expect(router.currentRoute.value.query.eqpitch).toBeUndefined()
  })

  it('模块对号成立时渲染配置面板；默认顶级配置，参数区用引擎值 + 上次值 delta（BK useDelta）', async () => {
    const { wrapper } = await mountAt({ tank: '999' })
    expect(wrapper.find('[data-testid="tank-configurator"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tank-turret-1"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="tank-gun-1"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="tank-engine-1"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="tank-track-1"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="tank-turret-0"] img').attributes('src')).toBeTruthy()
    expect(wrapper.find('[data-testid="tank-device-0-attack-0"] img').attributes('src')).toContain('items/devices/rammer')
    const provisionTile = wrapper.findAll('[data-testid^="tank-provision-"] img')
    expect(provisionTile.length).toBeGreaterThan(0)
    const hpRow = wrapper.find('[data-testid="tank-param-maxHealth"]')
    expect(hpRow.text()).toContain('2,500')
    expect(hpRow.find('.tp-param-delta').exists()).toBe(false)
    await wrapper.find('[data-testid="tank-device-0-attack-0"]').trigger('click')
    await flushPromises()
    const reloadRow = wrapper.find('[data-testid="tank-param-gunShellReloadTime"]')
    expect(reloadRow.find('.tp-param-delta').classes()).toContain('is-good')
    expect(reloadRow.find('.tp-param-delta').text()).toContain('▼')
    expect(reloadRow.find('.tp-param-delta').text()).not.toContain('+')
    expect(wrapper.find('[data-testid="tank-params-protectability"]').text()).toContain('250')
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
    expect(row.find('.tp-param-value').text()).toContain('27.38')
    expect(row.text()).toContain('agentTanks.units.DEGREE_PER_SECOND')
  })

  it('参数区展示履带维修/车体尺寸/隐蔽状态（BI 11.21 同口径）', async () => {
    const { wrapper } = await mountAt({ tank: '999' })
    const repair = wrapper.find('[data-testid="tank-param-chassisRepairTime"]')
    expect(repair.exists()).toBe(true)
    expect(repair.text()).toContain('6.86')
    expect(wrapper.find('[data-testid="tank-param-tankLength"]').text()).toContain('7.2')
    expect(wrapper.find('[data-testid="tank-param-tankWidth"]').text()).toContain('3.5')
    expect(wrapper.find('[data-testid="tank-param-tankHeight"]').text()).toContain('1.7')
    expect(wrapper.find('[data-testid="tank-param-tankVolume"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tank-param-movingShotInvisibility"]').text()).toContain('2.4')
    expect(wrapper.find('[data-testid="tank-param-fireInvisibility"]').text()).toContain('4')
  })

  it('概览条 / 火炮元信息 / 消耗品冷却 / 初始-顶级快捷', async () => {
    const { wrapper, router } = await mountAt({ tank: '999' })
    expect(wrapper.find('[data-testid="tank-summary-hp"]').text()).toContain('2,500')
    expect(wrapper.find('[data-testid="tank-summary-pen"]').text()).toContain('250')
    expect(wrapper.find('[data-testid="tank-gun-meta"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tank-consumable-autoExtinguisher"] .tp-icon-badge').text()).toBe('70s')
    expect(wrapper.find('[data-testid="tank-consumable-autoExtinguisher"] .tp-icon-duration').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tank-consumable-duration-afterburning"]').text()).toBe('12s')
    expect(wrapper.find('[data-testid="tank-consumable-afterburning"] .tp-icon-badge').text()).toBe('65s')
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
    expect(wrapper.find('[data-testid="tank-summary-hp"]').text()).toContain('2,400')
    await wrapper.find('[data-testid="tank-preset-top"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ config: '2', engine: '1', track: '1' })
  })

  it('重置同时清空弹种选择（当前已是顶级配置时也不能保留 HE/金币弹）', async () => {
    const { wrapper, router } = await mountAt({ tank: '999' })
    await wrapper.find('[data-testid="tank-shell-1"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.shell).toBe('1')
    await wrapper.find('[data-testid="tank-config-reset"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.shell).toBeUndefined()
    expect(wrapper.find('[data-testid="tank-shell-0"]').classes()).toContain('is-on')
    expect(wrapper.find('[data-testid="tank-param-gunCommonDamagePerMin"] .tp-param-delta').exists()).toBe(false)
  })

  it('桌面坦克模块矩阵按 4 列逐行对齐（炮塔|火炮|发动机|履带）', async () => {
    const { wrapper } = await mountAt({ tank: '999' })
    const matrix = wrapper.find('.tp-module-matrix')
    expect(matrix.exists()).toBe(true)
    expect(matrix.findAll('.tp-module-head')).toHaveLength(4)
    const cells = matrix.findAll('.tp-module-cell')
    expect(cells.slice(0, 4).map(cell => cell.find('button').exists() ? cell.find('button').attributes('data-testid') : null))
      .toEqual(['tank-turret-0', 'tank-gun-0', 'tank-engine-0', 'tank-track-0'])
    expect(wrapper.find('.tp-module-groups').exists()).toBe(false)
  })

  it('手机模块区按类型 2×2 分组：只有 1 个炮塔时不会出现没有卡片的孤立炮塔标签', async () => {
    const fixture = moduleFixture()
    const [turret] = fixture.turrets
    const secondTurretGun = fixture.turrets[1].guns[1]
    fixture.turrets = [{ ...turret, guns: [...turret.guns, { ...secondTurretGun }] }]
    research.loadTankModules.mockResolvedValue({ tanks: { 'IS-7': fixture } })
    layout.compact = true
    const { wrapper } = await mountAt({ tank: '999', config: '0' })

    expect(wrapper.find('[data-testid="tank-configurator"]').exists()).toBe(true)
    expect(wrapper.find('.tp-module-matrix').exists()).toBe(false)
    const groups = wrapper.findAll('.tp-module-group')
    expect(groups).toHaveLength(4)
    expect(groups.map(group => group.find('.tp-module-group-head').text()))
      .toEqual([
        'agentTanks.configurator.turret',
        'agentTanks.configurator.gun',
        'agentTanks.configurator.engine',
        'agentTanks.configurator.track',
      ])

    const turretGroup = wrapper.get('[data-testid="tank-module-group-turret"]')
    expect(turretGroup.findAll('.tp-module-group-head')).toHaveLength(1)
    expect(turretGroup.findAll('.tp-module-tile')).toHaveLength(1)
    expect(turretGroup.get('.tp-module-tile').attributes('data-testid')).toBe('tank-turret-0')
    const gunTiles = wrapper.get('[data-testid="tank-module-group-gun"]').findAll('.tp-module-tile')
    expect(gunTiles.map(tile => tile.attributes('data-testid'))).toEqual(['tank-gun-0', 'tank-gun-1'])

    expect(groups.every(group => group.findAll('.tp-module-tile').length > 0)).toBe(true)
    expect(wrapper.findAll('.tp-module-cell-head')).toHaveLength(0)
  })

  it('高端消耗品 / 配送系统联动消耗品计时徽标', async () => {
    const high = await mountAt({ tank: '999', dev: '--------1' })
    expect(high.wrapper.find('[data-testid="tank-consumable-duration-afterburning"]').text()).toBe('15.96s')
    const delivery = await mountAt({ tank: '999', dev: '--------0' })
    expect(delivery.wrapper.find('[data-testid="tank-consumable-afterburning"] .tp-icon-badge').text()).toBe('55.56s')
  })

})
