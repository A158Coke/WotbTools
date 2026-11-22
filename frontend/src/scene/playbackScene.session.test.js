// @vitest-environment happy-dom
// 拆分自 playbackScene.test.js（每个 suite 自带完整 setup：mock/生命周期/场景装配助手）。
/**
 * `playbackScene` 的会话状态所有权契约。
 *
 * PR #465 review 的两条合并阻塞竞态，都必须在**场景层**修（组件层镜像状态会制造第二 owner）：
 *
 * 1. 被销毁/被取代的实例不得再写共享 store。注意 `loadGeneration` 是 `initPlayback` 实例内
 *    闭包：跨实例（destroy A → init B，同一个 store）时 A 的计数器不变，只看它就等于
 *    「被销毁的实例仍把自己评为最新代」。归属判定必须同时覆盖 `destroyed` 与加载令牌。
 * 2. `startPlayback()` 的资产阶段有多个 await，被取代后不得继续走完
 *    buildVehicles / buildRoster / setPlaying / tick / writeHud 并把自己标成 ready。
 *
 * 这里驱动**真实** `initPlayback` + `loadData`（只 mock 数据源与资产面），
 * 锁定的是生产代数逻辑，而不是测试自己手写的状态机。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchEffect } from 'vue'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { assetProvider } from './assetProvider.ts'
import { foliageClip } from './sceneryMaterials.ts'
import { createPlaybackStore } from './playbackStore.js'
import { fixtureFacets, requireFixtures } from '../replay-local/__golden__/agentWasmNode.js'
import { buildCanonicalReplayFacts, entityFirstSeenByAccount } from '../replay-local/canonical/facts.js'
import { toBattlePlaybackDataset } from '../replay-local/playback/toBattlePlaybackDataset.js'
import { validateAgentAiReview, validateAgentBattleResult, validateAgentPlayback } from '../api/agent-replay-facets.js'
import { FLOAT_DMG_MS, GHOST_MS } from '../utils/battlePlayback.js'
import { mapImages } from '../data/mapImages.js'
import { deferred, installSceneTestSetup, minimalData, mountContainer } from './playbackScene.test.setup.js'
import { normalizePenPoints } from './playback/annotation3d.js'

const source = vi.hoisted(() => ({ loadPlaybackData: vi.fn(), loadRecorderCameraFromFile: vi.fn(), resolveMapKey: vi.fn(), mapStaticUrl: vi.fn(), tankNamesStatic: vi.fn(async () => new Map()) }))
vi.mock('./replaySource.js', () => ({
  loadPlaybackData: source.loadPlaybackData,
  loadRecorderCameraFromFile: source.loadRecorderCameraFromFile,
  resolveMapKey: source.resolveMapKey,
  tankNamesStatic: source.tankNamesStatic,
  mapStaticUrl: source.mapStaticUrl,
}))

/**
 * probe_map / probe_multi 只为本文件的基地环用例存在（真实 mapBases 不含测试键）。
 * probe_multi.assault = 2 条 candidate：静态会话 fail-closed 判据（几何不唯一不画）的输入。
 */
vi.mock('../data/mapBases.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    mapBases: {
      ...actual.mapBases,
      probe_map: {
        supremacy: [
          { baseId: 'A', x: -10, y: 20, radius: 15 },
          { baseId: 'B', x: 0, y: 0, radius: 15 },
          { baseId: 'C', x: 10, y: -20, radius: 15 },
        ],
        assault: [{ x: 5, y: 5, radius: null, team: 1 }],
      },
      probe_multi: {
        supremacy: [{ baseId: 'A', x: 0, y: 0, radius: 15 }],
        assault: [{ x: 0, y: 0, radius: null, team: 1 }, { x: 9, y: 9, radius: null, team: 2 }],
      },
    },
  }
})

/**
 * 渲染器 stub：happy-dom 没有 WebGL，`initScene()` 里的 `new THREE.WebGLRenderer()` 必然抛错，
 * 于是 `startPlayback()` 在**第一个写入之前**就失败——资产阶段竞态根本无法在测试里触发。
 * 只替换 WebGLRenderer，其余 three 保持真实实现（OrbitControls / Scene / 贴图 loader 照旧）。
 */
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal()
  class StubWebGLRenderer {
    constructor(params = {}) {
      this.params = params   // 上下文级参数（logdepth / stencil）的装配证据
      this.domElement = document.createElement('canvas')
      this.toneMapping = 0
      this.toneMappingExposure = 1
      this.shadowMap = { enabled: false }
      this.capabilities = { getMaxAnisotropy: () => 8 }
      this.info = { autoReset: true, reset() {}, render: { calls: 0 } }
    }
    setSize() {}
    setPixelRatio() {}
    getPixelRatio() { return 1 }
    getContext() { return null }
    render() {}
    dispose() {}
    forceContextLoss() {}
    setAnimationLoop() {}
  }
  return { ...actual, WebGLRenderer: StubWebGLRenderer }
})

