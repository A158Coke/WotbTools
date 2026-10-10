/**
 * 地形让位掩码的消费端（纯函数，单测看护）。
 *
 * 掩码由上游 `tools/bake_terrain_cover.py` 烘焙：逐 texel u16，`0` = 无覆盖（哨兵），
 * 否则 `(v − 1)·k + zmin` = 该 texel 处**渲染用高度上限**（天花板）。烘焙时已保证：
 *   · 只压不抬（地形本就低于结构面处不生效）；
 *   · 压低量 ≤ 0.4 m，并在 20 texel 内线性收尾（边界连续）⇒ 不会挖沟、不会在低处开槽。
 *
 * 这里只做一件事：`渲染高度 = min(原高度, 天花板)`。**它只作用于渲染用高度场**——
 * 查询/放置（`sampleHeight`、拾取、贴花）继续用真值高度场，故本模块的产物不得回流到查询路径。
 */

/** @param field Float32Array 真值高度场（米）
 *  @param coverU16 Uint16Array 掩码（同尺寸；0 = 无覆盖）
 *  @param k (zmax−zmin)/65535  @param zmin 最低高度
 *  @returns { field, changed } field = 应用后的**新数组**（不改入参）；changed = 被压低的 texel 数 */
export function applyTerrainCover(field, coverU16, k, zmin) {
  const out = Float32Array.from(field)
  let changed = 0
  const n = Math.min(out.length, coverU16.length)
  for (let i = 0; i < n; i++) {
    const v = coverU16[i]
    if (v < 1) continue                                   // 哨兵：无覆盖
    const ceilH = (v - 1) * k + zmin
    if (ceilH < out[i]) { out[i] = ceilH; changed++ }     // 只压不抬
  }
  return { field: out, changed }
}
