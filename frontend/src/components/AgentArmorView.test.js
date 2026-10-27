// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import AgentArmorView from './AgentArmorView.vue'
import { PLAYBACK_PHONE_QUERY } from '../composables/usePlaybackPhoneForm.js'
import { PLAYBACK_PORTRAIT_QUERY } from '../composables/usePlaybackPortraitViewport.js'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import { createShellChrome } from '../app/shellChrome.js'
const mocks = vi.hoisted(() => ({ init: vi.fn(), fetch: vi.fn(), query: vi.fn(), coarse: { value: false } }))
vi.mock('../scene/tankViewer.js', () => ({ initTankViewer: mocks.init }))
vi.mock('../scene/agentData.js', () => ({ fetchReplayShots: mocks.fetch, shotViewerQuery: mocks.query }))
vi.mock('../scene/webglSupport.js', async (original) => ({ ...(await original()), detectWebGL: () => ({ supported: true }) }))
vi.mock('../composables/useBreakpoint.js', () => ({ usePointer: () => ({ coarse: mocks.coarse }) }))
const translate = (key, args) => args ? `${key} ${args.current}/${args.total}` : key
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: translate, te: () => false }) }))
const shots = [
  { index: 6, time_s: 72, shooter_tank_name: 'Object 907', target_tank_name: 'E 100', shooter_name: 'Nickname', shooter_tank_id: 1, target_tank_id: 2, target_eid: 20, damage: 350, hit_flags: 0x10 },
  { index: 9, time_s: 95, shooter_tank_name: 'Object 907', target_tank_name: 'Maus', shooter_tank_id: 1, target_tank_id: 3, target_eid: 30, damage: 0, hit_flags: 0x8 },
]
const mounted = [], scenes = [], restoredMedia = []
function deferred() { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function setup({ query = { view: 'agent-armor', shot: '6' }, shellChrome = null, phone = false, portrait = false } = {}) {
  // 组件的手机形态 / 朝向判据直接读 window.matchMedia（shared/breakpoints 的查询字符串）；
  // happy-dom 无法逐条命中，测试里按字符串恒等桩掉，并在 afterEach 卸载后还原。
  // 竖屏用例还须让 window.innerWidth 与桩一致（usePlaybackPortraitViewport 有第二道
  // innerWidth < 768 守卫，防「查询被桩成一律命中」），happy-dom 默认视口是 1024 宽。
  const original = window.matchMedia
  window.matchMedia = (query) => ({
    matches: (phone && query === PLAYBACK_PHONE_QUERY) || (portrait && query === PLAYBACK_PORTRAIT_QUERY),
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  restoredMedia.push(() => { window.matchMedia = original })
  if (portrait) {
    const width = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    restoredMedia.push(() => { if (width) Object.defineProperty(window, 'innerWidth', width); else delete window.innerWidth })
  }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push({ query })
  const wrapper = mount(AgentArmorView, {
    global: {
      plugins: [router],
      mocks: { $t: translate },
      ...(shellChrome ? { provide: { [SHELL_CHROME_KEY]: shellChrome } } : {}),
      stubs: { Scene3DStatus: { name: 'Scene3DStatus', props: ['mode', 'message'], template: '<div data-testid="status" :data-mode="mode">{{ message }}</div>' } },
    },
  })
  mounted.push(wrapper); await flushPromises(); return { wrapper, router }
}
beforeEach(() => {
  mocks.init.mockReset(); mocks.fetch.mockReset(); mocks.query.mockReset(); scenes.length = 0
  mocks.fetch.mockResolvedValue({ shots })
  mocks.query.mockImplementation(async shot => ({ view: 'agent-armor', shot: String(shot.index), tank: String(shot.target_tank_id) }))
  mocks.init.mockImplementation(options => { const scene = { destroy: vi.fn(), options }; scenes.push(scene); options.onLoadState({ state: 'ready' }); return scene })
})
afterEach(() => { mounted.forEach(w => w.unmount()); mounted.length = 0; restoredMedia.forEach(restore => restore()); restoredMedia.length = 0; mocks.coarse.value = false; vi.clearAllMocks() })
describe('Armor recorded-shot navigation', () => {
  it('shows tank names and recorded facts, disposes the previous scene, and respects navigation bounds', async () => {
    const { wrapper, router } = await setup()
    const header = wrapper.get('[data-testid="armor-shot-header"]')
    for (const value of ['Object 907', 'E 100', '01:12', '350']) expect(header.text()).toContain(value)
    expect(header.text()).not.toContain('Nickname')
    expect(wrapper.get('[aria-label="armor.previous_shot"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="armor.next_shot"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.shot).toBe('9'); expect(scenes[0].destroy).toHaveBeenCalledOnce(); expect(scenes).toHaveLength(2)
    expect(header.text()).toContain('Maus'); expect(wrapper.get('[aria-label="armor.next_shot"]').attributes('disabled')).toBeDefined()
    scenes[0].options.onLoadState({ state: 'error', message: 'stale error' }); await flushPromises()
    expect(wrapper.text()).not.toContain('stale error')
  })
  it('reports failed navigation without destroying the current scene', async () => {
    const { wrapper, router } = await setup(); mocks.query.mockRejectedValueOnce(new Error('unavailable'))
    await wrapper.get('[aria-label="armor.next_shot"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.shot).toBe('6'); expect(scenes[0].destroy).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toBe('armor.navigation_failed')
    expect(wrapper.get('[aria-label="armor.next_shot"]').attributes('disabled')).toBeUndefined()
  })
  it('ignores stale snapshot completions after rapid same-view navigation', async () => {
    const { wrapper, router } = await setup(); const stale = deferred(); mocks.fetch.mockReturnValueOnce(stale.promise)
    await router.replace({ query: { view: 'agent-armor', shot: '8' } }); await flushPromises()
    await router.replace({ query: { view: 'agent-armor', shot: '9' } }); await flushPromises()
    const latest = scenes.at(-1)
    stale.resolve({ shots: [{ index: 9, shooter_tank_name: 'WRONG', target_eid: 2 }] }); await flushPromises()
    expect(wrapper.text()).toContain('Maus'); expect(wrapper.text()).not.toContain('WRONG'); expect(scenes.at(-1)).toBe(latest)
  })
  it('recreates the scene on retry and ignores the failed scene’s later callbacks', async () => {
    const { wrapper } = await setup()
    scenes[0].options.onLoadState({ state: 'error', message: 'assets unavailable' })
    await flushPromises()
    wrapper.findComponent({ name: 'Scene3DStatus' }).vm.$emit('retry')
    await flushPromises()
    expect(scenes).toHaveLength(2)
    expect(scenes[0].destroy).toHaveBeenCalledOnce()
    scenes[0].options.onLoadState({ state: 'error', message: 'stale failure' })
    await flushPromises()
    expect(wrapper.text()).not.toContain('stale failure')
  })
  it('does not recreate the scene when leaving during a retry', async () => {
    const { wrapper } = await setup()
    scenes[0].options.onLoadState({ state: 'error', message: 'assets unavailable' })
    await flushPromises()
    wrapper.findComponent({ name: 'Scene3DStatus' }).vm.$emit('retry')
    wrapper.unmount()
    await flushPromises()
    expect(scenes).toHaveLength(1)
    expect(scenes[0].destroy).toHaveBeenCalledOnce()
  })
  it('ignores shell resolution after unmount', async () => {
    const { wrapper, router } = await setup(); const replace = vi.spyOn(router, 'replace'); const query = deferred(); mocks.query.mockReturnValueOnce(query.promise)
    await wrapper.get('[aria-label="armor.next_shot"]').trigger('click'); wrapper.unmount()
    query.resolve({ view: 'agent-armor', shot: '9' }); await flushPromises()
    expect(replace).not.toHaveBeenCalled(); expect(scenes[0].destroy).toHaveBeenCalledOnce()
  })
  it('opens and closes the initially hidden setup panel', async () => {
    const { wrapper } = await setup(); const tools = wrapper.get('[data-testid="armor-tools"]')
    expect(tools.attributes('aria-expanded')).toBe('false'); await tools.trigger('click'); expect(tools.attributes('aria-expanded')).toBe('true')
    await tools.trigger('click'); expect(tools.attributes('aria-expanded')).toBe('false')
  })
})
describe('Armor immersive shell chrome', () => {
  it('requests immersion on touch phone landscape and releases on unmount', async () => {
    const chrome = createShellChrome()
    mocks.coarse.value = true
    const { wrapper } = await setup({ shellChrome: chrome, phone: true })
    expect(chrome.immersive.value).toBe(true)
    wrapper.unmount()
    expect(chrome.immersive.value).toBe(false)
  })
  it('keeps the shell chrome on portrait phones', async () => {
    const chrome = createShellChrome()
    mocks.coarse.value = true
    const { wrapper } = await setup({ shellChrome: chrome, phone: true, portrait: true })
    expect(chrome.immersive.value).toBe(false)
    wrapper.unmount()
    expect(chrome.immersive.value).toBe(false)
  })
  it('does not request immersion for fine pointers or without a provider', async () => {
    const chrome = createShellChrome()
    const { wrapper } = await setup({ shellChrome: chrome, phone: true })
    expect(chrome.immersive.value).toBe(false)
    // coarse 是非响应式桩：无 provider 的挂载要在 mount 前置位，随后立刻还原
    mocks.coarse.value = true
    const { wrapper: bare } = await setup({ phone: true })
    mocks.coarse.value = false
    await flushPromises()
    expect(() => bare.unmount()).not.toThrow()
    expect(chrome.immersive.value).toBe(false)
    wrapper.unmount()
  })
})
