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
vi.mock('../scene/replaySource.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadMapIndex: source.loadMapIndex,
}))

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

  it('清单按 key 去重：全部地图都有封面（bundled 优先、ground.webp 回退）与 2D 徽标', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt()
    const cards = wrapper.findAll('.map-card')
    expect(cards).toHaveLength(2)
    const erlenberg = cards.find(c => c.attributes('data-testid') === 'map-card-erlenberg')
    const moon = cards.find(c => c.attributes('data-testid') === 'map-card-moon')
    expect(erlenberg).toBeTruthy()
    expect(moon).toBeTruthy()
    // 双图都有 2D 徽标（ground.webp 回退后 43 图全可进 2D）
    expect(erlenberg.find('.map-card-badge').exists()).toBe(true)
    expect(moon.find('.map-card-badge').exists()).toBe(true)
    // 封面双源：bundled 打包图 vs ground.webp 资产回退
    expect(erlenberg.find('.map-card-thumb img').attributes('src')).toBeTruthy()
    expect(erlenberg.find('.map-card-thumb img').attributes('src')).not.toContain('ground.webp')
    expect(moon.find('.map-card-thumb img').attributes('src')).toContain('/map/moon/ground.webp')
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

  it('mode=2d 直挂 2D 面板：bundled 图直接就绪，ground 回退图由面板异步解析', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt({ map: 'moon', mode: '2d' })
    const pane2d = wrapper.find('[data-testid="map-2d-pane"]')
    expect(pane2d.exists()).toBe(true)
    expect(pane2d.isVisible()).toBe(true)
    const pane3d = wrapper.find('[data-testid="map-3d-pane"]')
    expect(pane3d.exists()).toBe(true)
    expect(pane3d.element.parentElement.style.display).toBe('none')
    const pane = wrapper.findComponent({ name: 'MapPreview2DPane' })
    expect(pane.props('mapKey')).toBe('moon')
    // 页面只下发描述符；ground.webp 的异步解析与 fail-visible 在面板自身
    expect(pane.props('basemap')).toEqual({ kind: 'ground', mapKey: 'moon' })
  })

  it('bundled 图 2D 模式：描述符携带打包注册表条目（3D 面板同场共存）', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt({ map: 'erlenberg', mode: '2d' })
    expect(wrapper.find('[data-testid="map-2d-pane"]').isVisible()).toBe(true)
    const pane = wrapper.findComponent({ name: 'MapPreview2DPane' })
    expect(pane.props('basemap')).toMatchObject({ kind: 'bundled' })
    expect(pane.props('basemap').image.src).toBeTruthy()
    expect(pane.props('basemap').image.coordinateBounds).toEqual({ xMin: -300, xMax: 300, yMin: -300, yMax: 300 })
  })

  it('视图注册：PRIMARY_NAV 含 maps 且 view 值为 map-preview（导航测试之外的身份锁）', () => {
    expect(PRIMARY_NAV.some(item => item.id === 'maps' && item.view === 'map-preview')).toBe(true)
  })
})
