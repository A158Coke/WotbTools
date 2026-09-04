// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PlaybackMobileOverlay from './PlaybackMobileOverlay.vue'

describe('PlaybackMobileOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    })
  })

  it('keeps the explicit reveal/hide API outside fullscreen', async () => {
    const wrapper = mount(PlaybackMobileOverlay, { slots: { default: '<button>Controls</button>' } })

    expect(wrapper.classes()).not.toContain('pb-mobile-overlay-visible')
    wrapper.vm.reveal()
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).toContain('pb-mobile-overlay-visible')
    wrapper.vm.hide()
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).not.toContain('pb-mobile-overlay-visible')
  })

  it('auto-hides mobile fullscreen controls without taking map pointer events', async () => {
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.body,
    })
    const wrapper = mount(PlaybackMobileOverlay, { slots: { default: '<button>Controls</button>' } })
    await wrapper.vm.$nextTick()

    expect(wrapper.classes()).toContain('pb-mobile-overlay-transient')
    expect(wrapper.classes()).toContain('pb-mobile-overlay-visible')
    // The viewport-sized wrapper must never become the pointer target; only visible controls do.
    expect(wrapper.attributes('style')).toContain('pointer-events: none')
    expect(wrapper.find('.pb-mobile-overlay-content').attributes('style')).toContain('pointer-events: auto')

    vi.advanceTimersByTime(2500)
    await wrapper.vm.$nextTick()

    expect(wrapper.classes()).not.toContain('pb-mobile-overlay-visible')
    expect(wrapper.find('.pb-mobile-overlay-content').attributes('style')).toContain('display: none')
  })

  it('reveals transient controls on a normal fullscreen tap and hides them again', async () => {
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.body,
    })
    const wrapper = mount(PlaybackMobileOverlay, { slots: { default: '<button>Controls</button>' } })
    vi.advanceTimersByTime(2500)
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).not.toContain('pb-mobile-overlay-visible')

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).toContain('pb-mobile-overlay-visible')

    vi.advanceTimersByTime(2500)
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).not.toContain('pb-mobile-overlay-visible')
  })
})
