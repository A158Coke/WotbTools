// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import VehicleModelPreviewPage from './VehicleModelPreviewPage.vue'

const authState = vi.hoisted(() => ({
  authenticated: { value: true },
  roles: ['wotbtools-admin'],
}))

const authFns = vi.hoisted(() => ({
  login: vi.fn(),
}))

const i18n = vi.hoisted(() => ({
  t: vi.fn((key) => key),
}))

const i18nLocale = vi.hoisted(() => ({ value: 'zh' }))

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    tokenParsed: {
      value: authState.roles.length
        ? { realm_access: { roles: authState.roles } }
        : null,
    },
    authenticated: authState.authenticated,
    initPromise: Promise.resolve(authState.authenticated.value),
    login: authFns.login,
  }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: i18n.t, locale: i18nLocale }),
}))

// 动态 import（mapping + tankopedia JSON）与 import.meta.glob 需要真实事件循环；
// 全量并行跑时模块转换耗时不定，轮询等待组件就绪（最长 3s）。
async function waitFor(cond, timeoutMs = 3000) {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) return false
    await new Promise((r) => setTimeout(r, 25))
  }
  return true
}

describe('VehicleModelPreviewPage', () => {
  beforeEach(() => {
    authFns.login.mockReset()
    i18n.t.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('wotbtools-admin 可看到车型选择与画布', async () => {
    authState.roles = ['wotbtools-admin']
    authState.authenticated.value = true
    const wrapper = mount(VehicleModelPreviewPage)
    expect(await waitFor(() => wrapper.find('.vmp-toolbar').exists())).toBe(true)
    expect(wrapper.find('.vmp-canvas').exists()).toBe(true)
    const options = wrapper.findAll('select option')
    expect(options.length).toBeGreaterThanOrEqual(2) // sample + 81 modelKeys
    expect(authFns.login).not.toHaveBeenCalled()
  })

  it('默认选中 sample 契约样例并渲染双层标记', async () => {
    authState.roles = ['wotbtools-admin']
    authState.authenticated.value = true
    const wrapper = mount(VehicleModelPreviewPage)
    expect(await waitFor(() => wrapper.find('select').exists())).toBe(true)
    const select = wrapper.find('select').element
    expect(select.value).toBe('sample')
    expect(wrapper.find('.vmp-hull').exists()).toBe(true)
    expect(wrapper.find('.vmp-turret').exists()).toBe(true)
  })

  it('非 admin 角色显示无权限，不渲染工具栏', async () => {
    authState.roles = ['wotbtools-user']
    authState.authenticated.value = true
    const wrapper = mount(VehicleModelPreviewPage)
    expect(await waitFor(() => wrapper.find('.vmp-denied').exists())).toBe(true)
    expect(wrapper.find('.vmp-toolbar').exists()).toBe(false)
  })

  it('未登录自动跳转登录页（回跳 view=vehicle-models）', async () => {
    authState.roles = ['wotbtools-admin']
    authState.authenticated.value = false
    mount(VehicleModelPreviewPage)
    expect(await waitFor(() => authFns.login.mock.calls.length > 0)).toBe(true)
    expect(authFns.login).toHaveBeenCalledWith('vehicle-models')
  })
})
