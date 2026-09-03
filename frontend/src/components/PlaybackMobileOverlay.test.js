// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PlaybackMobileOverlay from './PlaybackMobileOverlay.vue'

describe('PlaybackMobileOverlay', () => {
  it('is hidden until revealed and fades after three seconds', async () => {
    vi.useFakeTimers()
    const wrapper = mount(PlaybackMobileOverlay, { slots: { default: '<button>Controls</button>' } })

    expect(wrapper.classes()).not.toContain('pb-mobile-overlay-visible')
    wrapper.vm.reveal()
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).toContain('pb-mobile-overlay-visible')
    vi.advanceTimersByTime(3000)
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).not.toContain('pb-mobile-overlay-visible')
    vi.useRealTimers()
  })
})
