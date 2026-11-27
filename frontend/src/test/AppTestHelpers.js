// @vitest-environment happy-dom
import { vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { inject, ref, computed } from 'vue'
import App from '../App.vue'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { SHELL_CHROME_KEY, OPEN_NAV_DRAWER_KEY } from '../shared/shellChrome.js'
import { createAppRouter } from '../app/router.js'

const mountedWrappers = []

vi.mock('../components/ReplayWorkspace.vue', () => ({
  default: {
    name: 'ReplayWorkspace',
    props: ['initialCapability'],
    setup() { return { navigate: inject(NAVIGATE_VIEW_KEY), chrome: inject(SHELL_CHROME_KEY), openNav: inject(OPEN_NAV_DRAWER_KEY) } },
    template: `<div :data-cap="initialCapability" data-test="view-replay">
      <button data-testid="ws-tab" @click="navigate('ai-review')">ai</button>
      <button data-testid="ws-armor-handoff" @click="navigate({ query: { view: 'agent-armor', tank: '13825', shooter: '19969', shot: '2', shell: '0', scfg: '0', config: '1', world: '1', heatmap: '1' } })">viewer</button>
      <button data-testid="ws-immersive-request" @click="chrome?.request('app-test-immersive', true)" />
      <button data-testid="ws-desktop-pseudo-nav" @click="chrome?.request('app-test-pseudo', true); chrome?.hostNav('app-test-pseudo-nav', true)" />
      <button data-testid="ws-desktop-pseudo-nav-release" @click="chrome?.hostNav('app-test-pseudo-nav', false)" />
      <button v-if="chrome?.navHosted?.value" data-testid="nav-menu" @click="openNav($event.currentTarget)">menu</button>
    </div>`,
  },
}))
vi.mock('../components/HomePage.vue', () => ({ __esModule: true, default: { template: '<div data-test="view-home" />' } }))
vi.mock('../components/HoFPage.vue', () => ({ __esModule: true, default: { template: '<div data-test="view-hof" />' } }))
vi.mock('../components/AndroidDownloadPage.vue', () => ({ __esModule: true, default: { template: '<div data-test="view-android" />' } }))
vi.mock('../components/SponsorPage.vue', () => ({ __esModule: true, default: { template: '<main data-test="view-sponsor" />' } }))
vi.mock('../components/ProfilePage.vue', () => ({ __esModule: true, default: { template: '<div data-test="view-profile" />' } }))
vi.mock('../components/HistoryPage.vue', () => ({ __esModule: true, default: { template: '<div data-test="view-history" />' } }))
vi.mock('../components/TechnicalEvolutionPage.vue', () => ({ __esModule: true, default: { template: '<div data-test="view-technical-evolution" />' } }))
vi.mock('../components/TournamentPointsConfigPage.vue', () => ({ __esModule: true, default: { template: '<div data-test="view-tournament-config" />' } }))
vi.mock('../components/TournamentPointsAdminPage.vue', () => ({ __esModule: true, default: { template: '<div data-test="view-tournament-admin" />' } }))
const agentViewMock = (testId, name) => ({
  __esModule: true,
  default: { name, template: `<div data-test="${testId}" />` },
})
vi.mock('../components/AgentTankopedia.vue', () => agentViewMock('view-agent-tankopedia', 'AgentTankopedia'))
vi.mock('../components/AgentArmorView.vue', () => agentViewMock('view-agent-armor', 'AgentArmorView'))

const authState = vi.hoisted(() => ({
  epoch: 0,
  authenticated: false,
  authenticatedRef: null,
  authInitState: null,
  isAdminRef: null,
  isTournamentAdminRef: null,
  isContentAdminRef: null,
  initPromise: Promise.resolve(false),
  displayName: '',
  login: vi.fn(),
  logout: vi.fn(),
  hasRole: vi.fn(() => false),
}))
authState.authenticatedRef = ref(false)
authState.authInitState = ref('unauthenticated')
authState.isAdminRef = ref(false)
authState.isTournamentAdminRef = ref(false)
authState.isContentAdminRef = ref(false)
vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    initPromise: authState.initPromise,
    authenticated: authState.authenticatedRef,
    authInitState: authState.authInitState,
    authEpoch: () => authState.epoch,
    tokenParsed: { value: null },
    login: authState.login, logout: authState.logout, isAuthenticated: () => authState.authenticated,
    displayName: computed(() => authState.displayName),
    hasRole: authState.hasRole,
    isAdmin: authState.isAdminRef,
    isHofAdmin: authState.isAdminRef,
    isTournamentAdmin: computed(() => authState.isAdminRef.value || authState.isTournamentAdminRef.value),
    isContentAdmin: computed(() => authState.isAdminRef.value || authState.isContentAdminRef.value),
  }),
}))

const layoutState = vi.hoisted(() => ({ isCompact: null, isDrawerShell: null }))
vi.mock('../composables/useBreakpoint.js', async () => {
  const { ref: vueRef, computed: vueComputed } = await import('vue')
  layoutState.isCompact = vueRef(false)
  layoutState.isDrawerShell = vueRef(false)
  return {
    useBreakpoint: () => ({
      tier: vueComputed(() => (layoutState.isCompact.value ? 'compact' : 'expanded')),
      isCompact: layoutState.isCompact,
      isDrawerShell: layoutState.isDrawerShell,
      isExpanded: vueComputed(() => !layoutState.isCompact.value),
    }),
    usePointer: () => ({ coarse: vueRef(false) }),
  }
})

export function setAuthState(state, isAuthenticated = state === 'authenticated', initPromise = Promise.resolve(isAuthenticated)) {
  authState.epoch += 1
  authState.authInitState.value = state
  authState.authenticated = isAuthenticated
  authState.authenticatedRef.value = isAuthenticated
  authState.initPromise = initPromise
}

const bootstrapApi = vi.hoisted(() => ({ ensureUserProfile: vi.fn() }))
vi.mock('../api/user-profile.js', () => ({
  ensureUserProfile: bootstrapApi.ensureUserProfile,
}))

vi.mock('../api/onboarding.js', () => ({
  readOnboardingReceipt: vi.fn(async () => ({ coreEpoch: 1, disposition: 'COMPLETED' })),
  saveOnboardingReceipt: vi.fn(async receipt => receipt),
}))

export async function settle() {
  await flushPromises()
  await vi.dynamicImportSettled()
  await flushPromises()
}

export async function mountApp(path = '/') {
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const wrapper = mount(App, {
    global: {
      plugins: [router],
      provide: { [DIALOG_INLINE_KEY]: true },
      mocks: {
        $t: key => key === 'home.icpFiling' ? '闽ICP备2026036303号-1' : key,
        $i18n: { locale: 'zh' },
      },
    },
  })
  mountedWrappers.push(wrapper)
  await settle()
  return { wrapper, router }
}



export function getMountedWrappers() { return mountedWrappers }
export function getAuthState() { return authState }
export function getLayoutState() { return layoutState }
export function getBootstrapApi() { return bootstrapApi }
