import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import messages from '../locales/feature-messages.json'
import { armorPartLabel, armorResultLabel } from './tankMeta.js'

const { t } = createI18n({ legacy: false, locale: 'zh', messages }).global

describe('armor analysis display labels', () => {
  it.each([
    ['Track (Left)', '左侧履带'], ['Track (Right)', '右侧履带'],
    ['Gun Barrel', '炮管'], ['Hull Plate 12', '车体装甲板 12'],
    ['Turret Plate 3', '炮塔装甲板 3'], ['Gun Plate 4', '炮盾装甲板 4'],
    ['Spaced Plate 5', '间隙装甲板 5'], ['Gap 0.25m', '装甲间隙'],
  ])('translates %s without changing the engine identifier', (raw, label) => {
    const layer = { part_name: raw }
    expect(armorPartLabel(layer.part_name, t)).toBe(label)
    expect(layer.part_name).toBe(raw)
  })

  it('translates both segments of a ricochet and subsequent penetration', () => {
    expect(armorResultLabel('RICOCHET → PENETRATION', t)).toBe('跳弹 → 击穿')
    expect(armorResultLabel('NO PENETRATION', t)).toBe(armorResultLabel('BLOCKED', t))
  })

  it('preserves unknown identifiers and does not infer geometry from plate numbers', () => {
    expect(armorPartLabel('Hull Plate bottom', t)).toBe('Hull Plate bottom')
    expect(armorResultLabel('UNKNOWN', t)).toBe('UNKNOWN')
    expect(armorPartLabel(null, t)).toBe('')
    expect(armorResultLabel(null, t)).toBe('')
  })
})
