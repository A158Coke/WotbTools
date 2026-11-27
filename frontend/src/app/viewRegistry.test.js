// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { KeepAlive, defineComponent, h, onMounted, shallowRef } from 'vue'
import ReplayWorkspace from '../components/ReplayWorkspace.vue'
import { defineLazyView, VIEW_COMPONENTS, VIEW_LOAD_FEEDBACK_DELAY_MS } from './viewRegistry.js'

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
