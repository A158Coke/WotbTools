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
  it('遭遇选项在 assault 恰 1 candidate 时提供：erlenberg/canyon 可选，moon 无几何不显示切换', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    // erlenberg：base 变体（er0）恰 1 条遭遇 candidate（其它变体点位已在生成期过滤）
    // → 提供遭遇选项；缺省仍按「有争霸先争霸」回落 supremacy
    const wrapper = await openAt({ map: 'erlenberg' })
    expect(wrapper.findComponent({ name: 'MapPreview3DPane' }).props('basesKind')).toBe('supremacy')
    expect(wrapper.find('.map-bases-switch').exists()).toBe(true)
    expect(wrapper.find('[data-testid="map-bases-supremacy"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="map-bases-encounter"]').exists()).toBe(true)
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

  it('?bases=encounter 在单 candidate 图（erlenberg）被接受；多 candidate 拒绝规则见 mapBasesKind 单测', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const wrapper = await openAt({ map: 'erlenberg', bases: 'encounter' })
    expect(wrapper.findComponent({ name: 'MapPreview3DPane' }).props('basesKind')).toBe('assault')
    const w2d = await openAt({ map: 'erlenberg', mode: '2d', bases: 'encounter' })
    expect(w2d.findComponent({ name: 'MapPreview2DPane' }).props('basesKind')).toBe('assault')
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

  it('多变体：同一 key 的条目全保留，切变体改 mapId 与基地组（边界随 id 裁剪）', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue({ maps: {
      42: { key: 'neptune', display: 'Normandy', variantKey: 'neptune', variant: 'nt0' },
      58: { key: 'neptune', display: 'Normandy - Hills', variantKey: 'neptune_01', variant: 'nt1' },
      59: { key: 'neptune', display: 'Normandy - Beach', variantKey: 'neptune_02', variant: 'nt2' },
    } })
    const wrapper = await openAt({ map: 'neptune' })
    // 变体选择器 3 项（资产 key 仍只物化一份）
    expect(wrapper.find('[data-testid="map-variant-42"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="map-variant-59"]').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'MapPreview3DPane' }).props('mapId')).toBe(42)
    expect(wrapper.findComponent({ name: 'MapPreview3DPane' }).props('basesKind')).toBe('supremacy')
    // 基础变体：标题走本地化 mapLabel（不是资产 display），出生点用 nt0 档案
    expect(wrapper.find('.map-stage-name').text()).toBe('滩涂阵地')
    expect(wrapper.findComponent({ name: 'MapPreview3DPane' }).props('spawnPoints')?.length).toBeGreaterThan(0)
    await wrapper.find('[data-testid="map-variant-58"]').trigger('click')
    await flushPromises()
    expect(ROUTER.currentRoute.value.query.variant).toBe('58')
    const pane = wrapper.findComponent({ name: 'MapPreview3DPane' })
    expect(pane.props('mapId')).toBe(58)            // 3D 变体裁剪按 map_id
    expect(pane.props('basesKind')).toBe('assault') // nt1 只有控制点 → 遭遇
    // 额外变体：本地化未登记 → 回退资产 display；nt1 无已验证出生点档案 → 隐藏
    expect(wrapper.find('.map-stage-name').text()).toBe('Normandy - Hills')
    expect(pane.props('spawnPoints')).toBe(null)
    await wrapper.find('[data-testid="map-back"]').trigger('click')
    await flushPromises()
    expect(ROUTER.currentRoute.value.query.variant).toBeUndefined()
  })

  it('额外变体缺 variant 标签（旧索引形状）：不得复用基础语义档案（fail-closed）', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    // IDX 的 erlenberg：id3（基础）与 id54（额外，无 variant）同 key；erlenberg 语义
    // 档案带 battleVariant=er0 ⇒ 只服务基础条目，id54 不能拿 28 个 er0 出生点/边界。
    const w = await openAt({ map: 'erlenberg', variant: '54' })
    expect(ROUTER.currentRoute.value.query.variant).toBe('54')
    expect(w.findComponent({ name: 'MapPreview3DPane' }).props('spawnPoints')).toBe(null)
    const pane2d = w.findComponent({ name: 'MapPreview2DPane' })
    expect(pane2d.props('variant')).toBe(null)
    expect(pane2d.props('variantIsBase')).toBe(false)
    const overview = pane2d.findComponent({ name: 'BattleMap' }).props('pbOverview')
    expect(overview.spawnPoints).toEqual([])
    expect('playableBounds' in overview).toBe(false)
    // 基础条目（id3）照常可用
    const base = await openAt({ map: 'erlenberg' })
    expect(base.findComponent({ name: 'MapPreview3DPane' }).props('spawnPoints')?.length).toBeGreaterThan(0)
  })

  it('?bases= 指向无几何的组 → 回落（有争霸先争霸），不显示空选项', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    // moon 无任何几何：?bases=supremacy 无对应几何 → null（不是从 URL 硬套）
    const w = await openAt({ map: 'moon', bases: 'supremacy' })
    expect(w.findComponent({ name: 'MapPreview3DPane' }).props('basesKind')).toBe(null)
    expect(w.find('.map-bases-switch').exists()).toBe(false)
  })

  it('跨视角 Team 身份色回归：Erlenberg 28 点（14+14）、原序原值、2D/3D 同源 scene-team（#835）', async () => {
    const erlenbergModule = await vi.importActual('../../../common/map-semantics/03_erlenberg_er.semantic.json')
    const erlenbergSemantic = erlenbergModule.default ?? erlenbergModule
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    // 3D 面板：同一 mapGridProfile.spawnPoints
    const w3d = await openAt({ map: 'erlenberg', mode: '3d' })
    const points = w3d.findComponent({ name: 'MapPreview3DPane' }).props('spawnPoints')
    // 真实 Erlenberg 语义档：总数 28、Team 1=14、Team 2=14
    expect(points).toHaveLength(28)
    expect(points.filter(p => p.team === 1)).toHaveLength(14)
    expect(points.filter(p => p.team === 2)).toHaveLength(14)
    // 未重排、未改坐标：与语义 JSON 的 spawnpoint 序列逐项相等（name/x/y 原值原序）
    const raw = erlenbergSemantic.sceneEvidence.battlePoints
      .filter(p => p.type === 'spawnpoint' && (p.team === 1 || p.team === 2))
      .map(p => ({ name: p.name, x: p.position[0], y: p.position[1] }))
    expect(points.map(p => ({ name: p.name, x: p.x, y: p.y }))).toEqual(raw)
    // 2D 面板：BattleMap 收到显式 scene-team 模式（与 3D 同一 team 语义，Presentation opt-in）
    const w2d = await openAt({ map: 'erlenberg', mode: '2d' })
    const battleMap = w2d.findComponent({ name: 'MapPreview2DPane' }).findComponent({ name: 'BattleMap' })
    expect(battleMap.props('spawnColorMode')).toBe('scene-team')
    // fail-closed：无语义档地图不制造任何出生点标记
    const w2dNone = await openAt({ map: 'rudniki_01', mode: '2d' })
    const battleMapNone = w2dNone.findComponent({ name: 'MapPreview2DPane' }).findComponent({ name: 'BattleMap' })
    if (battleMapNone.exists()) {
      expect(battleMapNone.findAll('.pb-spawns circle')).toHaveLength(0)
    }
  })

  it('东西向分组地图（canyon）team 值与地理方向无关：team1 在西、team2 在东，颜色按 team 不按方向（#835）', async () => {
    auth.authenticated.value = true
    source.loadMapIndex.mockResolvedValue(IDX)
    const w3d = await openAt({ map: 'canyon', mode: '3d' })
    const points = w3d.findComponent({ name: 'MapPreview3DPane' }).props('spawnPoints')
    expect(Array.isArray(points)).toBe(true)
    expect(points.length).toBeGreaterThan(0)
    // 真实 canyon 语义档：team=1 物理朝西（x 显著小于 team=2）——证明颜色源是 team 字段，
    // 不是 NORTH/SOUTH 或画面左右推断
    const xs1 = points.filter(p => p.team === 1).map(p => p.x)
    const xs2 = points.filter(p => p.team === 2).map(p => p.x)
    expect(xs1.length).toBeGreaterThan(0)
    expect(xs2.length).toBeGreaterThan(0)
    expect(Math.max(...xs1)).toBeLessThan(Math.min(...xs2))
  })

  it('视图注册：PRIMARY_NAV 含 maps 且 view 值为 map-preview（导航测试之外的身份锁）', () => {
    expect(PRIMARY_NAV.some(item => item.id === 'maps' && item.view === 'map-preview')).toBe(true)
  })
})
