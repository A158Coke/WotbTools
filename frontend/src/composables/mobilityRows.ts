import { terrains, effectivePower, type Mobility, type Terrain } from '../replay-local/compute/mobility'

export interface MobilityRow {
  key: string
  label: string
  kind: 'value' | 'group'
  unit?: string
  terrain?: Terrain
  metric?: 'power' | 'permeability'
}
const groundLabel = (terrain: Terrain) => terrain === 'Medium' ? 'mob1016.neutral' : 'mobility.' + terrain
export const mobilityRows: MobilityRow[] = [
  { key: 'standard', label: 'mob1016.standardPower', kind: 'value', unit: 'hp/t' },
  { key: 'power', label: 'mob1016.effectiveGroup', kind: 'group', unit: 'hp/t' },
  ...terrains.map(terrain => ({ key: 'power' + terrain, label: groundLabel(terrain), kind: 'value' as const, terrain, metric: 'power' as const })),
  { key: 'permeability', label: 'mob1016.permeabilityGroup', kind: 'group', unit: '%' },
  ...terrains.map(terrain => ({ key: 'permeability' + terrain, label: groundLabel(terrain), kind: 'value' as const, terrain, metric: 'permeability' as const })),
]
export function rowValue(row: MobilityRow, mobility: Mobility | null) {
  if (!mobility || row.kind === 'group') return null
  if (row.terrain) return row.metric === 'power' ? effectivePower(mobility, row.terrain) : mobility.permeability[row.terrain]
  return mobility.mass != null && mobility.mass > 0 && mobility.power > 0 ? mobility.power / mobility.mass : null
}
export function mobilityCellId(entryId: string, rowKey: string) {
  return 'mob-cell-' + encodeURIComponent(entryId) + '-' + rowKey
}
