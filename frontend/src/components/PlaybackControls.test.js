// @vitest-environment happy-dom

import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PlaybackControls from './PlaybackControls.vue'

const timelineStub = defineComponent({
  emits: ['drag-start', 'seek'],
  setup(_, { emit }) {
    return () => h('div', { 'data-test': 'timeline-stub' }, [
      h('button', { 'data-test': 'timeline-seek', onClick: () => emit('seek', 17) }),
      h('button', { 'data-test': 'timeline-drag', onClick: () => emit('drag-start') }),
    ])
  },
})

const props = () => ({
  playing: false,
  speed: 1,
  currentTime: 12,
  duration: 60,
  fullscreenSupported: true,
  isFullscreen: false,
  formatClock: sec => `00:${sec}`,
})

function mountControls(overrides = {}) {
  return mount(PlaybackControls, {
    props: { ...props(), ...overrides },
    global: { stubs: { PlaybackTimeline: timelineStub }, mocks: { $t: key => key } },
  })
}

describe('PlaybackControls', () => {
  it('emits playback controls, stepping, speed, and fullscreen actions', async () => {
    const wrapper = mountControls()

    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await wrapper.find('[data-test="pb-back5"]').trigger('click')
    await wrapper.find('[data-test="pb-fwd5"]').trigger('click')
    await wrapper.find('[data-test="pb-speed-2"]').trigger('click')
    await wrapper.find('[data-test="pb-fullscreen"]').trigger('click')

    expect(wrapper.emitted('toggle-play')).toHaveLength(1)
    expect(wrapper.emitted('step')).toEqual([[-5], [5]])
    expect(wrapper.emitted('set-speed')).toEqual([[2]])
    expect(wrapper.emitted('toggle-fullscreen')).toHaveLength(1)
  })

  it('keeps panels and annotations as compact secondary actions and forwards timeline events', async () => {
    const wrapper = mountControls()

    await wrapper.find('[data-test="pb-panels"]').trigger('click')
    await wrapper.find('[data-test="pb-annotation"]').trigger('click')
    await wrapper.find('[data-test="timeline-drag"]').trigger('click')
    await wrapper.find('[data-test="timeline-seek"]').trigger('click')

    expect(wrapper.emitted('toggle-panels')).toHaveLength(1)
    expect(wrapper.emitted('toggle-annotation')).toHaveLength(1)
    expect(wrapper.emitted('drag-start')).toHaveLength(1)
    expect(wrapper.emitted('seek')).toEqual([[17]])
    expect(wrapper.find('.pb-filters').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-prev"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-next"]').exists()).toBe(false)
  })
})
