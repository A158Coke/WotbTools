/**
 * 回放 wire code → 稳定协议标识（logicalItemId）。WotbTools 产品域目录表，不是字节解析：
 * 与 Java `ConsumableLifecycleEvent.logicalItemIdOf` / `VehicleBattleLoadout.resolveLogicalItemId`
 * 逐项一致（Java 退役后本文件是唯一来源）。未知 code → null（保留 raw wireCode，UI 走 unknown 文案）。
 */

const CONSUMABLES: Record<number, string> = {
  0x08: 'AUTOMATIC_FIRE_EXTINGUISHER',
  0x09: 'ADRENALINE',
  0x0a: 'ENGINE_POWER_BOOST',
  0x0b: 'MULTI_PURPOSE_RESTORATION_PACK',
  0x0c: 'FIRST_AID_KIT',
  0x0d: 'REPAIR_KIT',
  0x3d: 'IMPROVED_ENGINE_POWER_BOOST',
  0x3e: 'RETICLE_CALIBRATION',
  0x42: 'REACTIVE_ARMOR',
  0x69: 'TUNGSTEN_SHELLS',
  0xbd: 'REDUCED_ENGINE_POWER_BOOST',
}

const PROVISIONS: Record<number, string> = {
  0x0e: 'LARGE_FOOD', 0x0f: 'LARGE_FOOD', 0x10: 'LARGE_FOOD', 0x11: 'LARGE_FOOD', 0x12: 'LARGE_FOOD',
  0x46: 'LARGE_FOOD', 0x49: 'LARGE_FOOD',
  0x16: 'SMALL_FOOD', 0x17: 'SMALL_FOOD', 0x18: 'SMALL_FOOD', 0x19: 'SMALL_FOOD', 0x47: 'SMALL_FOOD', 0x48: 'SMALL_FOOD',
  0x1c: 'STANDARD_FUEL',
  0x1d: 'IMPROVED_FUEL',
  0x1e: 'PROTECTIVE_KIT',
  0x44: 'SANDBAG_ARMOR',
  0x45: 'ENHANCED_SANDBAG_ARMOR',
  0x6a: 'GEAR_OIL',
  0x6b: 'IMPROVED_GEAR_OIL',
  0x6c: 'IMPROVED_GUNPOWDER',
}

/** Type32 / Type5 consumable 槽共用映射。 */
export function consumableItemId(wireCode: number): string | null {
  return CONSUMABLES[wireCode] ?? null
}

/** Type5 provision 槽映射。 */
export function provisionItemId(wireCode: number): string | null {
  return PROVISIONS[wireCode] ?? null
}

/** Type32 生命周期 state 码（1/2/3/255）→ 名称；其余 UNKNOWN。 */
export function consumableStateName(state: number): string {
  switch (state) {
    case 1: return 'INITIALIZED'
    case 2: return 'ACTIVATED'
    case 3: return 'ACTIVE_ENDED_OR_COOLDOWN'
    case 255: return 'TEARDOWN'
    default: return 'UNKNOWN'
  }
}
