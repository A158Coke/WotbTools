// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'
import PlaybackRoster from './PlaybackRoster.vue'

/** 组件的标题走 `t()`，所以必须真正装上 i18n（不是只 mock `$t`）。 */
const i18n = createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: {} } })

/** 2D 的行形状（playbackV2.vehicles）按**物理队伍**分组：{ team1, team2, unknown }。
 *  friendly 标志是录像者视角，故意与物理队伍交错（录像者在 Team 2）——它不得影响分组。 */
const twoDimensionalTeams = {
  team1: [
    { accountId: 1001, playerName: 'You', tankName: 'Maus', team: 1, friendly: false },
    { accountId: 1002, playerName: 'Wingman', tankName: 'T-62A', team: 1, friendly: false },
  ],
  team2: [{ accountId: 2001, playerName: 'Foe', tankName: 'IS-7', team: 2, friendly: true }],
}

/** 3D 物理队伍形状：{ team1, team2, unknown }（场景内核的 store.roster 投影） */
const threeDimensionalTeams = {
  team1: [{ eid: 1, team: 1, nick: 'Alpha', tank: 'Kranvagn', hp: 1950, maxHp: 1950, dead: false, followed: false, color: 'rgb(1, 2, 3)' }],
  team2: [{ eid: 2, team: 2, nick: 'Bravo', tank: 'Maus', hp: 824, maxHp: 1950, dead: false, followed: true, color: 'rgb(4, 5, 6)' }],
  unknown: [],
}

function mountRoster(props = {}) {
  return mount(PlaybackRoster, {
    props: { teams: twoDimensionalTeams, ...props },
    global: { plugins: [i18n] },
  })
}

