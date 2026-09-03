// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PlaybackTimeline from './PlaybackTimeline.vue'

const formatClock = vi.fn(sec => `00:${String(sec).padStart(2, '0')}`)

describe('PlaybackTimeline', () => {
  it('renders a clean progress track without event marker decorations', () => {
    const wrapper = mount(PlaybackTimeline, {
      props: { currentTime: 5, duration: 20 },
      global: { mocks: { $t: key => key } },
    })

    expect(wrapper.find('.pb-marker').exists()).toBe(false)
    expect(formatClock).not.toHaveBeenCalled()
  })

  it('emits drag and seek events from native timeline interactions', async () => {
    const wrapper = mount(PlaybackTimeline, {
      props: { currentTime: 5, duration: 20 },
      global: { mocks: { $t: key => key } },
    })
    const range = wrapper.find('input[type="range"]')

    await range.trigger('pointerdown')
    await range.setValue('12.5')

    expect(wrapper.emitted('drag-start')).toHaveLength(1)
    expect(wrapper.emitted('seek')).toEqual([[12.5]])
  })
})
