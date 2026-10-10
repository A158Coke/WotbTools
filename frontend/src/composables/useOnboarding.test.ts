// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { mergeOnboardingReceipts, ONBOARDING_PENDING_LOGIN_KEY, ONBOARDING_STORAGE_KEY, shouldOfferOnboarding, useOnboarding, validOnboardingReceipt } from './useOnboarding.js'
import type { OnboardingController } from './useOnboarding.js'

const boundary = vi.hoisted(() => ({ auth: null as any, connectivity: null as any, bootstrap: null as any,
  epoch: 1, read: vi.fn(), save: vi.fn(), settled: vi.fn() }))
vi.mock('./useAuth.js', () => ({ useAuth: () => boundary.auth }))
vi.mock('./useConnectivity.js', () => ({ useConnectivity: () => ({ connectivity: boundary.connectivity }) }))
vi.mock('./useBusinessUserBootstrap.js', () => ({
  useBusinessUserBootstrap: () => boundary.bootstrap,
  whenBusinessUserSettled: (...args: unknown[]) => boundary.settled(...args),
}))
vi.mock('../api/onboarding.js', () => ({ readOnboardingReceipt: (...args: unknown[]) => boundary.read(...args), saveOnboardingReceipt: (...args: unknown[]) => boundary.save(...args) }))

function harness({ view = 'home', invite = false, files = false } = {}) {
  const route = ref(view)
  const canInvite = ref(invite)
  const selected = ref(files)
  const revision = ref(0)
  const busy = ref(false)
  const prepare = vi.fn()
  const cleanup = vi.fn()
  let controller!: OnboardingController
  const wrapper = mount(defineComponent({ setup() {
    controller = useOnboarding({ view: route, canInvite, navigate: async view => { route.value = view } })
    return () => null
  } }))
  const loadDemo = vi.fn(async (signal?: AbortSignal) => { if (!signal?.aborted) { selected.value = true; revision.value++ } })
  const chooseOwnReplay = vi.fn()
  controller.registerWorkspace({ hasFiles: () => selected.value, busy: () => busy.value,
    selectionIdentity: () => revision.value, loadDemo, chooseOwnReplay,
    setCapability: vi.fn() })
  controller.registerSurface('playback', { ready: () => true, prepare, cleanup })
  return { controller, wrapper, route, canInvite, selected, revision, busy, loadDemo, chooseOwnReplay, prepare, cleanup }
}
function cache() { return JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) || '{"receipts":{}}').receipts }
function account(sub: string | null) {
  boundary.epoch++
  boundary.auth.authenticated.value = !!sub
  boundary.auth.tokenParsed.value = sub ? { sub } : null
  boundary.auth.authInitState.value = sub ? 'authenticated' : 'unauthenticated'
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  boundary.epoch = 1
  boundary.auth = { authenticated: ref(false), authInitState: ref('unauthenticated'), tokenParsed: ref(null), loginInFlight: ref(false), authEpoch: () => boundary.epoch }
  boundary.connectivity = ref('online')
  boundary.bootstrap = { state: ref('ready') }
  boundary.read.mockReset().mockResolvedValue({ coreEpoch: 0, disposition: 'NONE' })
  boundary.save.mockReset().mockImplementation(async receipt => receipt)
  boundary.settled.mockReset().mockResolvedValue(true)
})

