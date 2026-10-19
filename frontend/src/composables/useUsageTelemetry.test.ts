// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { viewFromRoute } from '../app/navigation.js'

const mocks = vi.hoisted(() => ({ post: vi.fn(), auth: null as any, connectivity: null as any, settled: null as any }))
vi.mock('../api/usage-events.js', () => ({ postUsageEvents: mocks.post }))
vi.mock('./useAuth.js', () => ({ useAuth: () => mocks.auth }))
vi.mock('./useConnectivity.js', () => ({ useConnectivity: () => ({ connectivity: mocks.connectivity, settled: mocks.settled }) }))
vi.mock('./usePlatformBridge.js', () => ({ isAndroidApp: () => false }))

let wrappers: ReturnType<typeof mount>[] = []
let useTelemetry: typeof import('./useUsageTelemetry.js')['useUsageTelemetry']
let record: typeof import('./useUsageTelemetry.js')['recordUsage']
const visible = (state: string) => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state as DocumentVisibilityState)
  document.dispatchEvent(new Event('visibilitychange'))
}
const events = () => mocks.post.mock.calls.flatMap(([batch]) => batch)

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  mocks.post.mockReset().mockResolvedValue(undefined)
  mocks.connectivity = ref('online')
  mocks.settled = ref(true)
  mocks.auth = { authenticated: ref(false), authInitState: ref('initializing'), authEpoch: () => 1 }
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const module = await import('./useUsageTelemetry.js')
  useTelemetry = module.useUsageTelemetry
  record = module.recordUsage
})
afterEach(() => {
  wrappers.forEach(w => w.unmount())
  wrappers = []
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function start(view = ref('home')) {
  const wrapper = mount(defineComponent({ setup() { useTelemetry(view); return () => h('div') } }))
  wrappers.push(wrapper)
  return wrapper
}

describe('foreground product telemetry', () => {
  it('emits the initial page once after the first online connectivity result', async () => {
    mocks.connectivity.value = 'unknown'
    mocks.settled.value = false
    start()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.post).not.toHaveBeenCalled()
    mocks.settled.value = true
    mocks.connectivity.value = 'online'
    await vi.advanceTimersByTimeAsync(5_000)
    expect(events().map(e => e.feature)).toEqual(['home'])
    mocks.connectivity.value = 'offline'
    mocks.connectivity.value = 'online'
    await vi.advanceTimersByTimeAsync(5_000)
    expect(events().map(e => e.feature)).toEqual(['home'])
  })

  it('does not count opening the Android download page as a download', async () => {
    start(ref('android'))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(events().filter(e => e.feature === 'android_download')).toHaveLength(0)
  })

  it('drops the initial page when the first connectivity result is offline', async () => {
    mocks.connectivity.value = 'unknown'
    mocks.settled.value = false
    start()
    mocks.connectivity.value = 'offline'
    mocks.settled.value = true
    await nextTick()
    mocks.connectivity.value = 'online'
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.post).not.toHaveBeenCalled()
  })
  it.each(['offline', 'unknown', 'degraded', 'service-unavailable'])('does not enqueue or upload events while %s', async state => {
    mocks.connectivity.value = state
    start()
    record({ event: 'replay_parse', feature: 'replay_parse', outcome: 'start', operation_id: crypto.randomUUID() })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.post).not.toHaveBeenCalled()
    mocks.connectivity.value = 'online'
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('discards a queued online event when disconnected before the flush and never replays it', async () => {
    start()
    record({ event: 'feature_open', feature: 'armor' })
    mocks.connectivity.value = 'offline'
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.post).not.toHaveBeenCalled()
    mocks.connectivity.value = 'online'
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('discards a pending hidden-page open when disconnected', async () => {
    const view = ref('home')
    start(view)
    await vi.advanceTimersByTimeAsync(5_000)
    mocks.post.mockClear()
    visible('hidden')
    view.value = 'agent-armor'
    await nextTick()
    mocks.connectivity.value = 'offline'
    view.value = 'hof'
    await nextTick()
    mocks.connectivity.value = 'online'
    visible('visible')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('rechecks connectivity when a flush runs without a mounted shell' , async () => {
    record({ event: 'feature_open', feature: 'armor' })
    mocks.connectivity.value = 'offline'
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.post).not.toHaveBeenCalled()
  })
  it('waits for authentication, pauses heartbeats while hidden and reports foreground recovery', async () => {
    start()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(events().filter(e => e.event === 'active_user')).toHaveLength(0)
    mocks.auth.authenticated.value = true
    mocks.auth.authInitState.value = 'authenticated'
    await nextTick()
    expect(events().filter(e => e.event === 'active_user')).toHaveLength(1)
    visible('hidden')
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(events().filter(e => e.event === 'active_user')).toHaveLength(1)
    visible('visible')
    expect(events().filter(e => e.event === 'active_user')).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(events().filter(e => e.event === 'active_user')).toHaveLength(3)
  })

  it('duplicate mounted shells do not double-count opens or activity', async () => {
    mocks.auth.authenticated.value = true
    mocks.auth.authInitState.value = 'authenticated'
    const first = start()
    start()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(events().filter(e => e.event === 'active_user')).toHaveLength(1)
    expect(events().filter(e => e.event === 'feature_open')).toHaveLength(1)
    first.unmount()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(events().filter(e => e.event === 'feature_open')).toHaveLength(1)
    expect(events().filter(e => e.event === 'active_user')).toHaveLength(2)
  })

  it('real navigation counts capability opens once, ignores file/query changes and counts re-entry', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: {} }] })
    await router.push('/?view=replay')
    const view = computed(() => viewFromRoute(router.currentRoute.value))
    start(view)
    await router.push('/?view=battle-playback')
    await router.push('/?view=battle-playback&tank=123')
    await router.push('/?view=agent-replay')
    await router.push('/?view=agent-replay&tank=456')
    await router.push('/?view=hof')
    await router.push('/?view=battle-playback')
    await router.push('/?view=admin-users')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(events().map(e => e.feature)).toEqual(['replay_2d', 'replay_3d', 'hall_of_fame', 'replay_2d'])
  })

  it('bounds the memory queue and drops failed uploads without retrying', async () => {
    mocks.post.mockRejectedValue(new Error('offline'))
    for (let i = 0; i < 150; i++) record({ event: 'feature_open', feature: 'armor' })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(events()).toHaveLength(100)
    expect(mocks.post.mock.calls.every(([batch]) => batch.length <= 20)).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(events()).toHaveLength(100)
  })

  it('does not report signed-in activity while connectivity is unavailable', async () => {
    mocks.auth.authenticated.value = true
    mocks.auth.authInitState.value = 'authenticated'
    mocks.connectivity.value = 'offline'
    start()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(events().filter(e => e.event === 'active_user')).toHaveLength(0)
    mocks.connectivity.value = 'online'
    await nextTick()
    await flushPromises()
    expect(events().filter(e => e.event === 'active_user')).toHaveLength(1)
  })
})
