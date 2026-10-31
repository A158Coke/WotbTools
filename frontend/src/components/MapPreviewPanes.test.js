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

/** BattleMap 打桩为渲染数量探针：标注列表经 renderedAnnotations 进入展示层。 */
vi.mock('./BattleMap.vue', () => ({
  default: {
    name: 'BattleMap',
    props: ['image', 'mapView', 'renderedAnnotations', 'activeTool'],
    template: '<div class="bm-stub" :data-count="renderedAnnotations.length" :data-tool="activeTool || \'\'" />',
  },
}))

import MapPreview2DPane from './MapPreview2DPane.vue'
import { mapImages } from '../data/mapImages.js'

/**
 * 地图预览 2D 标注契约：
 * - 标注走语义坐标 + commit 撤销栈；pen/eraser 经 renderedAnnotations 渲染。
 * - 导出 = { version:1, kind:'map-preview-annotations-2d', mapKey, annotations }；
 *   导入 fail-closed：版本/kind/mapKey 任一不符即拒绝并提示，不污染当前标注。
 */
function mountPane() {
  return mount(MapPreview2DPane, {
    props: { mapKey: 'erlenberg' },
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

  it('kind / mapKey 不符拒绝导入（fail-closed），当前标注不变', async () => {
    const wrapper = mountPane()
    await importJson(wrapper, {
      version: 1,
      kind: 'map-preview-annotations-3d',
      mapKey: 'erlenberg',
      annotations: [{ type: 'pen', color: '#fff', width: 3, points: [{ x: 0, y: 0 }] }],
    })
    expect(wrapper.find('.bm-stub').attributes('data-count')).toBe('0')
    expect(wrapper.find('[data-testid="map-2d-import-note"]').text()).toContain('importReasonFormat')

    await importJson(wrapper, {
      version: 1,
      kind: 'map-preview-annotations-2d',
      mapKey: 'moon',
      annotations: [{ type: 'pen', color: '#fff', width: 3, points: [{ x: 0, y: 0 }] }],
    })
    expect(wrapper.find('.bm-stub').attributes('data-count')).toBe('0')
    expect(wrapper.find('[data-testid="map-2d-import-note"]').text()).toContain('importReasonMap')
  })

  it('换地图 key 重置标注状态（props watch）', async () => {
    const wrapper = mountPane()
    await importJson(wrapper, {
      version: 1,
      kind: 'map-preview-annotations-2d',
      mapKey: 'erlenberg',
      annotations: [{ type: 'pen', color: '#fff', width: 3, points: [{ x: 0, y: 0 }] }],
    })
    expect(wrapper.find('.bm-stub').attributes('data-count')).toBe('1')
    await wrapper.setProps({ mapKey: 'moon' })
    await nextTick()
    // moon 无 2D 底图 → BattleMap 不渲染（页面层本会强制 3D；面板自身 fail-closed）
    expect(wrapper.find('.bm-stub').exists()).toBe(false)
  })
})
