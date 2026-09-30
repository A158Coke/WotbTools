// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  ADMIN_ONLY_VIEWS,
  ALLOWED_VIEWS,
  defaultView,
  isAdminOnlyView,
  viewFromRoute,
} from './navigation.js'

/**
 * admin-only 视图的可见性边界（feature flag：wotbtools-admin）。
 * 导航入口的隐藏只是 UI 层面的收敛——真正的边界在这里：非管理员直达深链
 * `?view=agent-*` 必须被收敛回默认视图，否则 flag 形同虚设。
 */
describe('viewFromRoute admin-only gating', () => {
  const routeFor = (view) => ({ path: '/', query: { view } })

  it('keeps every admin-only view registered in the navigable allowlist', () => {
    // 注册（ALLOWED_VIEWS/VIEW_COMPONENTS）与可见性（ADMIN_ONLY_VIEWS）是两件事：
    // 视图仍须登记，否则 App.test.js 的"两条清单恒等"不变量会破，且深链无法解析
    for (const view of ADMIN_ONLY_VIEWS) {
      expect(ALLOWED_VIEWS).toContain(view)
      expect(isAdminOnlyView(view)).toBe(true)
    }
    expect(isAdminOnlyView('replay')).toBe(false)
    expect(isAdminOnlyView('hof')).toBe(false)
  })

  it('denies admin-only views by default (fail-closed)', () => {
    for (const view of ADMIN_ONLY_VIEWS) {
      expect(viewFromRoute(routeFor(view))).toBe(defaultView())
    }
  })

  it('denies admin-only views when allowAdminViews is explicitly false', () => {
    expect(viewFromRoute(routeFor('agent-shots'), { allowAdminViews: false })).toBe(defaultView())
  })

  it('resolves admin-only views when allowAdminViews is true', () => {
    for (const view of ADMIN_ONLY_VIEWS) {
      expect(viewFromRoute(routeFor(view), { allowAdminViews: true })).toBe(view)
    }
  })

  it('leaves ordinary views unaffected by the admin flag', () => {
    for (const view of ['replay', 'hof', 'history', 'battle-playback']) {
      expect(viewFromRoute(routeFor(view))).toBe(view)
      expect(viewFromRoute(routeFor(view), { allowAdminViews: true })).toBe(view)
    }
  })

  it('still falls back to the default view for unknown views', () => {
    expect(viewFromRoute(routeFor('nope-not-a-view'))).toBe(defaultView())
    expect(viewFromRoute(routeFor('nope-not-a-view'), { allowAdminViews: true })).toBe(defaultView())
  })
})
