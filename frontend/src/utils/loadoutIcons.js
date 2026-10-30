/**
 * 车辆检查器装载区的图形标识（消耗品 / 补给）：只返回资产图标 URL，
 * 名称仅用于 `aria-label` / `title`，不再作为可见文本。
 */
import { consumableIconUrl } from './consumableIcons.js'
import { itemIconUrl } from './researchCatalog.js'

const PROVISION_ICON = {
  LARGE_FOOD: 'ration_other',
  SMALL_FOOD: 'regular_ration_other',
  STANDARD_FUEL: 'regular_fuel',
  IMPROVED_FUEL: 'improved_fuel',
  PROTECTIVE_KIT: 'safety_set',
  SANDBAG_ARMOR: 'small-hp-stock',
  ENHANCED_SANDBAG_ARMOR: 'large-hp-stock',
  GEAR_OIL: 'provision_gear-oil',
  IMPROVED_GEAR_OIL: 'provision_improved-gear-oil',
  IMPROVED_GUNPOWDER: 'gunpowder',
}

/** 补给图标 URL；无映射/无图返回 null（组件用几何占位，不显示文字）。 */
export function provisionIconUrl(logicalId) {
  const icon = PROVISION_ICON[logicalId]
  return icon ? itemIconUrl('provisions', icon) : null
}

export { consumableIconUrl }
