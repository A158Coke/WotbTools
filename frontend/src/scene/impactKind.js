/**
 * 命中类型判定（纯函数，供 3D 弹着点特效分型；与 2D 判定同源语义）。
 *
 * - 作者路径：看 `hit_flags` 位（服务器逐发下发，权威）——`0x0008` 跳弹；
 *   `0x0010 | 0x0040 | 0x0100 | 0x1000` 击穿族。
 * - 非作者路径：按 `game_hit_result` 枚举降级，**该枚举里没有"跳弹"取值**
 *   （`0` 无 / `1` 未击穿 / `2` 间隙止 / `3` 有伤害 / `4` 履带·模块 / `255` 未获取）——
 *   故 `1`、`2` 绝不能当跳弹：那会凭空画出侧向 sparks，等于伪造未经证明的弹着结果。
 * - 无 `target_eid`（脱靶或目标未知）一律 `null`，不生成 target impact。
 *
 * @param {{ target_eid?: number|null, hit_flags?: number, is_author?: boolean,
 *           game_hit_result?: number }} shot
 * @returns {'pen'|'nonpen'|'ricochet'|null}
 */
export function impactKind(shot) {
  if (shot.target_eid == null) return null
  const f = shot.hit_flags || 0
  if (shot.is_author && f) {
    if (f & 0x0008) return 'ricochet'
    if (f & (0x0010 | 0x0040 | 0x0100 | 0x1000)) return 'pen'
    return 'nonpen'
  }
  const r = shot.game_hit_result
  if (r === 3) return 'pen'
  if (r === 1 || r === 2 || r === 4) return 'nonpen'
  return null
}
