// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'zh' },
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    te: () => false,
  }),
}))

/** BattleMap 打桩为渲染数量探针：标注列表经 renderedAnnotations、基地经 bases 进入展示层。 */
vi.mock('./BattleMap.vue', () => ({
  default: {
    name: 'BattleMap',
    props: ['image', 'mapView', 'renderedAnnotations', 'activeTool', 'bases', 'pbOverview', 'showPlayableBoundary'],
    template: `<div class="bm-stub" :data-count="renderedAnnotations.length" :data-tool="activeTool || ''"
      :data-bases="(bases || []).map(b => b.baseId + ':' + b.radius + ':' + b.status).join('|')" />`,
  },
}))

import MapPreview2DPane from './MapPreview2DPane.vue'
import { mapImages } from '../data/mapImages.js'
import { playableBounds } from '../data/playableBounds.js'
import mountainSemantic from '../../../common/map-semantics/21_mountain_mnt.semantic.json'
import milbaseSemantic from '../../../common/map-semantics/24_milibase_mlb.semantic.json'

/**
 * 地图预览 2D 标注契约：
 * - 标注走语义坐标 + commit 撤销栈；pen/eraser 经 renderedAnnotations 渲染。
 * - 导出 = { version:1, kind:'map-preview-annotations-2d', mapKey, annotations }；
 *   导入 fail-closed：版本/kind/mapKey 任一不符即拒绝并提示，不污染当前标注。
 */
function mountPane(basemap = { kind: 'bundled', image: mapImages.erlenberg }, overrides = {}) {
  return mount(MapPreview2DPane, {
    props: { mapKey: 'erlenberg', basemap, ...overrides },
    global: { mocks: { $t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key) } },
  })
}

async function importJson(wrapper, payload) {
  const file = new File([JSON.stringify(payload)], 'annotations.json', { type: 'application/json' })
  const input = wrapper.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

beforeEach(() => {
  expect(mapImages.erlenberg).toBeTruthy()
})

describe('MapPreview2DPane 标注导入导出', () => {
  it('空标注导出给无内容提示，不产文件', async () => {
    const wrapper = mountPane()
    const createObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL }))
    await wrapper.find('[data-testid="map-2d-export"]').trigger('click')
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="map-2d-import-note"]').text()).toContain('noAnnotations')
    vi.unstubAllGlobals()
  })

  it('合法标注导入 → 渲染列表更新并给计数提示', async () => {
    const wrapper = mountPane()
    await importJson(wrapper, {
      version: 1,
      kind: 'map-preview-annotations-2d',
      mapKey: 'erlenberg',
      annotations: [
        { type: 'pen', color: '#ff0000', width: 3, points: [{ x: -10, y: 20 }, { x: 30, y: 40 }] },
      ],
    })
    expect(wrapper.find('.bm-stub').attributes('data-count')).toBe('1')
    expect(wrapper.find('[data-testid="map-2d-import-note"]').text()).toContain('"count":1')
  })

  it('几何非法（单点 pen）整份拒绝，不进历史', async () => {
    const wrapper = mountPane()
    await importJson(wrapper, {
      version: 1,
      kind: 'map-preview-annotations-2d',
      mapKey: 'erlenberg',
      annotations: [{ type: 'pen', color: '#fff', width: 3, points: [{ x: 0, y: 0 }] }],
    })
    expect(wrapper.find('.bm-stub').attributes('data-count')).toBe('0')
    expect(wrapper.find('[data-testid="map-2d-import-note"]').text()).toContain('importReasonFormat')
  })

  it('3D 导出的标注（旧 -3d kind）跨视角导入被接受——同一张地图即可', async () => {
    const wrapper = mountPane()
    await importJson(wrapper, {
      version: 1,
      kind: 'map-preview-annotations-3d',
      mapKey: 'erlenberg',
      annotations: [{ type: 'pen', color: '#fff', width: 3, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }],
    })
    expect(wrapper.find('.bm-stub').attributes('data-count')).toBe('1')
    expect(wrapper.find('[data-testid="map-2d-import-note"]').text()).toContain('"count":1')
  })

  it('kind / mapKey 不符拒绝导入（fail-closed），当前标注不变', async () => {
    const wrapper = mountPane()
    await importJson(wrapper, {
      version: 1,
      kind: 'unrelated-annotations',
      mapKey: 'erlenberg',
      annotations: [{ type: 'pen', color: '#fff', width: 3, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }],
    })
    expect(wrapper.find('.bm-stub').attributes('data-count')).toBe('0')
    expect(wrapper.find('[data-testid="map-2d-import-note"]').text()).toContain('importReasonFormat')

    await importJson(wrapper, {
      version: 1,
      kind: 'map-preview-annotations-2d',
      mapKey: 'moon',
      annotations: [{ type: 'pen', color: '#fff', width: 3, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }],
    })
    expect(wrapper.find('.bm-stub').attributes('data-count')).toBe('0')
    expect(wrapper.find('[data-testid="map-2d-import-note"]').text()).toContain('importReasonMap')
  })

  it('换底图 key 重置标注状态（basemap props watch；ground 回退未就绪时不渲染 BattleMap）', async () => {
    const wrapper = mountPane()
    await importJson(wrapper, {
      version: 1,
      kind: 'map-preview-annotations-2d',
      mapKey: 'erlenberg',
      annotations: [{ type: 'pen', color: '#fff', width: 3, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }],
    })
    expect(wrapper.find('.bm-stub').attributes('data-count')).toBe('1')
    await wrapper.setProps({ mapKey: 'moon', basemap: { kind: 'ground', mapKey: 'moon' } })
    await nextTick()
    // ground 底图需异步解析（happy-dom Image 不触发 onload）→ BattleMap 暂不渲染
    expect(wrapper.find('.bm-stub').exists()).toBe(false)
  })
})

