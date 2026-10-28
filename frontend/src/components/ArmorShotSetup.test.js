// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import ArmorShotSetup from './ArmorShotSetup.vue'

const data = vi.hoisted(() => ({ fetchTankData: vi.fn() }))
vi.mock('../scene/agentData.js', () => data)

const research = vi.hoisted(() => ({ loadTankModules: vi.fn() }))
vi.mock('../utils/researchCatalog.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadTankModules: research.loadTankModules,
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: key => key, locale: ref('zh') }) }))

const MODULES = {
  tankId: 1, turrets: [
    { localId: 0, guns: [{ localId: 0, level: 1 }] },
    { localId: 1, guns: [{ localId: 0, level: 1 }, { localId: 1, level: 2 }] },
  ],
}
const TANKS = {
  1: {
    tank_id: 1, name: 'Shooter', nation: 'ussr',
    configs: [
      { label: 'Gun A', turret_local: 0, gun_local: 0, shells: [{ type: 'ap', damage: 400, penetration: 200 }] },
      {
        label: 'Gun B', turret_local: 1, gun_local: 1,
        shells: [
          { type: 'ap', damage: 480, penetration: 250 },
          { type: 'ap_cr_premium', damage: 410, penetration: 330 },
          { type: 'he', damage: 600, penetration: 70 },
        ],
      },
    ],
  },
  2: {
    tank_id: 2, name: 'Target', nation: 'germany',
    configs: [
      { label: 'Stock turret', turret_local: 0, gun_local: 0, shells: [] },
      { label: 'Top turret', turret_local: 1, gun_local: 1, shells: [] },
    ],
  },
}

function mountSetup(props = {}) {
  return mount(ArmorShotSetup, {
    props: { shooterId: 1, targetId: 2, scfg: '1', config: '0', shell: '0', ...props },
  })
}

beforeEach(() => {
  data.fetchTankData.mockReset().mockImplementation(async id => TANKS[id])
  research.loadTankModules.mockReset().mockResolvedValue({ tanks: { Shooter: MODULES, Target: MODULES } })
})

describe('ArmorShotSetup（射击复现只保留与射击相关的五项）', () => {
  it('渲染双方配置图标、弹种图标与两个开关，并发出 ready', async () => {
    const wrapper = mountSetup()
    await flushPromises()
    expect(wrapper.emitted('ready')).toHaveLength(1)
    expect(wrapper.findAll('[data-testid^="shot-shooter-gun-"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-testid^="shot-target-config-"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-testid^="shot-shell-"]')).toHaveLength(3)
    expect(wrapper.get('[data-testid="shot-shooter-gun-1"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="shot-target-config-0"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="shot-calibrated"]').attributes('aria-pressed')).toBe('false')
    expect(wrapper.get('[data-testid="shot-enhanced"]').attributes('aria-pressed')).toBe('false')
  })

  it('点击图标/开关发出对应事件（换主炮、换弹、校准弹、受击方配置、强化装甲）', async () => {
    const wrapper = mountSetup({ calibratedDefault: true, enhancedDefault: true })
    await flushPromises()
    expect(wrapper.get('[data-testid="shot-calibrated"]').attributes('aria-pressed')).toBe('true')
    await wrapper.get('[data-testid="shot-shooter-gun-0"]').trigger('click')
    await wrapper.get('[data-testid="shot-target-config-1"]').trigger('click')
    await wrapper.get('[data-testid="shot-shell-1"]').trigger('click')
    await wrapper.get('[data-testid="shot-calibrated"]').trigger('click')
    await wrapper.get('[data-testid="shot-enhanced"]').trigger('click')
    expect(wrapper.emitted('shooter-config').at(-1)).toEqual([0])
    expect(wrapper.emitted('target-config').at(-1)).toEqual([1])
    expect(wrapper.emitted('shell').at(-1)).toEqual([1])
    expect(wrapper.emitted('calibrated').at(-1)).toEqual([false])
    expect(wrapper.emitted('enhanced').at(-1)).toEqual([false])
  })

  it('URL 覆盖（eqcal/eqenh）优先于回放真值作为开关初始态', async () => {
    const wrapper = mountSetup({ calibratedDefault: true, enhancedDefault: true, eqcal: '0', eqenh: '0' })
    await flushPromises()
    expect(wrapper.get('[data-testid="shot-calibrated"]').attributes('aria-pressed')).toBe('false')
    expect(wrapper.get('[data-testid="shot-enhanced"]').attributes('aria-pressed')).toBe('false')
  })
})
