// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import zh from '../locales/zh.json'
import en from '../locales/en.json'
import ru from '../locales/ru.json'
import V2VehicleInspector from './V2VehicleInspector.vue'

const lh = (timeSec, currentHp, knowledge, displayCapacityHp) =>
  ({ timeSec, currentHp, knowledge, source: 'EXACT_BATTLE_EVENT', displayCapacityHp, confidence: 'HIGH' })

function track() {
  return {
    accountId: 2002,
    playerName: 'enemy',
    tankId: 456,
    tankName: 'Enemy',
    tankClass: 'Medium tank',
    team: 2,
    friendly: false,
    loadout: {
      consumables: ['REPAIR_KIT', null, 'ADRENALINE'],
      consumableWireCodes: [0x0D, 0x77, 0x09],
      provisions: ['SANDBAG_ARMOR', null, null],
      provisionWireCodes: [0x44, 0x10, 0x11],
      equipmentIds: [100, 120, 114, 104, 111, 117, 106, 113, 101],
    },
    positionSegments: [{ startSec: 90, endSec: 100, knowledge: 'OBSERVED', samples: [] }],
    orientationSegments: [{ startSec: 90, endSec: 100, knowledge: 'CURRENT', samples: [] }],
    healthTransitions: [
      lh(90, 1200, 'CURRENT', 1200),
      lh(100, 1200, 'LAST_KNOWN', 1200),
      lh(140, 600, 'CURRENT', 1200),
    ],
    lifeTransitions: [],
    consumableTransitions: [{ timeSec: 95, logicalItemId: 'REPAIR_KIT', state: 'ACTIVATED', wireCode: 0x0D }],
    moduleCrewTransitions: [{ timeSec: 120, component: 'ENGINE', state: 'CRITICAL_DISABLED', recorderVisible: true, confidence: 'HIGH' }],
  }
}

function mountInspector(timeSec, locale = 'zh', trackObj = track()) {
  const i18n = createI18n({ legacy: false, locale, messages: { zh, en, ru } })
  return mount(V2VehicleInspector, {
    global: { plugins: [i18n] },
    props: { track: trackObj, timeSec },
  })
}

