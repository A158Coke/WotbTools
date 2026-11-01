// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'

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
  pngMock.downloadBlob.mockClear()
  h2cMock.mockClear()
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
        expect(annotation.w).toBeGreaterThanOrEqual(0)
        expect(annotation.h).toBeGreaterThanOrEqual(0)
      }
      if (tool === 'circle') expect(annotation.r).toBeGreaterThan(0)
    }
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