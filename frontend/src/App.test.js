// @vitest-environment happy-dom
/**
 * App shell 最小回归测试（PR #94 P0）：merge 冲突不得破坏 defineAsyncComponent import。
 * 覆盖：module evaluate / mount；?view=playback-qa 解析 PlaybackQaPage；?view=vehicle-models 无效。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, inject } from 'vue'
import { setUiProfile } from './composables/useUiProfile.js'

// 重视图 mock 为轻组件（本测试只验证 view 解析，不挂载重型页面）。
// PR: Replay 三 URL 共用同一 ReplayWorkspace，仅 initialCapability 不同。
vi.mock('./components/ReplayWorkspace.vue', () => ({
  default: {
    name: 'ReplayWorkspaceMock',
    props: ['initialCapability'],
    setup() {
      const navigate = inject('navigate')
      return { navigate }
    },
    template: `<div :data-cap="initialCapability" data-test="view-replay">
      <button data-testid="ws-tab" data-cap="data" @click="navigate && navigate('replay')">data</button>
      <button data-testid="ws-tab" data-cap="ai" @click="navigate && navigate('ai-review')">ai</button>
      <button data-testid="ws-tab" data-cap="playback" @click="navigate && navigate('battle-playback')">playback</button>
    </div>`,
  },
}))
vi.mock('./components/HomePage.vue', () => ({ default: { name: 'HomePageMock', template: '<div data-test="view-home" />' } }))
vi.mock('./components/HoFPage.vue', () => ({ default: { name: 'HoFPageMock', template: '<div data-test="view-hof" />' } }))
// PlaybackQaPage 真实异步解析；mock useAuth 让 QA 页走未登录分支（轻量，不加载 14 车场景）
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key) => key, locale: { value: 'zh' } }),
}))
const authState = vi.hoisted(() => ({ authenticated: false, username: '' }))
vi.mock('./composables/useAuth.js', () => ({
  useAuth: () => ({
    initPromise: Promise.resolve(authState.authenticated),
    tokenParsed: { value: null },
    authenticated: { value: false },
    login: vi.fn(),
    logout: vi.fn(),
    isAuthenticated: () => authState.authenticated,
    userName: () => authState.username,
  }),
}))

import App from './App.vue'

function mountApp() {
  return mount(App, { global: { mocks: { $t: (key) => key, $i18n: { locale: { value: 'zh' } } } } })
}

/** 读取当前 URL 的 ?view 参数（断言 canonicalization 后 URL 已被 replaceState 重写）。 */
function currentViewParam() {
  return new URL(window.location.href).searchParams.get('view')
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

  it('?view=reconstruction canonicalize 到 battle-playback 独立视图', async () => {
    window.history.replaceState({}, '', '/?view=reconstruction')
    const wrapper = mountApp()
    await flushPromises()
    const ws = wrapper.find('[data-test="view-replay"]')
    expect(ws.exists()).toBe(true)
    expect(ws.attributes('data-cap')).toBe('playback')
  })

  it('?view=leaderboard canonicalize 到 hof（旧书签兼容，不得误映射到 replay）', async () => {
    window.history.replaceState({}, '', '/?view=leaderboard')
    const wrapper = mountApp()
    await flushPromises()
    // leaderboard 是旧书签 → 必须跳转 Hof 页，而不是被上一轮 canonicalization 误映射成 replay。
    expect(wrapper.find('[data-test="view-hof"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="view-replay"]').exists()).toBe(false)
  })

  it('旧书签别名矩阵：单一来源 LEGACY_VIEW_ALIASES 统一 canonicalize（URL + 视图一致）', async () => {
    const cases = [
      { in: 'leaderboard', out: 'hof', test: 'view-hof' },
      { in: 'extended', out: 'replay', test: 'view-replay', cap: 'data' },
      { in: 'reconstruction', out: 'battle-playback', test: 'view-replay', cap: 'playback' },
      { in: 'hof', out: 'hof', test: 'view-hof' },
      { in: 'replay', out: 'replay', test: 'view-replay', cap: 'data' },
    ]
    for (const c of cases) {
      window.history.replaceState({}, '', `/?view=${c.in}`)
      const wrapper = mountApp()
      await flushPromises()
      expect(currentViewParam()).toBe(c.out) // URL 已 canonicalize
      const ws = wrapper.find(`[data-test="${c.test}"]`)
      expect(ws.exists()).toBe(true)
      if (c.cap) expect(ws.attributes('data-cap')).toBe(c.cap)
      wrapper.unmount()
    }
    // 未知默认值：非别名不重写 URL，回退默认视图
    window.history.replaceState({}, '', '/?view=vehicle-models')
    const w = mountApp()
    await flushPromises()
    expect(currentViewParam()).toBe('vehicle-models')
    expect(w.find('[data-test="view-replay"]').exists()).toBe(true)
    w.unmount()
  })

  it('?view=playback-qa 解析 PlaybackQaPage（异步加载）', async () => {
    window.history.replaceState({}, '', '/?view=playback-qa')
    const wrapper = mountApp()
    // defineAsyncComponent：动态 import + onMounted 异步链，轮询直到异步组件 resolve 渲染
    await vi.waitFor(() => {
      expect(wrapper.find('.pb-qa-page').exists()).toBe(true)
    }, { timeout: 5000 })
    // useAuth mock → 未登录分支显示 loading 文案（$t mock 返回 key）
    await flushPromises()
    expect(wrapper.text()).toContain('adminPreview.loading')
  })

  it('Replay 能力 tab 切换用 pushState + popstate 形成可 Back/Forward 的 history，不丢 workspace', async () => {
    window.history.replaceState({}, '', '/?view=replay')
    const wrapper = mountApp()
    await flushPromises()
    // 初始 replay（workspace data）
    let ws = wrapper.find('[data-test="view-replay"]')
    expect(ws.attributes('data-cap')).toBe('data')

    // Replay → AI（经 Workspace 内部能力 tab 切换，pushState 生成历史条目；顶栏为单一入口）
    const aiTab = wrapper.find('[data-testid="ws-tab"][data-cap="ai"]')
    expect(aiTab).toBeTruthy()
    await aiTab.trigger('click')
    await flushPromises()
    ws = wrapper.find('[data-test="view-replay"]')
    expect(ws.attributes('data-cap')).toBe('ai')

    // Back → 回 Replay（data）。happy-dom 的 history.back() 不保证触发 popstate，
    // 这里等价地推送原 URL 并派发 popstate，验证 onPopState 恢复 activeTool。
    window.history.pushState({}, '', '/?view=replay')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await nextTick()
    ws = wrapper.find('[data-test="view-replay"]')
    expect(ws.attributes('data-cap')).toBe('data')
  })

  it('?view=rating-docs 解析 RatingDocsPage（异步加载 canonical 文档）', async () => {
    window.history.replaceState({}, '', '/?view=rating-docs')
    const wrapper = mountApp()
    await vi.waitFor(() => {
      expect(wrapper.find('.rating-docs-page').exists()).toBe(true)
    }, { timeout: 5000 })
    await flushPromises()
    expect(wrapper.find('.markdown-content').exists()).toBe(true)
    expect(wrapper.text()).toContain('league.docs_page_title')
  })

  it('?view=rating-v2 解析隐藏管理员灰度页，但顶栏不出现入口', async () => {
    window.history.replaceState({}, '', '/?view=rating-v2')
    const wrapper = mountApp()
    await vi.waitFor(() => {
      expect(wrapper.find('.rating-v2-page').exists()).toBe(true)
    }, { timeout: 5000 })
    await flushPromises()
    expect(wrapper.find('nav').text()).not.toContain('ratingV2.title')
    expect(wrapper.text()).toContain('ratingV2.login')
  })

  it('§39 切换 UI Profile 不得 navigate / remount / 改变当前视图', async () => {
    const wrapper = mountApp()
    await flushPromises()
    // localhost → 默认回放视图
    expect(wrapper.find('[data-test="view-replay"]').exists()).toBe(true)

    // 切 Classic：只改 data-ui-profile + 派生的 data-theme + localStorage + 状态,视图/activeTool 不变
    setUiProfile('classic')
    await nextTick()
    expect(document.documentElement.getAttribute('data-ui-profile')).toBe('classic')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(wrapper.find('[data-test="view-replay"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="view-home"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="view-replay"]').element).not.toBeNull()

    // 切回 Showcase
    setUiProfile('showcase')
    await nextTick()
    expect(document.documentElement.getAttribute('data-ui-profile')).toBe('showcase')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(wrapper.find('[data-test="view-replay"]').exists()).toBe(true)

    // 清理
    document.documentElement.removeAttribute('data-ui-profile')
    document.documentElement.removeAttribute('data-theme')
    window.localStorage.removeItem('wotb-ui-profile')
  })
})

