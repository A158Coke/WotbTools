// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'

const PAIR = {
  id: '11.21.0_1__11.22.0',
  from: { dataset: '11.21.0_1', release: '20261125-ui1' },
  to: { dataset: '11.22.0', release: '20261126-mechanics1' },
  path: '11.21.0_1__11.22.0/20261125-ui1__20261126-mechanics1',
  counts: { tanks: { added: 3, removed: 0, changed: 19 }, maps: { changed: 36 } },
}

const TANK_ROW = {
  id: 3889,
  name: 'WZ-132',
  tier: 8,
  nation: 'china',
  type: 'lightTank',
  status: 'changed',
  categories: ['survivability', 'armor'],
  chips: [{ path: 'hp', old: 1000, new: 1100 }],
  detail: 'tanks/3889.json',
}

const ADDED_TANK = { id: 23681, name: 'TBT', tier: 9, nation: 'european', type: 'heavyTank', status: 'added', premium: true }

const RESEARCH_ONLY = { id: 4449, name: 'IS-2 Pravda SP', status: 'changed', categories: ['research'], detail: 'tanks/4449.json' }

const MODEL_ONLY = { id: 4385, name: 'T32', tier: 8, nation: 'usa', type: 'heavyTank' }

const MAP_ROW = {
  mapId: 1,
  key: 'karelia',
  display: 'Rockfield',
  variantIds: [1],
  categories: ['scenery'],
  counts: { destructibleHealthChanged: 0, sceneryOld: 1416, sceneryNew: 1415, sceneryAdded: 0, sceneryRemoved: 1, grassOld: 60000, grassNew: 60000 },
  detail: 'maps/1.json',
}

const SUMMARY = {
  schema: 1,
  pair: PAIR.id,
  meta: { tool: 'version_diff.py', toolVersion: '0.1.0' },
  counts: {
    tanks: { added: 3, removed: 0, changed: 19, armorChanged: 5, modelOnly: 1, technicalOnly: 493 },
    maps: { added: 0, removed: 0, changed: 1 },
    items: {
      files: {
        consumables: { added: 0, removed: 0, changed: 4, schema: { added: {}, removed: {} } },
        skills: { added: 0, removed: 0, changed: 0, schema: { added: { 'effects.lobbyIcon': 20 }, removed: {} } },
      },
      techTree: { addedNodes: 0, removedNodes: 0, addedEdges: 0, removedEdges: 0, changedEdges: 0 },
    },
    schema: { added: { mechanics: 187, 'stats.clip': 249 }, removed: {} },
    presentation: { tankImagesChanged: 739, map2dChanged: 40, coverChanged: 40, groundChanged: 39 },
    artifacts: { modelChanged: 10, suspensionChanged: 1, treadChanged: 0, dataFilesAdded: ['data/tankMechanics.json'] },
  },
  tanks: [TANK_ROW, ADDED_TANK, RESEARCH_ONLY],
  modelOnly: [MODEL_ONLY],
  maps: [MAP_ROW],
  mapsAdded: [],
  mapsRemoved: [],
  mapsPresentationOnly: [],
  unresolved: [],
}

const TANK_DETAIL = {
  schemaVersion: 1,
  tankId: 3889,
  identity: { name: 'WZ-132', tier: 8, nation: 'china', type: 'lightTank' },
  categories: ['firepower'],
  changes: [{ path: 'hp', category: 'survivability', old: 1000, new: 1100 }],
  chips: [],
  armor: {
    summary: { 'hull.front': { old: 100, new: 120 } },
    model: {
      plates: [{ module: 'hull', plate: '3', old: 20, new: 30 }],
      addedPlates: [], removedPlates: [], primary: [], spaced: [], chassis: [], changed: true,
    },
  },
  configs: {
    changed: true,
    configs: [{
      key: { turret: '', gun: '85 mm Škoda 29', gunLocal: 106, turretLocal: 94 },
      changes: [{ path: 'shells.ap.penetration', category: 'firepower', old: 200, new: 210 }],
      schema: { added: {}, removed: {} },
    }],
    unpairedOld: [],
    unpairedNew: [],
  },
  research: { changed: false, changes: [], modulesAdded: [], modulesRemoved: [], unpaired: [], unresolved: [] },
  geometry: {},
  artifacts: {},
  schema: { added: {}, removed: {} },
  unresolved: [],
}

