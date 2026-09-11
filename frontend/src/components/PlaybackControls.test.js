// @vitest-environment happy-dom

import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PlaybackControls from './PlaybackControls.vue'

const timelineStub = defineComponent({
  props: ['currentTime', 'duration', 'disabled'],
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

  it('leaves the usable timeline enabled without an unavailable notice', () => {
    const wrapper = mountControls()

    expect(wrapper.find('[data-test="pb-play"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-test="pb-play"]').attributes('aria-disabled')).toBe('false')
    expect(wrapper.find('[data-test="pb-back5"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-test="pb-fwd5"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.findComponent(timelineStub).props('disabled')).toBe(false)
    expect(wrapper.find('[data-test="pb-play-unavailable"]').exists()).toBe(false)
  })

  // duration<=0 表示后端没有可播放的时间线：play / ±5 / 进度条本来都是 silent no-op。
  // 契约是「显式 disabled + 明确原因」，绝不留一个看起来可用但什么都不发生的控件。
  it('disables the timeline-dependent controls and states why when duration<=0', async () => {
    const wrapper = mountControls({ duration: 0 })

    expect(wrapper.find('[data-test="pb-play"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="pb-play"]').attributes('aria-disabled')).toBe('true')
    expect(wrapper.find('[data-test="pb-play"]').attributes('title')).toBe('recon.map.playback.timeline_unavailable')
    expect(wrapper.find('[data-test="pb-back5"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="pb-fwd5"]').attributes('disabled')).toBeDefined()
    expect(wrapper.findComponent(timelineStub).props('disabled')).toBe(true)
    expect(wrapper.find('[data-test="pb-play-unavailable"]').text()).toBe('recon.map.playback.timeline_unavailable')

    // 不依赖时间线的操作必须保持可用（不能顺手整体禁用）。
    await wrapper.find('[data-test="pb-speed-2"]').trigger('click')
    await wrapper.find('[data-test="pb-panels"]').trigger('click')
    expect(wrapper.emitted('set-speed')).toEqual([[2]])
    expect(wrapper.emitted('toggle-panels')).toHaveLength(1)
  })
})
