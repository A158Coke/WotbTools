// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { provideHofPendingCount } from './useHofPendingCount'
import type { HofPendingCount } from '../shared/hofPendingCount'

type Totals = { hundred: number; mark3: number }
const read = vi.fn<(signal: AbortSignal) => Promise<Totals>>()
const initialized = ref(true), authenticated = ref(true), phase = ref('authenticated')
const token = ref({ sub: 'A', realm_access: { roles: ['HoF-admin'] } })
const available = ref(true), pending = ref(false)
let epoch = 1
vi.mock('./useAuth.js', () => ({ useAuth: () => ({
  initialized, authenticated, authInitState: phase, tokenParsed: token, authEpoch: () => epoch,
  isHofAdmin: computed(() => token.value.realm_access.roles.some(r => r === 'HoF-admin' || r === 'wotbtools-admin')),
}) }))
vi.mock('./useFeatureGate.js', () => ({ useFeatureGate: () => ({
  availability: () => ({ available: available.value, pending: pending.value }),
}) }))
const view = ref('home'), drawer = ref(false)
let count: HofPendingCount
let stop: () => void
async function settle() { await nextTick(); await Promise.resolve(); await nextTick() }
async function shell() {
  const wrapper = mount(defineComponent({ setup() {
    count = provideHofPendingCount(view, drawer, read)
    return () => h('div')
  } }))
  stop = () => wrapper.unmount()
  await settle()
}
function deferred() {
  let complete!: (value: Totals) => void, reject!: (error: unknown) => void
  const value = new Promise<Totals>((yes, no) => { complete = yes; reject = no })
  return { value, complete, reject }
}
function focus() { window.dispatchEvent(new Event('focus')) }
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-27T00:00:00Z'))
  phase.value = 'authenticated'; authenticated.value = true; initialized.value = true
  token.value = { sub: 'A', realm_access: { roles: ['HoF-admin'] } }; epoch = 1
  pending.value = false; available.value = true; view.value = 'home'; drawer.value = false
  read.mockReset().mockResolvedValue({ hundred: 7, mark3: 5 })
})
afterEach(() => { stop(); vi.useRealTimers() })

