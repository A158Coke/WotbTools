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
import { assetProvider } from '../scene/assetProvider.js'

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
    8: { key: 'canyon', display: 'Canyon' },
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
  // ground.webp 回退封面依赖资产源已配置（CI 无 .env.local）：与 replaySource.test.js
  // 同款 spy，URL 断言不随运行环境漂移
  vi.spyOn(assetProvider, 'configured').mockReturnValue(true)
  vi.spyOn(assetProvider, 'url').mockImplementation((p) => 'https://assets.test' + p)
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
    expect(cards).toHaveLength(3)
    const erlenberg = cards.find(c => c.attributes('data-testid') === 'map-card-erlenberg')
    const moon = cards.find(c => c.attributes('data-testid') === 'map-card-moon')
    expect(erlenberg).toBeTruthy()
    expect(moon).toBeTruthy()
    // 双图都有 2D 徽标（ground.webp 回退后 43 图全可进 2D）
    expect(erlenberg.find('.map-card-badge').exists()).toBe(true)
    expect(moon.find('.map-card-badge').exists()).toBe(true)
    // 封面统一 cover.webp（512² 战术风格，43/43 同源）：bundled 不再走打包图
    expect(erlenberg.find('.map-card-thumb img').attributes('src')).toContain('/cover/erlenberg.webp')
    expect(moon.find('.map-card-thumb img').attributes('src')).toContain('/cover/moon.webp')
  })

  it('cover URL 不可用（Android 离线门控抛错）→ 有 bundled 的图用打包底图兜底', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    // 只让 cover URL 抛（模拟 NETWORK_ERROR），其余不变
    assetProvider.url.mockImplementation((p) => {
      if (p.startsWith('/cover/')) throw new Error('NETWORK_ERROR')
      return 'https://assets.test' + p
    })
    const wrapper = await openAt()
    const erlenberg = wrapper.find('[data-testid="map-card-erlenberg"]')
    // 无 cover → 走 thumbFallback（打包底图），不落占位图标
    expect(erlenberg.find('[data-testid="map-thumb-fallback-erlenberg"]').exists()).toBe(true)
    expect(erlenberg.find('.map-card-thumb-fallback').exists()).toBe(false)
    // moon 无打包图 → 占位图标
    expect(wrapper.find('[data-testid="map-card-moon"]').find('.map-card-thumb-fallback').exists()).toBe(true)
  })

  it('cover 图片加载失败 → 切到 bundled 兜底且不重试远端', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt()
    const coverImg = wrapper.find('[data-testid="map-thumb-erlenberg"]')
    expect(coverImg.attributes('src')).toContain('/cover/erlenberg.webp')
    await coverImg.trigger('error')
    await flushPromises()
    // thumb 置空 → 模板改渲染 fallback（打包底图），远端 URL 不再出现
    expect(wrapper.find('[data-testid="map-thumb-erlenberg"]').exists()).toBe(false)
    const fb = wrapper.find('[data-testid="map-thumb-fallback-erlenberg"]')
    expect(fb.exists()).toBe(true)
    expect(fb.attributes('src')).toBeTruthy()
    expect(fb.attributes('src')).not.toContain('/cover/')
  })

  it('bundled 兜底图自身加载失败 → 落占位图标，两个 URL 都不再重试', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    // cover 直接不可得（Android 离线门控）→ 模板走 bundled 兜底
    assetProvider.url.mockImplementation((p) => {
      if (p.startsWith('/cover/')) throw new Error('NETWORK_ERROR')
      return 'https://assets.test' + p
    })
    const wrapper = await openAt()
    const fb = wrapper.find('[data-testid="map-thumb-fallback-erlenberg"]')
    expect(fb.exists()).toBe(true)
    // bundled 兜底自己加载失败（@error）→ 独立失败集合置空 thumbFallback → 占位图标
    await fb.trigger('error')
    await flushPromises()
    expect(wrapper.find('[data-testid="map-thumb-fallback-erlenberg"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="map-card-erlenberg"]').find('.map-card-thumb-fallback').exists()).toBe(true)
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

  // ---- 基地点位（?bases=）：争霸/遭遇切换，两个 pane 共用同一 kind ----
  it('遭遇选项只在 assault 恰好 1 candidate 时提供：erlenberg（3 条）不出现，canyon（1 条）可选', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    // erlenberg：supremacy 3 条 + assault 3 条（攻防/遭遇条目无法归属）→
    // 默认回落 supremacy，且**不提供**遭遇选项（选中即 0 点位的假选项不给用户）
    const wrapper = await openAt({ map: 'erlenberg' })
    expect(wrapper.findComponent({ name: 'MapPreview3DPane' }).props('basesKind')).toBe('supremacy')
    expect(wrapper.find('.map-bases-switch').exists()).toBe(true)
    expect(wrapper.find('[data-testid="map-bases-supremacy"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="map-bases-encounter"]').exists()).toBe(false)
    // canyon：assault 恰 1 条 candidate → 遭遇可选，kind 下发 assault
    const w2 = await openAt({ map: 'canyon' })
    expect(w2.findComponent({ name: 'MapPreview3DPane' }).props('basesKind')).toBe('supremacy')
    expect(w2.find('[data-testid="map-bases-encounter"]').exists()).toBe(true)
    await ROUTER.replace({ query: { view: 'map-preview', map: 'canyon', bases: 'encounter' } })
    await flushPromises()
    expect(w2.findComponent({ name: 'MapPreview3DPane' }).props('basesKind')).toBe('assault')
    // moon 无基地几何 → null 且整个切换不渲染（fail-closed，不从内容猜）
    const w3 = await openAt({ map: 'moon' })
    expect(w3.findComponent({ name: 'MapPreview3DPane' }).props('basesKind')).toBe(null)
    expect(w3.find('.map-bases-switch').exists()).toBe(false)
  })

  it('?bases=encounter 指向多 candidate 组 → 拒绝并回落 supremacy（URL 接受同一判据）', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt({ map: 'erlenberg', bases: 'encounter' })
    expect(wrapper.findComponent({ name: 'MapPreview3DPane' }).props('basesKind')).toBe('supremacy')
    const w2d = await openAt({ map: 'erlenberg', mode: '2d', bases: 'encounter' })
    expect(w2d.findComponent({ name: 'MapPreview2DPane' }).props('basesKind')).toBe('supremacy')
    // 单 candidate 图上 URL 正常接受：2D/3D 同步下发 assault
    const w3 = await openAt({ map: 'canyon', mode: '2d', bases: 'encounter' })
    expect(w3.findComponent({ name: 'MapPreview2DPane' }).props('basesKind')).toBe('assault')
    // URL 切回争霸（SegmentedControl 交互归组件自身，URL → kind 契约在这里锁）
    await ROUTER.replace({ query: { view: 'map-preview', map: 'canyon', mode: '3d', bases: 'supremacy' } })
    await flushPromises()
    expect(w3.findComponent({ name: 'MapPreview3DPane' }).props('basesKind')).toBe('supremacy')
  })

  it('返回 picker 清 map/mode/bases 键', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt({ map: 'canyon', bases: 'encounter' })
    await wrapper.find('[data-testid="map-back"]').trigger('click')
    await flushPromises()
    expect(ROUTER.currentRoute.value.query).toEqual({ view: 'map-preview' })
  })

  it('?bases= 指向无几何的组 → 回落（有争霸先争霸），不显示空选项', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    // moon 无任何几何：?bases=supremacy 无对应几何 → null（不是从 URL 硬套）
    const w = await openAt({ map: 'moon', bases: 'supremacy' })
    expect(w.findComponent({ name: 'MapPreview3DPane' }).props('basesKind')).toBe(null)
    expect(w.find('.map-bases-switch').exists()).toBe(false)
  })

  it('视图注册：PRIMARY_NAV 含 maps 且 view 值为 map-preview（导航测试之外的身份锁）', () => {
    expect(PRIMARY_NAV.some(item => item.id === 'maps' && item.view === 'map-preview')).toBe(true)
  })
})
