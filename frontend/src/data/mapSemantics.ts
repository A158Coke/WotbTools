import { indexMapGridProfiles, type MapGridProfile } from '../replay-local/playback/toMapOverview.js'

let gridProfiles: Map<string, MapGridProfile> | null = null

export function mapGridProfile(mapKey: string | number): MapGridProfile | null {
  gridProfiles ??= indexMapGridProfiles(Object.values(import.meta.glob('../../../common/map-semantics/*.semantic.json', {
    eager: true, import: 'default',
  }) as Record<string, unknown>))
  return gridProfiles.get(String(mapKey).toLowerCase()) ?? null
}

export function profileMatchesVariant(
  profile: MapGridProfile | null | undefined,
  variant: string | null | undefined,
  isBase = true,
): boolean {
  if (!profile) return false
  if (isBase) return true
  const tagged = (profile.battleVariant || '').trim().toLowerCase()
  const selected = String(variant || '').trim().toLowerCase()
  if (!tagged || !selected) return false
  return tagged === selected
}
