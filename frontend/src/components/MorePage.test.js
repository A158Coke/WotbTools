// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { ref } from 'vue'
import { messages } from '../locales/messages.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import MorePage from './MorePage.vue'
const menuRole = vi.hoisted(() => ({ tournament: false, authenticated: null }))

vi.mock('../composables/useAuth.js', async () => {
  const { ref } = await import('vue')
  return {
    useAuth: () => ({
      isAdmin: ref(false),
      isHofAdmin: ref(false),
      isTournamentAdmin: ref(menuRole.tournament),
      authenticated: menuRole.authenticated,
    }),
  }
})

function mountPage(navigate = vi.fn(), onboarding = null) {
  const i18n = createI18n({
    locale: 'zh',
    fallbackLocale: 'en',
    messages,
  })
  const wrapper = mount(MorePage, {
    global: {
      plugins: [i18n],
      provide: { [NAVIGATE_VIEW_KEY]: navigate, [ONBOARDING_KEY]: onboarding },
    },
  })
  return { wrapper, i18n }
}

describe('MorePage language switcher', () => {
  beforeEach(() => {
    localStorage.clear()
    menuRole.tournament = false
    menuRole.authenticated = ref(false)
  })
  it('shows More guides only while signed in and reacts to login/logout', async () => {
    const openDirectory = vi.fn()
    const { wrapper } = mountPage(vi.fn(), { openDirectory })
    expect(wrapper.find('[data-testid="more-link-guide"]').exists()).toBe(false)
    menuRole.authenticated.value = true
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="more-link-guide"]').trigger('click')
    expect(openDirectory).toHaveBeenCalledTimes(1)
    menuRole.authenticated.value = false
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="more-link-guide"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('public tool links navigate directly without initiating login in the menu', async () => {
    const navigate = vi.fn()
    const { wrapper } = mountPage(navigate)
    for (const view of ['agent-replay', 'agent-shots']) {
      await wrapper.get(`[data-testid="more-link-${view}"]`).trigger('click')
      expect(navigate).toHaveBeenLastCalledWith(view)
    }
    expect(wrapper.find('[data-testid="more-link-admin-users"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="more-link-tournament-points"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('switches the global locale and persists the selected language', async () => {
    const { wrapper, i18n } = mountPage()

    const english = wrapper.get('[data-testid="more-language"] [data-value="en"]')
    await english.trigger('click')

    expect(i18n.global.locale).toBe('en')
    expect(localStorage.getItem('wotb-lang')).toBe('en')
    expect(english.attributes('aria-checked')).toBe('true')
  })
  it('shows tournament management to tournament-only administrators without other management entries', () => {
    menuRole.tournament = true
    const { wrapper } = mountPage()
    expect(wrapper.find('[data-testid="more-link-tournament-points-config"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="more-link-tournament-points-admin"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="more-link-admin-users"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="more-link-hof-admin"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
