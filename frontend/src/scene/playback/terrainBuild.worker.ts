import { buildGroundGeometryData, groundGeometryTransferables } from '../groundGeometryData.js'
import type { TerrainWorkerIn, TerrainWorkerOut } from './terrainLodScheduler'

interface Source { field: Float32Array; n: number; span: number; cx: number; cz: number; refineMask: unknown }
let source: Source | null = null

const scope = self as typeof self & { postMessage(m: unknown, t: Transferable[]): void }
const post = (msg: TerrainWorkerOut, transfer: Transferable[] = []) => scope.postMessage(msg, transfer)

self.onmessage = (ev: MessageEvent<TerrainWorkerIn>) => {
  const msg = ev.data
  if (msg.type === 'init') {
    source = { field: msg.field, n: msg.n, span: msg.span, cx: msg.cx, cz: msg.cz, refineMask: msg.refineMask }
    return
  }
  if (msg.type === 'mask') {
    if (source) source.refineMask = msg.refineMask
    return
  }
  if (msg.type === 'build') {
    if (!source) { post({ type: 'error', id: msg.id, message: 'terrain worker: build before init' }); return }
    try {
      const t0 = performance.now()
      const data = buildGroundGeometryData({
        field: source.field, n: source.n, span: source.span,
        cam: msg.cam, fovY: msg.fovY, aspect: msg.aspect, hFovDeg: msg.hFovDeg,
        refineMask: source.refineMask, cx: source.cx, cz: source.cz,
        includeNormals: msg.includeNormals, measure: msg.measure,
      })
      post({ type: 'built', id: msg.id, data, workerMs: performance.now() - t0 }, groundGeometryTransferables(data) as Transferable[])
    } catch (e) {
      post({ type: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e) })
    }
  }
}
