// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import zh from '../locales/zh.json'
import { assetProvider } from '../scene/assetProvider.js'
import V2VehicleInspector from './V2VehicleInspector.vue'

const track = {
  accountId: 2002,
  playerName: 'enemy',
  tankId: 456,
  tankName: 'Enemy',
  tankClass: 'Medium tank',
  team: 2,
  friendly: false,
  loadout: {
    consumables: ['REPAIR_KIT', null, null],
    consumableWireCodes: [0x0d, null, null],
    provisions: ['SPALL_LINER', null, null],
    provisionWireCodes: [0x32, null, null],
    equipmentIds: [103, 114],
  },
  positionSegments: [],
  orientationSegments: [],
  healthTransitions: [],
  lifeTransitions: [],
  consumableTransitions: [],
  moduleCrewTransitions: [],
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('V2VehicleInspector equipment directory failure', () => {
  it('devices.json 404：已装装备保持非空缺图状态，不退化为空槽虚线', async () => {
    vi.spyOn(assetProvider, 'json').mockRejectedValue(new Error('asset /research/devices.json: HTTP 404'))
    const i18n = createI18n({ legacy: false, locale: 'zh', messages: { zh } })
    const w = mount(V2VehicleInspector, {
      global: { plugins: [i18n] },
      props: { track, timeSec: 120 },
    })
    const chips = () => w.findAll('[data-test="v2-inspector-equipment"] .v2-inspector-chip')
    expect(chips()).toHaveLength(2)
    // 目录加载中：实线中性占位，不是空槽虚线
    expect(chips()[0].classes()).toContain('is-loading')
    expect(chips()[0].classes()).not.toContain('is-empty')
    await flushPromises()
    // 加载失败后：已装装备仍是“缺图/未知”态，而不是“未装备”
    for (const chip of chips()) {
      expect(chip.classes()).toContain('is-unknown')
      expect(chip.classes()).not.toContain('is-empty')
      expect(chip.classes()).not.toContain('is-loading')
      expect(chip.find('.v2-chip-placeholder').exists()).toBe(true)
    }
    expect(chips().map(chip => String(chip.attributes('aria-label')))).toEqual(['校准炮弹', '改进型光学系统'])
    w.unmount()
  })
})
