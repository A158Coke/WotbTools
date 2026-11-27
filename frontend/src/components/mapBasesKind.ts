
export type BasesKind = 'supremacy' | 'assault'

export interface MapBasesGroups {
  supremacy?: unknown[] | null
  assault?: unknown[] | null
}

export const BASES_QUERY_KINDS: Record<string, BasesKind> = { supremacy: 'supremacy', encounter: 'assault' }

export function assaultSelectable(bases: MapBasesGroups | null | undefined): boolean {
  return bases?.assault?.length === 1
}

export function resolveBasesKind(
  bases: MapBasesGroups | null | undefined,
  queryBases: string | null | undefined,
): BasesKind | null {
  if (!bases) return null
  const fromUrl = queryBases ? BASES_QUERY_KINDS[queryBases] : undefined
  if (fromUrl === 'supremacy' && bases.supremacy?.length) return 'supremacy'
  if (fromUrl === 'assault' && assaultSelectable(bases)) return 'assault'
  if (bases.supremacy?.length) return 'supremacy'
  if (assaultSelectable(bases)) return 'assault'
  return null
}
