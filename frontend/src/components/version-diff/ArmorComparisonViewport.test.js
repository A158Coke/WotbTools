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
  mocks.mount.mockClear()
  mocks.isolate.mockClear()
  mocks.onIsolateRequest = null
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
  await vi.waitFor(() => expect(wrapper.find('.vd-armor-divider-handle').exists()).toBe(true))
  expect(mocks.fetchTank.mock.calls).toEqual([['11.21.0_1', 42], ['11.22.0', 42]])
  expect(mocks.loadModels.mock.calls[0][0].map(source => source.collision))
    .toEqual(['11.21.0_1/glb/42/collision.glb', '11.22.0/glb/42/collision.glb'])
  // 旁注文案回调（场景 2D 叠加画布逐帧绘制）与初始隔离键一起传入场景。
  expect(mocks.mount).toHaveBeenCalledTimes(1)
  expect(typeof mocks.mount.mock.calls[0][5]).toBe('function')
  expect(typeof mocks.mount.mock.calls[0][6]).toBe('function')
  expect(mocks.isolate).toHaveBeenCalledWith(null)
  // 旁注芯片点击 → 与文字行点击同一语义（切换隔离）。
  mocks.onIsolateRequest('gun:2')
  await flushPromises()
  // emit('select', ['gun:2']) → emitted 记录为 [args]
  expect(wrapper.emitted('select')).toEqual([[{ configKey: '1/2', keys: ['gun:2'] }]])
  await wrapper.setProps({ isolateKeys: ['gun:2'] })
  mocks.onIsolateRequest('gun:2')
  await flushPromises()
  expect(wrapper.emitted('select')).toEqual([[{ configKey: '1/2', keys: ['gun:2'] }], [{ configKey: '1/2', keys: [] }]])
  expect(wrapper.get('.vd-map-tag').text()).toBe('11.21.0_1')
  expect(wrapper.get('.vd-map-tag.is-new').text()).toBe('11.22.0')
  // 滑杆整合在画面分割线上：手柄是 slider 角色，键盘步进直接驱动 setCompare。
  const handle = wrapper.get('.vd-armor-divider-handle')
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
