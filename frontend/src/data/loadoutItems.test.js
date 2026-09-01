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

  it('zh/en 完全由 common authoritative catalog 驱动（adapter 返回值 == catalog nameZh/nameEn）', () => {
    for (const it of consumablesJson.items) {
      expect(loadoutItemLabel('consumable', it.code, 'zh')).toBe(it.nameZh)
      expect(loadoutItemLabel('consumable', it.code, 'en')).toBe(it.nameEn)
    }
    for (const it of provisionsJson.items) {
      expect(loadoutItemLabel('provision', it.code, 'zh')).toBe(it.nameZh)
      expect(loadoutItemLabel('provision', it.code, 'en')).toBe(it.nameEn)
    }
    for (const it of equipmentJson.items) {
      expect(loadoutItemLabel('equipment', it.id, 'zh')).toBe(it.nameZh)
      expect(loadoutItemLabel('equipment', it.id, 'en')).toBe(it.nameEn)
    }
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

  it('每个后端可产出的 consumable/provision code 都能被解析（防裸显）', () => {
    const codes = ['AUTOMATIC_FIRE_EXTINGUISHER', 'ADRENALINE', 'ENGINE_POWER_BOOST', 'MULTI_PURPOSE_RESTORATION_PACK', 'FIRST_AID_KIT', 'REPAIR_KIT', 'IMPROVED_ENGINE_POWER_BOOST', 'RETICLE_CALIBRATION', 'REACTIVE_ARMOR', 'TUNGSTEN_SHELLS', 'REDUCED_ENGINE_POWER_BOOST']
    for (const c of codes) expect(loadoutItemLabel('consumable', c, 'zh')).toBeTruthy()
    for (const p of ['LARGE_FOOD', 'SMALL_FOOD', 'STANDARD_FUEL', 'IMPROVED_FUEL', 'PROTECTIVE_KIT', 'SANDBAG_ARMOR', 'ENHANCED_SANDBAG_ARMOR', 'GEAR_OIL', 'IMPROVED_GEAR_OIL', 'IMPROVED_GUNPOWDER']) {
      expect(loadoutItemLabel('provision', p, 'zh')).toBeTruthy()
    }
  })
})
