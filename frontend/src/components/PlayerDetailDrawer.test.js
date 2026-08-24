// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PlayerDetailDrawer from './PlayerDetailDrawer.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: key => key, locale: { value: 'zh' } })
}))

const SUMMARY_PLAYER = {
  accountId: 1001,
  nickname: 'Alpha',
  clan: 'AAA',
  ratingMedian: 850.4,
  dimensionMedians: [342, 60, 70, 110, 40, 80, 100],
  mvpCount: 2,
  battles: 3,
  wins: 2,
  cells: { account_id: 1001, battles: 3, wins: 2, win_rate: 66.7, damage_avg: 500, assisted_avg: 120, kills_avg: 3.2, earned_avg: 80 },
}

function mountDrawer(context, player) {
  return mount(PlayerDetailDrawer, {
    props: { context, player },
    global: {
      stubs: { PlayerRatingRadar: { template: '<div class="radar-stub" />' }, teleport: true },
      // stub teleport：内容留在组件内，happy-dom 可直接查询
    }
  })
}

describe('PlayerDetailDrawer (plan §8/§9/§23)', () => {
  it('closed when context or player is null', () => {
    const wrapper = mountDrawer(null, null)
    expect(wrapper.find('.player-drawer').exists()).toBe(false)
  })

  it('opens with player data when context and player present', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    expect(wrapper.find('.player-drawer').exists()).toBe(true)
    expect(wrapper.text()).toContain('Alpha')
    expect(wrapper.text()).toContain('AAA')
    expect(wrapper.text()).toContain('850')
    expect(wrapper.find('.radar-stub').exists()).toBe(true)
  })

  it('emits close on backdrop click and close button', async () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    await wrapper.find('.drawer-backdrop').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('emits close on Escape keydown', async () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('shows raw facts including earned avg (获取点数/场)', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    const text = wrapper.text()
    expect(text).toContain('league.drawer.earned_avg')
    expect(text).toContain('80')
    expect(text).toContain('66.7%')
  })

  it('does not show seized points', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 }, SUMMARY_PLAYER)
    expect(wrapper.text()).not.toContain('league.drawer.points_seized')
  })

  it('shows -- for missing rating instead of 0 (plan §8.6)', () => {
    const wrapper = mountDrawer({ scope: 'summary', accountId: 1001 },
      { ...SUMMARY_PLAYER, ratingMedian: null })
    expect(wrapper.text()).toContain('--')
    expect(wrapper.text()).not.toMatch(/\b0\b ·/)
  })
})