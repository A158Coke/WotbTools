// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BattlePlaybackHud from './BattlePlaybackHud.vue'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// happy-dom 环境下 import.meta.url 不是 file: URL，只能走 cwd（vitest 在 frontend/ 下运行）。
const hudSource = readFileSync(resolve(process.cwd(), 'src/components/BattlePlaybackHud.vue'), 'utf8')
const hudMobileBlock = hudSource.slice(hudSource.indexOf('@media (width < 768px)'))

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

  // 基地归属改由地图上的圆圈表达，HUD 不再重复一份 chip。
  it('does not render base chips', () => {
    const wrapper = mountHud({
      friendlyPoints: null,
      enemyPoints: null,
      friendlyTeam: null,
    })
    expect(wrapper.find('[data-test="pb-hud-bases"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-hud-center"]').exists()).toBe(false)
  })

  it('keeps the enemy in column 3 when score and bases are absent', () => {
    const wrapper = mountHud({ friendlyPoints: null, enemyPoints: null })
    expect(wrapper.find('[data-test="pb-hud-center"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-hud-friendly"]').classes()).toContain('pb-hud-column-friendly')
    expect(wrapper.find('[data-test="pb-hud-enemy"]').classes()).toContain('pb-hud-column-enemy')
  })
})

describe('BattlePlaybackHud 手机版式（源码回归）', () => {
  // 手机上 .pb-hud-team 压成单列，标签与数值都落在 row1/col1 —— 两段文字直接叠在一起。
  it('hides the team HP label on phones so it cannot overlap the value', () => {
    expect(hudMobileBlock).toContain('.pb-hud-team .pb-hud-label')
    const rule = hudMobileBlock.slice(hudMobileBlock.indexOf('.pb-hud-team .pb-hud-label'))
    const body = rule.slice(rule.indexOf('{') + 1, rule.indexOf('}'))
    // absolute + clip 而不是 display: none —— 读屏软件仍要能念出「己方/敌方总HP」。
    expect(body).toContain('position: absolute')
    expect(body).toContain('clip-path: inset(50%)')
    expect(body).not.toContain('display: none')
  })

  // 「点数」是这一列的标题，排在比分正上方，而不是和比分并排。
  it('stacks the points label above the score', () => {
    const rule = hudSource.slice(hudSource.indexOf('.pb-hud-points {'))
    const body = rule.slice(rule.indexOf('{') + 1, rule.indexOf('}'))
    expect(body).toContain('display: grid')
    expect(body).toContain('justify-items: center')
    expect(body).not.toContain('display: flex')
  })
})
