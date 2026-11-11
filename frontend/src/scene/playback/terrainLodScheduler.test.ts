// 地形 LOD 异步调度：单在途 + 最新者胜出、代号丢弃、回退、销毁；以及「真 Worker 入口 → 调度 → 换装」
// 与同步路径逐字节一致。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTerrainLodScheduler } from './terrainLodScheduler.ts'
import type { TerrainWorkerLike, TerrainWorkerIn, TerrainWorkerOut, TerrainBuildRequest } from './terrainLodScheduler.ts'
import { buildGroundGeometry, groundGeometryFromData } from '../groundPass.js'

const REQ: TerrainBuildRequest = { cam: { x: 10, y: 90, z: -30 }, fovY: 0.9, aspect: 1.8, hFovDeg: 55, measure: false }
const job = (tag: string, req: Partial<TerrainBuildRequest> = {}) => ({ request: { ...REQ, ...req }, snapshot: tag, reason: 'distance' })
const fakeData = (tag: string) => ({ tag }) as never

class FakeWorker implements TerrainWorkerLike {
  sent: TerrainWorkerIn[] = []
  terminated = false
  onmessage: TerrainWorkerLike['onmessage'] = null
  onerror: TerrainWorkerLike['onerror'] = null
  postMessage(m: TerrainWorkerIn) { this.sent.push(m) }
  terminate() { this.terminated = true }
  builds() { return this.sent.filter((m) => m.type === 'build') as Extract<TerrainWorkerIn, { type: 'build' }>[] }
  reply(id: number, tag: string) { this.onmessage?.({ data: { type: 'built', id, data: fakeData(tag), workerMs: 5 } satisfies TerrainWorkerOut }) }
}
const SRC = { field: new Float32Array(4), n: 2, span: 10, cx: 0, cz: 0, refineMask: null }

type Opts = Parameters<typeof createTerrainLodScheduler<string>>[0]
function make(extra: Partial<Opts> = {}) {
  const w = new FakeWorker()
  const swaps: string[] = []
  const lost: string[] = []
  const s = createTerrainLodScheduler<string>({
    createWorker: () => w,
    onSwap: (_d, j) => { swaps.push(j.snapshot) },
    onWorkerLost: (_j, r) => { lost.push(r) },
    ...extra,
  })
  s.setSource(SRC)
  return { w, s, swaps, lost }
}

describe('terrainLodScheduler', () => {
  it('在途时多次命中只覆盖待发快照：结果返回后只发一个后续请求，且是最新的', () => {
    const { w, s, swaps } = make()
    expect(s.request(job('a'))).toBe(true)
    s.request(job('b')); s.request(job('c')); s.request(job('d', { cam: { x: 1, y: 2, z: 3 } }))
    expect(w.builds()).toHaveLength(1)
    w.reply(w.builds()[0].id, 'a')
    expect(swaps).toEqual(['a'])
    expect(w.builds()).toHaveLength(2)
    expect(w.builds()[1].cam).toEqual({ x: 1, y: 2, z: 3 })
    w.reply(w.builds()[1].id, 'd')
    expect(swaps).toEqual(['a', 'd'])
    expect(w.builds()).toHaveLength(2)   // 无更多待发
  })

  it('待发快照相对刚换上的网格不再过期则不发', () => {
    const { w, s } = make({ stillStale: (applied, next) => applied !== next })
    s.request(job('a')); s.request(job('a'))
    w.reply(w.builds()[0].id, 'a')
    expect(w.builds()).toHaveLength(1)
  })

  it('代号不符的结果被丢弃（invalidate / setSource / setMask 各自作废在途）', () => {
    type S = ReturnType<typeof make>['s']
    const bumps: Array<(s: S) => void> = [(s) => s.invalidate(), (s) => s.setSource(SRC), (s) => s.setMask(new Uint8Array(1))]
    for (const bump of bumps) {
      const { w, s, swaps } = make()
      s.request(job('old'))
      bump(s)
      w.reply(w.builds()[0].id, 'old')
      expect(swaps).toEqual([])
      expect(s.request(job('new'))).toBe(true)
      w.reply(w.builds()[1].id, 'new')
      expect(swaps).toEqual(['new'])
    }
  })

  it('作废期间排队的新代号任务，在旧结果丢弃后才发出（同时只有一个在途）', () => {
    const { w, s, swaps } = make()
    s.request(job('old'))
    s.setMask(null)
    s.request(job('fresh'))
    expect(w.builds()).toHaveLength(1)
    w.reply(w.builds()[0].id, 'old')
    expect(swaps).toEqual([])
    expect(w.builds()).toHaveLength(2)
    w.reply(w.builds()[1].id, 'fresh')
    expect(swaps).toEqual(['fresh'])
  })

  it('init / mask 消息先于 build 送达同一 Worker（按发送顺序）', () => {
    const { w, s } = make()
    s.request(job('a'))
    s.setMask(new Uint8Array(2))
    expect(w.sent.map((m) => m.type)).toEqual(['init', 'build', 'mask'])
  })

  it('Worker 构造失败 / 不可用：request 返回 false 并通知回退，之后不再尝试', () => {
    const lost: string[] = []
    const create = vi.fn(() => { throw new Error('boom') })
    const s = createTerrainLodScheduler<string>({ createWorker: create, onSwap: () => {}, onWorkerLost: (_j, r) => lost.push(r) })
    expect(s.request(job('a'))).toBe(false)
    expect(lost).toEqual(['construct-failed'])
    expect(s.available).toBe(false)
    expect(s.request(job('b'))).toBe(false)
    expect(create).toHaveBeenCalledTimes(1)
    const lost2: string[] = []
    const s2 = createTerrainLodScheduler<string>({ createWorker: () => null, onSwap: () => {}, onWorkerLost: (_j, r) => lost2.push(r) })
    expect(s2.request(job('a'))).toBe(false)
    expect(lost2).toEqual(['unavailable'])
  })

  it('运行期 error 消息 / onerror：终止 Worker、通知回退', () => {
    const { w, s, lost } = make()
    s.request(job('a'))
    w.onmessage?.({ data: { type: 'error', id: w.builds()[0].id, message: 'bad' } })
    expect(lost).toEqual(['build-error: bad'])
    expect(w.terminated).toBe(true)
    expect(s.request(job('b'))).toBe(false)
    const m2 = make()
    m2.s.request(job('a'))
    m2.w.onerror?.({})
    expect(m2.lost).toEqual(['worker-error'])
  })

  it('销毁后：terminate、不再换装、不再发请求', () => {
    const { w, s, swaps } = make()
    s.request(job('a'))
    s.dispose()
    expect(w.terminated).toBe(true)
    w.reply(w.builds()[0].id, 'a')
    expect(swaps).toEqual([])
    expect(s.request(job('b'))).toBe(false)
  })

  it('换装回调抛错不破坏调度：待发任务仍然发出', () => {
    const { w, s } = make({ onSwap: () => { throw new Error('swap failed') } })
    s.request(job('a')); s.request(job('b'))
    expect(() => w.reply(w.builds()[0].id, 'a')).toThrow()
    expect(w.builds()).toHaveLength(2)
  })
})

