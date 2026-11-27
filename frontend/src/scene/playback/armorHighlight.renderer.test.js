import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'
import { createArmorHighlight } from './armorHighlight.js'
const AP = { type: 'ap', penetration: 200, caliber: 100 }

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    parse(_bytes, _path, done) {
      const model = new THREE.Group()
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 6), new THREE.MeshBasicMaterial())
      mesh.name = 'hull_armor_1'
      model.add(mesh)
      done({ scene: model })
    }
  },
}))

function highlightFixture() {
  let currentTarget = null, scissorTest = false, alpha = 1
  const scissor = new THREE.Vector4(3, 4, 50, 60)
  const viewport = new THREE.Vector4(1, 2, 300, 400)
  const color = new THREE.Color(0x123456)
  const renderer = {
    autoClear: true, localClippingEnabled: false, shadowMap: { autoUpdate: true },
    info: { render: { calls: 0 } }, extensions: { has: () => false },
    getDrawingBufferSize: out => out.set(800, 600), getPixelRatio: () => 2,
    getClearAlpha: () => alpha, getClearColor: out => out.copy(color),
    getScissorTest: () => scissorTest, getScissor: out => out.copy(scissor),
    getViewport: out => out.copy(viewport), setViewport: v => viewport.copy(v),
    getRenderTarget: () => currentTarget,
    setClearColor: (c, a) => { color.set(c); alpha = a },
    setScissorTest: v => { scissorTest = v },
    setScissor: vi.fn((...v) => { if (v[0]?.isVector4) scissor.copy(v[0]); else scissor.set(...v) }),
    setRenderTarget: vi.fn(target => { currentTarget = target }),
    clearDepth: vi.fn(), compile: vi.fn(),
    render: vi.fn(() => { renderer.info.render.calls++ }),
  }
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 1000)
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true)
  const glb = new THREE.Group()
  const targetMesh = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 6), new THREE.MeshBasicMaterial())
  glb.add(targetMesh); glb.position.z = -50; scene.add(glb); scene.updateMatrixWorld(true)
  const vehicle = { glb, def: { eid: 1, tank_id: 1 }, glbParts: { poseT: new THREE.Matrix4(), poseG: new THREE.Matrix4() } }
  const ready = vi.fn()
  const frame = { scene, camera, vehicle, tankData: { model_url: 'fixture', model_origins: { track: [0, 0, 0], turret: [0, 0, 0] } }, config: {}, shell: AP, caliber: 100, penMul: 1, thickMul: 1, onReady: ready, occluderRoots: [glb] }
  const effect = createArmorHighlight({ renderer, assetProvider: { bytes: async () => new Uint8Array() } })
  return { scene, camera, glb, renderer, effect, frame, ready, scissor, color, viewport }
}

async function readyHighlight(f) {
  f.effect.render(f.frame)
  for (let i = 0; i < 10 && !f.ready.mock.calls.length; i++) await Promise.resolve()
  expect(f.ready).toHaveBeenCalledTimes(1)
}

