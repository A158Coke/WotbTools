
const CONSUMABLES: Record<number, string> = {
  0x08: 'AUTOMATIC_FIRE_EXTINGUISHER',
  0x09: 'ADRENALINE',
  0x0a: 'ENGINE_POWER_BOOST',
  0x0b: 'MULTI_PURPOSE_RESTORATION_PACK',
  0x0c: 'FIRST_AID_KIT',
  0x0d: 'REPAIR_KIT',
  0x3d: 'IMPROVED_ENGINE_POWER_BOOST',
  0x3e: 'RETICLE_CALIBRATION',
  0x3f: 'SHELL_RELOAD_BOOST',
  0x42: 'REACTIVE_ARMOR',
  0x69: 'TUNGSTEN_SHELLS',
  0xa9: 'DYNAMIC_ARMOUR_SYSTEM',
  0xbd: 'REDUCED_ENGINE_POWER_BOOST',
}

const PROVISIONS: Record<number, string> = {
  0x0e: 'LARGE_FOOD', 0x0f: 'LARGE_FOOD', 0x10: 'LARGE_FOOD', 0x11: 'LARGE_FOOD',
  0x12: 'LARGE_FOOD', 0x13: 'LARGE_FOOD', 0x14: 'LARGE_FOOD',
  0x15: 'SMALL_FOOD', 0x16: 'SMALL_FOOD', 0x17: 'SMALL_FOOD', 0x18: 'SMALL_FOOD',
  0x19: 'SMALL_FOOD', 0x1a: 'SMALL_FOOD', 0x1b: 'SMALL_FOOD',
  0x1c: 'STANDARD_FUEL',
  0x1d: 'IMPROVED_FUEL',
  0x1e: 'PROTECTIVE_KIT',
  0x2d: 'LARGE_FOOD', 0x2e: 'SMALL_FOOD',
  0x32: 'SPALL_LINER',
  0x44: 'SANDBAG_ARMOR',
  0x45: 'ENHANCED_SANDBAG_ARMOR',
  0x46: 'LARGE_FOOD', 0x47: 'SMALL_FOOD',
  0x48: 'SMALL_FOOD', 0x49: 'LARGE_FOOD',
  0x4a: 'LARGE_FOOD', 0x4b: 'SMALL_FOOD',
  0x6a: 'GEAR_OIL',
  0x6b: 'IMPROVED_GEAR_OIL',
  0x6c: 'IMPROVED_GUNPOWDER',
  0x6d: 'LARGE_FOOD',
  0x6e: 'SMALL_FOOD',
}

export function consumableItemId(wireCode: number): string | null {
  return CONSUMABLES[wireCode] ?? null
}

export function provisionItemId(wireCode: number): string | null {
  return PROVISIONS[wireCode] ?? null
}

export function consumableStateName(state: number): string {
  switch (state) {
    case 1: return 'INITIALIZED'
    case 2: return 'ACTIVATED'
    case 3: return 'ACTIVE_ENDED_OR_COOLDOWN'
    case 255: return 'TEARDOWN'
    default: return 'UNKNOWN'
  }
}
