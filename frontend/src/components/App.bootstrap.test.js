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
    // bootstrap 状态是模块级的（一个 SPA 一份），必须逐用例重置，否则前一个用例的 ready
    // 会让后一个用例短路。
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
    // 页面级 provisioning 已收敛：即便没挂载 ProfilePage 也必须 ensure。
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
    // Generation 1's watchdog has already settled the public init promise as failed.
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
    // 失败不改变认证状态：用户仍然处于已登录的 SPA 中。
    expect(authState.authenticated).toBe(true)
  })

  it('allows a later bootstrap to succeed after a transient failure', async () => {
    setAuthState('authenticated', true)
    // 第一次 bootstrap：transient 5xx。
    bootstrapApi.ensureUserProfile.mockRejectedValueOnce(new Error('502'))
    const first = await mountApp('/?view=replay')
    await settle()
    expect(first.wrapper.find('[data-testid="business-bootstrap-notice"]').exists()).toBe(true)

    // 用户刷新 / 重新挂载：同一个 rejected Promise 绝不能锁死后续 ensure。
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
