// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuthState, getBootstrapApi, getMountedWrappers, setAuthState, mountApp, settle } from '../test/AppTestHelpers.js'
import { resetBusinessUserBootstrap } from '../composables/useBusinessUserBootstrap.js'
import { nextTick } from 'vue'

const authState = getAuthState()
const bootstrapApi = getBootstrapApi()
const mountedWrappers = getMountedWrappers()

describe('Business user bootstrap', () => {
  beforeEach(() => {
    resetBusinessUserBootstrap()
    bootstrapApi.ensureUserProfile.mockReset()
  })

  afterEach(() => {
    mountedWrappers.splice(0).forEach(wrapper => wrapper.unmount())
    setAuthState('unauthenticated', false)
    bootstrapApi.ensureUserProfile.mockReset()
    resetBusinessUserBootstrap()
  })

  it('ensures the profile once the user is authenticated', async () => {
    setAuthState('authenticated', true)
    bootstrapApi.ensureUserProfile.mockResolvedValue({ id: 1, keycloakUserId: 'kc-1' })

    const { wrapper } = await mountApp('/?view=replay')
    await settle()

    expect(bootstrapApi.ensureUserProfile).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="business-bootstrap-notice"]').exists()).toBe(false)
  })

  it.each([
    ['home', '/?view=home', 'view-home'],
    ['replay', '/?view=replay', 'view-replay'],
    ['hof', '/?view=hof', 'view-hof'],
  ])('self-heals on direct entry to %s without the profile page mounted', async (_name, path, testId) => {
    setAuthState('authenticated', true)
    bootstrapApi.ensureUserProfile.mockResolvedValue({ id: 1 })

    const { wrapper } = await mountApp(path)

    expect(wrapper.find(`[data-test="${testId}"]`).exists()).toBe(true)
    expect(bootstrapApi.ensureUserProfile).toHaveBeenCalledTimes(1)
  })

  it('does not call ensure while unauthenticated', async () => {
    setAuthState('unauthenticated', false)
    bootstrapApi.ensureUserProfile.mockResolvedValue({ id: 1 })

    await mountApp('/?view=replay')
    await settle()

    expect(bootstrapApi.ensureUserProfile).not.toHaveBeenCalled()
  })

  it.each(['failed', 'initializing'])('does not call ensure while auth state is %s', async state => {
    setAuthState(state, false, Promise.resolve(false))
    bootstrapApi.ensureUserProfile.mockResolvedValue({ id: 1 })

    await mountApp('/?view=replay')
    await settle()

    expect(bootstrapApi.ensureUserProfile).not.toHaveBeenCalled()
  })

  it('re-runs the canonical ensure after a watchdog-failed generation recovers as authenticated', async () => {
    setAuthState('failed', false, Promise.resolve(false))
    bootstrapApi.ensureUserProfile.mockResolvedValue({ id: 1 })

    await mountApp('/?view=replay')
    await settle()
    expect(bootstrapApi.ensureUserProfile).not.toHaveBeenCalled()

    setAuthState('authenticated', true, Promise.resolve(true))
    await nextTick()
    await settle()

    expect(bootstrapApi.ensureUserProfile).toHaveBeenCalledTimes(1)
  })

  it('re-provisions after an unauthenticated identity boundary even when the account is unchanged', async () => {
    setAuthState('authenticated', true)
    bootstrapApi.ensureUserProfile.mockResolvedValue({ id: 1 })

    await mountApp('/?view=replay')
    await settle()
    expect(bootstrapApi.ensureUserProfile).toHaveBeenCalledTimes(1)

    setAuthState('initializing', false, Promise.resolve(false))
    await nextTick()
    setAuthState('authenticated', true, Promise.resolve(true))
    await nextTick()
    await settle()

    expect(bootstrapApi.ensureUserProfile).toHaveBeenCalledTimes(2)
  })

  it('surfaces a retryable failure instead of swallowing it', async () => {
    setAuthState('authenticated', true)
    bootstrapApi.ensureUserProfile.mockRejectedValueOnce(new Error('502'))

    const { wrapper } = await mountApp('/?view=replay')
    await settle()

    const notice = wrapper.find('[data-testid="business-bootstrap-notice"]')
    expect(notice.exists()).toBe(true)
    expect(authState.authenticated).toBe(true)
  })

  it('allows a later bootstrap to succeed after a transient failure', async () => {
    setAuthState('authenticated', true)
    bootstrapApi.ensureUserProfile.mockRejectedValueOnce(new Error('502'))
    const first = await mountApp('/?view=replay')
    await settle()
    expect(first.wrapper.find('[data-testid="business-bootstrap-notice"]').exists()).toBe(true)

    bootstrapApi.ensureUserProfile.mockResolvedValue({ id: 1 })
    const second = await mountApp('/?view=replay')
    await settle()

    expect(bootstrapApi.ensureUserProfile).toHaveBeenCalledTimes(2)
    expect(second.wrapper.find('[data-testid="business-bootstrap-notice"]').exists()).toBe(false)
  })

  it('retries from the failure notice without a page refresh', async () => {
    setAuthState('authenticated', true)
    bootstrapApi.ensureUserProfile.mockRejectedValueOnce(new Error('502'))
    const { wrapper } = await mountApp('/?view=replay')
    await settle()

    bootstrapApi.ensureUserProfile.mockResolvedValue({ id: 1 })
    await wrapper.get('.business-bootstrap-retry').trigger('click')
    await settle()

    expect(bootstrapApi.ensureUserProfile).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="business-bootstrap-notice"]').exists()).toBe(false)
  })
})
