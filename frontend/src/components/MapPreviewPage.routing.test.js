// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import { ref } from 'vue'
import { createMapPreviewPageTestHelpers } from '../test/MapPreviewPageTestHelpers.js'
import { __resetAssetBaseForTests } from '../scene/assetBase.js'

const i18n = vi.hoisted(() => ({ locale: null }))
vi.mock('vue-i18n', async () => {
  const { ref } = await import('vue')
  i18n.locale = ref('zh')
  return {
    useI18n: () => ({
      locale: i18n.locale,
      t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
      te: () => false,
    }),
  }
})

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
import { assetProvider } from '../scene/assetProvider.js'

/**
 * 地图预览页 contract：
 * - 登录门（未登录只给认证入口，不渲染任何清单/场景）。
 * - picker = 资产包 index.json 按 key 去重（变体空间归并基础图，首个 id 为 3D 装载入口）；
 *   默认只显示 common/map_names.json 登记了 zh 的 key（人工认可目录，与 UI locale 无关），
 *   「显示全部地图」开关展开其余资产条目（会话状态：不写 URL、不写持久化）。
 * - URL 契约 ?map= &mode=：默认隐藏的地图仍可由深链打开；点击地图缺省写 mode=2d；
 *   切模式/基地只改自己的键，返回 picker 清掉 map/mode/bases。
 */

const { ROUTER, IDX, openAt } = createMapPreviewPageTestHelpers({ MapPreviewPage, createRouter, createMemoryHistory, mount, DIALOG_INLINE_KEY, flushPromises })

beforeEach(() => {
  // 每个用例模拟一次新的页面加载：dataset 在页面内固定，切换只经整页重载。
  __resetAssetBaseForTests()
  auth.authenticated.value = false
  if (i18n.locale) i18n.locale.value = 'zh'
  source.loadMapIndex.mockReset()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
  // ground.webp 回退封面依赖资产源已配置（CI 无 .env.local）：与 replaySource.test.js
  // 同款 spy，URL 断言不随运行环境漂移
  vi.spyOn(assetProvider, 'configured').mockReturnValue(true)
  vi.spyOn(assetProvider, 'url').mockImplementation((p) => 'https://assets.test' + p)
})

describe('MapPreviewPage', () => {
  it('选中地图缺省写 mode=2d；变体 id 不出现在 URL；返回 picker 清掉三个键', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt()
    await wrapper.find('[data-testid="map-card-erlenberg"]').trigger('click')
    await flushPromises()
    expect(ROUTER.currentRoute.value.query).toMatchObject({ view: 'map-preview', map: 'erlenberg', mode: '2d' })
    expect(wrapper.find('[data-testid="map-2d-pane"]').isVisible()).toBe(true)
    expect(wrapper.find('[data-testid="map-3d-pane"]').element.parentElement.style.display).toBe('none')
    await wrapper.find('[data-testid="map-back"]').trigger('click')
    await flushPromises()
    expect(ROUTER.currentRoute.value.query).toEqual({ view: 'map-preview' })
    expect(wrapper.find('[data-testid="map-grid"]').exists()).toBe(true)
  })

  it('有语义档的地图把 spawnPoints 下发给 3D 面板（与 2D 同一数据源，#835）', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt({ map: 'erlenberg', mode: '3d' })
    const pane = wrapper.findComponent({ name: 'MapPreview3DPane' })
    const points = pane.props('spawnPoints')
    expect(Array.isArray(points)).toBe(true)
    expect(points.length).toBeGreaterThan(0)
    // 解析面契约：每点至少有限 x/y（parseMapGridProfile 已过滤非有限条目）
    for (const pt of points) {
      expect(Number.isFinite(pt.x)).toBe(true)
      expect(Number.isFinite(pt.y)).toBe(true)
    }
  })

  it('无 mode 深链默认 2D；显式 mode=3d 深链仍 3D', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const w = await openAt({ map: 'erlenberg' })
    expect(ROUTER.currentRoute.value.query.mode).toBeUndefined()
    expect(w.find('[data-testid="map-2d-pane"]').isVisible()).toBe(true)
    expect(w.find('[data-testid="map-3d-pane"]').element.parentElement.style.display).toBe('none')
    // 显式 3D 深链不被缺省值改写
    const w3 = await openAt({ map: 'erlenberg', mode: '3d' })
    expect(ROUTER.currentRoute.value.query.mode).toBe('3d')
    expect(w3.find('[data-testid="map-3d-pane"]').element.parentElement.style.display).toBe('')
    expect(w3.find('[data-testid="map-2d-pane"]').element.parentElement.style.display).toBe('none')
  })

  it('2D⇄3D 只改 mode，保留 map / bases；bases 切换保留 mode', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt({ map: 'canyon', mode: '2d', bases: 'encounter' })
    expect(wrapper.findComponent({ name: 'MapPreview2DPane' }).props('basesKind')).toBe('assault')
    await wrapper.find('[data-testid="map-mode-3d"]').trigger('click')
    await flushPromises()
    expect(ROUTER.currentRoute.value.query).toMatchObject({
      view: 'map-preview', map: 'canyon', bases: 'encounter', mode: '3d',
    })
    expect(wrapper.findComponent({ name: 'MapPreview3DPane' }).props('basesKind')).toBe('assault')
    await wrapper.find('[data-testid="map-mode-2d"]').trigger('click')
    await flushPromises()
    expect(ROUTER.currentRoute.value.query).toMatchObject({ map: 'canyon', bases: 'encounter', mode: '2d' })
    // 基地 selector 是独立维度：切争霸只改 bases
    await wrapper.find('[data-testid="map-bases-supremacy"]').trigger('click')
    await flushPromises()
    expect(ROUTER.currentRoute.value.query).toMatchObject({ map: 'canyon', mode: '2d', bases: 'supremacy' })
    expect(wrapper.findComponent({ name: 'MapPreview2DPane' }).props('basesKind')).toBe('supremacy')
  })

  it('mode=2d 直挂 2D 面板：map2d 底图由面板异步解析（bundled 图直挂）', async () => {
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
    // 页面只下发描述符；map2d 1254² 的异步解析与 fail-visible 在面板自身
    expect(pane.props('basemap')).toEqual({ kind: 'map2d', mapKey: 'moon' })
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

  it('显式 dataset 选择：bundled 图也优先用 dataset map2d，并带 bundled 兜底', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    localStorage.setItem('wotb_data_version', '11.21.0')
    try {
      const wrapper = await openAt({ map: 'erlenberg', mode: '2d' })
      const pane = wrapper.findComponent({ name: 'MapPreview2DPane' })
      expect(pane.props('basemap')).toMatchObject({ kind: 'map2d', mapKey: 'erlenberg' })
      expect(pane.props('basemap').fallbackImage).toBeTruthy()
    } finally {
      localStorage.removeItem('wotb_data_version')
    }
  })

  // ---- 基地点位（?bases=）：争霸/遭遇切换，两个 pane 共用同一 kind ----
})