describe('armor renderer execution', () => {
  it('skips world render for only the target and retains wall/vehicle occluders', async () => {
    const f = highlightFixture()
    await readyHighlight(f)
    f.effect.render(f.frame)
    expect(f.renderer.render.mock.calls.filter(([scene]) => scene === f.scene)).toHaveLength(0)
    const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 2), new THREE.MeshBasicMaterial())
    wall.position.z = -20; f.scene.add(wall); f.scene.updateMatrixWorld(true)
    f.frame.occluderRoots = [f.glb, wall]
    f.renderer.render.mockClear()
    f.effect.render(f.frame)
    expect(f.renderer.render.mock.calls.filter(([scene]) => scene === f.scene)).toHaveLength(1)
    expect(f.glb.children[0].layers.mask & (1 << 2)).toBe(0)
    expect(wall.layers.mask & (1 << 2)).not.toBe(0)
    const moving = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
    moving.position.set(500, 0, -20); moving.frustumCulled = false
    f.scene.add(moving); f.scene.updateMatrixWorld(true)
    f.frame.occluderRoots = [f.glb, moving]
    f.renderer.render.mockClear()
    f.effect.render(f.frame)
    expect(f.renderer.render.mock.calls.filter(([scene]) => scene === f.scene)).toHaveLength(1)
    expect(moving.layers.mask & (1 << 2)).not.toBe(0)
    f.effect.dispose()
  })

  it('maps the cropped projection to logical scissor coordinates at DPR 2', async () => {
    const f = highlightFixture()
    await readyHighlight(f)
    let view
    f.renderer.render.mockImplementation((_scene, camera) => {
      if (camera !== f.camera && !view) view = { ...camera.view }
    })
    f.effect.render(f.frame)
    expect(view.enabled).toBe(true)
    const rect = f.renderer.setScissor.mock.calls.find(args => args.length === 4)
    expect(rect).toEqual([view.offsetX / 2, (view.fullHeight - view.offsetY - view.height) / 2, view.width / 2, view.height / 2])
    f.effect.dispose()
  })

  it('tracks independent render calls and GPU hooks, clearing stale counts on early return', async () => {
    const f = highlightFixture()
    const stats = { pickMs: 0, stateMs: 9, thicknessMs: 9, occluderMs: 9, colorMs: 9, calls: 9, stateCalls: 9, thicknessCalls: 9, occluderCalls: 9, colorCalls: 9, _t0: 0 }
    const gpu = { begin: vi.fn(() => true), end: vi.fn() }
    f.frame.stats = stats; f.frame.gpu = gpu
    await readyHighlight(f)
    expect([stats.stateCalls, stats.thicknessCalls, stats.occluderCalls, stats.colorCalls, stats.calls]).toEqual([0, 0, 0, 0, 0])
    f.effect.render(f.frame)
    expect([stats.stateCalls, stats.thicknessCalls, stats.occluderCalls, stats.colorCalls, stats.calls]).toEqual([1, 1, 0, 1, 3])
    expect(gpu.begin.mock.calls.map(([pass]) => pass)).toEqual(['state', 'thickness', 'color'])
    expect(gpu.end).toHaveBeenCalledTimes(3)
    const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 2), new THREE.MeshBasicMaterial())
    wall.position.z = -20; f.scene.add(wall); f.scene.updateMatrixWorld(true)
    f.frame.occluderRoots = [wall]
    gpu.begin.mockClear(); gpu.end.mockClear()
    f.effect.render(f.frame)
    expect([stats.stateCalls, stats.thicknessCalls, stats.occluderCalls, stats.colorCalls, stats.calls]).toEqual([1, 1, 1, 1, 4])
    expect(gpu.begin.mock.calls.map(([pass]) => pass)).toEqual(['state', 'thickness', 'occluder', 'color'])
    expect(gpu.end).toHaveBeenCalledTimes(4)
    f.glb.position.x = 1000; f.scene.updateMatrixWorld(true)
    f.effect.render(f.frame)
    expect([stats.stateCalls, stats.thicknessCalls, stats.occluderCalls, stats.colorCalls, stats.calls]).toEqual([0, 0, 0, 0, 0])
    f.effect.dispose()
  })

  it('allocates bucketed targets, grows for a closer view, and releases each once', async () => {
    const f = highlightFixture()
    const stats = { pickMs: 0, stateMs: 0, thicknessMs: 0, occluderMs: 0, colorMs: 0, calls: 0, stateCalls: 0, thicknessCalls: 0, occluderCalls: 0, colorCalls: 0, _t0: 0 }
    f.frame.stats = stats
    await readyHighlight(f)
    f.effect.render(f.frame)
    const original = f.renderer.setRenderTarget.mock.calls.map(([rt]) => rt).filter(Boolean)
    expect(original).toHaveLength(2)
    expect(original[0].width % 64).toBe(0)
    expect(original[0].height % 64).toBe(0)
    expect(stats.rt).toEqual({ width: original[0].width, height: original[0].height, creates: 2, resizes: 0, disposes: 0,
      colorEstimateBytes: original[0].width * original[0].height * 2 * 4, estimateKind: 'color-only-estimate' })
    const oldDispose = original.map(rt => { const fn = vi.fn(); rt.addEventListener('dispose', fn); return fn })
    f.glb.position.z = -10; f.scene.updateMatrixWorld(true)
    f.renderer.setRenderTarget.mockClear()
    f.effect.render(f.frame)
    const resized = f.renderer.setRenderTarget.mock.calls.map(([rt]) => rt).filter(Boolean)
    expect(resized).toHaveLength(2)
    expect(resized[0].width).toBeGreaterThan(original[0].width)
    expect(oldDispose.map(fn => fn.mock.calls.length)).toEqual([1, 1])
    expect(stats.rt).toMatchObject({ width: resized[0].width, height: resized[0].height, creates: 4, resizes: 2, disposes: 2 })
    const newDispose = resized.map(rt => { const fn = vi.fn(); rt.addEventListener('dispose', fn); return fn })
    f.glb.position.z = -50; f.scene.updateMatrixWorld(true)
    for (let i = 0; i < 89; i++) f.effect.render(f.frame)
    expect(newDispose.map(fn => fn.mock.calls.length)).toEqual([0, 0])
    f.renderer.setRenderTarget.mockClear()
    f.effect.render(f.frame)
    expect(newDispose.map(fn => fn.mock.calls.length)).toEqual([1, 1])
    const shrunk = f.renderer.setRenderTarget.mock.calls.map(([rt]) => rt).filter(Boolean)
    expect(shrunk[0].width).toBeLessThan(resized[0].width)
    expect(stats.rt).toMatchObject({ width: shrunk[0].width, height: shrunk[0].height, creates: 6, resizes: 4, disposes: 4 })
    const shrunkDispose = shrunk.map(rt => { const fn = vi.fn(); rt.addEventListener('dispose', fn); return fn })
    f.effect.releaseRenderTargets(); f.effect.releaseRenderTargets()
    expect(shrunkDispose.map(fn => fn.mock.calls.length)).toEqual([1, 1])
    expect(stats.rt).toMatchObject({ width: null, height: null, colorEstimateBytes: null, creates: 6, resizes: 4, disposes: 6 })
    f.effect.dispose()
  })

  it('does not notify or render when template bytes arrive after dispose', async () => {
    const f = highlightFixture()
    f.effect.dispose()
    let finish
    const effect = createArmorHighlight({ renderer: f.renderer, assetProvider: { bytes: () => new Promise(resolve => { finish = resolve }) } })
    effect.render(f.frame)
    effect.dispose()
    finish(new Uint8Array())
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(f.ready).not.toHaveBeenCalled()
    expect(f.renderer.render).not.toHaveBeenCalled()
  })

  it('prewarms once and restores clipping', () => {
    const f = highlightFixture()
    f.effect.prewarm(f.camera); f.effect.prewarm(f.camera)
    expect(f.renderer.compile).toHaveBeenCalledTimes(1)
    expect(f.renderer.localClippingEnabled).toBe(false)
    f.effect.dispose()
  })

  it('repeated dispose releases prewarmed materials once', () => {
    const f = highlightFixture()
    const disposed = []
    f.renderer.compile.mockImplementation(scene => scene.traverse(node => {
      if (node.isMesh) { const fn = vi.fn(); node.material.addEventListener('dispose', fn); disposed.push(fn) }
    }))
    f.effect.prewarm(f.camera)
    expect(disposed.length).toBeGreaterThan(0)
    f.effect.dispose(); f.effect.dispose()
    expect(disposed.every(fn => fn.mock.calls.length === 1)).toBe(true)
  })

  it('restores renderer and scene state after an occluder pass throws', async () => {
    const f = highlightFixture()
    await readyHighlight(f)
    const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 2), new THREE.MeshBasicMaterial())
    wall.position.z = -20; f.scene.add(wall); f.scene.updateMatrixWorld(true)
    f.frame.occluderRoots = [wall]
    const bg = new THREE.Color('red'); f.scene.background = bg
    const oldTarget = new THREE.WebGLRenderTarget(16, 16)
    f.renderer.setRenderTarget(oldTarget)
    const originalMask = f.camera.layers.mask
    const gpu = { begin: vi.fn(() => true), end: vi.fn() }
    f.frame.gpu = gpu
    f.renderer.render.mockImplementation((scene) => { if (scene === f.scene) throw new Error('render failed') })
    expect(() => f.effect.render(f.frame)).toThrow('render failed')
    expect(gpu.begin.mock.calls.map(([pass]) => pass)).toEqual(['state', 'thickness', 'occluder'])
    expect(gpu.end).toHaveBeenCalledTimes(3)
    expect(f.scene.background).toBe(bg)
    expect(f.scene.overrideMaterial).toBeNull()
    expect(f.camera.layers.mask).toBe(originalMask)
    expect(f.renderer.getRenderTarget()).toBe(oldTarget)
    expect(f.renderer.getScissorTest()).toBe(false)
    expect(f.scissor.toArray()).toEqual([3, 4, 50, 60])
    expect(f.viewport.toArray()).toEqual([1, 2, 300, 400])
    expect(f.renderer.localClippingEnabled).toBe(false)
    expect(f.renderer.shadowMap.autoUpdate).toBe(true)
    expect(f.renderer.autoClear).toBe(true)
    expect(f.color.getHex()).toBe(0x123456)
    f.effect.dispose(); oldTarget.dispose()
  })
})