/**
 * 炮口定位：测试车没有 GLB（代理车），真实 muzzleTipOf 总是回落到记录起点。用例要验证
 * "炮管里那段不画"时把 `muzzleTip.reach` 设成炮管长度，模拟炮口在起点前方 reach 米处。
 */
const muzzleTip = vi.hoisted(() => ({ reach: 0 }))
vi.mock('./battleFx.ts', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    muzzleTipOf: (nodes, from, dir, out) => (muzzleTip.reach > 0
      ? out.copy(from).addScaledVector(dir, muzzleTip.reach)
      : actual.muzzleTipOf(nodes, from, dir, out)),
  }
})

import { initPlayback, QUALITY_PRESETS } from './playbackScene.js'
import { PLAYBACK_SCENE_SOURCE } from './playbackScene.test.source.js'
import { buildGroundGeometry } from './groundPass.js'
import { ANNOTATION_LIFT } from './playback/annotation3d.js'
import { BURST_SECS, FX_BUDGETS } from './battleFx.ts'

/** 最小可用 PlaybackData：空车队 + 一张地图。资产阶段与空名册都不会因此抛错。
 *  t_start 用非 0 值：`startTime` 只在 startPlayback 尾部写入，可作为「过期续体是否
 *  继续跑了 DATA 派生状态写入」的可观测探针（无 WebGL 时 hasData 不具区分度）。 */
// 文件级可变状态：测试体直接赋值/读取裸 api/created/pending（owner 仍是本文件），
// 经 state 存取器回接到共享装配（playbackScene.test.setup.js）。
let api = null
const created = []
const pending = []

const {
  track, stubTerrainAssets, stubFrames, settleZoomFrames, pumpZoomAt, stubCanvas2d,
  createScene, createInstance,
} = installSceneTestSetup({
  source, muzzleTip,
  state: {
    get api() { return api },
    set api(value) { api = value },
    created,
    pending,
  },
})

describe('playbackScene 被销毁实例不得再写共享 store', () => {
  it('destroy A → init B（同一 store）→ A 迟到结束：不得清 B 的 loading / 不得写 B 的 err', async () => {
    const store = createPlaybackStore()
    const lateA = track(deferred())
    source.loadPlaybackData
      .mockImplementationOnce(() => lateA.promise)
      .mockImplementationOnce(() => new Promise(() => {}))
    const apiA = createInstance(store)
    const loadA = apiA.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    expect(store.loading).toBe(true)
    apiA.destroy()
    const apiB = createInstance(store)
    void apiB.loadData({ kind: 'local', file: new File(['b'], 'b.wotbreplay') })
    expect(store.loading).toBe(true)
    expect(store.hasData).toBe(false)
    api = apiB
    lateA.reject(new Error('stale A after destroy'))
    await loadA
    expect(store.loading).toBe(true)
    expect(store.hasData).toBe(false)
    expect(store.err).toBe('')
  })

  it('destroy A → init B → A 迟到「成功」：不得把 B 的就绪态/播放态写坏', async () => {
    const store = createPlaybackStore()
    const lateA = track(deferred())
    source.loadPlaybackData
      .mockImplementationOnce(() => lateA.promise)
      .mockImplementationOnce(() => new Promise(() => {}))
    const apiA = createInstance(store)
    const loadA = apiA.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    apiA.destroy()
    const apiB = createInstance(store)
    void apiB.loadData({ kind: 'local', file: new File(['b'], 'b.wotbreplay') })
    api = apiB
    lateA.resolve(minimalData())
    await loadA
    expect(store.loading).toBe(true)
    expect(store.hasData).toBe(false)
    expect(store.playing).toBe(false)
    expect(store.err).toBe('')
  })
})

