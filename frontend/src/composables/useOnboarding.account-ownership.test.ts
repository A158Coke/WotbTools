// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { ONBOARDING_PENDING_LOGIN_KEY, ONBOARDING_STORAGE_KEY } from './useOnboarding.js'
import { createOnboardingTestHelpers, resetOnboardingTestBoundary } from './useOnboarding.testSupport.js'
import type { OnboardingTestBoundary } from './useOnboarding.testSupport.js'

const boundary = vi.hoisted(() => ({ auth: null as unknown as OnboardingTestBoundary['auth'], connectivity: null as unknown as OnboardingTestBoundary['connectivity'], bootstrap: null as unknown as OnboardingTestBoundary['bootstrap'],
  epoch: 1, read: vi.fn(), save: vi.fn(), settled: vi.fn() }))
vi.mock('./useAuth.js', () => ({ useAuth: () => boundary.auth }))
vi.mock('./useConnectivity.js', () => ({ useConnectivity: () => ({ connectivity: boundary.connectivity }) }))
vi.mock('./useBusinessUserBootstrap.js', () => ({
  useBusinessUserBootstrap: () => boundary.bootstrap,
  whenBusinessUserSettled: (...args: unknown[]) => boundary.settled(...args),
}))
vi.mock('../api/onboarding.js', () => ({ readOnboardingReceipt: (...args: unknown[]) => boundary.read(...args), saveOnboardingReceipt: (...args: unknown[]) => boundary.save(...args) }))

const { harness, cache, account, deferred } = createOnboardingTestHelpers(boundary)
beforeEach(() => resetOnboardingTestBoundary(boundary))

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

  it('a failing profile bootstrap never re-triggers itself through its own state flips', async () => {
    account('A')
    boundary.bootstrap.state = ref('idle')
    boundary.settled.mockImplementation(async () => {
      boundary.bootstrap.state.value = 'pending'
      await new Promise(resolve => setTimeout(resolve, 0))
      boundary.bootstrap.state.value = 'failed'
      return false
    })
    const h = harness({ invite: true })
    await flushPromises()
    await flushPromises()
    const calls = boundary.settled.mock.calls.length
    expect(calls).toBeGreaterThan(0)
    for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0))
    expect(boundary.settled.mock.calls.length).toBe(calls)
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

  it('expires old redirect evidence and keeps evidence until a real auth result', async () => {
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
    expect(sessionStorage.getItem(ONBOARDING_PENDING_LOGIN_KEY)).not.toBeNull()
    boundary.auth.loginInFlight.value = false
    await nextTick()
    expect(sessionStorage.getItem(ONBOARDING_PENDING_LOGIN_KEY)).not.toBeNull()
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
