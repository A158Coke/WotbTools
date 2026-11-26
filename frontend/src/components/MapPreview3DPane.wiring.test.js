// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: { value: 'zh' }, t: (k) => k, te: () => false }),
}))

const scene = vi.hoisted(() => {
  const api = {
    setPaused: vi.fn(),
    setFlySpeed: vi.fn(),
    setAnnotations: vi.fn(),
    setAnnotationInteraction: vi.fn(),
    setAnnotationsVisible: vi.fn(),
    loadMapOnly: vi.fn(async () => {
      const s = scene.stores.at(-1)
      if (s) {
        s.mapReady = false
        await Promise.resolve()
        s.mapReady = true
      }
    }),
    loadData: vi.fn(async () => {}),
    destroy: vi.fn(),
    setQuality: vi.fn(),
    setCam: vi.fn(),
    setMapBasesKind: vi.fn(),
    setMapSpawns: vi.fn(),
    setMobileTouch: vi.fn(),
    refreshSpawnColors: vi.fn(),
    reset: vi.fn(),
    invalidate: vi.fn(),
  }
  const scene = { api, initPlayback: vi.fn((stage, store) => { scene.stores.push(store); return api }), stores: [] }
  return scene
})
vi.mock('../scene/playbackScene.js', () => ({
  initPlayback: scene.initPlayback,
  QUALITY_PRESETS: { low: { label: 'l' }, mid: { label: 'm' } },
}))

function restoreLoadMapOnlyMock() {
  scene.api.loadMapOnly.mockImplementation(async () => {
    const store = scene.stores.at(-1)
    if (!store) return
    store.mapReady = false
    await Promise.resolve()
    store.mapReady = true
  })
}

vi.mock('../app/featureCapabilities.js', () => ({
  Feature: { PLAYBACK_3D: 'playback3d', PLAYBACK_2D: 'playback2d' },
}))
vi.mock('../composables/useFeatureGate.js', () => {
  const available = ref(true)
  return {
    useFeatureGate: () => ({
      availability: () => ({ available: available.value, pending: false }),
      requireFeature: () => true,
    }),
    __available: available,
  }
})
vi.mock('../scene/webglSupport.js', () => ({
  detectWebGL: () => ({ supported: true, status: 'webgl2' }),
}))
vi.mock('../composables/useSceneFlyControls.ts', () => ({
  useSceneFlyControls: () => ({ stopLoop: vi.fn(), flySpeedIndex: () => 1 }),
}))
vi.mock('../composables/usePlaybackFullscreen.ts', () => ({
  usePlaybackFullscreen: () => ({ isFullscreen: ref(false), fullscreenSupported: false, toggleFullscreen: vi.fn() }),
}))
vi.mock('../composables/usePlaybackPhoneForm.ts', () => ({
  usePlaybackPhoneForm: () => ({ isPhone: ref(false) }),
}))
vi.mock('../composables/usePlaybackPortraitViewport.ts', () => ({
  usePlaybackPortraitViewport: () => ({ isPortrait: ref(false) }),
}))
vi.mock('../composables/usePlaybackTransport.ts', () => ({
  isInteractiveTarget: () => false,
}))
vi.mock('./Scene3DStatus.vue', () => ({ default: { template: '<div class="s3d-stub" />' } }))
vi.mock('./AnnotationToolbar.vue', () => ({ default: { template: '<div class="at-stub" />' } }))
vi.mock('./SegmentedControl.vue', () => ({
  default: {
    props: ['modelValue', 'options'],
    emits: ['update:model-value'],
    template: '<button class="seg-fire" @click="$emit(\'update:model-value\', \'qfire\')" />',
  },
}))

import MapPreview3DPane from './MapPreview3DPane.vue'
import { uiProfile } from '../composables/useUiProfile.js'

let wrappers = []
function mountPane(active, extraProps = {}) {
  const wrapper = mount(MapPreview3DPane, {
    props: { mapId: 6, mapName: '矿井阵地', mapKey: 'rudniki', active, ...extraProps },
    attachTo: document.body,
    global: { mocks: { $t: (k) => k } },
  })
  wrappers.push(wrapper)
  return wrapper
}

