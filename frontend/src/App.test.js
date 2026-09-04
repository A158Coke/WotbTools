// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { nextTick, inject } from 'vue'
import App from './App.vue'
import { NAVIGATE_VIEW_KEY } from './app/context.js'
import { createAppRouter } from './app/router.js'
import { setUiProfile } from './composables/useUiProfile.js'

const mountedWrappers = []

vi.mock('./components/ReplayWorkspace.vue', () => ({
  default: {
    name: 'ReplayWorkspace',
    props: ['initialCapability'],
    setup() { return { navigate: inject(NAVIGATE_VIEW_KEY) } },
    template: `<div :data-cap="initialCapability" data-test="view-replay"><button data-testid="ws-tab" @click="navigate('ai-review')">ai</button></div>`,
  },
}))
vi.mock('./components/HomePage.vue', () => ({ default: { template: '<div data-test="view-home" />' } }))
vi.mock('./components/HoFPage.vue', () => ({ default: { template: '<div data-test="view-hof" />' } }))
vi.mock('./components/AndroidDownloadPage.vue', () => ({ default: { template: '<div data-test="view-android" />' } }))

const authState = vi.hoisted(() => ({
  authenticated: false,
  username: '',
  login: vi.fn(),
  logout: vi.fn(),
  hasRole: vi.fn(() => false),
}))
vi.mock('./composables/useAuth.js', () => ({
  useAuth: () => ({
    initPromise: Promise.resolve(authState.authenticated), tokenParsed: { value: null },
    login: authState.login, logout: authState.logout, isAuthenticated: () => authState.authenticated,
    userName: () => authState.username,
    hasRole: authState.hasRole,
  }),
}))

async function mountApp(path = '/') {
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const wrapper = mount(App, {
    global: { plugins: [router], mocks: { $t: key => key, $i18n: { locale: { value: 'zh' } } } },
  })
  mountedWrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

describe('App routing', () => {
  afterEach(() => {
    mountedWrappers.splice(0).forEach(wrapper => wrapper.unmount())
    document.querySelectorAll('.user-menu-panel').forEach(element => element.remove())
    vi.clearAllMocks()
  })

  it('mounts with Vue Router and keeps localhost default as Replay', async () => {
    const { wrapper } = await mountApp('/')
    expect(wrapper.find('[data-test="view-replay"]').exists()).toBe(true)
  })

  it.each([
    ['leaderboard', 'hof', 'view-hof'],
    ['extended', 'replay', 'view-replay'],
    ['reconstruction', 'battle-playback', 'view-replay'],
  ])('canonicalizes legacy %s URL to %s', async (legacy, canonical, testId) => {
    const { wrapper, router } = await mountApp(`/?view=${legacy}`)
    expect(router.currentRoute.value.query.view).toBe(canonical)
    expect(wrapper.find(`[data-test="${testId}"]`).exists()).toBe(true)
  })

  it('keeps Replay capability deep links on the shared workspace', async () => {
    const { wrapper } = await mountApp('/?view=battle-playback')
    expect(wrapper.find('[data-test="view-replay"]').attributes('data-cap')).toBe('playback')
  })

  it('keeps /download/android and its trailing slash on the Android route', async () => {
    for (const path of ['/download/android', '/download/android/']) {
      const { wrapper } = await mountApp(path)
      expect(wrapper.find('[data-test="view-android"]').exists()).toBe(true)
      wrapper.unmount()
    }
  })

  it('drops the current view query when navigating to Android', async () => {
    authState.authenticated = true
    const { wrapper, router } = await mountApp('/?view=replay')
    await wrapper.get('.user-menu-trigger').trigger('click')
    const androidItem = [...document.body.querySelectorAll('.user-menu-item')]
      .find(item => item.textContent.includes('android.nav'))
    androidItem.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/download/android')
    expect(router.currentRoute.value.query.view).toBeUndefined()
    expect(wrapper.find('[data-test="view-android"]').exists()).toBe(true)
  })

  it('uses router history for capability navigation', async () => {
    const { wrapper, router } = await mountApp('/?view=replay')
    await wrapper.get('[data-testid="ws-tab"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.view).toBe('ai-review')
    expect(wrapper.find('[data-test="view-replay"]').attributes('data-cap')).toBe('ai')
  })

  it('restores Replay capability with Back navigation', async () => {
    const { wrapper, router } = await mountApp('/?view=replay')
    await wrapper.get('[data-testid="ws-tab"]').trigger('click')
    await flushPromises()
    router.back()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(router.currentRoute.value.query.view).toBe('replay')
    expect(wrapper.find('[data-test="view-replay"]').attributes('data-cap')).toBe('data')
  })

  it('changes UI profile without navigating or remounting the active route', async () => {
    const { wrapper, router } = await mountApp('/?view=replay')
    setUiProfile('classic')
    await nextTick()
    expect(router.currentRoute.value.query.view).toBe('replay')
    expect(wrapper.find('[data-test="view-replay"]').exists()).toBe(true)
    setUiProfile('showcase')
    document.documentElement.removeAttribute('data-ui-profile')
    document.documentElement.removeAttribute('data-theme')
    window.localStorage.removeItem('wotb-ui-profile')
  })
})

describe('User menu', () => {
  afterEach(() => {
    mountedWrappers.splice(0).forEach(wrapper => wrapper.unmount())
    authState.authenticated = false
    authState.username = ''
    authState.login.mockClear()
    authState.logout.mockClear()
    document.querySelectorAll('.user-menu-panel').forEach(element => element.remove())
  })

  it('teleports to body and closes on Escape', async () => {
    const { wrapper } = await mountApp()
    await wrapper.get('.user-menu-trigger').trigger('click')
    expect(document.body.querySelector('.user-menu-panel')).toBeTruthy()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(document.body.querySelector('.user-menu-panel')).toBeFalsy()
  })

  it('shows the authenticated username', async () => {
    authState.authenticated = true
    authState.username = '158布丁'
    const { wrapper } = await mountApp()
    expect(wrapper.get('.user-menu-trigger').text()).toContain('158布丁')
  })

  it('uses the existing profile destination for a menu login', async () => {
    const { wrapper } = await mountApp()
    await wrapper.get('.user-menu-trigger').trigger('click')
    document.body.querySelector('.user-menu-item').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(authState.login).toHaveBeenCalledWith('profile')
  })
})
