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

describe('Free Camera terrain floor', () => {
  it('uses the Top mode default camera height as the Free hard ceiling', async () => {
    stubTerrainAssets({ values: [0, 0, 0, 0], zmin: 20, zmax: 20 })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['terrain'], 'terrain-top-ceiling.wotbreplay') })
    const cam = window.__camera
    const controls = window.__controls
    api.setCam('top')
    const topHeight = cam.position.y
    // 俯视是持续的战术总览模式：OrbitControls 接管，target 锁**地图中心**（旋转中心不是相机）
    expect(store.cam).toBe('top')
    expect(controls.enabled).toBe(true)
    expect(controls.enablePan).toBe(false)
    const viewDirection = () => new THREE.Vector3().subVectors(controls.target, cam.position).normalize()
    expect(viewDirection().y).toBeLessThan(-0.99)   // 保持直下朝向，不回落到斜俯视
    // 飞行（WASD）不接管总览视角：flyTick 在俯视模式下为惰性
    expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(false)
    api.setCam('free')
    expect(controls.enabled).toBe(false)
    expect(controls.enablePan).toBe(true)
    expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(true)
    const afterForward = cam.position.y
    expect(api.flyTick(0.1, new Set(['KeyE']))).toBe(true)
    expect(cam.position.y).toBeLessThan(afterForward)
    api.setCam('free')

    cam.position.y = topHeight - 0.1
    controls.target.y = topHeight - 5.1
    cam.lookAt(controls.target)
    api.setFlySpeed(6)
    expect(api.flyTick(0.1, new Set(['KeyQ']))).toBe(true)
    expect(cam.position.y).toBeCloseTo(topHeight, 5)

    const canvas = document.querySelector('canvas')
    cam.position.y = topHeight - 0.1
    controls.target.y = topHeight - 5.1
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }))
    await settleZoomFrames()   // #835：滚轮只累积预算，净空钳制在逐帧收敛中逐帧校验
    expect(cam.position.y).toBeCloseTo(topHeight, 5)

    cam.position.y = topHeight - 0.1
    controls.target.y = topHeight - 5.1
    const touch = (type, x, pointerId) => {
      const event = new MouseEvent(type, { button: 0, clientX: x, clientY: 300, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true })
      Object.defineProperty(event, 'pointerType', { value: 'touch' })
      Object.defineProperty(event, 'pointerId', { value: pointerId })
      return event
    }
    const frame = stubFrames()
    canvas.dispatchEvent(touch('pointerdown', 100, 7))
    canvas.dispatchEvent(touch('pointerdown', 340, 9))
    canvas.dispatchEvent(touch('pointermove', 300, 9))
    frame()                                              // 判定为捏合，基准指距 200px
    canvas.dispatchEvent(touch('pointermove', 260, 9))
    expect(cam.position.y).toBeCloseTo(topHeight, 5)
    canvas.dispatchEvent(touch('pointerup', 260, 9))
    canvas.dispatchEvent(touch('pointerup', 100, 7))

    cam.position.y = topHeight + 50
    controls.target.y = topHeight + 45
    const beforeClamp = new THREE.Vector3().subVectors(controls.target, cam.position).normalize()
    api.setCam('free')
    expect(cam.position.y).toBeCloseTo(topHeight, 5)
    const afterClamp = new THREE.Vector3().subVectors(controls.target, cam.position).normalize()
    expect(afterClamp.dot(beforeClamp)).toBeCloseTo(1, 8)
  })

  it('constrains mode entry, high-speed fly, uphill fly, wheel and pinch while preserving view direction', async () => {
    stubTerrainAssets()
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['terrain'], 'terrain-floor.wotbreplay') })
    const cam = window.__camera
    const controls = window.__controls
    const dir = () => new THREE.Vector3().subVectors(controls.target, cam.position).normalize()

    api.setCam('top')
    cam.position.set(-30, 20, 0)
    controls.target.set(-20, 15, 0)
    const entryDir = dir()
    api.setCam('free')
    expect(cam.position.y).toBeCloseTo(27.5, 5)
    expect(dir().dot(entryDir)).toBeCloseTo(1, 8)
    cam.position.y = 45
    controls.target.y += 17.5
    api.setCam('free')
    expect(cam.position.y).toBe(45)

    cam.position.set(-30, 45, 0)
    controls.target.set(-20, 40, 0)
    api.setFlySpeed(6)
    const descentDir = dir()
    expect(api.flyTick(0.1, new Set(['KeyE']))).toBe(true)
    expect(cam.position.y).toBeCloseTo(27.5, 5)
    expect(dir().dot(descentDir)).toBeCloseTo(1, 8)
    for (let i = 0; i < 3; i++) {
      expect(api.flyTick(0.1, new Set(['KeyE']))).toBe(true)
      expect(cam.position.y).toBeCloseTo(27.5, 5)
    }

    cam.position.set(-30, 28, 0)
    controls.target.set(-20, 28, 0)
    expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(true)
    expect(cam.position.x).toBeCloseTo(-10, 5)
    expect(cam.position.y).toBeGreaterThanOrEqual(29.5)

    cam.position.set(-30, 27.51, 0)
    controls.target.set(-20, 22.51, 0)
    const canvas = document.querySelector('canvas')
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
    await settleZoomFrames()
    expect(cam.position.y).toBeGreaterThanOrEqual(27.5)

    cam.position.set(-30, 27.51, 0)
    controls.target.set(-20, 22.51, 0)
    const touch = (type, x, pointerId) => {
      const event = new MouseEvent(type, { button: 0, clientX: x, clientY: 300, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true })
      Object.defineProperty(event, 'pointerType', { value: 'touch' })
      Object.defineProperty(event, 'pointerId', { value: pointerId })
      return event
    }
    const frame = stubFrames()
    canvas.dispatchEvent(touch('pointerdown', 100, 7))
    canvas.dispatchEvent(touch('pointerdown', 260, 9))
    canvas.dispatchEvent(touch('pointermove', 300, 9))
    frame()                                              // 判定为捏合，基准指距 200px
    canvas.dispatchEvent(touch('pointermove', 340, 9))
    expect(cam.position.y).toBeGreaterThanOrEqual(27.5)
    canvas.dispatchEvent(touch('pointerup', 340, 9))
    canvas.dispatchEvent(touch('pointerup', 100, 7))
  })

  it('does not create a world-zero floor without terrain or outside the heightfield span', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const noTerrain = createScene()
    await noTerrain.api.loadData({ kind: 'local', file: new File(['empty'], 'no-terrain.wotbreplay') })
    const cam = window.__camera
    noTerrain.api.setCam('top')
    const topHeight = cam.position.y
    cam.position.y = -10
    noTerrain.api.setCam('free')
    expect(cam.position.y).toBe(-10)
    cam.position.y = topHeight + 50
    noTerrain.api.setCam('free')
    expect(cam.position.y).toBeCloseTo(topHeight, 5)
    noTerrain.api.destroy()
    created.length = 0

    stubTerrainAssets({ values: [10, 10, 10, 10], zmin: 10, zmax: 10 })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const withTerrain = createScene()
    await withTerrain.api.loadData({ kind: 'local', file: new File(['terrain'], 'terrain-boundary.wotbreplay') })
    const terrainCam = window.__camera
    withTerrain.api.setCam('top')
    const topPosition = terrainCam.position.clone()
    expect(topPosition.y).toBeGreaterThan(10)
    terrainCam.position.set(300, -10, 0)
    withTerrain.api.setCam('free')
    expect(terrainCam.position.y).toBe(-10)
    expect(terrainCam.position.x).toBe(300)
    terrainCam.position.y = 500
    withTerrain.api.setCam('free')
    expect(terrainCam.position.y).toBeCloseTo(topPosition.y, 5)

    withTerrain.api.setCam('follow')
    terrainCam.position.set(0, -10, 0)
    expect(withTerrain.api.flyTick(0.1, new Set(['KeyE']))).toBe(false)
    expect(terrainCam.position.y).toBe(-10)
  })

  it('applies the floor once when terrain is published after the initial Free scene', async () => {
    stubTerrainAssets({ values: [0, 0, 0, 0], zmin: 400, zmax: 400 })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['late-terrain'], 'late-terrain.wotbreplay') })
    expect(store.cam).toBe('top')   // 默认进入俯视总览模式
    const cam = window.__camera
    const controls = window.__controls
    const tacticalHeight = 255 // minimalData 的 WORLD_CENTER.ext = 150
    api.setCam('top')
    expect(store.cam).toBe('top')
    expect(cam.position.x).toBeCloseTo(0)
    expect(Math.abs(cam.position.z)).toBeLessThan(0.1)
    expect(cam.position.y).toBeGreaterThanOrEqual(400.5)   // 地形净空优先于默认高度
    expect(new THREE.Vector3().subVectors(controls.target, cam.position).normalize().y).toBeLessThan(-0.99)
  })

  // 回归（用户要求）：默认俯视视角的**旋转中心 = 地图中心**，不是相机。
  // 锁两件事：① target 钉在地图中心；② 绕转后 target 不随相机移动（OrbitControls 轨道语义），
  // 且极角上限仍挡在地平线以上。此前曾被改成「一次性动作 + 落进 free」，free 的 flyLook 把
  // target 重钉到 cam + dir×dist（旋转中心变成相机）。
  it('top view orbits around the map center, not the camera', async () => {
    stubTerrainAssets({ values: [0, 0, 0, 0], zmin: 0, zmax: 0 })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api, store } = createScene()
    await api.loadData({ kind: 'local', file: new File(['a'], 'top-orbit.wotbreplay') })
    const cam = window.__camera
    const controls = window.__controls
    expect(store.cam).toBe('top')
    expect(controls.enabled).toBe(true)
    // ① target = WORLD_CENTER（minimalData：ext=150、cx=cz=0）
    expect(controls.target.x).toBeCloseTo(0, 3)
    expect(controls.target.z).toBeCloseTo(0, 3)
    // ② 模拟轨道绕转（相机绕 target 转到斜上方）：target 必须纹丝不动
    const center = controls.target.clone()
    const radius = cam.position.distanceTo(center)
    cam.position.set(radius * 0.6, radius * 0.75, radius * 0.2)
    controls.update()
    expect(controls.target.distanceTo(center)).toBeLessThan(1e-6)
    // ③ 不沉到地平线以下
    expect(controls.maxPolarAngle).toBeLessThanOrEqual(Math.PI * 0.5)
  })

  describe('default top view across sessions', () => {
    const TOP_HEIGHT = 255   // minimalData 的 ext = 150 × 1.7
    const loadScene = async () => {
      stubTerrainAssets({ values: [0, 0, 0, 0], zmin: 0, zmax: 0 })
      source.loadPlaybackData.mockResolvedValue(minimalData())
      const scene = createScene()
      await scene.api.loadData({ kind: 'local', file: new File(['a'], 'first.wotbreplay') })
      return scene
    }
    const loadNext = (api) => api.loadData({ kind: 'local', file: new File(['b'], 'second.wotbreplay') })

    it('opens at the top overview mode (map-center target) and repeats it while untouched', async () => {
      const { api, store } = await loadScene()
      // 俯视是持续模式：OrbitControls 接管，旋转中心 = 地图中心（不是相机）
      expect(store.cam).toBe('top')
      expect(window.__controls.enabled).toBe(true)
      expect(window.__controls.target.x).toBeCloseTo(0, 3)
      expect(window.__controls.target.z).toBeCloseTo(0, 3)
      expect(window.__camera.position.y).toBeCloseTo(TOP_HEIGHT, 3)
      await loadNext(api)
      expect(store.cam).toBe('top')
      expect(window.__camera.position.y).toBeCloseTo(TOP_HEIGHT, 3)
      expect(window.__controls.target.x).toBeCloseTo(0, 3)
      expect(window.__controls.target.z).toBeCloseTo(0, 3)
    })

    const expectPoseKept = async (api) => {
      const position = window.__camera.position.clone()
      const target = window.__controls.target.clone()
      await loadNext(api)
      expect(window.__camera.position.distanceTo(position)).toBeLessThan(1e-6)
      expect(window.__controls.target.distanceTo(target)).toBeLessThan(1e-6)
    }

    it('top-view jumps to the overhead pose and stays in working Free, unlike the persistent overview', async () => {
      const { api, store } = await loadScene()
      expect(store.cam).toBe('top')
      expect(window.__controls.enabled).toBe(true)
      api.setCam('free')
      window.__camera.position.set(10, 40, 10)
      api.setCam('top-view')
      expect(store.cam).toBe('free')
      expect(window.__controls.enabled).toBe(false)
      expect(window.__camera.position.y).toBeCloseTo(TOP_HEIGHT, 3)
      const direction = new THREE.Vector3().subVectors(window.__controls.target, window.__camera.position).normalize()
      expect(direction.y).toBeLessThan(-0.99)
      expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(true)
      api.setCam('top')
      expect(store.cam).toBe('top')
      expect(window.__controls.enabled).toBe(true)
      expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(false)
    })

    it('keyboard flight keeps the full camera pose on the next replay', async () => {
      const { api } = await loadScene()
      api.setCam('free')   // 飞行只在自由模式接管（俯视是轨道总览）
      expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(true)
      await expectPoseKept(api)
    })

    it('wheel dolly keeps the full camera pose on the next replay', async () => {
      const { api } = await loadScene()
      api.setCam('free')
      document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }))
      await settleZoomFrames()   // 预算收敛到终点后：滚轮造成的机位变化跨回放保留
      await expectPoseKept(api)
    })

    it('drag look keeps the full camera pose on the next replay', async () => {
      const { api } = await loadScene()
      api.setCam('free')
      const canvas = document.querySelector('canvas')
      canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, clientX: 100, clientY: 100 }))
      canvas.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, button: 0, buttons: 1, clientX: 160, clientY: 120 }))
      canvas.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 160, clientY: 120 }))
      await expectPoseKept(api)
    })

    it('a renderer rebuild keeps the pose and the flight heading', async () => {
      const { api } = await loadScene()
      api.setCam('free')
      expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(true)
      api.setLogdepth(true)
      try {
        await expectPoseKept(api)
        const before = window.__camera.position.clone()
        expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(true)
        expect(window.__camera.position.distanceTo(before)).toBeGreaterThan(0.01)
      } finally {
        api.setLogdepth(false)   // 偏好会持久化，不得泄漏给后续用例
      }
    })

    it('a kept pose still obeys the next map terrain floor', async () => {
      const { api } = await loadScene()
      api.setCam('free')
      expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(true)
      window.__camera.position.y = 100
      window.__controls.target.y = 90
      stubTerrainAssets({ values: [0, 0, 0, 0], zmin: 150, zmax: 150 })
      await loadNext(api)
      expect(window.__camera.position.y).toBeGreaterThanOrEqual(150.5)
    })

    it('Follow on one replay opens the next at the top overview mode', async () => {
      const { api, store } = await loadScene()
      api.setFollow(1)
      expect(store.cam).toBe('follow')
      window.__camera.position.set(40, 60, 40)
      await loadNext(api)
      expect(store.cam).toBe('top')
      expect(window.__controls.enabled).toBe(true)
      expect(window.__controls.target.x).toBeCloseTo(0, 3)
      expect(window.__controls.target.z).toBeCloseTo(0, 3)
      expect(window.__camera.position.y).toBeCloseTo(TOP_HEIGHT, 3)
      // 要飞行先切自由模式（俯视下键盘飞行不接管）
      api.setCam('free')
      expect(api.flyTick(0.1, new Set(['KeyW']))).toBe(true)
    })
  })

  it('Follow 不允许相机绕到 target 下方；已在地下的点被抬到地形净空', async () => {
    stubTerrainAssets({ values: [0, 0, 0, 0], zmin: 0, zmax: 0 })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['terrain'], 'follow-down.wotbreplay') })
    const cam = window.__camera
    const controls = window.__controls
    controls.target.set(0, 2, 0)
    cam.position.set(8, -28, 0)   // 绕到 target 水平线以下（review 复现）
    api.setCam('follow')
    expect(controls.maxPolarAngle).toBeLessThanOrEqual(Math.PI / 2)
    expect(cam.position.y).toBeGreaterThanOrEqual(0.5)
    // 真实 OrbitControls update 也不得把相机带回地下
    controls.update()
    expect(cam.position.y).toBeGreaterThanOrEqual(0.5)
  })

  it('坡面外推按新 x/z 重采样，最终相机点高于实际地形', async () => {
    const n = 64, span = 600, zmin = -50, zmax = 400
    const values = []
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const x = (c / n - 0.5) * span
        const h = 100 + 0.5 * x
        values.push(Math.round((h - zmin) / (zmax - zmin) * 65535))
      }
    }
    stubTerrainAssets({ values, zmin, zmax })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['terrain'], 'follow-slope.wotbreplay') })
    const cam = window.__camera
    const controls = window.__controls
    controls.target.set(0, 0, 0)
    cam.position.set(50, 50, 0)
    api.setCam('follow')
    // 旧实现只按 x=50 的地形一次外推到 x≈125.5，那里地面已 162.75：仍穿地。
    expect(cam.position.x).toBeGreaterThan(150)
    expect(cam.position.y).toBeGreaterThanOrEqual(100 + 0.5 * cam.position.x + 0.49)
  })

  it('坡面比射线更陡、射线无安全交点时，在相机当前 x/z 垂直抬升', async () => {
    const n = 64, span = 600, zmin = -100, zmax = 750
    const values = []
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const x = (c / n - 0.5) * span
        const h = 100 + 2 * x
        values.push(Math.round((h - zmin) / (zmax - zmin) * 65535))
      }
    }
    stubTerrainAssets({ values, zmin, zmax })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['terrain'], 'follow-steep.wotbreplay') })
    const cam = window.__camera
    const controls = window.__controls
    controls.target.set(0, 0, 0)
    cam.position.set(50, 50, 0)
    api.setCam('follow')
    expect(cam.position.x).toBeCloseTo(50, 3)   // 不沿射线外推到无地形区
    expect(cam.position.y).toBeGreaterThanOrEqual(200.49)
  })

  it('places the Free camera above the rendered triangle on a non-coplanar terrain cell', async () => {
    stubTerrainAssets({ values: [0, 65535, 65535, 0], zmin: 0, zmax: 30 })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['non-coplanar'], 'terrain-triangle-floor.wotbreplay') })
    const cam = window.__camera
    const controls = window.__controls
    const x = -150, z = -150
    const terrain = []
    window.__scene.traverse((object) => {
      if (object.geometry?.userData?.terrainBuild) terrain.push(object)
    })
    expect(terrain).toHaveLength(1)
    window.__scene.updateMatrixWorld(true)
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0))
    const renderedY = ray.intersectObject(terrain[0], false)[0]?.point.y
    const bilinearY = (0 + 30 + 30 + 0) / 4
    expect(renderedY).toBeGreaterThan(bilinearY)

    cam.position.set(x, -10, z)
    controls.target.set(x, -15, z)
    api.setCam('free')
    expect(cam.position.y).toBeCloseTo(renderedY + 0.5, 5)
  })

  it('applies the rendered-terrain floor inside a positive clipped edge quad', async () => {
    const n = 101
    stubTerrainAssets({ values: new Array(n * n).fill(0), zmin: 20, zmax: 20 })
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const { api } = createScene()
    await api.loadData({ kind: 'local', file: new File(['clipped-edge'], 'terrain-clipped-edge.wotbreplay') })
    const cam = window.__camera
    const terrain = []
    window.__scene.traverse((object) => {
      if (object.geometry?.userData?.terrainBuild) terrain.push(object)
    })
    expect(terrain).toHaveLength(1)

    // 在场景宿主里换入同一生产 builder 的远景 LOD，以确定性地产生 step=8→5 的正边裁剪 quad。
    const oldGeometry = terrain[0].geometry
    terrain[0].geometry = buildGroundGeometry({
      field: new Float32Array(n * n).fill(20), n, span: 600,
      cam: { x: 0, y: 10000, z: 0 }, fovY: (55 * Math.PI) / 180, aspect: 16 / 9,
    })
    oldGeometry.dispose()

    const i = 50, j = 98, span = 600
    const x = ((j + 0.5) / n - 0.5) * span
    const z = ((i + 0.5) / n - 0.5) * span
    const build = terrain[0].geometry.userData.terrainBuild
    const cell = i * n + j
    expect(build.sizeAt[cell]).toBeGreaterThan(0)
    expect(build.originJAt[cell]).toBe(96)
    expect(build.sizeAt[cell]).toBe(5)

    window.__scene.updateMatrixWorld(true)
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0))
    const renderedY = ray.intersectObject(terrain[0], false)[0]?.point.y
    expect(renderedY).toBeCloseTo(20, 5)
    cam.position.set(x, -10, z)
    window.__controls.target.set(x, -15, z)
    api.setCam('free')
    expect(cam.position.y).toBeCloseTo(renderedY + 0.5, 5)
  })
})

