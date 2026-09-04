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

  it('shows full integer HP (no k abbreviation) even for large values (§11)', () => {
    const wrapper = mountHud({
      friendlyHp: hp('EXACT', 22305, 21446),
      enemyHp: hp('EXACT', 0, 21446),
      friendlyPoints: 584,
      enemyPoints: 0,
    })

    // 完整整数，而非 "22.3k" / "1.5k"
    expect(wrapper.find('[data-test="pb-hp-value-friendly"]').text()).toBe('22305 / 21446')
    expect(wrapper.find('[data-test="pb-hp-value-enemy"]').text()).toBe('0 / 21446')
    expect(wrapper.find('[data-test="pb-hud-score"]').text()).toBe('584 : 0')
    expect(wrapper.find('[data-test="pb-hud"]').text()).toContain('22305')
  })

  it('shows explicit HP / points semantics labels (§12)', () => {
    const wrapper = mountHud()
    expect(wrapper.find('[data-test="pb-hud-points-label-friendly"]').text()).toBe('recon.map.playback.hud_friendly_hp')
    expect(wrapper.find('[data-test="pb-hud-points-label-enemy"]').text()).toBe('recon.map.playback.hud_enemy_hp')
    expect(wrapper.find('[data-test="pb-hud-points-label"]').text()).toBe('recon.map.playback.points')
    expect(wrapper.find('[data-test="pb-hud-score"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-hud-score"]').text()).toBe('3 : 1')
  })

  it('§13 delayed-damage bar: lag chip exists; hpNoTransition syncs immediately (no replay)', async () => {
    const wrapper = mountHud({ friendlyHp: hp('EXACT', 3000, 3000) })
    expect(wrapper.find('[data-test="pb-hud-lag-friendly"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-hud-lag-enemy"]').exists()).toBe(true)
    // 稳态：无 lag chip
    expect(wrapper.find('[data-test="pb-hud-lag-friendly"]').attributes('style')).toContain('width: 0%')
    // seek/恢复（hpNoTransition）→ 直接同步新 HP，不补播伤害动画（lag 保持 0%）
    await wrapper.setProps({ friendlyHp: hp('EXACT', 2000, 3000), hpNoTransition: true })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="pb-hud-lag-friendly"]').attributes('style')).toContain('width: 0%')
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

  it('renders only authoritative base states and avoids ownership guesses without perspective', () => {
    const wrapper = mountHud({
      friendlyPoints: null,
      enemyPoints: null,
      friendlyTeam: null,
      baseStates: [
        { baseId: 'A', ownerTeam: 1, capturingTeam: null, captureProgress: null },
        { baseId: 'B', ownerTeam: null, capturingTeam: 2, captureProgress: 42 },
      ],
    })
    expect(wrapper.find('[data-test="pb-hud-score"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-hud-bases"]').text()).toContain('A')
    expect(wrapper.find('[data-test="pb-hud-bases"]').text()).toContain('B')
    expect(wrapper.findAll('.pb-hud-base-controlled')).toHaveLength(1)
    expect(wrapper.findAll('.pb-hud-base-capturing')).toHaveLength(1)
    expect(wrapper.find('.pb-hud-base-progress').attributes('style')).toContain('42%')
  })

  it('keeps the enemy in column 3 when score and bases are absent', () => {
    const wrapper = mountHud({ friendlyPoints: null, enemyPoints: null, baseStates: [] })
    expect(wrapper.find('[data-test="pb-hud-center"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-hud-friendly"]').classes()).toContain('pb-hud-column-friendly')
    expect(wrapper.find('[data-test="pb-hud-enemy"]').classes()).toContain('pb-hud-column-enemy')
  })
})
