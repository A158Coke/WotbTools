import { GRID_DT } from '../trackInterp.js'

export interface LastKnownPose {
  t: number
  pos: [number, number, number]
}

const SPAN_EPS = 1e-6

/**
 * 求某坦克在回放时刻 `t` 的最后已知位姿。
 *
 * @param spans 协议 AoI 在场段 flat `[t_in, t_out, ...]`（升序；末段缺 t_out = 战斗结束 →
 *              +∞，与 `visibilitySpansByEid` 的投影一致；coverage 同形状可用）
 * @param t     当前回放时刻（回放时钟域）
 * @param pos   该坦克 0.1s 采样位姿扁平数组 `[x,y,z] × samples`（AgentVehicleTrack.pos；
 *              采样 i 的时刻 = `tStart + i * GRID_DT`）
 * @param tStart 位姿网格起点（`meta.t_start`，回放时钟域）
 * @returns 在场 → null；不在场且有证据 → `{ t, pos }`；无证据/输入畸形 → null
 */
export function lastKnownPoseAt(
  spans: readonly number[] | null | undefined,
  t: number,
  pos: readonly number[] | null | undefined,
  tStart: number,
): LastKnownPose | null {
  if (!Array.isArray(spans) || !Number.isFinite(t) || !Number.isFinite(tStart)) return null
  if (!Array.isArray(pos) || pos.length < 3 || pos.length % 3 !== 0) return null
  const n = pos.length / 3
  let hasCandidate = false
  let candStart = 0
  let candEnd = 0
  for (let i = 0; i + 1 < spans.length; i += 2) {
    const start = spans[i]
    const end = spans[i + 1]
    if (!Number.isFinite(start) || (!Number.isFinite(end) && end !== Number.POSITIVE_INFINITY)) continue
    if (t >= start - SPAN_EPS && t <= end + SPAN_EPS) return null
    if (start <= t + SPAN_EPS) {
      hasCandidate = true
      candStart = start
      candEnd = end
    }
  }
  if (!hasCandidate) return null
  const rawIdx = Number.isFinite(candEnd)
    ? Math.floor((candEnd - tStart) / GRID_DT + 1e-9)
    : n - 1
  const idx = Math.min(n - 1, rawIdx)
  if (idx < 0) return null
  const sampleT = tStart + idx * GRID_DT
  if (sampleT < candStart - SPAN_EPS) return null
  return { t: sampleT, pos: [pos[idx * 3], pos[idx * 3 + 1], pos[idx * 3 + 2]] }
}

export function replacedBySuccessorAt(
  vehicles: ReadonlyArray<{ eid: number; account_id?: number | null }> | null | undefined,
  spansOf: (eid: number) => readonly number[] | null | undefined,
  eid: number,
  t: unknown,
): boolean {
  const now = Number(t)
  if (!Array.isArray(vehicles) || !Number.isFinite(now)) return false
  const self = vehicles.find((v) => v?.eid === eid)
  if (!self || self.account_id == null) return false
  const selfEnd = lastSpanEnd(spansOf(eid))
  if (selfEnd == null) return false
  for (const other of vehicles) {
    if (!other || other.eid === eid || other.account_id !== self.account_id) continue
    const otherStart = firstSpanStart(spansOf(other.eid))
    if (otherStart == null || otherStart <= selfEnd + SPAN_EPS) continue
    if (now >= otherStart - SPAN_EPS) return true
  }
  return false
}

function firstSpanStart(spans: readonly number[] | null | undefined): number | null {
  if (!Array.isArray(spans) || spans.length < 2) return null
  for (let i = 0; i + 1 < spans.length; i += 2) {
    if (Number.isFinite(spans[i])) return spans[i]
  }
  return null
}

function lastSpanEnd(spans: readonly number[] | null | undefined): number | null {
  if (!Array.isArray(spans) || spans.length < 2) return null
  let end: number | null = null
  for (let i = 0; i + 1 < spans.length; i += 2) {
    const e = spans[i + 1]
    if (Number.isFinite(e)) end = e
    else if (e === Number.POSITIVE_INFINITY) end = e
  }
  return end
}
