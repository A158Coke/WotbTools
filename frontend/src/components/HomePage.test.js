// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import HomePage from './HomePage.vue'
import { VIEW_COMPONENTS } from '../app/viewRegistry.js'
import { ONBOARDING_KEY } from '../shared/onboarding.js'

const api = vi.hoisted(() => ({
  hofList: vi.fn(() => Promise.resolve({ items: [] }))
}))

vi.mock('../utils/api.js', () => api)
// locale 必须是真 ref：模板只自动解包真 ref，普通 { value } 会被 String() 成
// "[object Object]" 并静默回落到 mapLabel 的 zh 兜底，这条断言就验证不到 locale 的传递。
vi.mock('vue-i18n', async () => {
  const { ref } = await import('vue')
  return { useI18n: () => ({ t: key => key, locale: ref('en') }) }
})

const connectivityState = vi.hoisted(() => ({ state: null, settled: null }))
vi.mock('../composables/useConnectivity.js', async () => {
  const { ref } = await import('vue')
  connectivityState.state = ref('online')
  connectivityState.settled = ref(true)
  return { useConnectivity: () => ({ connectivity: connectivityState.state, settled: connectivityState.settled, isSettled: () => connectivityState.settled.value, whenSettled: () => Promise.resolve() }) }
})

function mountPage(onboarding = null) {
  return mount(HomePage, {
    global: {
      mocks: { $t: key => key },
      provide: { [ONBOARDING_KEY]: onboarding },
      stubs: {
        RouterLink: {
          props: ['to'],
          template: '<a :href="typeof to === \'string\' ? to : to.path"><slot /></a>'
        }
      }
    }
  })
}

const stat = (wrapper, index) => wrapper.findAll('.home-stats .home-stat')[index]

/**
 * 一个链接真正去往哪里 —— 按 **组件对象的引用** 判定，不是 href 字符串、也不是组件名。
 * `?view=replay` / `?view=ai-review` / `?view=battle-playback` 是三个不同的 href，
 * 却都落在同一个 ReplayWorkspace（viewRegistry.js:30-32）：比字符串会把它们当三个入口。
 * 比组件名同样不行 —— 这些 view 是懒加载的，每个都叫 AsyncComponentWrapper。
 */
function destinationOf(href) {
  const view = /^\/\?view=([\w-]+)$/.exec(href || '')?.[1]
  if (!view) return href
  return VIEW_COMPONENTS[view] ?? href
}

const hrefsOf = wrapper => wrapper.findAll('a').map(a => a.attributes('href')).filter(Boolean)

