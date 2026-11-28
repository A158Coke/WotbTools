// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { routeLocationKey, stringifyQuery } from 'vue-router'
import HomePage from './HomePage.vue'
import { loadVersionDiffCatalog, versionDiffCatalogState } from '../composables/useVersionDiff.js'
import { FEEDBACK_KEY } from '../shared/feedback.js'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { messages } from '../locales/messages.js'

const platform = vi.hoisted(() => ({ android: false }))

vi.mock('../composables/usePlatformBridge.js', async importOriginal => ({
  ...await importOriginal(),
  isAndroidApp: () => platform.android,
}))

vi.mock('../composables/useVersionDiff.js', async () => {
  const { ref } = await import('vue')
  return {
    versionDiffCatalogState: ref({ status: 'idle', pairs: [] }),
    loadVersionDiffCatalog: vi.fn(),
  }
})

const api = vi.hoisted(() => ({
  hofList: vi.fn(() => Promise.resolve({ items: [] }))
}))
const i18n = vi.hoisted(() => ({ locale: null }))

vi.mock('../api/hall-of-fame.js', () => api)
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

function mountPage({ onboarding = null, openFeedback = null } = {}) {
  return mount(HomePage, {
    global: {
      mocks: { $t: key => key },
      provide: {
        [ONBOARDING_KEY]: onboarding,
        [FEEDBACK_KEY]: openFeedback,
        [routeLocationKey]: { query: { view: 'home', data: '11.22.0' } },
      },
      stubs: {
        RouterLink: {
          props: ['to'],
          methods: {
            href(to) {
              return typeof to === 'string' ? to : `${to.path}?${stringifyQuery(to.query)}`
            },
          },
          template: '<a :href="href(to)"><slot /></a>',
        },
      },
    },
  })
}

function queryOf(link) {
  return new URL(link.attributes('href'), 'https://wotbtools.com').searchParams
}

function comparison(from, to) {
  return { from: { dataset: from }, to: { dataset: to } }
}

beforeEach(() => {
  platform.android = false
  api.hofList.mockClear()
  versionDiffCatalogState.value = { status: 'idle', pairs: [] }
  loadVersionDiffCatalog.mockClear()
})

describe('home version changes', () => {
  it('promotes the last catalog pair to the only version changes link on the page', async () => {
    const wrapper = mountPage()
    expect(loadVersionDiffCatalog).toHaveBeenCalledTimes(1)
    versionDiffCatalogState.value = {
      status: 'ready',
      pairs: [comparison('11.21.0', '11.21.0_1'), comparison('11.21.0_1', '11.22.0')],
    }
    await flushPromises()
    const update = wrapper.get('.home-update')
    expect(wrapper.get('[data-testid="home-hero"]').element.nextElementSibling).toBe(update.element)
    expect(update.get('[data-testid="home-update-versions"]').text()).toBe('11.21.0_1 → 11.22.0')
    const link = update.get('[data-testid="home-version-diff"]')
    expect(Object.fromEntries(queryOf(link))).toEqual({
      view: 'agent-version-diff', data: '11.22.0', from: '11.21.0_1', to: '11.22.0',
    })
    expect(wrapper.findAll('a[href*="view=agent-version-diff"]')).toHaveLength(1)
    wrapper.unmount()
  })

  it.each(['loading', 'error', 'ready'])('keeps the version viewer reachable with a %s catalog and no pairs', status => {
    versionDiffCatalogState.value = { status, pairs: [] }
    const wrapper = mountPage()
    expect(wrapper.find('[data-testid="home-update-versions"]').exists()).toBe(false)
    expect(Object.fromEntries(queryOf(wrapper.get('[data-testid="home-version-diff"]')))).toEqual({
      view: 'agent-version-diff', data: '11.22.0',
    })
    wrapper.unmount()
  })
})

describe('home layout and support', () => {
  it('ends the home content with version changes', () => {
    const wrapper = mountPage()
    const main = wrapper.get('main').element
    expect([...main.children].map(child => child.classList[0])).toEqual(['home-hero', 'home-update'])
    wrapper.unmount()
  })

  it('keeps Android download, sponsorship and feedback on the first screen', async () => {
    const openFeedback = vi.fn()
    const wrapper = mountPage({ openFeedback })
    const hero = wrapper.get('[data-testid="home-hero"]')
    expect(hero.findAll('h1').map(heading => heading.text())).toEqual(['WotbTools home.heroTitle'])
    const support = hero.get('.home-hero-actions')
    expect(hero.find('a[href*="view=replay"]').exists()).toBe(false)
    expect(support.get('[data-testid="home-android"]').classes()).toContain('is-primary')
    expect(support.get('[data-testid="home-android"]').attributes('href')).toBe('/download/android')
    expect(support.get('[data-testid="home-sponsor"]').attributes('href')).toBe('/sponsor')
    await support.get('[data-testid="home-feedback"]').trigger('click')
    expect(openFeedback).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('hides the download on Android while keeping the support links', () => {
    platform.android = true
    const wrapper = mountPage()
    expect(wrapper.find('[data-testid="home-android"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="home-sponsor"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="home-feedback"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('opens the feature guide from the hero', async () => {
    const openDirectory = vi.fn()
    const wrapper = mountPage({ onboarding: { openDirectory } })
    await wrapper.get('[data-testid="home-onboarding"]').trigger('click')
    expect(openDirectory).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('resolves all home labels and descriptions in the three locales', async () => {
    const { default: source } = await import('./HomePage.vue?raw')
    const literals = [...source.matchAll(/\$t\('([\w.]+)'\)/g)].map(match => match[1])
    for (const [locale, translations] of Object.entries(messages)) {
      for (const key of literals) {
        const value = key.split('.').reduce((node, part) => node?.[part], translations)
        expect(value, `${locale}:${key}`).toEqual(expect.any(String))
        expect(value, `${locale}:${key}`).not.toBe('')
      }
    }
  })
})

const stat = (wrapper, index) => wrapper.findAll('.home-stats .home-stat')[index]

describe('HomePage Hall of Fame data band', () => {
  beforeEach(() => {
    api.hofList.mockReset()
    platform.android = false
    i18n.locale.value = 'en'
    connectivityState.state.value = 'online'
    connectivityState.settled.value = true
  })

  it('cold start: waits for the first connectivity check instead of showing -- forever', async () => {
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