describe('scene vehicle selection intent', () => {
  it('raycast click reports selection without moving the camera into Follow', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const onVehicleSelect = vi.fn()
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'selection.wotbreplay') })
    const object = new THREE.Object3D()
    object.userData.eid = 11
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([{ object }])
    container.querySelector('canvas').setPointerCapture = vi.fn()
    container.querySelector('canvas').releasePointerCapture = vi.fn()
    const beforeCamera = window.__camera.position.clone()
    // 自由飞行接管后（2026-10-24）：选中在 pointerup 判定（≤SLOP 才算单击——
    // 按下即选会把"拖拽转头路过"的车辆选上）；右键不触发
    const canvas0 = container.querySelector('canvas')
    canvas0.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }))
    expect(onVehicleSelect).not.toHaveBeenCalled()      // down 不再立即选中
    canvas0.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 10, clientY: 10 }))
    expect(onVehicleSelect).toHaveBeenCalledOnce()
    expect(onVehicleSelect.mock.calls[0][0]).toBe(11)
    expect(onVehicleSelect.mock.calls[0][1]?.clientX).toBe(10)
    expect(store.cam).toBe('top')   // 跟随由 Pane 收到 selection 后发起，场景本身不切相机（默认俯视模式不变）
    expect(window.__camera.position.equals(beforeCamera)).toBe(true)
    canvas0.dispatchEvent(new MouseEvent('pointerdown', { button: 2 }))
    canvas0.dispatchEvent(new MouseEvent('pointerup', { button: 2 }))
    expect(onVehicleSelect).toHaveBeenCalledTimes(1)
  })

  it('空处单击上报 eid=null（宿主据此隐藏详情窗）；拖拽相机不算点击', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const onVehicleSelect = vi.fn()
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'empty.wotbreplay') })
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([])
    const canvas = container.querySelector('canvas')
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 40, clientY: 50 }))
    expect(onVehicleSelect).not.toHaveBeenCalled()
    canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 40, clientY: 50 }))
    expect(onVehicleSelect).toHaveBeenCalledOnce()
    expect(onVehicleSelect.mock.calls[0][0]).toBeNull()
    onVehicleSelect.mockClear()
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 40, clientY: 50 }))
    canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 90, clientY: 70 }))
    expect(onVehicleSelect).not.toHaveBeenCalled()
    const object = new THREE.Object3D()
    object.userData.eid = 11
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([{ object }])
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 40, clientY: 50 }))
    canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 40, clientY: 50 }))
    expect(onVehicleSelect).toHaveBeenCalledOnce()
    expect(onVehicleSelect.mock.calls[0][0]).toBe(11)
  })

  // 回归（2026-10-24 用户实测）：拖拽只改 target 不改相机朝向 ⇒ 画面不转。
  // free 模式跳过 controls.update()（它的 lookAt 是平时更新朝向的地方），
  // 必须由 flyLookApply / animate 显式 lookAt(target)。
  it('鼠标拖拽转头：相机位不动、朝向与 target 对齐', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect: vi.fn() })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'mouse-look.wotbreplay') })
    api.setCam('free')
    const canvas = container.querySelector('canvas')
    const cam = window.__camera
    const controls = window.__controls
    const cam0 = cam.position.clone()
    const dir0 = cam.getWorldDirection(new THREE.Vector3())
    const ev = (type, x, buttons) => new MouseEvent(type, { button: 0, clientX: x, clientY: 300, buttons, bubbles: true, cancelable: true })
    canvas.dispatchEvent(ev('pointerdown', 100, 1))
    canvas.dispatchEvent(ev('pointermove', 220, 1))
    const dir1 = cam.getWorldDirection(new THREE.Vector3())
    expect(cam.position.equals(cam0)).toBe(true)                 // 旋转中心 = 相机自身
    expect(dir1.angleTo(dir0)).toBeGreaterThan(0.2)              // 朝向确实转了（≈120px×0.0032）
    const toTgt = new THREE.Vector3().subVectors(controls.target, cam.position).normalize()
    expect(dir1.dot(toTgt)).toBeCloseTo(1, 3)                    // 朝向 = 看向 target
    canvas.dispatchEvent(ev('pointerup', 220, 0))
  })

  // 回归（2026-10-25 用户实测）：旧滚轮只改 flyLook.dist——target 沿视线挪、相机不动，
  // 画面毫无变化。滚轮语义 = 沿视线推拉相机（dolly）：相机与 target 同步平移，
  // 视角与视距不变；下滚后退、上滚前进。
  it('滚轮缩放：沿视线推拉相机，视角与视距不变', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect: vi.fn() })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'wheel-zoom.wotbreplay') })
    api.setCam('free')
    const canvas = container.querySelector('canvas')
    const cam = window.__camera
    const controls = window.__controls
    const aim0 = controls.target.clone().sub(cam.position).normalize()   // 飞行基准 = cam→target
    const dist0 = cam.position.distanceTo(controls.target)
    const wheel = (deltaY) => {
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY, clientX: 100, clientY: 100, bubbles: true, cancelable: true }))
    }
    const p0 = cam.position.clone()
    wheel(100)                                                   // 下滚 = 后退
    await settleZoomFrames()                                     // 预算收敛到终点（#835 平滑）
    const back = cam.position.clone().sub(p0)
    expect(back.length()).toBeGreaterThan(1)
    expect(back.dot(aim0)).toBeLessThan(0)                       // 位移沿视线反方向
    expect(cam.position.distanceTo(controls.target)).toBeCloseTo(dist0, 3)  // 视距不变
    const aim1 = controls.target.clone().sub(cam.position).normalize()
    expect(aim1.dot(aim0)).toBeCloseTo(1, 4)                     // 视角不变
    expect(cam.getWorldDirection(new THREE.Vector3()).dot(aim1)).toBeCloseTo(1, 4)  // 朝向仍对准 target
    const p1 = cam.position.clone()
    wheel(-100)                                                  // 上滚 = 前进
    await settleZoomFrames()
    expect(cam.position.clone().sub(p1).dot(aim0)).toBeGreaterThan(0)
  })

  // 回归（PR #872 review）：fly 平滑必须保持旧 flyDolly 的**可加世界位移**语义——
  // 旧即时公式：step = clamp(−Δ×0.0012, ±0.3)，一次性位移 = 事件时刻视距 × step
  // （flyDolly 平移 camera+target，视距不变）。平滑只改时间分布：终点位移与旧实现
  // 逐值一致、帧率无关、同帧相反输入精确抵消、连续同向正确累加。
  it('fly 滚轮终点位移 = 旧即时公式（+100/−100/往返/3×连续），真实 flyDolly 接线', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect: vi.fn() })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'fly-additive.wotbreplay') })
    api.setCam('free')
    const canvas = container.querySelector('canvas')
    const cam = window.__camera
    const controls = window.__controls
    // 注意：初始 fit 机位贴 maxY（topCameraDefaultHeight）且首次 wheel 会触发
    // flyLookSyncIfStale 重解朝向——先发一格「预热」滚轮完成同步并离开天花板
    // （钳制场景由既有「constrains mode entry…wheel」用例覆盖），再断言后续
    // 滚轮与旧即时公式逐值一致。
    const wheel = (deltaY) => {
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY, clientX: 100, clientY: 100, bubbles: true, cancelable: true }))
    }
    wheel(-100); await settleZoomFrames()   // 预热：同步朝向 + 离开天花板
    const dist0 = cam.position.distanceTo(controls.target)
    // 位移方向 = flyLook 视线方向（初始 top 天顶机位的 pitch 回落是既有语义，新旧实现
    // 一致），它与 target−cam 方向的偏离是进入状态，不是本次回归的对象——旧公式的
    // 可验证不变量是：位移模长 = dist×step、视距不变、同向共线（净位移 = 份额之和）。
    const expected = (deltaY) => dist0 * Math.max(-0.3, Math.min(0.3, -deltaY * 0.0012))   // 旧即时步长

    // −100 单格：前进 0.12·dist（10 FPS 泵）
    const p0 = cam.position.clone()
    wheel(-100); await settleZoomFrames()
    expect(cam.position.distanceTo(p0)).toBeCloseTo(expected(-100), 4)
    expect(cam.position.distanceTo(controls.target)).toBeCloseTo(dist0, 4)   // 视距不变

    // +100 单格：后退 0.12·dist（已离开天花板，无钳制）
    const p1 = cam.position.clone()
    wheel(100); await settleZoomFrames()
    expect(cam.position.distanceTo(p1)).toBeCloseTo(Math.abs(expected(100)), 4)

    // 往返：同帧 +100、−100 净位移为 0（预算精确抵消）
    const p2 = cam.position.clone()
    wheel(100); wheel(-100); await settleZoomFrames()
    expect(cam.position.distanceTo(p2)).toBeCloseTo(0, 4)

    // 连续同向 3 × −100：净位移 = 3 × 单次（旧语义视距不变 → 位移可加且共线）
    const p3 = cam.position.clone()
    wheel(-100); wheel(-100); wheel(-100); await settleZoomFrames()
    expect(cam.position.distanceTo(p3)).toBeCloseTo(3 * expected(-100), 3)
  })

  it('fly 滚轮位移帧率无关：60 FPS 与 10 FPS 收敛到同一终点', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect: vi.fn() })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'fly-fps.wotbreplay') })
    api.setCam('free')
    const canvas = container.querySelector('canvas')
    const cam = window.__camera
    const controls = window.__controls
    // 预热：首次 wheel 触发 flyLookSyncIfStale 重解朝向，先消耗掉再取测量基准
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 100, clientY: 100, bubbles: true, cancelable: true }))
    await settleZoomFrames()
    const dist0 = cam.position.distanceTo(controls.target)
    const expected = dist0 * Math.max(-0.3, Math.min(0.3, 100 * 0.0012))   // 前滚 −100：远离天花板
    const p0 = cam.position.clone()
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 100, clientY: 100, bubbles: true, cancelable: true }))
    await pumpZoomAt(1 / 60, 120)   // 60 FPS 逐帧推进（10 FPS 用例已锚定同一模长）
    expect(cam.position.distanceTo(p0)).toBeCloseTo(expected, 4)   // 与 10 FPS 终点一致 = 帧率无关
    expect(cam.position.distanceTo(controls.target)).toBeCloseTo(dist0, 4)
  })

  // 回归（PR #872 review）：滚轮预算在模式切换 / 销毁时必须清空，旧目标不得在新机位继续生效。
  it('fly 滚轮未收敛预算在模式切换时清零：切换后不再产生位移', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect: vi.fn() })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'fly-reset.wotbreplay') })
    api.setCam('free')
    const canvas = container.querySelector('canvas')
    const cam = window.__camera
    const wheel = (deltaY) => {
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY, clientX: 100, clientY: 100, bubbles: true, cancelable: true }))
    }
    wheel(100)   // 预算未收敛
    api.setCam('follow')
    api.setCam('free')
    const p = cam.position.clone()
    await settleZoomFrames()
    expect(cam.position.distanceTo(p)).toBeCloseTo(0, 4)
  })

  // 回归（PR #872 review）：orbit 拦截发生在 OrbitControls 收到事件之前，必须先复刻
  // three 0.185.1 _customWheelEvent 的归一化（行 ×16 / 页 ×100 / 触控板 pinch ×10，
  // 实体 Control 按键不乘），否则行/页设备与触控板捏合的实际缩放幅度都变小。
  it('orbit 滚轮保留 three 归一化：行/页/触控板 pinch/实体 Ctrl 终点倍率与 OrbitControls 一致', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect: vi.fn() })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'orbit-normalize.wotbreplay') })
    const canvas = container.querySelector('canvas')
    const cam = window.__camera
    const controls = window.__controls
    // OrbitControls 直收滚轮的终点倍率（_getZoomScale 于归一化后的 delta）
    const factorOf = (deltaY) => {
      const scale = Math.pow(0.95, controls.zoomSpeed * Math.abs(deltaY) * 0.01)
      return deltaY > 0 ? 1 / scale : scale
    }
    const wheel = (init) => {
      const e = new WheelEvent('wheel', { clientX: 100, clientY: 100, bubbles: true, cancelable: true, ...init })
      if (init.ctrlKey !== undefined) Object.defineProperty(e, 'ctrlKey', { value: init.ctrlKey })   // happy-dom 未实现 WheelEvent.ctrlKey
      canvas.dispatchEvent(e)
      return settleZoomFrames()
    }
    const expectRatio = (d0, f) => {
      expect(cam.position.distanceTo(controls.target) / d0).toBeCloseTo(f, 3)
    }

    let d0 = cam.position.distanceTo(controls.target)
    await wheel({ deltaY: 3, deltaMode: 1 })          // 行单位：×16 → 48
    expectRatio(d0, factorOf(48))

    d0 = cam.position.distanceTo(controls.target)
    await wheel({ deltaY: 2, deltaMode: 2 })          // 页单位：×100 → 200
    expectRatio(d0, factorOf(200))

    d0 = cam.position.distanceTo(controls.target)
    await wheel({ deltaY: -10, ctrlKey: true })       // 触控板 pinch：×10 → −100
    expectRatio(d0, factorOf(-100))

    d0 = cam.position.distanceTo(controls.target)
    controls._controlActive = true                    // 实体 Control 按键按下（three keydown 维护）
    await wheel({ deltaY: -10, ctrlKey: true })       // 不乘 10 → −10
    expectRatio(d0, factorOf(-10))
    controls._controlActive = false

    d0 = cam.position.distanceTo(controls.target)
    controls.enableZoom = false                       // 输入关闭态不劫持：距离不变
    await wheel({ deltaY: 100 })
    expect(cam.position.distanceTo(controls.target)).toBeCloseTo(d0, 6)
    controls.enableZoom = true
  })

  // 回归（PR #872 review）：destroy 必须解除新增的 orbit wheel capture 监听——宿主
  // （MapPreview3DPane）复用 container 重建场景时，旧闭包会残留并继续消费 wheel。
  it('destroy 摘除 orbit wheel 监听：同 container 重建后旧实例不再消费 wheel', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const container = mountContainer()
    // dispatch 目标 = container 本身：只有 scene 的 capture wheel 处理器会 preventDefault
    // （OrbitControls 的监听挂在 canvas 上，不参与；fly 处理器在 follow 模式提前返回）。
    class CountingWheelEvent extends WheelEvent {
      constructor(init) { super('wheel', init); this.preventDefaultCalls = 0 }
      preventDefault() { this.preventDefaultCalls++; super.preventDefault() }
    }
    const consumeCount = () => {
      const e = new CountingWheelEvent({ deltaY: 100, cancelable: true })
      container.dispatchEvent(e)
      return e.preventDefaultCalls
    }
    const mk = async () => {
      const store = createPlaybackStore()
      const instance = initPlayback(container, store, null, { onVehicleSelect: vi.fn() })
      created.push(instance)
      try { await instance.loadData({ kind: 'local', file: new File(['x'], 'orbit-listener.wotbreplay') }) } catch (err) { console.log('DBG3 loadData threw', err && err.message) }
      await new Promise((r) => setTimeout(r, 25))   // 场景初始化/首帧让位（同 settleZoomFrames 前置）
      return instance
    }
    let instance = await mk()
    expect(consumeCount()).toBe(1)      // 单实例：恰好一个处理器消费
    instance.destroy()
    instance = await mk()
    expect(consumeCount()).toBe(1)      // 销毁 + 重建：旧实例监听已摘除，新实例恰好一份
    instance.destroy()
    instance = await mk()
    expect(consumeCount()).toBe(1)      // 多轮创建/销毁：监听数量不增长
  })

  // 回归（2026-10-24 用户实测）：曾按 `(pointer: fine)` 决定是否接管，触屏笔记本 /
  // 平板模式报 coarse ⇒ 自由模式整条接管链失效（WASD 全灭、拖拽退回 OrbitControls）。
  // 语义改为「自由模式恒接管」，触屏手势见下方「自由视角触屏手势」。
  it('自由模式接管与指针能力无关：touch 拖拽由 fly 接管且 OrbitControls 保持关闭', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect: vi.fn() })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'touch-look.wotbreplay') })
    api.setCam('free')
    container.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 })
    const canvas = container.querySelector('canvas')
    const cam = window.__camera
    const controls = window.__controls
    const cam0 = cam.position.clone()
    const tgt0 = controls.target.clone()
    const touch = (type, x, buttons, pointerId = 7) => {
      const e = new MouseEvent(type, { button: 0, clientX: x, clientY: 300, buttons, bubbles: true, cancelable: true })
      Object.defineProperty(e, 'pointerType', { value: 'touch' })
      Object.defineProperty(e, 'pointerId', { value: pointerId })
      return e
    }
    canvas.dispatchEvent(touch('pointerdown', 100, 1))
    canvas.dispatchEvent(touch('pointermove', 180, 1))
    canvas.dispatchEvent(touch('pointermove', 240, 1))
    expect(cam.position.equals(cam0)).toBe(false)
    expect(controls.target.equals(tgt0)).toBe(false)
    expect(controls.enabled).toBe(false)
    canvas.dispatchEvent(touch('pointerup', 240, 0))
  })

  it('双指捏合：沿视线推拉相机，且手势往返精确回位（评审 P2）', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const store = createPlaybackStore()
    const container = mountContainer()
    api = initPlayback(container, store, null, { onVehicleSelect: vi.fn() })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'touch-pinch.wotbreplay') })
    api.setCam('free')
    const canvas = container.querySelector('canvas')
    const cam = window.__camera
    const controls = window.__controls
    const start = cam.position.clone()
    const dist0 = cam.position.distanceTo(controls.target)
    const aim0 = new THREE.Vector3().subVectors(controls.target, cam.position).normalize()
    const touch = (type, x, buttons, pointerId) => {
      const e = new MouseEvent(type, { button: 0, clientX: x, clientY: 300, buttons, bubbles: true, cancelable: true })
      Object.defineProperty(e, 'pointerType', { value: 'touch' })
      Object.defineProperty(e, 'pointerId', { value: pointerId })
      return e
    }
    const frame = stubFrames()
    // 一次完整手势：两指走够判定距离后基准指距 200px，依次移动到 xs（第二指），再回到 200px 收势
    const gesture = (xs) => {
      canvas.dispatchEvent(touch('pointerdown', 100, 1, 7))
      canvas.dispatchEvent(touch('pointerdown', 280, 1, 9))
      canvas.dispatchEvent(touch('pointermove', 300, 1, 9))
      frame()                                                 // 判定为捏合：指距 200px（= d0）
      for (const x of xs) canvas.dispatchEvent(touch('pointermove', x, 1, 9))
      canvas.dispatchEvent(touch('pointerup', 300, 0, 9))
      canvas.dispatchEvent(touch('pointerup', 100, 0, 7))
    }
    // 分开 → 推近；回到原指距 → 精确回位（不是 25% 前进 / 20% 后退的漂移）
    gesture([350, 300])
    expect(cam.position.distanceTo(start)).toBeCloseTo(0, 4)
    // 同一手势拆成更多 pointermove：结果一致
    gesture([325, 350, 300])
    expect(cam.position.distanceTo(start)).toBeCloseTo(0, 4)
    // 大间距（触发 ±0.5 单事件上限）同样可逆
    gesture([500, 300])
    expect(cam.position.distanceTo(start)).toBeCloseTo(0, 4)
    // 中途分开时确实沿视线前进，且视距/视角不变
    const p0 = cam.position.clone()
    gesture([350])
    expect(cam.position.clone().sub(p0).dot(aim0)).toBeGreaterThan(0.5)
    expect(cam.position.distanceTo(controls.target)).toBeCloseTo(dist0, 3)
    const aim1 = new THREE.Vector3().subVectors(controls.target, cam.position).normalize()
    expect(aim1.dot(aim0)).toBeCloseTo(1, 4)
    // 补一个完整往返：从当前位置分开再收回，精确回位（相对该手势起点）
    const pForward = cam.position.clone()
    gesture([350, 300])
    expect(cam.position.distanceTo(pForward)).toBeCloseTo(0, 4)
    // 单事件触限 + 回程分批：指距 200→350（比例 0.75 → 累计目标钳 0.5）→275→200
    // （第二指 x = 指距 + 100；d0 = 200px）
    const pBefore = cam.position.clone()
    gesture([450, 375, 300])
    expect(cam.position.distanceTo(pBefore)).toBeCloseTo(0, 4)
    // 同一端点、不同分批 ⇒ 相同位移（不能按单次增量截断）
    const base = cam.position.clone()
    gesture([450])                                  // 一次到指距 350（比例 0.75 → 钳 0.5）
    const oneShot = cam.position.clone().sub(base)
    expect(oneShot.length()).toBeGreaterThan(1)
    gesture([200])                                  // 反向到指距 100（-0.5）⇒ 精确回位
    expect(cam.position.distanceTo(base)).toBeCloseTo(0, 4)
    gesture([375, 450])                             // 分两步到同一指距 350
    const split = cam.position.clone().sub(base)
    expect(split.distanceTo(oneShot)).toBeCloseTo(0, 4)
  })
})