describe('playbackScene 资产阶段过期续体', () => {
  it.each(['same instance', 'destroy and recreate'])('A 的内部地图解析不得改写 B（%s）', async (mode) => {
    const store = createPlaybackStore()
    source.loadPlaybackData
      .mockImplementationOnce(() => Promise.resolve(minimalData(917, 'map_a')))
      .mockImplementationOnce(() => Promise.resolve(minimalData(431, 'map_b')))
      .mockImplementation(() => Promise.resolve(minimalData(917, 'map_a')))
    const parkedA = track(deferred())
    source.resolveMapKey
      .mockResolvedValueOnce('map_a')
      .mockImplementationOnce(() => parkedA.promise)
      .mockResolvedValue('map_b')
    const apiA = createInstance(store)
    const loadA = apiA.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    await vi.waitFor(() => expect(source.resolveMapKey).toHaveBeenCalledTimes(2))
    expect(store.assetStage).toBe(true)
    expect(store.loading).toBe(true)
    if (mode === 'destroy and recreate') apiA.destroy()
    const apiB = mode === 'same instance' ? apiA : createInstance(store)
    await apiB.loadData({ kind: 'local', file: new File(['b'], 'b.wotbreplay') })
    expect(store.mapName).toBe('map_b')
    expect(store.startTime).toBe(431)
    expect(store.mapKey).toBe('map_b')
    expect(store.hasData).toBe(true)
    parkedA.resolve('map_a')
    await loadA
    expect(store.mapName).toBe('map_b')
    expect(store.startTime).toBe(431)
    expect(store.mapKey).toBe('map_b')
    expect(store.hasData).toBe(true)
  })

  it('未过期时资产阶段正常收尾（守住修复没有把正常路径一起关掉）', async () => {
    const store = createPlaybackStore()
    source.loadPlaybackData.mockImplementation(() => Promise.resolve(minimalData()))
    source.resolveMapKey.mockImplementation(() => Promise.resolve(null))
    const only = createInstance(store)
    api = only
    await only.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    expect(store.loading).toBe(false)
    expect(store.hasData).toBe(true)
    expect(store.startTime).toBe(42)
  })

  it('会话作废后 startPlayback 尾部不得启动播放（不写 mapName / startTime / playing）', async () => {
    const store = createPlaybackStore()
    source.loadPlaybackData.mockImplementation(() => Promise.resolve(minimalData(917, 'map_a')))
    const parked = track(deferred())
    source.resolveMapKey
      .mockResolvedValueOnce('map_a')
      .mockImplementationOnce(() => parked.promise)
      .mockResolvedValue(null)
    const only = createInstance(store)
    api = only
    const load = only.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    await vi.waitFor(() => expect(source.resolveMapKey).toHaveBeenCalledTimes(2))
    expect(store.assetStage).toBe(true)
    expect(store.mapName).toBe('map_a')
    only.destroy()
    const epochBefore = store.startTime
    parked.resolve('map_a')
    await load
    expect(store.startTime).toBe(epochBefore)
    expect(store.playing).toBe(false)
    expect(store.hasData).toBe(false)
  })
})

describe('playbackScene reset：撤下当前回放', () => {
  it('解析途中撤下：迟到解析不得落成会话，也不得把 DATA 留给下一场', async () => {
    const store = createPlaybackStore()
    const late = track(deferred())
    source.loadPlaybackData.mockImplementationOnce(() => late.promise)
    const only = createInstance(store)
    api = only
    const load = only.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    expect(store.loading).toBe(true)
    only.reset()
    expect(store.loading).toBe(false)
    expect(store.hasData).toBe(false)
    late.resolve(minimalData(917, 'map_a'))
    await load
    expect(store.hasData).toBe(false)
    expect(store.loading).toBe(false)
    expect(store.mapName).toBe('')
    expect(store.startTime).toBe(0)
    expect(store.err).toBe('')
    expect(store.qualityKey).toBe('low')
    only.setQuality('mid')
    expect(store.qualityKey).toBe('mid')
  })

  it('资产途中撤下：迟到续体不得触场景，也不得把内部异常当「加载失败」写给用户', async () => {
    source.loadPlaybackData.mockImplementation(() => Promise.resolve(minimalData(917, 'map_a')))
    const parked = track(deferred())
    source.resolveMapKey
      .mockResolvedValueOnce('map_a')
      .mockImplementationOnce(() => parked.promise)
      .mockResolvedValue(null)
    const store = createPlaybackStore()
    const only = createInstance(store)
    api = only
    const load = only.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    await vi.waitFor(() => expect(source.resolveMapKey).toHaveBeenCalledTimes(2))
    expect(store.assetStage).toBe(true)
    only.reset()
    expect(store.assetStage).toBe(false)
    expect(store.mapName).toBe('')
    parked.resolve('map_a')
    await load
    expect(store.mapName).toBe('')
    expect(store.startTime).toBe(0)
    expect(store.playing).toBe(false)
    expect(store.hasData).toBe(false)
    expect(store.assetStage).toBe(false)
    expect(store.err).toBe('')
  })
})

