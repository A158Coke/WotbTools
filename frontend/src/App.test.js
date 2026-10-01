// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { nextTick, inject, ref, computed } from 'vue'
import App from './App.vue'
import { NAVIGATE_VIEW_KEY } from './shared/navigation.js'
import { createAppRouter } from './app/router.js'
import { ALLOWED_VIEWS } from './app/navigation.js'
import { VIEW_COMPONENTS } from './app/viewRegistry.js'
import { setUiProfile } from './composables/useUiProfile.js'
import { resetBusinessUserBootstrap } from './composables/useBusinessUserBootstrap.js'

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
vi.mock('./components/SponsorPage.vue', () => ({ default: { template: '<main data-test="view-sponsor" />' } }))
vi.mock('./components/HistoryPage.vue', () => ({ default: { template: '<div data-test="view-history" />' } }))
vi.mock('./components/TechnicalEvolutionPage.vue', () => ({ default: { template: '<div data-test="view-technical-evolution" />' } }))
// Agent 数据平面（admin-only）：详情/场景组件用轻量替身，断言可见性边界即可。
// `__esModule: true` 必需——viewRegistry 经 defineAsyncComponent 动态 import，
// Vue 靠它把命名空间的 `.default` 解包成组件（缺失时会把命名空间本身当组件，
// 触发对 __isTeleport/name 的探测并报错）。
const agentViewMock = (testId, name) => ({
  __esModule: true,
  default: { name, template: `<div data-test="${testId}" />` },
})
vi.mock('./components/AgentReplay3D.vue', () => agentViewMock('view-agent-replay', 'AgentReplay3D'))
vi.mock('./components/AgentTankopedia.vue', () => agentViewMock('view-agent-tankopedia', 'AgentTankopedia'))
vi.mock('./components/AgentArmorView.vue', () => agentViewMock('view-agent-armor', 'AgentArmorView'))
vi.mock('./components/AgentShots.vue', () => agentViewMock('view-agent-shots', 'AgentShots'))

const authState = vi.hoisted(() => ({
  authenticated: false,
  authenticatedRef: null,
  authInitState: null,
  isAdminRef: null,
  initPromise: Promise.resolve(false),
  displayName: '',
  login: vi.fn(),
  logout: vi.fn(),
  hasRole: vi.fn(() => false),
}))
authState.authenticatedRef = ref(false)
authState.authInitState = ref('unauthenticated')
// admin-only 功能开关（feature flag）：默认非管理员，按用例切换
authState.isAdminRef = ref(false)
vi.mock('./composables/useAuth.js', () => ({
  useAuth: () => ({
    initPromise: authState.initPromise,
    authenticated: authState.authenticatedRef,
    authInitState: authState.authInitState,
    tokenParsed: { value: null },
    login: authState.login, logout: authState.logout, isAuthenticated: () => authState.authenticated,
    displayName: computed(() => authState.displayName),
    hasRole: authState.hasRole,
    isAdmin: authState.isAdminRef,
    isHofAdmin: authState.isAdminRef,
  }),
}))

// 外壳档位：默认桌面 / 平板（单行顶栏）；手机用例切到 compact（标题栏 + 底部 Tab 栏）
const layoutState = vi.hoisted(() => ({ isCompact: null }))
vi.mock('./composables/useBreakpoint.js', async () => {
  const { ref: vueRef, computed: vueComputed } = await import('vue')
  layoutState.isCompact = vueRef(false)
  return {
    useBreakpoint: () => ({
      tier: vueComputed(() => (layoutState.isCompact.value ? 'compact' : 'expanded')),
      isCompact: layoutState.isCompact,
      isExpanded: vueComputed(() => !layoutState.isCompact.value),
    }),
    usePointer: () => ({ coarse: vueRef(false) }),
  }
})

function setAuthState(state, isAuthenticated = state === 'authenticated', initPromise = Promise.resolve(isAuthenticated)) {
  authState.authInitState.value = state
  authState.authenticated = isAuthenticated
  authState.authenticatedRef.value = isAuthenticated
  authState.initPromise = initPromise
}

