
export function activeVariantOf(variantByMapId: unknown, mapId: number | string): string | null {
  if (!variantByMapId || typeof variantByMapId !== 'object') return null
  const byMapId = variantByMapId as Record<string | number, unknown>
  const v = byMapId[String(mapId)] ?? byMapId[Number(mapId)]
  return typeof v === 'string' ? v : null
}

export interface VariantPruneNode {
  userData?: { variantByMapId?: unknown; mdVariant?: unknown } & Record<string, unknown>
  children?: readonly VariantPruneNode[]
  parent?: { remove: (child: VariantPruneNode) => unknown } | null
}

export interface PruneForeignVariantsResult {
  removed: number
  failClosed: boolean
}

export function pruneForeignVariantsDetailed(root: VariantPruneNode | null | undefined, mapId: number | string): PruneForeignVariantsResult {
  const mapping = root?.userData?.variantByMapId
  const active = activeVariantOf(mapping, mapId)
  const tagged: VariantPruneNode[] = []
  const stack: VariantPruneNode[] = [...(root?.children || [])]
  while (stack.length) {
    const o = stack.pop()
    if (!o) break
    for (const c of o.children || []) stack.push(c)
    if (o.userData?.mdVariant) tagged.push(o)
  }
  if (!tagged.length) return { removed: 0, failClosed: false }
  if (!active) {
    const hasMapping = !!(mapping && typeof mapping === 'object' && Object.keys(mapping as object).length)
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
    if (o.userData?.mdVariant !== active && typeof o.parent?.remove === 'function') {
      o.parent.remove(o)
      pruned++
    }
  }
  return { removed: pruned, failClosed: false }
}

export function pruneForeignVariants(root: VariantPruneNode | null | undefined, mapId: number | string): number {
  return pruneForeignVariantsDetailed(root, mapId).removed
}
