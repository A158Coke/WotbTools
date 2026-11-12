// mapWorld 行为测试（#827 接替 sceneryMaterials.test.js 的 :391/:260/:354 源码守卫）：
// - :391 占位地面/网格不参与绘制（对象保留入 scene——拾取过滤/bbox 拟合按引用走）；
// - :260 逐图 IBL：Equirect + SRGB + environmentIntensity；dispose 摘环境并释放纹理；
// - :354 逐图太阳：lighting.json 驱动方向（position = −传播方向）/强度/半球环境色；
//   缺失 → 保留兜底灯光。
// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import * as THREE from 'three'

// 资产面/地形段 I/O 全部替身化：mapStaticUrl 按测试编排返回 URL
const urls = vi.hoisted(() => ({ map: {} as Record<string, string> }))
vi.mock('./replaySource.js', () => ({
  mapStaticUrl: (type: string) => urls.map[type] ?? null,
  resolveMapKey: vi.fn(async () => 'malinovka'),
}))
const provider = vi.hoisted(() => ({
  fetch: vi.fn(),
  json: vi.fn(async () => null),
  bytes: vi.fn(async () => new ArrayBuffer(0)),
  configured: () => true,
}))
vi.mock('./assetProvider.js', () => ({ assetProvider: provider }))
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    load(_url: string, _onLoad: unknown, _onProgress: unknown, onError: (e: unknown) => void) {
      onError?.(new Error('stub: no scenery'))
    }
  },
}))
vi.mock('./groundPass.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    loadTerrain: vi.fn(async () => ({ field: new Float32Array(64).fill(2), meta: { size: 8, span: 600, terrainLayout: 2 }, metaStatus: 200, binStatus: 200 })),
    buildGroundGeometry: vi.fn(() => new THREE.BufferGeometry()),
    makeGroundMaterial: vi.fn(() => new THREE.MeshBasicMaterial()),
    groundLayerKeys: vi.fn(() => []),
    setupGroundTextures: vi.fn(),
  }
})
// TextureLoader 替身：IBL 走 blob URL + 图片解码（happy-dom 无法真实解码）→ 直接回 Texture
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  class TextureLoaderStub {
    loadAsync(): Promise<THREE.Texture> { return Promise.resolve(new (actual as unknown as typeof import('three')).Texture()) }
  }
  return { ...actual, TextureLoader: TextureLoaderStub }
})

import { createPerf } from './playback/perf.js'
import { createMapWorld } from './playback/mapWorld.js'
import type { MapWorldDeps } from './playback/mapWorld.js'

// 逐图太阳 fixture（方向未归一：Core 内按 ‖d‖ 归一）
const LIGHTING = {
  sun: {
    color: [0.4, 0.5, 0.7],
    intensity: 4.0,
    ambient: [0.9, 0.9, 1.0],
    direction_scene: [-0.4860337760940354, -0.6871515920696455, 0.5399943129446455],
  },
  ibl: { 'ibl.environmentMultiplier': 1.6 },
}

function makeWorld() {
  const perfHandle = createPerf({ now: () => 0 })
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 4000)
  const sunLight = new THREE.DirectionalLight(0xffffff, 3)
  sunLight.target = new THREE.Object3D()
  const hemiLight = new THREE.HemisphereLight(0xbfd4e8, 0x2a2f36, 2.4)
  const deps: MapWorldDeps = {
    store: { mapKey: null, assetProgress: null, assetIssues: [], assetDegraded: false },
    debug: false,
    perf: () => perfHandle,
    sessionEpoch: () => 1,
    destroyed: () => false,
    getData: () => ({ meta: { map_id: 6 }, vehicles: [] }),
    quality: () => ({ anisotropy: 1, scenery: false, groundLayers: false }),
    getScene: () => scene,
    getCamera: () => camera,
    getRenderer: () => null,
    getControls: () => ({ target: new THREE.Vector3() }),
    invalidate: vi.fn(),
    disposeObject3D: vi.fn(),
    constrainFreeCameraAltitude: vi.fn(),
    regroundBases: vi.fn(),
    regroundSpawns: vi.fn(),
    rebuildAnnotationProjection: vi.fn(),
    lightingTargets: () => ({ renderer: { toneMappingExposure: 1.0 } as never, scene, sunLight, hemiLight, debug: false }),
    buildWorldCameraPlacement: vi.fn(),
    scopedHiddenEid: () => 0,
    reprojectAnnotationHeights: vi.fn(),
    onTerrainReground: vi.fn(),
    onLightingApplied: vi.fn(),
  }
  const handle = createMapWorld(deps, { build: vi.fn(), clear: vi.fn() })
  return { handle, deps, scene, sunLight, hemiLight }
}

