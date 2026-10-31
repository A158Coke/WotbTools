// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('zh'),
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    te: () => false,
  }),
}))

const auth = vi.hoisted(() => ({ authenticated: null }))
vi.mock('../composables/useAuth.js', async () => {
  const { ref } = await import('vue')
  auth.authenticated = ref(false)
  return {
    useAuth: () => ({ authenticated: auth.authenticated, login: vi.fn() }),
  }
})

const source = vi.hoisted(() => ({ loadMapIndex: vi.fn() }))
vi.mock('../scene/replaySource.js', () => ({ loadMapIndex: source.loadMapIndex }))

import MapPreviewPage from './MapPreviewPage.vue'
import { PRIMARY_NAV } from '../app/navigation.js'

/**
 * 地图预览页 contract：
 * - 登录门（未登录只给认证入口，不渲染任何清单/场景）。
 * - picker = 资产包 index.json 按 key 去重（变体空间归并基础图，首个 id 为 3D 装载入口）；
 *   2D 徽标只给 mapImages 已收录的图。
 * - URL 契约 ?map= &mode=：选中/切模式写 query，返回 picker 清掉两个键。
 * - 无 2D 底图的地图强制 3D（mode=2d 请求被归一为 3D + 明确提示）。
 */
const ROUTER = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/', component: { template: '<div />' } }],
})

function mountPage() {
  return mount(MapPreviewPage, {
    global: {
      plugins: [ROUTER],
      mocks: {
        $t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
      },
    },
  })
}

const IDX = {
  maps: {
    3: { key: 'erlenberg', display: 'Middleburg' },
    54: { key: 'erlenberg', display: 'Middleburg - Town' },
    70: { key: 'moon', display: 'Sea of Tranquility' },
  },
}

async function openAt(query = {}) {
  await ROUTER.push({ path: '/', query: { view: 'map-preview', ...query } })
  const wrapper = mountPage()
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  auth.authenticated.value = false
  source.loadMapIndex.mockReset()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
})

describe('MapPreviewPage', () => {
  it('未登录只渲染认证门，不拉取地图清单', async () => {
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt()
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="map-grid"]').exists()).toBe(false)
    expect(source.loadMapIndex).not.toHaveBeenCalled()
  })

  it('清单按 key 去重，2D 徽标只给 mapImages 已收录的地图', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt()
    const cards = wrapper.findAll('.map-card')
    expect(cards).toHaveLength(2)
    const erlenberg = cards.find(c => c.attributes('data-testid') === 'map-card-erlenberg')
    const moon = cards.find(c => c.attributes('data-testid') === 'map-card-moon')
    expect(erlenberg).toBeTruthy()
    expect(moon).toBeTruthy()
    expect(erlenberg.find('.map-card-badge').exists()).toBe(true)
    expect(moon.find('.map-card-badge').exists()).toBe(false)
  })

  it('索引失败 → 可重试的失败态；重试成功回到 picker', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValueOnce(null)
    const wrapper = await openAt()
    expect(wrapper.find('[data-testid="map-retry"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="map-grid"]').exists()).toBe(false)
    source.loadMapIndex.mockResolvedValueOnce(IDX)
    await wrapper.find('[data-testid="map-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="map-grid"]').exists()).toBe(true)
  })

  it('选中地图写 ?map= &mode=；变体 id 不出现在 URL；返回 picker 清掉两个键', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt()
    await wrapper.find('[data-testid="map-card-erlenberg"]').trigger('click')
    await flushPromises()
    expect(ROUTER.currentRoute.value.query).toMatchObject({ view: 'map-preview', map: 'erlenberg', mode: '3d' })
    expect(wrapper.find('[data-testid="map-3d-pane"]').exists()).toBe(true)
    await wrapper.find('[data-testid="map-back"]').trigger('click')
    await flushPromises()
    expect(ROUTER.currentRoute.value.query).toEqual({ view: 'map-preview' })
    expect(wrapper.find('[data-testid="map-grid"]').exists()).toBe(true)
  })

  it('无 2D 底图的地图：mode=2d 保持 URL 原样，但 effectiveMode 归一 3D + 提示横幅', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt({ map: 'moon', mode: '2d' })
    expect(ROUTER.currentRoute.value.query.mode).toBe('2d')
    expect(wrapper.find('[data-testid="map-2d-unsupported"]').exists()).toBe(true)
    const pane3d = wrapper.find('[data-testid="map-3d-pane"]')
    expect(pane3d.exists()).toBe(true)
    expect(pane3d.isVisible()).toBe(true)
    const pane2d = wrapper.find('[data-testid="map-2d-pane"]')
    expect(pane2d.exists()).toBe(true)
    // happy-dom 下 isVisible 不检查祖先链：v-show 落在包装元素上，直接断言其 display
    expect(pane2d.element.parentElement.style.display).toBe('none')
    expect(wrapper.findComponent({ name: 'MapPreview3DPane' }).props('mapId')).toBe(70)
  })

  it('2D 徽标地图可切 2D 模式（v-show 共存，两个 pane 都挂载）', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt({ map: 'erlenberg', mode: '2d' })
    expect(wrapper.find('[data-testid="map-2d-pane"]').isVisible()).toBe(true)
    expect(wrapper.find('[data-testid="map-3d-pane"]').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'MapPreview2DPane' }).props('mapKey')).toBe('erlenberg')
  })

  it('视图注册：PRIMARY_NAV 含 maps 且 view 值为 map-preview（导航测试之外的身份锁）', () => {
    expect(PRIMARY_NAV.some(item => item.id === 'maps' && item.view === 'map-preview')).toBe(true)
  })
})
