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

/**
 * 地图预览页 contract：
 * - 登录门（未登录只给认证入口，不渲染任何清单/场景）。
 * - picker = 资产包 index.json 按 key 去重（变体空间归并基础图，首个 id 为 3D 装载入口）；
 *   默认只显示 common/map_names.json 登记了 zh 的 key（人工认可目录，与 UI locale 无关），
 *   「显示全部地图」开关展开其余资产条目（会话状态：不写 URL、不写持久化）。
 * - URL 契约 ?map= &mode=：默认隐藏的地图仍可由深链打开；点击地图缺省写 mode=2d；
 *   切模式/基地只改自己的键，返回 picker 清掉 map/mode/bases。
 */

const { ROUTER, IDX, ALL_KEYS, ZH_KEYS, HIDDEN_KEYS, cardKeys, toggleShowAll, openAt } = createMapPreviewPageTestHelpers({ MapPreviewPage, createRouter, createMemoryHistory, mount, DIALOG_INLINE_KEY, flushPromises })

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
  it('未登录只渲染认证门，不拉取地图清单', async () => {
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt()
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="map-grid"]').exists()).toBe(false)
    expect(source.loadMapIndex).not.toHaveBeenCalled()
  })

  it('fixture 自证：可见性判据是 map_names.json 的 zh，不是资产 display 文案', () => {
    // 双锁：字面量列表与真实目录一致（避免用生产判据当唯一 oracle，也避免写死卡片总数）
    expect(ZH_KEYS.every((key) => hasChineseMapName(key))).toBe(true)
    expect(HIDDEN_KEYS.some((key) => hasChineseMapName(key))).toBe(false)
    expect([...ZH_KEYS, ...HIDDEN_KEYS].sort()).toEqual([...ALL_KEYS].sort())
    // 这些 key 的资产 display 都是英文，其中 grossberg 的 display 与 key 完全不同——
    // 若实现改成「name !== key」或 CJK 正则判断，下面的默认过滤测试会失败
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
    // 同一批卡片（可见集合不变），只是显示名切到英文
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
    // 2D/3D 都必须用真正没有 zh 的 hidden key（moon 已登记中文名，属默认可见）
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
    // #835：无语义档的地图 spawnPoints 下发 null（fail-closed，内核不画、不猜坐标）
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
    // 变体 id 54 与 id 3 同为 erlenberg → 只渲染一张卡
    expect(cardKeys(wrapper)).toEqual([...ALL_KEYS].sort())
    expect(wrapper.findAll('[data-testid="map-card-erlenberg"]')).toHaveLength(1)
    const erlenberg = wrapper.find('[data-testid="map-card-erlenberg"]')
    const moon = wrapper.find('[data-testid="map-card-moon"]')
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
    await toggleShowAll(wrapper)
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
})
