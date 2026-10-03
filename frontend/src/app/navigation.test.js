// @vitest-environment happy-dom
import { vi, describe, expect, it } from 'vitest'
import {
  ADMIN_ONLY_VIEWS,
  ALLOWED_VIEWS,
  defaultView,
  isAdminOnlyView,
  locationForView,
  PRIMARY_NAV,
  ADMIN_NAV,
  primaryNavItems,
  primarySection,
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

  it('URL 参数绝不能放开 admin 视图：dev 下带 ?agentViews=1 也必须 fail-closed', async () => {
    // 回归护栏：曾经有一版本按 `window.location.search` 里的 `agentViews` 在 dev 构建放行
    // admin 视图（本机旁路被误提交，review BLOCKER）。这条用例按真实首屏复现——URL 带参数、
    // 模块**重新加载**后再问一次；只要源码里再出现任何基于 URL 的放行，这里立刻失败。
    window.history.replaceState({}, '', '/?view=agent-replay&agentViews=1&admin=1')
    try {
      vi.resetModules()
      const fresh = await import('./navigation.js')
      for (const view of fresh.ADMIN_ONLY_VIEWS) {
        expect(fresh.viewFromRoute({ path: '/', query: { view } }, { allowAdminViews: false })).toBe(fresh.defaultView())
        expect(fresh.viewFromRoute({ path: '/', query: { view } })).toBe(fresh.defaultView())
      }
    } finally {
      window.history.replaceState({}, '', '/')
      vi.resetModules()
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

describe('primary navigation', () => {
  it('maps every Replay capability (and the admin 3D / shot modes) to the Replay section', () => {
    for (const view of ['replay', 'ai-review', 'battle-playback', 'agent-replay', 'agent-shots']) {
      expect(primarySection(view)).toBe('replay')
    }
  })

  it('maps settings and about pages to 更多; tankopedia and each admin page have their own section', () => {
    for (const view of ['more', 'history', 'technical-evolution', 'contact', 'sponsor', 'android', 'rating-docs']) {
      expect(primarySection(view)).toBe('more')
    }
    for (const view of ['agent-tankopedia', 'agent-armor']) expect(primarySection(view)).toBe('tankopedia')
    for (const item of ADMIN_NAV) expect(primarySection(item.view)).toBe(item.id)
    expect(primarySection('profile')).toBe('account')
    expect(primarySection('hof')).toBe('hof')
    expect(primarySection('home')).toBe('home')
  })

  it('only offers Home on the production home host', () => {
    expect(primaryNavItems('wotbtools.com').map(item => item.id)).toEqual(['home', 'replay', 'hof', 'tankopedia', 'more'])
    expect(primaryNavItems('localhost').map(item => item.id)).toEqual(['replay', 'hof', 'tankopedia', 'more'])
  })

  it('points every primary and admin item at a registered view', () => {
    for (const item of [...PRIMARY_NAV, ...ADMIN_NAV]) expect(ALLOWED_VIEWS).toContain(item.view)
  })
})

describe('locationForView：名人堂筛选只属于名人堂', () => {
  const hofRoute = { path: '/', query: { view: 'hof', tab: 'hundred', tank: '123', page: '3', lang: 'x' } }
  it('离开名人堂时丢掉筛选键，保留其他参数', () => {
    expect(locationForView('replay', hofRoute).query).toEqual({ view: 'replay', lang: 'x' })
    expect(locationForView('agent-tankopedia', hofRoute).query).toEqual({ view: 'agent-tankopedia', lang: 'x' })
  })
  it('离开坦克百科时丢掉百科的筛选 / 详情键，留在百科时保留', () => {
    const tankRoute = { path: '/', query: { view: 'agent-tankopedia', q: 'is7', tier: '10', nation: 'ussr', type: 'heavyTank', sort: 'hp', tank: '5', config: '1', lang: 'x' } }
    expect(locationForView('replay', tankRoute).query).toEqual({ view: 'replay', lang: 'x' })
    expect(locationForView('agent-tankopedia', tankRoute).query).toEqual(tankRoute.query)
  })
  it('留在名人堂时保留；从别的页面进来时不把同名参数当成筛选', () => {
    expect(locationForView('hof', hofRoute).query).toEqual(hofRoute.query)
    expect(locationForView('hof', { path: '/', query: { view: 'agent-tankopedia', tank: '5' } }).query)
      .toEqual({ view: 'hof' })
  })

  it('装甲查看器 / 射击复现场景参数只属于该视图：切走时整组丢掉，保留无关参数', () => {
    const armorRoute = {
      path: '/',
      query: {
        view: 'agent-armor', tank: '13825', shot: '2', shooter: '19969', shell: '0', scfg: '0',
        world: '1', heatmap: '1', az: '45', d: '12', clean: '1', lang: 'x',
      },
    }
    // 侧边栏切走：不留任何场景参数（用户实测：此前会带上 tank/shot/shooter/…）
    expect(locationForView('replay', armorRoute).query).toEqual({ view: 'replay', lang: 'x' })
    expect(locationForView('agent-tankopedia', armorRoute).query).toEqual({ view: 'agent-tankopedia', lang: 'x' })
    expect(locationForView('hof', armorRoute).query).toEqual({ view: 'hof', lang: 'x' })
    // 留在装甲查看器内（如切换能力后又回到同一视图）保留全部场景参数
    expect(locationForView('agent-armor', armorRoute).query).toEqual(armorRoute.query)
  })

  it('进入装甲查看器时保留场景参数：交接链接不得在入场方向被吞掉', () => {
    // 以 URL 表达的交接（射击分析的复现链接 / 坦克百科的详情入口）在入场时必须原样保留——
    // 清理只针对"离开场景"，与坦克百科那条规则同向。任何方向的误删都会让复现那发直接丢参数。
    const handoff = {
      path: '/',
      query: {
        view: 'agent-shots', tank: '13825', shooter: '19969', shot: '2', shell: '0', scfg: '0',
        world: '1', heatmap: '1', lang: 'x',
      },
    }
    expect(locationForView('agent-armor', handoff).query).toEqual({ ...handoff.query, view: 'agent-armor' })

    // 场景独有键（world / heatmap / clean）同理：入场保留，切走才清
    const sceneOnly = { path: '/', query: { view: 'replay', world: '1', heatmap: '1', clean: '1' } }
    expect(locationForView('agent-armor', sceneOnly).query)
      .toEqual({ view: 'agent-armor', world: '1', heatmap: '1', clean: '1' })
  })
})
