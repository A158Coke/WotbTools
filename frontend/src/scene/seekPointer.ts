/**
 * 事件游标定位（seek 语义的纯函数，便于单测）。
 *
 * 回放事件按时间升序排列。seek 到 t 之后，各事件游标必须指向
 * **第一条 t_event > t 的事件**——否则紧随其后的 tick() 会把 `t <= T` 的历史事件
 * 一次性补播（飘字/爆散全部同时刷出）。与 2D 同语义：seek 只恢复确定性状态，
 * **不重放历史 transient**。
 *
 * @param {Array} events 按时间升序的事件数组
 * @param {number} t 目标时刻（含）
 * @param {(e: any) => number} [keyOf] 取时刻的函数，缺省 `e => e.t`
 * @returns {number} 第一个时刻 > t 的下标（全部 <= t 时返回 events.length）
 */
export function firstIndexAfter(events, t, keyOf) {
  const at = keyOf || ((e) => e.t)
  let i = 0
  while (i < events.length && at(events[i]) <= t) i++
  return i
}
