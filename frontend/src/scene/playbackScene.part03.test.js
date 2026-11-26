// @vitest-environment happy-dom
// @vitest-environment happy-dom
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

import { normalizePenPoints } from './playback/annotation3d.js'


const source = vi.hoisted(() => ({ loadPlaybackData: vi.fn(), loadRecorderCameraFromFile: vi.fn(), resolveMapKey: vi.fn(), mapStaticUrl: vi.fn(), tankNamesStatic: vi.fn(async () => new Map()) }))

vi.mock('./replaySource.js', () => ({
  loadPlaybackData: source.loadPlaybackData,
  loadRecorderCameraFromFile: source.loadRecorderCameraFromFile,
  resolveMapKey: source.resolveMapKey,
  tankNamesStatic: source.tankNamesStatic,
  mapStaticUrl: source.mapStaticUrl,
}))


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

import { buildGroundGeometry } from './groundPass.js'

import { ANNOTATION_LIFT } from './playback/annotation3d.js'

import { BURST_SECS, FX_BUDGETS } from './battleFx.ts'


function minimalData(tStart = 42, mapName = 'probe_map') {
  return {
    meta: { map_id: 1, map_name: mapName, t_start: tStart, friendly_team: 1 },
    vehicles: [], shots: [], kills: [], reloads: [], reload_effective: [], supremacy_points: new Map(),
    periods: [], supremacy_bases: [],
  }
}


function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}


function mountContainer() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}


let api = null

let created = []

let pending = []


function track(d) {
  pending.push(d)
  return d
}


beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('unit tests run without network'))))
  vi.spyOn(assetProvider, 'fetch').mockImplementation((...args) => fetch(...args))
  source.loadPlaybackData.mockReset()
  source.loadRecorderCameraFromFile.mockReset()
  source.loadRecorderCameraFromFile.mockResolvedValue(null)
  source.resolveMapKey.mockReset()
  source.mapStaticUrl.mockReset()
  source.mapStaticUrl.mockReturnValue(null)
  window.history.replaceState(null, '', '/?debug&q=low')
  source.loadPlaybackData.mockImplementation(() => new Promise(() => {}))
  source.resolveMapKey.mockImplementation(() => Promise.resolve(null))
  api = null
  created = []
  pending = []
})


afterEach(async () => {
  for (const d of pending) { try { d.resolve(null) } catch (_) {} }
  for (let i = 0; i < 8; i++) await Promise.resolve()
  for (const instance of created) { try { instance?.destroy?.() } catch (_) {} }
  api = null
  created = []
  pending = []
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  muzzleTip.reach = 0
  window.history.replaceState(null, '', '/')
})


function stubTerrainAssets({ values = [0, 65535, 0, 65535], zmin = 0, zmax = 30 } = {}) {
  const size = Math.sqrt(values.length)
  if (!Number.isInteger(size)) throw new Error('terrain test values must form a square heightfield')
  source.resolveMapKey.mockResolvedValue('probe_map')
  source.mapStaticUrl.mockImplementation((kind) => ['terrain', 'terrain-meta'].includes(kind) ? `/assets/${kind}` : null)
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).endsWith('terrain-meta')) return {
      ok: true,
      status: 200,
      json: async () => ({
        size, span: 600, zmin, zmax, terrainLayout: 2,
        worldBounds: { min: [-300, -300, zmin], max: [300, 300, zmax] },
      }),
    }
    if (String(url).endsWith('/terrain')) return {
      ok: true, status: 200, arrayBuffer: async () => new Uint16Array(values).buffer,
    }
    return { ok: false, status: 404 }
  }))
}


function stubFrames() {
  const frames = []
  vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  return () => { for (const cb of frames.splice(0)) cb() }
}


let zoomPump = null

async function settleZoomFrames() {
  vi.spyOn(THREE.Clock.prototype, 'getDelta').mockReturnValue(0.1)
  if (!zoomPump || globalThis.requestAnimationFrame !== zoomPump.stub) {
    const frame = stubFrames()
    zoomPump = { stub: globalThis.requestAnimationFrame, frame }
    await new Promise((r) => setTimeout(r, 25))
  }
  for (let i = 0; i < 17; i++) zoomPump.frame()
}


