// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAuthState, getLayoutState, getMountedWrappers, setAuthState, mountApp, settle } from '../test/AppTestHelpers.js'

const authState = getAuthState()
const layoutState = getLayoutState()
const mountedWrappers = getMountedWrappers()

describe('App shell navigation, 更多 and account', () => {
  afterEach(() => {
    mountedWrappers.splice(0).forEach(wrapper => wrapper.unmount())
    setAuthState('unauthenticated', false)
    authState.displayName = ''
    authState.login.mockClear()
    authState.logout.mockClear()
    layoutState.isCompact.value = false
    layoutState.isDrawerShell.value = false
  })

  it('marks the active primary section with aria-current, including Replay capabilities', async () => {
    const { wrapper } = await mountApp('/?view=battle-playback')
    expect(wrapper.get('[data-testid="nav-replay"]').attributes('aria-current')).toBe('page')
    expect(wrapper.get('[data-testid="nav-hof"]').attributes('aria-current')).toBeUndefined()
  })

  it('treats settings and about pages as part of 更多', async () => {
    const { wrapper } = await mountApp('/?view=history')
    expect(wrapper.get('[data-testid="nav-more"]').attributes('aria-current')).toBe('page')
    expect(wrapper.get('[data-testid="nav-account"]').attributes('aria-current')).toBeUndefined()
  })

  it('treats the profile page as the account entry, not 更多', async () => {
    const { wrapper } = await mountApp('/?view=profile')
    expect(wrapper.get('[data-testid="nav-account"]').attributes('aria-current')).toBe('page')
    expect(wrapper.get('[data-testid="nav-more"]').attributes('aria-current')).toBeUndefined()
  })

  it('navigates between primary sections through router links', async () => {
    const { wrapper, router } = await mountApp('/?view=replay')
    await wrapper.get('[data-testid="nav-hof"]').trigger('click')
    await settle()
    expect(router.currentRoute.value.query.view).toBe('hof')
    expect(wrapper.find('[data-test="view-hof"]').exists()).toBe(true)
  })

  it('labels the account entry with the display name, or 登录 when signed out', async () => {
    const signedOut = await mountApp()
    expect(signedOut.wrapper.get('[data-testid="nav-account"]').text()).toContain('app.login')
    signedOut.wrapper.unmount()
    setAuthState('authenticated', true)
    authState.displayName = '158布丁'
    const { wrapper } = await mountApp()
    expect(wrapper.get('[data-testid="nav-account"]').text()).toContain('158布丁')
  })

  it('opens the account page from the account entry', async () => {
    const { wrapper, router } = await mountApp('/?view=replay')
    await wrapper.get('[data-testid="nav-account"]').trigger('click')
    await settle()
    expect(router.currentRoute.value.query.view).toBe('profile')
  })

  it('uses a top bar menu and a left drawer (no bottom tabs) on phone layouts', async () => {
    layoutState.isCompact.value = true
    layoutState.isDrawerShell.value = true
    const { wrapper } = await mountApp('/?view=hof')
    expect(wrapper.find('[data-testid="app-sidebar"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="app-tab-bar"]').exists()).toBe(false)
    const menu = wrapper.get('[data-testid="nav-menu"]')
    expect(menu.attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('[data-testid="nav-account"]').attributes('aria-label')).toBe('nav.account')
    await menu.trigger('click')
    await settle()
    expect(menu.attributes('aria-expanded')).toBe('true')
    const drawer = wrapper.get('[data-testid="nav-drawer-panel"]')
    expect(drawer.get('[data-testid="nav-hof"]').attributes('aria-current')).toBe('page')
    expect(drawer.find('[data-testid="nav-more"]').exists()).toBe(true)
    await drawer.get('[data-testid="nav-replay"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="nav-drawer-panel"]').exists()).toBe(false)
  })

  it('手机横屏（宽度 ≥ 768 的 844×340 同样）：仍是顶栏菜单 + 抽屉，没有侧边栏', async () => {
    layoutState.isDrawerShell.value = true
    const { wrapper } = await mountApp('/?view=hof')
    expect(wrapper.find('[data-testid="app-sidebar"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="app-top-bar"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nav-menu"]').exists()).toBe(true)
  })

  it('3D 全屏且播放器交还导航托管时，兜底菜单渲染进全屏元素（外壳会被浏览器隐藏）', async () => {
    const fullscreenRoot = document.createElement('div')
    document.body.append(fullscreenRoot)
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: fullscreenRoot })
    layoutState.isCompact.value = true
    layoutState.isDrawerShell.value = true
    try {
      const { wrapper } = await mountApp('/?view=replay')
      await wrapper.get('[data-testid="ws-immersive-request"]').trigger('click')
      await settle()
      const menu = document.querySelector('[data-testid="nav-menu"]')
      expect(menu).toBeTruthy()
      expect(fullscreenRoot.contains(menu)).toBe(true)
      menu.click()
      await settle()
      expect(menu.getAttribute('aria-expanded')).toBe('true')
      expect(wrapper.find('[data-testid="nav-drawer-panel"]').exists()).toBe(true)
    } finally {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
      fullscreenRoot.remove()
    }
  })

  it('平板 / 桌面伪全屏隐藏侧栏后，播放器托管的菜单入口仍能打开导航抽屉', async () => {
    layoutState.isCompact.value = false
    layoutState.isDrawerShell.value = false
    const { wrapper } = await mountApp('/?view=replay')
    expect(wrapper.find('[data-testid="app-sidebar"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nav-drawer-panel"]').exists()).toBe(false)
    await wrapper.get('[data-testid="ws-desktop-pseudo-nav"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="app-sidebar"]').exists()).toBe(true)
    await wrapper.get('[data-testid="nav-menu"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="nav-drawer-panel"]').exists()).toBe(true)
  })

  it('桌面伪全屏：播放器交还导航托管（控制条收起 / UI 隐藏）后备用菜单与抽屉仍可用', async () => {
    layoutState.isCompact.value = false
    layoutState.isDrawerShell.value = false
    const { wrapper } = await mountApp('/?view=replay')
    await wrapper.get('[data-testid="ws-desktop-pseudo-nav"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="nav-menu"]').exists()).toBe(true)
    await wrapper.get('[data-testid="ws-desktop-pseudo-nav-release"]').trigger('click')
    await settle()
    expect(wrapper.findAll('[data-testid="nav-menu"]')).toHaveLength(1)
    await wrapper.get('[data-testid="nav-menu"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="nav-drawer-panel"]').exists()).toBe(true)
  })

  it('does not render the tab bar or top bar on wider layouts; the sidebar carries navigation', async () => {
    const { wrapper } = await mountApp('/?view=hof')
    expect(wrapper.find('[data-testid="app-tab-bar"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="app-top-bar"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="app-sidebar"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="nav-hof"]').attributes('aria-current')).toBe('page')
  })

  it('opens the 更多 panel from the sidebar with display settings and about links, and closes on Escape', async () => {
    const { wrapper, router } = await mountApp('/?view=replay')
    const trigger = wrapper.get('[data-testid="nav-more"]')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('true')
    const panel = wrapper.get('[data-testid="more-panel"]')
    expect(panel.find('[data-testid="more-panel-ui-profile"]').exists()).toBe(true)
    expect(panel.find('[data-testid="more-panel-language"]').exists()).toBe(true)
    await panel.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[data-testid="more-panel"]').exists()).toBe(false)

    await trigger.trigger('click')
    await wrapper.get('[data-testid="more-link-history"]').trigger('click')
    await settle()
    expect(router.currentRoute.value.query.view).toBe('history')
    expect(wrapper.find('[data-testid="more-panel"]').exists()).toBe(false)
  })

  it('shows the admin group in the sidebar only for the matching roles', async () => {
    const plain = await mountApp('/?view=replay')
    expect(plain.wrapper.find('[data-testid="nav-admin-users"]').exists()).toBe(false)
    plain.wrapper.unmount()
    authState.isAdminRef.value = true
    const { wrapper } = await mountApp('/?view=replay')
    expect(wrapper.get('[data-testid="nav-admin-users"]').attributes('aria-current')).toBeUndefined()
    expect(wrapper.find('[data-testid="nav-hof-admin"]').exists()).toBe(true)
    authState.isAdminRef.value = false
  })

  it('shows only tournament management for a tournament-only administrator', async () => {
    authState.isTournamentAdminRef.value = true
    try {
      const { wrapper } = await mountApp('/?view=replay')
      expect(wrapper.find('[data-testid="nav-tournament-points-config"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="nav-tournament-points-admin"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="nav-admin-users"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="nav-hof-admin"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="nav-creators-config"]').exists()).toBe(false)
    } finally { authState.isTournamentAdminRef.value = false }
  })

  it('separates content and tournament administration at the page gate', async () => {
    setAuthState('authenticated', true)
    authState.isContentAdminRef.value = true
    try {
      const { wrapper } = await mountApp('/?view=creators-config')
      expect(wrapper.text()).not.toContain('tournament.adminRequired')
    } finally { authState.isContentAdminRef.value = false }

    authState.isTournamentAdminRef.value = true
    try {
      const content = await mountApp('/?view=creators-config')
      expect(content.wrapper.text()).toContain('creators.adminRequired')
      const tournament = await mountApp('/?view=tournament-points-admin')
      expect(tournament.wrapper.text()).not.toContain('tournament.adminRequired')
      expect(tournament.wrapper.find('[data-test="view-tournament-admin"]').exists()).toBe(true)
    } finally { authState.isTournamentAdminRef.value = false }
  })

  it.each([['tournament-points-config', 'view-tournament-config'], ['tournament-points-admin', 'view-tournament-admin']])('admits a tournament-only administrator at the %s page gate', async (view, testId) => {
    authState.isTournamentAdminRef.value = true
    setAuthState('authenticated', true)
    try {
      const { wrapper } = await mountApp('/?view=' + view)
      expect(wrapper.find(`[data-test="${testId}"]`).exists()).toBe(true)
      expect(wrapper.text()).not.toContain('tournament.adminRequired')
    } finally { authState.isTournamentAdminRef.value = false }
  })

  it('opens the project history view from 更多', async () => {
    const { wrapper, router } = await mountApp('/?view=more')
    await wrapper.get('[data-testid="more-link-history"]').trigger('click')
    await settle()
    expect(router.currentRoute.value.query.view).toBe('history')
    expect(wrapper.find('[data-test="view-history"]').exists()).toBe(true)
  })
})
