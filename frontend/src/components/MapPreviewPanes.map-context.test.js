// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountPane } from '../test/MapPreviewPanesTestHelpers.js'
import { mapImages } from '../data/mapImages.js'

// 多 candidate 的 fail-closed 夹具：真实 mapBases 经变体过滤后每图恰 1 条 assault，
// 规则本身仍需可测（合成 probe_multi，不依赖生产数据恰好含歧义样本）。
vi.mock('../data/mapBases.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    mapBases: {
      ...actual.mapBases,
      probe_multi: {
        supremacy: [],
        assault: [
          { x: 0, y: 0, radius: null, team: 1 },
          { x: 10, y: 0, radius: null, team: 1 },
          { x: 20, y: 0, radius: null, team: 1 },
        ],
      },
    },
  }
})

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
    props: ['image', 'mapView', 'renderedAnnotations', 'activeTool', 'bases', 'pbOverview', 'showPlayableBoundary', 'textSession', 'textInputStyle'],
    emits: ['update-text', 'commit-text', 'cancel-text'],
    data: () => ({ mapEl: null }),
    mounted() { this.mapEl = this.$refs.mapEl },
    expose: ['mapEl'],
    template: `<div ref="mapEl" class="bm-stub" :data-count="renderedAnnotations.length" :data-tool="activeTool || ''"
      :data-bases="(bases || []).map(b => b.baseId + ':' + b.radius + ':' + b.status).join('|')"><input v-if="textSession" class="pb-text-input" data-test="pb-text-input-stub" /></div>`,
  },
}))

import { playableBounds } from '../data/playableBounds.js'
import mountainSemantic from '../../../common/map-semantics/21_mountain_mnt.semantic.json'
import milbaseSemantic from '../../../common/map-semantics/24_milibase_mlb.semantic.json'
import neptuneSemantic from '../../../common/map-semantics/33_neptune_nt.semantic.json'

beforeEach(() => {
  expect(mapImages.erlenberg).toBeTruthy()
})

describe('MapPreview2DPane fullscreen', () => {
  it('offers native fullscreen and follows the browser fullscreen element (not a manual boolean)', async () => {
    let current = null
    const reqDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'requestFullscreen')
    const exitDesc = Object.getOwnPropertyDescriptor(document, 'exitFullscreen')
    const fsDesc = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => current })
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: vi.fn(() => {
        current = null
        document.dispatchEvent(new Event('fullscreenchange'))
        return Promise.resolve()
      }),
    })
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: function requestFullscreen() {
        current = this
        document.dispatchEvent(new Event('fullscreenchange'))
        return Promise.resolve()
      },
    })
    try {
      const wrapper = mountPane()
      await flushPromises()
      const button = wrapper.find('[data-testid="map-2d-fullscreen"]')
      expect(button.exists()).toBe(true)
      await button.trigger('click')
      await flushPromises()
      expect(current?.dataset.testid).toBe('map-2d-pane')
      expect(wrapper.find('[data-testid="map-2d-fullscreen"]').attributes('aria-label')).toContain('exit_fullscreen')
      await wrapper.find('[data-testid="map-2d-fullscreen"]').trigger('click')
      await flushPromises()
      expect(current).toBeNull()
      expect(wrapper.find('[data-testid="map-2d-fullscreen"]').attributes('aria-label')).toContain('enter_fullscreen')
      wrapper.unmount()
    } finally {
      if (reqDesc) Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', reqDesc)
      else delete HTMLElement.prototype.requestFullscreen
      if (exitDesc) Object.defineProperty(document, 'exitFullscreen', exitDesc)
      else delete document.exitFullscreen
      if (fsDesc) Object.defineProperty(document, 'fullscreenElement', fsDesc)
      else delete document.fullscreenElement
    }
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

  it('assault：组内多 candidate 无证据 fail-closed（合成 probe_multi 3 条 → 不画）', async () => {
    const wrapper = mountPane(
      { kind: 'bundled', image: mapImages.erlenberg },
      { mapKey: 'probe_multi', basesKind: 'assault' },
    )
    expect(wrapper.find('.bm-stub').attributes('data-bases')).toBe('')
  })

  it('assault 单条 candidate → BASE 圆标 + 20m 缺省（与回放同一 presentation fallback）', async () => {
    // erlenberg 的基础变体（er0）恰 1 条遭遇 candidate、未声明 radius → 20m 兜底
    const wrapper = mountPane({ kind: 'bundled', image: mapImages.erlenberg }, { basesKind: 'assault' })
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

  it('变体与语义 battleVariant 不符：基础 nt0 档案不得画到 nt1（spawn/边界都隐藏）', () => {
    const base = mountPane({ kind: 'bundled', image: mapImages.neptune }, { mapKey: 'neptune', variant: 'nt0' })
    const baseOverview = base.findComponent({ name: 'BattleMap' }).props('pbOverview')
    expect(baseOverview.spawnPoints).toEqual(rawSpawns(neptuneSemantic))
    expect(baseOverview.playableBounds).toBeTruthy()
    // 页面契约：额外条目（非首个 index 条目）下发 variantIsBase=false
    const hills = mountPane({ kind: 'bundled', image: mapImages.neptune }, { mapKey: 'neptune', variant: 'nt1', variantIsBase: false })
    const hillsOverview = hills.findComponent({ name: 'BattleMap' }).props('pbOverview')
    expect(hillsOverview.spawnPoints).toEqual([])
    expect('playableBounds' in hillsOverview).toBe(false)
  })

  it('moon（无语义 mapCodes）：spawn 为空且 overview 不带 playableBounds（fail-closed）', () => {
    // bundled 底图让 BattleMap 立即渲染；底图身份与 fail-closed 断言无关。
    const wrapper = mountPane({ kind: 'bundled', image: mapImages.erlenberg }, { mapKey: 'moon' })
    const overview = wrapper.findComponent({ name: 'BattleMap' }).props('pbOverview')
    expect(overview.spawnPoints).toEqual([])
    expect('playableBounds' in overview).toBe(false)
  })
})
