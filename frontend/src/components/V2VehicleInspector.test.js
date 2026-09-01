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
  it('renders anti-future-leak HP + last-known knowledge during hidden interval', () => {
    const w = mountInspector(120)
    const hp = w.get('[data-test="v2-inspector-hp"]').text()
    expect(hp).toContain('1200')          // <=t sample, not future 600
    expect(hp).toContain('最后已知 HP')   // LAST_KNOWN knowledge during hidden interval
    // loadout 保持 KNOWN（持久配置），即使 120s 在 hidden interval
    expect(w.get('[data-test="v2-inspector-loadout"]').exists()).toBe(true)
    expect(w.get('[data-test="v2-inspector-module"]').text()).toContain('ENGINE')
  })

  it('after re-acquire at 140 shows current HP 600', () => {
    const w = mountInspector(150)
    const hp = w.get('[data-test="v2-inspector-hp"]').text()
    expect(hp).toContain('600')
  })

  it('orientation 用 orientationLabel：CURRENT/LAST_KNOWN/UNKNOWN 不裸显、不映射成 Detected', () => {
    // CURRENT 朝向 → orientation_current（"当前朝向"），不再是 state_detected（"已发现"）
    const w = mountInspector(95)
    const orient = w.get('[data-test="v2-inspector-orientation"] .v2-inspector-val').text()
    expect(orient).toBe('当前朝向')
    expect(['CURRENT', 'LAST_KNOWN', 'UNKNOWN', '已发现', '位置上报中']).not.toContain(orient)
    // LAST_KNOWN 朝向 → orientation_last_known
    const t1 = track()
    t1.orientationSegments = [{ startSec: 90, endSec: 100, knowledge: 'CURRENT', samples: [] }]
    expect(mountInspector(120, 'zh', t1).get('[data-test="v2-inspector-orientation"] .v2-inspector-val').text()).toBe('最后已知朝向')
    // 无朝向数据 → unknown（"未知"）
    const t2 = track()
    t2.orientationSegments = []
    expect(mountInspector(95, 'zh', t2).get('[data-test="v2-inspector-orientation"] .v2-inspector-val').text()).toBe('未知')
  })

  it('state CURRENT observation：coverage ≠ 点亮，显示 "当前观测" 而非 "已发现"', () => {
    const w = mountInspector(95)
    const state = w.get('[data-test="v2-inspector-life"] .v2-inspector-val').text()
    expect(state).toBe('当前观测')
    expect(['已发现', 'Detected', 'Обнаружен']).not.toContain(state)
  })

  it.each(['zh', 'en', 'ru'])('locale %s：orientation/state 不裸显 raw CURRENT/LAST_KNOWN/UNKNOWN', (locale) => {
    const rawOrDetected = ['CURRENT', 'LAST_KNOWN', 'UNKNOWN', '已发现', 'Detected', 'Обнаружен']
    // CURRENT observation + orientation CURRENT
    const wc = mountInspector(95, locale)
    const orient = wc.get('[data-test="v2-inspector-orientation"] .v2-inspector-val').text()
    const state = wc.get('[data-test="v2-inspector-life"] .v2-inspector-val').text()
    expect(orient.length).toBeGreaterThan(0)
    expect(state.length).toBeGreaterThan(0)
    expect(rawOrDetected).not.toContain(orient)
    expect(rawOrDetected).not.toContain(state)
    // LAST_KNOWN orientation
    const t = track()
    t.orientationSegments = [{ startSec: 90, endSec: 100, knowledge: 'CURRENT', samples: [] }]
    const wl = mountInspector(120, locale, t)
    const olast = wl.get('[data-test="v2-inspector-orientation"] .v2-inspector-val').text()
    expect(olast.length).toBeGreaterThan(0)
    expect(rawOrDetected).not.toContain(olast)
  })

  it('loadout 显示本地化名称，绝不裸显 internal logical id / 数字 equipment id', () => {
    const w = mountInspector(120) // zh
    const text = w.get('[data-test="v2-inspector-loadout"]').text()
    expect(text).toContain('修理箱')         // REPAIR_KIT
    expect(text).toContain('肾上腺素')       // ADRENALINE
    expect(text).toContain('沙袋装甲')       // SANDBAG_ARMOR
    expect(text).toContain('改进型模块+')   // 120: Object 244 vehicle-specific preset
    expect(text).toContain('改进型光学系统') // 114
    // raw internal id 不得作为用户文案
    expect(text).not.toContain('REPAIR_KIT')
    expect(text).not.toContain('ADRENALINE')
    expect(text).not.toContain('SANDBAG_ARMOR')
  })

  it.each(['zh', 'en', 'ru'])('locale %s：consumable runtime state 显示本地化文案，绝不裸显 internal enum', (locale) => {
    const w = mountInspector(120, locale)
    const text = w.get('[data-test="v2-inspector-loadout"]').text()
    // slot 0 (REPAIR_KIT / wire 0x0D) 在 t=95 已 ACTIVATED，t=120 仍为 ACTIVATED
    expect(text).not.toMatch(/ACTIVATED|ACTIVE_ENDED_OR_COOLDOWN|INITIALIZED|TEARDOWN/)
    // 本地化文案出现（zh 已激活 / en Active / ru Активирован）
    expect(text.length).toBeGreaterThan(0)
  })

  it('consumable runtime state 未知值走 localized fallback（不裸显）', () => {
    const t = track()
    t.consumableTransitions = [{ timeSec: 95, logicalItemId: 'REPAIR_KIT', state: 'SOME_INTERNAL_STATE', wireCode: 0x0D }]
    const w = mountInspector(120, 'zh', t)
    const text = w.get('[data-test="v2-inspector-loadout"]').text()
    expect(text).toContain('未知')   // consumable_state.UNKNOWN
    expect(text).not.toContain('SOME_INTERNAL_STATE')
  })

  it.each(['zh', 'en', 'ru'])('locale %s：未知 equipment id 使用通用未知文案，不把 raw id 带入产品 UI', (locale) => {
    const t = track()
    t.loadout = { ...t.loadout, equipmentIds: [9999, 100] }
    const w = mountInspector(120, locale, t)
    const text = w.get('[data-test="v2-inspector-loadout"]').text()
    expect(text).toMatch(/未知装备|Unknown equipment|Неизвестное оборудование/)
    expect(text).not.toContain('9999')
  })

  it('未知 consumable code 走通用「未知消耗品」fallback', () => {
    const t = track()
    t.loadout = { ...t.loadout, consumables: ['SOME_INTERNAL_ENUM', null, 'REPAIR_KIT'], consumableWireCodes: [0x00, 0x77, 0x0D] }
    t.consumableTransitions = []
    const w = mountInspector(120, 'zh', t)
    expect(w.get('[data-test="v2-inspector-loadout"]').text()).toContain('未知消耗品')
    expect(w.get('[data-test="v2-inspector-loadout"]').text()).not.toContain('SOME_INTERNAL_ENUM')
  })

  it('loadout is rendered as fixed 3 + 3 + 3x3 semantic cells', () => {
    const w = mountInspector(120)
    expect(w.findAll('[data-test="v2-inspector-consumables"] .v2-inspector-chip')).toHaveLength(3)
    expect(w.findAll('[data-test="v2-inspector-provisions"] .v2-inspector-chip')).toHaveLength(3)
    expect(w.findAll('[data-test="v2-inspector-equipment"] .v2-inspector-chip')).toHaveLength(9)
    expect(w.findAll('[data-test="v2-inspector-equipment"] [data-equipment-group="row1"] .v2-inspector-chip')).toHaveLength(3)
    expect(w.findAll('[data-test="v2-inspector-equipment"] [data-equipment-group="row2"] .v2-inspector-chip')).toHaveLength(3)
    expect(w.findAll('[data-test="v2-inspector-equipment"] [data-equipment-group="row3"] .v2-inspector-chip')).toHaveLength(3)
    expect(w.get('[data-equipment-slot="0"] .v2-chip-type').text()).toBe('F1')
    expect(w.get('[data-equipment-slot="1"] .v2-chip-type').text()).toBe('V1')
    expect(w.get('[data-equipment-slot="2"] .v2-chip-type').text()).toBe('S1')
  })
})
