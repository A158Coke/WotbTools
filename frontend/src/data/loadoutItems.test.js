import { describe, expect, it } from 'vitest'
import {
  CONSUMABLE_NAMES,
  PROVISION_NAMES,
  EQUIPMENT_NAMES,
  loadoutItemLabel,
} from './loadoutItems.js'

describe('loadoutItems', () => {
  it('所有 consumable/provision/equipment 条目都带 zh/en/ru 三语', () => {
    for (const map of [CONSUMABLE_NAMES, PROVISION_NAMES, EQUIPMENT_NAMES]) {
      expect(Object.keys(map).length).toBeGreaterThan(0)
      for (const [id, entry] of Object.entries(map)) {
        expect(entry.zh, `${id}.zh`).toBeTruthy()
        expect(entry.en, `${id}.en`).toBeTruthy()
        expect(entry.ru, `${id}.ru`).toBeTruthy()
      }
    }
  })

  it('loadoutItemLabel 返回对应语言名称；未知/空返回 null', () => {
    expect(loadoutItemLabel('consumable', 'REPAIR_KIT', 'zh')).toBe('修理箱')
    expect(loadoutItemLabel('consumable', 'REPAIR_KIT', 'en')).toBe('Repair Kit')
    expect(loadoutItemLabel('consumable', 'REPAIR_KIT', 'ru')).toBe('Ремкомплект')
    expect(loadoutItemLabel('equipment', 114, 'zh')).toBe('改进型光学系统')
    expect(loadoutItemLabel('equipment', 9999, 'zh')).toBeNull()
    expect(loadoutItemLabel('equipment', null, 'zh')).toBeNull()
    expect(loadoutItemLabel('consumable', '', 'zh')).toBeNull()
    // 未知 locale 回退英文
    expect(loadoutItemLabel('consumable', 'REPAIR_KIT', 'fr')).toBe('Repair Kit')
  })

  it('每个后端可产出的 consumable/provision code 都能被解析（防裸显）', () => {
    const codes = ['ADRENALINE', 'ENGINE_POWER_BOOST', 'MULTI_PURPOSE_RESTORATION_PACK', 'FIRST_AID_KIT', 'REPAIR_KIT', 'IMPROVED_ENGINE_POWER_BOOST', 'RETICLE_CALIBRATION', 'REACTIVE_ARMOR', 'TUNGSTEN_SHELLS']
    for (const c of codes) expect(loadoutItemLabel('consumable', c, 'zh')).toBeTruthy()
    for (const p of ['SANDBAG_ARMOR', 'ENHANCED_SANDBAG_ARMOR', 'IMPROVED_GUNPOWDER']) {
      expect(loadoutItemLabel('provision', p, 'zh')).toBeTruthy()
    }
  })
})
