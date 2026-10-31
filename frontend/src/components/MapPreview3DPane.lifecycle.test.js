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
vi.mock('../composables/useSceneFlyControls.js', () => ({
  useSceneFlyControls: () => ({ stopLoop: vi.fn(), flySpeedIndex: () => 1 }),
}))
vi.mock('../composables/usePlaybackFullscreen.js', () => ({
  usePlaybackFullscreen: () => ({ isFullscreen: ref(false), fullscreenSupported: false, toggleFullscreen: vi.fn() }),
}))
vi.mock('../composables/usePlaybackPhoneForm.js', () => ({
  usePlaybackPhoneForm: () => ({ isPhone: { value: false } }),
}))
vi.mock('../composables/usePlaybackTransport.js', () => ({
  isInteractiveTarget: () => false,
}))
vi.mock('./Scene3DStatus.vue', () => ({ default: { template: '<div class="s3d-stub" />' } }))
vi.mock('./AnnotationToolbar.vue', () => ({ default: { template: '<div class="at-stub" />' } }))

import MapPreview3DPane from './MapPreview3DPane.vue'
import { afterEach } from 'vitest'

let wrappers = []
function mountPane(active) {
  // attachTo：ensureScene 的 isConnected 护栏要求 stage 真实挂载（防游离 append），
  // 与生产语义一致；afterEach unmount 清理。
  const wrapper = mount(MapPreview3DPane, {
    props: { mapId: 6, mapName: '矿井阵地', mapKey: 'rudniki', active },
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
