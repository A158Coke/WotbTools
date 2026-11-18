// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuthState, getMountedWrappers, setAuthState, mountApp, settle } from './test/AppTestHelpers.js'
import { nextTick } from 'vue'
import { ALLOWED_VIEWS } from './app/navigation.js'
import { VIEW_COMPONENTS } from './app/viewRegistry.js'
import { setUiProfile } from './composables/useUiProfile.js'

const authState = getAuthState()
const mountedWrappers = getMountedWrappers()

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

  describe('publicly discoverable Agent views', () => {
    beforeEach(() => {
      authState.isAdminRef.value = false
      setAuthState('unauthenticated', false)
    })
    afterEach(() => {
      authState.isAdminRef.value = false
      setAuthState('unauthenticated', false)
    })

    it.each([false, true])('does not duplicate 3D and shots tools in 更多 (admin=%s)', async admin => {
      authState.isAdminRef.value = admin
      const { wrapper } = await mountApp('/?view=more')
      for (const view of ['agent-replay', 'agent-shots']) {
        expect(wrapper.find(`[data-testid="more-link-${view}"]`).exists()).toBe(false)
      }
      expect(wrapper.find('[data-testid="nav-tankopedia"]').exists()).toBe(true)
    })

    it.each([false, true])('restores 3D / shots deep links (authenticated=%s)', async authenticated => {
      setAuthState(authenticated ? 'authenticated' : 'unauthenticated', authenticated)
      for (const [view, capability] of [['agent-replay', '3d'], ['agent-shots', 'shots']]) {
        const { wrapper, router } = await mountApp(`/?view=${view}`)
        expect(router.currentRoute.value.query.view).toBe(view)
        expect(wrapper.get('[data-test="view-replay"]').attributes('data-cap')).toBe(capability)
        wrapper.unmount()
      }
    })

    it('anonymous armor deep link mounts the viewer directly with every scene parameter', async () => {
      const path = '/?view=agent-armor&tank=13825&shooter=19969&config=1&scfg=0&shell=0&shot=2&world=1&heatmap=1&az=45&h=6&d=12#scene'
      const { wrapper, router } = await mountApp(path)
      expect(wrapper.find('[data-test="view-agent-armor"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(false)
      expect(authState.login).not.toHaveBeenCalled()
      // 场景参数原样保留：查看器读的就是 URL 里这一份
      expect(router.currentRoute.value.query).toEqual({
        view: 'agent-armor', tank: '13825', shooter: '19969', config: '1', scfg: '0',
        shell: '0', shot: '2', world: '1', heatmap: '1', az: '45', h: '6', d: '12',
      })
    })

    it('lets a non-admin deep-link the public 坦克百科', async () => {
      const { wrapper } = await mountApp('/?view=agent-tankopedia')
      await settle()
      expect(wrapper.find('[data-test="view-agent-tankopedia"]').exists()).toBe(true)
    })
  })

  it.each([
    ['leaderboard', 'hof', 'view-hof'],
    ['extended', 'replay', 'view-replay'],
    ['reconstruction', 'battle-playback', 'view-replay'],
  ])('canonicalizes legacy %s URL to %s', async (legacy, canonical, testId) => {
    const { wrapper, router } = await mountApp(`/?view=${legacy}&lang=ru#details`)
    expect(router.currentRoute.value.query.view).toBe(canonical)
    expect(router.currentRoute.value.query.lang).toBe('ru')
    expect(router.currentRoute.value.hash).toBe('#details')
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
    await settle()
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
    const { wrapper, router } = await mountApp('/?view=more')
    await wrapper.get('[data-testid="more-link-android"]').trigger('click')
    await settle()
    expect(router.currentRoute.value.path).toBe('/download/android')
    expect(router.currentRoute.value.query.view).toBeUndefined()
    expect(wrapper.find('[data-test="view-android"]').exists()).toBe(true)
  })

  it('uses router history for capability navigation', async () => {
    const { wrapper, router } = await mountApp('/?view=replay')
    await wrapper.get('[data-testid="ws-tab"]').trigger('click')
    await settle()
    expect(router.currentRoute.value.query.view).toBe('ai-review')
    expect(wrapper.find('[data-test="view-replay"]').attributes('data-cap')).toBe('ai')
  })

  it('普通登录用户射击 → 装甲查看器的交接参数原样落到 URL', async () => {
    authState.isAdminRef.value = false
    setAuthState('authenticated', true)
    try {
      const { wrapper, router } = await mountApp('/?view=agent-shots')
      await wrapper.get('[data-testid="ws-armor-handoff"]').trigger('click')
      await settle()
      expect(router.currentRoute.value.query).toEqual({
        view: 'agent-armor', tank: '13825', shooter: '19969', shot: '2',
        shell: '0', scfg: '0', config: '1', world: '1', heatmap: '1',
      })
      // 落地的是装甲查看器（不是被收敛回工作台），参数就得是它读的那一份
      expect(wrapper.find('[data-test="view-agent-armor"]').exists()).toBe(true)
    } finally {
      setAuthState('unauthenticated', false)
    }
  })

  it('登出（authenticated true→false）收敛到当前运行面的默认落点：不保留登出前的 view', async () => {
    authState.authenticatedRef.value = true
    try {
      const { wrapper, router } = await mountApp('/?view=profile')
      expect(router.currentRoute.value.query.view).toBe('profile')

      // 登出：useAuth 把 authenticated 落回 false（local-first，不等网络）
      authState.authenticatedRef.value = false
      await settle()

      // happy-dom 的 localhost 与 Android 一样以 Replay 为默认落点。
      expect(router.currentRoute.value.query.view).toBe('replay')
      expect(wrapper.find('[data-test="view-replay"]').exists()).toBe(true)
      wrapper.unmount()
    } finally {
      authState.authenticatedRef.value = false
    }
  })

  it('restores Replay capability with Back navigation', async () => {
    const { wrapper, router } = await mountApp('/?view=replay')
    await wrapper.get('[data-testid="ws-tab"]').trigger('click')
    await settle()
    router.back()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(router.currentRoute.value.query.view).toBe('replay')
    expect(wrapper.find('[data-test="view-replay"]').attributes('data-cap')).toBe('data')
  })

  it('changes UI profile without navigating or remounting the active route', async () => {
    const { wrapper, router } = await mountApp('/?view=replay')
    setUiProfile('winter')
    await nextTick()
    expect(router.currentRoute.value.query.view).toBe('replay')
    expect(wrapper.find('[data-test="view-replay"]').exists()).toBe(true)
    setUiProfile('summer')
    document.documentElement.removeAttribute('data-ui-profile')
    document.documentElement.removeAttribute('data-theme')
    window.localStorage.removeItem('wotb-ui-profile')
  })
})
