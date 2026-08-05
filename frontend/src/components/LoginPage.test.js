// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import LoginPage from './LoginPage.vue'

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

  it('offers both QQ and Wargaming login buttons', () => {
    const wrapper = mount(LoginPage, {
      global: { mocks: { $t: i18n.t } }
    })
    expect(wrapper.text()).toContain('login.cnPlayers')
    expect(wrapper.text()).toContain('login.qqLogin')
    expect(wrapper.text()).toContain('login.asiaPlayers')
    expect(wrapper.text()).toContain('login.wgLogin')
    expect(wrapper.findAll('button').length).toBe(2)
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

  it('Wargaming button passes idpHint region ASIA and profile view', async () => {
    auth.loginWithWargaming.mockResolvedValue(undefined)
    const wrapper = mount(LoginPage, {
      global: { mocks: { $t: i18n.t } }
    })
    await wrapper.findAll('button')[1].trigger('click')
    expect(auth.loginWithWargaming).toHaveBeenCalledWith('ASIA', 'profile')
    expect(auth.login).not.toHaveBeenCalled()
  })

  it('shows the region and independent-account notes without binding promises', () => {
    const wrapper = mount(LoginPage, {
      global: { mocks: { $t: i18n.t } }
    })
    expect(wrapper.text()).toContain('login.asiaOnlyNote')
    expect(wrapper.text()).toContain('login.independentAccountNote')
    expect(wrapper.find('input').exists()).toBe(false)
  })
})
