// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: { value: 'zh' }, t: (k) => k, te: () => false }),
}))

/** 内核替身：记录 initPlayback / loadMapOnly / destroy 的调用次数与顺序。 */
const scene = vi.hoisted(() => {
  const api = {
    setPaused: vi.fn(),
    setFlySpeed: vi.fn(),
    setAnnotations: vi.fn(),
    setAnnotationInteraction: vi.fn(),
    setAnnotationsVisible: vi.fn(),
    loadMapOnly: vi.fn(async () => {}),
    destroy: vi.fn(),
    setQuality: vi.fn(),
    setCam: vi.fn(),
    setMapSpawns: vi.fn(),
    setMobileTouch: vi.fn(),
    reset: vi.fn(),
    invalidate: vi.fn(),
  }
  return { api, initPlayback: vi.fn(() => api) }
})
vi.mock('../scene/playbackScene.js', () => ({
  initPlayback: scene.initPlayback,
  QUALITY_PRESETS: { low: { label: 'l' }, mid: { label: 'm' } },
}))

vi.mock('../app/featureCapabilities.js', () => ({
  Feature: { PLAYBACK_3D: 'playback3d', PLAYBACK_2D: 'playback2d' },
}))
vi.mock('../composables/useFeatureGate.js', () => ({
  useFeatureGate: () => ({
    availability: () => ({ available: true, pending: false }),
    requireFeature: () => true,
  }),
}))
vi.mock('../scene/webglSupport.js', () => ({
  detectWebGL: () => ({ supported: true, status: 'webgl2' }),
}))
vi.mock('../composables/useSceneFlyControls.ts', () => ({
  useSceneFlyControls: () => ({ stopLoop: vi.fn(), flySpeedIndex: () => 1 }),
}))
vi.mock('../composables/usePlaybackFullscreen.ts', () => ({
  usePlaybackFullscreen: () => ({ isFullscreen: ref(false), fullscreenSupported: false, toggleFullscreen: vi.fn() }),
}))
vi.mock('../composables/usePlaybackPhoneForm.ts', () => {
  const isPhone = ref(false)
  return { usePlaybackPhoneForm: () => ({ isPhone }), __phoneForm: { isPhone } }
})
vi.mock('../composables/usePlaybackTransport.ts', () => ({
  isInteractiveTarget: () => false,
}))
vi.mock('./Scene3DStatus.vue', () => ({ default: { template: '<div class="s3d-stub" />' } }))
vi.mock('./AnnotationToolbar.vue', () => ({ default: { template: '<div class="at-stub" />' } }))

import MapPreview3DPane from './MapPreview3DPane.vue'
import { afterEach } from 'vitest'

let wrappers = []
function mountPane(active, extraProps = {}) {
  // attachTo：ensureScene 的 isConnected 护栏要求 stage 真实挂载（防游离 append），
  // 与生产语义一致；afterEach unmount 清理。
  const wrapper = mount(MapPreview3DPane, {
    props: { mapId: 6, mapName: '矿井阵地', mapKey: 'rudniki', active, ...extraProps },
    attachTo: document.body,
    global: { mocks: { $t: (k) => k } },
  })
  wrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  for (const w of wrappers.splice(0)) {
    try { w.unmount() } catch {}
  }
})

beforeEach(() => {
  scene.initPlayback.mockClear()
  scene.api.loadMapOnly.mockClear()
  scene.api.destroy.mockClear()
})

