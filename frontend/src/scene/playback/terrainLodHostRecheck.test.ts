// 地形 LOD 宿主复查回归（PR #954 评审 F3/F4）：
// 「暂停/停手 → 在途任务构建期间移动相机 → 停下 → Worker 结果换装 → 节流到期」
// 必须再唤醒一帧并按最终相机提交一次；异步失败必须唤醒同步回退。
//
// 这里用真实的 scheduler / terrainLodPoseReason / terrainLodStaleReason / terrainLodWake，
// 只把宿主的 rAF 循环与 dirty 标记压成一个显式 frame()（与 playbackScene.animate 的
// `!busy` 提前返回同口径：不脏就不进 maybeRebuildTerrainLod）。
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
      // 生产 applyTerrainSwap：换装快照与当前相机不一致时，节流到期唤醒一帧。
      if (terrainLodPoseReason(job.snapshot, state())) wake.scheduleElapsed(now - prevAt)
      else wake.cancel()
    },
    onWorkerLost: () => {
      // 生产 mapWorld.onWorkerLost 的同一条唤醒（deps.invalidate()）：异步失败也要有同步回退的帧。
      scheduler = null
      invalidate()
    },
    onDiscard: () => {
      // 生产 mapWorld.onDiscard 的同一条唤醒：作废的在途结果返回后没有「下一帧」。
      invalidate()
    },
  })
  scheduler.setSource(SRC)

  /** 一帧宿主循环：dirty 才进入 maybeRebuildTerrainLod（与 playbackScene 的 !busy 早退同口径）。 */
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
    /** 生产 onRefineMaskBuilt：terrainLodPrev=null + invalidate + scheduler.setMask。 */
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
    expect(h.frame()).toBe(true)                       // 首帧请求 d=100
    expect(h.builds).toEqual([100])
    expect(h.worker.builds()).toHaveLength(1)
    const first = h.worker.builds()[0].id

    // 在途期间相机拉近到 40 后停手；宿主没有播放 / 相机输入，不再有帧。
    h.camera.position.z = 40
    h.advance(200)
    h.worker.reply(first)                              // 旧快照（d=100）此刻换上
    expect(h.builds).toEqual([100])
    expect(h.wake.pending).toBe(true)

    // 节流窗口内绝不提交；到期后必须唤醒并提交最终姿态。
    h.advance(119)
    expect(h.dirty).toBe(false)
    expect(h.frame()).toBe(false)
    h.advance(1)
    expect(h.dirty).toBe(true)
    expect(h.frame()).toBe(true)
    expect(h.builds).toEqual([100, 40])
    expect(h.worker.builds()).toHaveLength(2)
    expect(h.worker.builds()[1].cam.z).toBe(40)

    // 新结果与当前相机一致：不再安排下一次唤醒。
    h.worker.reply(h.worker.builds()[1].id)
    expect(h.wake.pending).toBe(false)
  })

  it('在途时掩码失效：busy 期间的新请求被忽略，旧结果丢弃后唤醒并提交新掩码构建', () => {
    vi.useFakeTimers()
    const h = host()
    h.invalidate()
    expect(h.frame()).toBe(true)
    const first = h.worker.builds()[0].id
    // 构建期间走廊掩码完成：setMask 作废旧代号；宿主立刻请求仍被 busy 忽略。
    h.setMask(new Uint8Array(1))
    expect(h.frame()).toBe(true)
    expect(h.worker.builds()).toHaveLength(1)
    // 旧结果返回：不换装，但 onDiscard 必须唤醒宿主（停手时没有「下一帧」）。
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
    h.worker.onerror?.({})                             // 停手后的异步失败
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
    wake.scheduleElapsed(0)                            // 换装更晚：重新计 120ms
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
