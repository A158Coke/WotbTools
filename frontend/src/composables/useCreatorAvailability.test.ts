// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { provideCreatorAvailability, useCreatorAvailability } from './useCreatorAvailability.js'
import { getCreatorAvailability, listRecommendationCategories } from '../api/creators.js'
const state = vi.hoisted(() => ({ online: null as any, auth: null as any }))
vi.mock('./useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: state.online.value }) }) }))
vi.mock('./useAuth.js', async original => ({ ...await original<typeof import('./useAuth.js')>(), useAuth: () => state.auth }))
vi.mock('../api/creators.js', () => ({ getCreatorAvailability: vi.fn(), listRecommendationCategories: vi.fn() }))
const supported = { supported: true, contentVisibilitySupported: true, recommendationsSupported: false }
const Child = defineComponent({ setup: () => useCreatorAvailability(), template: '<button :disabled="loading" @click="refresh">{{available}}/{{directoryVisible}}/{{contentKnown}}</button>' })
let owner: ReturnType<typeof provideCreatorAvailability>
const Host = defineComponent({ setup() { owner = provideCreatorAvailability() }, components: { Child }, template: '<Child />' })
let wrapper: ReturnType<typeof mount> | undefined
beforeEach(() => {
  vi.resetAllMocks(); state.online = ref(true)
  state.auth = { authenticated: ref(false), authInitState: ref('unauthenticated'), tokenParsed: ref(null) }
  vi.mocked(getCreatorAvailability).mockResolvedValue(supported)
  vi.mocked(listRecommendationCategories).mockResolvedValue([{ id: 1, name: 'Published', type: 'UP' }])
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.useRealTimers() })
describe('creator capability and content owner', () => {
  it('derives only-video, first publication and last removal from a single typed snapshot', async () => {
    vi.mocked(getCreatorAvailability).mockResolvedValue({ supported: true, contentVisibilitySupported: true, recommendationsSupported: true })
    vi.mocked(listRecommendationCategories).mockResolvedValueOnce([{ id: 2, name: 'Video', type: 'VIDEO' }])
    wrapper = mount(Host); await flushPromises()
    expect(owner.typeVisible('VIDEO')).toBe(true); expect(owner.typeVisible('UP')).toBe(false)
    expect(owner.directoryVisible.value).toBe(true)
    expect(listRecommendationCategories).toHaveBeenCalledWith(true, expect.any(AbortSignal))
    vi.mocked(listRecommendationCategories).mockResolvedValueOnce([]); await owner.refreshPublicCategories()
    expect(owner.directoryVisible.value).toBe(false)
    state.auth.authenticated.value = true; state.auth.authInitState.value = 'authenticated'
    state.auth.tokenParsed.value = { realm_access: { roles: ['content-admin'] } }
    expect(owner.typeVisible('VIDEO')).toBe(true); expect(owner.typeVisible('UP')).toBe(true)
    vi.mocked(getCreatorAvailability).mockResolvedValueOnce(supported); await owner.refresh()
    expect(owner.typeAvailable('VIDEO')).toBe(false); expect(owner.typeVisible('VIDEO')).toBe(false)
    expect(owner.typeAvailable('UP')).toBe(true)
  })
  it('keeps empty content types visible to content-admin but not to tournament-admin, HoF-admin or site-admin', async () => {
    vi.mocked(getCreatorAvailability).mockResolvedValue({ supported: true, contentVisibilitySupported: true, recommendationsSupported: true })
    vi.mocked(listRecommendationCategories).mockResolvedValueOnce([])
    wrapper = mount(Host); await flushPromises()
    state.auth.authenticated.value = true; state.auth.authInitState.value = 'authenticated'
    for (const role of ['tournament-admin', 'HoF-admin', 'wotbtools-admin', 'wotbtools-user']) {
      state.auth.tokenParsed.value = { realm_access: { roles: [role] } }
      await flushPromises()
      expect(owner.typeVisible('UP'), role).toBe(false)
      expect(owner.typeVisible('VIDEO'), role).toBe(false)
    }
    state.auth.tokenParsed.value = { realm_access: { roles: ['content-admin'] } }
    await flushPromises()
    expect(owner.typeVisible('UP')).toBe(true)
    expect(owner.typeVisible('VIDEO')).toBe(true)
  })
  it('keeps legacy dictionaries closed to the public while allowing only a ready real administrator', async () => {
    vi.mocked(getCreatorAvailability).mockResolvedValueOnce({ supported: true, contentVisibilitySupported: false, recommendationsSupported: false })
    wrapper = mount(Host); await flushPromises()
    expect(wrapper.text()).toBe('true/false/false'); expect(listRecommendationCategories).not.toHaveBeenCalled()
    state.auth.authenticated.value = true; state.auth.tokenParsed.value = { realm_access: { roles: ['content-admin'] } }
    state.auth.authInitState.value = 'initializing'; await flushPromises(); expect(owner.directoryVisible.value).toBe(false)
    state.auth.authInitState.value = 'authenticated'; await flushPromises(); expect(owner.directoryVisible.value).toBe(true)
    state.auth.tokenParsed.value.realm_access.roles = ['wotbtools-admin']; await flushPromises(); expect(owner.directoryVisible.value).toBe(false)
    await owner.refresh(); expect(owner.directoryVisible.value).toBe(true); expect(owner.contentKnown.value).toBe(true)
  })
  it('distinguishes initial failure, confirmed empty and nonempty content, preserving snapshots on transient failure', async () => {
    vi.mocked(listRecommendationCategories).mockRejectedValueOnce(new Error('503'))
    wrapper = mount(Host); await flushPromises()
    expect(owner.contentKnown.value).toBe(false); expect(owner.directoryVisible.value).toBe(false); expect(owner.error.value).toBeTruthy()
    await owner.refresh(); expect(owner.directoryVisible.value).toBe(true)
    vi.mocked(listRecommendationCategories).mockRejectedValueOnce(new Error('503')); await owner.refresh()
    expect(owner.directoryVisible.value).toBe(true); expect(owner.publicCategories.value).toHaveLength(1)
    vi.mocked(listRecommendationCategories).mockResolvedValueOnce([]); await owner.refresh()
    expect(owner.contentKnown.value).toBe(true); expect(owner.directoryVisible.value).toBe(false)
    vi.mocked(listRecommendationCategories).mockRejectedValueOnce(new Error('503')); await owner.refresh()
    expect(owner.contentKnown.value).toBe(true); expect(owner.publicCategories.value).toEqual([])
  })
  it('rechecks on focus and merges concurrent focus, online and manual refreshes', async () => {
    wrapper = mount(Host); await flushPromises()
    let finish!: (value: { id: number; name: string; type: 'UP' | 'VIDEO' }[]) => void
    vi.mocked(listRecommendationCategories).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online'))
    const pending = owner.refresh(); await flushPromises()
    expect(getCreatorAvailability).toHaveBeenCalledTimes(2); expect(listRecommendationCategories).toHaveBeenCalledTimes(2)
    finish([]); await pending; expect(owner.directoryVisible.value).toBe(false)
    window.dispatchEvent(new Event('focus')); await flushPromises(); expect(owner.directoryVisible.value).toBe(true)
  })
  it('invalidates a pre-write snapshot and lets the page share the post-write refresh', async () => {
    let finish!: (value: { id: number; name: string; type: 'UP' | 'VIDEO' }[]) => void
    vi.mocked(listRecommendationCategories).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    wrapper = mount(Host); await flushPromises()
    const oldSignal = vi.mocked(listRecommendationCategories).mock.calls[0][1]!
    const pending = owner.refreshPublicCategories(); expect(owner.refresh()).toBe(pending)
    await pending; expect(oldSignal.aborted).toBe(true); expect(owner.directoryVisible.value).toBe(true)
    finish([]); await flushPromises(); expect(owner.directoryVisible.value).toBe(true)
    expect(listRecommendationCategories).toHaveBeenCalledTimes(2)
  })
  it('rejects stale probes and retains known content across temporary network loss', async () => {
    let finish!: (value: typeof supported) => void
    vi.mocked(getCreatorAvailability).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    wrapper = mount(Host); await flushPromises()
    const oldSignal = vi.mocked(getCreatorAvailability).mock.calls[0][0]!
    state.online.value = false; await flushPromises(); expect(oldSignal.aborted).toBe(true)
    state.online.value = true; await flushPromises(); expect(owner.directoryVisible.value).toBe(true)
    finish({ supported: false, contentVisibilitySupported: false, recommendationsSupported: false }); await flushPromises(); expect(owner.directoryVisible.value).toBe(true)
    state.online.value = false; await flushPromises(); expect(owner.directoryVisible.value).toBe(true)
  })
  it('times out even an abort-ignoring transport, then retries and aborts on unmount', async () => {
    vi.useFakeTimers(); vi.mocked(getCreatorAvailability).mockImplementation(() => new Promise(() => {}))
    wrapper = mount(Host); await vi.advanceTimersByTimeAsync(5000)
    expect(owner.loading.value).toBe(false); expect(owner.directoryVisible.value).toBe(false)
    window.dispatchEvent(new Event('focus')); expect(getCreatorAvailability).toHaveBeenCalledTimes(2)
    const signal = vi.mocked(getCreatorAvailability).mock.calls[1][0]!
    wrapper.unmount(); wrapper = undefined; expect(signal.aborted).toBe(true)
    window.dispatchEvent(new Event('focus')); expect(getCreatorAvailability).toHaveBeenCalledTimes(2)
  })
  it('observes a confirmed rollback instead of retaining a stale public snapshot', async () => {
    wrapper = mount(Host); await flushPromises()
    vi.mocked(getCreatorAvailability).mockResolvedValueOnce({ supported: false, contentVisibilitySupported: false, recommendationsSupported: false }); await owner.refresh()
    expect(owner.available.value).toBe(false); expect(owner.contentKnown.value).toBe(false); expect(owner.publicCategories.value).toEqual([])
  })
})