describe('App user menu（V2：Teleport 到 body，脱离 .topbar overflow 裁切）', () => {
  let wrapper = null

  afterEach(() => {
    authState.authenticated = false
    authState.username = ''
    window.history.replaceState({}, '', '/')
    if (wrapper) wrapper.unmount()
    wrapper = null
    document.querySelectorAll('.user-menu-panel').forEach(el => el.remove())
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  /** 打开菜单：点击触发按钮。 */
  async function openMenu() {
    await wrapper.find('.user-menu-trigger').trigger('click')
    await flushPromises()
  }

  function bodyPanel() {
    return document.body.querySelector('.user-menu-panel')
  }

  it('菜单面板渲染到 body（Teleport），不受 .topbar overflow 裁切（桌面 1920px）', async () => {
    window.innerWidth = 1920
    wrapper = mountApp()
    await openMenu()
    const panel = bodyPanel()
    expect(panel).toBeTruthy()
    // happy-dom 不实现 CSS 计算；验证 DOM 结构（Teleport 到 body 直接子节点）+ 样式类
    expect(panel.parentElement).toBe(document.body)
    expect(panel.classList.contains('user-menu-panel')).toBe(true)
    // fixed top 由 inline style 提供（happy-dom 无布局，rect.bottom=0 → top=6；真实浏览器为 trigger 底部+6）
    expect(Number.isFinite(parseFloat(panel.style.top))).toBe(true)
    expect(parseFloat(panel.style.top)).toBeGreaterThanOrEqual(0)
    // 不在 .topbar 内（Teleport 生效）
    expect(wrapper.find('.topbar .user-menu-panel').exists()).toBe(false)
    // 完整显示全部菜单项（未登录 4 项）
    expect(panel.querySelectorAll('.user-menu-item').length).toBeGreaterThanOrEqual(4)
  })

  it('约 11 英寸平板宽度（834px）下菜单完整显示', async () => {
    window.innerWidth = 834
    wrapper = mountApp()
    await openMenu()
    const panel = bodyPanel()
    expect(panel).toBeTruthy()
    expect(panel.querySelectorAll('.user-menu-item').length).toBeGreaterThanOrEqual(4)
    // 平板顶栏换行（media <=1080px），菜单 fixed 定位仍有效（结构断言）
    expect(panel.parentElement).toBe(document.body)
    expect(panel.classList.contains('user-menu-panel')).toBe(true)
    expect(parseFloat(panel.style.top)).toBeGreaterThan(0)
  })

  it('iPhone 11 宽度（375px）下菜单完整显示且不超出视口', async () => {
    window.innerWidth = 375
    wrapper = mountApp()
    await openMenu()
    const panel = bodyPanel()
    expect(panel).toBeTruthy()
    const right = parseFloat(panel.style.right)
    expect(right).toBeGreaterThanOrEqual(8)
    expect(right).toBeLessThanOrEqual(375)
    expect(panel.querySelectorAll('.user-menu-item').length).toBeGreaterThanOrEqual(4)
  })

  it('已登录时显示用户名；再次点击触发按钮可关闭', async () => {
    authState.authenticated = true
    authState.username = '158布丁'
    window.innerWidth = 1280
    wrapper = mountApp()
    expect(wrapper.find('.user-menu-trigger').text()).toContain('158布丁')
    await openMenu()
    expect(bodyPanel()).toBeTruthy()
    await wrapper.find('.user-menu-trigger').trigger('click')
    await flushPromises()
    expect(bodyPanel()).toBeFalsy()
  })

  it('点击菜单外部关闭（Teleport 到 body 后仍有效）', async () => {
    window.innerWidth = 1280
    wrapper = mountApp()
    await openMenu()
    expect(bodyPanel()).toBeTruthy()
    // 点击页面主体（非菜单、非触发按钮）→ document 级监听关闭
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(bodyPanel()).toBeFalsy()
  })

  it('按 Escape 关闭菜单', async () => {
    window.innerWidth = 1280
    wrapper = mountApp()
    await openMenu()
    expect(bodyPanel()).toBeTruthy()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(bodyPanel()).toBeFalsy()
  })
})