async function pumpZoomAt(dt, frames) {
  vi.spyOn(THREE.Clock.prototype, 'getDelta').mockReturnValue(dt)
  if (!zoomPump || globalThis.requestAnimationFrame !== zoomPump.stub) {
    const frame = stubFrames()
    zoomPump = { stub: globalThis.requestAnimationFrame, frame }
    await new Promise((r) => setTimeout(r, 25))
  }
  for (let i = 0; i < frames; i++) zoomPump.frame()
}


function stubCanvas2d() {
  const ctx = new Proxy({}, { get: () => () => {} })
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx)
}


function createScene(existingStore = null) {
  const store = existingStore ?? createPlaybackStore()
  api = initPlayback(mountContainer(), store)
  created.push(api)
  return { store, api }
}


function createInstance(store) {
  const instance = initPlayback(mountContainer(), store)
  created.push(instance)
  api = instance
  return instance
}
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
    const canvas0 = container.querySelector('canvas')
    canvas0.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }))
    expect(onVehicleSelect).not.toHaveBeenCalled()
    canvas0.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 10, clientY: 10 }))
    expect(onVehicleSelect).toHaveBeenCalledOnce()
    expect(onVehicleSelect.mock.calls[0][0]).toBe(11)
    expect(onVehicleSelect.mock.calls[0][1]?.clientX).toBe(10)
    expect(store.cam).toBe('top')
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
    expect(cam.position.equals(cam0)).toBe(true)
    expect(dir1.angleTo(dir0)).toBeGreaterThan(0.2)
    const toTgt = new THREE.Vector3().subVectors(controls.target, cam.position).normalize()
    expect(dir1.dot(toTgt)).toBeCloseTo(1, 3)
    canvas.dispatchEvent(ev('pointerup', 220, 0))
  })

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
    const aim0 = controls.target.clone().sub(cam.position).normalize()
    const dist0 = cam.position.distanceTo(controls.target)
    const wheel = (deltaY) => {
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY, clientX: 100, clientY: 100, bubbles: true, cancelable: true }))
    }
    const p0 = cam.position.clone()
    wheel(100)
    await settleZoomFrames()
    const back = cam.position.clone().sub(p0)
    expect(back.length()).toBeGreaterThan(1)
    expect(back.dot(aim0)).toBeLessThan(0)
    expect(cam.position.distanceTo(controls.target)).toBeCloseTo(dist0, 3)
    const aim1 = controls.target.clone().sub(cam.position).normalize()
    expect(aim1.dot(aim0)).toBeCloseTo(1, 4)
    expect(cam.getWorldDirection(new THREE.Vector3()).dot(aim1)).toBeCloseTo(1, 4)
    const p1 = cam.position.clone()
    wheel(-100)
    await settleZoomFrames()
    expect(cam.position.clone().sub(p1).dot(aim0)).toBeGreaterThan(0)
  })

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
    const wheel = (deltaY) => {
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY, clientX: 100, clientY: 100, bubbles: true, cancelable: true }))
    }
    wheel(-100); await settleZoomFrames()
    const dist0 = cam.position.distanceTo(controls.target)
    const expected = (deltaY) => dist0 * Math.max(-0.3, Math.min(0.3, -deltaY * 0.0012))

    const p0 = cam.position.clone()
    wheel(-100); await settleZoomFrames()
    expect(cam.position.distanceTo(p0)).toBeCloseTo(expected(-100), 4)
    expect(cam.position.distanceTo(controls.target)).toBeCloseTo(dist0, 4)

    const p1 = cam.position.clone()
    wheel(100); await settleZoomFrames()
    expect(cam.position.distanceTo(p1)).toBeCloseTo(Math.abs(expected(100)), 4)

    const p2 = cam.position.clone()
    wheel(100); wheel(-100); await settleZoomFrames()
    expect(cam.position.distanceTo(p2)).toBeCloseTo(0, 4)

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
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 100, clientY: 100, bubbles: true, cancelable: true }))
    await settleZoomFrames()
    const dist0 = cam.position.distanceTo(controls.target)
    const expected = dist0 * Math.max(-0.3, Math.min(0.3, 100 * 0.0012))
    const p0 = cam.position.clone()
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 100, clientY: 100, bubbles: true, cancelable: true }))
    await pumpZoomAt(1 / 60, 120)
    expect(cam.position.distanceTo(p0)).toBeCloseTo(expected, 4)
    expect(cam.position.distanceTo(controls.target)).toBeCloseTo(dist0, 4)
  })

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
    wheel(100)
    api.setCam('follow')
    api.setCam('free')
    const p = cam.position.clone()
    await settleZoomFrames()
    expect(cam.position.distanceTo(p)).toBeCloseTo(0, 4)
  })

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
    const factorOf = (deltaY) => {
      const scale = Math.pow(0.95, controls.zoomSpeed * Math.abs(deltaY) * 0.01)
      return deltaY > 0 ? 1 / scale : scale
    }
    const wheel = (init) => {
      const e = new WheelEvent('wheel', { clientX: 100, clientY: 100, bubbles: true, cancelable: true, ...init })
      if (init.ctrlKey !== undefined) Object.defineProperty(e, 'ctrlKey', { value: init.ctrlKey })
      canvas.dispatchEvent(e)
      return settleZoomFrames()
    }
    const expectRatio = (d0, f) => {
      expect(cam.position.distanceTo(controls.target) / d0).toBeCloseTo(f, 3)
    }

    let d0 = cam.position.distanceTo(controls.target)
    await wheel({ deltaY: 3, deltaMode: 1 })
    expectRatio(d0, factorOf(48))

    d0 = cam.position.distanceTo(controls.target)
    await wheel({ deltaY: 2, deltaMode: 2 })
    expectRatio(d0, factorOf(200))

    d0 = cam.position.distanceTo(controls.target)
    await wheel({ deltaY: -10, ctrlKey: true })
    expectRatio(d0, factorOf(-100))

    d0 = cam.position.distanceTo(controls.target)
    controls._controlActive = true
    await wheel({ deltaY: -10, ctrlKey: true })
    expectRatio(d0, factorOf(-10))
    controls._controlActive = false

    d0 = cam.position.distanceTo(controls.target)
    controls.enableZoom = false
    await wheel({ deltaY: 100 })
    expect(cam.position.distanceTo(controls.target)).toBeCloseTo(d0, 6)
    controls.enableZoom = true
  })

  it('destroy 摘除 orbit wheel 监听：同 container 重建后旧实例不再消费 wheel', async () => {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const container = mountContainer()
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
      await new Promise((r) => setTimeout(r, 25))
      return instance
    }
    let instance = await mk()
    expect(consumeCount()).toBe(1)
    instance.destroy()
    instance = await mk()
    expect(consumeCount()).toBe(1)
    instance.destroy()
    instance = await mk()
    expect(consumeCount()).toBe(1)
  })

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
    const gesture = (xs) => {
      canvas.dispatchEvent(touch('pointerdown', 100, 1, 7))
      canvas.dispatchEvent(touch('pointerdown', 280, 1, 9))
      canvas.dispatchEvent(touch('pointermove', 300, 1, 9))
      frame()
      for (const x of xs) canvas.dispatchEvent(touch('pointermove', x, 1, 9))
      canvas.dispatchEvent(touch('pointerup', 300, 0, 9))
      canvas.dispatchEvent(touch('pointerup', 100, 0, 7))
    }
    gesture([350, 300])
    expect(cam.position.distanceTo(start)).toBeCloseTo(0, 4)
    gesture([325, 350, 300])
    expect(cam.position.distanceTo(start)).toBeCloseTo(0, 4)
    gesture([500, 300])
    expect(cam.position.distanceTo(start)).toBeCloseTo(0, 4)
    const p0 = cam.position.clone()
    gesture([350])
    expect(cam.position.clone().sub(p0).dot(aim0)).toBeGreaterThan(0.5)
    expect(cam.position.distanceTo(controls.target)).toBeCloseTo(dist0, 3)
    const aim1 = new THREE.Vector3().subVectors(controls.target, cam.position).normalize()
    expect(aim1.dot(aim0)).toBeCloseTo(1, 4)
    const pForward = cam.position.clone()
    gesture([350, 300])
    expect(cam.position.distanceTo(pForward)).toBeCloseTo(0, 4)
    const pBefore = cam.position.clone()
    gesture([450, 375, 300])
    expect(cam.position.distanceTo(pBefore)).toBeCloseTo(0, 4)
    const base = cam.position.clone()
    gesture([450])
    const oneShot = cam.position.clone().sub(base)
    expect(oneShot.length()).toBeGreaterThan(1)
    gesture([200])
    expect(cam.position.distanceTo(base)).toBeCloseTo(0, 4)
    gesture([375, 450])
    const split = cam.position.clone().sub(base)
    expect(split.distanceTo(oneShot)).toBeCloseTo(0, 4)
  })
})

