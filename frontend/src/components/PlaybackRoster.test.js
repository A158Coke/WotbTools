// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'
import PlaybackRoster from './PlaybackRoster.vue'

const i18n = createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: {} } })

const twoDimensionalTeams = {
  team1: [
    { accountId: 1001, playerName: 'You', tankName: 'Maus', team: 1, friendly: false },
    { accountId: 1002, playerName: 'Wingman', tankName: 'T-62A', team: 1, friendly: false },
  ],
  team2: [{ accountId: 2001, playerName: 'Foe', tankName: 'IS-7', team: 2, friendly: true }],
}

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
    expect(wrapper.find('.pb-roster-friendly').exists()).toBe(false)
    expect(wrapper.find('.pb-roster-enemy').exists()).toBe(false)
    expect(wrapper.text()).toContain('You')
    expect(wrapper.text()).toContain('Maus')
    wrapper.unmount()
  })

  it('血条内写可证明的数值：阵亡不占位，未知不伪造', () => {
    const wrapper = mountRoster({
      health: { 1001: { currentHp: 0, maxHp: 2600 }, 1002: { currentHp: 1234.4, maxHp: 1950 } },
      destroyed: new Set([1001]),
    })
    const [dead, alive] = wrapper.findAll('[data-test="pb-roster-row"]')
    expect(dead.find('[data-test="roster-hp-value"]').exists()).toBe(false)
    expect(alive.get('[data-test="roster-hp"] [data-test="roster-hp-value"]').text()).toBe('1234')
    const unknown = mountRoster({ health: { 1001: {}, 1002: {} } })
    expect(new Set(unknown.findAll('[data-test="roster-hp-value"]').map(node => node.text()))).toEqual(new Set(['—']))
  })

  it('HP 呈现：exact 数值走 aria-label（行样式回归原始单行版，视觉只有细血条）', () => {
    const wrapper = mountRoster({
      health: { 1001: { currentHp: 0, maxHp: 2600 }, 1002: { currentHp: 1950, maxHp: 1950 } },
      destroyed: new Set([1001]),
    })
    const [dead, alive] = wrapper.findAll('[data-test="pb-roster-row"]')
    expect(dead.get('[data-test="roster-hp"]').attributes('aria-label')).toBe('0 / 2600')
    expect(dead.classes()).toEqual(expect.arrayContaining(['is-destroyed', 'dead']))
    const bar = alive.get('[data-test="roster-hp"]')
    expect(bar.attributes('aria-label')).toBe('1950 / 1950')
    expect(bar.attributes('aria-label')).not.toContain('%')
    expect(bar.classes()).toContain('hp-mode-exact')
    expect(bar.element.querySelector('.pb-roster-hpfill').style.width).toBe('100%')
    expect(alive.classes()).toContain('hp-mode-exact')
    expect(alive.get('[data-test="pb-roster-player"]').text()).toBe('Wingman')
    expect(alive.get('[data-test="pb-roster-tank"]').text()).toBe('T-62A')
    wrapper.unmount()
  })

  it('HP 呈现：relative / unknown 不伪造 exact 数值，unknown 不画满绿', () => {
    const wrapper = mountRoster({
      health: {
        1001: { currentHp: null, maxHp: null, relativeFull: true },
        1002: { currentHp: null, maxHp: null, pct: 52 },
      },
    })
    const [relative, damaged] = wrapper.findAll('[data-test="pb-roster-row"]')
    expect(relative.get('[data-test="roster-hp"]').attributes('aria-label')).toBe('100%')
    expect(relative.get('[data-test="roster-hp"]').classes()).toContain('hp-mode-relative')
    expect(damaged.get('[data-test="roster-hp"]').attributes('aria-label')).toBe('52%')
    expect(damaged.element.querySelector('.pb-roster-hpfill').style.width).toBe('52%')

    const bare = mountRoster()
    const unknownRow = bare.findAll('[data-test="pb-roster-row"]')[1]
    expect(unknownRow.get('[data-test="roster-hp"]').attributes('aria-label')).toBe('—')
    expect(unknownRow.get('[data-test="roster-hp"]').classes()).toContain('hp-mode-unknown')
    expect(unknownRow.classes()).toContain('hp-mode-unknown')
    expect(unknownRow.find('.pb-roster-hpfill').exists()).toBe(false)
    bare.unmount()
    wrapper.unmount()
  })

  it('HP 呈现：上限不可信时退回 relative/unknown，绝不把未知上屏成 0%', async () => {
    const wrapper = mountRoster({ health: { 1001: { currentHp: 800, maxHp: 0 } } })
    const first = () => wrapper.findAll('[data-test="pb-roster-row"]')[0]
    expect(first().get('[data-test="roster-hp"]').attributes('aria-label')).not.toContain('0 / 0')
    expect(first().get('[data-test="roster-hp"]').classes()).toContain('hp-mode-unknown')
    expect(first().get('[data-test="roster-hp"]').attributes('aria-label')).toBe('—')

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
    expect(wrapper.find('[data-test="roster-reload"]').exists()).toBe(false)
    expect(wrapper.find('.pb-roster-reload').exists()).toBe(false)
    const alpha = wrapper.get('.team1 [data-test="pb-roster-row"]')
    expect(alpha.get('[data-test="pb-roster-player"]').text()).toBe('Alpha')
    expect(alpha.find('[data-test="roster-hp"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('HP 条源码回归：填充段 = 整条行宽（绝对定位到行），数值保留行尾 52px 槽位；无弹夹分段节点', () => {
    const source = readFileSync('src/components/PlaybackRoster.vue', 'utf8')
    const block = (selector) => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const m = source.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'))
      return m ? m[1] : ''
    }
    const hpBar = block('.pb-roster-hpbar')
    expect(hpBar).toContain('inline-size: 52px')
    expect(hpBar).toContain('block-size: var(--space-4)')
    const fill = block('.pb-roster-hpfill')
    expect(fill).toContain('position: absolute')
    expect(fill).toContain('inset-block: 0')
    expect(fill).not.toContain('block-size: 66.667%')
    expect(fill).toContain('inset-inline-start: 0')
    expect(fill).toContain('z-index: var(--roster-rowfill-z)')
    const row = block('.pb-roster-row')
    expect(row).toContain('--roster-rowfill-z: -1')
    expect(row).toContain('flex-direction: row')
    expect(row).toContain('isolation: isolate')
    expect(row).toContain('overflow: hidden')
    expect(source).toMatch(/\.pb-roster-team \.pb-roster-row \{ background: var\(--color-playback-label-track\)/)
    const card = block('.pb-roster-3d')
    expect(card).toContain('flex: 0 0 auto')
    expect(source).toContain('.pb-roster-3d.pb-roster-compact:not(.pb-roster-dense) { flex: 0 0 66.667%; }')
    expect(block('.pb-roster-hpvalue')).not.toContain('position: absolute')
    expect(source).toContain('.pb-roster-team .pb-roster-row.hp-mode-unknown')
    expect(source).not.toContain('pb-roster-hptext')
    expect(source).not.toContain('pb-roster-reload')
    expect(source).not.toContain('pb-roster-shell')
  })

  it('源码回归：车型列必须可收缩（flex 允许 shrink）——否则窄面板横向撑破出滚动条', () => {
    const source = readFileSync('src/components/PlaybackRoster.vue', 'utf8')
    const m = source.match(/\.pb-roster-row \.tank \{([^}]*)\}/)
    expect(m).toBeTruthy()
    expect(m[1]).not.toContain('flex: none')
    expect(m[1]).toMatch(/flex:\s*0 1 auto/)
    expect(source).toMatch(/\.pb-roster-hpbar \{[^}]*flex: none/)
  })

  it('compact：信息不减（玩家 / 车型 / HP 条都在），只是收紧密度并开启纵向铺满', () => {
    const wrapper = mountRoster({ compact: true, health: { 1001: { currentHp: 1300, maxHp: 2600 } } })
    const shell = wrapper.get('[data-test="pb-shell-roster"]')
    expect(shell.classes()).toContain('pb-roster-compact')
    expect(shell.classes()).toContain('pb-roster-fill')
    const row = wrapper.findAll('[data-test="pb-roster-row"]')[0]
    expect(row.get('[data-test="pb-roster-player"]').text()).toBe('You')
    expect(row.get('[data-test="pb-roster-tank"]').text()).toBe('Maus')
    expect(row.get('[data-test="roster-hp"]').attributes('aria-label')).toBe('1300 / 2600')
    wrapper.unmount()
  })

  it('dense：固定 30px 轨道、不纵向铺满、两行信息、44×20 窄血条、隐藏枪章', () => {
    const wrapper = mountRoster({ compact: true, dense: true, gunMarks: new Map([[1001, 2]]) })
    const shell = wrapper.get('[data-test="pb-shell-roster"]')
    expect(shell.classes()).toContain('pb-roster-dense')
    expect(shell.classes()).not.toContain('pb-roster-fill')
    const list = wrapper.get('.pb-roster-team1 .pb-roster-list')
    expect(list.attributes('style')).toContain('repeat(2, var(--roster-row-dense, 30px))')
    const row = wrapper.findAll('[data-test="pb-roster-row"]')[0]
    expect(row.element.tagName).toBe('BUTTON')
    expect(row.get('[data-test="pb-roster-player"]').text()).toBe('You')
    expect(row.get('[data-test="pb-roster-tank"]').text()).toBe('Maus')
    expect(row.get('[data-test="roster-hp"]').exists()).toBe(true)
    expect(row.find('[data-gun-marks]').exists()).toBe(false)
    const source = readFileSync('src/components/PlaybackRoster.vue', 'utf8')
    const block = (selector) => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const m = source.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'))
      return m ? m[1] : ''
    }
    const denseRow = block('.pb-roster-dense .pb-roster-row')
    expect(denseRow).toContain('grid-template-rows')
    expect(denseRow).toContain('block-size: var(--roster-row-dense, 30px)')
    const denseHp = block('.pb-roster-dense .pb-roster-hpbar')
    expect(denseHp).toContain('inline-size: 44px')
    expect(denseHp).toContain('block-size: 20px')

    const stateful = mountRoster({
      compact: true,
      dense: true,
      selectedId: 1001,
      destroyed: new Set([1001]),
      friendlyTeam: 1,
    })
    const selectedDead = stateful.findAll('[data-test="pb-roster-row"]')[0]
    expect(selectedDead.classes()).toEqual(expect.arrayContaining(['is-selected', 'selected', 'is-destroyed', 'dead']))
    expect(selectedDead.attributes('style')).toContain('--roster-team-color')
    expect(selectedDead.attributes('aria-pressed')).toBe('true')
    stateful.unmount()
    wrapper.unmount()
  })

  it('纵向铺满：列表轨道是 N × minmax(可读下限, 1fr)，不是固定大 px', () => {
    const wrapper = mountRoster({ compact: true })
    const list = wrapper.get('.pb-roster-team1 .pb-roster-list')
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
    expect(wrapper.find('.team-unknown').exists()).toBe(false)
    expect(wrapper.get('.team1').findAll('[data-test="pb-roster-row"]')).toHaveLength(1)
    expect(wrapper.get('.team2').findAll('[data-test="pb-roster-row"]')).toHaveLength(1)
    expect(wrapper.get('.team1 .pb-team-head').text()).toBe('agentReplay.team1')
    const dot = wrapper.get('.team1 .dot')
    expect(dot.attributes('style')).toContain('--color-text-secondary')
    expect(wrapper.get('.team2 .dot').attributes('style')).toContain('--color-text-secondary')
    const twoD = mountRoster()
    expect(twoD.find('.dot').exists()).toBe(false)
    twoD.unmount()
    const selected = wrapper.get('.team1 [data-test="pb-roster-row"]')
    const followed = wrapper.get('.team2 [data-test="pb-roster-row"]')
    expect(selected.classes()).toContain('selected')
    expect(selected.classes()).not.toContain('followed')
    expect(followed.classes()).toContain('followed')
    expect(followed.classes()).not.toContain('selected')
    expect(wrapper.get('.team2 [data-test="roster-hp"]').attributes('aria-label')).toBe('824 / 1950')
    expect(wrapper.get('.team2 [data-test="pb-roster-player"]').text()).toBe('Bravo')
    wrapper.unmount()
  })

  it('showEmptyTeams：解析出名单之前保留三个空队伍标题（而不是画一份假名册）', () => {
    const wrapper = mountRoster({ teams: { team1: [], team2: [], unknown: [] }, variant: '3d', showEmptyTeams: true })
    expect(wrapper.get('.team1').findAll('[data-test="pb-roster-row"]')).toHaveLength(0)
    expect(wrapper.get('.team2').findAll('[data-test="pb-roster-row"]')).toHaveLength(0)
    expect(wrapper.get('.team-unknown').findAll('[data-test="pb-roster-row"]')).toHaveLength(0)
    const compact = mountRoster({ teams: { team1: [], team2: [], unknown: [] }, variant: '3d' })
    expect(compact.find('.team-unknown').exists()).toBe(false)
    expect(compact.find('.team1').exists()).toBe(false)
    wrapper.unmount()
    compact.unmount()
  })
})

it('keeps earned marks bound to account identity in 2D/3D and clears them when the owning result changes', async () => {
  const wrapper = mountRoster({ gunMarks: new Map([[1001, 2], [1002, 3]]) })
  expect(wrapper.findAll('[data-gun-marks]').map(el => el.attributes('data-gun-marks'))).toEqual(['2', '3'])
  await wrapper.setProps({ variant: '3d', teams: { team1: [{ eid: 9, accountId: 1001, nick: 'You', tank: 'Maus', team: 1 }], team2: [] } })
  expect(wrapper.get('[data-gun-marks]').attributes('data-gun-marks')).toBe('2')
  await wrapper.setProps({ gunMarks: new Map() })
  expect(wrapper.find('[data-gun-marks]').exists()).toBe(false)
  wrapper.unmount()
})