beforeEach(() => {
  urls.map = {}
  provider.fetch.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe(':391 占位地面与占位网格（空图）', () => {
  it('对象保留入 scene（拾取过滤/bbox 拟合按引用走），但都不参与绘制', () => {
    const { handle, scene } = makeWorld()
    handle.buildWorld()
    expect(handle.groundMesh()).not.toBeNull()
    expect(handle.gridHelper()).not.toBeNull()
    expect(scene.children).toContain(handle.groundMesh())
    expect(scene.children).toContain(handle.gridHelper())
    expect(handle.groundMesh()!.visible).toBe(false)   // 深色底板盖住水 alpha
    expect(handle.gridHelper()!.visible).toBe(false)   // y=0.02 蓝灰线压在水面之上
    handle.dispose()
  })
})

describe(':354 逐图太阳（lighting.json 驱动）', () => {
  it('方向/强度/半球环境色按 authored；缺失 → 保留兜底灯光', async () => {
    const { handle, sunLight, hemiLight } = makeWorld()
    urls.map = { lighting: 'http://assets/lighting.json' }
    provider.fetch.mockResolvedValue({ ok: true, json: async () => LIGHTING })
    await handle.loadMapImage()
    const d = LIGHTING.sun.direction_scene
    const n = Math.hypot(...d)
    // 客户端给"传播方向"，three 的方向光从 position 射向 target ⇒ position = −方向
    expect(sunLight.position.x).toBeCloseTo(-d[0] / n * 1000, 3)
    expect(sunLight.position.y).toBeCloseTo(-d[1] / n * 1000, 3)
    expect(sunLight.position.z).toBeCloseTo(-d[2] / n * 1000, 3)
    expect(sunLight.intensity).toBe(4.0)
    expect(sunLight.color.r).toBeCloseTo(0.4, 5)
    expect(hemiLight.color.r).toBeCloseTo(0.9, 5)
    handle.dispose()

    // 缺失（404/未配置）：不阻断、保留兜底灯光
    const { handle: h2, sunLight: sun2 } = makeWorld()
    urls.map = {}
    await h2.loadMapImage()
    expect(sun2.intensity).toBe(3)   // 创建时的兜底值未被改写
    h2.dispose()
  })
})

describe(':260 逐图 IBL（等距柱状环境贴图 + 会话释放）', () => {
  it('加载：scene.environment = Equirect + SRGB + environmentIntensity；dispose：摘环境 + dispose 纹理', async () => {
    const { handle, scene, deps } = makeWorld()
    urls.map = { lighting: 'http://assets/lighting.json', ibl: 'http://assets/ibl.webp' }
    provider.fetch.mockImplementation((u: string) => {
      if (u === 'http://assets/ibl.webp') {
        return Promise.resolve({ ok: true, blob: async () => new Blob(['x']) })
      }
      return Promise.resolve({ ok: true, json: async () => LIGHTING })
    })
    const prevCreate = URL.createObjectURL
    const prevRevoke = URL.revokeObjectURL
    URL.createObjectURL = () => 'blob:stub' as unknown as string
    URL.revokeObjectURL = () => {}
    const disposeSpy = vi.spyOn(THREE.Texture.prototype, 'dispose')
    await handle.loadMapImage()
    const tex = handle.envTexture()
    expect(tex).not.toBeNull()
    expect(scene.environment).toBe(tex)                       // 场景已创建 → 立即挂
    expect(scene.environmentIntensity).toBeCloseTo(1.6 / (3 / 4), 5)   // authored / expo（高太阳图 IBL 随输出曝光归一）
    expect(tex!.mapping).toBe(THREE.EquirectangularReflectionMapping)
    expect(tex!.colorSpace).toBe(THREE.SRGBColorSpace)
    URL.createObjectURL = prevCreate
    URL.revokeObjectURL = prevRevoke
    // 会话拆除：先摘环境再 dispose（PMREM 缓存随纹理释放），下一图拿新纹理
    const before = disposeSpy.mock.calls.length
    handle.dispose()
    expect(scene.environment).toBeNull()
    expect(handle.envTexture()).toBeNull()
    expect(disposeSpy.mock.calls.length).toBe(before + 1)
    disposeSpy.mockRestore()
  })
})
