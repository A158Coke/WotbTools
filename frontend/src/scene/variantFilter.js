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

/** map_id → 本局激活的变体标签；无映射/当前 id 不在映射（旧包/口径外）→ null（调用方 fail-closed） */
export function activeVariantOf(variantByMapId, mapId) {
  if (!variantByMapId || typeof variantByMapId !== 'object') return null
  const v = variantByMapId[String(mapId)] ?? variantByMapId[Number(mapId)]
  return typeof v === 'string' ? v : null
}

/**
 * 从场景根剔除非本变体的节点，返回剔除数。
 * root.userData.variantByMapId = 映射；命中节点的 userData.mdVariant ≠ 激活标签
 * 即连同子树移除（`remove(child)` 最小接口——three Group 原生支持）。
 *
 * **fail-closed**：只要 GLB 里存在 mdVariant 节点、但没有可用的激活组（映射缺失，
 * 或映射存在但当前 map_id 不在其中），就移除**所有**带标记节点并告警——不能像旧
 * 行为那样 fail-open 全量渲染（Dead Rail/Middleburg 等 9 图会出现游戏里不存在的
 * 幻影布景）。无标记节点时仍是 no-op。
 */
export function pruneForeignVariantsDetailed(root, mapId) {
  const mapping = root?.userData?.variantByMapId
  const active = activeVariantOf(mapping, mapId)
  const tagged = []
  const stack = [...(root?.children || [])]
  while (stack.length) {
    const o = stack.pop()
    for (const c of o.children || []) stack.push(c)
    if (o.userData?.mdVariant) tagged.push(o)
  }
  if (!tagged.length) return { removed: 0, failClosed: false }
  if (!active) {
    const hasMapping = !!(mapping && typeof mapping === 'object' && Object.keys(mapping).length)
    const reason = hasMapping
      ? `map_id=${String(mapId)} 不在 variantByMapId`
      : '缺少 variantByMapId（旧包或变体映射不完整）'
    console.warn(`变体裁剪 fail-closed：${reason}，隐藏 ${tagged.length} 个变体节点`)
    let removed = 0
    for (const o of tagged) {
      if (typeof o.parent?.remove === 'function') { o.parent.remove(o); removed++ }
    }
    return { removed, failClosed: true }
  }
  let pruned = 0
  for (const o of tagged) {
    if (o.userData.mdVariant !== active && typeof o.parent?.remove === 'function') {
      o.parent.remove(o)
      pruned++
    }
  }
  return { removed: pruned, failClosed: false }
}

/** 兼容包装：旧调用方只关心剔除数量；需要 fail-closed 信号（运行时降级/烘焙中止）
 *  用 {@link pruneForeignVariantsDetailed}。 */
export function pruneForeignVariants(root, mapId) {
  return pruneForeignVariantsDetailed(root, mapId).removed
}