describe('onboarding receipt policy', () => {
  it('uses the sample when starting or resuming with existing files', async () => {
    const h = harness({ files: true })
    h.controller.start()
    await h.controller.begin()
    expect(h.loadDemo).toHaveBeenCalledTimes(1)
    h.controller.next()
    await flushPromises()
    h.controller.interrupt()
    await h.controller.resume()
    expect(h.loadDemo).toHaveBeenCalledTimes(2)
    expect(h.controller.index.value).toBe(1)
    h.wrapper.unmount()
  })

  it('advances from the prepared sample only after its actual workspace button is used', async () => {
    const h = harness()
    h.controller.sampleOpened()
    expect(h.controller.mode.value).toBe('idle')
    h.controller.start()
    await h.controller.begin()
    expect(h.controller.index.value).toBe(0)
    h.controller.sampleOpened()
    await flushPromises()
    expect(h.controller.index.value).toBe(1)
    h.controller.sampleOpened()
    expect(h.controller.index.value).toBe(1)
    h.wrapper.unmount()
  })

  it('preserves newer epochs and same-epoch completion', () => {
    expect(mergeOnboardingReceipts({ coreEpoch: 2, disposition: 'OFFERED' }, { coreEpoch: 1, disposition: 'COMPLETED' })).toEqual({ coreEpoch: 2, disposition: 'OFFERED' })
    expect(mergeOnboardingReceipts({ coreEpoch: 1, disposition: 'COMPLETED' }, { coreEpoch: 1, disposition: 'SKIPPED' }).disposition).toBe('COMPLETED')
    expect(shouldOfferOnboarding({ coreEpoch: 1, disposition: 'OFFERED' })).toBe(false)
    expect(shouldOfferOnboarding({ coreEpoch: 1, disposition: 'COMPLETED' }, 2)).toBe(true)
    expect(validOnboardingReceipt({ coreEpoch: 0, disposition: 'OFFERED' })).toBe(false)
    expect(validOnboardingReceipt({ coreEpoch: 1, disposition: 'toString' })).toBe(false)
    expect(mergeOnboardingReceipts({ coreEpoch: 1, disposition: 'SKIPPED', migrationConsumed: true },
      { coreEpoch: 1, disposition: 'COMPLETED' }).migrationConsumed).toBe(true)
    expect(mergeOnboardingReceipts({ coreEpoch: 1, disposition: 'COMPLETED' },
      { coreEpoch: 1, disposition: 'SKIPPED', migrationConsumed: true }).migrationConsumed).toBe(true)
    expect(mergeOnboardingReceipts({ coreEpoch: 1, disposition: 'COMPLETED', migrationConsumed: true },
      { coreEpoch: 2, disposition: 'NONE' }).migrationConsumed).toBeUndefined()
  })

  it('offers once on a safe, settled signed-in home and suppresses refresh after interruption', async () => {
    account('A')
    const h = harness({ invite: true })
    await flushPromises()
    expect(h.controller.mode.value).toBe('welcome')
    expect(cache()['sub:A'].disposition).toBe('OFFERED')
    h.controller.interrupt()
    await nextTick()
    expect(h.controller.mode.value).toBe('idle')
    h.wrapper.unmount()
    const again = harness({ invite: true })
    await flushPromises()
    expect(again.controller.mode.value).toBe('idle')
    again.wrapper.unmount()
  })
  it('never automatically invites or hints anonymous users on Home, an empty replay or a deep link', async () => {
    for (const view of ['home', 'replay', 'agent-shots']) {
      const h = harness({ invite: true, view })
      await flushPromises()
      expect(h.controller.mode.value).toBe('idle')
      expect(h.controller.hintVisible.value).toBe(false)
      expect(cache().anonymous).toBeUndefined()
      h.controller.start()
      expect(h.controller.mode.value).toBe('welcome')
      h.controller.interrupt()
      h.wrapper.unmount()
      localStorage.clear()
    }
    expect(boundary.read).not.toHaveBeenCalled()
  })

  it('waits for safe home/empty replay and auth settlement', async () => {
    boundary.auth.authInitState.value = 'initializing'
    const h = harness({ invite: false, view: 'agent-shots', files: true })
    await flushPromises()
    expect(h.controller.mode.value).toBe('idle')
    account('A')
    h.route.value = 'replay'
    await flushPromises()
    expect(h.controller.mode.value).toBe('idle')
    h.selected.value = false
    h.canInvite.value = false
    await nextTick()
    expect(h.controller.mode.value).toBe('idle')
    h.canInvite.value = true
    await nextTick()
    expect(h.controller.mode.value).toBe('welcome')
    h.wrapper.unmount()
  })

  it('keeps manual restart usable and never downgrades a core terminal receipt via a directory', async () => {
    const h = harness()
    h.controller.start()
    h.controller.skip()
    expect(cache().anonymous.disposition).toBe('SKIPPED')
    h.controller.openDirectory()
    h.controller.start('settings')
    await h.controller.begin()
    for (let i = 0; i < 3; i++) { h.controller.next(); await flushPromises() }
    expect(h.controller.mode.value).toBe('finish')
    expect(cache().anonymous.disposition).toBe('SKIPPED')
    h.controller.start()
    expect(h.controller.mode.value).toBe('welcome')
    h.wrapper.unmount()
  })
  it('defers a signed-in invitation during parsing or fullscreen until a safe visit', async () => {
    account('A')
    const h = harness({ invite: false })
    h.busy.value = true
    h.canInvite.value = true
    await flushPromises()
    expect(h.controller.mode.value).toBe('idle')
    expect(cache()['sub:A'].disposition).toBe('NONE')
    const descriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.body })
    h.busy.value = false
    await nextTick()
    expect(h.controller.mode.value).toBe('idle')
    if (descriptor) Object.defineProperty(document, 'fullscreenElement', descriptor)
    else delete (document as any).fullscreenElement
    h.route.value = 'replay'
    await nextTick()
    expect(h.controller.mode.value).toBe('welcome')
    h.wrapper.unmount()
  })
  it('offers a quiet, dismissible guide hint on deep links without taking over the page', async () => {
    account('A')
    const h = harness({ invite: true, view: 'agent-shots', files: true })
    await flushPromises()
    expect(h.controller.mode.value).toBe('idle')
    expect(h.controller.hintVisible.value).toBe(true)
    expect(cache()['sub:A'].disposition).toBe('OFFERED')
    h.controller.dismissHint()
    h.route.value = 'home'
    await nextTick()
    expect(h.controller.mode.value).toBe('idle')
    h.wrapper.unmount()
  })

  it('suppresses repeat invitations in memory when persistent storage is unavailable', async () => {
    const fail = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('disabled') })
    const h = harness({ invite: true })
    await flushPromises()
    h.controller.start()
    h.controller.skip()
    await flushPromises()
    expect(h.controller.mode.value).toBe('idle')
    h.route.value = 'replay'
    await nextTick()
    expect(h.controller.mode.value).toBe('idle')
    h.wrapper.unmount()
    fail.mockRestore()
  })

  it('closes a pending invitation after another tab records the same epoch', async () => {
    const h = harness({ invite: true })
    await flushPromises()
    h.controller.start()
    const value = JSON.stringify({ version: 1, receipts: { anonymous: { coreEpoch: 1, disposition: 'COMPLETED' } } })
    localStorage.setItem(ONBOARDING_STORAGE_KEY, value)
    window.dispatchEvent(new StorageEvent('storage', { key: ONBOARDING_STORAGE_KEY, newValue: value }))
    await nextTick()
    expect(h.controller.mode.value).toBe('idle')
    h.wrapper.unmount()
  })
})

