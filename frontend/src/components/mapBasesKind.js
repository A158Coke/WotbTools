// 地图预览基地点位模式解析（从 MapPreviewPage 抽出，便于锁 fail-closed 口径）。
//
// mapBases 组键：supremacy = 争霸基地；assault = 攻防/遭遇共用（客户端 .sc2 提取）。
// 遭遇的可用性判据：assault 组**恰好 1 个 candidate** —— 多 candidate（攻防/遭遇条目
// 无法归属，回放同式 fail-closed 不画）不提供遭遇选项，否则选中后两端渲染 0 个点位。

export const BASES_QUERY_KINDS = { supremacy: 'supremacy', encounter: 'assault' }

export function assaultSelectable(bases) {
  return bases?.assault?.length === 1
}

/** URL ?bases= + 当前地图点位 → 下发给两个 pane 的组键（'supremacy'|'assault'|null）。 */
export function resolveBasesKind(bases, queryBases) {
  if (!bases) return null
  const fromUrl = BASES_QUERY_KINDS[queryBases]
  if (fromUrl === 'supremacy' && bases.supremacy?.length) return 'supremacy'
  if (fromUrl === 'assault' && assaultSelectable(bases)) return 'assault'
  if (bases.supremacy?.length) return 'supremacy'
  if (assaultSelectable(bases)) return 'assault'
  return null
}