describe('PlaybackRoster', () => {
  it('2D：按物理队伍分成 Team 1 / Team 2，标题是物理队伍而不是录像者视角', () => {
    const wrapper = mountRoster()
    expect(wrapper.get('.pb-roster-team1').findAll('[data-test="pb-roster-row"]')).toHaveLength(2)
    expect(wrapper.get('.pb-roster-team2').findAll('[data-test="pb-roster-row"]')).toHaveLength(1)
    expect(wrapper.get('.pb-roster-team1 .pb-team-head').text()).toBe('agentReplay.team1')
    expect(wrapper.get('.pb-roster-team2 .pb-team-head').text()).toBe('agentReplay.team2')
    // 录像者视角的 friendly / enemy 分组已经不存在
    expect(wrapper.find('.pb-roster-friendly').exists()).toBe(false)
    expect(wrapper.find('.pb-roster-enemy').exists()).toBe(false)
    expect(wrapper.text()).toContain('You')
    expect(wrapper.text()).toContain('Maus')
    wrapper.unmount()
  })

  it('行里没有 HP 血条：数值与百分比就是主信息；阵亡 = 0 / 0% + 阵亡样式', () => {
    const wrapper = mountRoster({
      health: { 1001: { currentHp: 0, maxHp: 2600 }, 1002: { currentHp: 1950, maxHp: 1950 } },
      destroyed: new Set([1001]),
    })
    expect(wrapper.find('.hpbar').exists()).toBe(false)
    const [dead, alive] = wrapper.findAll('[data-test="pb-roster-row"]')
    expect(dead.get('[data-test="roster-hp"]').text()).toBe('0')
    expect(dead.get('[data-test="roster-hp-pct"]').text()).toBe('0%')
    expect(dead.classes()).toEqual(expect.arrayContaining(['is-destroyed', 'dead']))
    expect(alive.get('[data-test="pb-roster-player"]').text()).toBe('Wingman')
    expect(alive.get('[data-test="pb-roster-tank"]').text()).toBe('T-62A')
    expect(alive.get('[data-test="roster-hp"]').text()).toBe('1950')
    expect(alive.get('[data-test="roster-hp-pct"]').text()).toBe('100%')
    wrapper.unmount()
  })

  it('compact：信息不减（玩家 / 车型 / HP / 百分比都在），只是收紧密度', () => {
    const wrapper = mountRoster({ compact: true, health: { 1001: { currentHp: 1300, maxHp: 2600 } } })
    expect(wrapper.get('[data-test="pb-shell-roster"]').classes()).toContain('pb-roster-compact')
    const row = wrapper.findAll('[data-test="pb-roster-row"]')[0]
    expect(row.get('[data-test="pb-roster-player"]').text()).toBe('You')
    expect(row.get('[data-test="pb-roster-tank"]').text()).toBe('Maus')
    expect(row.get('[data-test="roster-hp"]').text()).toBe('1300')
    expect(row.get('[data-test="roster-hp-pct"]').text()).toBe('50%')
    wrapper.unmount()
  })

  it('2D：行携带玩家 / 车型 / 当前 HP / 百分比，且没有健康数据时不编造数值', () => {
    const wrapper = mountRoster({ health: { 1001: { currentHp: 1300, maxHp: 2600 } } })
    const rows = wrapper.findAll('[data-test="pb-roster-row"]')
    expect(rows[0].get('[data-test="pb-roster-player"]').text()).toBe('You')
    expect(rows[0].get('[data-test="pb-roster-tank"]').text()).toBe('Maus')
    expect(rows[0].get('[data-test="roster-hp"]').text()).toBe('1300')
    expect(rows[0].get('[data-test="roster-hp-pct"]').text()).toBe('50%')
    // 没有投影的一行：数值与百分比都是 —（unknown ≠ 0）
    expect(rows[1].get('[data-test="roster-hp"]').text()).toBe('—')
    expect(rows[1].get('[data-test="roster-hp-pct"]').text()).toBe('—')
    wrapper.unmount()
  })

  it('百分比在没有可信上限时是 — 而不是 0%；真实归零才显示 0%', async () => {
    const wrapper = mountRoster({ health: { 1001: { currentHp: 800, maxHp: 0 } } })
    const first = wrapper.findAll('[data-test="pb-roster-row"]')[0]
    expect(first.get('[data-test="roster-hp"]').text()).toBe('800')
    expect(first.get('[data-test="roster-hp-pct"]').text()).toBe('—')
    expect(first.get('[data-test="roster-hp-pct"]').text()).not.toContain('0%')

    await wrapper.setProps({ health: { 1001: { currentHp: 0, maxHp: 2600 } } })
    expect(wrapper.findAll('[data-test="pb-roster-row"]')[0].get('[data-test="roster-hp-pct"]').text()).toBe('0%')
    wrapper.unmount()
  })

  it('点行 → select 事件带该行 id；阵亡行走 destroyed 集合而不是行内猜测', async () => {
    const wrapper = mountRoster({ destroyed: new Set([1002]) })
    const rows = wrapper.findAll('[data-test="pb-roster-row"]')
    expect(rows[1].classes()).toContain('is-destroyed')
    expect(rows[0].classes()).not.toContain('is-destroyed')
    await rows[0].trigger('click')
    expect(wrapper.emitted('select')[0][0]).toBe(1001)
    wrapper.unmount()
  })

  it('3D 变体：物理队伍分组 + 物理队色圆点 + followed 与 selected 各自成立', () => {
    const wrapper = mountRoster({
      teams: threeDimensionalTeams,
      variant: '3d',
      selectedId: 1,
    })
    // 空分组不渲染（unknown 为空）
    expect(wrapper.find('.team-unknown').exists()).toBe(false)
    expect(wrapper.get('.team1').findAll('[data-test="pb-roster-row"]')).toHaveLength(1)
    expect(wrapper.get('.team2').findAll('[data-test="pb-roster-row"]')).toHaveLength(1)
    expect(wrapper.get('.team1 .pb-team-head').text()).toBe('agentReplay.team1')
    // 行首圆点只存在于 3D 变体（2D 用左侧物理队色条），颜色来自行本身（物理队伍色）
    const dot = wrapper.get('.team1 .dot')
    expect(dot.attributes('style')).toContain('rgb(1, 2, 3)')
    expect(wrapper.get('.team2 .dot').attributes('style')).toContain('rgb(4, 5, 6)')
    // 2D 行没有圆点
    const twoD = mountRoster()
    expect(twoD.find('.dot').exists()).toBe(false)
    twoD.unmount()
    // selected / followed 是两个独立状态
    const selected = wrapper.get('.team1 [data-test="pb-roster-row"]')
    const followed = wrapper.get('.team2 [data-test="pb-roster-row"]')
    expect(selected.classes()).toContain('selected')
    expect(selected.classes()).not.toContain('followed')
    expect(followed.classes()).toContain('followed')
    expect(followed.classes()).not.toContain('selected')
    // 3D 行自带 hp / maxHp / dead，不需要外部 health 投影
    expect(wrapper.get('.team2 [data-test="roster-hp"]').text()).toBe('824')
    expect(wrapper.get('.team2 [data-test="roster-hp-pct"]').text()).toBe('42%')
    expect(wrapper.get('.team2 [data-test="pb-roster-player"]').text()).toBe('Bravo')
    wrapper.unmount()
  })

  it('showEmptyTeams：解析出名单之前保留三个空队伍标题（而不是画一份假名册）', () => {
    const wrapper = mountRoster({ teams: { team1: [], team2: [], unknown: [] }, variant: '3d', showEmptyTeams: true })
    expect(wrapper.get('.team1').findAll('[data-test="pb-roster-row"]')).toHaveLength(0)
    expect(wrapper.get('.team2').findAll('[data-test="pb-roster-row"]')).toHaveLength(0)
    expect(wrapper.get('.team-unknown').findAll('[data-test="pb-roster-row"]')).toHaveLength(0)
    // 默认（不开 showEmptyTeams）不画空标题——3D 的 unknown 常态为空，空标题是噪音
    const compact = mountRoster({ teams: { team1: [], team2: [], unknown: [] }, variant: '3d' })
    expect(compact.find('.team-unknown').exists()).toBe(false)
    expect(compact.find('.team1').exists()).toBe(false)
    wrapper.unmount()
    compact.unmount()
  })
})
