// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import {
  ALLOWED_VIEWS,
  defaultView,
  locationForView,
  PRIMARY_NAV,
  ADMIN_NAV,
  primaryNavItems,
  primarySection,
  sectionTitleKey,
  viewFromRoute,
} from './navigation.js'

describe('viewFromRoute publicly discoverable Agent views', () => {
  it.each(['agent-replay', 'agent-shots', 'agent-armor'])('resolves %s without a role option', view => {
    expect(ALLOWED_VIEWS).toContain(view)
    expect(viewFromRoute({ path: '/', query: { view } })).toBe(view)
  })

  it('still falls back to the default view for unknown views', () => {
    expect(viewFromRoute({ path: '/', query: { view: 'nope-not-a-view' } })).toBe(defaultView())
  })
})

describe('primary navigation', () => {
  it('groups the type entry and both lists under one recommendation destination', () => {
    expect(PRIMARY_NAV.find(item => item.id === 'creators').view).toBe('recommendations')
    for (const view of ['creators', 'recommended-videos', 'recommendations']) {
      expect(viewFromRoute({ path: '/', query: { view } })).toBe(view)
      expect(primarySection(view)).toBe('creators')
    }
    const route = { path: '/', query: { view: 'creators', creatorCategory: '4', keep: 'yes' }, hash: '#list' }
    expect(locationForView('recommended-videos', route)).toEqual({ path: '/', query: { view: 'recommended-videos', keep: 'yes' }, hash: '#list' })
    expect(locationForView('recommendations', { path: '/', query: { view: 'creators-config', recommendationType: 'VIDEO', keep: 'yes' }, hash: '#list' }).query)
      .toEqual({ view: 'recommendations', keep: 'yes' })
  })
  it('discovers creator pages and cleans only creator-owned filter state when leaving', () => {
    expect(PRIMARY_NAV.findIndex(item => item.id === 'creators')).toBe(PRIMARY_NAV.findIndex(item => item.id === 'league-broadcasts') + 1)
    expect(PRIMARY_NAV.findIndex(item => item.id === 'more')).toBe(PRIMARY_NAV.findIndex(item => item.id === 'creators') + 1)
    expect(primarySection('creators')).toBe('creators')
    expect(sectionTitleKey('creators')).toBe('creators.nav')
    expect(viewFromRoute({ path: '/', query: { view: 'creators' } })).toBe('creators')
    expect(ADMIN_NAV.find(item => item.view === 'creators-config')?.role).toBe('contentAdmin')
    const route = { path: '/', query: { view: 'creators', creatorCategory: '3', lang: 'ru' } }
    expect(locationForView('replay', route).query).toEqual({ view: 'replay', lang: 'ru' })
    expect(locationForView('creators', route).query).toEqual(route.query)
  })
  it('places broadcasts directly after standings as one public primary section', () => {
    expect(viewFromRoute({ path: '/', query: { view: 'league-broadcasts' } })).toBe('league-broadcasts')
    expect(primarySection('league-broadcasts')).toBe('league-broadcasts')
    expect(sectionTitleKey('league-broadcasts')).toBe('leagueBroadcasts.title')
    expect(PRIMARY_NAV.findIndex(item => item.id === 'league-broadcasts'))
      .toBe(PRIMARY_NAV.findIndex(item => item.id === 'tournament-points') + 1)
    expect(ADMIN_NAV.some(item => item.view.startsWith('league-broadcasts'))).toBe(false)
    const route = { path: '/', query: { view: 'league-broadcasts', lbServer: 'CN', lbSeason: '4', lbCategory: '9', lang: 'zh' } }
    expect(locationForView('league-broadcasts', route).query).toEqual(route.query)
    expect(locationForView('replay', route).query).toEqual({ view: 'replay', lang: 'zh' })
  })
  it('maps every Replay capability to the Replay section', () => {
    for (const view of ['replay', 'ai-review', 'battle-playback', 'agent-replay', 'agent-shots']) {
      expect(primarySection(view)).toBe('replay')
    }
  })

  it('maps settings and about pages to 更多; tankopedia and each admin page have their own section', () => {
    for (const view of ['more', 'history', 'technical-evolution', 'contact', 'sponsor', 'android', 'rating-docs']) {
      expect(primarySection(view)).toBe('more')
    }
    for (const view of ['agent-tankopedia', 'agent-armor']) expect(primarySection(view)).toBe('tankopedia')
    // 科技树是坦克百科的**平级**栏目（不是坦克百科的子页）
    expect(primarySection('agent-techtree')).toBe('techtree')
    expect(sectionTitleKey('agent-techtree')).toBe('research.title')
    expect(PRIMARY_NAV.findIndex(item => item.id === 'techtree'))
      .toBe(PRIMARY_NAV.findIndex(item => item.id === 'tankopedia') + 1)
    for (const item of ADMIN_NAV) expect(primarySection(item.view)).toBe(item.id)
    expect(primarySection('profile')).toBe('account')
    expect(primarySection('hof')).toBe('hof')
    expect(primarySection('home')).toBe('home')
  })

  it('only offers Home on the production home host', () => {
    expect(primaryNavItems('wotbtools.com').map(item => item.id)).toEqual(['home', 'replay', 'hof', 'tankopedia', 'techtree', 'tournament-points', 'league-broadcasts', 'creators', 'more'])
    expect(primaryNavItems('localhost').map(item => item.id)).toEqual(['replay', 'hof', 'tankopedia', 'techtree', 'tournament-points', 'league-broadcasts', 'creators', 'more'])
  })

  it('omits Home in the APK and resolves startup or stale Home links to Replay', () => {
    vi.stubEnv('MODE', 'android')
    try {
      const expected = ['replay', 'hof', 'tankopedia', 'techtree', 'tournament-points', 'league-broadcasts', 'creators', 'more']
      expect(primaryNavItems('127.0.0.1').map(item => item.id)).toEqual(expected)
      expect(primaryNavItems('wotbtools.com').map(item => item.id)).toEqual(expected)
      expect(defaultView('127.0.0.1')).toBe('replay')
      expect(defaultView('wotbtools.com')).toBe('replay')
      expect(viewFromRoute({ path: '/', query: { view: 'home' } })).toBe('replay')
    } finally { vi.unstubAllEnvs() }
  })

  it('resolves the public league deep link to its own selected section and title', () => {
    const view = viewFromRoute({ path: '/', query: { view: 'tournament-points' } })
    expect(view).toBe('tournament-points')
    expect(primarySection(view)).toBe('tournament-points')
    expect(sectionTitleKey(view)).toBe('tournament.title')
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
    const tankRoute = {
      path: '/',
      query: {
        view: 'agent-tankopedia', q: 'is7', tier: '10', nation: 'ussr', type: 'heavyTank', sort: 'hp',
        tank: '5', config: '1', engine: '2', track: '1', shell: '1', dev: '01-1', cons: 'afterburning',
        prov: 'ration', skills: 'smooth_driving:7', camo: '1', lang: 'x',
      },
    }
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
