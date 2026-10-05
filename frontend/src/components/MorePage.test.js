// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { messages } from '../locales/messages.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import MorePage from './MorePage.vue'
const menuRole = vi.hoisted(() => ({ tournament: false }))

vi.mock('../composables/useAuth.js', async () => {
  const { ref } = await import('vue')
  return {
    useAuth: () => ({
      isAdmin: ref(false),
      isHofAdmin: ref(false),
      isTournamentAdmin: ref(menuRole.tournament),
    }),
  }
})

function mountPage(navigate = vi.fn()) {
  const i18n = createI18n({
    locale: 'zh',
    fallbackLocale: 'en',
    messages,
  })
  const wrapper = mount(MorePage, {
    global: {
      plugins: [i18n],
      provide: { [NAVIGATE_VIEW_KEY]: navigate },
    },
  })
  return { wrapper, i18n }
}

describe('MorePage language switcher', () => {
  beforeEach(() => {
    localStorage.clear()
    menuRole.tournament = false
  })

  it('public tool links navigate directly without initiating login in the menu', async () => {
    const navigate = vi.fn()
    const { wrapper } = mountPage(navigate)
    for (const view of ['agent-replay', 'agent-shots']) {
      await wrapper.get(`[data-testid="more-link-${view}"]`).trigger('click')
      expect(navigate).toHaveBeenLastCalledWith(view)
    }
    expect(wrapper.find('[data-testid="more-link-admin-users"]').exists()).toBe(false)
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