describe('MapPreview3DPane 首次激活生命周期', () => {
  it('active=false 挂载：不建场景、不装资产', async () => {
    mountPane(false)
    await flushPromises()
    expect(scene.initPlayback).not.toHaveBeenCalled()
    expect(scene.api.loadMapOnly).not.toHaveBeenCalled()
  })

  it('首次激活（false→true）：创建 + 装载当前图', async () => {
    const wrapper = mountPane(false)
    await flushPromises()
    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(scene.initPlayback).toHaveBeenCalledTimes(1)
    expect(scene.api.loadMapOnly).toHaveBeenCalledTimes(1)
    expect(scene.api.loadMapOnly).toHaveBeenCalledWith({ mapId: 6, mapName: '矿井阵地' })
    expect(scene.api.setPaused).toHaveBeenCalledWith(false)
  })

  it('出生点：装载后按 pane prop 推送内核；点列变化补推（#835）', async () => {
    const points = [{ x: 10, y: -20, name: 'spawn1' }]
    const wrapper = mountPane(true, { spawnPoints: points })
    await flushPromises()
    expect(scene.api.setMapSpawns).toHaveBeenCalledWith(points)
    scene.api.setMapSpawns.mockClear()
    // 换图：页面重算点列（新数组）→ prop 变化即补推（内核 teardown 复位由 mapReady watcher 兜底）
    const next = [{ x: 1, y: 2 }, { x: 3, y: 4 }]
    await wrapper.setProps({ spawnPoints: next })
    await flushPromises()
    expect(scene.api.setMapSpawns).toHaveBeenCalledWith(next)
  })

  it('移动端触屏相机契约：建场景即按 isPhone 推送；形态翻转即时同步', async () => {
    const { __phoneForm } = await import('../composables/usePlaybackPhoneForm.ts')
    const wrapper = mountPane(true)
    await flushPromises()
    expect(scene.api.setMobileTouch).toHaveBeenCalledWith(false)
    scene.api.setMobileTouch.mockClear()
    __phoneForm.isPhone.value = true
    await flushPromises()
    expect(scene.api.setMobileTouch).toHaveBeenCalledWith(true)
    __phoneForm.isPhone.value = false
    await flushPromises()
    expect(scene.api.setMobileTouch).toHaveBeenLastCalledWith(false)
    wrapper.unmount()
  })

  it('激活后切走：场景保留暂停，不销毁、不重装；切回不重建不重装', async () => {
    const wrapper = mountPane(true)
    await flushPromises()
    expect(scene.initPlayback).toHaveBeenCalledTimes(1)
    expect(scene.api.loadMapOnly).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ active: false })
    await flushPromises()
    expect(scene.api.destroy).not.toHaveBeenCalled()
    expect(scene.initPlayback).toHaveBeenCalledTimes(1)
    expect(scene.api.loadMapOnly).toHaveBeenCalledTimes(1)
    expect(scene.api.setPaused).toHaveBeenLastCalledWith(true)
    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(scene.initPlayback).toHaveBeenCalledTimes(1)
    expect(scene.api.loadMapOnly).toHaveBeenCalledTimes(1)
    expect(scene.api.setPaused).toHaveBeenLastCalledWith(false)
  })

  it('exports annotations without session-local surfaceY and imports them stripped', async () => {
    const wrapper = mountPane(true)
    await flushPromises()
    const options = scene.initPlayback.mock.calls.at(-1)[3]
    const bridge = {
      type: 'pen', color: '#ff4d4f', width: 3,
      points: [{ x: 0, y: 0, surfaceY: 8 }, { x: 1, y: 1, surfaceY: 8 }],
    }
    options.onAnnotationCommit(bridge)
    await flushPromises()

    const blobs = []
    const createObjectURL = vi.fn((blob) => { blobs.push(blob); return 'blob:surface-export' })
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await wrapper.get('[data-testid="map-3d-export"]').trigger('click')
    expect(blobs).toHaveLength(1)
    const payload = JSON.parse(await blobs[0].text())
    expect(payload.annotations[0].points).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }])
    click.mockRestore()
    vi.unstubAllGlobals()

    scene.api.setAnnotations.mockClear()
    const file = new File([JSON.stringify({
      version: 1,
      kind: 'map-preview-annotations',
      mapKey: 'rudniki',
      annotations: [bridge],
    })], 'annotations.json', { type: 'application/json' })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()
    expect(scene.api.setAnnotations).toHaveBeenLastCalledWith([
      { ...bridge, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    ])
  })

  it('未激活时换图：只清标注状态，不抢建场景；首次激活装载的是新图', async () => {
    const wrapper = mountPane(false)
    await flushPromises()
    await wrapper.setProps({ mapId: 17, mapName: 'Yukon' })
    await flushPromises()
    expect(scene.initPlayback).not.toHaveBeenCalled()
    expect(scene.api.loadMapOnly).not.toHaveBeenCalled()
    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(scene.api.loadMapOnly).toHaveBeenCalledWith({ mapId: 17, mapName: 'Yukon' })
  })
})
