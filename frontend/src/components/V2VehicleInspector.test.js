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
      equipmentIds: [100, 108, 114, 104, 111, 117, 106, 113, 101],
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

function mountInspector(timeSec) {
  const i18n = createI18n({ legacy: false, locale: 'zh', messages: { zh, en, ru } })
  return mount(V2VehicleInspector, {
    global: { plugins: [i18n] },
    props: { track: track(), timeSec },
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
})
