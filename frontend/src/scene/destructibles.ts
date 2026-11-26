import type { AgentDestructibleArea, AgentDestructibleEvent } from '../api/agent-replay-facets.js'

export interface DestructibleInstance {
  id: string
  pos: [number, number]
  kind?: string
  name?: string
  serverId?: { cell: [number, number]; slot: number } | null
}

export type DestructibleArea = AgentDestructibleArea

export type DestructibleEvent = AgentDestructibleEvent

export interface DestructibleSlot {
  mesh: import('three').InstancedMesh
  idx: number
  base: import('three').Matrix4
}

export interface DestructibleFoldState {
  key: string
  clock: number
  prop: number
  fallDir: number
  inst: DestructibleInstance
  slots?: DestructibleSlot[]
  intactSlots?: DestructibleSlot[]
  deadSlots?: DestructibleSlot[]
  pivotPos?: { x: number; y: number; z: number }
  upright?: boolean
  settled?: boolean
  fallQuat?: { w: number } | null
  pivot?: { quaternion?: { w: number } } | null
  heightM?: number
  stopRad?: number
}

export interface TreeFrameResult {
  axis: number[]
  angle: number
  animating: boolean
}

export function resolveDestructibleEvent(
  ev: DestructibleEvent,
  areasByEid: Map<number, DestructibleArea>,
  index: Map<string, DestructibleInstance>,
): DestructibleInstance | null {
  const area = areasByEid.get(ev.area_eid)
  if (!area) return null
  const cx = Math.floor(area.x / 100)
  const cy = Math.floor(area.z / 100)
  for (const dx of [0, -1, 1]) {
    for (const dz of [0, -1, 1]) {
      const hit = index.get(`${cx + dx},${cy + dz},${ev.slot}`)
      if (hit) return hit
    }
  }
  return null
}

export function buildDestructibleIndex(doc: { instances?: readonly DestructibleInstance[] | null } | null | undefined): Map<string, DestructibleInstance> {
  const index = new Map<string, DestructibleInstance>()
  if (!doc || !Array.isArray(doc.instances)) return index
  for (const inst of doc.instances) {
    const srv = inst.serverId
    if (!srv) continue
    const key = `${srv.cell[0]},${srv.cell[1]},${srv.slot}`
    if (!index.has(key)) index.set(key, inst)
  }
  return index
}

export function fallTipVector(fallDir8: number): [number, number] {
  const a = (fallDir8 / 256) * Math.PI * 2
  return [-Math.sin(a), -Math.cos(a)]
}

export const TREE_FALL_MIN_S = 0.45
export const TREE_FALL_MAX_S = 3.0
export const TREE_FALL_DEFAULT_HEIGHT_M = 6
export const TREE_FALL_MIN_STOP_RAD = (20 * Math.PI) / 180
const GROUND_PROBES = 10

export function fallDurationS(heightM: number | null | undefined): number {
  const L = typeof heightM === 'number' && Number.isFinite(heightM) && heightM > 0 ? heightM : TREE_FALL_DEFAULT_HEIGHT_M
  const t = 1.51 * Math.sqrt(L / 9.81)
  return Math.min(TREE_FALL_MAX_S, Math.max(TREE_FALL_MIN_S, t))
}

/**
 * 停止角（弧度）：树干绕根部转到**触及地形**为止的角度。
 *
 * @param fallDir8 倒向字节（倒向 = tip 方向的反向，见 fallTipVector）
 * @param base 树根位置（**gltf.scene 局部系**：x/y 水平、z 上）
 * @param heightM 树高（米）
 * @param sampleGround 局部系 (x,y) → 地面高度（米，与 base.z 同基准）；缺失（无高度场）→ 平坦地面假设，返回 90°。
 * @param minStopRad 停止角下限（默认 TREE_FALL_MIN_STOP_RAD）
 * @returns 停止角 ∈ [minStop, π/2]
 *
 * 判据：θ 从下限起每 1° 扫描，树干轴上的采样点世界高度 = base.z + h·cosθ，
 * 水平位置 = base + tip·h·sinθ；任一采样点落到地面（≤ 地面高度）即认为已停靠。
 */
