// @vitest-environment happy-dom
/**
 * App shell 最小回归测试（PR #94 P0）：merge 冲突不得破坏 defineAsyncComponent import。
 * 覆盖：module evaluate / mount；?view=playback-qa 解析 PlaybackQaPage；?view=vehicle-models 无效。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

// 重视图 mock 为轻组件（本测试只验证 view 解析，不挂载重型页面）
vi.mock('./components/ReplayPage.vue', () => ({ default: { name: 'ReplayPageMock', template: '<div data-test="view-replay" />' } }))
vi.mock('./components/HomePage.vue', () => ({ default: { name: 'HomePageMock', template: '<div data-test="view-home" />' } }))
// PlaybackQaPage 真实异步解析；mock useAuth 让 QA 页走未登录分支（轻量，不加载 14 车场景）
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key) => key, locale: { value: 'zh' } }),
}))
vi.mock('./composables/useAuth.js', () => ({
  useAuth: () => ({
    initPromise: Promise.resolve(false),
    tokenParsed: { value: null },
    authenticated: { value: false },
    login: vi.fn(),
  }),
}))

import App from './App.vue'

function mountApp() {
  return mount(App, { global: { mocks: { $t: (key) => key, $i18n: { locale: { value: 'zh' } } } } })
}

describe('App shell — view 路由（PR94 P0：defineAsyncComponent import 回归）', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/')
    vi.clearAllMocks()
  })

  it('module evaluate + mount 不抛错（defineAsyncComponent 已声明）', async () => {
    const wrapper = mountApp()
    await flushPromises()
    expect(wrapper.find('[data-test="view-replay"]').exists()).toBe(true) // localhost → 默认回放视图
  })

  it('?view=vehicle-models 不再是合法 view → 回退默认视图', async () => {
    window.history.replaceState({}, '', '/?view=vehicle-models')
    const wrapper = mountApp()
    await flushPromises()
    expect(wrapper.find('[data-test="view-replay"]').exists()).toBe(true) // 默认回放视图
    expect(wrapper.find('[data-test="view-home"]').exists()).toBe(false)
  })

  it('?view=playback-qa 解析 PlaybackQaPage（异步加载）', async () => {
    window.history.replaceState({}, '', '/?view=playback-qa')
    const wrapper = mountApp()
    // defineAsyncComponent：动态 import + onMounted 异步链，轮询直到异步组件 resolve 渲染
    await vi.waitFor(() => {
      expect(wrapper.find('.pb-qa-page').exists()).toBe(true)
    })
    // useAuth mock → 未登录分支显示 loading 文案（$t mock 返回 key）
    await flushPromises()
    expect(wrapper.text()).toContain('adminPreview.loading')
  })
})
