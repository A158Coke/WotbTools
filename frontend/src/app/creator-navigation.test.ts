// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, defineComponent, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { provideCreatorAvailability } from '../composables/useCreatorAvailability.js'
import { contentAdminAllowed, tournamentAdminAllowed } from '../composables/useAuth.js'
import { getCreatorAvailability, listRecommendationCategories } from '../api/creators.js'
import AppSidebar from './AppSidebar.vue'
import { HOF_PENDING_COUNT_KEY, type HofPendingCount, type HofCountStatus } from '../shared/hofPendingCount.js'
const state = vi.hoisted(() => ({ auth: null as any }))
vi.mock('../composables/useAuth.js', async original => ({ ...await original<typeof import('../composables/useAuth.js')>(), useAuth: () => state.auth }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: true }) }) }))
vi.mock('../composables/useBreakpoint.js', () => ({ useBreakpoint: () => ({ isExpanded: ref(true) }) }))
vi.mock('../composables/useSidebar.js', () => ({ useSidebar: () => ({ collapsed: ref(false), toggle: vi.fn() }) }))
vi.mock('../api/creators.js', () => ({ getCreatorAvailability: vi.fn(), listRecommendationCategories: vi.fn() }))
let owner: ReturnType<typeof provideCreatorAvailability>
const Host = defineComponent({ setup() { owner = provideCreatorAvailability() }, components: { AppSidebar }, template: '<AppSidebar /><AppSidebar drawer />' })
let wrapper: ReturnType<typeof mount> | undefined
beforeEach(() => {
  vi.resetAllMocks()
  state.auth = { authenticated: ref(false), authInitState: ref('unauthenticated'), tokenParsed: ref(null), isAdmin: ref(false), isHofAdmin: ref(false), displayName: ref(''), isAuthenticated: () => state.auth.authenticated.value }
  state.auth.isTournamentAdmin = computed(() => tournamentAdminAllowed(state.auth))
  state.auth.isContentAdmin = computed(() => contentAdminAllowed(state.auth))
  vi.mocked(getCreatorAvailability).mockResolvedValue({ supported: true })
  vi.mocked(listRecommendationCategories).mockResolvedValue([])
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined })
async function host(pending?: HofPendingCount) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push('/?view=replay'); await router.isReady()
  wrapper = mount(Host, { global: {
    plugins: [router], provide: { [HOF_PENDING_COUNT_KEY as symbol]: pending ?? null },
    mocks: { $t: (key: string, params?: { total?: number }) => params?.total == null ? key : key + ' ' + params.total },
    stubs: { MorePanel: true },
  } })
  await flushPromises()
}
describe('creator primary and administration navigation', () => {
  it('reacts to content publication and removal in both primary navigation surfaces', async () => {
    await host()
    expect(wrapper!.find('[data-testid=nav-creators]').exists()).toBe(false)
    vi.mocked(listRecommendationCategories).mockResolvedValueOnce([{ id: 1, name: 'Published', type: 'UP' }]); await owner.refresh(); await flushPromises()
    expect(wrapper!.findAll('[data-testid=nav-creators]')).toHaveLength(2)
    await owner.refresh(); await flushPromises()
    expect(wrapper!.find('[data-testid=nav-creators]').exists()).toBe(false)
  })
  it('keeps an empty directory and configuration reachable to real administrators, then hides them on logout', async () => {
    vi.mocked(getCreatorAvailability).mockResolvedValue({ supported: true })
    state.auth.authenticated.value = true; state.auth.authInitState.value = 'authenticated'
    state.auth.tokenParsed.value = { realm_access: { roles: ['content-admin'] } }
    await host()
    expect(wrapper!.find('[data-testid=nav-creators]').exists()).toBe(true)
    expect(wrapper!.find('[data-testid=nav-creators-config]').exists()).toBe(true)
    expect(listRecommendationCategories).toHaveBeenCalledTimes(1)
    state.auth.authenticated.value = false; await flushPromises()
    expect(wrapper!.find('[data-testid=nav-creators]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid=nav-creators-config]').exists()).toBe(false)
  })
})

it('renders the same pending count on both admin links and withdraws stale or unauthorized totals', async () => {
  state.auth.isHofAdmin.value = true
  const status = ref<HofCountStatus>('ready')
  const snapshot = ref({ hundred: 95, mark3: 6, total: 101, sampledAt: 0 })
  await host({ status, snapshot, reason: ref(null), retry: vi.fn(), captureInvalidation: () => vi.fn() })
  const links = () => wrapper!.findAll('[data-testid=nav-hof-admin]')
  const badges = () => wrapper!.findAll('[data-testid=hof-pending-badge]')
  expect(links()).toHaveLength(2)
  expect(badges().map(el => el.text())).toEqual(['99+', '99+'])
  expect(links().map(el => el.attributes('aria-label'))).toEqual(Array(2).fill('hofAdmin.pendingCount.navKnown 101'))
  expect(badges().every(el => el.attributes('aria-hidden') === 'true')).toBe(true)
  status.value = 'loading'
  await flushPromises()
  expect(badges().map(el => el.text())).toEqual(['…', '…'])
  status.value = 'unknown'
  await flushPromises()
  expect(badges().map(el => el.text())).toEqual(['?', '?'])
  snapshot.value = { hundred: 0, mark3: 0, total: 0, sampledAt: 5 }
  status.value = 'ready'
  await flushPromises()
  expect(badges()).toHaveLength(0)
  expect(links().map(el => el.attributes('aria-label'))).toEqual(Array(2).fill('hofAdmin.pendingCount.navKnown 0'))
  state.auth.isHofAdmin.value = false
  await flushPromises()
  expect(links()).toHaveLength(0)
})
