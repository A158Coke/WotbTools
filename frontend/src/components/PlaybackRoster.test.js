// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
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

  it('HP 呈现：exact 数值走 aria-label（行样式回归原始单行版，视觉只有细血条）', () => {
    const wrapper = mountRoster({
      health: { 1001: { currentHp: 0, maxHp: 2600 }, 1002: { currentHp: 1950, maxHp: 1950 } },
      destroyed: new Set([1001]),
    })
    const [dead, alive] = wrapper.findAll('[data-test="pb-roster-row"]')
    // 阵亡：有量程 → `0 / max`；条为空；阵亡样式
    expect(dead.get('[data-test="roster-hp"]').attributes('aria-label')).toBe('0 / 2600')
    expect(dead.classes()).toEqual(expect.arrayContaining(['is-destroyed', 'dead']))
    // 存活且权威：exact 数值在 aria-label，**没有** `100%` 后缀
    const bar = alive.get('[data-test="roster-hp"]')
    expect(bar.attributes('aria-label')).toBe('1950 / 1950')
    expect(bar.attributes('aria-label')).not.toContain('%')
    // 视觉只有条形（无文字节点）；血量条宽度按比例
    expect(bar.classes()).toContain('hp-mode-exact')
    expect(bar.element.querySelector('.pb-roster-hpfill').style.width).toBe('100%')
    expect(alive.get('[data-test="pb-roster-player"]').text()).toBe('Wingman')
    expect(alive.get('[data-test="pb-roster-tank"]').text()).toBe('T-62A')
    wrapper.unmount()
  })

  it('HP 呈现：relative / unknown 不伪造 exact 数值，unknown 不画满绿', () => {
    const wrapper = mountRoster({
      health: {
        // 敌方尚未点亮：只有相对证据（backend relativeFull）→ 100%，没有 current/max
        1001: { currentHp: null, maxHp: null, relativeFull: true },
        // 只有相对比例 → 52%
        1002: { currentHp: null, maxHp: null, pct: 52 },
      },
    })
    const [relative, damaged] = wrapper.findAll('[data-test="pb-roster-row"]')
    expect(relative.get('[data-test="roster-hp"]').attributes('aria-label')).toBe('100%')
    expect(relative.get('[data-test="roster-hp"]').classes()).toContain('hp-mode-relative')
    expect(damaged.get('[data-test="roster-hp"]').attributes('aria-label')).toBe('52%')
    // relative 不是 unknown：fill 按比例画
    expect(damaged.element.querySelector('.pb-roster-hpfill').style.width).toBe('52%')

    // 没有任何健康事实（第三行没有投影）→ unknown：`—`，且绝不画满绿（fill 节点根本不渲染）
    const bare = mountRoster()
    const unknownRow = bare.findAll('[data-test="pb-roster-row"]')[1]
    expect(unknownRow.get('[data-test="roster-hp"]').attributes('aria-label')).toBe('—')
    expect(unknownRow.get('[data-test="roster-hp"]').classes()).toContain('hp-mode-unknown')
    expect(unknownRow.find('.pb-roster-hpfill').exists()).toBe(false)
    bare.unmount()
    wrapper.unmount()
  })

  it('HP 呈现：上限不可信时退回 relative/unknown，绝不把未知上屏成 0%', async () => {
    const wrapper = mountRoster({ health: { 1001: { currentHp: 800, maxHp: 0 } } })
    const first = () => wrapper.findAll('[data-test="pb-roster-row"]')[0]
    // maxHp=0 不可信 → 不能写 `800 / 0`，也不能算成 0%
    expect(first().get('[data-test="roster-hp"]').attributes('aria-label')).not.toContain('0 / 0')
    expect(first().get('[data-test="roster-hp"]').classes()).toContain('hp-mode-unknown')
    expect(first().get('[data-test="roster-hp"]').attributes('aria-label')).toBe('—')

    // 真实归零（有可信上限）才显示 0 / max
    await wrapper.setProps({ health: { 1001: { currentHp: 0, maxHp: 2600 } } })
    expect(first().get('[data-test="roster-hp"]').attributes('aria-label')).toBe('0 / 2600')
    wrapper.unmount()
  })

  it('reload(弹夹)不再展示：行样式回归原始单行版（f226174b）', () => {
    const reload = [{ state: 'full' }, { state: 'loading', progress: 0.5 }, { state: 'locked' }]
    const wrapper = mountRoster({
      variant: '3d',
      teams: {
        team1: [{ eid: 1, team: 1, nick: 'Alpha', tank: 'Kranvagn', hp: 1950, maxHp: 1950, dead: false, reload }],
        team2: [], unknown: [],
      },
    })
    // 有权威 telemetry 也不渲染弹夹分段（2026-10-05 需求：行样式回归原始版）
    expect(wrapper.find('[data-test="roster-reload"]').exists()).toBe(false)
    expect(wrapper.find('.pb-roster-reload').exists()).toBe(false)
    const alpha = wrapper.get('.team1 [data-test="pb-roster-row"]')
    expect(alpha.get('[data-test="pb-roster-player"]').text()).toBe('Alpha')
    expect(alpha.find('[data-test="roster-hp"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('HP 条源码回归：行尾细条 52×5（原始样式），无条内文字/弹夹分段节点', () => {
    // happy-dom 没有布局引擎（computed style 量不到真实尺寸），所以这里锁的是**声明本身**；
    // 真实渲染后的比值由 browser gate 断言。
    const source = readFileSync('src/components/PlaybackRoster.vue', 'utf8')
    const block = (selector) => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const m = source.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'))
      return m ? m[1] : ''
    }
    const hpBar = block('.pb-roster-hpbar')
    expect(hpBar).toContain('inline-size: 52px')
    expect(hpBar).toContain('block-size: 5px')
    // 单行 flex 行；条内文字 / 弹夹分段的节点与样式均已移除
    expect(block('.pb-roster-row')).toContain('flex-direction: row')
    expect(source).not.toContain('pb-roster-hptext')
    expect(source).not.toContain('pb-roster-reload')
    expect(source).not.toContain('pb-roster-shell')
  })

  it('compact：信息不减（玩家 / 车型 / HP 条都在），只是收紧密度并开启纵向铺满', () => {
    const wrapper = mountRoster({ compact: true, health: { 1001: { currentHp: 1300, maxHp: 2600 } } })
    const shell = wrapper.get('[data-test="pb-shell-roster"]')
    expect(shell.classes()).toContain('pb-roster-compact')
    // 宽档侧车道需要纵向铺满（header 固定 + 列表吃满剩余高度）
    expect(shell.classes()).toContain('pb-roster-fill')
    const row = wrapper.findAll('[data-test="pb-roster-row"]')[0]
    expect(row.get('[data-test="pb-roster-player"]').text()).toBe('You')
    expect(row.get('[data-test="pb-roster-tank"]').text()).toBe('Maus')
    expect(row.get('[data-test="roster-hp"]').attributes('aria-label')).toBe('1300 / 2600')
    wrapper.unmount()
  })

  it('纵向铺满：列表轨道是 N × minmax(可读下限, 1fr)，不是固定大 px', () => {
    const wrapper = mountRoster({ compact: true })
    const list = wrapper.get('.pb-roster-team1 .pb-roster-list')
    // 2 行 → repeat(2, minmax(<min>px, 1fr))：固定值只作 guard，正常高度由 1fr 连续决定
    expect(list.attributes('style')).toContain('repeat(2, minmax(')
    expect(list.attributes('style')).toContain('1fr)')
    wrapper.unmount()
  })

  it('2D：行携带玩家 / 车型 / HP 条，且没有健康数据时不编造数值', () => {
    const wrapper = mountRoster({ health: { 1001: { currentHp: 1300, maxHp: 2600 } } })
    const rows = wrapper.findAll('[data-test="pb-roster-row"]')
    expect(rows[0].get('[data-test="pb-roster-player"]').text()).toBe('You')
    expect(rows[0].get('[data-test="pb-roster-tank"]').text()).toBe('Maus')
    expect(rows[0].get('[data-test="roster-hp"]').attributes('aria-label')).toBe('1300 / 2600')
    // 没有投影的一行：unknown → —（unknown ≠ 0）
    expect(rows[1].get('[data-test="roster-hp"]').attributes('aria-label')).toBe('—')
    expect(rows[1].get('[data-test="roster-hp"]').classes()).toContain('hp-mode-unknown')
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
    expect(dot.attributes('style')).toContain('--color-text-secondary')
    expect(wrapper.get('.team2 .dot').attributes('style')).toContain('--color-text-secondary')
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
    // 3D 行自带 hp / maxHp / dead，不需要外部 health 投影 → exact 数值
    expect(wrapper.get('.team2 [data-test="roster-hp"]').attributes('aria-label')).toBe('824 / 1950')
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
