import type { AgentConsumableEvent } from '../api/agent-replay-facets.js'
import type { ConsumableTransition } from '../types/playback-v2.js'
import { isFiniteNumber } from '../types/primitive-guards.js'

export type ConsumableInput = ConsumableTransition | AgentConsumableEvent

type ConsumableFields = {
  timeSec?: number
  clock?: number
  invalidation?: boolean
  consumableSlot?: number | null
  slot?: number | null
  state?: string | number | null
  state_name?: string
  durationSec?: number | null
  duration_s?: number | null
  endsAt?: number | null
  ends_at?: number | null
  logicalItemId?: string | null
  logical_item_id?: string | null
  wireCode?: number | null
  wire_code?: number | null
}

type ActiveSlot = {
  consumableSlot: number
  logicalItemId: string | null
  wireCode: number | null
  state: string
  durationSec: number | null
  endsAt: number | null
  timeSec: number
}

const EPS = 1e-6
const CLOCK_QUANTUM = 0.01
const quantizeClock = (v: number) => Math.round(v / CLOCK_QUANTUM) * CLOCK_QUANTUM

function eventTime(tr: ConsumableFields | null | undefined) {
  if (!tr) return null
  if (isFiniteNumber(tr.timeSec)) return tr.timeSec
  return isFiniteNumber(tr.clock) ? tr.clock : null
}

function firstFinite(...values: unknown[]) {
  for (const v of values) if (isFiniteNumber(v)) return v
  return null
}

function slotBadge(slot: ActiveSlot, t: number) {
  if (!slot || !Number.isFinite(t)) return null
  if (slot.state !== 'ACTIVATED') return null
  if (!(isFiniteNumber(slot.durationSec) && slot.durationSec > 0)) return null
  const end = isFiniteNumber(slot.endsAt)
    ? slot.endsAt
    : (isFiniteNumber(slot.timeSec) ? slot.timeSec + slot.durationSec : null)
  if (!isFiniteNumber(end)) return null
  const remainingSec = Math.min(slot.durationSec, Math.max(0, end - t))
  if (remainingSec <= 0) return null
  return {
    slot: slot.consumableSlot,
    logicalItemId: slot.logicalItemId ?? null,
    wireCode: slot.wireCode ?? null,
    remainingSec,
    durationSec: slot.durationSec,
  }
}

/**
 * 折叠 transition，返回 t 时刻正在生效的定时消耗品（按槽位升序）。
 *
 * 两种输入形状共用同一语义：canonical `ConsumableTransition`（2D：`timeSec` /
 * `state` / `durationSec` / `endsAt` / `consumableSlot` / `logicalItemId`）与
 * Playback facet 原始事件（3D：`clock` / `state_name` / `duration_s` / `ends_at` /
 * `slot` / `logical_item_id`）。3D 的 `T` 与 facet `clock` 同为 raw stream 时钟，
 * 不需要再减 battle origin。
 *
 * @param {readonly object[]|null|undefined} transitions
 * @param {number} t 回放时刻（与该输入的时钟同 base）
 * @param {number|null} [since] 观测窗口起点：早于它的历史事件一律忽略（AoI 重入后
 *   不得复用离开前的状态；由调用方传当前可见段起点，canonical 2D 用 invalidation 行）
 * @returns {{slot:number,logicalItemId:string|null,wireCode:number|null,remainingSec:number,durationSec:number}[]}
 */
export function consumableRuntimeAt(
  transitions: readonly ConsumableInput[] | null | undefined,
  t: number,
  since: number | null = null,
) {
  if (!Array.isArray(transitions) || !Number.isFinite(t)) return []
  const floor = isFiniteNumber(since) ? quantizeClock(since) : null
  const bySlot = new Map<number, ActiveSlot>()
  for (const event of transitions) {
    const tr: ConsumableFields = event
    const timeSec = eventTime(tr)
    if (timeSec === null || timeSec > t + EPS) continue
    if (floor !== null && timeSec < floor - EPS) continue
    if (tr.invalidation === true) {
      bySlot.clear()
      continue
    }
    const slotIndex = Number.isInteger(tr.consumableSlot) ? tr.consumableSlot as number
      : (Number.isInteger(tr.slot) ? tr.slot as number : null)
    if (slotIndex === null || slotIndex < 0 || slotIndex > 2) continue
    const state = (typeof tr.state === 'string' ? tr.state : null)
      ?? (typeof tr.state_name === 'string' ? tr.state_name : 'UNKNOWN')
    const durationSec = firstFinite(tr.durationSec, tr.duration_s)
    const endsAt = firstFinite(tr.endsAt, tr.ends_at)
    bySlot.set(slotIndex, {
      consumableSlot: slotIndex,
      logicalItemId: tr.logicalItemId ?? tr.logical_item_id ?? null,
      wireCode: tr.wireCode ?? tr.wire_code ?? null,
      state,
      durationSec: durationSec === null ? null : Math.max(0, durationSec),
      endsAt,
      timeSec,
    })
  }
  const out = []
  for (const slot of bySlot.values()) {
    const badge = slotBadge(slot, t)
    if (badge) out.push(badge)
  }
  return out.sort((a, b) => a.slot - b.slot)
}

export function createConsumableStateResolver(telemetry: { consumables?: AgentConsumableEvent[] | null } | null | undefined) {
  const byEid = new Map<number, AgentConsumableEvent[]>()
  for (const tr of telemetry?.consumables ?? []) {
    if (!tr || !Number.isFinite(tr.eid)) continue
    if (!byEid.has(tr.eid)) byEid.set(tr.eid, [])
    byEid.get(tr.eid)!.push(tr)
  }
  const at = (tr: ConsumableFields) => eventTime(tr) ?? 0
  for (const list of byEid.values()) list.sort((a, b) => at(a) - at(b))
  return (eid: number, t: number, since: number | null = null) => consumableRuntimeAt(byEid.get(eid), t, since)
}
