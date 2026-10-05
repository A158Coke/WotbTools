// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import ViewHost from './ViewHost.vue'
const state = vi.hoisted(() => ({ route: null as any, auth: null as any }))
vi.mock('vue-router', () => ({ useRoute: () => state.route }))
vi.mock('../composables/useAuth.js', () => ({ useAuth: () => state.auth }))
vi.mock('./viewRegistry.js', () => ({
  VIEW_COMPONENTS: { 'tournament-points': { template: '<div data-testid="public-board" />' },
    'tournament-points-admin': { template: '<div data-testid="admin-editor" />' },
    'tournament-points-config': { template: '<div data-testid="admin-config" />' } },
  replayInitialCapability: () => 'data',
}))
beforeEach(() => {
  state.route = reactive({ path: '/', query: { view: 'tournament-points', admin: '1' }, hash: '' })
  state.auth = { authenticated: ref(false), tokenParsed: ref(null), isAdmin: ref(true) }
})
function host() { return mount(ViewHost, { global: { mocks: { $t: (key: string) => key }, stubs: { ReplayCapabilityAuthGate: { template: '<div data-testid="login-gate" />' } } } }) }
describe('tournament deep-link page gates', () => {
  it('keeps the public page accessible anonymously', () => { expect(host().find('[data-testid="public-board"]').exists()).toBe(true) })
  it.each(['tournament-points-admin', 'tournament-points-config'])('does not mount %s anonymously despite admin=1', view => {
    state.route.query.view = view
    const wrapper = host()
    expect(wrapper.find('[data-testid="login-gate"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="admin-editor"], [data-testid="admin-config"]').exists()).toBe(false)
  })
  it('denies HoF-only roles and paints the editor only after the actual site role is held', async () => {
    state.route.query.view = 'tournament-points-admin'
    state.auth.authenticated.value = true
    state.auth.tokenParsed.value = { realm_access: { roles: ['HoF-admin'] } }
    const wrapper = host()
    expect(wrapper.find('[data-testid="admin-editor"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('tournament.adminRequired')
    state.auth.tokenParsed.value.realm_access.roles = ['wotbtools-admin']
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="admin-editor"]').exists()).toBe(true)
  })
})
