// @vitest-environment happy-dom

import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import VehicleDetailsPanel from './VehicleDetailsPanel.vue'

const inspectorStub = defineComponent({
  props: ['track', 'timeSec'],
  setup(props) {
    return () => h('div', { 'data-test': 'pb-sb-v2-inspector' }, `inspector:${props.timeSec}`)
  },
})

const selectedState = {
  vehicle: { accountId: 7, tankId: 101, tankName: 'Tiger II', playerName: 'Ace', team: 1 },
  destroyed: true,
  destroyedKnownAtSec: 42,
}

describe('VehicleDetailsPanel', () => {
  it('shows selected vehicle facts, HP stats, destroyed/last-known state, and damage log', () => {
    const wrapper = mount(VehicleDetailsPanel, {
      props: {
        selectedState,
        friendlyTeam: 1,
        selectedPortraitUrl: '/tank.webp',
        selLastKnownSec: 35,
        selCurStats: { dealt: 900, received: 300, kills: 1 },
        selectedV2Track: { accountId: 7 },
        currentTime: 45,
        selDamageLog: [
          { timeSec: 12, dir: 'out', hpLoss: 400, label: 'Enemy' },
          { timeSec: 20, dir: 'in', hpLoss: 250, label: 'Shell' },
        ],
        formatClock: sec => `00:${sec}`,
      },
      global: { stubs: { V2VehicleInspector: inspectorStub }, mocks: { $t: key => key } },
    })

    expect(wrapper.find('[data-test="pb-sb-tank"]').text()).toBe('Tiger II')
    expect(wrapper.find('[data-test="pb-sb-player"]').text()).toBe('Ace')
    expect(wrapper.find('[data-test="pb-sb-portrait"] img').attributes('src')).toBe('/tank.webp')
    expect(wrapper.text()).toContain('00:35')
    expect(wrapper.text()).toContain('00:42')
    expect(wrapper.find('[data-test="pb-sb-dealt"]').text()).toBe('900')
    expect(wrapper.text()).toContain('Enemy')
    expect(wrapper.text()).toContain('Shell')
    expect(wrapper.find('[data-test="pb-sb-v2-inspector"]').text()).toContain('inspector:45')
  })

  it('emits close and renders nothing when no vehicle is selected', async () => {
    const wrapper = mount(VehicleDetailsPanel, {
      props: { selectedState: null, formatClock: sec => String(sec) },
      global: { stubs: { V2VehicleInspector: inspectorStub }, mocks: { $t: key => key } },
    })
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(false)

    await wrapper.setProps({ selectedState })
    await wrapper.find('[data-test="pb-sb-close"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
