// @vitest-environment happy-dom
import { afterEach, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import * as THREE from 'three'
import { assetProvider } from './assetProvider.ts'
import { createPlaybackStore } from './playbackStore.js'
import { initPlayback } from './playbackScene.js'

export function minimalData(tStart = 42, mapName = 'probe_map') {
  return {
    meta: { map_id: 1, map_name: mapName, t_start: tStart, friendly_team: 1 },
    vehicles: [], shots: [], kills: [], reloads: [], reload_effective: [], supremacy_points: new Map(),
    periods: [], supremacy_bases: [],
  }
}

export function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

export function mountContainer() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

export function installSceneTestSetup({ source, muzzleTip, state }) {
  function track(d) {
    state.pending.push(d)
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
    state.api = null
    state.created.length = 0
    state.pending.length = 0
  })

  afterEach(async () => {
    for (const d of state.pending) { try { d.resolve(null) } catch (_) {} }
    for (let i = 0; i < 8; i++) await Promise.resolve()
    for (const instance of state.created) { try { instance?.destroy?.() } catch (_) {} }
    state.api = null
    state.created.length = 0
    state.pending.length = 0
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
    const api = initPlayback(mountContainer(), store)
    state.api = api
    state.created.push(api)
    return { store, api }
  }

  function createInstance(store) {
    const instance = initPlayback(mountContainer(), store)
    state.created.push(instance)
    state.api = instance
    return instance
  }

  return {
    track, stubTerrainAssets, stubFrames, settleZoomFrames, pumpZoomAt, stubCanvas2d,
    createScene, createInstance,
  }
}