describe('Worker 入口 → 调度 → 换装 与同步路径逐字节一致', () => {
  const N = 128, SPAN = 600
  const field = (() => {
    const f = new Float32Array(N * N)
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) f[i * N + j] = 15 * Math.sin(i / 11) * Math.cos(j / 13) + 3 * Math.sin((i * j) / 97)
    return f
  })()
  const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  let prevSelf: unknown
  beforeEach(() => { prevSelf = (globalThis as { self?: unknown }).self })
  afterEach(() => { (globalThis as { self?: unknown }).self = prevSelf; vi.resetModules() })

  it('经真实 terrainBuild.worker 模块与 structuredClone 转移', { timeout: 60000 }, async () => {
    // 真 Worker 入口跑在伪 self 上；消息往返用 structuredClone(transfer) 模拟 Worker 边界
    let toMain: ((m: TerrainWorkerOut, t: Transferable[]) => void) | null = null
    const fakeSelf: { onmessage: ((e: { data: TerrainWorkerIn }) => void) | null; postMessage: (m: TerrainWorkerOut, t: Transferable[]) => void } = {
      onmessage: null,
      postMessage: (m, t) => toMain?.(m, t),
    }
    ;(globalThis as { self?: unknown }).self = fakeSelf
    await import('./terrainBuild.worker.ts')
    expect(typeof fakeSelf.onmessage).toBe('function')
    const worker: TerrainWorkerLike = {
      onmessage: null, onerror: null,
      postMessage: (m, t) => fakeSelf.onmessage!({ data: structuredClone(m, { transfer: t }) }),
      terminate: () => {},
    }
    toMain = (m, t) => worker.onmessage!({ data: structuredClone(m, { transfer: t }) })
    const mask = new Uint8Array(N * N)
    for (let k = 0; k < 400; k++) mask[(30 + (k % 20)) * N + 40 + Math.floor(k / 20)] = 1
    let got: unknown = null
    const s = createTerrainLodScheduler<string>({
      createWorker: () => worker,
      onSwap: (d) => { got = groundGeometryFromData(d as never) },
      onWorkerLost: () => { throw new Error('should not lose') },
    })
    s.setSource({ field, n: N, span: SPAN, cx: 2, cz: -3, refineMask: mask })
    const req: TerrainBuildRequest = { cam: { x: -40, y: 70, z: 55 }, fovY: 0.9, aspect: 1.77, hFovDeg: 55, measure: true }
    s.request({ request: req, snapshot: 's', reason: 'first' })
    const sync = buildGroundGeometry({ field, n: N, span: SPAN, cam: req.cam, fovY: req.fovY, aspect: req.aspect, hFovDeg: req.hFovDeg, refineMask: mask, cx: 2, cz: -3, onDiagnostics: null } as never)
    const g = got as typeof sync
    expect(g).not.toBeNull()
    for (const k of ['position', 'uv', 'normal'] as const) expect(bytes(g.attributes[k].array)).toEqual(bytes(sync.attributes[k].array))
    expect(bytes(g.index!.array)).toEqual(bytes(sync.index!.array))
    expect(g.boundingSphere!.radius).toBe(sync.boundingSphere!.radius)
    expect(g.boundingSphere!.center.toArray()).toEqual(sync.boundingSphere!.center.toArray())
    for (const k of ['sizeAt', 'originIAt', 'originJAt', 'vertexIndexAt', 'morphRaw']) {
      expect(bytes(g.userData.terrainBuild[k])).toEqual(bytes(sync.userData.terrainBuild[k]))
    }
    expect(g.userData.terrainBuild.quads).toBe(sync.userData.terrainBuild.quads)
  })
})
