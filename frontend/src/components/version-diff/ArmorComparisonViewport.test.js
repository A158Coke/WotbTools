// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import ArmorComparisonViewport from './ArmorComparisonViewport.vue'

const mocks = vi.hoisted(() => ({
  fetchTank: vi.fn(),
  destroy: vi.fn(),
  compare: vi.fn(),
  select: vi.fn(() => 1),
  isolate: vi.fn(),
  mount: vi.fn(),
  loadModels: vi.fn(async () => [{}, {}]),
  disposeModels: vi.fn(),
  onIsolateRequest: null,
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: key => key }),
}))
vi.mock('../../composables/useVersionDiff.js', () => ({
  fetchDatasetTank: mocks.fetchTank,
  datasetTankModelUrl: (version, path) => version + path,
}))
vi.mock('../../scene/viewer/armorComparisonScene.js', () => ({
  loadArmorComparisonModels: mocks.loadModels,
  disposeArmorComparisonModels: mocks.disposeModels,
  mountArmorComparison: mocks.mount.mockImplementation((...args) => {
    mocks.onIsolateRequest = args[6]
    return {
      destroy: mocks.destroy,
      setCompare: mocks.compare,
      setChoice: mocks.select,
      setIsolated: mocks.isolate,
    }
  }),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  mocks.fetchTank.mockClear()
  mocks.destroy.mockClear()
  mocks.compare.mockClear()
  mocks.select.mockClear()
  mocks.isolate.mockClear()
  mocks.mount.mockClear()
  mocks.loadModels.mockClear()
  mocks.disposeModels.mockClear()
  mocks.onIsolateRequest = null
})

it('switches the 3D configuration and applies that configuration isolation keys', async () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  mocks.select.mockClear()
  mocks.isolate.mockClear()
  mocks.fetchTank.mockResolvedValue({
    model_url: '/glb/42/collision.glb',
    configs: [
      { turret_local: 1, gun_local: 9, turret_name: 'Turret A', label: 'Gun X' },
      { turret_local: 2, gun_local: 9, turret_name: 'Turret B', label: 'Gun X' },
    ],
  })
  const wrapper = mount(ArmorComparisonViewport, { props: {
    tankId: 42,
    tankName: 'Test tank',
    pair: { from: { dataset: '11.21.0_1' }, to: { dataset: '11.22.0' } },
    verification: 'verified',
    loadDetail: async () => ({}),
  } })
  await vi.waitFor(() => expect(wrapper.find('select.vd-select').exists()).toBe(true))
  // 先显式停在 2/9，避免依赖 choices 的默认排序。
  await wrapper.get('select').setValue('2/9')
  await flushPromises()
  expect(mocks.select).toHaveBeenLastCalledWith(expect.objectContaining({ key: '2/9' }))
  // 点另一配置（1/9）的板件行：查看器必须切到 1/9，并用 1/9 的隔离键重设图层
  // （setChoice 重建图层时沿用的是旧配置的 isolatedKeys）。
  await wrapper.setProps({ isolateKeys: ['gun:5'], isolateConfigKey: '1/9' })
  await flushPromises()
  expect(mocks.select).toHaveBeenLastCalledWith(expect.objectContaining({ key: '1/9' }))
  expect(mocks.isolate).toHaveBeenLastCalledWith(['gun:5'])
  // 再切回 2/9：1/9 的隔离键不能留在 2/9 的图层上。
  await wrapper.get('select').setValue('2/9')
  await flushPromises()
  expect(mocks.select).toHaveBeenLastCalledWith(expect.objectContaining({ key: '2/9' }))
  expect(mocks.isolate).toHaveBeenLastCalledWith(null)
  // 手动切配置后，旁注芯片的同名板号（gun:5）仍是未选中：首次点击要选中而不是清空。
  mocks.onIsolateRequest('gun:5')
  await flushPromises()
  expect(wrapper.emitted('select').at(-1)).toEqual([{ configKey: '2/9', keys: ['gun:5'] }])
  await wrapper.setProps({ isolateKeys: ['gun:5'], isolateConfigKey: '2/9' })
  mocks.onIsolateRequest('gun:5')
  await flushPromises()
  expect(wrapper.emitted('select').at(-1)).toEqual([{ configKey: '2/9', keys: ['gun:5'] }])
  mocks.onIsolateRequest(null)
  await flushPromises()
  expect(wrapper.emitted('select').at(-1)).toEqual([{ configKey: '', keys: [] }])
  wrapper.unmount()
})

