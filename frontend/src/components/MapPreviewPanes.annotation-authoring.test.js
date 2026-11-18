// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountPane, importJson } from '../test/MapPreviewPanesTestHelpers.js'
import { mapImages } from '../data/mapImages.js'

const pngMock = vi.hoisted(() => ({ downloadBlob: vi.fn(async () => {}) }))
const h2cMock = vi.hoisted(() => vi.fn(async () => ({
  toBlob: (callback) => callback(new Blob(['png'], { type: 'image/png' })),
})))

vi.mock('../utils/exportReplayPng.js', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadBlob: pngMock.downloadBlob,
}))
vi.mock('html2canvas', () => ({ default: h2cMock }))

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


beforeEach(() => {
  expect(mapImages.erlenberg).toBeTruthy()
  pngMock.downloadBlob.mockClear()
  h2cMock.mockClear()
})

describe('MapPreview2DPane 完整 tactical annotation', () => {
  async function openToolbar(wrapper) {
    await wrapper.find('[data-testid="map-2d-drawing-entry"]').trigger('click')
    await flushPromises()
  }
  function battleMap(wrapper) {
    return wrapper.findComponent({ name: 'BattleMap' })
  }
  function rendered(wrapper) {
    return battleMap(wrapper).props('renderedAnnotations')
  }
  async function pointer(wrapper, type, x, y, pointerId = 1) {
    await wrapper.find('[data-testid="map-2d-stage"]').trigger(type, { pointerId, clientX: x, clientY: y, pointerType: 'mouse', button: 0 })
  }
  async function draw(wrapper, points, pointerId = 1) {
    await pointer(wrapper, 'pointerdown', points[0][0], points[0][1], pointerId)
    for (const [x, y] of points.slice(1)) await pointer(wrapper, 'pointermove', x, y, pointerId)
    await pointer(wrapper, 'pointerup', points.at(-1)[0], points.at(-1)[1], pointerId)
    await flushPromises()
  }

  it('renders the full Playback 2D toolset instead of pen/eraser only', async () => {
    const wrapper = mountPane()
    await openToolbar(wrapper)
    for (const tool of ['select', 'route', 'LT', 'MT', 'HT', 'TD', 'pen', 'eraser', 'arrow', 'line', 'rect', 'circle', 'text']) {
      expect(wrapper.find(`[data-test="pb-annot-${tool}"]`).exists(), tool).toBe(true)
    }
  })

  it('creates a planned unit from LT and keeps it semantic/neutral', async () => {
    const wrapper = mountPane()
    await openToolbar(wrapper)
    await wrapper.find('[data-test="pb-annot-LT"]').trigger('click')
    await pointer(wrapper, 'pointerdown', 100, 100)
    await pointer(wrapper, 'pointerup', 100, 100)
    await flushPromises()
    const unit = rendered(wrapper).at(-1)
    expect(unit).toMatchObject({ type: 'unit', tankClass: 'LT', label: '' })
    expect(Number.isFinite(unit.x)).toBe(true)
    expect(Number.isFinite(unit.y)).toBe(true)
    expect(unit.radius).toBeGreaterThan(0)
    expect(unit.friendly).toBeUndefined()
    expect(wrapper.find('[data-test="pb-annot-LT"]').classes()).toContain('active')
    expect(wrapper.find('[data-test="pb-annot-selection"]').exists()).toBe(false)
  })

  it('creates arrow/line/rect/circle from semantic pointer coordinates', async () => {
    const wrapper = mountPane()
    await openToolbar(wrapper)
    for (const tool of ['arrow', 'line', 'rect', 'circle']) {
      await wrapper.find(`[data-test="pb-annot-${tool}"]`).trigger('click')
      await draw(wrapper, [[80, 80], [180, 160]])
      const annotation = rendered(wrapper).at(-1)
      expect(annotation.type, tool).toBe(tool)
      expect(annotation.width).toBeGreaterThan(0)
      if (tool === 'rect') {
        expect(annotation.w).toBeGreaterThan(0)
        expect(annotation.h).toBeGreaterThan(0)
      }
      if (tool === 'circle') expect(annotation.r).toBeGreaterThan(0)
    }
  })

  it('does not commit rectangles with any zero side', async () => {
    const wrapper = mountPane()
    await openToolbar(wrapper)
    await wrapper.find('[data-test="pb-annot-rect"]').trigger('click')
    await draw(wrapper, [[100, 100], [100, 200]])
    await draw(wrapper, [[100, 100], [200, 100]])
    expect(rendered(wrapper)).toHaveLength(0)
    await draw(wrapper, [[100, 100], [200, 200]])
    expect(rendered(wrapper)).toHaveLength(1)
  })

  it('creates a route only after two points and Finish Route', async () => {
    const wrapper = mountPane()
    await openToolbar(wrapper)
    await wrapper.find('[data-test="pb-annot-route"]').trigger('click')
    await pointer(wrapper, 'pointerdown', 100, 100)
    await pointer(wrapper, 'pointerup', 100, 100)
    // 单点 route 仍只是未提交 draft；Finish 前不得进入 history/可见路径。
    expect(rendered(wrapper).filter(a => a.type === 'route' && a.points.length >= 2)).toHaveLength(0)
    await pointer(wrapper, 'pointerdown', 200, 160)
    await pointer(wrapper, 'pointerup', 200, 160)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-annot-route-finish"]').exists()).toBe(true)
    await wrapper.find('[data-test="pb-annot-route-finish"]').trigger('click')
    await flushPromises()
    const route = rendered(wrapper).at(-1)
    expect(route).toMatchObject({ type: 'route' })
    expect(route.points).toHaveLength(2)
    expect(wrapper.find('[data-test="pb-annot-route"]').classes()).toContain('active')
    expect(wrapper.find('[data-test="pb-annot-selection"]').exists()).toBe(false)
  })

  it('creates text through the shared BattleMap text session', async () => {
    const wrapper = mountPane()
    await openToolbar(wrapper)
    await wrapper.find('[data-test="pb-annot-text"]').trigger('click')
    await pointer(wrapper, 'pointerdown', 100, 100)
    await pointer(wrapper, 'pointerup', 100, 100)
    await flushPromises()
    const session = battleMap(wrapper).props('textSession')
    expect(session).toBeTruthy()
    battleMap(wrapper).vm.$emit('update-text', 'B point')
    battleMap(wrapper).vm.$emit('commit-text', session)
    await flushPromises()
    expect(rendered(wrapper).at(-1)).toMatchObject({ type: 'text', text: 'B point' })
  })

  it('keeps drawing tools active and does not repaint the previous annotation on color change', async () => {
    const wrapper = mountPane()
    await openToolbar(wrapper)
    await wrapper.find('[data-test="pb-annot-line"]').trigger('click')
    await draw(wrapper, [[80, 80], [180, 160]])
    expect(rendered(wrapper)).toHaveLength(1)
    expect(wrapper.find('[data-test="pb-annot-selection"]').exists()).toBe(false)
    const originalColor = rendered(wrapper)[0].color
    await wrapper.findAll('.pb-annot-color')[1].trigger('click')
    expect(rendered(wrapper)[0].color).toBe(originalColor)
    expect(wrapper.find('[data-test="pb-annot-line"]').classes()).toContain('active')
  })

  it('ignores pointerdown on the shared text input and refuses an empty text rename', async () => {
    const wrapper = mountPane()
    await openToolbar(wrapper)
    await wrapper.find('[data-test="pb-annot-text"]').trigger('click')
    await pointer(wrapper, 'pointerdown', 100, 100)
    await pointer(wrapper, 'pointerup', 100, 100)
    await flushPromises()
    const session = battleMap(wrapper).props('textSession')
    await wrapper.find('[data-test="pb-text-input-stub"]').trigger('pointerdown', { pointerId: 2, clientX: 100, clientY: 100, pointerType: 'mouse', button: 0 })
    expect(battleMap(wrapper).props('textSession')).toBe(session)
    battleMap(wrapper).vm.$emit('update-text', 'A point')
    battleMap(wrapper).vm.$emit('commit-text', session)
    await flushPromises()
    await wrapper.find('[data-test="pb-annot-select"]').trigger('click')
    await pointer(wrapper, 'pointerdown', 100, 100)
    await pointer(wrapper, 'pointerup', 100, 100)
    await flushPromises()
    const input = wrapper.find('[data-test="pb-annot-name"]')
    expect(input.exists()).toBe(true)
    await input.setValue('   ')
    await input.trigger('change')
    await flushPromises()
    expect(rendered(wrapper).at(-1).text).toBe('A point')
  })

  it('selects and moves an existing annotation, then supports undo/redo/delete', async () => {
    const wrapper = mountPane()
    await openToolbar(wrapper)
    await wrapper.find('[data-test="pb-annot-line"]').trigger('click')
    await draw(wrapper, [[80, 80], [180, 160]])
    const before = rendered(wrapper).at(-1)
    await wrapper.find('[data-test="pb-annot-select"]').trigger('click')
    await pointer(wrapper, 'pointerdown', 130, 120)
    await pointer(wrapper, 'pointermove', 150, 140)
    await pointer(wrapper, 'pointerup', 150, 140)
    await flushPromises()
    expect(rendered(wrapper).at(-1).x1).not.toBe(before.x1)
    await wrapper.find('[data-test="pb-annot-delete"]').trigger('click')
    await flushPromises()
    expect(rendered(wrapper)).toHaveLength(0)
    await wrapper.find('[data-test="pb-annot-undo"]').trigger('click')
    await flushPromises()
    expect(rendered(wrapper)).toHaveLength(1)
    await wrapper.find('[data-test="pb-annot-redo"]').trigger('click')
    await flushPromises()
    expect(rendered(wrapper)).toHaveLength(0)
  })

  it('exports the full schema as map-preview-annotations JSON', async () => {
    const wrapper = mountPane()
    const mixed = [
      { type: 'pen', color: '#fff', width: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { type: 'route', color: '#fff', width: 3, points: [{ x: 0, y: 0 }, { x: 2, y: 2 }] },
      { type: 'unit', color: '#fff', x: 1, y: 1, tankClass: 'HT', radius: 4, label: '' },
      { type: 'text', color: '#fff', x: 0, y: 0, text: 'A' },
    ]
    await importJson(wrapper, { version: 1, kind: 'map-preview-annotations-3d', mapKey: 'erlenberg', annotations: mixed })
    const blobs = []
    const createObjectURL = vi.fn((blob) => { blobs.push(blob); return 'blob:export' })
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await wrapper.find('[data-testid="map-2d-export"]').trigger('click')
    expect(blobs).toHaveLength(1)
    const payload = JSON.parse(await blobs[0].text())
    expect(payload).toMatchObject({ version: 1, kind: 'map-preview-annotations', mapKey: 'erlenberg' })
    expect(payload.annotations).toEqual(mixed)
    expect(typeof payload.exportedAt).toBe('string')
    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it('round-trips UI-created annotations through export JSON and the import validator', async () => {
    const wrapper = mountPane()
    await openToolbar(wrapper)
    await wrapper.find('[data-test="pb-annot-rect"]').trigger('click')
    await draw(wrapper, [[80, 80], [180, 160]])
    await wrapper.find('[data-test="pb-annot-line"]').trigger('click')
    await draw(wrapper, [[60, 60], [160, 120]])
    await wrapper.find('[data-test="pb-annot-text"]').trigger('click')
    await pointer(wrapper, 'pointerdown', 120, 120)
    await pointer(wrapper, 'pointerup', 120, 120)
    await flushPromises()
    const session = battleMap(wrapper).props('textSession')
    battleMap(wrapper).vm.$emit('update-text', 'A point')
    battleMap(wrapper).vm.$emit('commit-text', session)
    await flushPromises()
    await wrapper.find('[data-test="pb-annot-close"]').trigger('click')
    await flushPromises()
    const blobs = []
    const createObjectURL = vi.fn((blob) => { blobs.push(blob); return 'blob:ui-roundtrip' })
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await wrapper.find('[data-testid="map-2d-export"]').trigger('click')
    const payload = JSON.parse(await blobs[0].text())
    expect(payload.annotations.map(annotation => annotation.type)).toEqual(['rect', 'line', 'text'])
    await importJson(wrapper, payload)
    expect(rendered(wrapper).map(annotation => annotation.type)).toEqual(['rect', 'line', 'text'])
    expect(wrapper.find('[data-testid="map-2d-import-note"]').text()).toContain('"count":3')
    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it('renames the selected unit/route label through the shared toolbar input', async () => {
    const wrapper = mountPane()
    await openToolbar(wrapper)
    await wrapper.find('[data-test="pb-annot-LT"]').trigger('click')
    await pointer(wrapper, 'pointerdown', 100, 100)
    await pointer(wrapper, 'pointerup', 100, 100)
    await flushPromises()
    await wrapper.find('[data-test="pb-annot-select"]').trigger('click')
    await pointer(wrapper, 'pointerdown', 100, 100)
    await pointer(wrapper, 'pointerup', 100, 100)
    await flushPromises()
    const input = wrapper.find('[data-test="pb-annot-name"]')
    expect(input.exists()).toBe(true)
    await input.setValue('North push')
    await input.trigger('change')
    await flushPromises()
    expect(rendered(wrapper).at(-1).label).toBe('North push')
  })

  it('round-trips a mixed full-schema payload and rejects malformed entries fail-closed', async () => {
    const wrapper = mountPane()
    const mixed = [
      { type: 'pen', color: '#fff', width: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { type: 'route', color: '#fff', width: 3, points: [{ x: 0, y: 0 }, { x: 2, y: 2 }], label: 'route' },
      { type: 'unit', color: '#fff', x: 1, y: 1, tankClass: 'HT', radius: 4, label: '' },
      { type: 'arrow', color: '#fff', width: 3, x1: 0, y1: 0, x2: 3, y2: 3 },
      { type: 'line', color: '#fff', width: 3, x1: 0, y1: 0, x2: 3, y2: 3 },
      { type: 'rect', color: '#fff', width: 3, x: 0, y: 0, w: 4, h: 5 },
      { type: 'circle', color: '#fff', width: 3, cx: 0, cy: 0, r: 4 },
      { type: 'text', color: '#fff', x: 0, y: 0, text: 'A' },
    ]
    await importJson(wrapper, { version: 1, kind: 'map-preview-annotations', mapKey: 'erlenberg', annotations: mixed })
    expect(rendered(wrapper).map(a => a.type)).toEqual(mixed.map(a => a.type))
    for (const invalid of [
      { type: 'unit', color: '#fff', x: 0, y: 0, tankClass: 'XX', radius: 4 },
      { type: 'route', color: '#fff', width: 3, points: [{ x: 0, y: 0 }] },
      { type: 'rect', color: '#fff', width: 3, x: 0, y: 0, w: 0, h: 1 },
      { type: 'circle', color: '#fff', width: 3, cx: 0, cy: 0, r: -1 },
      { type: 'text', color: '#fff', x: 0, y: 0, text: '  ' },
      { type: 'unknown', color: '#fff', x: 0, y: 0 },
    ]) {
      await importJson(wrapper, { version: 1, kind: 'map-preview-annotations', mapKey: 'erlenberg', annotations: [invalid] })
      expect(wrapper.find('[data-testid="map-2d-import-note"]').text()).toContain('importReasonFormat')
    }
  })
})

describe('MapPreview2DPane PNG export', () => {
  it('captures the BattleMap viewport (not the pane root) and downloads the current view PNG', async () => {
    const wrapper = mountPane()
    const battleMap = wrapper.findComponent({ name: 'BattleMap' })
    Object.defineProperty(battleMap.element, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 640, bottom: 480, width: 640, height: 480 }),
    })
    await wrapper.find('[data-testid="map-2d-export-image"]').trigger('click')
    await flushPromises()
    expect(h2cMock).toHaveBeenCalledTimes(1)
    const [target, options] = h2cMock.mock.calls[0]
    expect(target.classList.contains('bm-stub')).toBe(true)
    expect(target.classList.contains('map2d')).toBe(false)
    expect(options.useCORS).toBe(true)
    expect(options.width).toBe(640)
    expect(options.height).toBe(480)
    expect(pngMock.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/^wotb-map-erlenberg-\d{8}-\d{6}\.png$/))
  })

  it('fails visible and re-enables the button when PNG capture rejects', async () => {
    const wrapper = mountPane()
    const battleMap = wrapper.findComponent({ name: 'BattleMap' })
    Object.defineProperty(battleMap.element, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 640, bottom: 480, width: 640, height: 480 }),
    })
    h2cMock.mockRejectedValueOnce(new Error('capture failed'))
    await wrapper.find('[data-testid="map-2d-export-image"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="map-2d-export-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="map-2d-export-image"]').attributes('disabled')).toBeUndefined()
  })
})
