import { consumableIconUrl } from './consumableIcons.js'
import { itemIconUrl } from './researchCatalog.js'

const PROVISION_ICON = {
  LARGE_FOOD: 'ration_other',
  SMALL_FOOD: 'regular_ration_other',
  STANDARD_FUEL: 'regular_fuel',
  IMPROVED_FUEL: 'improved_fuel',
  PROTECTIVE_KIT: 'safety_set',
  SPALL_LINER: 'anti-high-explosive',
  SANDBAG_ARMOR: 'small-hp-stock',
  ENHANCED_SANDBAG_ARMOR: 'large-hp-stock',
  GEAR_OIL: 'provision_gear-oil',
  IMPROVED_GEAR_OIL: 'provision_improved-gear-oil',
  IMPROVED_GUNPOWDER: 'gunpowder',
}

export function provisionIconUrl(logicalId) {
  const icon = PROVISION_ICON[logicalId]
  return icon ? itemIconUrl('provisions', icon) : null
}

export { consumableIconUrl }