it('shows both verified versions in one inline comparison and releases the viewer on unmount', async () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  mocks.fetchTank.mockResolvedValue({ model_url: '/glb/42/collision.glb', configs: [{ turret_local: 1, gun_local: 2 }] })
  const wrapper = mount(ArmorComparisonViewport, { props: {
    tankId: 42,
    tankName: 'Test tank',
    pair: { from: { dataset: '11.21.0_1' }, to: { dataset: '11.22.0' } },
    verification: 'pending',
    loadDetail: async () => ({}),
  } })
  expect(mocks.fetchTank).not.toHaveBeenCalled()
  await wrapper.setProps({ verification: 'verified' })
  await vi.waitFor(() => expect(wrapper.find('.vd-compare-handle').exists()).toBe(true))
  expect(mocks.fetchTank.mock.calls).toEqual([['11.21.0_1', 42], ['11.22.0', 42]])
  expect(mocks.loadModels.mock.calls[0][0].map(source => source.collision))
    .toEqual(['11.21.0_1/glb/42/collision.glb', '11.22.0/glb/42/collision.glb'])
  // 旁注文案回调（场景 2D 叠加画布逐帧绘制）与初始隔离键一起传入场景。
  expect(mocks.mount).toHaveBeenCalledTimes(1)
  expect(typeof mocks.mount.mock.calls[0][5]).toBe('function')
  expect(typeof mocks.mount.mock.calls[0][6]).toBe('function')
  expect(mocks.isolate).toHaveBeenCalledWith(null)
  // A canvas label focuses its plate and a tap outside any label restores the defaults.
  mocks.onIsolateRequest('gun:2')
  await flushPromises()
  // emit('select', ['gun:2']) → emitted 记录为 [args]
  expect(wrapper.emitted('select')).toEqual([[{ configKey: '1/2', keys: ['gun:2'] }]])
  await wrapper.setProps({ isolateKeys: ['gun:2'] })
  mocks.onIsolateRequest(null)
  await flushPromises()
  expect(wrapper.emitted('select').at(-1)).toEqual([{ configKey: '', keys: [] }])
  expect(wrapper.get('.vd-map-tag').text()).toBe('11.21.0_1')
  expect(wrapper.get('.vd-map-tag.is-new').text()).toBe('11.22.0')
  // 滑杆整合在画面分割线上：手柄是 slider 角色，键盘步进直接驱动 setCompare。
  const handle = wrapper.get('.vd-compare-handle')
  expect(handle.attributes('role')).toBe('slider')
  // 滑杆不能落在 aria-hidden 子树里，否则读屏用户无法发现它。
  expect(handle.element.closest('[aria-hidden="true"]')).toBeNull()
  expect(handle.attributes('aria-valuenow')).toBe('50')
  await handle.trigger('keydown', { key: 'ArrowRight' })
  expect(mocks.compare).toHaveBeenLastCalledWith(52)
  await handle.trigger('keydown', { key: 'Home' })
  expect(mocks.compare).toHaveBeenLastCalledWith(0)
  await handle.trigger('keydown', { key: 'End' })
  expect(mocks.compare).toHaveBeenLastCalledWith(100)
  await wrapper.get('.vd-map-tag.is-new').trigger('click')
  expect(mocks.compare).toHaveBeenLastCalledWith(0)
  await wrapper.get('.vd-map-tag').trigger('click')
  expect(mocks.compare).toHaveBeenLastCalledWith(100)
  expect(wrapper.find('.vd-armor-compare-controls').exists()).toBe(false)
  // 文字行点选 → 隔离键透传给场景（突出对应板、淡化其余）。
  await wrapper.setProps({ isolateKeys: ['gun:2'] })
  expect(mocks.isolate).toHaveBeenLastCalledWith(['gun:2'])
  await wrapper.setProps({ isolateKeys: null })
  expect(mocks.isolate).toHaveBeenLastCalledWith(null)
  // 旁注/引线由场景内的 2D 叠加画布逐帧绘制，DOM 不再承载标注层。
  expect(wrapper.find('.vd-armor-leader').exists()).toBe(false)
  expect(wrapper.find('.vd-armor-callout').exists()).toBe(false)
  wrapper.unmount()
  await flushPromises()
  expect(mocks.destroy).toHaveBeenCalledOnce()
  expect(mocks.disposeModels).toHaveBeenCalledOnce()
})
