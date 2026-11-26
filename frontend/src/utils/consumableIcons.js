const CONSUMABLE_ICON_URLS = import.meta.glob(
  '../../../common/research/icons/items/consumables/*.webp',
  { eager: true, query: '?url', import: 'default' },
)

const URL_BY_ICON = Object.fromEntries(Object.entries(CONSUMABLE_ICON_URLS)
  .map(([key, url]) => [key.split(/[\\/]/).pop(), url]))

const ICON_BY_LOGICAL_ID = {
  AUTOMATIC_FIRE_EXTINGUISHER: 'autofire',
  ADRENALINE: 'berserk',
  ENGINE_POWER_BOOST: 'afterburning',
  MULTI_PURPOSE_RESTORATION_PACK: 'largeRecoverkit',
  FIRST_AID_KIT: 'largeMedkit',
  REPAIR_KIT: 'largeRepairkit',
  IMPROVED_ENGINE_POWER_BOOST: 'superburner',
  RETICLE_CALIBRATION: 'aim',
  SHELL_RELOAD_BOOST: 'reload',
  REACTIVE_ARMOR: 'shield-kit',
  TUNGSTEN_SHELLS: 'tungstentip',
  DYNAMIC_ARMOUR_SYSTEM: 'armorMover',
  REDUCED_ENGINE_POWER_BOOST: 'freeburner',
  GRAVITY_JUMP: null,
}

export function consumableIconUrl(logicalId) {
  const icon = ICON_BY_LOGICAL_ID[logicalId]
  return icon ? URL_BY_ICON[`${icon}.webp`] ?? null : null
}
