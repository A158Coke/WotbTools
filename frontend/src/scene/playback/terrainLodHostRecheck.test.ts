import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTerrainLodScheduler } from './terrainLodScheduler.ts'
import type { TerrainWorkerIn, TerrainWorkerLike, TerrainWorkerOut } from './terrainLodScheduler.ts'
import { createTerrainLodWake } from './terrainLodWake.ts'
import { terrainLodPoseReason, terrainLodStaleReason, terrainLodState } from '../terrainMesh.js'

class FakeWorker implements TerrainWorkerLike {
  sent: TerrainWorkerIn[] = []
  terminated = false
  onmessage: TerrainWorkerLike['onmessage'] = null
  onerror: TerrainWorkerLike['onerror'] = null
  postMessage(m: TerrainWorkerIn) { this.sent.push(m) }
  terminate() { this.terminated = true }
  builds() { return this.sent.filter((m) => m.type === 'build') as Extract<TerrainWorkerIn, { type: 'build' }>[] }
  reply(id: number) { this.onmessage?.({ data: { type: 'built', id, data: {} as never, workerMs: 5 } satisfies TerrainWorkerOut }) }
}

const SRC = { field: new Float32Array(4), n: 2, span: 10, cx: 0, cz: 0, refineMask: null }
const aspect = 16 / 9
const target = { x: 0, y: 0, z: 0 }

function host() {
  let now = 0
  let dirty = false
  const camera = { position: { x: 0, y: 0, z: 100 }, fov: 60 }
  const state = () => terrainLodState(camera, target, aspect)
  const builds: number[] = []
  let syncBuilds = 0
  let prev: ReturnType<typeof state> | null = null
  let prevAt = 0
  const worker = new FakeWorker()
  const invalidate = () => { dirty = true }
  const wake = createTerrainLodWake(invalidate, () => false)
  let scheduler: ReturnType<typeof createTerrainLodScheduler<ReturnType<typeof state>>> | null = null
  const buildRequest = () => ({ cam: { x: 0, y: 50, z: camera.position.z }, fovY: 0.9, aspect, hFovDeg: null, measure: false })

  scheduler = createTerrainLodScheduler({
    createWorker: () => worker,
    onSwap: (_data, job) => {
      prev = job.snapshot
      prevAt = now
      if (terrainLodPoseReason(job.snapshot, state())) wake.scheduleElapsed(now - prevAt)
      else wake.cancel()
    },
    onWorkerLost: () => {
      scheduler = null
      invalidate()
    },
    onDiscard: () => {
      invalidate()
    },
  })
  scheduler.setSource(SRC)

  function frame() {
    if (!dirty) return false
    dirty = false
    if (!scheduler) {
      syncBuilds++
      prev = state()
      prevAt = now
      wake.cancel()
      return true
    }
    const reason = terrainLodStaleReason(prev, state(), now - prevAt)
    if (!reason) return false
    const wasBusy = scheduler.busy
    const accepted = scheduler.request({ request: buildRequest(), snapshot: state(), reason })
    if (!wasBusy && accepted) builds.push(state().d)
    wake.cancel()
    return true
  }

  return {
    camera, worker, wake, frame, invalidate,
    setMask(mask: unknown) { prev = null; invalidate(); scheduler?.setMask(mask) },
    get builds() { return builds },
    get syncBuilds() { return syncBuilds },
    get dirty() { return dirty },
    advance(ms: number) { now += ms; vi.advanceTimersByTime(ms) },
  }
}

afterEach(() => { vi.useRealTimers() })

