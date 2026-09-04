import { describe, expect, it } from 'vitest'
import {
  CONSUMABLE_NAMES,
  PROVISION_NAMES,
  EQUIPMENT_NAMES,
  loadoutItemLabel,
} from './loadoutItems.js'
import consumablesJson from '../../../common/wotb-item-catalog-json/consumables.json'
import provisionsJson from '../../../common/wotb-item-catalog-json/provisions.json'
import equipmentJson from '../../../common/wotb-item-catalog-json/equipment.json'

const ZH_PROVISION_OVERRIDES = {
  SMALL_FOOD: '小补给',
  LARGE_FOOD: '大补给',
}

const ZH_EQUIPMENT_OVERRIDES = {
  107: '弹药超荷',
}

describe('loadoutItems', () => {
  it('所有 consumable/provision/equipment 条目都带 zh/en/ru 三语', () => {
    for (const map of [CONSUMABLE_NAMES, PROVISION_NAMES, EQUIPMENT_NAMES]) {
      expect(Object.keys(map).length).toBeGreaterThan(0)
      for (const [id, entry] of Object.entries(map)) {
        expect(entry.zh, `${id}.zh`).toBeTruthy()
        expect(entry.en, `${id}.en`).toBeTruthy()
        // ru 由 overlay 提供；库中暂无 ru 的条目允许为 null 并在 loadoutItemLabel 回退 en
        expect(entry.ru === null || typeof entry.ru === 'string', `${id}.ru`).toBe(true)
      }
    }
  })

  it('en 由 authoritative catalog 驱动；zh 仅允许显式 UI 术语 override', () => {
    for (const item of consumablesJson.items) {
      expect(loadoutItemLabel('consumable', item.code, 'zh')).toBe(item.nameZh)
      expect(loadoutItemLabel('consumable', item.code, 'en')).toBe(item.nameEn)
    }
    for (const item of provisionsJson.items) {
      const expectedZh = ZH_PROVISION_OVERRIDES[item.code] ?? item.nameZh
      expect(loadoutItemLabel('provision', item.code, 'zh')).toBe(expectedZh)
      expect(loadoutItemLabel('provision', item.code, 'en')).toBe(item.nameEn)
    }
    for (const item of equipmentJson.items) {
      const expectedZh = ZH_EQUIPMENT_OVERRIDES[item.id] ?? item.nameZh
      expect(loadoutItemLabel('equipment', item.id, 'zh')).toBe(expectedZh)
      expect(loadoutItemLabel('equipment', item.id, 'en')).toBe(item.nameEn)
    }
  })

  it('固定中文 UI 术语 override', () => {
    expect(loadoutItemLabel('provision', 'SMALL_FOOD', 'zh')).toBe('小补给')
    expect(loadoutItemLabel('provision', 'LARGE_FOOD', 'zh')).toBe('大补给')
    expect(loadoutItemLabel('equipment', 107, 'zh')).toBe('弹药超荷')
  })

  it('ru 由 overlay 提供；未知 id/code 返回 null；未知 locale 回退英文', () => {
    expect(loadoutItemLabel('consumable', 'REPAIR_KIT', 'ru')).toBe('Ремкомплект')
    expect(loadoutItemLabel('consumable', 'REPAIR_KIT', 'en')).toBe('Repair Kit')
    expect(loadoutItemLabel('equipment', 114, 'ru')).toBe('Улучшенная оптика')
    // 未知 id / null / 空 -> null（Inspector 走 localized fallback）
    expect(loadoutItemLabel('equipment', 9999, 'zh')).toBeNull()
    expect(loadoutItemLabel('consumable', null, 'zh')).toBeNull()
    expect(loadoutItemLabel('consumable', '', 'zh')).toBeNull()
    // 未知 locale 回退英文
    expect(loadoutItemLabel('consumable', 'REPAIR_KIT', 'fr')).toBe('Repair Kit')
  })

  it('authoritative vehicle-specific equipment 120 is a known loadout item', () => {
    const item = equipmentJson.items.find(entry => entry.id === 120)
    expect(item).toEqual(expect.objectContaining({
      code: 'IMPROVED_MODULES_PLUS',
      nameZh: '改进型模块+',
      nameEn: 'Improved Modules +',
      scope: 'VEHICLE_SPECIFIC',
    }))
    expect(loadoutItemLabel('equipment', 120, 'zh')).toBe('改进型模块+')
    expect(loadoutItemLabel('equipment', 120, 'en')).toBe('Improved Modules +')
    expect(loadoutItemLabel('equipment', 120, 'ru')).toBe('Доработанные модули +')
  })

  it('每个后端可产出的 consumable/provision code 都能被解析（防裸显）', () => {
    const codes = ['AUTOMATIC_FIRE_EXTINGUISHER', 'ADRENALINE', 'ENGINE_POWER_BOOST', 'MULTI_PURPOSE_RESTORATION_PACK', 'FIRST_AID_KIT', 'REPAIR_KIT', 'IMPROVED_ENGINE_POWER_BOOST', 'RETICLE_CALIBRATION', 'REACTIVE_ARMOR', 'TUNGSTEN_SHELLS', 'REDUCED_ENGINE_POWER_BOOST']
    for (const c of codes) expect(loadoutItemLabel('consumable', c, 'zh')).toBeTruthy()
    for (const p of ['LARGE_FOOD', 'SMALL_FOOD', 'STANDARD_FUEL', 'IMPROVED_FUEL', 'PROTECTIVE_KIT', 'SANDBAG_ARMOR', 'ENHANCED_SANDBAG_ARMOR', 'GEAR_OIL', 'IMPROVED_GEAR_OIL', 'IMPROVED_GUNPOWDER']) {
      expect(loadoutItemLabel('provision', p, 'zh')).toBeTruthy()
    }
  })
})
