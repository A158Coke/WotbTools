// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { ref } from 'vue'
import { messages } from '../locales/messages.js'
import { FEEDBACK_KEY } from '../shared/feedback.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { ANDROID_UPDATE_KEY } from '../shared/androidUpdate.js'
import MorePage from './MorePage.vue'
import { CREATOR_AVAILABILITY_KEY } from '../composables/useCreatorAvailability.js'
const menuRole = vi.hoisted(() => ({ tournament: false, content: false, authenticated: null }))

vi.mock('../composables/useAuth.js', async () => {
  const { ref } = await import('vue')
  return {
    useAuth: () => ({
      isAdmin: ref(false),
      isHofAdmin: ref(false),
      isTournamentAdmin: ref(menuRole.tournament),
      isContentAdmin: ref(menuRole.content),
      authenticated: menuRole.authenticated,
    }),
  }
})

function mountPage(navigate = vi.fn(), onboarding = null, creatorsAvailable = true, openFeedback = null, creatorsVisible = false, androidUpdate = null) {
  const i18n = createI18n({
    locale: 'zh',
    fallbackLocale: 'en',
    messages,
  })
  const wrapper = mount(MorePage, {
    global: {
      plugins: [i18n],
      provide: { [NAVIGATE_VIEW_KEY]: navigate, [ONBOARDING_KEY]: onboarding, [FEEDBACK_KEY]: openFeedback, [ANDROID_UPDATE_KEY]: androidUpdate,
        [CREATOR_AVAILABILITY_KEY]: { available: ref(creatorsAvailable), directoryVisible: ref(creatorsVisible), contentKnown: ref(true), publicCategories: ref([]), loading: ref(false), refresh: vi.fn() } },
    },
  })
  return { wrapper, i18n }
}

describe('MorePage shortcuts', () => {
  it('opens sections outside the tab bar, and shows recommendations only when the directory is visible', async () => {
    menuRole.authenticated = ref(false)
    const navigate = vi.fn()
    const { wrapper } = mountPage(navigate, null, true, null, true)
    expect(wrapper.findAll('[data-testid^="more-shortcut-"]').map(item => item.attributes('data-testid').replace('more-shortcut-', '')))
      .toEqual(['techtree', 'maps', 'league-broadcasts', 'creators'])
    await wrapper.get('[data-testid="more-shortcut-maps"]').trigger('click')
    expect(navigate).toHaveBeenCalledWith('map-preview')
    wrapper.unmount()
    const hidden = mountPage(vi.fn(), null, true, null, false).wrapper
    expect(hidden.find('[data-testid="more-shortcut-creators"]').exists()).toBe(false)
    hidden.unmount()
  })
})

describe('MorePage language switcher', () => {
  it('requests the in-app feedback dialog instead of linking out', async () => {
    menuRole.authenticated = ref(false)
    const openFeedback = vi.fn()
    const { wrapper } = mountPage(vi.fn(), null, true, openFeedback)
    const entry = wrapper.get('[data-testid="more-link-feedback"]')
    expect(entry.element.tagName).toBe('BUTTON')
    await entry.trigger('click')
    expect(openFeedback).toHaveBeenCalledTimes(1)
  })

  it('exposes the same shell update action only when the new Native capability is supported', async () => {
    const update = { supported: ref(false), open: vi.fn() }
    const { wrapper } = mountPage(vi.fn(), null, true, null, false, update)
    expect(wrapper.find('[data-testid="more-link-app-update"]').exists()).toBe(false)
    update.supported.value = true
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="more-link-app-update"]').trigger('click')
    expect(update.open).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('keeps creator administration hidden on a legacy backend', () => {
    menuRole.tournament = true
    menuRole.content = true
    const { wrapper } = mountPage(vi.fn(), null, false)
    expect(wrapper.find('[data-testid="more-link-creators-config"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="more-link-tournament-points-config"]').exists()).toBe(true)
    wrapper.unmount()
  })
  it('keeps creator administration available to content-admin with an empty public snapshot without duplicating primary navigation', async () => {
    const navigate = vi.fn(), { wrapper } = mountPage(navigate)
    expect(wrapper.find('[data-testid="more-link-creators"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="more-link-creators-config"]').exists()).toBe(false)
    wrapper.unmount()
    menuRole.content = true
    const admin = mountPage().wrapper
    expect(admin.find('[data-testid="more-link-creators-config"]').exists()).toBe(true)
    expect(admin.find('[data-testid="more-link-tournament-points-config"]').exists()).toBe(false)
    admin.unmount()
  })
  it('does not grant content administration to tournament-admin', () => {
    menuRole.tournament = true
    const { wrapper } = mountPage()
    expect(wrapper.find('[data-testid="more-link-tournament-points-config"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="more-link-creators-config"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('does not duplicate the primary broadcast entry in More', () => {
    const { wrapper } = mountPage()
    expect(wrapper.find('[data-testid="more-link-league-broadcasts"]').exists()).toBe(false)
    wrapper.unmount()
  })
  beforeEach(() => {
    localStorage.clear()
    menuRole.tournament = false
    menuRole.content = false
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

  it('does not duplicate Replay capabilities in 更多', () => {
    const { wrapper } = mountPage()
    for (const view of ['agent-replay', 'agent-shots']) {
      expect(wrapper.find(`[data-testid="more-link-${view}"]`).exists()).toBe(false)
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