// 只保留 bootstrap 需要的 ensure；真实 composable 仍被执行（去重/重试/状态机都是被测行为）。
const bootstrapApi = vi.hoisted(() => ({ ensureUserProfile: vi.fn() }))
vi.mock('./utils/api-user.js', () => ({
  ensureUserProfile: bootstrapApi.ensureUserProfile,
}))

async function mountApp(path = '/') {
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const wrapper = mount(App, {
    global: {
      plugins: [router],
      mocks: {
        $t: key => key === 'home.icpFiling' ? '闽ICP备2026036303号-1' : key,
        $i18n: { locale: 'zh' },
      },
    },
  })
  mountedWrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

describe('App routing', () => {
  afterEach(() => {
    mountedWrappers.splice(0).forEach(wrapper => wrapper.unmount())
    vi.clearAllMocks()
  })

  // ALLOWED_VIEWS 与 VIEW_COMPONENTS 漂移曾让 ?view=history 静默回退到默认视图（回主页），
  // 两条清单必须始终是同一个视图集合。
  it('keeps the navigable view allowlist equal to the registered view components', () => {
    expect([...ALLOWED_VIEWS].sort()).toEqual(Object.keys(VIEW_COMPONENTS).sort())
  })

  it('renders the project history view from its deep link', async () => {
    const { wrapper, router } = await mountApp('/?view=history')
    expect(router.currentRoute.value.query.view).toBe('history')
    expect(wrapper.find('[data-test="view-history"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="view-home"]').exists()).toBe(false)
  })

  it('mounts with Vue Router and keeps localhost default as Replay', async () => {
    const { wrapper } = await mountApp('/')
    expect(wrapper.find('[data-test="view-replay"]').exists()).toBe(true)
  })

  // Agent 数据平面合入主干期间的 feature flag：仅 wotbtools-admin 可见。
  // 隐藏导航入口只是 UI 收敛，深链封锁才是边界——两者都要有回归网。
  describe('admin-only Agent views (feature flag: wotbtools-admin)', () => {
    beforeEach(() => { authState.isAdminRef.value = false })
    afterEach(() => { authState.isAdminRef.value = false })

    it('hides the Agent tool entries in 我的 from non-admins', async () => {
      const { wrapper } = await mountApp('/?view=me')
      for (const view of ['agent-replay', 'agent-tankopedia', 'agent-shots']) {
        expect(wrapper.find(`[data-testid="me-link-${view}"]`).exists()).toBe(false)
      }
    })

    it('shows the Agent tool entries in 我的 to admins', async () => {
      authState.isAdminRef.value = true
      const { wrapper } = await mountApp('/?view=me')
      for (const view of ['agent-replay', 'agent-tankopedia', 'agent-shots']) {
        expect(wrapper.find(`[data-testid="me-link-${view}"]`).exists()).toBe(true)
      }
    })

    it('falls back to the default view when a non-admin deep-links an Agent view', async () => {
      for (const view of ['agent-replay', 'agent-tankopedia', 'agent-armor', 'agent-shots']) {
        const { wrapper } = await mountApp(`/?view=${view}`)
        expect(wrapper.find('[data-test="view-replay"]').exists()).toBe(true)
        expect(wrapper.find(`[data-test="view-${view}"]`).exists()).toBe(false)
      }
    })

    it('renders the Agent view for an admin deep link', async () => {
      authState.isAdminRef.value = true
      const { wrapper } = await mountApp('/?view=agent-shots')
      // Agent 视图是 defineAsyncComponent：等异步组件解析完成再断言
      await flushPromises()
      await nextTick()
      await flushPromises()
      expect(wrapper.find('[data-test="view-agent-shots"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="view-replay"]').exists()).toBe(false)
    })
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

  it.each([
    ['home', '/?view=home'],
    ['replay', '/?view=replay'],
    ['hall of fame', '/?view=hof'],
    ['android download', '/download/android'],
    ['sponsor', '/sponsor'],
  ])('renders shared filing links and Wargaming disclaimer on %s', async (_name, path) => {
    const { wrapper } = await mountApp(path)
    const footer = wrapper.get('[data-testid="app-footer"]')
    const icpLink = footer.get('[data-testid="icp-filing-link"]')
    const publicSecurityLink = footer.get('[data-testid="public-security-filing-link"]')

    expect(footer.findAll('[data-testid="icp-filing-link"]')).toHaveLength(1)
    expect(icpLink.text()).toBe('闽ICP备2026036303号-1')
    expect(icpLink.attributes('href')).toBe('https://beian.miit.gov.cn/')
    expect(icpLink.attributes('target')).toBe('_blank')
    expect(icpLink.attributes('rel')).toBe('noopener noreferrer')
    expect(publicSecurityLink.text()).toBe('home.publicSecurityFiling')
    expect(publicSecurityLink.attributes('href')).toBe('https://beian.mps.gov.cn/#/query/webSearch?code=35018202000555')
    expect(publicSecurityLink.attributes('target')).toBe('_blank')
    expect(publicSecurityLink.attributes('rel')).toBe('noopener noreferrer')
    expect(publicSecurityLink.get('img').attributes('aria-hidden')).toBe('true')
    expect(publicSecurityLink.get('img').attributes('alt')).toBe('')
    expect(footer.get('[data-testid="wargaming-disclaimer"]').text()).toBe('home.wargamingDisclaimer')
    expect(footer.findAll('a')).toHaveLength(2)
  })

  it('renders direct /sponsor path inside AppShell with exactly one shared Footer', async () => {
    const { wrapper, router } = await mountApp('/sponsor')
    expect(router.currentRoute.value.path).toBe('/sponsor')
    expect(router.currentRoute.value.query.view).toBeUndefined()
    expect(wrapper.find('[data-test="view-sponsor"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="app-footer"]')).toHaveLength(1)
  })

  it('supports back and forward navigation to the canonical Sponsor path', async () => {
    const { wrapper, router } = await mountApp('/?view=home')
    await router.push('/sponsor')
    await flushPromises()
    expect(wrapper.find('[data-test="view-sponsor"]').exists()).toBe(true)
    router.back()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(router.currentRoute.value.path).toBe('/')
    router.forward()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(router.currentRoute.value.path).toBe('/sponsor')
  })

  it('drops the current view query when navigating to Android', async () => {
    setAuthState('authenticated', true)
    const { wrapper, router } = await mountApp('/?view=me')
    await wrapper.get('[data-testid="me-link-android"]').trigger('click')
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
    await flushPromises()

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
    await flushPromises()

    expect(bootstrapApi.ensureUserProfile).not.toHaveBeenCalled()
  })

  it.each(['failed', 'initializing'])('does not call ensure while auth state is %s', async state => {
    setAuthState(state, false, Promise.resolve(false))
    bootstrapApi.ensureUserProfile.mockResolvedValue({ id: 1 })

    await mountApp('/?view=replay')
    await flushPromises()

    expect(bootstrapApi.ensureUserProfile).not.toHaveBeenCalled()
  })

  it('re-runs the canonical ensure after a watchdog-failed generation recovers as authenticated', async () => {
    // Generation 1's watchdog has already settled the public init promise as failed.
    setAuthState('failed', false, Promise.resolve(false))
    bootstrapApi.ensureUserProfile.mockResolvedValue({ id: 1 })

    await mountApp('/?view=replay')
    await flushPromises()
    expect(bootstrapApi.ensureUserProfile).not.toHaveBeenCalled()

    setAuthState('authenticated', true, Promise.resolve(true))
    await nextTick()
    await flushPromises()

    expect(bootstrapApi.ensureUserProfile).toHaveBeenCalledTimes(1)
  })

  it('does not provision again when authenticated is re-emitted by a later generation', async () => {
    setAuthState('authenticated', true)
    bootstrapApi.ensureUserProfile.mockResolvedValue({ id: 1 })

    await mountApp('/?view=replay')
    await flushPromises()
    expect(bootstrapApi.ensureUserProfile).toHaveBeenCalledTimes(1)

    setAuthState('initializing', false, Promise.resolve(false))
    await nextTick()
    setAuthState('authenticated', true, Promise.resolve(true))
    await nextTick()
    await flushPromises()

    expect(bootstrapApi.ensureUserProfile).toHaveBeenCalledTimes(1)
  })

  it('surfaces a retryable failure instead of swallowing it', async () => {
    setAuthState('authenticated', true)
    bootstrapApi.ensureUserProfile.mockRejectedValueOnce(new Error('502'))

    const { wrapper } = await mountApp('/?view=replay')
    await flushPromises()

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
    await flushPromises()
    expect(first.wrapper.find('[data-testid="business-bootstrap-notice"]').exists()).toBe(true)

    // 用户刷新 / 重新挂载：同一个 rejected Promise 绝不能锁死后续 ensure。
    bootstrapApi.ensureUserProfile.mockResolvedValue({ id: 1 })
    const second = await mountApp('/?view=replay')
    await flushPromises()

    expect(bootstrapApi.ensureUserProfile).toHaveBeenCalledTimes(2)
    expect(second.wrapper.find('[data-testid="business-bootstrap-notice"]').exists()).toBe(false)
  })

  it('retries from the failure notice without a page refresh', async () => {
    setAuthState('authenticated', true)
    bootstrapApi.ensureUserProfile.mockRejectedValueOnce(new Error('502'))
    const { wrapper } = await mountApp('/?view=replay')
    await flushPromises()

    bootstrapApi.ensureUserProfile.mockResolvedValue({ id: 1 })
    await wrapper.get('.business-bootstrap-retry').trigger('click')
    await flushPromises()

    expect(bootstrapApi.ensureUserProfile).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="business-bootstrap-notice"]').exists()).toBe(false)
  })
})

describe('App shell navigation and 我的', () => {
  afterEach(() => {
    mountedWrappers.splice(0).forEach(wrapper => wrapper.unmount())
    setAuthState('unauthenticated', false)
    authState.displayName = ''
    authState.login.mockClear()
    authState.logout.mockClear()
    layoutState.isCompact.value = false
  })

  it('marks the active primary section with aria-current, including Replay capabilities', async () => {
    const { wrapper } = await mountApp('/?view=battle-playback')
    expect(wrapper.get('[data-testid="nav-replay"]').attributes('aria-current')).toBe('page')
    expect(wrapper.get('[data-testid="nav-hof"]').attributes('aria-current')).toBeUndefined()
  })

  it('treats settings and about pages as part of 我的', async () => {
    const { wrapper } = await mountApp('/?view=history')
    expect(wrapper.get('[data-testid="nav-me"]').attributes('aria-current')).toBe('page')
  })

  it('navigates between primary sections through router links', async () => {
    const { wrapper, router } = await mountApp('/?view=replay')
    await wrapper.get('[data-testid="nav-hof"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.view).toBe('hof')
    expect(wrapper.find('[data-test="view-hof"]').exists()).toBe(true)
  })

  it('shows the authenticated display name on the account entry', async () => {
    setAuthState('authenticated', true)
    authState.displayName = '158布丁'
    const { wrapper } = await mountApp()
    expect(wrapper.get('[data-testid="nav-me"]').text()).toContain('158布丁')
  })

  it('uses a bottom tab bar instead of top navigation on compact layouts', async () => {
    layoutState.isCompact.value = true
    const { wrapper } = await mountApp('/?view=hof')
    expect(wrapper.find('[data-testid="app-tab-bar"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nav-hof"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="tab-hof"]').attributes('aria-current')).toBe('page')
    expect(wrapper.find('[data-testid="tab-me"]').exists()).toBe(true)
  })

  it('does not render the tab bar on wider layouts', async () => {
    const { wrapper } = await mountApp('/?view=hof')
    expect(wrapper.find('[data-testid="app-tab-bar"]').exists()).toBe(false)
  })

  it('logs in from 我的 and returns to 我的', async () => {
    const { wrapper } = await mountApp('/?view=me')
    await wrapper.get('[data-testid="me-login"]').trigger('click')
    expect(authState.login).toHaveBeenCalledWith('me')
  })

  it('opens the project history view from 我的', async () => {
    const { wrapper, router } = await mountApp('/?view=me')
    await wrapper.get('[data-testid="me-link-history"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.view).toBe('history')
    expect(wrapper.find('[data-test="view-history"]').exists()).toBe(true)
  })

  it('logs out from 我的 when authenticated', async () => {
    setAuthState('authenticated', true)
    const { wrapper } = await mountApp('/?view=me')
    await wrapper.get('[data-testid="me-logout"]').trigger('click')
    expect(authState.logout).toHaveBeenCalled()
  })
})