describe('MapPreview2DPane 基地点位（与 2D 回放同一 :bases 口径）', () => {
  it('supremacy：A–C 全列、中立无水位、半径缺省 15m（世界坐标，BattleMap 换算像素）', async () => {
    const wrapper = mountPane({ kind: 'bundled', image: mapImages.erlenberg }, { basesKind: 'supremacy' })
    const stub = wrapper.find('.bm-stub')
    const entries = stub.attributes('data-bases').split('|')
    expect(entries).toEqual([
      'A:15:neutral',
      'B:15:neutral',
      'C:15:neutral',
    ])
  })

  it('assault：组内多 candidate 无证据 fail-closed（erlenberg 3 条 → 不画）', async () => {
    const wrapper = mountPane({ kind: 'bundled', image: mapImages.erlenberg }, { basesKind: 'assault' })
    expect(wrapper.find('.bm-stub').attributes('data-bases')).toBe('')
  })

  it('assault 单条 candidate → BASE 圆标 + 20m 缺省（与回放同一 presentation fallback）', async () => {
    const wrapper = mountPane({ kind: 'bundled', image: mapImages.canyon }, { mapKey: 'canyon', basesKind: 'assault' })
    // canyon.assault 恰 1 条且未声明 radius（null）→ 呈现兜底 20m
    expect(wrapper.find('.bm-stub').attributes('data-bases')).toBe('BASE:20:neutral')
  })

  it('basesKind=null → 不渲染任何点位', async () => {
    const wrapper = mountPane({ kind: 'bundled', image: mapImages.erlenberg }, { basesKind: null })
    expect(wrapper.find('.bm-stub').attributes('data-bases')).toBe('')
  })
})

describe('MapPreview2DPane canonical 出生点 / 可玩边界', () => {
  /** 语义文件的原始事实（不经被测 parser）：spawnpoint → {name, team, x, y}。 */
  function rawSpawns(semantic) {
    return semantic.sceneEvidence.battlePoints
      .filter(point => point.type === 'spawnpoint')
      .map(point => ({ name: point.name, team: point.team, x: point.position[0], y: point.position[1] }))
  }

  it.each([
    ['mountain', mountainSemantic, mapImages.mountain],
    ['milbase', milbaseSemantic, mapImages.milbase],
  ])('%s：spawn 与语义 battlePoints 逐值相等（含 name/team/x/y）', (key, semantic, image) => {
    // milbase 的语义文件名是 24_milibase_mlb（文件名片段 != mapCode），
    // 证明查找必须走 mapCodes 索引而不是文件名。
    const wrapper = mountPane({ kind: 'bundled', image }, { mapKey: key })
    const battleMap = wrapper.findComponent({ name: 'BattleMap' })
    expect(battleMap.props('pbOverview').spawnPoints).toEqual(rawSpawns(semantic))
    expect(battleMap.props('showPlayableBoundary')).toBe(true)
  })

  it('mountain：playableBounds 同时等于 generated 表与语义 playableBoundsMeters', () => {
    const wrapper = mountPane({ kind: 'bundled', image: mapImages.mountain }, { mapKey: 'mountain' })
    const overview = wrapper.findComponent({ name: 'BattleMap' }).props('pbOverview')
    expect(overview.playableBounds).toEqual(playableBounds.mountain)
    expect(overview.playableBounds).toEqual(mountainSemantic.playableBoundsMeters)
  })

  it('moon（无语义 mapCodes）：spawn 为空且 overview 不带 playableBounds（fail-closed）', () => {
    // bundled 底图让 BattleMap 立即渲染；底图身份与 fail-closed 断言无关。
    const wrapper = mountPane({ kind: 'bundled', image: mapImages.erlenberg }, { mapKey: 'moon' })
    const overview = wrapper.findComponent({ name: 'BattleMap' }).props('pbOverview')
    expect(overview.spawnPoints).toEqual([])
    expect('playableBounds' in overview).toBe(false)
  })
})