describe('playbackScene loadMapOnly：地图预览会话', () => {
  it('地图资产就绪 → mapReady 落位、hasData 保持 false（传输/阵容门控不误开）', async () => {
    stubTerrainAssets()
    const { store } = createScene()
    await api.loadMapOnly({ mapId: 17, mapName: 'Yukon' })
    expect(store.mapReady).toBe(true)
    expect(store.hasData).toBe(false)
    expect(store.loading).toBe(false)
    expect(store.assetStage).toBe(false)
    expect(store.err).toBe('')
    expect(store.mapName).toBe('Yukon')
    expect(store.mapKey).toBe('probe_map')
    expect(store.playing).toBe(false)
  })

  it('reset 撤下地图预览：mapReady 复位，不留就绪残留', async () => {
    stubTerrainAssets()
    const { store } = createScene()
    await api.loadMapOnly({ mapId: 17, mapName: 'Yukon' })
    expect(store.mapReady).toBe(true)
    api.reset()
    expect(store.mapReady).toBe(false)
    expect(store.hasData).toBe(false)
    expect(store.mapKey).toBe(null)
  })

  it('地图预览之后 loadData 正常接管回放会话（SESSION_MODE 复位）', async () => {
    stubTerrainAssets()
    const { store } = createScene()
    await api.loadMapOnly({ mapId: 17, mapName: 'Yukon' })
    expect(store.mapReady).toBe(true)
    const session = { loadScene: vi.fn().mockResolvedValue(minimalData(7, 'map_b')), getState: () => null }
    await api.loadData({ kind: 'local', file: new File(['x'], 'b.wotbreplay'), session })
    expect(store.hasData).toBe(true)
    expect(store.mapReady).toBe(false)
    expect(store.mapName).toBe('map_b')
  })

  it('resolveMapKey 失败也 fail-soft：网格兜底照样就绪', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
    source.resolveMapKey.mockImplementation(() => Promise.reject(new Error('offline')))
    const { store } = createScene()
    await api.loadMapOnly({ mapId: 17, mapName: 'Yukon' })
    expect(store.mapReady).toBe(true)
    expect(store.hasData).toBe(false)
    expect(store.err).toBe('')
  })

  // ---- 静态基地环（setMapBasesKind）：与回放同一贴地管线，模式由宿主显式指定 ----
  it('setMapBasesKind 显式选组：中立视图进 store.baseViews；非法值归一 null 清空', async () => {
    stubTerrainAssets()
    stubCanvas2d()
    const frame = stubFrames()
    const { store, api } = createScene()
    await api.loadMapOnly({ mapId: 17, mapName: 'Yukon' })
    frame()
    expect(store.baseViews).toEqual([])
    api.setMapBasesKind('supremacy')
    frame()
    // 争霸 A–C 全列、无占领状态（静态预览按无主中立，与回放未开占领同表现）
    expect(store.baseViews.map((v) => [v.baseId, v.kind, v.owner, v.progress])).toEqual([
      ['A', 'supremacy', 'neutral', null],
      ['B', 'supremacy', 'neutral', null],
      ['C', 'supremacy', 'neutral', null],
    ])
    api.setMapBasesKind('assault')
    frame()
    // 遭遇 = 单基地旗帜（ASSAULT_BASE_ID），probe_map.assault 恰 1 条 candidate
    expect(store.baseViews.map((v) => [v.baseId, v.kind, v.owner, v.progress])).toEqual([
      ['BASE', 'assault', 'neutral', null],
    ])
    api.setMapBasesKind('bogus')
    frame()
    expect(store.baseViews).toEqual([])
  })

  it('assault 组多 candidate 无证据 fail-closed：几何不唯一就不画（supremacy 不受影响）', async () => {
    stubTerrainAssets()
    stubCanvas2d()
    source.resolveMapKey.mockResolvedValue('probe_multi')
    const frame = stubFrames()
    const { store, api } = createScene()
    await api.loadMapOnly({ mapId: 18, mapName: 'Multi' })
    api.setMapBasesKind('assault')
    frame()
    expect(store.baseViews).toEqual([])
    api.setMapBasesKind('supremacy')
    frame()
    expect(store.baseViews).toHaveLength(1)
  })

  it('MAP_BASES_KIND 随 teardown 复位：重建会话在宿主补推前不画旧组', async () => {
    stubTerrainAssets()
    stubCanvas2d()
    const frame = stubFrames()
    const { store, api } = createScene()
    await api.loadMapOnly({ mapId: 17, mapName: 'Yukon' })
    api.setMapBasesKind('supremacy')
    frame()
    expect(store.baseViews).toHaveLength(3)
    await api.loadMapOnly({ mapId: 17, mapName: 'Yukon' })
    frame()
    expect(store.baseViews).toEqual([])
  })
})

