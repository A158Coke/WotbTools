// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PlaybackMobileOverlay from './PlaybackMobileOverlay.vue'

describe('PlaybackMobileOverlay', () => {
  it('stays visible after reveal until explicitly hidden', async () => {
    const wrapper = mount(PlaybackMobileOverlay, { slots: { default: '<button>Controls</button>' } })

    expect(wrapper.classes()).not.toContain('pb-mobile-overlay-visible')
    wrapper.vm.reveal()
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).toContain('pb-mobile-overlay-visible')
    wrapper.vm.hide()
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).not.toContain('pb-mobile-overlay-visible')
  })
})
