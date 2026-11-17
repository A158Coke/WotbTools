// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
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

const { harness, cache, account } = createOnboardingTestHelpers(boundary)
beforeEach(() => resetOnboardingTestBoundary(boundary))

describe('login continuity (#670)', () => {
  function pending() {
    return JSON.parse(sessionStorage.getItem(ONBOARDING_PENDING_LOGIN_KEY) || 'null')
  }
  function pendingGuide() {
    return pending()?.guide
  }
  function authenticatedWithoutClaims() {
    boundary.epoch++
    boundary.auth.authenticated.value = true
    boundary.auth.tokenParsed.value = null
    boundary.auth.authInitState.value = 'authenticated'
  }

  it('resumes the AI guide at its first lesson after a successful web redirect', async () => {
    boundary.auth.login.mockImplementation(() => { boundary.auth.loginInFlight.value = true })
    const guest = harness()
    guest.controller.start('ai')
    guest.controller.loginAiGuide()
    expect(guest.controller.mode.value).toBe('idle')
    expect(pendingGuide()).toEqual(expect.objectContaining({ topic: 'ai', index: 0, stageIndex: 0 }))
    // Full-document redirect: the next document starts with no login in flight.
    guest.wrapper.unmount()
    boundary.auth.loginInFlight.value = false

    account('A')
    const resumed = harness()
    await flushPromises()
    await flushPromises()
    expect(resumed.controller.mode.value).toBe('tour')
    expect(resumed.controller.topic.value).toBe('ai')
    expect(resumed.controller.index.value).toBe(0)
    expect(resumed.loadDemo).toHaveBeenCalledTimes(1)
    expect(resumed.setCapability).toHaveBeenCalledWith('ai')
    expect(pending()).toBeNull()
    resumed.wrapper.unmount()

    // One-shot: a reload without a new login never reopens the guide.
    const nextPage = harness()
    await flushPromises()
    expect(nextPage.controller.mode.value).not.toBe('tour')
    expect(nextPage.loadDemo).not.toHaveBeenCalled()
    nextPage.wrapper.unmount()
  })

  it('restores the account settings lesson at the step where login was clicked', async () => {
    const guest = harness({ view: 'more' })
    guest.controller.start('settings')
    await guest.controller.begin()
    guest.controller.next(); await flushPromises()
    guest.controller.next(); await flushPromises()
    expect(guest.controller.index.value).toBe(2)
    expect(guest.controller.currentStage.value.anchor).toBe('settings-account')
    boundary.auth.loginInFlight.value = true
    expect(pendingGuide()).toEqual(expect.objectContaining({ topic: 'settings', index: 2, stageIndex: 0 }))
    guest.wrapper.unmount()
    boundary.auth.loginInFlight.value = false

    account('A')
    const resumed = harness({ view: 'profile' })
    await flushPromises()
    expect(resumed.controller.mode.value).toBe('tour')
    expect(resumed.controller.topic.value).toBe('settings')
    expect(resumed.controller.index.value).toBe(2)
    expect(resumed.controller.currentStage.value.anchor).toBe('settings-account')
    expect(pending()).toBeNull()
    resumed.wrapper.unmount()
  })

  it('keeps the Android in-place continuation across the login RPC and resumes on the late auth callback', async () => {
    const h = harness({ view: 'more' })
    h.controller.start('settings')
    await h.controller.begin()
    h.controller.next(); await flushPromises()
    h.controller.next(); await flushPromises()
    expect(h.controller.index.value).toBe(2)
    boundary.auth.loginInFlight.value = true
    expect(pendingGuide()).toEqual(expect.objectContaining({ topic: 'settings', index: 2, stageIndex: 0 }))

    // Android native login RPC returns before the external user-agent authenticates.
    boundary.auth.loginInFlight.value = false
    await nextTick()
    await nextTick()
    expect(pendingGuide()).toEqual(expect.objectContaining({ topic: 'settings', index: 2, stageIndex: 0 }))
    expect(h.controller.mode.value).toBe('tour')

    // wotbtoolsOnAuthChanged pushes the authenticated session later.
    account('A')
    await flushPromises()
    expect(h.controller.mode.value).toBe('tour')
    expect(h.controller.topic.value).toBe('settings')
    expect(h.controller.index.value).toBe(2)
    expect(h.controller.currentStage.value.anchor).toBe('settings-account')
    expect(pending()).toBeNull()
    h.controller.interrupt()
    h.wrapper.unmount()

    const reopened = harness({ view: 'profile' })
    await flushPromises()
    expect(reopened.controller.mode.value).not.toBe('tour')
    reopened.wrapper.unmount()
  })

  it('discards a canceled web redirect continuation on the fresh document', async () => {
    const guest = harness({ view: 'more' })
    guest.controller.start('settings')
    await guest.controller.begin()
    boundary.auth.loginInFlight.value = true
    expect(pendingGuide()).toEqual(expect.objectContaining({ topic: 'settings', index: 0, stageIndex: 0 }))
    guest.wrapper.unmount()

    // Page B: full reload, auth init settles unauthenticated because Keycloak was canceled.
    boundary.auth.loginInFlight.value = false
    const canceled = harness({ view: 'profile' })
    await flushPromises()
    expect(canceled.controller.mode.value).toBe('idle')
    expect(pendingGuide()).toBeUndefined()
    expect(pending()).toBeNull()
    canceled.wrapper.unmount()
  })

  it('never lets an unrelated login inherit a canceled guide continuation', async () => {
    sessionStorage.setItem(ONBOARDING_PENDING_LOGIN_KEY, JSON.stringify({ requestedAt: Date.now(),
      guide: { topic: 'settings', index: 2, stageIndex: 0 } }))
    const canceled = harness({ view: 'profile' })
    await flushPromises()
    expect(pendingGuide()).toBeUndefined()
    expect(pending()).toBeNull()

    // Ordinary profile login: it must not resurrect the abandoned lesson.
    boundary.auth.loginInFlight.value = true
    expect(pendingGuide()).toBeUndefined()
    expect(pending()).toBeNull()
    account('A')
    await flushPromises()
    expect(canceled.controller.mode.value).not.toBe('tour')
    canceled.wrapper.unmount()
  })

  it('still migrates the anonymous terminal receipt after a canceled guide redirect', async () => {
    const guest = harness()
    guest.controller.start()
    guest.controller.skip()
    guest.controller.start('settings')
    await guest.controller.begin()
    boundary.auth.loginInFlight.value = true
    expect(pendingGuide()).toEqual(expect.objectContaining({ topic: 'settings', index: 0, stageIndex: 0 }))
    expect(pending()?.receipt).toEqual({ coreEpoch: 1, disposition: 'SKIPPED' })
    guest.wrapper.unmount()

    // Canceled redirect: only the guide is discarded; the receipt contract survives.
    boundary.auth.loginInFlight.value = false
    const canceled = harness({ view: 'profile' })
    await flushPromises()
    expect(pendingGuide()).toBeUndefined()
    expect(pending()?.receipt).toEqual({ coreEpoch: 1, disposition: 'SKIPPED' })

    boundary.auth.loginInFlight.value = true
    account('A')
    await flushPromises()
    expect(cache()['sub:A']).toEqual({ coreEpoch: 1, disposition: 'SKIPPED' })
    expect(cache().anonymous.migrationConsumed).toBe(true)
    expect(pending()).toBeNull()
    expect(canceled.controller.mode.value).not.toBe('tour')
    canceled.wrapper.unmount()
  })

  it('drops a stale continuation when an unrelated login starts on the same document', async () => {
    const h = harness({ view: 'more' })
    h.controller.start('settings')
    await h.controller.begin()
    boundary.auth.loginInFlight.value = true
    expect(pendingGuide()).toEqual(expect.objectContaining({ topic: 'settings', index: 0, stageIndex: 0 }))
    boundary.auth.loginInFlight.value = false
    h.controller.interrupt()
    boundary.auth.loginInFlight.value = true
    expect(pendingGuide()).toBeUndefined()
    account('A')
    await flushPromises()
    expect(h.controller.mode.value).not.toBe('tour')
    h.wrapper.unmount()
  })

  it('keeps a boot continuation while auth init is still initializing', async () => {
    sessionStorage.setItem(ONBOARDING_PENDING_LOGIN_KEY, JSON.stringify({ requestedAt: Date.now(),
      guide: { topic: 'settings', index: 0, stageIndex: 0 } }))
    boundary.auth.authInitState.value = 'initializing'
    const h = harness({ view: 'more' })
    await flushPromises()
    expect(pendingGuide()).toEqual(expect.objectContaining({ topic: 'settings', index: 0, stageIndex: 0 }))
    expect(h.controller.mode.value).toBe('idle')
    account('A')
    await flushPromises()
    expect(h.controller.mode.value).toBe('tour')
    expect(h.controller.topic.value).toBe('settings')
    expect(pending()).toBeNull()
    h.wrapper.unmount()
  })

  it('ignores an expired continuation', async () => {
    sessionStorage.setItem(ONBOARDING_PENDING_LOGIN_KEY, JSON.stringify({
      requestedAt: Date.now() - 31 * 60 * 1000,
      guide: { topic: 'settings', index: 2, stageIndex: 0 },
    }))
    account('A')
    const h = harness({ view: 'profile' })
    await flushPromises()
    expect(h.controller.mode.value).toBe('idle')
    expect(sessionStorage.getItem(ONBOARDING_PENDING_LOGIN_KEY)).toBeNull()
    h.wrapper.unmount()
  })

  it('does not resurrect a skipped guide when the late auth callback arrives', async () => {
    const h = harness({ view: 'more' })
    h.controller.start('settings')
    await h.controller.begin()
    h.controller.next(); await flushPromises()
    h.controller.next(); await flushPromises()
    boundary.auth.loginInFlight.value = true
    expect(pendingGuide()).toEqual(expect.objectContaining({ topic: 'settings', index: 2, stageIndex: 0 }))
    boundary.auth.loginInFlight.value = false
    h.controller.skip()
    expect(pendingGuide()).toBeUndefined()

    account('A')
    await flushPromises()
    expect(h.controller.mode.value).not.toBe('tour')
    expect(pending()).toBeNull()
    h.wrapper.unmount()
  })

  it('does not resurrect an abandoned AI login when the user starts another guide', async () => {
    boundary.auth.login.mockImplementation(() => { boundary.auth.loginInFlight.value = true })
    const h = harness()
    h.controller.start('ai')
    await h.controller.begin()
    h.controller.loginAiGuide()
    expect(pendingGuide()).toEqual(expect.objectContaining({ topic: 'ai', index: 0, stageIndex: 0 }))
    boundary.auth.loginInFlight.value = false
    h.controller.start('hof')
    expect(pendingGuide()).toBeUndefined()

    account('A')
    await flushPromises()
    expect(h.controller.mode.value).not.toBe('tour')
    expect(h.loadDemo).not.toHaveBeenCalled()
    expect(h.route.value).not.toBe('ai-review')
    h.wrapper.unmount()
  })

  it('withdraws the continuation when the user opens the directory or finishes', async () => {
    const directory = harness({ view: 'more' })
    directory.controller.start('settings')
    await directory.controller.begin()
    boundary.auth.loginInFlight.value = true
    expect(pendingGuide()).not.toBeUndefined()
    boundary.auth.loginInFlight.value = false
    directory.controller.openDirectory()
    expect(pendingGuide()).toBeUndefined()
    account('A')
    await flushPromises()
    expect(directory.controller.mode.value).not.toBe('tour')
    directory.wrapper.unmount()

    account(null)
    const finished = harness({ view: 'more' })
    finished.controller.start('settings')
    await finished.controller.begin()
    boundary.auth.loginInFlight.value = true
    boundary.auth.loginInFlight.value = false
    finished.controller.next(); await flushPromises()
    finished.controller.next(); await flushPromises()
    expect(finished.controller.index.value).toBe(2)
    expect(pendingGuide()).not.toBeUndefined()
    finished.controller.next()
    expect(finished.controller.mode.value).toBe('finish')
    expect(pendingGuide()).toBeUndefined()
    account('A')
    await flushPromises()
    expect(finished.controller.mode.value).not.toBe('tour')
    finished.wrapper.unmount()
  })

  it('refuses a same-document continuation older than the 30-minute TTL', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-18T18:00:00Z'))
      // A terminal receipt from an earlier document: only the pending marker can migrate it.
      localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ version: 1, receipts: {
        anonymous: { coreEpoch: 1, disposition: 'SKIPPED' },
      } }))
      const h = harness({ view: 'more' })
      h.controller.start('settings')
      await h.controller.begin()
      h.controller.next(); await flushPromises()
      h.controller.next(); await flushPromises()
      boundary.auth.loginInFlight.value = true
      expect(pending()?.receipt).toEqual({ coreEpoch: 1, disposition: 'SKIPPED' })
      boundary.auth.loginInFlight.value = false
      vi.setSystemTime(new Date('2026-10-18T18:31:00Z'))

      account('A')
      await flushPromises()
      expect(h.controller.mode.value).not.toBe('tour')
      expect(pending()).toBeNull()
      expect(cache().anonymous.migrationConsumed).toBeUndefined()
      expect(boundary.save).not.toHaveBeenCalled()
      expect(cache()['sub:A']).toEqual({ coreEpoch: 0, disposition: 'NONE' })
      h.wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('still resumes and migrates inside the 30-minute window', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-18T18:00:00Z'))
      localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ version: 1, receipts: {
        anonymous: { coreEpoch: 1, disposition: 'SKIPPED' },
      } }))
      const h = harness({ view: 'more' })
      h.controller.start('settings')
      await h.controller.begin()
      h.controller.next(); await flushPromises()
      h.controller.next(); await flushPromises()
      boundary.auth.loginInFlight.value = true
      boundary.auth.loginInFlight.value = false
      vi.setSystemTime(new Date('2026-10-18T18:29:59Z'))

      account('A')
      await flushPromises()
      expect(h.controller.mode.value).toBe('tour')
      expect(h.controller.index.value).toBe(2)
      expect(pending()).toBeNull()
      expect(cache()['sub:A']).toEqual({ coreEpoch: 1, disposition: 'SKIPPED' })
      expect(cache().anonymous.migrationConsumed).toBe(true)
      h.wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('resumes the guide from a confirmed session before claims/sub are available', async () => {
    sessionStorage.setItem(ONBOARDING_PENDING_LOGIN_KEY, JSON.stringify({ requestedAt: Date.now(),
      guide: { topic: 'settings', index: 2, stageIndex: 0 } }))
    authenticatedWithoutClaims()
    const h = harness({ view: 'profile' })
    await flushPromises()
    expect(h.controller.mode.value).toBe('tour')
    expect(h.controller.topic.value).toBe('settings')
    expect(h.controller.index.value).toBe(2)
    expect(h.controller.currentStage.value.anchor).toBe('settings-account')
    expect(pending()).toBeNull()
    expect(cache()['unknown-account']).toBeUndefined()
    h.wrapper.unmount()
  })

  it('keeps an account receipt pending until a stable sub exists', async () => {
    const guest = harness()
    guest.controller.start()
    guest.controller.skip()
    guest.controller.start('settings')
    await guest.controller.begin()
    boundary.auth.loginInFlight.value = true
    expect(pending()?.receipt).toEqual({ coreEpoch: 1, disposition: 'SKIPPED' })
    guest.wrapper.unmount()

    authenticatedWithoutClaims()
    const resumed = harness({ view: 'profile' })
    await flushPromises()
    expect(resumed.controller.mode.value).toBe('tour')
    expect(pending()?.guide).toBeUndefined()
    expect(pending()?.receipt).toEqual({ coreEpoch: 1, disposition: 'SKIPPED' })
    expect(cache()['unknown-account']).toBeUndefined()
    expect(boundary.save).not.toHaveBeenCalled()

    account('A')
    await flushPromises()
    expect(cache()['sub:A']).toEqual({ coreEpoch: 1, disposition: 'SKIPPED' })
    expect(cache().anonymous.migrationConsumed).toBe(true)
    expect(pending()).toBeNull()
    resumed.wrapper.unmount()
  })
})
