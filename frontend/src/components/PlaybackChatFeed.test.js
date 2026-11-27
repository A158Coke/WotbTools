// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PlaybackChatFeed from './PlaybackChatFeed.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key) => key }),
}))
vi.mock('../composables/useTankNames.js', () => ({
  useTankNames: () => ({ value: {} }),
}))

const FACET = {
  meta: { friendly_team: 1 },
  vehicles: [
    { eid: 1, nickname: 'Alpha', team: 1 },
    { eid: 2, nickname: 'Bravo', team: 2 },
  ],
  chat_events: [
    { t: 1, kind: 'command', raw_type: 20, sender: 'Alpha', command: 29, command_name: 'attack_enemy', target: 2 },
    { t: 2, kind: 'command', raw_type: 20, sender: 'Bravo', command: 29, command_name: 'attack_enemy', target: 1 },
  ],
  chat_channels: [{ id: 1549648, channel_name: '#chat:channels/battle/team' }],
}

describe('PlaybackChatFeed', () => {
  it('按发送者阵营着色，且命令标题不带内部频道名', () => {
    const wrapper = mount(PlaybackChatFeed, {
      props: { facet: FACET, time: 3, hidden: false },
    })
    const rows = wrapper.findAll('.pb-chat-feed-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].attributes('data-faction')).toBe('friendly')
    expect(rows[1].attributes('data-faction')).toBe('enemy')
    expect(rows[0].text()).not.toContain('team')
    expect(rows[1].text()).not.toContain('team')
  })

  it('缺少友方阵营口径时不猜测颜色', () => {
    const wrapper = mount(PlaybackChatFeed, {
      props: { facet: { ...FACET, meta: {} }, time: 3, hidden: false },
    })
    expect(wrapper.findAll('.pb-chat-feed-row').map((row) => row.attributes('data-faction'))).toEqual([undefined, undefined])
  })
})
