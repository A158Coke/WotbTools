// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, reactive, ref } from 'vue'
import ViewHost from './ViewHost.vue'
import { contentAdminAllowed, tournamentAdminAllowed } from '../composables/useAuth.js'
import { CREATOR_AVAILABILITY_KEY } from '../composables/useCreatorAvailability.js'
const state = vi.hoisted(() => ({ route: null as any, auth: null as any }))
vi.mock('vue-router', () => ({ useRoute: () => state.route, useRouter: () => ({ push: vi.fn() }) }))
vi.mock('../composables/useAuth.js', async importOriginal => ({
  ...await importOriginal<typeof import('../composables/useAuth.js')>(), useAuth: () => state.auth,
}))
vi.mock('./viewRegistry.js', () => ({
  VIEW_COMPONENTS: { 'tournament-points': { template: '<div data-testid="public-board" />' },
    'tournament-points-admin': { template: '<div data-testid="admin-editor" />' },
    'tournament-points-config': { template: '<div data-testid="admin-config" />' },
    'creators-config': { template: '<div data-testid="creator-config" />' },
    'admin-ai-review-feedback': { template: '<div data-testid="feedback-admin" />' },
    creators: { template: '<div data-testid="creator-directory" />' } },
  replayInitialCapability: () => 'data',
}))
beforeEach(() => {
  state.route = reactive({ path: '/', query: { view: 'tournament-points', admin: '1' }, hash: '' })
  state.auth = { authenticated: ref(false), tokenParsed: ref(null), isAdmin: ref(true) }
  state.auth.isTournamentAdmin = computed(() => tournamentAdminAllowed(state.auth))
  state.auth.isContentAdmin = computed(() => contentAdminAllowed(state.auth))
})
function host() { return mount(ViewHost, { global: { mocks: { $t: (key: string) => key }, stubs: { ReplayCapabilityAuthGate: { template: '<div data-testid="login-gate" />' } } } }) }
describe('tournament deep-link page gates', () => {
  it('distinguishes confirmed unpublished content from an unknown failed probe and preserves retry', async () => {
    state.route.query.view = 'creators'
    const directoryVisible = ref(false), contentKnown = ref(false), error = ref<unknown>(new Error('503')), refresh = vi.fn()
    const wrapper = mount(ViewHost, { global: { mocks: { $t: (key: string) => key },
      provide: { [CREATOR_AVAILABILITY_KEY as symbol]: { typeAvailable: () => true, typeVisible: () => directoryVisible.value, available: ref(true), directoryVisible, contentKnown, error, loading: ref(false), refresh } } } })
    expect(wrapper.get('[data-testid=creators-unavailable]').text()).toContain('creators.availabilityFailed')
    contentKnown.value = true; error.value = null; await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid=creators-not-published]').text()).toContain('creators.notPublished')
    expect(wrapper.find('[data-testid=creator-directory]').exists()).toBe(false)
    await wrapper.get('[data-testid=creators-availability-retry]').trigger('click'); expect(refresh).toHaveBeenCalledTimes(1)
    directoryVisible.value = true; await wrapper.vm.$nextTick(); expect(wrapper.find('[data-testid=creator-directory]').exists()).toBe(true)
    directoryVisible.value = false; await wrapper.vm.$nextTick(); expect(wrapper.find('[data-testid=creator-directory]').exists()).toBe(false)
    wrapper.unmount()
  })
  it.each(['creators', 'creators-config'])('withholds %s until the backend explicitly advertises support', async view => {
    state.route.query.view = view
    state.auth.authenticated.value = true
    state.auth.tokenParsed.value = { realm_access: { roles: ['content-admin'] } }
    const available = ref(false), refresh = vi.fn()
    const wrapper = mount(ViewHost, { global: { mocks: { $t: (key: string) => key },
      provide: { [CREATOR_AVAILABILITY_KEY as symbol]: { typeAvailable: () => available.value, typeVisible: () => available.value, available, directoryVisible: available, contentKnown: ref(false), error: ref(null), loading: ref(false), refresh } } } })
    expect(wrapper.find('[data-testid="creator-config"], [data-testid="creator-directory"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="creators-unavailable"]').exists()).toBe(true)
    await wrapper.get('[data-testid="creators-availability-retry"]').trigger('click')
    expect(refresh).toHaveBeenCalledTimes(1)
    available.value = true; await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="creators-unavailable"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="creator-config"], [data-testid="creator-directory"]').exists()).toBe(true)
    wrapper.unmount()
  })
  it('keeps the public page accessible anonymously', () => { expect(host().find('[data-testid="public-board"]').exists()).toBe(true) })
  it('requires authentication and the site administrator role for feedback deep links', async () => {
    state.route.query.view = 'admin-ai-review-feedback'
    state.auth.isAdmin.value = false
    const wrapper = host()
    expect(wrapper.find('[data-testid="login-gate"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="feedback-admin"]').exists()).toBe(false)
    state.auth.authenticated.value = true; await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('aiFeedback.adminRequired')
    expect(wrapper.find('[data-testid="feedback-admin"]').exists()).toBe(false)
    state.auth.isAdmin.value = true; await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="feedback-admin"]').exists()).toBe(true)
    state.auth.isAdmin.value = false; await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="feedback-admin"]').exists()).toBe(false)
  })
  it.each(['tournament-points-admin', 'tournament-points-config', 'creators-config'])('does not mount %s anonymously despite admin=1', view => {
    state.route.query.view = view
    const wrapper = host()
    expect(wrapper.find('[data-testid="login-gate"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="admin-editor"], [data-testid="admin-config"], [data-testid="creator-config"]').exists()).toBe(false)
  })
  it('keeps content and tournament administration independent in both directions', async () => {
    state.route.query.view = 'creators-config'
    state.auth.authenticated.value = true
    state.auth.tokenParsed.value = { realm_access: { roles: ['tournament-admin'] } }
    const available = ref(true)
    const wrapper = mount(ViewHost, { global: { mocks: { $t: (key: string) => key },
      provide: { [CREATOR_AVAILABILITY_KEY as symbol]: { typeAvailable: () => true, typeVisible: () => true, available, directoryVisible: available, contentKnown: ref(true), error: ref(null), loading: ref(false), refresh: vi.fn() } } } })
    expect(wrapper.find('[data-testid="creator-config"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('creators.adminRequired')
    state.auth.tokenParsed.value.realm_access.roles = ['content-admin']
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="creator-config"]').exists()).toBe(true)
    state.route.query.view = 'tournament-points-admin'
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="admin-editor"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('tournament.adminRequired')
    state.auth.tokenParsed.value.realm_access.roles = ['wotbtools-admin', 'content-admin', 'tournament-admin']
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="admin-editor"]').exists()).toBe(true)
    wrapper.unmount()
  })
  it('denies HoF-only roles and admits actual tournament or site roles, then removes access on role loss', async () => {
    state.route.query.view = 'tournament-points-admin'
    state.auth.authenticated.value = true
    state.auth.tokenParsed.value = { realm_access: { roles: ['HoF-admin'] } }
    const wrapper = host()
    expect(wrapper.find('[data-testid="admin-editor"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('tournament.adminRequired')
    state.auth.tokenParsed.value.realm_access.roles = ['tournament-admin']
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="admin-editor"]').exists()).toBe(true)
    state.auth.tokenParsed.value.realm_access.roles = ['wotbtools-admin']
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="admin-editor"]').exists()).toBe(false)
    state.auth.tokenParsed.value.realm_access.roles = ['wotbtools-admin', 'tournament-admin']
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="admin-editor"]').exists()).toBe(true)
    state.auth.tokenParsed.value.realm_access.roles = ['wotbtools-user']
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="admin-editor"]').exists()).toBe(false)
  })
})
