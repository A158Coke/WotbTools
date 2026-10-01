// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { messages } from '../locales/messages.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import MorePage from './MorePage.vue'

vi.mock('../composables/useAuth.js', async () => {
  const { ref } = await import('vue')
  return {
    useAuth: () => ({
      isAdmin: ref(false),
      isHofAdmin: ref(false),
    }),
  }
})

function mountPage() {
  const i18n = createI18n({
    locale: 'zh',
    fallbackLocale: 'en',
    messages,
  })
  const wrapper = mount(MorePage, {
    global: {
      plugins: [i18n],
      provide: { [NAVIGATE_VIEW_KEY]: vi.fn() },
    },
  })
  return { wrapper, i18n }
}

describe('MorePage language switcher', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('switches the global locale and persists the selected language', async () => {
    const { wrapper, i18n } = mountPage()

    const english = wrapper.get('[data-testid="more-language"] [data-value="en"]')
    await english.trigger('click')

    expect(i18n.global.locale).toBe('en')
    expect(localStorage.getItem('wotb-lang')).toBe('en')
    expect(english.attributes('aria-checked')).toBe('true')
  })
})
