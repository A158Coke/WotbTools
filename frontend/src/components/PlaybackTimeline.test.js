// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PlaybackTimeline from './PlaybackTimeline.vue'

const formatClock = vi.fn(sec => `00:${String(sec).padStart(2, '0')}`)

describe('PlaybackTimeline', () => {
  it('renders event markers at their timeline positions', () => {
    const wrapper = mount(PlaybackTimeline, {
      props: { currentTime: 5, duration: 20, eventMarkers: [{ sec: 10, count: 2 }], formatClock },
      global: { mocks: { $t: key => key } },
    })

    const marker = wrapper.find('.pb-marker')
    expect(marker.attributes('style')).toContain('left: 50%')
    expect(marker.attributes('title')).toBe('00:10 ×2')
    expect(formatClock).toHaveBeenCalledWith(10)
  })

  it('emits drag, seek, and jump events from native timeline interactions', async () => {
    const wrapper = mount(PlaybackTimeline, {
      props: { currentTime: 5, duration: 20, eventMarkers: [{ sec: 10, count: 1 }], formatClock },
      global: { mocks: { $t: key => key } },
    })
    const range = wrapper.find('input[type="range"]')

    await range.trigger('pointerdown')
    await range.setValue('12.5')
    await wrapper.find('.pb-marker').trigger('click')

    expect(wrapper.emitted('drag-start')).toHaveLength(1)
    expect(wrapper.emitted('seek')).toEqual([[12.5]])
    expect(wrapper.emitted('jump')).toEqual([[10]])
  })
})
