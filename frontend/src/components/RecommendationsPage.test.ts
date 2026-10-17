// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createI18n } from 'vue-i18n'
import { messages } from '../locales/messages.js'
import { CREATOR_AVAILABILITY_KEY } from '../shared/creatorAvailability.js'
import RecommendationsPage from './RecommendationsPage.vue'
let wrapper: ReturnType<typeof mount> | undefined
afterEach(() => { wrapper?.unmount() })
describe('recommendation type entry', () => {
  it('shows only published types, navigates with router and preserves unrelated location state', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push('/?view=recommendations&creatorCategory=4&keep=yes#types'); await router.isReady()
    const types = ref(['VIDEO'])
    wrapper = mount(RecommendationsPage, { global: { plugins: [router, createI18n({ legacy: false, locale: 'en', messages })], provide: {
      [CREATOR_AVAILABILITY_KEY as symbol]: { loading: ref(false), error: ref(null), refresh: vi.fn(), typeVisible: (type: string) => types.value.includes(type) }
    } } })
    expect(wrapper.find('[data-testid=recommendation-card-UP]').exists()).toBe(false)
    await wrapper.get('[data-testid=recommendation-card-VIDEO]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ view: 'recommended-videos', keep: 'yes' })
    expect(router.currentRoute.value.hash).toBe('#types')
    types.value = ['UP', 'VIDEO']; await flushPromises()
    expect(wrapper.find('[data-testid=recommendation-card-UP]').exists()).toBe(true)
    types.value = []; await flushPromises()
    expect(wrapper.find('[data-testid=recommendation-card-VIDEO]').exists()).toBe(false)
  })
})
