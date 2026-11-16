// 地形 LOD 构建 Worker：只是 `buildGroundGeometryData`（groundPass 的纯数据阶段）的执行位置，
// 不持有任何细分判据或阈值（判据在 terrainMesh.js，由 mapWorld 在主线程判定「何时重建」）。
// 协议见 terrainLodScheduler.ts：init（高度场 + 几何参数，Worker 内常驻）/ mask（走廊掩码）/ build。
import { buildGroundGeometryData, groundGeometryTransferables } from '../groundGeometryData.js'
import type { TerrainWorkerIn, TerrainWorkerOut } from './terrainLodScheduler'

interface Source { field: Float32Array; n: number; span: number; cx: number; cz: number; refineMask: unknown }
let source: Source | null = null

// 模块 Worker 的全局：lib.dom 把 `self` 当 Window，postMessage 签名不同；这里只用 Worker 一侧的签名。
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
        refineMask: source.refineMask, cx: source.cx, cz: source.cz, measure: msg.measure,
      })
      post({ type: 'built', id: msg.id, data, workerMs: performance.now() - t0 }, groundGeometryTransferables(data) as Transferable[])
    } catch (e) {
      post({ type: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e) })
    }
  }
}
