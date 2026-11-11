// @vitest-environment happy-dom
// MapPreview3DPane 接线行为测试（#827：source regression → mount + spy，与
// MapPreview3DPane.lifecycle.test.js 同款 harness）：
// 地图预览 3D 面板必须走 loadMapOnly 会话，绝不触碰回放数据路径 loadData。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: { value: 'zh' }, t: (k) => k, te: () => false }),
}))

/** 内核替身：initPlayback / loadMapOnly / destroy 与会话命令面的 spy。 */
const scene = vi.hoisted(() => {
  const api = {
    setPaused: vi.fn(),
    setFlySpeed: vi.fn(),
    setAnnotations: vi.fn(),
    setAnnotationInteraction: vi.fn(),
    setAnnotationsVisible: vi.fn(),
    // loadMapOnly 替身模拟真实会话时序：先撤就绪态（teardown），资产段后再落 mapReady
    loadMapOnly: vi.fn(async () => {
      const s = scene.stores.at(-1)
      if (s) {
        s.mapReady = false
        await Promise.resolve()
        s.mapReady = true
      }
    }),
    // 回放数据路径（面板绝不允许触碰）：单独 spy 以便行为断言
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

vi.mock('../app/featureCapabilities.js', () => ({
  Feature: { PLAYBACK_3D: 'playback3d', PLAYBACK_2D: 'playback2d' },
}))
vi.mock('../composables/useFeatureGate.js', () => {
  // ref 承载可用性：computed(online) 只追踪 reactive 源——翻转必须经它
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
// SegmentedControl 替身：点击即以固定值 emit（quality/camera 两个实例共用）
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
  // attachTo：ensureScene 的 isConnected 护栏要求 stage 真实挂载（与生产语义一致）
  const wrapper = mount(MapPreview3DPane, {
    props: { mapId: 6, mapName: '矿井阵地', mapKey: 'rudniki', active, ...extraProps },
    attachTo: document.body,
    global: { mocks: { $t: (k) => k } },
  })
  wrappers.push(wrapper)
  return wrapper
}

/** 已激活且装图完成的面板（接线断言的前置态）。 */
async function mountReady(extraProps = {}) {
  const wrapper = mountPane(true, extraProps)
  await flushPromises()
  return wrapper
}

/** 从最近一次 initPlayback 调用取标注桥（pane ↔ 内核回调）。 */
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
    expect(segs.length).toBeGreaterThanOrEqual(2)   // quality + camera，无双 <select>
    expect(wrapper.find('select').exists()).toBe(false)
    // 画质：destroyScene → ensureScene → setQuality → reloadMap（地图会话不整页 reload）
    await segs[0].trigger('click')
    await flushPromises()
    expect(scene.api.setQuality).toHaveBeenCalledWith('qfire')
    expect(scene.api.destroy).toHaveBeenCalledTimes(1)
    expect(scene.initPlayback).toHaveBeenCalledTimes(2)
    expect(scene.api.loadMapOnly).toHaveBeenCalledTimes(2)
    // 相机：setCam，不动会话
    scene.api.setCam.mockClear()
    await segs[1].trigger('click')
    await flushPromises()
    expect(scene.api.setCam).toHaveBeenCalledWith('qfire')
    expect(scene.api.destroy).toHaveBeenCalledTimes(1)
    expect(scene.api.loadMapOnly).toHaveBeenCalledTimes(2)
  })

  it('换图判定只看 mapId：locale 化 mapName 变化不清标注（回归锁）', async () => {
    const wrapper = await mountReady()
    // 先画一笔（内核 → pane 撤销栈）
    annotationBridge().onAnnotationCommit({ type: 'pen', color: '#ff4d4f', width: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })
    await flushPromises()
    scene.api.setAnnotations.mockClear()
    scene.api.loadMapOnly.mockClear()
    // 切语言 → mapName 变化：标注保留、不重装
    await wrapper.setProps({ mapName: 'Malinovka' })
    await flushPromises()
    expect(scene.api.loadMapOnly).not.toHaveBeenCalled()
    expect(scene.api.setAnnotations).not.toHaveBeenCalled()
    // mapId 变化 = 换图：标注重置 + 重装新图
    await wrapper.setProps({ mapId: 17, mapName: 'Yukon' })
    await flushPromises()
    expect(scene.api.setAnnotations).toHaveBeenCalledWith([])
    expect(scene.api.loadMapOnly).toHaveBeenCalledWith({ mapId: 17, mapName: 'Yukon' })
  })

  it('destroyScene（GPU teardown/离线销毁）不触碰标注会话；重连后 pane 撤销栈补推回内核', async () => {
    const { __available } = await import('../composables/useFeatureGate.js')
    const wrapper = await mountReady()
    annotationBridge().onAnnotationCommit({ type: 'pen', color: '#ff4d4f', width: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })
    await flushPromises()
    // 断网 → reconcile destroyScene：销毁场景但不清标注
    scene.api.setAnnotations.mockClear()
    __available.value = false
    await flushPromises()
    expect(scene.api.destroy).toHaveBeenCalledTimes(1)
    expect(scene.initPlayback).toHaveBeenCalledTimes(1)
    expect(scene.api.setAnnotations).not.toHaveBeenCalled()   // 未被 resetAnnotationState 清空
    // 重连 → 场景重建，pane 撤销栈是权威：整体补推回内核
    __available.value = true
    await flushPromises()
    expect(scene.initPlayback).toHaveBeenCalledTimes(2)
    expect(scene.api.setAnnotations).toHaveBeenCalledWith([
      { type: 'pen', color: '#ff4d4f', width: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    ])
  })

  it('基地点位：唯一推送方向 pane→scene（setMapBasesKind），三触发点齐全', async () => {
    const wrapper = await mountReady({ basesKind: 'supremacy' })
    // 触发点 1：场景创建（先于装载记意图）
    expect(scene.api.setMapBasesKind).toHaveBeenCalledWith('supremacy')
    scene.api.setMapBasesKind.mockClear()
    // 触发点 2：kind 变化
    await wrapper.setProps({ basesKind: 'assault' })
    await flushPromises()
    expect(scene.api.setMapBasesKind).toHaveBeenCalledWith('assault')
    scene.api.setMapBasesKind.mockClear()
    // 触发点 3：会话就绪（mapReady 翻转后补推；teardown 会复位内核意图）
    await wrapper.setProps({ mapId: 17 })
    await flushPromises()
    expect(scene.api.setMapBasesKind).toHaveBeenCalledWith('assault')
  })

  it('出生点：唯一推送方向 pane→scene（setMapSpawns），三触发点齐全（#835）', async () => {
    const points = [{ x: 10, y: -20, name: 'spawn1' }]
    const wrapper = await mountReady({ spawnPoints: points })
    // 触发点 1：场景创建
    expect(scene.api.setMapSpawns).toHaveBeenCalledWith(points)
    scene.api.setMapSpawns.mockClear()
    // 触发点 2：点列变化
    const next = [{ x: 1, y: 2 }, { x: 3, y: 4 }]
    await wrapper.setProps({ spawnPoints: next })
    await flushPromises()
    expect(scene.api.setMapSpawns).toHaveBeenCalledWith(next)
    scene.api.setMapSpawns.mockClear()
    // 触发点 3：会话就绪（换图 → mapReady 翻转后补推）
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
      // 不 reload / 不 remount：只重着色已有标记
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
  // vi.mock 提升到文件级：组件 mock 不消费 loadPlaybackData，kernel 测试共享同款替身
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
    // 会话模式 + 就绪门控：mapReady 落 true，hasData 保持回放专用
    expect(session.sessionMode()).toBe('map')
    expect(store.mapReady).toBe(true)
    expect(store.hasData).toBe(false)
    expect(store.loading).toBe(false)
    expect(store.err).toBe('')
    // map 会话只建地图面资产：stub 数据发布 + 基地/出生点；回放尾部全部不执行
    expect(deps.publishMapOnlyData).toHaveBeenCalledWith(6, '矿井阵地')
    expect(deps.buildSpawns).toHaveBeenCalledTimes(1)
    expect(deps.buildBases).toHaveBeenCalledTimes(1)
    expect(deps.buildVehicles).not.toHaveBeenCalled()
    expect(deps.buildRoster).not.toHaveBeenCalled()
    expect(deps.setPlaying).not.toHaveBeenCalled()
    expect(deps.tick).not.toHaveBeenCalled()
    expect(deps.writeHud).not.toHaveBeenCalled()
    // teardown：换图/会话切换先拆旧场（出生点贴地标记随会话释放由宿主 teardown 承担）
    deps.buildSpawns.mockClear()
    await session.loadMapOnly({ mapId: 17, mapName: 'Yukon' })
    expect(deps.teardownSession).toHaveBeenCalledTimes(2)   // 每次 loadMapOnly 入口先拆旧场
    expect(deps.buildSpawns).toHaveBeenCalledTimes(1)   // 新会话重建出生点（清空后重画）
    expect(store.mapReady).toBe(true)
  })
})

// 无接缝保留的 source-text 子句（#827 处置说明）：触屏手势注册的**效果**（pan/look/pinch
// 手势分流）闭合在 cameraRuntime 的 fly 状态机里，无可观测 seam；注册本身（capture 链、
// 与回放同一实现）仍以源码守卫锁定。真机可用性验收归用户。
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