describe('地形 LOD 换装后的最终姿态复查', () => {
  it('停手后旧快照换装：节流到期唤醒一帧，并按最终相机再提交一次', () => {
    vi.useFakeTimers()
    const h = host()
    h.invalidate()
    expect(h.frame()).toBe(true)
    expect(h.builds).toEqual([100])
    expect(h.worker.builds()).toHaveLength(1)
    const first = h.worker.builds()[0].id

    h.camera.position.z = 40
    h.advance(200)
    h.worker.reply(first)
    expect(h.builds).toEqual([100])
    expect(h.wake.pending).toBe(true)

    h.advance(119)
    expect(h.dirty).toBe(false)
    expect(h.frame()).toBe(false)
    h.advance(1)
    expect(h.dirty).toBe(true)
    expect(h.frame()).toBe(true)
    expect(h.builds).toEqual([100, 40])
    expect(h.worker.builds()).toHaveLength(2)
    expect(h.worker.builds()[1].cam.z).toBe(40)

    h.worker.reply(h.worker.builds()[1].id)
    expect(h.wake.pending).toBe(false)
  })

  it('在途时掩码失效：busy 期间的新请求被忽略，旧结果丢弃后唤醒并提交新掩码构建', () => {
    vi.useFakeTimers()
    const h = host()
    h.invalidate()
    expect(h.frame()).toBe(true)
    const first = h.worker.builds()[0].id
    h.setMask(new Uint8Array(1))
    expect(h.frame()).toBe(true)
    expect(h.worker.builds()).toHaveLength(1)
    h.worker.reply(first)
    expect(h.dirty).toBe(true)
    expect(h.frame()).toBe(true)
    expect(h.worker.builds()).toHaveLength(2)
    expect(h.worker.sent.some((m) => m.type === 'mask')).toBe(true)
    h.worker.reply(h.worker.builds()[1].id)
    expect(h.wake.pending).toBe(false)
  })

  it('异步 Worker 失败后唤醒一帧，走同步回退并追上当前相机', () => {
    vi.useFakeTimers()
    const h = host()
    h.invalidate()
    expect(h.frame()).toBe(true)
    h.worker.onerror?.({})
    expect(h.dirty).toBe(true)
    expect(h.frame()).toBe(true)
    expect(h.syncBuilds).toBe(1)
    expect(h.worker.terminated).toBe(true)
    expect(h.wake.pending).toBe(false)
  })

  it('pose 判据不受节流影响；staleReason 仍保留 120ms 门', () => {
    const camera = { position: { x: 0, y: 0, z: 100 }, fov: 60 }
    const prev = terrainLodState(camera, target, aspect)
    camera.position.z = 40
    const cur = terrainLodState(camera, target, aspect)
    expect(terrainLodPoseReason(prev, cur)).toBe('distance')
    expect(terrainLodStaleReason(prev, cur, 0)).toBe(null)
    expect(terrainLodStaleReason(prev, cur, 120)).toBe('distance')
  })
})

describe('createTerrainLodWake', () => {
  it('从换装起算 120ms；重复 schedule 重置计时', () => {
    vi.useFakeTimers()
    const seen: number[] = []
    const wake = createTerrainLodWake(() => seen.push(1), () => false)
    wake.scheduleElapsed(50)
    vi.advanceTimersByTime(69)
    expect(seen).toEqual([])
    vi.advanceTimersByTime(1)
    expect(seen).toEqual([1])

    wake.scheduleElapsed(0)
    vi.advanceTimersByTime(60)
    wake.scheduleElapsed(0)
    vi.advanceTimersByTime(119)
    expect(seen).toEqual([1])
    vi.advanceTimersByTime(1)
    expect(seen).toEqual([1, 1])
  })

  it('cancel / 已销毁 时不再唤醒', () => {
    vi.useFakeTimers()
    const seen: number[] = []
    let destroyed = false
    const wake = createTerrainLodWake(() => seen.push(1), () => destroyed)
    wake.scheduleElapsed(0)
    wake.cancel()
    vi.advanceTimersByTime(1000)
    expect(seen).toEqual([])

    wake.scheduleElapsed(0)
    destroyed = true
    vi.advanceTimersByTime(1000)
    expect(seen).toEqual([])
  })
})
