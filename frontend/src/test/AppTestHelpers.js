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
    // ws-armor-handoff 模拟 `ReplayShotsPane.openInViewer`：目标带 query 的对象形式
    // （工作台把整个目的地交给 router owner，装甲查看器要的 tank/shot/world/… 都在里面）
    // ws-immersive-request：仅全屏兜底菜单用例点击——模拟播放器申请沉浸态但暂不 hostNav
    //（对应 3D 工具栏收起交还托管的状态），其余用例不受影响。
    // ws-desktop-pseudo-nav + 自带 nav-menu：模拟平板 / 桌面伪全屏里的 PlaybackTransport——申请沉浸
    // 并托管菜单入口；ws-desktop-pseudo-nav-release 模拟控制条收起 / UI 隐藏时 hostNav(false)，
    // 外壳必须接回兜底入口与抽屉。
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
// Agent 3D 回放 / 射击分析收敛进回放工作台的能力，
// 装甲查看器与坦克百科仍是独立视图；用轻量替身断言可见性边界即可。
// `__esModule: true` 必需——viewRegistry 经 defineAsyncComponent 动态 import，
// Vue 靠它把命名空间的 `.default` 解包成组件（缺失时会把命名空间本身当组件，
// 触发对 __isTeleport/name 的探测并报错）。
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
// 管理角色仅控制真正管理入口，默认普通用户。
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

// 外壳档位：默认桌面 / 平板（侧边栏）；手机用例切到抽屉外壳（顶栏菜单 + 左侧抽屉）
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

// 只保留 bootstrap 需要的 ensure；真实 composable 仍被执行（去重/重试/状态机都是被测行为）。
const bootstrapApi = vi.hoisted(() => ({ ensureUserProfile: vi.fn() }))
vi.mock('../api/user-profile.js', () => ({
  ensureUserProfile: bootstrapApi.ensureUserProfile,
}))

// Route/bootstrap tests keep the real guide owner, but receipt transport belongs to its own tests.
vi.mock('../api/onboarding.js', () => ({
  readOnboardingReceipt: vi.fn(async () => ({ coreEpoch: 1, disposition: 'COMPLETED' })),
  saveOnboardingReceipt: vi.fn(async receipt => receipt),
}))

/** 非落地页是异步组件（审计 PF-02）：等动态 import 完成后再断言。 */
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