const MAP_DETAIL = {
  schema: 1,
  mapId: 1,
  from: { key: 'karelia', display: 'Rockfield', variantIds: [1] },
  to: { key: 'karelia', display: 'Rockfield', variantIds: [1] },
  categories: ['scenery'],
  files: { terrain: false, groundLayers: false, scenery: true, grass: false, lighting: false, destructibles: false },
  destructibles: { instancesAdded: 0, instancesRemoved: 0, healthChanged: 0, collisionTypeChanged: 0, prototypeChanged: 0, renamed: 0, moved: 0, healthChanges: [] },
  presentation: { ground: true, mini: false, map2d: true, cover: true },
  preview: { fromKey: 'karelia', toKey: 'karelia' },
}

const mocks = vi.hoisted(() => ({
  state: null,
  loadVersionDiffCatalog: vi.fn(),
  fetchPairSummary: vi.fn(),
  fetchTankDiff: vi.fn(),
  fetchMapDiff: vi.fn(),
  navigateToDataset: vi.fn(),
}))

vi.mock('../composables/useDataVersion.js', async importOriginal => ({
  ...await importOriginal(),
  navigateToDataset: mocks.navigateToDataset,
}))

vi.mock('../composables/useVersionDiff.js', async () => {
  const { ref } = await import('vue')
  mocks.state = ref({ status: 'loading', pairs: [], error: null })
  mocks.loadVersionDiffCatalog.mockImplementation(async () => mocks.state.value)
  mocks.fetchPairSummary.mockImplementation(async () => SUMMARY)
  mocks.fetchTankDiff.mockImplementation(async () => TANK_DETAIL)
  mocks.fetchMapDiff.mockImplementation(async () => MAP_DETAIL)
  return {
    versionDiffCatalogState: mocks.state,
    loadVersionDiffCatalog: mocks.loadVersionDiffCatalog,
    fetchPairSummary: mocks.fetchPairSummary,
    fetchTankDiff: mocks.fetchTankDiff,
    fetchMapDiff: mocks.fetchMapDiff,
    fetchMatchingTopConfig: vi.fn(async () => undefined),
    fetchDatasetParamsFormat: vi.fn(async () => ({ maxHealth: {}, gunShellReloadTime: { biggerIsBetter: false } })),
    fetchDatasetTank: vi.fn(async () => ({
      hp: 2050, speed_forward: 40, speed_reverse: 14,
      armor: { hull: { front: 125, sides: 70, rear: 50 } },
      configs: [{ reload_time: 12, is_burst: true, burst_size: 5, burst_interval: 0.2, view_range: 250,
        shells: [{ type: 'ap', penetration: 242, damage: 80 }] }],
    })),
    fetchDatasetTankCrops: vi.fn(async () => ({
      23681: { canvas_w: 256, canvas_h: 128, x: 20, y: 20, w: 200, h: 90 },
    })),
    datasetAssetUrl: (dataset, path) => `https://assets.test/v/${dataset}${path}`,
    datasetTankImageUrl: (dataset, tankId) => `https://assets.test/v/${dataset}/tank_images/${tankId}.webp`,
    datasetMap2dUrl: (dataset, key) => `https://assets.test/v/${dataset}/map2d/${key}.webp`,
    datasetCoverUrl: (dataset, key) => `https://assets.test/v/${dataset}/cover/${key}.webp`,
    pairAssetUrl: (pair, rel) => `https://assets.test/diffs/${pair.path}/${rel}`,
  }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    te: () => false,
  }),
}))

import AgentVersionDiff from './AgentVersionDiff.vue'
import ArmorComparisonViewport from './version-diff/ArmorComparisonViewport.vue'

