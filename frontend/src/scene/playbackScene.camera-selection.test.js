// @vitest-environment happy-dom
// 自由相机地形边界回归（拆分自 playbackScene.test.js；共享装配见 playbackScene.test.setup.js）。
import { describe, expect, it, vi } from 'vitest'
import { installSceneTestSetup, minimalData } from './playbackScene.test.setup.js'

const source = vi.hoisted(() => ({ loadPlaybackData: vi.fn(), loadRecorderCameraFromFile: vi.fn(), resolveMapKey: vi.fn(), mapStaticUrl: vi.fn(), tankNamesStatic: vi.fn(async () => new Map()) }))
vi.mock('./replaySource.js', () => ({
  loadPlaybackData: source.loadPlaybackData,
  loadRecorderCameraFromFile: source.loadRecorderCameraFromFile,
  resolveMapKey: source.resolveMapKey,
  tankNamesStatic: source.tankNamesStatic,
  mapStaticUrl: source.mapStaticUrl,
}))

/**
 * 渲染器 stub：happy-dom 没有 WebGL，initScene() 里的 new THREE.WebGLRenderer() 必然抛错，
 * 于是 startPlayback() 在第一个写入之前就失败。只替换 WebGLRenderer，其余 three 保持真实实现。
 */
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal()
  class StubWebGLRenderer {
    constructor(params = {}) {
      this.params = params
      this.domElement = document.createElement('canvas')
      this.toneMapping = 0
      this.toneMappingExposure = 1
      this.shadowMap = { enabled: false }
      this.capabilities = { getMaxAnisotropy: () => 8 }
      this.info = { autoReset: true, reset() {}, render: { calls: 0 } }
    }
    setSize(w, h) { this.size = { width: w, height: h } }
    getSize(v) { v.set(this.size?.width ?? 800, this.size?.height ?? 600); return v }
    getDrawingBufferSize(v) { return this.getSize(v) }
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

let api = null
const created = []
const pending = []

const { stubTerrainAssets, createScene } = installSceneTestSetup({
  source,
  muzzleTip: { reach: 0 },
  state: {
    get api() { return api },
    set api(value) { api = value },
    created,
    pending,
  },
})
describe('Free Camera terrain floor', () => {




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



  // 回归（用户要求）：默认俯视视角的**旋转中心 = 地图中心**，不是相机。
  // 锁两件事：① target 钉在地图中心；② 绕转后 target 不随相机移动（OrbitControls 轨道语义），
  // 且极角上限仍挡在地平线以上。此前曾被改成「一次性动作 + 落进 free」，free 的 flyLook 把
  // target 重钉到 cam + dir×dist（旋转中心变成相机）。













})

