/**
 * 回放消耗品状态图标：Agent logicalItemId → 客户端 `research/consumables` 图标。
 *
 * 只 glob 消耗品图标目录（13 张），不把整个 researchCatalog 的模块/技能图标表拉进
 * 回放 HUD chunk；图标缺失返回 null，组件走几何占位。
 */
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
  REACTIVE_ARMOR: 'shield-kit',
  TUNGSTEN_SHELLS: 'tungstentip',
  DYNAMIC_ARMOUR_SYSTEM: 'armorMover',
  REDUCED_ENGINE_POWER_BOOST: 'freeburner',
  // gravityJump 是瞬发能力（duration=0），按 HUD 规则不展示；保持显式 null 防止误配图。
  GRAVITY_JUMP: null,
}

/** 定时消耗品图标 URL；未知/无图返回 null（组件走几何占位，不裸显 ID）。 */
export function consumableIconUrl(logicalId) {
  const icon = ICON_BY_LOGICAL_ID[logicalId]
  return icon ? URL_BY_ICON[`${icon}.webp`] ?? null : null
}
