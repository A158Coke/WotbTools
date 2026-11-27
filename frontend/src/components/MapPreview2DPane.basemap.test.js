// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

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
    props: ['image', 'mapView', 'bases'],
    template: '<div class="bm-stub" :data-src="(image || {}).src || \'\'" />',
  },
}))

const resolver = vi.hoisted(() => ({ current: vi.fn() }))
vi.mock('../scene/replaySource.js', () => ({
  resolveMap2dBasemap: (...args) => resolver.current(...args),
}))

import MapPreview2DPane from './MapPreview2DPane.vue'

let blobSeq = 0
const revoked = []
const imageRequests = []
function stubEnv() {
  blobSeq = 0
  revoked.length = 0
  imageRequests.length = 0
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:mock-${++blobSeq}`),
    revokeObjectURL: vi.fn((u) => revoked.push(u)),
  }))
  vi.stubGlobal('Image', class {
    constructor() { imageRequests.push(this) }
    set src(v) { this._src = v }
    get src() { return this._src }
  })
}
function decodeAt(i, width = 1254, height = 1254, fail = false) {
  const img = imageRequests[i]
  if (fail) img.onerror(new Error('decode'))
  else { img.naturalWidth = width; img.naturalHeight = height; img.onload() }
}

const WORLD = { xMin: -300, xMax: 300, yMin: -300, yMax: 300 }
const MANIFEST = { url: 'https://assets.test/map2d/moon.webp', bytes: new Uint8Array([1, 2, 3]), sha256: 'aa', width: 1254, height: 1254, worldBounds: WORLD, orientation: 'YX' }

function mountPane(basemap) {
  return mount(MapPreview2DPane, {
    props: { mapKey: 'moon', basemap },
    global: { mocks: { $t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key) } },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resolver.current.mockReset()
})

describe('MapPreview2DPane 底图解析代际（review P2 回归锁）', () => {
  it('A→B 反序完成：A 迟到只清理自己的 URL，已发布 B 的 URL 不被撤销', async () => {
    stubEnv()
    let releaseA
    const gateA = new Promise((resolve) => { releaseA = resolve })
    resolver.current.mockImplementationOnce(() => gateA)
    const wrapper = mountPane({ kind: 'map2d', mapKey: 'moon' })
    await flushPromises()
    resolver.current.mockImplementationOnce(async () => MANIFEST)
    await wrapper.setProps({ basemap: { kind: 'map2d', mapKey: 'moon' } })
    await flushPromises()
    expect(imageRequests).toHaveLength(1)
    decodeAt(0)
    await flushPromises()
    expect(wrapper.find('.bm-stub').attributes('data-src')).toBe('blob:mock-1')
    releaseA(MANIFEST)
    await flushPromises()
    expect(revoked).toEqual([])
    expect(wrapper.find('.bm-stub').attributes('data-src')).toBe('blob:mock-1')
    expect(wrapper.find('[data-testid="map-2d-basemap-error"]').exists()).toBe(false)
  })

  it('解码中卸载：迟到解码只 revoke 自己创建的 URL，不再有无人释放的资源', async () => {
    stubEnv()
    resolver.current.mockImplementationOnce(async () => MANIFEST)
    const wrapper = mountPane({ kind: 'map2d', mapKey: 'moon' })
    await flushPromises()
    expect(imageRequests).toHaveLength(1)
    wrapper.unmount()
    decodeAt(0)
    await flushPromises()
    expect(revoked).toEqual(['blob:mock-1'])
  })

  it('旧 A 迟到解码尺寸不符 + 新 B 已正常发布 → B 的 src 与错误状态都不受影响（交叉时序）', async () => {
    stubEnv()
    resolver.current.mockImplementationOnce(async () => MANIFEST)
    const wrapper = mountPane({ kind: 'map2d', mapKey: 'moon' })
    await flushPromises()
    resolver.current.mockImplementationOnce(async () => MANIFEST)
    await wrapper.setProps({ basemap: { kind: 'map2d', mapKey: 'moon' } })
    await flushPromises()
    decodeAt(1)
    await flushPromises()
    expect(wrapper.find('.bm-stub').attributes('data-src')).toBe('blob:mock-2')
    decodeAt(0, 900, 900)
    await flushPromises()
    expect(revoked).toEqual(['blob:mock-1'])
    expect(wrapper.find('.bm-stub').attributes('data-src')).toBe('blob:mock-2')
    expect(wrapper.find('[data-testid="map-2d-basemap-error"]').exists()).toBe(false)
  })

  it('解码尺寸与 manifest 不一致 → fail-visible，不静默按解码尺寸渲染', async () => {
    stubEnv()
    resolver.current.mockImplementationOnce(async () => MANIFEST)
    const wrapper = mountPane({ kind: 'map2d', mapKey: 'moon' })
    await flushPromises()
    decodeAt(0, 900, 900)
    await flushPromises()
    expect(wrapper.find('[data-testid="map-2d-basemap-error"]').exists()).toBe(true)
    expect(wrapper.find('.bm-stub').exists()).toBe(false)
    expect(revoked).toEqual(['blob:mock-1'])
  })

  it('解码失败：revoke 自己的 URL 并 fail-visible', async () => {
    stubEnv()
    resolver.current.mockImplementationOnce(async () => MANIFEST)
    const wrapper = mountPane({ kind: 'map2d', mapKey: 'moon' })
    await flushPromises()
    decodeAt(0, 0, 0, true)
    await flushPromises()
    expect(wrapper.find('[data-testid="map-2d-basemap-error"]').exists()).toBe(true)
    expect(revoked).toEqual(['blob:mock-1'])
  })

  it('dataset map2d 失败且带 bundled 兜底 → 直接使用 bundled，不进入 error', async () => {
    stubEnv()
    resolver.current.mockImplementationOnce(async () => ({ error: 'offline' }))
    const fallbackImage = { src: '/assets/maps/moon.webp', width: 100, height: 100, coordinateBounds: WORLD }
    const wrapper = mountPane({ kind: 'map2d', mapKey: 'moon', fallbackImage })
    await flushPromises()
    expect(wrapper.find('.bm-stub').attributes('data-src')).toBe('/assets/maps/moon.webp')
    expect(wrapper.find('[data-testid="map-2d-basemap-error"]').exists()).toBe(false)
  })
})