describe('自由视角触屏手势', () => {
  const touch = (type, x, y, pointerId) => Object.assign(
    new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }),
    { pointerId, pointerType: 'touch' },
  )

  async function setup({ pos = [0, 100, 100], target = [0, 0, 0] } = {}) {
    source.loadPlaybackData.mockResolvedValue(minimalData())
    const frame = stubFrames()
    const onVehicleSelect = vi.fn()
    const container = mountContainer()
    container.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 })
    container.setPointerCapture = vi.fn()
    container.releasePointerCapture = vi.fn()
    const api = initPlayback(container, createPlaybackStore(), null, { onVehicleSelect })
    created.push(api)
    await api.loadData({ kind: 'local', file: new File(['x'], 'touch-gestures.wotbreplay') })
    api.setPlaying(false)
    api.setCam('free')
    const cam = window.__camera
    const controls = window.__controls
    cam.position.set(...pos)
    controls.target.set(...target)
    cam.lookAt(controls.target)
    const canvas = container.querySelector('canvas')
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()
    const send = (...args) => canvas.dispatchEvent(touch(...args))
    const dir = () => new THREE.Vector3().subVectors(controls.target, cam.position).normalize()
    return { api, cam, controls, canvas, send, dir, frame, onVehicleSelect }
  }

  function groundUnder(cam, x, y) {
    cam.updateMatrixWorld()
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(x / 800 * 2 - 1, -(y / 600 * 2 - 1)), cam)
    return raycaster.ray.at(-cam.position.y / raycaster.ray.direction.y, new THREE.Vector3())
  }

  describe('单指平移', () => {
    it('抓住的地面点留在手指下，朝向和高度不变，松手即停', async () => {
      const { cam, controls, send, dir } = await setup()
      const dir0 = dir()
      send('pointerdown', 400, 300, 1)
      send('pointermove', 410, 300, 1)
      const grabbed = groundUnder(cam, 410, 300)
      send('pointermove', 520, 380, 1)
      expect(cam.position.y).toBe(100)
      expect(dir().dot(dir0)).toBeCloseTo(1, 8)
      expect(controls.enabled).toBe(false)
      const under = groundUnder(cam, 520, 380)
      expect(under.distanceTo(grabbed)).toBeLessThan(1e-3)
      expect(cam.position.x).not.toBeCloseTo(0, 1)
      send('pointerup', 520, 380, 1)
      const stopped = cam.position.clone()
      send('pointermove', 600, 300, 1)
      expect(cam.position.equals(stopped)).toBe(true)
    })

    it('手指回到起点时相机精确回位', async () => {
      const { cam, send } = await setup()
      send('pointerdown', 400, 300, 1)
      send('pointermove', 410, 300, 1)
      const start = cam.position.clone()
      send('pointermove', 600, 450, 1)
      send('pointermove', 300, 200, 1)
      send('pointermove', 410, 300, 1)
      send('pointerup', 410, 300, 1)
      expect(cam.position.distanceTo(start)).toBeLessThan(1e-6)
    })

    it('手指按在地平线以上也不会把相机甩飞', async () => {
      const { cam, send } = await setup({ pos: [0, 100, 0], target: [0, 100, -100] })
      send('pointerdown', 400, 100, 1)
      send('pointermove', 410, 100, 1)
      send('pointermove', 500, 100, 1)
      send('pointerup', 500, 100, 1)
      expect(Number.isFinite(cam.position.x)).toBe(true)
      expect(Math.abs(cam.position.x)).toBeLessThan(800)
      expect(cam.position.y).toBe(100)
    })

    it('平移到地图边缘时相机停下而不是转头', async () => {
      const { cam, send, dir } = await setup()
      const dir0 = dir()
      let last = null
      for (let i = 0; i < 40; i++) {
        send('pointerdown', 400, 100, 1)
        send('pointermove', 400, 110, 1)
        send('pointermove', 400, 500, 1)
        send('pointerup', 400, 500, 1)
        expect(dir().dot(dir0)).toBeCloseTo(1, 6)
        if (i === 39) expect(cam.position.distanceTo(last)).toBeLessThan(1e-6)
        last = cam.position.clone()
      }
    })

    it('撞到地图边缘再反向，手指回到起点时相机回到手势起点', async () => {
      const { cam, controls, send } = await setup()
      for (let i = 0; i < 40; i++) {
        send('pointerdown', 400, 100, 1)
        send('pointermove', 400, 110, 1)
        send('pointermove', 400, 500, 1)
        send('pointerup', 400, 500, 1)
      }
      send('pointerdown', 400, 300, 2)
      send('pointermove', 400, 310, 2)
      const start = cam.position.clone()
      const target = controls.target.clone()
      send('pointermove', 400, 590, 2)
      send('pointermove', 400, 100, 2)
      send('pointermove', 400, 310, 2)
      send('pointerup', 400, 310, 2)
      expect(cam.position.distanceTo(start)).toBeLessThan(1e-6)
      expect(controls.target.distanceTo(target)).toBeLessThan(1e-6)
    })

    it('翻过高坡时不低于净空，回到原处恢复原高度', async () => {
      stubTerrainAssets()
      const { cam, send } = await setup({ pos: [-60, 26, 0], target: [-60, 11, -30] })
      send('pointerdown', 700, 300, 1)
      send('pointermove', 690, 300, 1)
      const start = cam.position.clone()
      let peak = 0
      for (let x = 680; x >= -3000; x -= 200) {
        send('pointermove', x, 300, 1)
        peak = Math.max(peak, cam.position.y)
        if (cam.position.x > -20) break
      }
      expect(peak).toBeGreaterThan(26)
      send('pointermove', 690, 300, 1)
      send('pointerup', 690, 300, 1)
      expect(cam.position.distanceTo(start)).toBeLessThan(1e-6)
    })

    it('≤ 4px 算单击且相机不动，超过后不算单击', async () => {
      const { cam, send, onVehicleSelect } = await setup()
      const start = cam.position.clone()
      send('pointerdown', 400, 300, 1)
      send('pointermove', 403, 300, 1)
      send('pointerup', 403, 300, 1)
      expect(cam.position.equals(start)).toBe(true)
      expect(onVehicleSelect).toHaveBeenCalledTimes(1)
      send('pointerdown', 400, 300, 2)
      send('pointermove', 420, 300, 2)
      send('pointermove', 400, 300, 2)
      send('pointerup', 400, 300, 2)
      expect(onVehicleSelect).toHaveBeenCalledTimes(1)
    })
  })

  describe('双指', () => {
    const lookCases = [
      ['右', [40, 0], (a, b) => b.x > a.x],
      ['左', [-40, 0], (a, b) => b.x < a.x],
      ['上', [0, -40], (a, b) => b.y > a.y],
      ['下', [0, 40], (a, b) => b.y < a.y],
    ]
    it.each(lookCases)('并拢一起向%s拖 = 转视角，相机不动', async (_, [dx, dy], changed) => {
      const { cam, controls, send, dir, frame } = await setup()
      const start = cam.position.clone()
      const dir0 = dir()
      send('pointerdown', 400, 300, 1)
      send('pointerdown', 440, 300, 2)
      send('pointermove', 400 + dx / 2, 300 + dy / 2, 1)
      send('pointermove', 440 + dx / 2, 300 + dy / 2, 2)
      frame()
      send('pointermove', 400 + dx, 300 + dy, 1)
      send('pointermove', 440 + dx, 300 + dy, 2)
      expect(changed(dir0, dir())).toBe(true)
      expect(dir().angleTo(dir0)).toBeGreaterThan(0.01)
      expect(cam.position.equals(start)).toBe(true)
      expect(controls.enabled).toBe(false)
      expect(cam.position.distanceTo(controls.target)).toBeCloseTo(start.distanceTo(new THREE.Vector3(0, 0, 0)), 6)
    })

    it.each([
      ['A A B', [[430, 1], [460, 1], [500, 2]]],
      ['B A A', [[500, 2], [430, 1], [460, 1]]],
    ])('同一帧内事件顺序 %s 不影响判定：两指同向 = 转视角', async (_, moves) => {
      const { cam, send, dir, frame } = await setup()
      const start = cam.position.clone()
      const dir0 = dir()
      send('pointerdown', 400, 300, 1)
      send('pointerdown', 440, 300, 2)
      for (const [x, id] of moves) send('pointermove', x, 300, id)
      frame()
      send('pointermove', 500, 300, 1)
      send('pointermove', 540, 300, 2)
      expect(dir().angleTo(dir0)).toBeGreaterThan(0.01)
      expect(cam.position.equals(start)).toBe(true)
    })

    it('一帧内越过阈值又退回时不留下判定状态，之后同向拖动仍是转视角', async () => {
      const { cam, send, dir, frame } = await setup()
      const start = cam.position.clone()
      const dir0 = dir()
      send('pointerdown', 300, 300, 1)
      send('pointerdown', 500, 300, 2)
      send('pointermove', 313, 300, 1)
      send('pointermove', 300, 300, 1)
      frame()
      send('pointermove', 300, 320, 1)
      send('pointermove', 500, 320, 2)
      frame()
      send('pointermove', 300, 340, 1)
      send('pointermove', 500, 340, 2)
      expect(dir().angleTo(dir0)).toBeGreaterThan(0.01)
      expect(cam.position.equals(start)).toBe(true)
    })

    it('判定帧到来前手势已结束时不留下残余状态', async () => {
      const { cam, send, frame } = await setup()
      const start = cam.position.clone()
      send('pointerdown', 300, 300, 1)
      send('pointerdown', 500, 300, 2)
      send('pointermove', 340, 300, 1)
      send('pointerup', 500, 300, 2)
      send('pointerup', 340, 300, 1)
      frame()
      expect(cam.position.equals(start)).toBe(true)
    })

    it('指距分开较大时一起拖同样是转视角', async () => {
      const { cam, send, dir, frame } = await setup()
      const start = cam.position.clone()
      const dir0 = dir()
      send('pointerdown', 200, 300, 1)
      send('pointerdown', 600, 300, 2)
      send('pointermove', 200, 330, 1)
      send('pointermove', 600, 330, 2)
      frame()
      send('pointermove', 200, 360, 1)
      send('pointermove', 600, 360, 2)
      expect(dir().angleTo(dir0)).toBeGreaterThan(0.01)
      expect(cam.position.equals(start)).toBe(true)
    })

    it('转视角中指距变化不触发推拉', async () => {
      const { cam, send, frame } = await setup()
      const start = cam.position.clone()
      send('pointerdown', 400, 300, 1)
      send('pointerdown', 440, 300, 2)
      send('pointermove', 400, 330, 1)
      send('pointermove', 440, 330, 2)
      frame()
      send('pointermove', 300, 330, 1)
      send('pointermove', 540, 330, 2)
      expect(cam.position.equals(start)).toBe(true)
    })

    it.each([
      ['从并拢分开', [400, 420], [[380, 1], [440, 2]], [465, 2], 1],
      ['两指合拢', [300, 600], [[320, 1], [580, 2], [340, 1], [560, 2]], [500, 2], -1],
      ['一指不动', [300, 400], [[420, 2], [440, 2]], [520, 2], 1],
    ])('%s = 沿视线推拉，朝向不变', async (_, [x1, x2], moves, [lastX, lastId], sign) => {
      const { cam, send, dir, frame } = await setup()
      const dir0 = dir()
      send('pointerdown', x1, 300, 1)
      send('pointerdown', x2, 300, 2)
      for (const [x, id] of moves) send('pointermove', x, 300, id)
      frame()
      const before = cam.position.clone()
      send('pointermove', lastX, 300, lastId)
      expect(cam.position.clone().sub(before).dot(dir0) * sign).toBeGreaterThan(0)
      expect(dir().dot(dir0)).toBeCloseTo(1, 8)
    })

    it('捏合中两指改成同向移动也不转视角', async () => {
      const { send, dir, frame } = await setup()
      const dir0 = dir()
      send('pointerdown', 300, 300, 1)
      send('pointerdown', 500, 300, 2)
      send('pointermove', 280, 300, 1)
      send('pointermove', 520, 300, 2)
      frame()
      send('pointermove', 280, 400, 1)
      send('pointermove', 520, 400, 2)
      expect(dir().dot(dir0)).toBeCloseTo(1, 8)
    })

    it('判定前 12px 内相机不动', async () => {
      const { cam, send, dir, frame } = await setup()
      const start = cam.position.clone()
      const dir0 = dir()
      send('pointerdown', 300, 300, 1)
      send('pointerdown', 500, 300, 2)
      send('pointermove', 305, 300, 1)
      send('pointermove', 495, 300, 2)
      frame()
      expect(cam.position.equals(start)).toBe(true)
      expect(dir().dot(dir0)).toBeCloseTo(1, 10)
    })

    it('平移中加第二指立即停止；抬起后剩下的手指不平移也不选车', async () => {
      const { cam, send, onVehicleSelect } = await setup()
      send('pointerdown', 400, 300, 1)
      send('pointermove', 410, 300, 1)
      send('pointermove', 500, 300, 1)
      const stopped = cam.position.clone()
      send('pointerdown', 600, 300, 2)
      send('pointerup', 600, 300, 2)
      send('pointermove', 300, 300, 1)
      expect(cam.position.equals(stopped)).toBe(true)
      send('pointerup', 300, 300, 1)
      expect(onVehicleSelect).not.toHaveBeenCalled()
    })

    it('两指轻点不选车', async () => {
      const { send, onVehicleSelect } = await setup()
      send('pointerdown', 300, 300, 1)
      send('pointerdown', 500, 300, 2)
      send('pointerup', 500, 300, 2)
      send('pointerup', 300, 300, 1)
      expect(onVehicleSelect).not.toHaveBeenCalled()
    })

    it('pointercancel 清空手势，下一次单指正常平移', async () => {
      const { cam, send } = await setup()
      send('pointerdown', 300, 300, 1)
      send('pointerdown', 500, 300, 2)
      send('pointercancel', 300, 300, 1)
      send('pointercancel', 500, 300, 2)
      const start = cam.position.clone()
      send('pointerdown', 400, 300, 3)
      send('pointermove', 410, 300, 3)
      send('pointermove', 500, 300, 3)
      send('pointerup', 500, 300, 3)
      expect(cam.position.equals(start)).toBe(false)
    })

    it('第三根手指不留下残余手势', async () => {
      const { cam, send } = await setup()
      const start = cam.position.clone()
      send('pointerdown', 300, 300, 1)
      send('pointerdown', 500, 300, 2)
      send('pointerdown', 400, 200, 3)
      send('pointermove', 400, 100, 3)
      send('pointerup', 400, 100, 3)
      send('pointerup', 500, 300, 2)
      send('pointerup', 300, 300, 1)
      expect(cam.position.equals(start)).toBe(true)
    })
  })

  describe('其他模式不走自由视角手势', () => {
    it('绘制模式：单指不动相机，双指一起拖也只是捏合', async () => {
      const { api, cam, send, dir } = await setup()
      api.setAnnotationInteraction({ enabled: true, tool: 'pen', color: '#ff4d4f', width: 3, eraserWidth: 16 })
      const start = cam.position.clone()
      const dir0 = dir()
      send('pointerdown', 400, 300, 1)
      send('pointermove', 460, 300, 1)
      expect(cam.position.equals(start)).toBe(true)
      send('pointerdown', 500, 300, 2)
      send('pointermove', 460, 360, 1)
      send('pointermove', 500, 360, 2)
      expect(dir().dot(dir0)).toBeCloseTo(1, 8)
      send('pointerup', 500, 360, 2)
      send('pointerup', 460, 360, 1)
    })

    it('沙盘：单指交给 OrbitControls，不走贴地平移', async () => {
      const { api, controls, send } = await setup()
      api.setCam('top')
      const target = controls.target.clone()
      send('pointerdown', 400, 300, 1)
      send('pointermove', 500, 300, 1)
      send('pointerup', 500, 300, 1)
      expect(controls.target.equals(target)).toBe(true)
      expect(controls.enabled).toBe(true)
    })

    it('平移中回到俯视机位后，手指继续移动不把相机拉回手势起点', async () => {
      const { api, cam, send } = await setup()
      send('pointerdown', 400, 300, 1)
      send('pointermove', 410, 300, 1)
      send('pointermove', 500, 300, 1)
      api.setCam('top-view')
      const top = cam.position.clone()
      send('pointermove', 600, 300, 1)
      expect(cam.position.equals(top)).toBe(true)
    })

    it('手势中切模式后不留下残余状态', async () => {
      const { api, cam, send } = await setup()
      send('pointerdown', 400, 300, 1)
      send('pointermove', 410, 300, 1)
      api.setCam('top')
      api.setCam('free')
      const start = cam.position.clone()
      send('pointermove', 600, 300, 1)
      expect(cam.position.equals(start)).toBe(true)
    })
  })
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
      created = []
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