describe('HomePage Hall of Fame data band', () => {
  beforeEach(() => {
    api.hofList.mockReset()
    connectivityState.state.value = 'online'
    connectivityState.settled.value = true
  })

  it('cold start: waits for the first connectivity check instead of showing -- forever', async () => {
    // 冷启动：首次检测未完成，HoF 门禁 fail-closed —— 不得在此时请求（请求会被门禁拒绝）
    connectivityState.state.value = 'unknown'
    connectivityState.settled.value = false
    api.hofList.mockResolvedValue({ items: [{ damageDealt: 10483 }], totalItems: 2048 })
    const wrapper = mountPage()
    await flushPromises()
    expect(api.hofList).not.toHaveBeenCalled()
    expect(stat(wrapper, 0).find('strong').text()).toBe('--')
    // 检测完成且在线 → 补加载一次
    connectivityState.state.value = 'online'
    connectivityState.settled.value = true
    await flushPromises()
    expect(api.hofList).toHaveBeenCalledTimes(1)
    expect(stat(wrapper, 0).find('strong').text()).toBe('10 483')
    wrapper.unmount()
  })

  it('formats the top damage record with thousands separators (regression: formatCount regex)', async () => {
    api.hofList.mockResolvedValue({ items: [{ damageDealt: 10483 }], totalItems: 1 })
    const wrapper = mountPage()
    await flushPromises()
    expect(stat(wrapper, 0).find('strong').text()).toBe('10 483')
    wrapper.unmount()
  })

  it('formats 123456 as 123 456', async () => {
    api.hofList.mockResolvedValue({ items: [{ damageDealt: 123456 }], totalItems: 1 })
    const wrapper = mountPage()
    await flushPromises()
    expect(stat(wrapper, 0).find('strong').text()).toBe('123 456')
    wrapper.unmount()
  })

  // 生产实测（2026-10-18）：/api/hof 的 mapName 是原始 key `savanna`，直接渲染就把
  // 内部 key 摆在 hero 上。走 common/map_names.json 的三语表（与 Playback 同一个 mapLabel）。
  it('localizes the map name instead of printing the raw map key', async () => {
    api.hofList.mockResolvedValue({ items: [{ damageDealt: 10483, tankName: 'Leopard 1', nickname: 'xkdkw', mapName: 'savanna' }], totalItems: 591 })
    const wrapper = mountPage()
    await flushPromises()
    const meta = stat(wrapper, 0).findAll('.home-stat-meta small').map(e => e.text())
    expect(meta[0]).toBe('xkdkw')
    expect(meta[1]).toBe('Oasis Palms')
    expect(meta[1]).not.toBe('savanna')
    wrapper.unmount()
  })

  it('falls back to the raw value when the map is not in the three-language table', async () => {
    api.hofList.mockResolvedValue({ items: [{ damageDealt: 1, mapName: 'not_a_real_map' }], totalItems: 1 })
    const wrapper = mountPage()
    await flushPromises()
    expect(stat(wrapper, 0).findAll('.home-stat-meta small')[1].text()).toBe('not_a_real_map')
    wrapper.unmount()
  })

  it('reads the record total from the same response — the band costs no extra request', async () => {
    api.hofList.mockResolvedValue({ items: [{ damageDealt: 10483 }], totalItems: 2048 })
    const wrapper = mountPage()
    await flushPromises()
    expect(api.hofList).toHaveBeenCalledTimes(1)
    expect(stat(wrapper, 1).find('strong').text()).toBe('2 048')
    wrapper.unmount()
  })

  it('shows -- for both numbers when the leaderboard request fails', async () => {
    api.hofList.mockRejectedValue(new Error('down'))
    const wrapper = mountPage()
    await flushPromises()
    expect(stat(wrapper, 0).find('strong').text()).toBe('--')
    expect(stat(wrapper, 1).find('strong').text()).toBe('--')
    wrapper.unmount()
  })

  // 「收录 0 条」是事实，「不知道收录多少」是未知态 —— Number(null) === 0 会把后者伪装成前者。
  it('tells an empty leaderboard (0) apart from a missing total (--)', async () => {
    api.hofList.mockResolvedValue({ items: [], totalItems: 0 })
    const empty = mountPage()
    await flushPromises()
    expect(stat(empty, 0).find('strong').text()).toBe('--')
    expect(stat(empty, 1).find('strong').text()).toBe('0')
    empty.unmount()

    api.hofList.mockResolvedValue({ items: [{ damageDealt: 10483 }] })
    const missing = mountPage()
    await flushPromises()
    expect(stat(missing, 1).find('strong').text()).toBe('--')
    missing.unmount()
  })
})

