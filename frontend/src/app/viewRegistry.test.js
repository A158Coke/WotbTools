// @vitest-environment happy-dom
// #845 View transition 边界的语义锁定：defineLazyView 的 delay / latest-wins / error /
// timer 清理全部走真实 defineAsyncComponent（Vue 3.5 runtime semantics），受控 deferred
// loader 只替身动态 import 本身。ViewHost 级 gate precedence 见 ViewHost.transition.test.ts。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { KeepAlive, defineComponent, h, onMounted, shallowRef } from 'vue'
import ReplayWorkspace from '../components/ReplayWorkspace.vue'
import { defineLazyView, VIEW_COMPONENTS, VIEW_LOAD_FEEDBACK_DELAY_MS } from './viewRegistry.js'

/** 与 ViewHost 相同的宿主形态：KeepAlive include + 动态组件位。 */
function mountHost(initial) {
  const current = shallowRef(initial)
  const Host = defineComponent({
    setup() {
      return () => h(KeepAlive, { include: ['ReplayWorkspace'] }, { default: () => h(current.value) })
    },
  })
  const wrapper = mount(Host, { global: { mocks: { $t: key => key } } })
  return { wrapper, show: view => { current.value = view } }
}

/** 受控 lazy view：每次 load 生成新 deferred，测试按名字 settle。 */
const defs = {}
function controlledView(name) {
  return defineLazyView(() => {
    const { promise, resolve, reject } = Promise.withResolvers()
    defs[name] = { resolve, reject }
    return promise.then(() => ({
      name: `${name}Page`,
      template: `<div data-testid="view-${name}">${name}</div>`,
    }))
  })
}

const resolveView = name => { defs[name].resolve(null) }
const rejectView = name => { defs[name].reject(new Error(`boom: ${name}`)) }

beforeEach(() => {
  vi.useFakeTimers()
  for (const key of Object.keys(defs)) delete defs[key]
})
afterEach(() => {
  vi.useRealTimers()
})