describe('playbackScene 场景未初始化时的调用安全', () => {
  it('initScene 之前 pause → resume 会重新挂起被取消的 rAF，且场景 API 不炸', async () => {
    const raf = vi.fn()
      .mockReturnValueOnce(101)
      .mockReturnValueOnce(102)
      .mockReturnValue(103)
    const cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const { store, api } = createScene()
    expect(raf).toHaveBeenCalledTimes(1)
    expect(() => api.setPaused(true)).not.toThrow()
    expect(cancel).toHaveBeenCalledWith(101)
    expect(() => api.setPaused(false)).not.toThrow()
    expect(raf).toHaveBeenCalledTimes(2)
    source.loadPlaybackData.mockResolvedValueOnce(minimalData())
    await api.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    expect(store.hasData).toBe(true)
    expect(store.err).toBe('')
    expect(() => api.setPlaying(false)).not.toThrow()
    expect(() => api.togglePlay()).not.toThrow()
    expect(store.playing).toBe(true)
    expect(() => api.togglePlay()).not.toThrow()
    expect(store.playing).toBe(false)
  })

  it('初始化之后 setPaused 仍正常停帧 / 恢复（守住修复没有把正常路径关掉）', async () => {
    source.loadPlaybackData.mockImplementation(() => Promise.resolve(minimalData()))
    const store = createPlaybackStore()
    const only = createInstance(store)
    await only.loadData({ kind: 'local', file: new File(['a'], 'a.wotbreplay') })
    expect(store.hasData).toBe(true)
    expect(() => only.setPaused(true)).not.toThrow()
    expect(() => only.setPaused(false)).not.toThrow()
    expect(store.hasData).toBe(true)
    expect(store.err).toBe('')
  })
})

