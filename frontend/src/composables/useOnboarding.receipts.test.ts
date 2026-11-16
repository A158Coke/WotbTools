// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { REPLACE_DECLINED } from '../shared/onboarding.js'
import { ONBOARDING_STORAGE_KEY, mergeOnboardingReceipts, shouldOfferOnboarding, validOnboardingReceipt } from './useOnboarding.js'
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

const { harness, cache, account } = createOnboardingTestHelpers(boundary)
beforeEach(() => resetOnboardingTestBoundary(boundary))

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

  it('ends the guide without an error when the user keeps their replay in the replace confirmation', async () => {
    const h = harness({ files: true })
    h.loadDemo.mockRejectedValueOnce(Object.assign(new Error('declined'), { name: REPLACE_DECLINED }))
    h.controller.start()
    await h.controller.begin()
    expect(h.controller.mode.value).toBe('idle')
    expect(h.controller.issue.value).not.toBe('unavailable')
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