async function mountReady(extraProps = {}) {
  const wrapper = mountPane(true, extraProps)
  await flushPromises()
  return wrapper
}

function annotationBridge() {
  return scene.initPlayback.mock.calls.at(-1)[3]
}

afterEach(() => {
  for (const w of wrappers.splice(0)) {
    try { w.unmount() } catch {}
  }
})

beforeEach(() => {
  scene.stores.splice(0)
  scene.initPlayback.mockClear()
  for (const k of Object.keys(scene.api)) if (vi.isMockFunction(scene.api[k])) scene.api[k].mockClear()
  restoreLoadMapOnlyMock()
})

describe('MapPreview3DPane 场景接线（行为）', () => {
  it('装载只走 loadMapOnly 会话，绝不触碰 loadData 回放路径', async () => {
    await mountReady()
    expect(scene.api.loadMapOnly).toHaveBeenCalledTimes(1)
    expect(scene.api.loadMapOnly).toHaveBeenCalledWith({ mapId: 6, mapName: '矿井阵地' })
    expect(scene.api.loadData).not.toHaveBeenCalled()
  })

  it('画质与相机走 SegmentedControl（DC-SEL-08）：换画质拆场景重装，换相机只发 setCam', async () => {
    const wrapper = await mountReady()
    const segs = wrapper.findAll('.seg-fire')
    expect(segs.length).toBeGreaterThanOrEqual(2)
    expect(wrapper.find('select').exists()).toBe(false)
    await segs[0].trigger('click')
    await flushPromises()
    expect(scene.api.setQuality).toHaveBeenCalledWith('qfire')
    expect(scene.api.destroy).toHaveBeenCalledTimes(1)
    expect(scene.initPlayback).toHaveBeenCalledTimes(2)
    expect(scene.api.loadMapOnly).toHaveBeenCalledTimes(2)
    scene.api.setCam.mockClear()
    await segs[1].trigger('click')
    await flushPromises()
    expect(scene.api.setCam).toHaveBeenCalledWith('qfire')
    expect(scene.api.destroy).toHaveBeenCalledTimes(1)
    expect(scene.api.loadMapOnly).toHaveBeenCalledTimes(2)
  })

  it('换图判定只看 mapId：locale 化 mapName 变化不清标注（回归锁）', async () => {
    const wrapper = await mountReady()
    annotationBridge().onAnnotationCommit({ type: 'pen', color: '#ff4d4f', width: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })
    await flushPromises()
    scene.api.setAnnotations.mockClear()
    scene.api.loadMapOnly.mockClear()
    await wrapper.setProps({ mapName: 'Malinovka' })
    await flushPromises()
    expect(scene.api.loadMapOnly).not.toHaveBeenCalled()
    expect(scene.api.setAnnotations).not.toHaveBeenCalled()
    await wrapper.setProps({ mapId: 17, mapName: 'Yukon' })
    await flushPromises()
    expect(scene.api.setAnnotations).toHaveBeenCalledWith([])
    expect(scene.api.loadMapOnly).toHaveBeenCalledWith({ mapId: 17, mapName: 'Yukon' })
  })

  it('切图时先清标注再 reload，即使 mapReady 在 reload 内同步回调也不推旧标注', async () => {
    const wrapper = await mountReady()
    annotationBridge().onAnnotationCommit({ type: 'pen', color: '#ff4d4f', width: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })
    await flushPromises()

    const calls = []
    scene.api.setAnnotations.mockImplementation((annotations) => calls.push(['annotations', annotations]))
    scene.api.loadMapOnly.mockImplementation(({ mapId }) => {
      calls.push(['reload', mapId])
      const store = scene.stores.at(-1)
      store.mapReady = false
      store.mapReady = true
    })

    await wrapper.setProps({ mapId: 17, mapName: 'Yukon' })
    await flushPromises()
    restoreLoadMapOnlyMock()

    expect(calls[0]).toEqual(['annotations', []])
    expect(calls[1]).toEqual(['reload', 17])
    expect(calls.every(([kind, annotations]) => kind !== 'annotations' || annotations.length === 0)).toBe(true)
  })

  it('destroyScene（GPU teardown/离线销毁）不触碰标注会话；重连后 pane 撤销栈补推回内核', async () => {
    const { __available } = await import('../composables/useFeatureGate.js')
    const wrapper = await mountReady()
    annotationBridge().onAnnotationCommit({ type: 'pen', color: '#ff4d4f', width: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })
    await flushPromises()
    scene.api.setAnnotations.mockClear()
    __available.value = false
    await flushPromises()
    expect(scene.api.destroy).toHaveBeenCalledTimes(1)
    expect(scene.initPlayback).toHaveBeenCalledTimes(1)
    expect(scene.api.setAnnotations).not.toHaveBeenCalled()
    __available.value = true
    await flushPromises()
    expect(scene.initPlayback).toHaveBeenCalledTimes(2)
    expect(scene.api.setAnnotations).toHaveBeenCalledWith([
      { type: 'pen', color: '#ff4d4f', width: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    ])
  })

  it('基地点位：唯一推送方向 pane→scene（setMapBasesKind），三触发点齐全', async () => {
    const wrapper = await mountReady({ basesKind: 'supremacy' })
    expect(scene.api.setMapBasesKind).toHaveBeenCalledWith('supremacy')
    scene.api.setMapBasesKind.mockClear()
    await wrapper.setProps({ basesKind: 'assault' })
    await flushPromises()
    expect(scene.api.setMapBasesKind).toHaveBeenCalledWith('assault')
    scene.api.setMapBasesKind.mockClear()
    await wrapper.setProps({ mapId: 17 })
    await flushPromises()
    expect(scene.api.setMapBasesKind).toHaveBeenCalledWith('assault')
  })

  it('出生点：唯一推送方向 pane→scene（setMapSpawns），三触发点齐全（#835）', async () => {
    const points = [{ x: 10, y: -20, name: 'spawn1' }]
    const wrapper = await mountReady({ spawnPoints: points })
    expect(scene.api.setMapSpawns).toHaveBeenCalledWith(points)
    scene.api.setMapSpawns.mockClear()
    const next = [{ x: 1, y: 2 }, { x: 3, y: 4 }]
    await wrapper.setProps({ spawnPoints: next })
    await flushPromises()
    expect(scene.api.setMapSpawns).toHaveBeenCalledWith(next)
    scene.api.setMapSpawns.mockClear()
    await wrapper.setProps({ mapId: 17 })
    await flushPromises()
    expect(scene.api.setMapSpawns).toHaveBeenCalledWith(next)
  })

  it('UI Profile 切换：pane watch uiProfile → 内核 refreshSpawnColors 原地重着色（#877 review P3）', async () => {
    const wrapper = await mountReady()
    const original = uiProfile.value
    try {
      scene.api.refreshSpawnColors.mockClear()
      scene.api.loadMapOnly.mockClear()
      scene.api.destroy.mockClear()
      uiProfile.value = original === 'winter' ? 'summer' : 'winter'
      await flushPromises()
      expect(scene.api.refreshSpawnColors).toHaveBeenCalledTimes(1)
      expect(scene.api.loadMapOnly).not.toHaveBeenCalled()
      expect(scene.api.destroy).not.toHaveBeenCalled()
      expect(scene.initPlayback).toHaveBeenCalledTimes(1)
    } finally {
      uiProfile.value = original
      wrapper.unmount()
    }
  })
})

describe('内核 map 会话（sessionLifecycle.loadMapOnly 行为）', () => {
  it('map 会话：stub DATA 就绪落 mapReady（hasData 保持回放专用），提前收口在 buildVehicles 之前', async () => {
    const { createSessionLifecycle } = await import('../scene/playback/sessionLifecycle.js')
    const store = {
      hasData: false, mapReady: false, err: '', loading: false, assetStage: false,
      assetProgress: null, playbackSession: null, mapName: '', startTime: 0, duration: 0,
    }
    const deps = {
      store,
      destroyed: () => false,
      perf: () => null,
      teardownSession: vi.fn(),
      publishSessionData: vi.fn(),
      publishMapOnlyData: vi.fn(),
      ensureRenderer: vi.fn(),
      battleRange: () => [0, 600],
      publishSceneClock: vi.fn(),
      clearCanonicalClock: vi.fn(),
      prepareSessionCamera: vi.fn(),
      setMapKey: vi.fn(),
      getGlbOn: () => false,
      buildWorld: vi.fn(),
      setCam: vi.fn(),
      clampCameraTarget: vi.fn(),
      constrainFreeCameraAltitude: vi.fn(),
      loadMapImage: vi.fn(async () => {}),
      buildBases: vi.fn(),
      buildSpawns: vi.fn(),
      buildVehicles: vi.fn(),
      setupContactShadows: vi.fn(),
      applyGlbToggle: vi.fn(async () => {}),
      buildRoster: vi.fn(),
      prepareResolvers: vi.fn(),
      prewarmShaders: vi.fn(),
      setPlaying: vi.fn(),
      tick: vi.fn(),
      writeHud: vi.fn(),
      invalidate: vi.fn(),
      loadRecorderCamera: vi.fn(),
      transients: { rebuildSources: vi.fn(), rewindBursts: vi.fn() },
      setClockRange: vi.fn(),
      setTime: vi.fn(),
      debug: false,
      exposeVehicles: vi.fn(),
      data: () => ({ meta: { map_id: 6, map_name: '矿井阵地' }, vehicles: [], shots: [], periods: [] }),
      topViewOnLoad: () => false,
      cam: () => 'free',
      forceGlb: () => false,
      resetSessionCursors: vi.fn(),
    }
    const session = createSessionLifecycle(deps)
    await session.loadMapOnly({ mapId: 6, mapName: '矿井阵地' })
    expect(session.sessionMode()).toBe('map')
    expect(store.mapReady).toBe(true)
    expect(store.hasData).toBe(false)
    expect(store.loading).toBe(false)
    expect(store.err).toBe('')
    expect(deps.publishMapOnlyData).toHaveBeenCalledWith(6, '矿井阵地')
    expect(deps.buildSpawns).toHaveBeenCalledTimes(1)
    expect(deps.buildBases).toHaveBeenCalledTimes(1)
    expect(deps.buildVehicles).not.toHaveBeenCalled()
    expect(deps.buildRoster).not.toHaveBeenCalled()
    expect(deps.setPlaying).not.toHaveBeenCalled()
    expect(deps.tick).not.toHaveBeenCalled()
    expect(deps.writeHud).not.toHaveBeenCalled()
    deps.buildSpawns.mockClear()
    await session.loadMapOnly({ mapId: 17, mapName: 'Yukon' })
    expect(deps.teardownSession).toHaveBeenCalledTimes(2)
    expect(deps.buildSpawns).toHaveBeenCalledTimes(1)
    expect(store.mapReady).toBe(true)
  })
})

describe('触屏手势接线（source regression，无运行时 seam 保留）', () => {
  it('触屏 pan/look/pinch 全部在内核 capture 链（与回放同一实现）', async () => {
    const fs = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const path = await import('node:path')
    const cameraSrc = fs.readFileSync(path.join(process.cwd(), 'src/scene/playback/cameraRuntime.ts'), 'utf8')
    expect(cameraSrc).toContain("container.addEventListener('pointerdown', onFlyCaptureDown, true)")
    expect(cameraSrc).toContain("container.addEventListener('pointermove', onFlyCaptureMove, true)")
    expect(cameraSrc).toContain("container.addEventListener('pointerup', onFlyCaptureUp, true)")
    expect(cameraSrc).toContain("container.addEventListener('pointercancel', onFlyCaptureCancel, true)")
  })
})
