// 变体场景裁剪（多变体地图：Dead Rail/.Middleburg 等 9 图按变体共用同一 space）。
//
// 上游机制（WoT-Blitz-Agent 逆向，2026-10-07 闭合）：场景把出生点/边界/专属布景
// 打成 LabelComponent 变体组（md1/md2/md3 = 字母前缀+数字序号），客户端一局只
// 激活一组；导出器按同 space 注册表 key 序配对写出 GLB extras
// `variantByMapId: {map_id: "mdN"}`，组外实体节点带 extras `{mdVariant: "mdN"}`。
// 不裁剪的表现：回放里立着游戏里没有的物体（Dead Rail 基础版出现 Railroad
// 变体的 stn_07 石头、invisiblewall 等）。
//
// 本文件只放纯函数（最小节点接口，three Object3D 兼容、可单测）；
// 接线在 playbackScene.js（GLB 装载后、网格索引构建前调用一次）。

/** map_id → 本局激活的变体标签；无映射（旧包/单变体图/口径外）→ null（不裁剪） */
export function activeVariantOf(variantByMapId, mapId) {
  if (!variantByMapId || typeof variantByMapId !== 'object') return null
  const v = variantByMapId[String(mapId)] ?? variantByMapId[Number(mapId)]
  return typeof v === 'string' ? v : null
}

/**
 * 从场景根剔除非本变体的节点，返回剔除数。
 * root.userData.variantByMapId = 映射；命中节点的 userData.mdVariant ≠ 激活标签
 * 即连同子树移除（`remove(child)` 最小接口——three Group 原生支持）。
 * 无映射 / mapId 缺失 → 0（fail-open：维持全量渲染的历史行为）。
 */
export function pruneForeignVariants(root, mapId) {
  const active = activeVariantOf(root?.userData?.variantByMapId, mapId)
  if (!active) return 0
  let pruned = 0
  const stack = [...(root.children || [])]
  while (stack.length) {
    const o = stack.pop()
    for (const c of o.children || []) stack.push(c)
    const tag = o.userData?.mdVariant
    if (tag && tag !== active && typeof o.parent?.remove === 'function') {
      o.parent.remove(o)
      pruned++
    }
  }
  return pruned
}
