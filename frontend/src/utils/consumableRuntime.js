/**
 * 回放消耗品运行时：把 canonical `consumableTransitions` 折叠成「当前可展示的定时消耗品」。
 *
 * 只输出**持续一段时间的主动消耗品**在 ACTIVE / COOLDOWN 中的状态：
 * - `durationSec > 0` 才算定时；瞬发消耗品（修理箱/急救包等）不进入 HUD。
 * - `remainingSec` 由 `endsAt`（Agent 新字段）计算；旧产物缺 `endsAt` 时回退
 *   `timeSec + durationSec`。
 * - `state === 'INITIALIZED'`（未使用/已就绪）不展示；`TEARDOWN`/`UNKNOWN` 隐藏。
 * - `invalidation === true`（AoI 关闭/未知段）清空该车全部槽位，绝不把旧状态留在屏幕上。
 *
 * 纯函数，无 Vue/场景依赖；2D 与 3D 共用同一份状态语义。
 */
const EPS = 1e-6

/** 单个槽位在 t 时刻是否应展示，以及剩余秒数。 */
function slotBadge(slot, t) {
  if (!slot || !Number.isFinite(t)) return null
  if (!(slot.timed === true)) return null
  if (!(Number.isFinite(slot.durationSec) && slot.durationSec > 0)) return null
  if (slot.state !== 'ACTIVATED' && slot.state !== 'ACTIVE_ENDED_OR_COOLDOWN') return null
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
    state: slot.state === 'ACTIVATED' ? 'ACTIVE' : 'COOLDOWN',
    remainingSec,
    durationSec: slot.durationSec,
  }
}

/**
 * 折叠 canonical transitions，返回 t 时刻应展示的定时消耗品（按槽位升序）。
 * @param {readonly object[]|null|undefined} transitions
 * @param {number} t 回放相对秒
 * @returns {{slot:number,logicalItemId:string|null,wireCode:number|null,state:'ACTIVE'|'COOLDOWN',remainingSec:number,durationSec:number}[]}
 */
export function consumableRuntimeAt(transitions, t) {
  if (!Array.isArray(transitions) || !Number.isFinite(t)) return []
  const bySlot = new Map()
  for (const tr of transitions) {
    if (!tr || !Number.isFinite(tr.timeSec) || tr.timeSec > t + EPS) continue
    if (tr.invalidation === true) {
      bySlot.clear()
      continue
    }
    const slotIndex = Number.isInteger(tr.consumableSlot) ? tr.consumableSlot : null
    if (slotIndex === null || slotIndex < 0 || slotIndex > 2) continue
    const state = typeof tr.state === 'string' ? tr.state : 'UNKNOWN'
    const durationSec = Number.isFinite(tr.durationSec) ? Math.max(0, tr.durationSec) : null
    const endsAt = Number.isFinite(tr.endsAt) ? tr.endsAt : null
    const prev = bySlot.get(slotIndex)
    // 「是否是定时消耗品」只在 ACTIVATED 时由 duration 定：state3 的 duration 是冷却，
    // 不能反过来把瞬发消耗品升级成定时；INITIALIZED/TEARDOWN/UNKNOWN 结束该生命周期。
    let timed = prev?.timed === true
    if (state === 'ACTIVATED') timed = durationSec !== null && durationSec > 0
    if (state === 'INITIALIZED' || state === 'TEARDOWN' || state === 'UNKNOWN') timed = false
    bySlot.set(slotIndex, {
      consumableSlot: slotIndex,
      logicalItemId: tr.logicalItemId ?? null,
      wireCode: tr.wireCode ?? null,
      state,
      durationSec,
      endsAt,
      timeSec: tr.timeSec,
      timed,
    })
  }
  const out = []
  for (const slot of bySlot.values()) {
    const badge = slotBadge(slot, t)
    if (badge) out.push(badge)
  }
  return out.sort((a, b) => a.slot - b.slot)
}

/** 按 eid 建一次索引，返回 `(eid, t) => badge[]`（3D 10Hz 名牌快照用）。 */
export function createConsumableStateResolver(telemetry) {
  const byEid = new Map()
  for (const tr of telemetry?.consumables ?? []) {
    if (!tr || !Number.isFinite(tr.eid)) continue
    if (!byEid.has(tr.eid)) byEid.set(tr.eid, [])
    byEid.get(tr.eid).push(tr)
  }
  for (const list of byEid.values()) list.sort((a, b) => a.timeSec - b.timeSec)
  return (eid, t) => consumableRuntimeAt(byEid.get(eid), t)
}
