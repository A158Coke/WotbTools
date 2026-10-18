// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import HomePage from './HomePage.vue'
import { VIEW_COMPONENTS } from '../app/viewRegistry.js'
import { ONBOARDING_KEY } from '../shared/onboarding.js'

const api = vi.hoisted(() => ({
  hofList: vi.fn(() => Promise.resolve({ items: [] }))
}))
const platform = vi.hoisted(() => ({ android: false }))
const i18n = vi.hoisted(() => ({ locale: null }))

vi.mock('../utils/api.js', () => api)
vi.mock('../composables/usePlatformBridge.js', async importOriginal => ({
  ...await importOriginal(),
  isAndroidApp: () => platform.android,
}))
// locale 必须是真 ref：模板只自动解包真 ref，普通 { value } 会被 String() 成
// "[object Object]" 并静默回落到 mapLabel 的 zh 兜底，地图名断言就验证不到 locale 的传递。
vi.mock('vue-i18n', async () => {
  const { ref } = await import('vue')
  i18n.locale = ref('en')
  return { useI18n: () => ({ t: key => key, locale: i18n.locale }) }
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
    platform.android = false
    i18n.locale.value = 'en'
  })

  /**
   * 首页不承担导航：侧边栏（AppSidebar）与底部 Tab 栏（AppTabBar）已经覆盖 PRIMARY_NAV 的
   * 全部入口。首页只保留一个功能入口（回放工作台）与少量非功能 / 转化入口；不写死「恰好 N 个链接」。
   */
  it('treats the replay workspace as the only functional navigation entry', () => {
    const wrapper = mountPage({ start: vi.fn(), openDirectory: vi.fn() })
    const replayLinks = hrefsOf(wrapper).filter(href => destinationOf(href) === VIEW_COMPONENTS.replay)
    expect(replayLinks).toEqual(['/?view=replay'])
    wrapper.unmount()
  })

  // Android 下载与赞助是转化动作，不是功能导航（侧边栏里也没有它们），所以它们在首页
  // 有自己的版面，而不是页脚一行小字。
  it('gives Android and sponsorship a section of their own on the web', () => {
    const wrapper = mountPage()
    const take = wrapper.get('.home-take')
    const ctas = take.findAll('.home-take-cta')
    expect(ctas.map(c => c.attributes('href'))).toEqual(['/download/android', '/sponsor'])
    expect(take.find('.home-take-phone img').exists()).toBe(true)
    expect(wrapper.get('.home-take-grid').classes()).not.toContain('is-sponsor-only')
    expect(wrapper.get('.home-footer-bar').findAll('a')).toHaveLength(1)
    wrapper.unmount()
  })

  it('omits the entire Android promo inside the Android app but keeps sponsorship', () => {
    platform.android = true
    const wrapper = mountPage()
    expect(wrapper.find('a[href="/download/android"]').exists()).toBe(false)
    expect(wrapper.find('.home-take-phone').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('home.androidTitle')
    expect(wrapper.findAll('.home-take-card')).toHaveLength(1)
    expect(wrapper.get('.home-take-grid').classes()).toContain('is-sponsor-only')
    expect(wrapper.get('.home-take-card.is-sponsor').find('a[href="/sponsor"]').exists()).toBe(true)
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

/**
 * 模板里 `$t(item.titleKey)` / `$t(item.descKey)` 是动态 key，literal `$t('...')` 扫描抓不到。
 * 不在测试里解析 Vue SFC，显式列出 showcase 元数据的 key；showcase 增删项时这里同步。
 */
const SHOWCASE_KEYS = [
  'home.showcasePlaybackTitle', 'home.showcasePlaybackDesc',
  'home.showcaseArmorTitle', 'home.showcaseArmorDesc',
  'home.showcaseRatingTitle', 'home.showcaseRatingDesc',
  'home.showcaseTankopediaTitle', 'home.showcaseTankopediaDesc',
]

function missingKeys(keys, messages) {
  const missing = []
  for (const locale of ['zh', 'en', 'ru']) {
    for (const key of keys) {
      const value = key.split('.').reduce((node, part) => (node == null ? node : node[part]), messages[locale])
      if (typeof value !== 'string' || !value) missing.push(`${locale}:${key}`)
    }
  }
  return missing
}

// 这条是被实际 bug 逼出来的：模板引用了 `home.sponsorTag`，而那个 key 在更早一轮的
// 孤儿清理里已经删掉，页面上直接显示出原始 key。$t 在单测里被 mock 成 identity，
// 永远发现不了，所以改成拿模板源码对三份 locale 逐个核。
describe('HomePage i18n keys all resolve', () => {
  it('every literal key the template references exists in all three locales', async () => {
    // 用 Vite 的 `?raw` 取源码：它按**本文件**的位置解析，既不依赖 cwd
    // （从仓库根跑和从 frontend/ 跑不一样），在 happy-dom 下也没有 `import.meta.url`
    // 不是 file: URL 的问题。
    const [{ default: source }, { messages }] = await Promise.all([
      import('./HomePage.vue?raw'), import('../locales/messages.js'),
    ])
    const keys = [...new Set([...source.matchAll(/\$t\('([\w.]+)'\)/g)].map(m => m[1]))]
    expect(keys.length).toBeGreaterThan(10)
    expect(missingKeys(keys, messages), 'literal keys must resolve in zh / en / ru').toEqual([])
  })

  it('every dynamic showcase key exists in all three locales', async () => {
    const { messages } = await import('../locales/messages.js')
    const missing = missingKeys(SHOWCASE_KEYS, messages)
    expect(missing, `unresolved showcase keys: ${missing.join(', ')}`).toEqual([])
  })
})

// 窄静态安全门：确认 `color: transparent` 仍被同时要求 background-clip + color-mix 的
// @supports 包住。它不冒充浏览器行为验证；真实 motion / computed style 由
// `scripts/browser-home-reduced-motion.mjs` 覆盖。
describe('HomePage accent gradient capability fallback', () => {
  it('only makes the accent line transparent when background-clip and color-mix are both supported', async () => {
    const { default: source } = await import('./HomePage.vue?raw')
    const style = source.slice(source.indexOf('<style scoped>') + '<style scoped>'.length, source.indexOf('</style>'))
    const transparentAt = style.indexOf('color: transparent;')
    expect(transparentAt).toBeGreaterThan(-1)
    const supportsAt = style.lastIndexOf('@supports', transparentAt)
    expect(supportsAt).toBeGreaterThan(-1)
    const prelude = style.slice(supportsAt, style.indexOf('{', supportsAt))
    expect(prelude).toContain('background-clip: text')
    expect(prelude).toContain('color-mix')
  })
})

describe('HomePage Hall of Fame data band', () => {
  beforeEach(() => {
    api.hofList.mockReset()
    platform.android = false
    i18n.locale.value = 'en'
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
    expect(stat(wrapper, 0).find('strong').text()).toBe('10,483')
    wrapper.unmount()
  })

  it('formats damage with locale-aware thousands separators', async () => {
    api.hofList.mockResolvedValue({ items: [{ damageDealt: 123456 }], totalItems: 1 })
    const wrapper = mountPage()
    await flushPromises()
    expect(stat(wrapper, 0).find('strong').text()).toBe('123,456')
    wrapper.unmount()
  })

  it('reads the record total from the same response — the band costs no extra request', async () => {
    api.hofList.mockResolvedValue({ items: [{ damageDealt: 10483 }], totalItems: 2048 })
    const wrapper = mountPage()
    await flushPromises()
    expect(api.hofList).toHaveBeenCalledTimes(1)
    expect(stat(wrapper, 1).find('strong').text()).toBe('2,048')
    wrapper.unmount()
  })

  it('formats counts with the active locale separator', async () => {
    i18n.locale.value = 'ru'
    api.hofList.mockResolvedValue({ items: [{ damageDealt: 123456 }], totalItems: 2048 })
    const wrapper = mountPage()
    await flushPromises()
    expect(stat(wrapper, 0).find('strong').text()).toBe('123\u00a0456')
    expect(stat(wrapper, 1).find('strong').text()).toBe('2\u00a0048')
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