describe('defineLazyView transition semantics', () => {
  it('resolving below the threshold never shows the loader and does not wait for it', async () => {
    const view = controlledView('fast')
    const { wrapper, show } = mountHost(view)
    show(view)
    await vi.advanceTimersByTimeAsync(VIEW_LOAD_FEEDBACK_DELAY_MS - 1)
    resolveView('fast')
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('[data-testid="view-fast"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="view-loading"]').exists()).toBe(false)
    // 不存在「loader 至少显示一段时间」的人为等待：resolve 后跨过阈值也不闪 loader
    await vi.advanceTimersByTimeAsync(VIEW_LOAD_FEEDBACK_DELAY_MS * 2)
    expect(wrapper.find('[data-testid="view-loading"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows the loading surface above the threshold and replaces it atomically on resolve', async () => {
    const view = controlledView('slow')
    const { wrapper, show } = mountHost(view)
    show(view)
    await vi.advanceTimersByTimeAsync(VIEW_LOAD_FEEDBACK_DELAY_MS - 1)
    expect(wrapper.find('[data-testid="view-loading"]').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const loader = wrapper.get('[data-testid="view-loading"]')
    expect(loader.attributes('role')).toBe('status')
    expect(loader.attributes('aria-busy')).toBe('true')
    expect(loader.attributes('aria-live')).toBe('polite')
    expect(wrapper.find('[data-testid="view-slow"]').exists()).toBe(false)
    resolveView('slow')
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('[data-testid="view-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="view-slow"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('latest wins: a stale view resolving later never overwrites the current one', async () => {
    const viewB = controlledView('b')
    const viewC = controlledView('c')
    const { wrapper, show } = mountHost(viewB)
    show(viewB)
    show(viewC)
    await vi.advanceTimersByTimeAsync(0)
    resolveView('c')
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('[data-testid="view-c"]').exists()).toBe(true)
    // B 在被 C 取代之后才 resolve（甚至跨过自己的阈值）——不能重新渲染、不能出现 B 的 loader
    resolveView('b')
    await vi.advanceTimersByTimeAsync(VIEW_LOAD_FEEDBACK_DELAY_MS * 3)
    expect(wrapper.find('[data-testid="view-c"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="view-b"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="view-loading"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('a superseded pending view never shows its loader after the navigation moved on', async () => {
    const viewB = controlledView('b')
    const viewC = controlledView('c')
    const { wrapper, show } = mountHost(viewB)
    show(viewB)
    show(viewC)
    await vi.advanceTimersByTimeAsync(0)
    resolveView('c')
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('[data-testid="view-c"]').exists()).toBe(true)
    // B 的 delay timer 已被 unmount 清理：跨过阈值也不出现 B 的 loader
    await vi.advanceTimersByTimeAsync(VIEW_LOAD_FEEDBACK_DELAY_MS * 3)
    expect(wrapper.find('[data-testid="view-loading"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('a rejected loader renders the error surface instead of pending forever', async () => {
    const view = controlledView('broken')
    const { wrapper, show } = mountHost(view)
    show(view)
    await vi.advanceTimersByTimeAsync(0)
    rejectView('broken')
    await vi.advanceTimersByTimeAsync(VIEW_LOAD_FEEDBACK_DELAY_MS + 10)
    expect(wrapper.find('[data-testid="view-loading"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="view-load-error"]').text()).toContain('app.view_load_error')
    expect(wrapper.get('[data-testid="view-load-reload"]').text()).toContain('app.view_load_reload')
    wrapper.unmount()
  })

  it('the reload recovery actually reloads without forwarding the click event', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const view = controlledView('broken')
    const { wrapper, show } = mountHost(view)
    show(view)
    await vi.advanceTimersByTimeAsync(0)
    rejectView('broken')
    await vi.advanceTimersByTimeAsync(0)
    // click event 不得作为首参转发（reloadForFreshBundle 的首参是 beforeReload 回调）
    await wrapper.get('[data-testid="view-load-reload"]').trigger('click')
    expect(reload).toHaveBeenCalledTimes(1)
    reload.mockRestore()
    wrapper.unmount()
  })

  it('navigating away from an errored view recovers and does not leak the error', async () => {
    const viewB = controlledView('broken')
    const viewC = controlledView('healthy')
    const { wrapper, show } = mountHost(viewB)
    show(viewB)
    await vi.advanceTimersByTimeAsync(0)
    rejectView('broken')
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('[data-testid="view-load-error"]').exists()).toBe(true)
    show(viewC)
    await vi.advanceTimersByTimeAsync(0)
    resolveView('healthy')
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('[data-testid="view-load-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="view-healthy"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('a stale view rejecting after being superseded shows no error over the current view', async () => {
    const viewB = controlledView('broken')
    const viewC = controlledView('c')
    const { wrapper, show } = mountHost(viewB)
    show(viewB)
    show(viewC)
    await vi.advanceTimersByTimeAsync(0)
    resolveView('c')
    await vi.advanceTimersByTimeAsync(0)
    rejectView('broken')
    await vi.advanceTimersByTimeAsync(VIEW_LOAD_FEEDBACK_DELAY_MS * 3)
    expect(wrapper.find('[data-testid="view-c"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="view-load-error"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('VIEW_COMPONENTS registry contract', () => {
  it('keeps the replay workspace views synchronous and identical for KeepAlive include matching', () => {
    for (const view of ['replay', 'ai-review', 'battle-playback', 'agent-replay', 'agent-shots']) {
      expect(VIEW_COMPONENTS[view]).toBe(ReplayWorkspace)
    }
  })

  it('keeps ReplayWorkspace instances cached by KeepAlive across view switches', async () => {
    // 生产中 ReplayWorkspace 同步加载且被 <KeepAlive include> 缓存；用同名 stub 锁定该语义不被边界破坏。
    let mounts = 0
    const ReplayStub = defineComponent({
      name: 'ReplayWorkspace',
      setup() {
        onMounted(() => { mounts++ })
        return () => h('div', { 'data-testid': 'replay-stub' })
      },
    })
    const view = controlledView('other')
    const { wrapper, show } = mountHost(ReplayStub)
    show(view)
    await vi.advanceTimersByTimeAsync(0)
    resolveView('other')
    await vi.advanceTimersByTimeAsync(0)
    show(ReplayStub)
    await vi.advanceTimersByTimeAsync(0)
    expect(mounts).toBe(1)
    wrapper.unmount()
  })
})
