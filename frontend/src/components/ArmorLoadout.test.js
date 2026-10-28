// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import ArmorLoadout from './ArmorLoadout.vue'
import DEVICES from '../replay-local/compute/__fixtures__/research/devices.json'
import CONSUMABLES from '../replay-local/compute/__fixtures__/research/consumables.json'
import PROVISIONS from '../replay-local/compute/__fixtures__/research/provisions.json'

const data = vi.hoisted(() => ({ fetchTankData: vi.fn() }))
vi.mock('../scene/agentData.js', () => data)

const research = vi.hoisted(() => ({ loadTankModules: vi.fn(), loadResearchCatalog: vi.fn() }))
vi.mock('../utils/researchCatalog.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadTankModules: research.loadTankModules,
  loadResearchCatalog: research.loadResearchCatalog,
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: ref('zh'), t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key), te: () => false }),
}))

const CATALOG = {
  devices: DEVICES.devices,
  devicePresets: DEVICES.presets,
  consumables: CONSUMABLES.items,
  provisions: PROVISIONS.items,
}

const MODULES = {
  tankId: 999, tier: 10, optDevicePreset: 'defaultPreset', consumableSlots: 2, provisionSlots: 1,
  hasTurret: true,
  chassis: [
    { stem: 'track0', localId: 0, level: 1, stats: {} },
    { stem: 'track1', localId: 1, level: 2, stats: {} },
  ],
  engines: [
    { stem: 'eng0', localId: 0, level: 1, stats: {} },
    { stem: 'eng1', localId: 1, level: 2, stats: {} },
  ],
  turrets: [
    { stem: 't0', localId: 0, level: 1, stats: {}, guns: [{ stem: 'g0', localId: 0, level: 1, stats: {} }] },
    {
      stem: 't1', localId: 1, level: 2, stats: {},
      guns: [{ stem: 'g0', localId: 0, level: 1, stats: {} }, { stem: 'g1', localId: 1, level: 2, stats: {} }],
    },
  ],
}

const DETAIL = {
  tank_id: 999, name: 'IS-7', tier: 10, nation: 'ussr',
  configs: [
    { label: 'Stock', turret_local: 0, gun_local: 0, shells: [{ type: 'ap', damage: 480, penetration: 250 }] },
    { label: 'Top', turret_local: 1, gun_local: 1, shells: [{ type: 'ap', damage: 480, penetration: 260 }] },
  ],
}

async function setup(props = {}) {
  const wrapper = mount(ArmorLoadout, {
    props: { tankId: 999, ...props },
    global: { provide: { [DIALOG_INLINE_KEY]: true }, mocks: { $t: key => key } },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  data.fetchTankData.mockReset().mockResolvedValue(DETAIL)
  research.loadTankModules.mockReset().mockResolvedValue({ tanks: { 'IS-7': MODULES } })
  research.loadResearchCatalog.mockReset().mockResolvedValue(CATALOG)
})

describe('ArmorLoadout（装甲查看器的装配面板）', () => {
  it('数据就绪后发出 ready，并显示与详情页同款配置入口', async () => {
    const wrapper = await setup()
    expect(wrapper.emitted('ready')).toHaveLength(1)
    expect(wrapper.get('[data-testid="armor-loadout-edit"]').exists()).toBe(true)
  })

  it('「更改配置」打开共享的 TankConfigPanel（模块矩阵 + 装备），点击模块即 emit apply', async () => {
    const wrapper = await setup()
    await wrapper.get('[data-testid="armor-loadout-edit"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="armor-loadout-dialog"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tank-configurator"]').exists()).toBe(true)
    // 默认顶级（config 1 → 顶炮塔 t1 + g1）：换成初始履带
    await wrapper.get('[data-testid="tank-track-0"]').trigger('click')
    await flushPromises()
    const payload = wrapper.emitted('apply').at(-1)[0]
    expect(payload.track).toBe(0)
    expect(payload.config).toBe(1) // 其余选择并入当前 selection，不丢
    expect(payload.dev).toBe('') // 没有装备 → 空串（宿主按删除键处理）
    // 装备格同样走同一套 URL 载荷（dev 编码串）
    await wrapper.get('[data-testid="tank-device-0-attack-0"]').trigger('click')
    await flushPromises()
    expect(typeof wrapper.emitted('apply').at(-1)[0].dev).toBe('string')
  })

  it('URL 里的 config/engine/track 决定面板初始选择', async () => {
    const wrapper = await setup({ config: '0', engine: '0', track: '1' })
    await wrapper.get('[data-testid="armor-loadout-edit"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="tank-turret-0"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="tank-engine-0"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="tank-track-1"]').attributes('aria-pressed')).toBe('true')
  })
})
