import type { HealthTransition } from '../types/playback-v2.js'

/**
 * battlePlaybackV2 / battlePlaybackStatsV2 共享的 HP 条读数工具（#LOC 结构拆分出仓；
 * 代码与搬移前逐字一致）。仅限同目录纯查询模块消费——不是公共 API。
 */

/** Recorded totals are authoritative where available; victim attribution still supplies received damage. */
/**
 * 承受伤害 = HP 条（healthTransitions）上可信读数在 t 之前的累计下降——与详情里「当前 HP」同源。
 * canonical DamageLoss 按 Java 口径只用相邻 prop3 采样，会漏掉车辆点亮 / 重新进入视野时 materialization
 * 读数参与的那段掉血（HP 条已经掉了、承受伤害却没算）。车辆库 provisional 开局种子不是观测值，不作下降起点；
 * 无效读数（null）不打断链条：跨失效边界的下降仍按前后两个可信读数计算。
 */
export function receivedFromHealthAt(transitions: readonly HealthTransition[] | null | undefined, t: number): number {
  let received = 0
  let last: number | null = null
  for (const h of transitions || []) {
    if (!h || !Number.isFinite(h.timeSec) || h.timeSec > t + 1e-6) break
    if (typeof h.currentHp !== 'number' || !Number.isFinite(h.currentHp)) continue
    if (last !== null && h.currentHp < last) received += last - h.currentHp
    last = h.source === 'TANKOPEDIA_BASE_PROVISIONAL' ? null : h.currentHp
  }
  return received
}