describe('HomePage information architecture — every entry appears exactly once', () => {
  beforeEach(() => {
    api.hofList.mockReset()
    api.hofList.mockResolvedValue({ items: [], totalItems: 0 })
  })

  /**
   * 本次重排的核心不变量。重排前首页是三份互相重复的导航副本：回放四次、
   * AI 复盘 / 战局重建 / 名人堂 / 赞助 / Android 各两次。这条断言是那次回归的护栏。
   */
  it('no destination is duplicated anywhere on the page', () => {
    const wrapper = mountPage({ start: vi.fn(), openDirectory: vi.fn() })
    const firstHrefFor = new Map()
    const duplicated = []
    for (const href of hrefsOf(wrapper)) {
      const destination = destinationOf(href)
      if (firstHrefFor.has(destination)) duplicated.push(`${href} (same destination as ${firstHrefFor.get(destination)})`)
      else firstHrefFor.set(destination, href)
    }
    expect(duplicated, `duplicated destinations: ${duplicated.join('; ')}`).toEqual([])
    wrapper.unmount()
  })

  // 上一条按组件引用去重的前提。前提一旦不成立（比如 ai-review 真的拆成独立页面），
  // 这里先红，提醒重新判断它该不该作为一级功能上首页。
  it('the five replay views really are one component', () => {
    for (const view of ['ai-review', 'battle-playback', 'agent-replay', 'agent-shots']) {
      expect(VIEW_COMPONENTS[view], view).toBe(VIEW_COMPONENTS.replay)
    }
  })

  /**
   * 首页只放一级功能：回放工作台的五个能力（data / 3d / shots / playback / ai）是同一个
   * ReplayWorkspace 的 tab，不是独立目的地，因此整页只能有 Hero 那一个回放入口。
   */
  it('the replay workspace is reachable only through the single hero primary CTA', () => {
    const wrapper = mountPage()
    const toWorkspace = hrefsOf(wrapper).filter(href => destinationOf(href) === VIEW_COMPONENTS.replay)
    expect(toWorkspace).toEqual(['/?view=replay'])

    const primary = wrapper.get('.home-cta-primary')
    expect(primary.text()).toBe('home.replayParse')
    expect(primary.attributes('href')).toBe('/?view=replay')
    expect(primary.classes()).toContain('is-primary')
    expect(wrapper.findAll('.home-hero-actions .is-primary')).toHaveLength(1)
    wrapper.unmount()
  })

  it('no replay capability tab is surfaced as its own homepage entry', () => {
    const wrapper = mountPage()
    for (const view of ['ai-review', 'battle-playback', 'agent-replay', 'agent-shots']) {
      expect(wrapper.find(`a[href="/?view=${view}"]`).exists(), view).toBe(false)
    }
    wrapper.unmount()
  })

  it('the hero carries no secondary feature buttons any more', () => {
    const wrapper = mountPage()
    const heroLinks = wrapper.findAll('.home-hero-actions a').map(a => a.attributes('href'))
    expect(heroLinks).toEqual(['/?view=replay'])
    wrapper.unmount()
  })

  it('opens the complete feature directory from the prominent homepage tutorial button', async () => {
    const start = vi.fn()
    const openDirectory = vi.fn()
    const wrapper = mountPage({ start, openDirectory })
    const tutorial = wrapper.get('[data-testid="home-onboarding"]')
    expect(tutorial.text()).toBe('onboarding.newbie')
    expect(tutorial.classes()).toContain('home-cta-guide')
    expect(tutorial.classes()).toContain('is-secondary')
    expect(wrapper.find('.home-hero-hint').text()).toBe('onboarding.newbieHint')
    await tutorial.trigger('click')
    expect(openDirectory).toHaveBeenCalledTimes(1)
    expect(start).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('the Hall of Fame leads the feature section — it owns the numbers in the stat band', () => {
    const wrapper = mountPage()
    const lead = wrapper.get('.home-feature-lead')
    expect(lead.attributes('href')).toBe('/?view=hof')
    expect(lead.find('h3').text()).toBe('hof.btn')
    expect(lead.find('.home-feature-action').text()).toBe('hof.btn')
    wrapper.unmount()
  })

  it('surfaces the four entries that only existed in the sidebar before', () => {
    const wrapper = mountPage()
    const cards = wrapper.findAll('.home-feature-card')
    expect(cards.map(card => card.attributes('href'))).toEqual([
      '/?view=agent-tankopedia',
      '/?view=tournament-points',
      '/?view=league-broadcasts',
      '/?view=recommendations',
    ])
    expect(cards.map(card => card.find('span').text())).toEqual([
      'nav.tankopedia',
      'tournament.title',
      'leagueBroadcasts.title',
      'creators.nav',
    ])
    wrapper.unmount()
  })

  it('creators point at the recommendations view, not the retired creators view', () => {
    const wrapper = mountPage()
    expect(wrapper.find('a[href="/?view=creators"]').exists()).toBe(false)
    expect(wrapper.find('a[href="/?view=recommendations"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('the footer bar keeps sponsor, Android download and feedback — and nothing the More page already owns', () => {
    const wrapper = mountPage()
    const bar = wrapper.get('.home-footer-bar')
    expect(bar.findAll('a').map(a => a.attributes('href'))).toEqual([
      '/sponsor',
      '/download/android',
      'https://github.com/A158Coke/WotbTools/issues/new',
    ])
    // 项目历史 / 技术演进 / 联系我 由 useMoreMenu 的「更多」信息组承载，首页不再抄一份
    for (const view of ['history', 'technical-evolution', 'contact']) {
      expect(wrapper.find(`a[href="/?view=${view}"]`).exists(), view).toBe(false)
    }
    wrapper.unmount()
  })

  it('the three duplicated panels of the previous homepage are gone', () => {
    const wrapper = mountPage()
    for (const selector of ['.replay-panel', '.analysis-panel', '.quick-panel', '.feature-card', '.record-card', '.home-core-card']) {
      expect(wrapper.find(selector).exists(), selector).toBe(false)
    }
    expect(wrapper.text()).not.toContain('upload.select_files')
    wrapper.unmount()
  })
})