export function fallStopAngle(
  fallDir8: number,
  base: { x: number; y: number; z: number },
  heightM: number | null | undefined,
  sampleGround: ((lx: number, ly: number) => number) | null | undefined,
  minStopRad: number = TREE_FALL_MIN_STOP_RAD,
): number {
  const flat = Math.PI / 2
  if (typeof sampleGround !== 'function') return flat
  const L = typeof heightM === 'number' && Number.isFinite(heightM) && heightM > 0.5 ? heightM : TREE_FALL_DEFAULT_HEIGHT_M
  const minStop = Math.min(Math.max(minStopRad, 0), flat)
  const [dx, dy] = fallTipVector(fallDir8)
  const step = Math.PI / 180
  for (let th = minStop; th <= flat + 1e-9; th += step) {
    const s = Math.sin(th)
    const c = Math.cos(th)
    for (let i = 1; i <= GROUND_PROBES; i++) {
      const h = (L * i) / GROUND_PROBES
      const gz = sampleGround(base.x + dx * h * s, base.y + dy * h * s)
      if (!Number.isFinite(gz)) continue
      if (base.z + c * h <= gz) return Math.min(th, flat)
    }
  }
  return flat
}

export function fallRotation(
  fallDir8: number,
  elapsedS: number,
  heightM: number | null | undefined,
  stopRad: number | null | undefined = Math.PI / 2,
): { axis: number[]; angle: number; durationS: number; stopRad: number } | null {
  if (!(elapsedS >= 0)) return null
  const durationS = fallDurationS(heightM)
  const u = Math.min(1, elapsedS / durationS)
  const stop = Math.min(Math.max(typeof stopRad === 'number' && Number.isFinite(stopRad) ? stopRad : Math.PI / 2, 0), Math.PI / 2)
  const [dx, dy] = fallTipVector(fallDir8)
  return { axis: [-dy, dx, 0], angle: stop * u, durationS, stopRad: stop }
}

export function treeFrame(st: DestructibleFoldState, active: unknown, T: number): TreeFrameResult | null {
  if (!active) return null
  const elapsed = T - st.clock
  if (!(elapsed >= 0)) return null
  const r = fallRotation(st.fallDir, elapsed, st.heightM, st.stopRad)
  if (r && elapsed < r.durationS) {
    return { axis: r.axis, angle: r.angle, animating: true }
  }
  if (!st.settled) {
    st.settled = true
    const [dx, dy] = fallTipVector(st.fallDir)
    return { axis: [-dy, dx, 0], angle: r ? r.stopRad : Math.PI / 2, animating: false }
  }
  return null
}

function makeTreeStateRewindSafe(state: DestructibleFoldState): DestructibleFoldState {
  let settled = false
  Object.defineProperty(state, 'settled', {
    enumerable: true,
    configurable: true,
    get() {
      if (!settled) return false
      const q = state.fallQuat ?? state.pivot?.quaternion
      if (!q || !Number.isFinite(q.w)) return settled
      const stop = typeof state.stopRad === 'number' && Number.isFinite(state.stopRad) ? state.stopRad : Math.PI / 2
      const w = Math.min(1, Math.max(0, Math.abs(q.w)))
      const angle = 2 * Math.acos(w)
      return angle >= Math.max(0, stop - 1e-4)
    },
    set(value) { settled = !!value },
  })
  return state
}

export function foldDestructibleStates(
  events: readonly DestructibleEvent[] | null | undefined,
  areasByEid: Map<number, DestructibleArea>,
  index: Map<string, DestructibleInstance>,
): DestructibleFoldState[] {
  const byKey = new Map<string, DestructibleFoldState>()
  for (const ev of events || []) {
    const inst = resolveDestructibleEvent(ev, areasByEid, index)
    if (!inst) continue
    const prev = byKey.get(inst.id)
    if (!prev || ev.clock < prev.clock) {
      const state: DestructibleFoldState = { key: inst.id, clock: ev.clock, prop: ev.prop, fallDir: ev.fall_dir, inst }
      byKey.set(inst.id, ev.prop === 3 ? makeTreeStateRewindSafe(state) : state)
    }
  }
  return [...byKey.values()].sort((a, b) => a.clock - b.clock)
}
