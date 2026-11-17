// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CATALOG, configFixture, moduleFixture, createMountAt } from '../test/AgentTankopediaTestHelpers.js'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import AgentTankopedia from './AgentTankopedia.vue'

const data = vi.hoisted(() => ({
  fetchTankEncyclopedia: vi.fn(),
  fetchTankData: vi.fn(),
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
describe('AgentTankopedia — 整合配置器选项（客户端模块数据）', () => {
  beforeEach(() => {
    research.loadTankModules.mockReset().mockResolvedValue({ tanks: { 'IS-7': moduleFixture() } })
    research.loadResearchCatalog.mockReset().mockResolvedValue(CATALOG)
    data.fetchTankData.mockResolvedValue({
      tank_id: 999, name: 'IS-7', tier: 10, nation: 'ussr', type: 'heavyTank', hp: 2400,
      armor: { hull: { front: 150, sides: 100, rear: 60 }, turret: { front: 250, sides: 150, rear: 80 } },
      configs: configFixture(),
    })
  })

  it('乘员技能：图标切换写 ?skills=，平滑驾驶降低移动扩圈，清空恢复', async () => {
    const { wrapper, router } = await mountAt({ tank: '999' })
    const moving = () => wrapper.find('[data-testid="tank-param-dispersionMoving"] .tp-param-value').text()
    const before = moving()
    expect(wrapper.findAll('.tp-skill-btn')).toHaveLength(20)
    // 模板带 % 的 effects 是比例：0.15 → 15%，1.0 → 100%（不是 0.15% / 1%）
    expect(wrapper.find('[data-testid="tank-skill-desperado"]').attributes('title')).toContain('15%')
    expect(wrapper.find('[data-testid="tank-skill-desperado"]').attributes('title')).not.toContain('0.15%')
    expect(wrapper.find('[data-testid="tank-skill-lucky_shot"]').attributes('title')).toContain('100%')
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

  it('条件技能训练与触发分离，开关可逆、分享保留等级、重置关闭', async () => {
    const { wrapper, router } = await mountAt({ tank: '999' })
    const turret = () => wrapper.find('[data-testid="tank-param-turretRotationSpeed"] .tp-param-value').text()
    const before = turret()
    const toggle = () => wrapper.find('[data-testid="tank-skill-triggers"]')
    expect(toggle().element.checked).toBe(false)
    await wrapper.find('[data-testid="tank-skill-close_combat_master"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.skills).toBe('close_combat_master:1')
    expect(turret()).toBe(before)
    await toggle().setValue(true)
    await flushPromises()
    expect(router.currentRoute.value.query.skillTriggers).toBe('1')
    expect(router.currentRoute.value.query.skills).toBe('close_combat_master:1')
    expect(turret()).not.toBe(before)
    expect(wrapper.find('[data-testid="tank-param-turretRotationSpeed"] .tp-param-delta').exists()).toBe(true)
    await toggle().setValue(false)
    await flushPromises()
    expect(router.currentRoute.value.query.skillTriggers).toBeUndefined()
    expect(router.currentRoute.value.query.skills).toBe('close_combat_master:1')
    expect(turret()).toBe(before)
    await toggle().setValue(true)
    await flushPromises()
    await wrapper.find('[data-testid="tank-config-reset"]').trigger('click')
    await flushPromises()
    expect(toggle().element.checked).toBe(false)
    expect(router.currentRoute.value.query.skillTriggers).toBeUndefined()
    expect(router.currentRoute.value.query.skills).toBeUndefined()
    expect(turret()).toBe(before)
    wrapper.unmount()
  })

  it('条件技能深链与前进后退恢复同一开关和参数，清空技能关闭触发', async () => {
    const { wrapper, router } = await mountAt({ tank: '999', skills: 'close_combat_master:7', skillTriggers: '1' })
    const turret = () => wrapper.find('[data-testid="tank-param-turretRotationSpeed"] .tp-param-value').text()
    const active = turret()
    expect(wrapper.find('[data-testid="tank-skill-triggers"]').element.checked).toBe(true)
    await router.push({ path: '/', query: { ...router.currentRoute.value.query, skillTriggers: undefined } })
    await flushPromises()
    expect(turret()).not.toBe(active)
    expect(wrapper.find('[data-testid="tank-skill-triggers"]').element.checked).toBe(false)
    router.back()
    await flushPromises()
    expect(wrapper.find('[data-testid="tank-skill-triggers"]').element.checked).toBe(true)
    expect(turret()).toBe(active)
    router.forward()
    await flushPromises()
    expect(wrapper.find('[data-testid="tank-skill-triggers"]').element.checked).toBe(false)
    await wrapper.find('[data-testid="tank-skill-triggers"]').setValue(true)
    await flushPromises()
    await wrapper.find('[data-testid="tank-skills-clear"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.skillTriggers).toBeUndefined()
    expect(router.currentRoute.value.query.skills).toBeUndefined()
    wrapper.unmount()
  })

  it('装备点击写 ?dev= 并实时改参数；再点卸下', async () => {
    const { wrapper, router } = await mountAt({ tank: '999' })
    // 装备矩阵是 3 行 × 3 类 = 9 对候选：每对两个候选，组间留白由 .tp-dev-matrix 列间距表达。
    const slots = wrapper.findAll('.tp-dev-slot')
    expect(slots).toHaveLength(9)
    expect(slots.every(slot => slot.findAll('.tp-dev-btn').length === 2)).toBe(true)
    expect(wrapper.findAll('.tp-dev-btn')).toHaveLength(18)
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
    expect(wrapper.find('[data-testid="tank-param-maxHealth"]').text()).toContain('2,625')
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
    expect(wrapper.find('[data-testid="tank-param-maxHealth"]').text()).toContain('2,500')
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
    expect(detail()).toContain('1,215')
    expect(detail()).toContain('256.5')
  })

  it('重置清空对比值（previous 同步到重置后的特性）', async () => {
    const { wrapper } = await mountAt({ tank: '999' })
    await wrapper.find('[data-testid="tank-device-1-defence-1"]').trigger('click') // improved assembly 111
    await flushPromises()
    const hp = () => wrapper.find('[data-testid="tank-param-maxHealth"]')
    expect(hp().text()).toContain('2,625')
    expect(hp().find('.tp-param-delta').exists()).toBe(true)
    await wrapper.find('[data-testid="tank-config-reset"]').trigger('click')
    await flushPromises()
    expect(hp().text()).toContain('2,500')
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
    expect(wrapper.find('[data-testid="tank-param-maxHealth"]').text()).toContain('2,400')
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
  it('研发弹窗：头部按钮打开；图里装模块与配置栏矩阵双向同步', async () => {
    const { wrapper, router } = await mountAt({ tank: '999' })
    expect(wrapper.find('[data-testid="tank-open-research"]').exists()).toBe(true)
    await wrapper.find('[data-testid="tank-open-research"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="tank-research-dialog"]').exists()).toBe(true)
    // 默认顶级配置：研发图里 track1 已安装
    expect(wrapper.find('[data-testid="research-node-chassis-track1"]').classes()).toContain('is-installed')
    // 图里点初始履带 → URL + 背后的配置栏矩阵同步
    await wrapper.find('[data-testid="research-node-chassis-track0"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.track).toBe('0')
    expect(wrapper.find('[data-testid="tank-track-0"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="research-node-chassis-track0"]').classes()).toContain('is-installed')
    // 关窗 → 配置栏换回顶级履带 → 再开窗，安装标记跟着走
    await wrapper.find('[data-testid="tank-research-dialog"] .dialog-close').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="tank-research-dialog"]').exists()).toBe(false)
    await wrapper.find('[data-testid="tank-track-1"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.track).toBe('1')
    await wrapper.find('[data-testid="tank-open-research"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="research-node-chassis-track1"]').classes()).toContain('is-installed')
    expect(wrapper.find('[data-testid="research-node-chassis-track0"]').classes()).not.toContain('is-installed')
  })
})