describe('V2VehicleInspector', () => {
  it('未装备的空槽显示「未装备」，不与未知装备混淆', () => {
    const t = track()
    t.loadout.equipmentIds = [103, 114, 0, 0, 0, 0, 0, 0, 0]
    const w = mountInspector(120, 'zh', t)
    const chips = w.findAll('[data-test="v2-inspector-equipment"] [data-equipment-slot]')
    expect(chips).toHaveLength(9)
    const empty = w.findAll('[data-equipment-empty="true"]')
    expect(empty).toHaveLength(7)
    expect(empty.every(chip => String(chip.attributes('aria-label')).includes('未装备'))).toBe(true)
    expect(w.get('[data-test="v2-inspector-equipment"]').html()).not.toContain('未知装备')
    expect(w.get('[data-equipment-slot="0"]').attributes('aria-label')).toContain('校准炮弹')
    w.unmount()
  })

  it('renders earned marks independently of replay time, and clears the badge on vehicle changes', async () => {
    const w = mountInspector(120)
    await w.setProps({ gunMarks: 2 })
    expect(w.get('[data-test="v2-inspector-gun-marks"] [data-gun-marks]').attributes('data-gun-marks')).toBe('2')
    await w.setProps({ timeSec: 90 })
    expect(w.get('[data-test="v2-inspector-gun-marks"]').text()).toContain('2 环')
    await w.setProps({ track: { ...track(), accountId: 3003 }, gunMarks: null })
    expect(w.get('[data-test="v2-inspector-gun-marks"]').text()).toContain('—')
    expect(w.find('[data-test="v2-inspector-gun-marks"] svg').exists()).toBe(false)
    await w.setProps({ gunMarks: 0 })
    expect(w.get('[data-test="v2-inspector-gun-marks"]').text()).toContain('0 环')
    expect(w.find('[data-test="v2-inspector-gun-marks"] svg').exists()).toBe(false)
    w.unmount()
  })

  it('renders anti-future-leak HP + last-known knowledge during hidden interval', () => {
    const w = mountInspector(120)
    const hp = w.get('[data-test="v2-inspector-hp"]').text()
    expect(hp).toContain('1200')          // <=t sample, not future 600
    expect(hp).toContain('最后已知 HP')   // LAST_KNOWN knowledge during hidden interval
    expect(w.find('[data-test="v2-inspector-orientation"]').exists()).toBe(false)
    // loadout 保持 KNOWN（持久配置），即使 120s 在 hidden interval
    expect(w.get('[data-test="v2-inspector-loadout"]').exists()).toBe(true)
    expect(w.get('[data-test="v2-inspector-module"]').text()).toContain('发动机')
  })

  it('after re-acquire at 140 shows current HP 600', () => {
    const w = mountInspector(150)
    const hp = w.get('[data-test="v2-inspector-hp"]').text()
    expect(hp).toContain('600')
  })

  it('state CURRENT observation：coverage ≠ 点亮，显示 "当前观测" 而非 "已发现"', () => {
    const w = mountInspector(95)
    const state = w.get('[data-test="v2-inspector-life"] .v2-inspector-val').text()
    expect(state).toBe('当前观测')
    expect(['已发现', 'Detected', 'Обнаружен']).not.toContain(state)
  })

  it.each(['zh', 'en', 'ru'])('locale %s：state 不裸显 raw CURRENT/LAST_KNOWN/UNKNOWN', (locale) => {
    const rawOrDetected = ['CURRENT', 'LAST_KNOWN', 'UNKNOWN', '已发现', 'Detected', 'Обнаружен']
    const w = mountInspector(95, locale)
    const state = w.get('[data-test="v2-inspector-life"] .v2-inspector-val').text()
    expect(state.length).toBeGreaterThan(0)
    expect(rawOrDetected).not.toContain(state)
    expect(w.find('[data-test="v2-inspector-orientation"]').exists()).toBe(false)
  })

  it('loadout 图形化：名称只进 aria-label，不裸显 internal logical id / 数字 equipment id', () => {
    const w = mountInspector(120) // zh
    const labels = w.findAll('[data-test="v2-inspector-loadout"] .v2-inspector-chip')
      .map(chip => String(chip.attributes('aria-label'))).join(' | ')
    expect(labels).toContain('修理箱')         // REPAIR_KIT
    expect(labels).toContain('肾上腺素')       // ADRENALINE
    expect(labels).toContain('沙袋装甲')       // SANDBAG_ARMOR
    expect(labels).toContain('改进型模块+')   // 120: Object 244 vehicle-specific preset
    expect(labels).toContain('改进型光学系统') // 114
    expect(labels).not.toContain('REPAIR_KIT')
    expect(labels).not.toContain('ADRENALINE')
    expect(labels).not.toContain('SANDBAG_ARMOR')
    expect(labels).not.toMatch(/ACTIVATED|ACTIVE_ENDED_OR_COOLDOWN|INITIALIZED|TEARDOWN/)
  })

  it.each(['zh', 'en', 'ru'])('locale %s：consumable runtime state 只进 aria-label，绝不裸显 internal enum', (locale) => {
    const w = mountInspector(120, locale)
    const labels = w.findAll('[data-test="v2-inspector-consumables"] .v2-inspector-chip')
      .map(chip => String(chip.attributes('aria-label'))).join(' | ')
    expect(labels.length).toBeGreaterThan(0)
    expect(labels).not.toMatch(/ACTIVATED|ACTIVE_ENDED_OR_COOLDOWN|INITIALIZED|TEARDOWN/)
  })

  it('consumable runtime state 未知值走 localized fallback（不裸显）', () => {
    const t = track()
    t.consumableTransitions = [{ timeSec: 95, logicalItemId: 'REPAIR_KIT', state: 'SOME_INTERNAL_STATE', wireCode: 0x0D }]
    const w = mountInspector(120, 'zh', t)
    const labels = w.findAll('[data-test="v2-inspector-consumables"] .v2-inspector-chip')
      .map(chip => String(chip.attributes('aria-label'))).join(' | ')
    expect(labels).toContain('未知')   // consumable_state.UNKNOWN 本地化
    expect(labels).not.toContain('SOME_INTERNAL_STATE')
  })

  it.each(['zh', 'en', 'ru'])('locale %s：未知 equipment id 使用通用未知文案，不把 raw id 带入产品 UI', (locale) => {
    const t = track()
    t.loadout = { ...t.loadout, equipmentIds: [9999, 100] }
    const w = mountInspector(120, locale, t)
    const labels = w.findAll('[data-test="v2-inspector-equipment"] .v2-inspector-chip').map(c => c.attributes('aria-label'))
    expect(labels.some(label => /未知装备|Unknown equipment|Неизвестное оборудование/.test(String(label)))).toBe(true)
    expect(labels.join(' ')).not.toContain('9999')
  })

  it('未知 consumable code 走通用「未知消耗品」fallback', () => {
    const t = track()
    t.loadout = { ...t.loadout, consumables: ['SOME_INTERNAL_ENUM', null, 'REPAIR_KIT'], consumableWireCodes: [0x00, 0x77, 0x0D] }
    t.consumableTransitions = []
    const w = mountInspector(120, 'zh', t)
    const labels = w.findAll('[data-test="v2-inspector-consumables"] .v2-inspector-chip').map(c => c.attributes('aria-label'))
    expect(labels.some(label => String(label).includes('未知消耗品'))).toBe(true)
    expect(labels.join(' ')).not.toContain('SOME_INTERNAL_ENUM')
  })

  it('loadout is rendered as fixed 3 + 3 + 3x3 semantic cells', () => {
    const w = mountInspector(120)
    expect(w.findAll('[data-test="v2-inspector-consumables"] .v2-inspector-chip')).toHaveLength(3)
    expect(w.findAll('[data-test="v2-inspector-provisions"] .v2-inspector-chip')).toHaveLength(3)
    expect(w.findAll('[data-test="v2-inspector-equipment"] .v2-inspector-chip')).toHaveLength(9)
    expect(w.findAll('[data-test="v2-inspector-equipment"] [data-equipment-group="row1"] .v2-inspector-chip')).toHaveLength(3)
    expect(w.findAll('[data-test="v2-inspector-equipment"] [data-equipment-group="row2"] .v2-inspector-chip')).toHaveLength(3)
    expect(w.findAll('[data-test="v2-inspector-equipment"] [data-equipment-group="row3"] .v2-inspector-chip')).toHaveLength(3)
    const equipment = w.findAll('[data-test="v2-inspector-equipment"] .v2-inspector-chip')
    const labels = equipment.map(cell => String(cell.attributes('aria-label')))
    expect(labels).toEqual([
      'F1: 火炮输弹机', 'V1: 改进型模块+', 'S1: 改进型光学系统',
      'F2: 改进型炮控系统', 'V2: 改进型组装', 'S2: 发动机加速器',
      'F3: 精密火炮', 'V3: 工具箱', 'S3: 高级消耗品',
    ])
    // 图形化：chip 内不再渲染可见文字，只保留图标/占位
    expect(equipment.map(cell => cell.text().trim())).toEqual(Array(9).fill(''))
    expect(w.findAll('[data-test="v2-inspector-provisions"] .v2-chip-icon').length).toBeGreaterThan(0)
    expect(w.findAll('[data-test="v2-inspector-consumables"] .v2-chip-icon').length).toBeGreaterThan(0)
  })
})
