// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { provideCreatorAvailability, useCreatorAvailability } from './useCreatorAvailability.js'
import { getCreatorAvailability } from '../api/creators.js'

const state = vi.hoisted(() => ({ online: null as any }))
vi.mock('./useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: state.online.value }) }) }))
vi.mock('../api/creators.js', () => ({ getCreatorAvailability: vi.fn() }))
const Child = defineComponent({ setup: () => useCreatorAvailability(), template: '<button :disabled="loading" @click="refresh">{{available}}</button>' })
const Host = defineComponent({ setup() { provideCreatorAvailability() }, components: { Child }, template: '<Child />' })
let wrapper: ReturnType<typeof mount> | undefined
beforeEach(() => { vi.resetAllMocks(); state.online = ref(true) })
afterEach(() => { wrapper?.unmount(); vi.useRealTimers() })

describe('creator backend rollout availability', () => {
  it('defaults closed on a legacy backend and reveals the feature after explicit retry', async () => {
    vi.mocked(getCreatorAvailability).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    wrapper = mount(Host); await flushPromises()
    expect(wrapper.text()).toBe('false')
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(wrapper.text()).toBe('true'); expect(getCreatorAvailability).toHaveBeenCalledTimes(2)
  })
  it('rejects stale probes and retains known capability across temporary network loss', async () => {
    let finish!: (value: boolean) => void
    vi.mocked(getCreatorAvailability).mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(true)
    wrapper = mount(Host); await flushPromises()
    const oldSignal = vi.mocked(getCreatorAvailability).mock.calls[0][0]!
    state.online.value = false; await flushPromises()
    expect(oldSignal.aborted).toBe(true)
    state.online.value = true; await flushPromises()
    expect(wrapper.text()).toBe('true')
    finish(false); await flushPromises(); expect(wrapper.text()).toBe('true')
    state.online.value = false; await flushPromises(); expect(wrapper.text()).toBe('true')
  })
  it('times out a stalled probe, retries on focus, and aborts on unmount', async () => {
    vi.useFakeTimers()
    vi.mocked(getCreatorAvailability).mockImplementation(signal => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')))))
    wrapper = mount(Host)
    await vi.advanceTimersByTimeAsync(5000)
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toBe('false')
    window.dispatchEvent(new Event('focus'))
    expect(getCreatorAvailability).toHaveBeenCalledTimes(2)
    const signal = vi.mocked(getCreatorAvailability).mock.calls[1][0]!
    wrapper.unmount(); wrapper = undefined
    expect(signal.aborted).toBe(true)
    window.dispatchEvent(new Event('focus'))
    expect(getCreatorAvailability).toHaveBeenCalledTimes(2)
  })
  it('does not discard a supported form on a transient probe failure, but observes a confirmed rollback', async () => {
    vi.mocked(getCreatorAvailability).mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce(false)
    wrapper = mount(Host); await flushPromises(); expect(wrapper.text()).toBe('true')
    await wrapper.get('button').trigger('click'); await flushPromises(); expect(wrapper.text()).toBe('true')
    await wrapper.get('button').trigger('click'); await flushPromises(); expect(wrapper.text()).toBe('false')
  })
})