describe('shell HoF pending count', () => {
  it('waits for a known subject, ready identity, eligible role and settled online feature', async () => {
    initialized.value = false; authenticated.value = false; phase.value = 'initializing'
    pending.value = true
    await shell()
    expect(count.status.value).toBe('hidden')
    initialized.value = true; phase.value = 'authenticated'; authenticated.value = true
    token.value = { sub: 'A', realm_access: { roles: ['tournament-admin'] } }
    await settle()
    expect(read).not.toHaveBeenCalled()
    token.value = { sub: '', realm_access: { roles: ['HoF-admin'] } }
    await settle()
    expect(read).not.toHaveBeenCalled()
    token.value = { sub: 'A', realm_access: { roles: ['wotbtools-admin'] } }
    await settle()
    expect(read).not.toHaveBeenCalled()
    pending.value = false
    await settle()
    expect(count.snapshot.value).toEqual({ hundred: 7, mark3: 5, total: 12, sampledAt: Date.now() })
  })
  it('coalesces passive triggers, reuses 30s successes and never polls', async () => {
    await shell()
    drawer.value = true; view.value = 'hof-admin'; focus()
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(read).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    expect(read).toHaveBeenCalledTimes(1)
    const pendingRead = deferred()
    read.mockReturnValueOnce(pendingRead.value)
    focus(); focus()
    expect(count.status.value).toBe('loading')
    expect(count.snapshot.value?.total).toBe(12)
    expect(read).toHaveBeenCalledTimes(2)
    pendingRead.complete({ hundred: 0, mark3: 0 }); await settle()
    expect(count.snapshot.value?.total).toBe(0)
  })
  it('refreshes an expired successful sample on each eligible shell event', async () => {
    await shell()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    try {
      vi.advanceTimersByTime(31_000)
      document.dispatchEvent(new Event('visibilitychange')); await settle()
      expect(read).toHaveBeenCalledTimes(1)
      visibility.mockReturnValue('visible')
      const events = [
        () => document.dispatchEvent(new Event('visibilitychange')),
        () => { view.value = 'hof-admin' },
        () => { drawer.value = true },
        () => window.dispatchEvent(new Event('online')),
        focus,
      ]
      for (const [index, fire] of events.entries()) {
        vi.advanceTimersByTime(31_000)
        fire(); await settle()
        expect(read).toHaveBeenCalledTimes(index + 2)
      }
    } finally { visibility.mockRestore() }
  })
  it('rejects invalid totals and controls retries after transient failures', async () => {
    read.mockResolvedValueOnce({ hundred: Number.MAX_SAFE_INTEGER, mark3: 1 })
    await shell()
    expect(count.reason.value).toBe('unavailable')
    expect(count.snapshot.value).toBeNull()
    focus(); expect(read).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    drawer.value = true; await settle()
    expect(count.status.value).toBe('ready')
    read.mockRejectedValueOnce(new Error('server error'))
    count.retry(); await settle()
    expect(count.status.value).toBe('unknown')
    expect(count.snapshot.value?.total).toBe(12)
    count.retry(); await settle()
    expect(count.status.value).toBe('ready')
  })
  it.each([401, 403])('freezes HTTP %i across token renewal, invalidation and network events until explicit retry', async status => {
    await shell()
    const invalidate = count.captureInvalidation()
    const inFlight = deferred()
    read.mockReturnValueOnce(inFlight.value)
    count.retry(); invalidate()
    inFlight.reject({ status }); await settle()
    expect(count.reason.value).toBe(status === 401 ? 'unauthorized' : 'forbidden')
    token.value = { ...token.value }
    available.value = false; await settle(); available.value = true
    vi.advanceTimersByTime(60_000)
    view.value = 'hof-admin'; drawer.value = true
    focus(); invalidate(); await settle()
    expect(read).toHaveBeenCalledTimes(2)
    expect(count.status.value).toBe('unknown')
    count.retry(); await settle()
    expect(count.status.value).toBe('ready')
    expect(read).toHaveBeenCalledTimes(3)
  })
  it('ignores old identity results and callbacks including a logout followed by a new session for the same subject', async () => {
    const old = deferred()
    read.mockReturnValueOnce(old.value)
    await shell()
    const oldSignal = read.mock.calls[0][0]
    const invalidateA = count.captureInvalidation()
    epoch++; token.value = { ...token.value, sub: 'B' }
    expect(count.snapshot.value).toBeNull()
    expect(oldSignal.aborted).toBe(true)
    await settle()
    old.complete({ hundred: 90, mark3: 90 }); invalidateA(); await settle()
    expect(count.snapshot.value?.total).toBe(12)
    const invalidateB = count.captureInvalidation()
    authenticated.value = false
    expect(count.snapshot.value).toBeNull()
    expect(count.status.value).toBe('hidden')
    epoch++; authenticated.value = true; await settle()
    invalidateB(); invalidateA(); await settle()
    expect(read).toHaveBeenCalledTimes(3)
    token.value = { sub: 'B', realm_access: { roles: [] } }
    expect(count.status.value).toBe('hidden')
    expect(count.snapshot.value).toBeNull()
  })
  it('retains one trailing batch across an off-page settlement and times out an uncooperative prior reader', async () => {
    const old = deferred(), replacement = deferred()
    read.mockReturnValueOnce(old.value).mockReturnValueOnce(replacement.value)
    view.value = 'hof-admin'
    await shell()
    const oldSignal = read.mock.calls[0][0]
    const onSettled = count.captureInvalidation()
    view.value = 'home'; await settle()
    onSettled(); onSettled(); focus()
    expect(read).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    expect(oldSignal.aborted).toBe(true)
    expect(read).toHaveBeenCalledTimes(2)
    old.complete({ hundred: 50, mark3: 50 }); await settle()
    expect(count.snapshot.value).toBeNull()
    replacement.complete({ hundred: 5, mark3: 7 }); await settle()
    expect(count.status.value).toBe('ready')
    expect(count.snapshot.value?.total).toBe(12)
    stop()
    onSettled(); focus(); await settle()
    expect(count.status.value).toBe('hidden')
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('ignores an invalidated success and allows a fresh session after a permission freeze', async () => {
    const old = deferred()
    read.mockReturnValueOnce(old.value).mockRejectedValueOnce({ status: 403 })
    await shell()
    count.captureInvalidation()()
    old.complete({ hundred: 50, mark3: 50 }); await settle()
    expect(count.snapshot.value).toBeNull()
    expect(count.reason.value).toBe('forbidden')
    token.value = { sub: 'A', realm_access: { roles: ['wotbtools-admin'] } }
    await settle()
    expect(count.status.value).toBe('ready')
    expect(count.snapshot.value?.total).toBe(12)
  })
  it('times out a stalled first batch without caching zero and clears loading offline', async () => {
    const stall = deferred()
    read.mockReturnValueOnce(stall.value)
    await shell()
    vi.advanceTimersByTime(5000); await settle()
    expect(count.reason.value).toBe('timeout')
    expect(count.snapshot.value).toBeNull()
    available.value = false; await settle()
    expect(count.reason.value).toBe('offline')
    count.retry(); expect(read).toHaveBeenCalledTimes(1)
    available.value = true; await settle()
    expect(count.reason.value).toBe('timeout')
    expect(read).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    focus(); await settle()
    stall.complete({ hundred: 10, mark3: 10 }); await settle()
    expect(count.snapshot.value?.total).toBe(12)
  })
  it('reuses a recent sample after reconnect unless an off-page settlement invalidated it while offline', async () => {
    await shell()
    const invalidate = count.captureInvalidation()
    available.value = false; await settle()
    expect(count.status.value).toBe('unknown')
    available.value = true; await settle()
    expect(read).toHaveBeenCalledTimes(1)
    expect(count.status.value).toBe('ready')
    available.value = false; await settle()
    invalidate()
    read.mockResolvedValueOnce({ hundred: 3, mark3: 2 })
    available.value = true; await settle()
    expect(read).toHaveBeenCalledTimes(2)
    expect(count.snapshot.value?.total).toBe(5)
  })
  it('disposes an in-flight read and discards queued work from a settled moderation action', async () => {
    const unfinished = deferred()
    read.mockReturnValueOnce(unfinished.value)
    await shell()
    const signal = read.mock.calls[0][0]
    const settled = count.captureInvalidation()
    settled()
    stop()
    expect(signal.aborted).toBe(true)
    unfinished.complete({ hundred: 35, mark3: 25 })
    vi.advanceTimersByTime(60_000)
    focus(); settled(); await settle()
    expect(count.status.value).toBe('hidden')
    expect(count.snapshot.value).toBeNull()
    expect(read).toHaveBeenCalledTimes(1)
  })
})