describe('account receipt ownership', () => {
  it('does not invite on read/bootstrap failure or call the backend while offline', async () => {
    account('A')
    boundary.read.mockRejectedValue(new Error('server unavailable'))
    const h = harness({ invite: true })
    await flushPromises()
    expect(h.controller.mode.value).toBe('idle')
    expect(boundary.read).toHaveBeenCalledTimes(1)
    boundary.connectivity.value = 'offline'
    await flushPromises()
    expect(boundary.read).toHaveBeenCalledTimes(1)
    h.controller.start()
    expect(h.controller.mode.value).toBe('welcome')
    h.wrapper.unmount()
  })
  it('never reads an account receipt before its gated bootstrap succeeds', async () => {
    account('A')
    boundary.settled.mockResolvedValue(false)
    const h = harness({ invite: true })
    await flushPromises()
    expect(boundary.read).not.toHaveBeenCalled()
    expect(h.controller.mode.value).toBe('idle')
    h.wrapper.unmount()
  })

  it('discards a late A-account read after B signs in', async () => {
    account('A')
    const a = deferred<any>(), b = deferred<any>()
    boundary.read.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const h = harness({ invite: true })
    await flushPromises()
    account('B')
    await flushPromises()
    b.resolve({ coreEpoch: 0, disposition: 'NONE' })
    await flushPromises()
    expect(h.controller.mode.value).toBe('welcome')
    a.resolve({ coreEpoch: 4, disposition: 'COMPLETED' })
    await flushPromises()
    expect(cache()['sub:B']).toEqual({ coreEpoch: 1, disposition: 'OFFERED' })
    expect(cache()['sub:A']).toBeUndefined()
    h.wrapper.unmount()
  })

  it('migrates a just-recorded anonymous terminal only to the first explicit login, never from A to B', async () => {
    const h = harness()
    h.controller.start()
    h.controller.skip()
    boundary.auth.loginInFlight.value = true
    account('A')
    await flushPromises()
    boundary.auth.loginInFlight.value = false
    expect(boundary.save).toHaveBeenCalledWith({ coreEpoch: 1, disposition: 'SKIPPED' }, expect.any(AbortSignal))
    account(null)
    await flushPromises()
    account('B')
    await flushPromises()
    expect(cache()['sub:B']).toEqual({ coreEpoch: 0, disposition: 'NONE' })
    expect(boundary.save).toHaveBeenCalledTimes(1)
    h.wrapper.unmount()
  })

  it('does not migrate an anonymous receipt during silent authentication', async () => {
    const h = harness()
    h.controller.start()
    h.controller.skip()
    account('A')
    await flushPromises()
    expect(boundary.save).not.toHaveBeenCalled()
    expect(cache()['sub:A']).toEqual({ coreEpoch: 0, disposition: 'NONE' })
    h.wrapper.unmount()
  })
  it('does not transfer a stale anonymous closure after another tab consumed that epoch', async () => {
    const h = harness()
    h.controller.start()
    h.controller.skip()
    const consumed = JSON.stringify({ version: 1, receipts: {
      anonymous: { coreEpoch: 1, disposition: 'SKIPPED', migrationConsumed: true },
    } })
    localStorage.setItem(ONBOARDING_STORAGE_KEY, consumed)
    window.dispatchEvent(new StorageEvent('storage', { key: ONBOARDING_STORAGE_KEY, newValue: consumed }))
    await nextTick()
    boundary.auth.loginInFlight.value = true
    account('B')
    await flushPromises()
    expect(boundary.save).not.toHaveBeenCalled()
    expect(cache()['sub:B']).toEqual({ coreEpoch: 0, disposition: 'NONE' })
    h.wrapper.unmount()
  })
  it('writes explicit-login evidence synchronously before redirect, consumes it once after reload, and never copies it to B', async () => {
    const guest = harness()
    guest.controller.start()
    guest.controller.skip()
    boundary.auth.loginInFlight.value = true
    expect(sessionStorage.getItem(ONBOARDING_PENDING_LOGIN_KEY)).not.toBeNull()
    guest.wrapper.unmount()
    account('A')
    boundary.auth.loginInFlight.value = false
    const loggedIn = harness()
    await flushPromises()
    expect(cache()['sub:A']).toEqual({ coreEpoch: 1, disposition: 'SKIPPED' })
    expect(cache().anonymous.migrationConsumed).toBe(true)
    expect(sessionStorage.getItem(ONBOARDING_PENDING_LOGIN_KEY)).toBeNull()
    account(null)
    await flushPromises()
    boundary.auth.loginInFlight.value = true
    expect(sessionStorage.getItem(ONBOARDING_PENDING_LOGIN_KEY)).toBeNull()
    account('B')
    await flushPromises()
    expect(cache()['sub:B']).toEqual({ coreEpoch: 0, disposition: 'NONE' })
    expect(boundary.save).toHaveBeenCalledTimes(1)
    loggedIn.wrapper.unmount()
  })
  it('checks the latest disk consumption before a login callback, even without its storage event', async () => {
    const h = harness()
    h.controller.start()
    h.controller.skip()
    boundary.auth.loginInFlight.value = true
    expect(sessionStorage.getItem(ONBOARDING_PENDING_LOGIN_KEY)).not.toBeNull()
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ version: 1, receipts: {
      anonymous: { coreEpoch: 1, disposition: 'SKIPPED', migrationConsumed: true },
    } }))
    account('B')
    await flushPromises()
    expect(boundary.save).not.toHaveBeenCalled()
    expect(cache()['sub:B']).toEqual({ coreEpoch: 0, disposition: 'NONE' })
    expect(sessionStorage.getItem(ONBOARDING_PENDING_LOGIN_KEY)).toBeNull()
    h.wrapper.unmount()
  })

  it('expires old redirect evidence and clears a canceled explicit login', async () => {
    sessionStorage.setItem(ONBOARDING_PENDING_LOGIN_KEY, JSON.stringify({ requestedAt: Date.now() - 31 * 60 * 1000,
      receipt: { coreEpoch: 1, disposition: 'SKIPPED' } }))
    account('A')
    const h = harness()
    await flushPromises()
    expect(boundary.save).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(ONBOARDING_PENDING_LOGIN_KEY)).toBeNull()
    h.wrapper.unmount()
    account(null)
    const guest = harness()
    guest.controller.start()
    guest.controller.skip()
    boundary.auth.loginInFlight.value = true
    boundary.auth.loginInFlight.value = false
    await nextTick()
    expect(sessionStorage.getItem(ONBOARDING_PENDING_LOGIN_KEY)).toBeNull()
    guest.wrapper.unmount()
  })

  it('syncs an offline account terminal once profile access becomes available', async () => {
    account('A')
    boundary.connectivity.value = 'offline'
    const h = harness()
    h.controller.start()
    h.controller.skip()
    await flushPromises()
    expect(boundary.read).not.toHaveBeenCalled()
    boundary.connectivity.value = 'online'
    await flushPromises()
    expect(boundary.save).toHaveBeenCalledWith({ coreEpoch: 1, disposition: 'SKIPPED' }, expect.any(AbortSignal))
    h.wrapper.unmount()
  })
  it('ignores a late A-account save after the account changes', async () => {
    account('A')
    const saving = deferred<any>()
    boundary.save.mockReturnValue(saving.promise)
    const h = harness()
    await flushPromises()
    h.controller.start()
    h.controller.skip()
    await flushPromises()
    account('B')
    await flushPromises()
    saving.resolve({ coreEpoch: 5, disposition: 'COMPLETED' })
    await flushPromises()
    expect(cache()['sub:A']).toEqual({ coreEpoch: 1, disposition: 'SKIPPED' })
    expect(cache()['sub:B']).toEqual({ coreEpoch: 0, disposition: 'NONE' })
    h.wrapper.unmount()
  })
})

