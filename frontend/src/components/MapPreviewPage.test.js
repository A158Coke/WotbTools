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
import { PRIMARY_NAV } from '../app/navigation.js'
import { assetProvider } from '../scene/assetProvider.js'
import { hasChineseMapName } from '../utils/helpers.js'
import zhMessages from '../locales/zh.json'
import enMessages from '../locales/en.json'
import ruMessages from '../locales/ru.json'


const { ROUTER, IDX, ALL_KEYS, ZH_KEYS, HIDDEN_KEYS, cardKeys, toggleShowAll, openAt } = createMapPreviewPageTestHelpers({ MapPreviewPage, createRouter, createMemoryHistory, mount, DIALOG_INLINE_KEY, flushPromises })

beforeEach(() => {
  __resetAssetBaseForTests()
  auth.authenticated.value = false
  if (i18n.locale) i18n.locale.value = 'zh'
  source.loadMapIndex.mockReset()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
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

  it('fixture 自证：可见性判据是 map_names.json 的 zh，不是资产 display 文案', () => {
    expect(ZH_KEYS.every((key) => hasChineseMapName(key))).toBe(true)
    expect(HIDDEN_KEYS.some((key) => hasChineseMapName(key))).toBe(false)
    expect([...ZH_KEYS, ...HIDDEN_KEYS].sort()).toEqual([...ALL_KEYS].sort())
    expect(IDX.maps[31].display).toBe("Dynasty's Pearl")
  })

  it('默认只显示已登记中文名的地图，其余资产条目隐藏', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt()
    expect(cardKeys(wrapper)).toEqual([...ZH_KEYS].sort())
    for (const key of HIDDEN_KEYS) {
      expect(wrapper.find(`[data-testid="map-card-${key}"]`).exists(), key).toBe(false)
    }
  })

  it('新增 5 张地图在 zh locale 显示用户确认的中文名', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt()
    const expected = {
      erlenberg_old: '米德尔博格 2014版',
      grossberg: '王朝的珍珠',
      savanna_old: '沙漠之心2014版',
      moon: '寂静星海',
      iceworld: '永恒冻土',
    }
    for (const [key, name] of Object.entries(expected)) {
      const card = wrapper.find(`[data-testid="map-card-${key}"]`)
      expect(card.exists(), key).toBe(true)
      expect(card.find('.map-card-name').text(), key).toBe(name)
    }
  })

  it('可见集合与 UI locale 无关：切到 en 只改显示名，不改变默认过滤', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt()
    const before = cardKeys(wrapper)
    expect(wrapper.find('[data-testid="map-card-grossberg"] .map-card-name').text()).toBe('王朝的珍珠')
    i18n.locale.value = 'en'
    await flushPromises()
    expect(cardKeys(wrapper)).toEqual(before)
    expect(wrapper.find('[data-testid="map-card-grossberg"] .map-card-name').text()).toBe("Dynasty's Pearl")
    expect(wrapper.find('[data-testid="map-card-moon"] .map-card-name').text()).toBe('Sea of Tranquility')
    expect(wrapper.find('[data-testid="map-card-canal_01"]').exists()).toBe(false)
  })

  it('「显示全部地图」开关展开/收起未登记条目，且不写 URL', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt()
    const toggle = wrapper.find('[data-testid="map-show-all"]')
    expect(toggle.attributes('aria-checked')).toBe('false')
    await toggleShowAll(wrapper)
    expect(toggle.attributes('aria-checked')).toBe('true')
    expect(cardKeys(wrapper)).toEqual([...ALL_KEYS].sort())
    expect(ROUTER.currentRoute.value.query).toEqual({ view: 'map-preview' })
    await toggleShowAll(wrapper)
    expect(toggle.attributes('aria-checked')).toBe('false')
    expect(cardKeys(wrapper)).toEqual([...ZH_KEYS].sort())
    expect(wrapper.find('[data-testid="map-card-rudniki_01"]').exists()).toBe(false)
  })

  it('搜索按 key / 显示名过滤，并能搜到默认隐藏的地图；无匹配时说明', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt()
    await wrapper.find('[data-testid="map-search"]').setValue('rudniki')
    expect(cardKeys(wrapper)).toEqual(['rudniki_01', 'rudniki_03'])
    await wrapper.find('[data-testid="map-search"]').setValue('zzz-no-such-map')
    expect(cardKeys(wrapper)).toEqual([])
    expect(wrapper.find('[data-testid="map-search-empty"]').exists()).toBe(true)
  })

  it('默认隐藏的地图仍可被 ?map= 深链打开（2D/3D），返回 picker 后仍默认隐藏', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    expect(HIDDEN_KEYS).toContain('rudniki_01')
    const w2d = await openAt({ map: 'rudniki_01', mode: '2d' })
    expect(ROUTER.currentRoute.value.query).toMatchObject({ view: 'map-preview', map: 'rudniki_01', mode: '2d' })
    expect(w2d.find('[data-testid="map-grid"]').exists()).toBe(false)
    expect(w2d.find('[data-testid="map-2d-pane"]').isVisible()).toBe(true)
    expect(w2d.findComponent({ name: 'MapPreview2DPane' }).props('mapKey')).toBe('rudniki_01')
    expect(w2d.findComponent({ name: 'MapPreview2DPane' }).props('basemap')).toEqual({ kind: 'map2d', mapKey: 'rudniki_01' })

    const w3d = await openAt({ map: 'rudniki_03', mode: '3d' })
    expect(w3d.find('[data-testid="map-3d-pane"]').element.parentElement.style.display).toBe('')
    expect(w3d.findComponent({ name: 'MapPreview3DPane' }).props('mapKey')).toBe('rudniki_03')
    expect(w3d.findComponent({ name: 'MapPreview3DPane' }).props('spawnPoints')).toBeNull()
    await w3d.find('[data-testid="map-back"]').trigger('click')
    await flushPromises()
    expect(w3d.find('[data-testid="map-grid"]').exists()).toBe(true)
    expect(w3d.find('[data-testid="map-card-rudniki_03"]').exists()).toBe(false)
  })

  it('「显示全部地图」三语键齐全（zh / en / ru）', () => {
    for (const messages of [zhMessages, enMessages, ruMessages]) {
      expect(typeof messages.mapPreview.showAllMaps).toBe('string')
      expect(messages.mapPreview.showAllMaps.length).toBeGreaterThan(0)
    }
  })

  it('按 key 去重后的完整清单（显示全部）都有封面与 2D 徽标', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt()
    await toggleShowAll(wrapper)
    expect(cardKeys(wrapper)).toEqual([...ALL_KEYS].sort())
    expect(wrapper.findAll('[data-testid="map-card-erlenberg"]')).toHaveLength(1)
    const erlenberg = wrapper.find('[data-testid="map-card-erlenberg"]')
    const moon = wrapper.find('[data-testid="map-card-moon"]')
    expect(erlenberg.find('.map-card-badge').exists()).toBe(true)
    expect(moon.find('.map-card-badge').exists()).toBe(true)
    expect(erlenberg.find('.map-card-thumb img').attributes('src')).toContain('/cover/erlenberg.webp')
    expect(moon.find('.map-card-thumb img').attributes('src')).toContain('/cover/moon.webp')
  })

  it('cover URL 不可用（Android 离线门控抛错）→ 有 bundled 的图用打包底图兜底', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    assetProvider.url.mockImplementation((p) => {
      if (p.startsWith('/cover/')) throw new Error('NETWORK_ERROR')
      return 'https://assets.test' + p
    })
    const wrapper = await openAt()
    await toggleShowAll(wrapper)
    const erlenberg = wrapper.find('[data-testid="map-card-erlenberg"]')
    expect(erlenberg.find('[data-testid="map-thumb-fallback-erlenberg"]').exists()).toBe(true)
    expect(erlenberg.find('.map-card-thumb-fallback').exists()).toBe(false)
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
    expect(wrapper.find('[data-testid="map-thumb-erlenberg"]').exists()).toBe(false)
    const fb = wrapper.find('[data-testid="map-thumb-fallback-erlenberg"]')
    expect(fb.exists()).toBe(true)
    expect(fb.attributes('src')).toBeTruthy()
    expect(fb.attributes('src')).not.toContain('/cover/')
  })

  it('bundled 兜底图自身加载失败 → 落占位图标，两个 URL 都不再重试', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    assetProvider.url.mockImplementation((p) => {
      if (p.startsWith('/cover/')) throw new Error('NETWORK_ERROR')
      return 'https://assets.test' + p
    })
    const wrapper = await openAt()
    const fb = wrapper.find('[data-testid="map-thumb-fallback-erlenberg"]')
    expect(fb.exists()).toBe(true)
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
})
