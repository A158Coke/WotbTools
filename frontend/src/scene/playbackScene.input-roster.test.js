// @vitest-environment happy-dom
// 场景容器尺寸与地面贴图契约（拆分自 playbackScene.test.js；共享装配见 playbackScene.test.setup.js）。
import { describe, expect, it, vi } from 'vitest'
import { createPlaybackStore } from './playbackStore.js'
import { initPlayback } from './playbackScene.js'
import { PLAYBACK_SCENE_SOURCE } from './playbackScene.test.source.js'
import { installSceneTestSetup, minimalData, mountContainer } from './playbackScene.test.setup.js'

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

let api = null
const created = []
const pending = []

installSceneTestSetup({
  source,
  muzzleTip: { reach: 0 },
  state: {
    get api() { return api },
    set api(value) { api = value },
    created,
    pending,
  },
})
describe('scene container geometry', () => {
  it('resizes projection and canvas on container changes and disconnects on destroy', async () => {
    let onSize
    const disconnect = vi.fn()
    const observe = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { onSize = callback }
      observe = observe
      disconnect = disconnect
    })
    try {
      source.loadPlaybackData.mockResolvedValue(minimalData())
      const container = mountContainer()
      Object.defineProperty(container, 'clientWidth', { configurable: true, value: 800 })
      Object.defineProperty(container, 'clientHeight', { configurable: true, value: 600 })
      const store = createPlaybackStore()
      api = initPlayback(container, store)
      created.push(api)
      await api.loadData({ kind: 'local', file: new File(['x'], 'size.wotbreplay') })
      expect(observe).toHaveBeenCalledWith(container)
      const setSize = vi.spyOn(window.__renderer, 'setSize')
      Object.defineProperty(container, 'clientHeight', { configurable: true, value: 700 })
      onSize()
      expect(setSize).toHaveBeenCalledWith(800, 700)
      expect(window.__camera.aspect).toBe(800 / 700)
      api.destroy()
      expect(disconnect).toHaveBeenCalledTimes(1)
      created.length = 0
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('画质四档阶梯契约（2026-10-07 重分档）', () => {


  it('地面贴图四档统一用契约化的 `map`（ground.webp）；客户端 HUD 小地图不再进地面链路', async () => {
    // 2026-10-16 用户裁定（以 ±300 为准）：客户端小地图覆盖约 620 m、多出外围一圈，按 600 m 铺
    // 会压缩内容约 3% 并把圈外内容摊进边界 ⇒ 地面链路（含最低档）只认 ground.webp。
    const src = PLAYBACK_SCENE_SOURCE
    expect(src).not.toMatch(/map-mini/)
    expect(src).not.toMatch(/miniMap/)
    // #820 Step 2：地面链路 owner = playback/mapWorld.ts（四档统一 ground.webp）
    const worldSrc = (await import('./playback/mapWorldLoader.ts?raw')).default
    expect(worldSrc).not.toMatch(/map-mini/)
    expect(worldSrc).toMatch(/const mapUrl = mapStaticUrl\('map', undefined, resolvedKey\);/)
    const replay = (await import('./replaySource.js?raw')).default
    expect(replay).not.toMatch(/map-mini/)
  })
})

