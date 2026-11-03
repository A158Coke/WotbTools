// @vitest-environment happy-dom
// #845：ViewHost 的 gate precedence 与 view loading 边界的组合行为。
// viewRegistry 只替身 VIEW_COMPONENTS（受控 loader 走真实 defineLazyView），
// ViewHost 本体、gates 与 KeepAlive 全部真实运行。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, reactive, ref } from 'vue'
import ViewHost from './ViewHost.vue'
import { contentAdminAllowed } from '../composables/useAuth.js'

const state = vi.hoisted(() => ({
  route: null as any,
  auth: null as any,
  defs: {} as Record<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>,
}))

vi.mock('vue-router', () => ({ useRoute: () => state.route, useRouter: () => ({ push: vi.fn() }) }))
vi.mock('../composables/useAuth.js', async importOriginal => ({
  ...await importOriginal<typeof import('../composables/useAuth.js')>(), useAuth: () => state.auth,
}))
vi.mock('./viewRegistry.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./viewRegistry.js')>()
  const controlled = (name: string) => actual.defineLazyView(() => {
    let resolve!: (v: unknown) => void
    let reject!: (e: unknown) => void
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    state.defs[name] = { resolve, reject }
    return promise.then(() => ({ name: `${name}Page`, template: `<div data-testid="view-${name}">${name}</div>` }))
  })
  return {
    ...actual,
    replayInitialCapability: () => 'data',
    VIEW_COMPONENTS: {
      home: { name: 'HomeStub', template: '<div data-testid="view-home" />' },
      replay: { name: 'ReplayWorkspace', template: '<div data-testid="view-replay" />' },
      // 每个 admin view 一个独立 wrapper：resolvedComp 在 wrapper 定义内缓存，
      // 慢加载与失败用例必须用不同 view，避免上一用例的 resolve 泄漏到下一用例。
      'admin-battle-data': controlled('admin-slow'),
      'admin-ai-review-feedback': controlled('admin-error'),
    },
  }
})

beforeEach(() => {
  vi.useFakeTimers()
  state.route = reactive({ path: '/', query: { view: 'home' }, hash: '' })
  state.auth = { authenticated: ref(false), tokenParsed: ref(null), isAdmin: ref(true) }
  state.auth.isTournamentAdmin = computed(() => true)
  state.auth.isContentAdmin = computed(() => contentAdminAllowed(state.auth))
})
afterEach(() => {
  vi.useRealTimers()
})

function host() {
  return mount(ViewHost, {
    global: {
      mocks: { $t: (key: string) => key },
      stubs: { ReplayCapabilityAuthGate: { template: '<div data-testid="login-gate" />' } },
    },
  })
}

describe('gate precedence over the view loading boundary', () => {
  it('never mounts the lazy admin view behind the login gate', async () => {
    state.route.query.view = 'admin-battle-data'
    state.auth.isAdmin.value = false
    const wrapper = host()
    expect(wrapper.find('[data-testid="login-gate"]').exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.find('[data-testid="view-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="view-admin"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('never mounts the lazy admin view behind the permission-denied banner', async () => {
    state.route.query.view = 'admin-battle-data'
    state.auth.authenticated.value = true
    state.auth.isAdmin.value = false
    const wrapper = host()
    expect(wrapper.get('[data-testid="admin-required"]').text()).toContain('battleDataAdmin.adminRequired')
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.find('[data-testid="view-loading"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows the loading surface only after the gates pass and the chunk exceeds the threshold', async () => {
    state.route.query.view = 'admin-battle-data'
    state.auth.authenticated.value = true
    const wrapper = host()
    expect(wrapper.find('[data-testid="view-loading"]').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.get('[data-testid="view-loading"]').attributes('role')).toBe('status')
    state.defs['admin-slow'].resolve(null)
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('[data-testid="view-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="view-admin-slow"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('an errored lazy view shows the recoverable error surface and navigation clears it', async () => {
    state.route.query.view = 'admin-ai-review-feedback'
    state.auth.authenticated.value = true
    const wrapper = host()
    await vi.advanceTimersByTimeAsync(0)
    state.defs['admin-error'].reject(new Error('chunk gone'))
    await vi.advanceTimersByTimeAsync(400)
    expect(wrapper.find('[data-testid="view-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="view-load-error"]').exists()).toBe(true)
    state.route.query.view = 'home'
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('[data-testid="view-load-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="view-home"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
