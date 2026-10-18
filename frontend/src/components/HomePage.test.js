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
// "[object Object]" 并静默回落到 mapLabel 的 zh 兜底，地图名断言就验证不到 locale 的传递。
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
const hrefsOf = wrapper => wrapper.findAll('a').map(a => a.attributes('href')).filter(Boolean)

/**
 * Where a link actually goes — by **component object identity**, not the href string and not
 * the component name. `?view=replay` / `?view=ai-review` / `?view=battle-playback` are three
 * different hrefs that all land on the same ReplayWorkspace (viewRegistry.js:30-32), and every
 * view is lazy-loaded so they all share the name AsyncComponentWrapper.
 */
function destinationOf(href) {
  const view = /^\/\?view=([\w-]+)$/.exec(href || '')?.[1]
  if (!view) return href
  return VIEW_COMPONENTS[view] ?? href
}

describe('HomePage is a showcase, not a navigation surface', () => {
  beforeEach(() => {
    api.hofList.mockReset()
    api.hofList.mockResolvedValue({ items: [], totalItems: 0 })
  })

  /**
   * 首页不承担导航：侧边栏（AppSidebar）与底部 Tab 栏（AppTabBar）已经覆盖 PRIMARY_NAV 的
   * 全部入口，首页只留一个转化动作加两个侧边栏没有的非功能入口。这条断言是那次回归的护栏。
   */
  it('exposes exactly three destinations: the replay workspace, sponsor and feedback', () => {
    const wrapper = mountPage({ start: vi.fn(), openDirectory: vi.fn() })
    expect(hrefsOf(wrapper)).toEqual([
      '/?view=replay',
      '/sponsor',
      'https://github.com/A158Coke/WotbTools/issues/new',
    ])
    wrapper.unmount()
  })

  it('the showcase section carries no links at all', () => {
    const wrapper = mountPage()
    const section = wrapper.get('.home-showcase')
    expect(section.findAll('a')).toHaveLength(0)
    expect(section.findAll('button')).toHaveLength(0)
    expect(section.findAll('.home-shot').length).toBeGreaterThanOrEqual(4)
    wrapper.unmount()
  })

  it('no replay capability tab is surfaced as its own entry', () => {
    const wrapper = mountPage()
    for (const view of ['ai-review', 'battle-playback', 'agent-replay', 'agent-shots']) {
      expect(wrapper.find(`a[href="/?view=${view}"]`).exists(), view).toBe(false)
    }
    wrapper.unmount()
  })

  it('no destination is duplicated, counted by component not by href', () => {
    const wrapper = mountPage({ start: vi.fn(), openDirectory: vi.fn() })
    const seen = new Map()
    const duplicated = []
    for (const href of hrefsOf(wrapper)) {
      const destination = destinationOf(href)
      if (seen.has(destination)) duplicated.push(`${href} (same destination as ${seen.get(destination)})`)
      else seen.set(destination, href)
    }
    expect(duplicated, duplicated.join('; ')).toEqual([])
    wrapper.unmount()
  })

  // 上一条按组件引用去重的前提。前提一旦不成立（比如 ai-review 真的拆成独立页面），
  // 这里先红，提醒重新判断它该不该上首页。
  it('the five replay views really are one component', () => {
    for (const view of ['ai-review', 'battle-playback', 'agent-replay', 'agent-shots']) {
      expect(VIEW_COMPONENTS[view], view).toBe(VIEW_COMPONENTS.replay)
    }
  })

  it('the single CTA is the replay workspace', () => {
    const wrapper = mountPage()
    const cta = wrapper.get('.home-cta')
    expect(cta.text()).toBe('home.replayParse')
    expect(cta.attributes('href')).toBe('/?view=replay')
    expect(cta.classes()).toContain('is-primary')
    expect(wrapper.findAll('.is-primary')).toHaveLength(1)
    wrapper.unmount()
  })

  it('opens the feature directory from the hero tutorial button', async () => {
    const start = vi.fn()
    const openDirectory = vi.fn()
    const wrapper = mountPage({ start, openDirectory })
    const tutorial = wrapper.get('[data-testid="home-onboarding"]')
    expect(tutorial.text()).toBe('onboarding.newbie')
    await tutorial.trigger('click')
    expect(openDirectory).toHaveBeenCalledTimes(1)
    expect(start).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('only the first showcase image loads eagerly; the rest stay lazy', () => {
    const wrapper = mountPage()
    const imgs = wrapper.findAll('.home-shot-figure img')
    expect(imgs.length).toBeGreaterThanOrEqual(4)
    expect(imgs[0].attributes('loading')).toBe('eager')
    expect(imgs.slice(1).every(img => img.attributes('loading') === 'lazy')).toBe(true)
    // 每张都要带固有尺寸，否则懒加载到视口时会抖版
    expect(imgs.every(img => img.attributes('width') && img.attributes('height'))).toBe(true)
    wrapper.unmount()
  })

  /**
   * QA 实测（2026-10-18）：进场动效原本是「默认 opacity: 0，onMounted 里 rAF 加 is-revealed」。
   * 页面没被绘制时 rAF 不触发——后台标签页加载 10 秒后整页仍是 opacity 0（2/2 复现），
   * 单帧截图 / 打印同理，JS 一出错更是永久空白。内容的可见性不能挂在 JS 上。
   */
  it('content visibility does not depend on any JS-applied class', () => {
    const wrapper = mountPage()
    expect(wrapper.get('.home-stage').classes()).not.toContain('is-revealed')
    expect(wrapper.html()).not.toContain('is-revealed')
    wrapper.unmount()
  })

  it('the panels of the previous homepage are all gone', () => {
    const wrapper = mountPage()
    for (const selector of ['.replay-panel', '.analysis-panel', '.quick-panel', '.feature-card', '.record-card', '.home-core-card', '.home-feature-card', '.home-feature-lead']) {
      expect(wrapper.find(selector).exists(), selector).toBe(false)
    }
    wrapper.unmount()
  })
})

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
    connectivityState.state.value = 'online'
    connectivityState.settled.value = true
    await flushPromises()
    expect(api.hofList).toHaveBeenCalledTimes(1)
    expect(stat(wrapper, 0).find('strong').text()).toBe('10 483')
    wrapper.unmount()
  })

  it('formats damage with thousands separators (regression: formatCount regex)', async () => {
    api.hofList.mockResolvedValue({ items: [{ damageDealt: 123456 }], totalItems: 1 })
    const wrapper = mountPage()
    await flushPromises()
    expect(stat(wrapper, 0).find('strong').text()).toBe('123 456')
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
    expect(stat(empty, 1).find('strong').text()).toBe('0')
    empty.unmount()

    api.hofList.mockResolvedValue({ items: [{ damageDealt: 10483 }] })
    const missing = mountPage()
    await flushPromises()
    expect(stat(missing, 1).find('strong').text()).toBe('--')
    missing.unmount()
  })

  // 生产实测：/api/hof 的 mapName 是原始 key `savanna`，直接渲染就把内部 key 摆在 hero 上。
  it('localizes the map name instead of printing the raw map key', async () => {
    api.hofList.mockResolvedValue({ items: [{ damageDealt: 10483, tankName: 'Leopard 1', nickname: 'xkdkw', mapName: 'savanna' }], totalItems: 591 })
    const wrapper = mountPage()
    await flushPromises()
    const meta = stat(wrapper, 0).get('.home-stat-meta').text()
    expect(meta).toContain('Oasis Palms')
    expect(meta).not.toContain('savanna')
    expect(meta).toContain('Leopard 1')
    expect(meta).toContain('xkdkw')
    wrapper.unmount()
  })

  it('falls back to the raw value when the map is not in the three-language table', async () => {
    api.hofList.mockResolvedValue({ items: [{ damageDealt: 1, mapName: 'not_a_real_map' }], totalItems: 1 })
    const wrapper = mountPage()
    await flushPromises()
    expect(stat(wrapper, 0).get('.home-stat-meta').text()).toContain('not_a_real_map')
    wrapper.unmount()
  })
})
