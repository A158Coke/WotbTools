// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PlaybackSidePanel from './PlaybackSidePanel.vue'

const groups = [
  { name: 'battle', label: 'Battle' },
  { name: 'vehicle', label: 'Vehicle' },
  { name: 'display', label: 'Display' },
  { name: 'events', label: 'Events' },
]

function mountPanel() {
  return mount(PlaybackSidePanel, {
    props: { groups },
    slots: { display: '<p data-test="display-slot">Display settings</p>' },
    global: { mocks: { $t: key => key } },
  })
}

describe('PlaybackSidePanel', () => {
  it('starts collapsed and opens one named panel at a time', async () => {
    const wrapper = mountPanel()

    expect(wrapper.find('[data-test="pb-panel-content-display"]').exists()).toBe(false)
    await wrapper.find('[data-test="pb-panel-display"]').trigger('click')
    await wrapper.setProps({ panel: 'display' })
    expect(wrapper.find('[data-test="pb-panel-content-display"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="display-slot"]').exists()).toBe(true)
    expect(wrapper.emitted('update:panel')).toEqual([['display']])
  })

  it('closes through the close button and Escape', async () => {
    const wrapper = mount(PlaybackSidePanel, {
      props: { groups, panel: 'events' },
      global: { mocks: { $t: key => key } },
    })

    await wrapper.find('[data-test="pb-panel-close"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('update:panel')).toEqual([[null]])

    await wrapper.setProps({ panel: 'events' })
    await wrapper.find('[data-test="pb-side-panel-shell"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(2)
  })
})
