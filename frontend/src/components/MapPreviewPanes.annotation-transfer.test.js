// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountPane, importJson } from '../test/MapPreviewPanesTestHelpers.js'
import { mapImages } from '../data/mapImages.js'
import { nextTick } from 'vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'zh' },
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    te: () => false,
  }),
}))

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
    expect(wrapper.find('.bm-stub').exists()).toBe(false)
  })
})
