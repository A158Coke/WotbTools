// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppTabBar from './AppTabBar.vue'
import { messages } from '../locales/messages.js'

async function mountTabs(locale) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push('/?view=hof')
  await router.isReady()
  return mount(AppTabBar, { global: { plugins: [router, createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })] } })
}

describe('AppTabBar accessible names', () => {
  it.each(['zh', 'en', 'ru'])('keeps every visible label inside the accessible name in %s', async (locale) => {
    const wrapper = await mountTabs(locale)
    const tabs = wrapper.findAll('[data-testid^="tab-"]')
    expect(tabs).toHaveLength(5)
    for (const tab of tabs) expect(tab.attributes('aria-label')).toContain(tab.get('.tab-label').text())
    wrapper.unmount()
  })

  it('announces the full section name next to a shortened label', async () => {
    const wrapper = await mountTabs('en')
    expect(wrapper.get('[data-testid="tab-tankopedia"]').attributes('aria-label')).toBe('Tanks: Tankopedia')
    wrapper.unmount()
  })
})
