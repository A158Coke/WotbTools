// @vitest-environment happy-dom

import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
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

function mountPanel(props = {}) {
  return mount(VehicleDetailsPanel, {
    props: { selectedState: { ...selectedState, destroyed: false, destroyedKnownAtSec: null }, formatClock: sec => `00:${sec}`, ...props },
    global: { stubs: { V2VehicleInspector: inspectorStub }, mocks: { $t: key => key } },
  })
}

describe('VehicleDetailsPanel', () => {
  it('shows selected vehicle facts, HP stats, destroyed/last-known state, and damage log', () => {
    const wrapper = mount(VehicleDetailsPanel, {
      props: {
        selectedState,
        selectedPortraitUrl: '/tank.webp',
        selLastKnownSec: 35,
        selCurStats: { dealt: 900, received: 300, kills: 1 },
        selectedTrack: { accountId: 7 },
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
    expect(wrapper.find('[data-test="pb-sb-received"]').text()).toBe('300')
    expect(wrapper.find('[data-test="pb-sb-kills"]').text()).toBe('1')
    expect(wrapper.text()).toContain('Enemy')
    expect(wrapper.text()).toContain('Shell')
    expect(wrapper.find('[data-test="pb-sb-v2-inspector"]').text()).toContain('inspector:45')
  })

  it('renders the authoritative 3D subset through the same common details presentation', () => {
    const wrapper = mountPanel({
      selectedState: {
        vehicle: { tankName: 'Maus', playerName: 'Driver', team: 2, friendly: true },
        destroyed: false,
      },
      health: { currentHp: 824, maxHp: 1950 },
      currentTime: 45,
    })
    expect(wrapper.find('[data-test="pb-sb-tank"]').text()).toBe('Maus')
    expect(wrapper.find('[data-test="pb-sb-player"]').text()).toBe('Driver')
    expect(wrapper.find('[data-test="pb-sb-team"]').text()).toBe('agentReplay.team2')
    expect(wrapper.find('[data-test="pb-sb-relation"]').text()).toContain('team_friendly')
    expect(wrapper.find('[data-test="pb-sb-hp-current"]').text()).toBe('824')
    expect(wrapper.find('[data-test="pb-sb-hp-max"]').text()).toBe('/ 1950')
    expect(wrapper.find('[data-test="pb-sb-hp-percentage"]').text()).toContain('42%')
    expect(wrapper.text()).toContain('00:45')
    expect(wrapper.find('[data-test="pb-sb-v2-inspector"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-sb-portrait"]').exists()).toBe(false)
    expect(wrapper.find('.pb-sb-log').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-sb-dealt"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-sb-received"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-sb-kills"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each([null, 0, undefined, NaN])('unknown maxHP (%s) preserves the current number without inventing 0%%', (maxHp) => {
    const wrapper = mountPanel({ health: { currentHp: 500, maxHp } })
    expect(wrapper.find('[data-test="pb-sb-hp-current"]').text()).toBe('500')
    expect(wrapper.find('[data-test="pb-sb-hp-max"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-sb-hp-percentage"]').text()).toContain('—')
    expect(wrapper.find('[data-test="pb-sb-hp"]').text()).not.toContain('0%')
    wrapper.unmount()
  })

  it('labels stale health as last known rather than a current observation', () => {
    const wrapper = mountPanel({ health: { currentHp: 500, maxHp: 1000, state: 'LAST_KNOWN' } })
    expect(wrapper.text()).toContain('recon.map.playback.last_known_hp')
    expect(wrapper.find('[data-test="pb-sb-hp-current"]').text()).toBe('500')
    wrapper.unmount()
  })

  it('missing currentHP stays unknown even when maxHP exists; real known zero is preserved', async () => {
    const wrapper = mountPanel({ health: { currentHp: null, maxHp: 1500 } })
    expect(wrapper.find('[data-test="pb-sb-hp-current"]').text()).toBe('—')
    expect(wrapper.find('[data-test="pb-sb-hp-percentage"]').text()).not.toContain('0%')
    await wrapper.setProps({ health: { currentHp: 0, maxHp: 1500 } })
    expect(wrapper.find('[data-test="pb-sb-hp-current"]').text()).toBe('0')
    expect(wrapper.find('[data-test="pb-sb-hp-percentage"]').text()).toContain('0%')
    wrapper.unmount()
  })

  it('destroyed subset shows explicit state/time and does not foreground a zero HP display', () => {
    const wrapper = mountPanel({ selectedState, health: { currentHp: 0, maxHp: 1950 } })
    expect(wrapper.find('[data-test="pb-sb-state"]').text()).toBe('recon.map.playback.state_destroyed')
    expect(wrapper.find('[data-test="pb-sb-hp"]').text()).toBe('recon.map.playback.state_destroyed')
    expect(wrapper.find('[data-test="pb-sb-hp-current"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-sb-hp-percentage"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('00:42')
    wrapper.unmount()
  })

  it('optional individual counters stay absent rather than acquiring fake zeros', () => {
    const wrapper = mountPanel({ selCurStats: { dealt: 0, received: null } })
    expect(wrapper.find('[data-test="pb-sb-dealt"]').text()).toBe('0')
    expect(wrapper.find('[data-test="pb-sb-received"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-sb-kills"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('phone-form presentation is explicit and survives width-independent rotation', async () => {
    const wrapper = mountPanel({ phoneForm: true })
    const element = wrapper.find('[data-test="pb-info"]').element
    expect(wrapper.find('[data-test="pb-info"]').classes()).toContain('phone-form')
    // The renderer owns geometry; changing form keeps this common panel mounted.
    await wrapper.setProps({ phoneForm: false })
    expect(wrapper.find('[data-test="pb-info"]').classes()).not.toContain('phone-form')
    expect(wrapper.find('[data-test="pb-info"]').element).toBe(element)
    await wrapper.setProps({ phoneForm: true })
    expect(wrapper.find('[data-test="pb-info"]').classes()).toContain('phone-form')
    wrapper.unmount()
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

describe('VehicleDetailsPanel inline (phone / portrait) selection feedback', () => {
  it('scrolls the inline details into view when a vehicle is selected or changed; floating never scrolls', async () => {
    const scrollIntoView = vi.fn()
    const original = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    try {
      const inline = mountPanel({ presentation: 'inline' })
      await flushPromises()
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' })
      // 同一台车的时间推进 / 统计刷新不触发滚动
      await inline.setProps({ currentTime: 99, selCurStats: { dealt: 1, received: 2, kills: 0 } })
      await flushPromises()
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      await inline.setProps({ selectedState: { ...selectedState, vehicle: { ...selectedState.vehicle, accountId: 8 } } })
      await flushPromises()
      expect(scrollIntoView).toHaveBeenCalledTimes(2)
      inline.unmount()

      scrollIntoView.mockClear()
      const floating = mountPanel({ presentation: 'floating' })
      await flushPromises()
      expect(scrollIntoView).not.toHaveBeenCalled()
      floating.unmount()
    } finally {
      HTMLElement.prototype.scrollIntoView = original
    }
  })
})

it('shows a selected vehicle mark and clears it on an unknown selection', async () => {
  const wrapper = mountPanel({ gunMarks: 3 })
  expect(wrapper.get('[data-test="pb-sb-tank"] [data-gun-marks]').attributes('data-gun-marks')).toBe('3')
  expect(wrapper.get('[data-test="pb-sb-gun-marks"] [data-gun-marks]').attributes('data-gun-marks')).toBe('3')
  await wrapper.setProps({ gunMarks: null })
  expect(wrapper.get('[data-test="pb-sb-gun-marks"]').text()).toBe('—')
  expect(wrapper.find('[data-test="pb-sb-tank"] [data-gun-marks]').exists()).toBe(false)
  wrapper.unmount()
})
