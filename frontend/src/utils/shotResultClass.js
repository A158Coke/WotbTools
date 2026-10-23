/**
 * 服务器命中结果分类（3D 射击复现头部 / 旧版对照面板共用）。
 *
 * 语义权威（上游 Agent 仓 docs/wotbtools-cross-reference.md §三.2）：
 * - `game_hit_result`：0=无结果 / 1=未击穿 / 2=间隙层止 / 3=有伤害（击穿/HE）/
 *   **4 = raw（语义未定）** / 255=未获取。
 *   4 既可能是履带/模块交互（cmpIndex 0/3、0 伤），也可能带伤；旧实现把 4 映射成
 *   RICOCHET（或 2D 列表映射成履带）都是未证实的符号命名。按裁决保留 raw：
 *   4 显示「结果未定」，不计入跳弹/击穿/未穿对照。
 * - 作者路径 `hit_flags` 位图优先（HE/材料击穿/跳弹/其余未穿）；他人路径
 *   `hit_flags` 恒 0，用 result 枚举降级。
 */

export const SHOT_RESULT = Object.freeze({
  MISS: 'MISS',
  UNVERIFIED: 'UNVERIFIED',
  PENETRATION: 'PENETRATION',
  RICOCHET: 'RICOCHET',
  NO_PENETRATION: 'NO PENETRATION',
  HE_BLAST: 'HE BLAST',
  HIT: 'HIT',
})

/** @param {{target_eid?: number|null, target_name?: string, hit_flags?: number,
 *           damage?: number, game_hit_result?: number|null}} shot */
export function shotResultClass(shot) {
  if (!shot) return SHOT_RESULT.HIT
  const hasTarget = shot.target_eid != null || !!(shot.target_name || '').trim()
  if (!hasTarget) return SHOT_RESULT.MISS

  const f = shot.hit_flags || 0
  const r = shot.game_hit_result

  // 作者位图：与 2D 列表 shotPresentation 同序（HE → 材料击穿 → 跳弹 → 其余未穿）。
  if (f) {
    if (f & 0x1000) return SHOT_RESULT.HE_BLAST
    if (f & 0x0010) return SHOT_RESULT.PENETRATION
    if (f & 0x0008) return SHOT_RESULT.RICOCHET
    return SHOT_RESULT.NO_PENETRATION
  }

  // 他人（或作者位图缺失）：result 枚举是唯一权威；4 保持未定，不猜语义。
  if (r === 4) return SHOT_RESULT.UNVERIFIED
  if (r === 3) return SHOT_RESULT.PENETRATION
  if (r === 1 || r === 2) return SHOT_RESULT.NO_PENETRATION
  // 0/255：服务器未通知结果。damage 只能证明“有伤害”，不能反推穿透/跳弹；
  // 与 2D 列表一致显示 HIT（结果未知），不伪造 PEN/RIC。
  return SHOT_RESULT.HIT
}
