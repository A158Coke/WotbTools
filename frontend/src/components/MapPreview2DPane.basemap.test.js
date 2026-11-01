// @vitest-environment happy-dom
// 底图解析的请求代际契约（review P2 回归锁）：快速切图 A→B 时旧请求只清理自己
// 创建的资源，绝不撤销新代已发布的 URL；解码尺寸必须与 manifest 一致（漂移
// fail-visible）。resolver 与 Image 全部受控，完成顺序由测试驱动。
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

/** resolver 受控：每个用例替换 current 实现，返回值/时序由测试驱动。 */
const resolver = vi.hoisted(() => ({ current: vi.fn() }))
vi.mock('../scene/replaySource.js', () => ({
  resolveMap2dBasemap: (...args) => resolver.current(...args),
}))

import MapPreview2DPane from './MapPreview2DPane.vue'

// ---- 受控环境：URL blob 桩 + 手动解码的 Image 桩 ----
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
/** 手动完成第 i 个解码请求（happy-dom 的 Image 不触发 onload，这里由测试驱动）。 */
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
    resolver.current.mockImplementationOnce(() => gateA)                       // A 先发，挂起
    const wrapper = mountPane({ kind: 'map2d', mapKey: 'moon' })
    await flushPromises()
    // 切图 B：新代请求发出并立即返回（A 仍在挂起）
    resolver.current.mockImplementationOnce(async () => MANIFEST)
    await wrapper.setProps({ basemap: { kind: 'map2d', mapKey: 'moon' } })
    await flushPromises()
    expect(imageRequests).toHaveLength(1)   // B 的解码请求（A 仍在挂起）
    decodeAt(0)                              // B 解码完成 → B 发布
    await flushPromises()
    expect(wrapper.find('.bm-stub').attributes('data-src')).toBe('blob:mock-1')
    // A 迟到返回：代际已过期 → 在创建任何资源之前直接退出（不碰 B 的 blob:mock-1）
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
    expect(imageRequests).toHaveLength(1)    // 解码挂起中（blob:mock-1 已创建）
    wrapper.unmount()                        // 卸载使在途请求过期
    decodeAt(0)                              // 迟到解码完成
    await flushPromises()
    expect(revoked).toEqual(['blob:mock-1']) // 自己创建、自己释放；无泄漏
  })

  it('旧 A 迟到解码尺寸不符 + 新 B 已正常发布 → B 的 src 与错误状态都不受影响（交叉时序）', async () => {
    stubEnv()
    resolver.current.mockImplementationOnce(async () => MANIFEST)   // A：正常返回，解码挂起
    const wrapper = mountPane({ kind: 'map2d', mapKey: 'moon' })
    await flushPromises()
    // 切图 B：resolver 返回并解码发布（A 的解码仍挂起）
    resolver.current.mockImplementationOnce(async () => MANIFEST)
    await wrapper.setProps({ basemap: { kind: 'map2d', mapKey: 'moon' } })
    await flushPromises()
    decodeAt(1)                              // B 解码发布（imageRequests[1] = B）
    await flushPromises()
    expect(wrapper.find('.bm-stub').attributes('data-src')).toBe('blob:mock-2')
    // A 迟到解码且尺寸不符（900² ≠ manifest 1254²）：代际过期 → 只清自己的 URL，
    // 不得把 basemapError 置到已发布的 B 上（否则错误提示与有效底图并存）
    decodeAt(0, 900, 900)
    await flushPromises()
    expect(revoked).toEqual(['blob:mock-1'])
    expect(wrapper.find('.bm-stub').attributes('data-src')).toBe('blob:mock-2')
    expect(wrapper.find('[data-testid="map-2d-basemap-error"]').exists()).toBe(false)
  })

  it('解码尺寸与 manifest 不一致 → fail-visible，不静默按解码尺寸渲染', async () => {
    stubEnv()
    resolver.current.mockImplementationOnce(async () => MANIFEST)   // manifest 声明 1254²
    const wrapper = mountPane({ kind: 'map2d', mapKey: 'moon' })
    await flushPromises()
    decodeAt(0, 900, 900)                    // 解码 900² ≠ 1254²（发布漂移）
    await flushPromises()
    expect(wrapper.find('[data-testid="map-2d-basemap-error"]').exists()).toBe(true)
    expect(wrapper.find('.bm-stub').exists()).toBe(false)
    expect(revoked).toEqual(['blob:mock-1']) // 未发布的资源也释放
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
})
