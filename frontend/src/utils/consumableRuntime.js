/**
 * 回放消耗品运行时：把消耗品 lifecycle 折叠成「此刻正在生效的主动消耗品」。
 *
 * 只输出**定时主动消耗品在激活窗口内**的状态（`ACTIVATED` 且 `durationSec > 0`）：
 * - 瞬发消耗品（修理箱/急救包等，激活 duration=0）不进入 HUD。
 * - 冷却（`ACTIVE_ENDED_OR_COOLDOWN`）、未使用/已就绪（`INITIALIZED`）、
 *   `TEARDOWN`/`UNKNOWN` 一律不展示——HUD 只表达「现在正在生效」。
 * - `remainingSec` 由 `endsAt` 计算；旧产物缺 `endsAt` 时回退 `timeSec + durationSec`。
 * - `invalidation === true`（AoI 关闭/未知段）清空该车全部槽位，绝不把旧状态留在屏幕上。
 *
 * 纯函数，无 Vue/场景依赖；2D 与 3D 共用同一份状态语义。
 */
const EPS = 1e-6

/** 事件时刻：canonical `timeSec` 或 facet 原始 `clock`（同 base，不做 origin 变换）。 */
function eventTime(tr) {
  if (!tr) return null
  if (Number.isFinite(tr.timeSec)) return tr.timeSec
  return Number.isFinite(tr.clock) ? tr.clock : null
}

function firstFinite(...values) {
  for (const v of values) if (Number.isFinite(v)) return v
  return null
}

/** 单个槽位在 t 时刻是否处于激活窗口，以及剩余秒数。 */
function slotBadge(slot, t) {
  if (!slot || !Number.isFinite(t)) return null
  if (slot.state !== 'ACTIVATED') return null
  if (!(Number.isFinite(slot.durationSec) && slot.durationSec > 0)) return null
  const end = Number.isFinite(slot.endsAt)
    ? slot.endsAt
    : (Number.isFinite(slot.timeSec) ? slot.timeSec + slot.durationSec : null)
  if (!Number.isFinite(end)) return null
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
export function consumableRuntimeAt(transitions, t, since = null) {
  if (!Array.isArray(transitions) || !Number.isFinite(t)) return []
  const floor = Number.isFinite(since) ? since : null
  const bySlot = new Map()
  for (const tr of transitions) {
    const timeSec = eventTime(tr)
    if (timeSec === null || timeSec > t + EPS) continue
    if (floor !== null && timeSec < floor - EPS) continue
    if (tr.invalidation === true) {
      bySlot.clear()
      continue
    }
    const slotIndex = Number.isInteger(tr.consumableSlot) ? tr.consumableSlot
      : (Number.isInteger(tr.slot) ? tr.slot : null)
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

/** 按 eid 建一次索引，返回 `(eid, t, since?) => badge[]`（3D 10Hz 名牌快照用）。 */
export function createConsumableStateResolver(telemetry) {
  const byEid = new Map()
  for (const tr of telemetry?.consumables ?? []) {
    if (!tr || !Number.isFinite(tr.eid)) continue
    if (!byEid.has(tr.eid)) byEid.set(tr.eid, [])
    byEid.get(tr.eid).push(tr)
  }
  const at = (tr) => eventTime(tr) ?? 0
  for (const list of byEid.values()) list.sort((a, b) => at(a) - at(b))
  return (eid, t, since = null) => consumableRuntimeAt(byEid.get(eid), t, since)
}