describe('real lesson lifecycle', () => {
  it('ignores a late Back action after an external interruption', async () => {
    const h = harness()
    h.controller.start()
    await h.controller.begin()
    h.controller.next()
    await flushPromises()
    h.controller.interrupt()
    h.route.value = 'hof'
    h.controller.back()
    await flushPromises()
    expect(h.controller.index.value).toBe(1)
    expect(h.route.value).toBe('hof')
    expect(h.controller.mode.value).toBe('idle')
    h.wrapper.unmount()
  })
  it('opens the original workspace picker after completion without downgrading its receipt', async () => {
    const h = harness()
    h.controller.start()
    await h.controller.begin()
    for (let i = 0; i < 7; i++) { h.controller.next(); await flushPromises() }
    h.route.value = 'agent-armor'
    await h.controller.useOwnReplay()
    expect(h.route.value).toBe('replay')
    expect(h.chooseOwnReplay).toHaveBeenCalledTimes(1)
    expect(h.cleanup).toHaveBeenCalled()
    expect(h.controller.mode.value).toBe('idle')
    expect(cache().anonymous.disposition).toBe('COMPLETED')
    h.wrapper.unmount()
  })

  it('cancels a pending picker handoff when another guide takes over', async () => {
    const h = harness()
    h.controller.registerWorkspace(null)
    const handoff = h.controller.useOwnReplay()
    await flushPromises()
    h.controller.start('settings')
    await handoff
    expect(h.chooseOwnReplay).not.toHaveBeenCalled()
    expect(h.controller.mode.value).toBe('welcome')
    h.wrapper.unmount()
  })
  it('navigates a cached workspace owner back to its actual page before beginning on Home', async () => {
    const h = harness({ view: 'home', files: true })
    h.controller.start()
    await h.controller.begin(false)
    expect(h.route.value).toBe('replay')
    expect(h.controller.mode.value).toBe('tour')
    h.wrapper.unmount()
  })
  it('records completion only when the core guide reaches its last explicit Next', async () => {
    const h = harness()
    h.controller.start()
    await h.controller.begin()
    for (let i = 0; i < 6; i++) { h.controller.next(); await flushPromises() }
    expect(cache().anonymous.disposition).toBe('OFFERED')
    h.controller.next()
    expect(h.controller.mode.value).toBe('finish')
    expect(cache().anonymous).toEqual({ coreEpoch: 1, disposition: 'COMPLETED' })
    expect(boundary.save).not.toHaveBeenCalled()
    h.wrapper.unmount()
  })
  it('keeps the interrupted core node locally and resumes it from the manual welcome', async () => {
    const h = harness()
    h.controller.start()
    await h.controller.begin()
    for (let i = 0; i < 4; i++) { h.controller.next(); await flushPromises() }
    h.controller.interrupt()
    expect(cache().anonymous.coreStep).toBe(4)
    h.controller.start()
    expect(h.controller.canResume.value).toBe(true)
    await h.controller.resume()
    expect(h.controller.index.value).toBe(4)
    expect(h.controller.currentStage.value.anchor).toBe('playback-declutter')
    h.controller.skip()
    h.controller.start()
    expect(h.controller.canResume.value).toBe(false)
    h.wrapper.unmount()
  })
  it('passes cancellation to sample loading and ignores its late continuation after Next', async () => {
    const h = harness()
    const pending = deferred<void>()
    h.loadDemo.mockImplementation(() => pending.promise)
    h.controller.start()
    const beginning = h.controller.begin()
    await flushPromises()
    const signal = h.loadDemo.mock.calls[0][0]
    expect(signal).toBeInstanceOf(AbortSignal)
    h.controller.next()
    expect(signal?.aborted).toBe(true)
    pending.resolve()
    await beginning
    await flushPromises()
    expect(h.controller.index.value).toBe(1)
    expect(h.controller.currentStage.value.anchor).toBe('data-toolbar')
    h.wrapper.unmount()
  })

  it('accepts its own demo selection change but interrupts an outside replacement without marking completion', async () => {
    const h = harness()
    h.controller.start()
    await h.controller.begin()
    expect(h.controller.mode.value).toBe('tour')
    expect(h.loadDemo).toHaveBeenCalledTimes(1)
    h.revision.value++
    await nextTick()
    expect(h.controller.mode.value).toBe('idle')
    expect(cache().anonymous.disposition).toBe('OFFERED')
    h.wrapper.unmount()
  })

  it('advances 3D only on real readiness and lets Next bypass unsupported scenes', async () => {
    const h = harness({ files: true })
    const ready = ref(false), failed = ref(false)
    const startScene = vi.fn()
    h.controller.registerSurface('3d', { ready: () => ready.value, failed: () => failed.value, prepare: startScene })
    h.controller.start('3d')
    await h.controller.begin(false)
    expect(h.controller.currentStage.value.anchor).toBe('replay3d-start')
    expect(startScene).not.toHaveBeenCalled()
    ready.value = true
    await nextTick()
    expect(h.controller.currentStage.value.anchor).toBe('replay3d-camera')
    failed.value = true
    await nextTick()
    expect(h.controller.issue.value).toBe('unavailable')
    h.controller.next()
    await flushPromises()
    expect(h.controller.index.value).toBe(1)
    h.wrapper.unmount()
  })

  it('cleans a canceled surface wait so a late ready signal never runs its command', async () => {
    const h = harness({ files: true })
    const ready = ref(false), prepare = vi.fn()
    h.controller.registerSurface('playback', { ready: () => ready.value, prepare })
    h.controller.start('playback')
    const beginning = h.controller.begin(false)
    await flushPromises()
    h.controller.next()
    ready.value = true
    await beginning
    await flushPromises()
    expect(prepare).not.toHaveBeenCalled()
    expect(h.controller.currentStage.value.anchor).toBe('playback-timeline')
    h.wrapper.unmount()
  })

  it('returns to the real shot row after its inspector closes, without a synthetic click', async () => {
    const h = harness({ files: true })
    const selected = ref(false)
    h.controller.registerSurface('shots', { ready: () => selected.value })
    h.controller.start()
    await h.controller.begin(false)
    for (let i = 0; i < 6; i++) { h.controller.next(); await flushPromises() }
    selected.value = true
    await nextTick()
    expect(h.controller.currentStage.value.anchor).toBe('shot-open-viewer')
    selected.value = false
    await nextTick()
    expect(h.controller.currentStage.value.anchor).toBe('shots-first-shot')
    h.wrapper.unmount()
  })
  it('advances the optional shot guide from real row selection to the real armor handoff', async () => {
    const h = harness({ files: true })
    const selected = ref(false), armor = ref(false)
    h.controller.registerSurface('shots', { ready: () => selected.value })
    h.controller.registerSurface('armor', { ready: () => armor.value })
    h.controller.start('shots')
    await h.controller.begin(false)
    selected.value = true
    await flushPromises()
    expect(h.controller.index.value).toBe(1)
    expect(h.controller.currentStage.value.anchor).toBe('shot-open-viewer')
    h.route.value = 'agent-armor'
    armor.value = true
    await flushPromises()
    expect(h.controller.index.value).toBe(2)
    expect(h.controller.currentStage.value.anchor).toBe('armor-workspace')
    expect(h.controller.mode.value).toBe('tour')
    h.wrapper.unmount()
  })
})