async function openAt(query = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: AgentVersionDiff }],
  })
  await router.push({ path: '/', query: { view: 'agent-version-diff', ...query } })
  await router.isReady()
  const wrapper = mount(AgentVersionDiff, {
    global: {
      plugins: [router],
      stubs: { ArmorComparisonViewport: true },
      provide: { [DIALOG_INLINE_KEY]: true },
      mocks: { $t: key => key },
    },
  })
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => {
  mocks.loadVersionDiffCatalog.mockClear()
  mocks.fetchPairSummary.mockClear()
  mocks.fetchTankDiff.mockClear()
  mocks.fetchMapDiff.mockClear()
  mocks.navigateToDataset.mockClear()
  mocks.state.value = { status: 'ready', pairs: [PAIR], error: null }
  vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: true,
    json: async () => ({
      release: String(url).includes('/v/11.22.0/') ? '20261126-mechanics1' : '20261125-ui1',
    }),
  })))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AgentVersionDiff', () => {
  it('shows stat changes and uses the encyclopedia identity on new vehicles', async () => {
    const { wrapper } = await openAt()
    expect(wrapper.get('.vd-title').text()).toContain('11.22.0')
    expect(wrapper.get('.vd-pair-versions > span').text()).toBe('11.21.0_1')
    expect(wrapper.get('.vd-pair-versions > strong').text()).toBe('11.22.0')
    expect(wrapper.get('#vd-section-added').text()).toContain('TBT')
    expect(wrapper.get('#vd-section-added').text()).toContain('2050')
    expect(wrapper.find('#vd-section-removed').exists()).toBe(false)
    expect(wrapper.get('.vd-comparison').text()).toContain('1100')
    expect(wrapper.get('.vd-comparison .tp-param-delta[aria-label="+100"]').classes()).toContain('is-good')
    expect(wrapper.get('#vd-section-added .tp-card-name').text()).toBe('TBT')
    const image = wrapper.get('#vd-section-added .tp-media > img')
    expect(image.attributes('src')).toContain('/v/11.22.0/tank_images/23681.webp')
    expect(image.attributes('style')).toContain('scale(')
    // 金币/收藏身份与百科同一套配色（车名颜色 + 卡片底色）。
    expect(wrapper.get('#vd-section-added .vd-identity').classes()).toContain('is-premium')
    expect(wrapper.get('#vd-section-added .vd-stats').text()).toContain('agentTanks.units.MILLIMETER')
    expect(wrapper.get('#vd-section-added').text()).toContain('1875')
    expect(wrapper.get('.vd-disclosure:last-child').element.open).toBe(false)
    expect(wrapper.get('.vd-data-body').text()).toContain('T32')
    expect(mocks.fetchTankDiff).toHaveBeenCalledWith(PAIR, 3889)
    expect(mocks.fetchTankDiff).not.toHaveBeenCalledWith(PAIR, 4449)
    expect(mocks.fetchMapDiff).not.toHaveBeenCalled()
    expect(wrapper.find('.vd-warning').exists()).toBe(false)
  })

  it('opens the new dataset tankopedia detail from an armor card', async () => {
    const { wrapper } = await openAt({ assets: 'https://assets.test', localuser: '1' })
    await wrapper.get('#vd-section-armor .vd-armor-action').trigger('click')
    expect(mocks.navigateToDataset).toHaveBeenCalledOnce()
    const [dataset, href] = mocks.navigateToDataset.mock.calls[0]
    expect(dataset).toBe(PAIR.to.dataset)
    const query = new URL(href, 'https://app.test').searchParams
    expect(query.get('view')).toBe('agent-tankopedia')
    expect(query.get('tank')).toBe(String(TANK_ROW.id))
    expect(query.get('assets')).toBe('https://assets.test')
    expect(query.get('localuser')).toBe('1')
  })

  it('restores the pair from from/to query keys', async () => {
    const { router } = await openAt({ from: '11.21.0_1', to: '11.22.0' })
    expect(router.currentRoute.value.query).toEqual({
      view: 'agent-version-diff', from: '11.21.0_1', to: '11.22.0',
    })
    expect(mocks.fetchPairSummary).toHaveBeenCalledWith(PAIR)
  })

  it('includes presentation-only maps in the map list and count', async () => {
    mocks.fetchPairSummary.mockImplementationOnce(async () => ({
      ...SUMMARY,
      mapsPresentationOnly: [{
        mapId: 9, key: 'himmelsdorf', display: 'Himmelsdorf', detail: 'maps/9.json',
      }],
    }))
    const { wrapper } = await openAt()
    const maps = wrapper.get('#vd-section-maps')
    expect(maps.element.open).toBe(false)
    expect(maps.text()).toContain('Himmelsdorf')
    expect(wrapper.get('.vd-synopsis').text()).toContain('versionDiff.summary.mapsChanged 2')
  })

  it('keeps research-only vehicles and item counts in the collapsed secondary section', async () => {
    const { wrapper } = await openAt()
    expect(wrapper.get('#vd-section-tanks').text()).not.toContain('IS-2 Pravda SP')
    expect(wrapper.get('.vd-data-body').text()).toContain('IS-2 Pravda SP')
    expect(wrapper.get('.vd-data-body').text()).toContain('versionDiff.log.changedFields')
    expect(wrapper.get('#vd-section-maps').element.open).toBe(false)
  })

  it('mounts the armor viewport in the chapter and shares the staged tank request', async () => {
    const { wrapper } = await openAt()
    const section = wrapper.get('#vd-section-armor')
    // 文字版改动默认收起（details 不展开），对比器视口始终内嵌可见。
    const changeList = section.find('details')
    expect(changeList.exists()).toBe(true)
    expect(changeList.element.open).toBe(false)
    expect(changeList.find('.vd-armor-list').exists()).toBe(true)
    const viewport = wrapper.getComponent(ArmorComparisonViewport)
    expect(viewport.props()).toMatchObject({ tankId: 3889, pair: PAIR, verification: 'verified' })
    await expect(viewport.props('loadDetail')()).resolves.toEqual(TANK_DETAIL)
    expect(mocks.fetchTankDiff).toHaveBeenCalledTimes(1)
  })

  it('lists the complete textual armor changes next to the inline viewer', async () => {
    const { wrapper } = await openAt()
    const section = wrapper.get('#vd-section-armor')
    expect(section.text()).toContain('versionDiff.armor.directions')
    expect(section.text()).toContain('hull.front')
    expect(section.text()).toContain('100')
    expect(section.text()).toContain('120')
    expect(mocks.fetchTankDiff).toHaveBeenCalledWith(PAIR, 3889)
  })

  it('feeds the clicked armor row into the inline viewer as isolation keys', async () => {
    const { wrapper } = await openAt()
    const section = wrapper.get('#vd-section-armor')
    const row = section.find('.vd-armor-list tbody tr')
    await row.trigger('click')
    await flushPromises()
    const viewport = wrapper.getComponent(ArmorComparisonViewport)
    expect(viewport.props('isolateKeys')).toEqual(['hull:3'])
    await row.trigger('click')
    expect(viewport.props('isolateKeys')).toEqual([])
  })

  it('opens the tank dialog with the fetched detail and config rows', async () => {
    const { wrapper } = await openAt()
    const row = wrapper.get('.vd-vehicle .vd-identity-action')
    await row.trigger('click')
    await flushPromises()
    expect(mocks.fetchTankDiff).toHaveBeenCalledWith(PAIR, 3889)
    expect(wrapper.text()).toContain('versionDiff.tank.title')
    expect(wrapper.text()).toContain('1000')
    expect(wrapper.text()).toContain('1100')
    const firepower = wrapper.findAll('.vd-tank .vd-tab')
      .find(item => item.text() === 'versionDiff.tabs.firepower')
    await firepower.trigger('click')
    expect(wrapper.text()).toContain('85 mm Škoda 29')
  })

  it('keeps config-level armor rows active and scoped to their configuration', async () => {
    const detail = {
      ...TANK_DETAIL,
      configs: {
        ...TANK_DETAIL.configs,
        configs: [{
          ...TANK_DETAIL.configs.configs[0],
          changes: [
            ...TANK_DETAIL.configs.configs[0].changes,
            { path: 'gun_plates', category: 'armor', old: { 5: 100 }, new: { 5: 120 } },
          ],
        }],
      },
    }
    mocks.fetchTankDiff.mockImplementationOnce(async () => detail)
    const { wrapper } = await openAt()
    const section = wrapper.get('#vd-section-armor')
    const row = section.findAll('.vd-armor-list tbody tr')
      .find(item => item.text().includes('85 mm Škoda 29'))
    expect(row).toBeTruthy()
    await row.trigger('click')
    await flushPromises()
    const viewport = wrapper.getComponent(ArmorComparisonViewport)
    expect(viewport.props('isolateKeys')).toEqual(['gun:5'])
    expect(viewport.props('isolateConfigKey')).toEqual('94/106')
    expect(row.classes()).toContain('is-active')
    await row.trigger('click')
    await flushPromises()
    expect(viewport.props('isolateKeys')).toEqual([])
    expect(viewport.props('isolateConfigKey')).toEqual('')
    expect(row.classes()).not.toContain('is-active')
  })

  it('hides the armor action when the tank has no armor diff', async () => {
    const { armor: _armor, ...noArmor } = TANK_DETAIL
    mocks.fetchTankDiff.mockImplementationOnce(async () => noArmor)
    const { wrapper } = await openAt()
    await wrapper.get('.vd-vehicle .vd-identity-action').trigger('click')
    await flushPromises()
    const armorTab = wrapper.findAll('.vd-tank .vd-tab')
      .find(item => item.text() === 'versionDiff.tabs.armor')
    await armorTab.trigger('click')
    expect(wrapper.get('.vd-tank').text()).toContain('versionDiff.armor.noDirections')
    expect(wrapper.find('.vd-tank .vd-inline-actions').exists()).toBe(false)
  })

  it('does not show the inert configuration picker on the armor tab', async () => {
    // 装甲 tab 的内容只来自 model 级装甲摘要：配置下拉在这是无作用控件，不应渲染。
    const detail = {
      ...TANK_DETAIL,
      configs: {
        ...TANK_DETAIL.configs,
        configs: [
          {
            key: { gun: 'Gun A', turretLocal: 1, gunLocal: 9 },
            changes: [{ path: 'reload_time', category: 'firepower', old: 5, new: 6 }],
          },
          {
            key: { gun: 'Gun B', turretLocal: 2, gunLocal: 10 },
            changes: [{ path: 'reload_time', category: 'firepower', old: 7, new: 8 }],
          },
        ],
      },
    }
    mocks.fetchTankDiff.mockImplementationOnce(async () => detail)
    const { wrapper } = await openAt()
    await wrapper.get('.vd-vehicle .vd-identity-action').trigger('click')
    await flushPromises()
    const firepower = wrapper.findAll('.vd-tank .vd-tab')
      .find(item => item.text() === 'versionDiff.tabs.firepower')
    await firepower.trigger('click')
    expect(wrapper.find('.vd-tank #vd-config').exists()).toBe(true)
    const armorTab = wrapper.findAll('.vd-tank .vd-tab')
      .find(item => item.text() === 'versionDiff.tabs.armor')
    await armorTab.trigger('click')
    expect(wrapper.find('.vd-tank #vd-config').exists()).toBe(false)
  })

  it('hides map version actions until the side identities are loaded', async () => {
    let release
    mocks.fetchMapDiff.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const { wrapper } = await openAt()
    const row = wrapper.findAll('.vd-map-row').find(item => item.text().includes('Rockfield'))
    await row.trigger('click')
    await flushPromises()
    // 详情未到时 openMapVersion 只能回退到 summary 的单侧 key，目标可能错版：先不提供入口。
    expect(wrapper.text()).not.toContain('versionDiff.map.openOld')
    release(MAP_DETAIL)
    await flushPromises()
    expect(wrapper.text()).toContain('versionDiff.map.openOld')
    expect(wrapper.text()).toContain('versionDiff.map.openNew')
  })

  it('opens the map dialog and fetches the map detail', async () => {
    const { wrapper } = await openAt()
    const row = wrapper.findAll('.vd-map-row').find(item => item.text().includes('Rockfield'))
    await row.trigger('click')
    await flushPromises()
    expect(mocks.fetchMapDiff).toHaveBeenCalledWith(PAIR, 1)
    expect(wrapper.text()).toContain('versionDiff.map.title')
    expect(wrapper.get('.vd-map').text()).toContain('versionDiff.map.instancesUnchanged')
  })
})