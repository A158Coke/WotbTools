// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BattlePlaybackHud from './BattlePlaybackHud.vue'

const hp = (state, knownRemaining = 0, totalMax = 0) => ({ state, knownRemaining, totalMax, unknownMax: 0 })

function mountHud(overrides = {}) {
  return mount(BattlePlaybackHud, {
    props: {
      friendlyHp: hp('EXACT', 1500, 3000),
      enemyHp: hp('UNKNOWN'),
      friendlyPoints: 3,
      enemyPoints: 1,
      ...overrides,
    },
    global: { mocks: { $t: key => key } },
  })
}

describe('BattlePlaybackHud', () => {
  it('keeps friendly, score, and enemy columns in a single universal HUD', () => {
    const wrapper = mountHud()

    expect(wrapper.find('[data-test="pb-hud"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-hud-friendly"]').text()).toContain('1500 / 3000')
    expect(wrapper.find('[data-test="pb-hud-score"]').text()).toBe('3 : 1')
    expect(wrapper.find('[data-test="pb-hud-enemy"]').text()).toContain('—')
    expect(wrapper.find('[data-test="pb-hp-fill-friendly"]').attributes('style')).toContain('width: 50.0%')
  })

  it('does not invent a denominator for partial or unknown health', () => {
    const wrapper = mountHud({
      friendlyHp: hp('PARTIAL', 800, 0),
      enemyHp: hp('UNKNOWN'),
    })

    expect(wrapper.find('[data-test="pb-hp-value-friendly"]').text()).toBe('800')
    expect(wrapper.find('[data-test="pb-hp-value-friendly"]').text()).not.toContain('/')
    expect(wrapper.find('[data-test="pb-hp-value-enemy"]').text()).toBe('—')
  })

  it('renders a safe empty bar for malformed health input', () => {
    const wrapper = mountHud({ friendlyHp: { state: 'EXACT', knownRemaining: null, totalMax: null }, enemyHp: { state: 'EXACT', knownRemaining: NaN, totalMax: Infinity } })

    expect(wrapper.find('[data-test="pb-hp-fill-friendly"]').attributes('style')).toContain('width: 0%')
    expect(wrapper.find('[data-test="pb-hp-value-friendly"]').text()).toBe('— / —')
    expect(wrapper.find('[data-test="pb-hp-fill-enemy"]').attributes('style')).toContain('width: 0%')
  })
})
