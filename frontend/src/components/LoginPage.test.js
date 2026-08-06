// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import LoginPage from './LoginPage.vue'
import zh from '../locales/zh.json'
import en from '../locales/en.json'
import ru from '../locales/ru.json'

const auth = vi.hoisted(() => ({
  login: vi.fn(),
  loginWithWargaming: vi.fn()
}))

const i18n = vi.hoisted(() => ({
  t: vi.fn(key => key)
}))

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    login: auth.login,
    loginWithWargaming: auth.loginWithWargaming
  })
}))

describe('LoginPage', () => {
  beforeEach(() => {
    auth.login.mockReset()
    auth.loginWithWargaming.mockReset()
    i18n.t.mockClear()
  })

  it('offers QQ plus three Wargaming region buttons', () => {
    const wrapper = mount(LoginPage, {
      global: { mocks: { $t: i18n.t } }
    })
    expect(wrapper.text()).toContain('login.cnPlayers')
    expect(wrapper.text()).toContain('login.qqLogin')
    expect(wrapper.text()).toContain('login.wgLogin')
    expect(wrapper.text()).toContain('login.wgAsia')
    expect(wrapper.text()).toContain('login.wgEurope')
    expect(wrapper.text()).toContain('login.wgNorthAmerica')
    expect(wrapper.findAll('button').length).toBe(4)
  })

  it('QQ button calls the default login flow with profile view', async () => {
    auth.login.mockResolvedValue(undefined)
    const wrapper = mount(LoginPage, {
      global: { mocks: { $t: i18n.t } }
    })
    await wrapper.findAll('button')[0].trigger('click')
    expect(auth.login).toHaveBeenCalledWith('profile')
    expect(auth.loginWithWargaming).not.toHaveBeenCalled()
  })

  it('ASIA button passes region ASIA and profile view', async () => {
    auth.loginWithWargaming.mockResolvedValue(undefined)
    const wrapper = mount(LoginPage, {
      global: { mocks: { $t: i18n.t } }
    })
    await wrapper.findAll('button')[1].trigger('click')
    expect(auth.loginWithWargaming).toHaveBeenCalledWith('ASIA', 'profile')
    expect(auth.login).not.toHaveBeenCalled()
  })

  it('EU button passes region EU and profile view', async () => {
    auth.loginWithWargaming.mockResolvedValue(undefined)
    const wrapper = mount(LoginPage, {
      global: { mocks: { $t: i18n.t } }
    })
    await wrapper.findAll('button')[2].trigger('click')
    expect(auth.loginWithWargaming).toHaveBeenCalledWith('EU', 'profile')
    expect(auth.loginWithWargaming).not.toHaveBeenCalledWith('ASIA', expect.anything())
    expect(auth.loginWithWargaming).not.toHaveBeenCalledWith('NA', expect.anything())
  })

  it('NA button passes region NA and profile view', async () => {
    auth.loginWithWargaming.mockResolvedValue(undefined)
    const wrapper = mount(LoginPage, {
      global: { mocks: { $t: i18n.t } }
    })
    await wrapper.findAll('button')[3].trigger('click')
    expect(auth.loginWithWargaming).toHaveBeenCalledWith('NA', 'profile')
    expect(auth.loginWithWargaming).not.toHaveBeenCalledWith('ASIA', expect.anything())
    expect(auth.loginWithWargaming).not.toHaveBeenCalledWith('EU', expect.anything())
  })

  it('shows the independent-account note and no longer claims Asia-only', () => {
    const wrapper = mount(LoginPage, {
      global: { mocks: { $t: i18n.t } }
    })
    expect(wrapper.text()).toContain('login.independentAccountNote')
    expect(wrapper.find('input').exists()).toBe(false)
  })

  it('provides the three region labels and wgLogin in all three locales', () => {
    for (const locale of [zh, en, ru]) {
      expect(locale.login.wgLogin).toBeTruthy()
      expect(locale.login.wgAsia).toBeTruthy()
      expect(locale.login.wgEurope).toBeTruthy()
      expect(locale.login.wgNorthAmerica).toBeTruthy()
      expect(locale.login.asiaOnlyNote).toBeUndefined()
      expect(locale.login.asiaPlayers).toBeUndefined()
      expect(locale.profile.serverCn).toBeTruthy()
      expect(locale.profile.serverAsia).toBeTruthy()
      expect(locale.profile.serverEu).toBeTruthy()
      expect(locale.profile.serverNa).toBeTruthy()
    }
  })
})
