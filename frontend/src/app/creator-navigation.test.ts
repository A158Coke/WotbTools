// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, defineComponent, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { provideCreatorAvailability } from '../composables/useCreatorAvailability.js'
import { contentAdminAllowed, tournamentAdminAllowed } from '../composables/useAuth.js'
import { getCreatorAvailability, listRecommendationCategories } from '../api/creators.js'
import AppSidebar from './AppSidebar.vue'
import AppTabBar from './AppTabBar.vue'
const state = vi.hoisted(() => ({ auth: null as any }))
vi.mock('../composables/useAuth.js', async original => ({ ...await original<typeof import('../composables/useAuth.js')>(), useAuth: () => state.auth }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: true }) }) }))
vi.mock('../composables/useBreakpoint.js', () => ({ useBreakpoint: () => ({ isExpanded: ref(true) }) }))
vi.mock('../composables/useSidebar.js', () => ({ useSidebar: () => ({ collapsed: ref(false), toggle: vi.fn() }) }))
vi.mock('../api/creators.js', () => ({ getCreatorAvailability: vi.fn(), listRecommendationCategories: vi.fn() }))
let owner: ReturnType<typeof provideCreatorAvailability>
const Host = defineComponent({ setup() { owner = provideCreatorAvailability() }, components: { AppSidebar, AppTabBar }, template: '<AppSidebar /><AppTabBar />' })
let wrapper: ReturnType<typeof mount> | undefined
beforeEach(() => {
  vi.resetAllMocks()
  state.auth = { authenticated: ref(false), authInitState: ref('unauthenticated'), tokenParsed: ref(null), isAdmin: ref(false), isHofAdmin: ref(false), displayName: ref(''), isAuthenticated: () => state.auth.authenticated.value }
  state.auth.isTournamentAdmin = computed(() => tournamentAdminAllowed(state.auth))
  state.auth.isContentAdmin = computed(() => contentAdminAllowed(state.auth))
  vi.mocked(getCreatorAvailability).mockResolvedValue({ supported: true, contentVisibilitySupported: true, recommendationsSupported: false })
  vi.mocked(listRecommendationCategories).mockResolvedValue([])
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined })
async function host() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push('/?view=replay'); await router.isReady()
  wrapper = mount(Host, { global: { plugins: [router], mocks: { $t: (key: string) => key }, stubs: { MorePanel: true } } })
  await flushPromises()
}
describe('creator primary and administration navigation', () => {
  it('reacts to content publication and removal in both primary navigation surfaces', async () => {
    await host()
    expect(wrapper!.find('[data-testid=nav-creators]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid=tab-creators]').exists()).toBe(false)
    vi.mocked(listRecommendationCategories).mockResolvedValueOnce([{ id: 1, name: 'Published', type: 'UP' }]); await owner.refresh(); await flushPromises()
    expect(wrapper!.find('[data-testid=nav-creators]').exists()).toBe(true)
    expect(wrapper!.find('[data-testid=tab-creators]').exists()).toBe(true)
    await owner.refresh(); await flushPromises()
    expect(wrapper!.find('[data-testid=nav-creators]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid=tab-creators]').exists()).toBe(false)
  })
  it('keeps an empty legacy directory and configuration reachable to real administrators, then hides them on logout', async () => {
    vi.mocked(getCreatorAvailability).mockResolvedValue({ supported: true, contentVisibilitySupported: false, recommendationsSupported: false })
    state.auth.authenticated.value = true; state.auth.authInitState.value = 'authenticated'
    state.auth.tokenParsed.value = { realm_access: { roles: ['content-admin'] } }
    await host()
    expect(wrapper!.find('[data-testid=nav-creators]').exists()).toBe(true)
    expect(wrapper!.find('[data-testid=tab-creators]').exists()).toBe(true)
    expect(wrapper!.find('[data-testid=nav-creators-config]').exists()).toBe(true)
    expect(listRecommendationCategories).not.toHaveBeenCalled()
    state.auth.authenticated.value = false; await flushPromises()
    expect(wrapper!.find('[data-testid=nav-creators]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid=tab-creators]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid=nav-creators-config]').exists()).toBe(false)
  })
})