describe('playbackScene 资产发布顺序', () => {
  function prepareAssets(kinds) {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    source.resolveMapKey.mockResolvedValue('probe_map')
    source.mapStaticUrl.mockImplementation((kind) => kinds.includes(kind) ? '/assets/' + kind : null)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:asset')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  }

  it.each(['low', 'mid'])('%s 加载并挂载场景；reset 后撤下场景', async (quality) => {
    window.history.replaceState(null, '', `/?debug&q=${quality}`)
    prepareAssets(['scenery'])
    const root = new THREE.Group()
    vi.spyOn(GLTFLoader.prototype, 'load').mockImplementationOnce((_url, onLoad) => onLoad({
      scene: root, parser: { json: { materials: [] }, associations: new Map() },
    }))
    const { api, store } = createScene()
    await api.loadMapOnly({ mapId: 1, mapName: 'probe_map' })
    expect(store.mapReady).toBe(true)
    expect(root.parent?.parent).toBe(window.__scene)
    expect(store.assetIssues.some((issue) => issue.key === 'scenery')).toBe(false)
    api.reset()
    expect(store.mapReady).toBe(false)
    expect(root.parent?.parent).toBeNull()
  })

  it.each(['low', 'mid'])('%s 场景资源失败时记录降级并完成会话', async (quality) => {
    window.history.replaceState(null, '', `/?debug&q=${quality}`)
    prepareAssets(['scenery'])
    vi.spyOn(GLTFLoader.prototype, 'load').mockImplementationOnce((_url, _ok, _progress, onError) => onError(new Error('missing')))
    const { api, store } = createScene()
    await api.loadMapOnly({ mapId: 1, mapName: 'probe_map' })
    expect(store.mapReady).toBe(true)
    expect(store.assetDegraded).toBe(true)
    expect(store.assetIssues.some((issue) => issue.key === 'scenery' && issue.status === 'failed')).toBe(true)
  })

  it('迟到底图只 dispose A；B 的当前贴图引用仍由会话持有', async () => {
    prepareAssets(['map'])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, headers: new Headers(), blob: async () => new Blob(['map']),
    }))
    const textureA = new THREE.Texture()
    const textureB = new THREE.Texture()
    const disposeA = vi.spyOn(textureA, 'dispose')
    const disposeB = vi.spyOn(textureB, 'dispose')
    const parked = track(deferred())
    const loader = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync')
      .mockImplementationOnce(() => parked.promise)
      .mockResolvedValue(textureB)
    const { api, store } = createScene()
    const loadA = api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
    await api.loadData({ kind: 'local', file: new File(['b'], 'b') })
    expect(store.hasData).toBe(true)
    const groundB = window.__scene.children.find((o) => o.material?.map === textureB)
    expect(groundB).toBeDefined()
    parked.resolve(textureA)
    await loadA
    expect(disposeA).toHaveBeenCalledTimes(1)
    expect(disposeB).not.toHaveBeenCalled()
    expect(groundB.material.map).toBe(textureB)
    expect(store.hasData).toBe(true)
    expect(store.err).toBe('')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
    api.destroy()
    expect(disposeB).toHaveBeenCalledTimes(2)
    created.length = 0
  })

  it('迟到 terrain arrayBuffer 不得覆盖 B 正在提交的高度场', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    prepareAssets(['terrain', 'terrain-meta', 'groundmeta'])
    const parkedBuffer = track(deferred())
    const parkedGround = track(deferred())
    const readBuffer = vi.fn()
      .mockImplementationOnce(() => parkedBuffer.promise)
      .mockResolvedValue(new Uint16Array([0, 0, 0, 0]).buffer)
    const groundFetch = vi.fn().mockImplementationOnce(() => parkedGround.promise)
      .mockResolvedValue({ ok: false })
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.endsWith('terrain-meta')) return { ok: true, json: async () => ({ size: 2, span: 600, zmin: 20, zmax: 100, terrainLayout: 2 }) }
      if (url.endsWith('terrain')) return { ok: true, arrayBuffer: readBuffer }
      if (url.endsWith('groundmeta')) return groundFetch()
      throw new Error('unexpected asset ' + url)
    }))
    const { api, store } = createScene()
    const loadA = api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    await vi.waitFor(() => expect(readBuffer).toHaveBeenCalledTimes(1))
    const loadB = api.loadData({ kind: 'local', file: new File(['b'], 'b') })
    await vi.waitFor(() => expect(groundFetch).toHaveBeenCalledTimes(1))
    parkedBuffer.resolve(new Uint16Array([65535, 65535, 65535, 65535]).buffer)
    await loadA
    expect(store.loading).toBe(true)
    parkedGround.resolve({ ok: false })
    await loadB
    const terrain = window.__terrain
    expect(terrain).toBeDefined()
    expect(terrain.geometry.attributes.position.getY(0)).toBeCloseTo(20)
    expect(store.hasData).toBe(true)
    expect(store.err).toBe('')
  })

  // json/bin 配对（PR #615 review P2）：布局标记只对同一次发布的 bin 成立——bin 以 terrainBinSha256 作缓存键
  // 取回，解码前核对字节；不同批（发布进行中）fail-closed 回退 2D，不画错位一列的地形。
  function terrainPairFetch(meta, bin) {
    return vi.fn(async (url) => {
      if (url.endsWith('terrain-meta')) return { ok: true, json: async () => ({ ...meta }) }
      if (url.startsWith('/assets/terrain')) return { ok: true, arrayBuffer: async () => bin }
      throw new Error('unexpected asset ' + url)
    })
  }
  const sha256Hex = (buf) => createHash('sha256').update(Buffer.from(buf)).digest('hex')

  it('terrain bin 以 terrainBinSha256 作缓存键取回，字节配对才建地形', async () => {
    prepareAssets(['terrain', 'terrain-meta'])
    window.__terrain = undefined
    const bin = new Uint16Array([0, 65535, 0, 65535]).buffer
    const sha = sha256Hex(bin)
    const fetchMock = terrainPairFetch({ size: 2, span: 600, zmin: 20, zmax: 100, terrainLayout: 2, terrainBinSha256: sha }, bin)
    vi.stubGlobal('fetch', fetchMock)
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(`/assets/terrain?sha256=${sha}`)
    expect(window.__terrain).toBeDefined()
    expect(window.__terrain).not.toBeNull()
    expect(store.hasData).toBe(true)
  })

  it('迟到底图失败不得把旧会话诊断写进新 store（reset 后 assetIssues 保持干净）', async () => {
    prepareAssets(['map'])
    const parked = track(deferred())
    vi.stubGlobal('fetch', vi.fn(() => parked.promise))
    const { api, store } = createScene()
    const loadA = api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    api.reset()
    parked.reject(new Error('late map failure'))
    await loadA
    expect(store.assetIssues).toEqual([])
    expect(store.assetDegraded).toBe(false)
    expect(store.hasData).toBe(false)
  })

  it('terrain 双 404 是核心资产降级，不得标为 optional', async () => {
    prepareAssets(['map', 'terrain', 'terrain-meta'])
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockResolvedValue(new THREE.Texture())
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/terrain')) return { ok: false, status: 404 }
      return { ok: true, status: 200, headers: new Headers(), blob: async () => new Blob(['map']) }
    }))
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    expect(store.hasData).toBe(true)
    expect(store.assetDegraded).toBe(true)
    expect(store.assetIssues.some((i) => i.key === 'terrain' && i.status === 'missing')).toBe(true)
  })

  it('变体映射缺失时 fail-closed 裁剪进入资产降级', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    prepareAssets(['scenery'])
    const root = new THREE.Group()
    const tagged = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
    tagged.userData.mdVariant = 'md1'
    root.add(tagged)
    vi.spyOn(GLTFLoader.prototype, 'load').mockImplementationOnce((_url, onLoad) => onLoad({
      scene: root, parser: { json: { materials: [] }, associations: new Map() },
    }))
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    expect(store.hasData).toBe(true)
    expect(store.assetIssues.some((i) => i.key === 'scenery' && i.status === 'variant-fail-closed')).toBe(true)
  })

  it('variantMappingIncomplete 标记本身也进入资产降级（active 映射存在但标签缺失）', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    prepareAssets(['scenery'])
    const root = new THREE.Group()
    root.userData.variantByMapId = { 1: 'md1' }
    root.userData.variantMappingIncomplete = true
    const tagged = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
    tagged.userData.mdVariant = 'md2'
    root.add(tagged)
    vi.spyOn(GLTFLoader.prototype, 'load').mockImplementationOnce((_url, onLoad) => onLoad({
      scene: root, parser: { json: { materials: [] }, associations: new Map() },
    }))
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    expect(store.hasData).toBe(true)
    expect(store.assetIssues.some((i) => i.key === 'scenery' && i.status === 'variant-fail-closed')).toBe(true)
  })

  it('分层地表元数据畸形：记降级、回退烘焙底图，不跳过场景', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    prepareAssets(['map', 'terrain', 'terrain-meta', 'groundmeta', 'groundtex', 'scenery'])
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockResolvedValue(new THREE.Texture())
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url)
      if (u.includes('terrain-meta')) return { ok: true, status: 200, json: async () => ({ size: 2, span: 600, zmin: 0, zmax: 1, terrainLayout: 2 }) }
      if (u.includes('/terrain')) return { ok: true, status: 200, arrayBuffer: async () => new Uint16Array([0, 1, 2, 3]).buffer }
      if (u.includes('groundmeta')) return { ok: true, status: 200, json: async () => ({}) } // 缺 tiling
      if (u.includes('groundtex')) return { ok: true, status: 200, blob: async () => new Blob(['x']) }
      return { ok: true, status: 200, headers: new Headers(), blob: async () => new Blob(['map']) }
    }))
    vi.spyOn(GLTFLoader.prototype, 'load').mockImplementationOnce((_url, onLoad) => onLoad({
      scene: new THREE.Group(), parser: { json: { materials: [] }, associations: new Map() },
    }))
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    expect(store.hasData).toBe(true)
    expect(store.assetDegraded).toBe(true)
    expect(store.assetIssues.some((i) => i.key === 'groundLayers' && i.status === 'invalid')).toBe(true)
    expect(window.__terrain).toBeTruthy()   // 回退烘焙底图后地形仍建成
  })

  it('场景装配步骤抛错也进入资产降级（不只 loader 返回空）', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    prepareAssets(['scenery'])
    const boom = new THREE.Group()
    boom.traverse = () => { throw new Error('assembly boom') }
    vi.spyOn(GLTFLoader.prototype, 'load').mockImplementationOnce((_url, onLoad) => onLoad({
      scene: boom,
      parser: { json: { materials: [] }, associations: new Map() },
    }))
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    expect(store.hasData).toBe(true)
    expect(store.assetDegraded).toBe(true)
    expect(store.assetIssues.some((i) => i.key === 'scenery' && i.status === 'failed' && i.detail.includes('assembly boom'))).toBe(true)
  })

  it('terrain bin 与 terrain.json 不同批（sha256 不符）⇒ 不建地形、回退 2D', async () => {
    prepareAssets(['terrain', 'terrain-meta'])
    window.__terrain = undefined
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bin = new Uint16Array([0, 65535, 0, 65535]).buffer
    const otherSha = sha256Hex(new Uint16Array([1, 2, 3, 4]).buffer)
    vi.stubGlobal('fetch', terrainPairFetch({ size: 2, span: 600, zmin: 20, zmax: 100, terrainLayout: 2, terrainBinSha256: otherSha }, bin))
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    expect(window.__terrain == null).toBe(true)
    expect(warn.mock.calls.some((c) => String(c[0]).includes('sha256 不符'))).toBe(true)
    expect(store.hasData).toBe(true)
    expect(store.err).toBe('')
  })

  it('资产缺失/失败进入 assetIssues + assetDegraded（不再只写 console 后算完成）', async () => {
    const raw = PLAYBACK_SCENE_SOURCE
    // #820 Step 2：地图资产装载（noteAsset/进度/降级）owner = playback/mapWorld.ts
    const worldSrc = (await import('./playback/mapWorldLoader.ts?raw')).default
    expect(worldSrc).toMatch(/store\.assetIssues = assetIssues/)
    expect(worldSrc).toMatch(/store\.assetDegraded = true/)
    expect(worldSrc).toMatch(/noteAsset\('map', `http-\$\{resp\.status\}`/)
    expect(worldSrc).toMatch(/noteAsset\('terrain', 'unavailable'/)
    expect(worldSrc).toMatch(/noteAsset\('scenery', 'failed'/)
    // 3D 与 2D 共用同一 visibility 投影（短隐藏段在 3D 也不能回退到 coverage）
    expect(raw).toMatch(/VIS_BY_EID = visibilitySpansByEid\(data\.visibility\)/)
    expect(raw).toMatch(/VIS_BY_EID\.get\(v\.def\.eid\) \?\? v\.def\.coverage/)
  })

  it.each(['low', 'mid', 'high'])('%s 迟到 scenery GLB 不入 B 场景，且释放局部资源与隔离进度', async (quality) => {
    window.history.replaceState(null, '', `/?debug&q=${quality}`)
    prepareAssets(['scenery'])
    const gltfA = new THREE.Group()
    const geometryA = new THREE.BoxGeometry()
    const textureA = new THREE.Texture()
    const materialA = new THREE.MeshBasicMaterial({ map: textureA })
    gltfA.add(new THREE.Mesh(geometryA, materialA))
    const disposeGeo = vi.spyOn(geometryA, 'dispose')
    const disposeMat = vi.spyOn(materialA, 'dispose')
    const disposeTex = vi.spyOn(textureA, 'dispose')
    let finishA, progressA
    const loader = vi.spyOn(GLTFLoader.prototype, 'load')
      .mockImplementationOnce((_url, onLoad, onProgress) => { finishA = onLoad; progressA = onProgress })
      .mockImplementation((_url, onLoad) => onLoad({ scene: new THREE.Group() }))
    const { api, store } = createScene()
    const loadA = api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
    await api.loadData({ kind: 'local', file: new File(['b'], 'b') })
    const currentProgress = store.assetProgress
    progressA({ loaded: 3, total: 10, lengthComputable: true })
    expect(store.assetProgress).toBe(currentProgress)
    finishA({ scene: gltfA })
    await loadA
    expect(gltfA.parent).toBeNull()
    expect(disposeGeo).toHaveBeenCalledTimes(1)
    expect(disposeMat).toHaveBeenCalledTimes(1)
    expect(disposeTex).toHaveBeenCalledTimes(1)
    expect(store.hasData).toBe(true)
    expect(store.assetProgress).toBe(currentProgress)
  })

  it('分层纹理 worker 迟到时释放全部局部纹理，不发布旧分层或进度', async () => {
    window.history.replaceState(null, '', '/?debug&q=high')
    prepareAssets(['groundmeta', 'groundtex'])
    let groundCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.endsWith('groundmeta')) {
        if (++groundCalls === 2) return { ok: false }
        return { ok: true, json: async () => ({ height_blend: false }) }
      }
      return { ok: true, blob: async () => new Blob(['layer']) }
    }))
    const parked = track(deferred())
    const lateTexture = new THREE.Texture()
    const disposeLate = vi.spyOn(lateTexture, 'dispose')
    const localTextures = []
    const loader = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync')
      .mockImplementationOnce(() => parked.promise)
      .mockImplementation(async () => {
        const texture = new THREE.Texture()
        localTextures.push({ texture, dispose: vi.spyOn(texture, 'dispose') })
        return texture
      })
    const { api, store } = createScene()
    const loadA = api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(6))
    await api.loadData({ kind: 'local', file: new File(['b'], 'b') })
    const progressB = store.assetProgress
    parked.resolve(lateTexture)
    await loadA
    expect(disposeLate).toHaveBeenCalledTimes(1)
    for (const { dispose } of localTextures) expect(dispose).toHaveBeenCalledTimes(1)
    expect(window.__gdbg.layers).toBe(false)
    expect(store.assetProgress).toBe(progressB)
    expect(store.hasData).toBe(true)
  })

  it('新 loadData 的解析阶段清掉上一会话的 assetStage / assetProgress', async () => {
    source.loadPlaybackData.mockResolvedValueOnce(minimalData())
    const parked = track(deferred())
    source.resolveMapKey.mockResolvedValueOnce('map_a').mockImplementationOnce(() => parked.promise)
    const { api, store } = createScene()
    const loadA = api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    await vi.waitFor(() => expect(store.assetStage).toBe(true))
    store.assetProgress = 0.6
    const parserB = track(deferred())
    source.loadPlaybackData.mockImplementationOnce(() => parserB.promise)
    const loadB = api.loadData({ kind: 'local', file: new File(['b'], 'b') })
    expect(store.assetStage).toBe(false)
    expect(store.assetProgress).toBeNull()
    expect(store.loading).toBe(true)
    parked.resolve('map_a')
    await loadA
    expect(store.assetStage).toBe(false)
    expect(store.assetProgress).toBeNull()
    expect(store.loading).toBe(true)
    parserB.reject(new Error('B parser failed'))
    await loadB
  })

  it('destroy 在资产阶段清掉 loading / assetStage / assetProgress', async () => {
    source.loadPlaybackData.mockResolvedValueOnce(minimalData())
    const parked = track(deferred())
    source.resolveMapKey.mockResolvedValueOnce('map_a').mockImplementationOnce(() => parked.promise)
    const { api, store } = createScene()
    const load = api.loadData({ kind: 'local', file: new File(['a'], 'a') })
    await vi.waitFor(() => expect(store.assetStage).toBe(true))
    store.assetProgress = 0.6
    api.destroy()
    expect(store.loading).toBe(false)
    expect(store.assetStage).toBe(false)
    expect(store.assetProgress).toBeNull()
    parked.resolve('map_a')
    await load
    expect(store.assetStage).toBe(false)
    expect(store.assetProgress).toBeNull()
    created.length = 0
  })
})

