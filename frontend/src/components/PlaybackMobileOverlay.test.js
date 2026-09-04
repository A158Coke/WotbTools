// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PlaybackMobileOverlay from './PlaybackMobileOverlay.vue'

describe('PlaybackMobileOverlay', () => {
  let mql
  let mqlChange

  beforeEach(() => {
    vi.useFakeTimers()
    mqlChange = null
    mql = {
      matches: true,
      addEventListener: vi.fn((type, handler) => {
        if (type === 'change') mqlChange = handler
      }),
      removeEventListener: vi.fn(),
    }
    vi.stubGlobal('matchMedia', vi.fn(() => mql))
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
    expect(wrapper.classes()).not.toContain('pb-mobile-overlay-transient')
    wrapper.vm.hide()
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).not.toContain('pb-mobile-overlay-visible')
  })

  it('keeps mobile fullscreen controls hidden until requested and never takes map pointer events', async () => {
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.body,
    })
    const wrapper = mount(PlaybackMobileOverlay, { slots: { default: '<button>Controls</button>' } })
    await wrapper.vm.$nextTick()

    expect(wrapper.classes()).toContain('pb-mobile-overlay-transient')
    expect(wrapper.classes()).not.toContain('pb-mobile-overlay-visible')

    wrapper.vm.reveal()
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).toContain('pb-mobile-overlay-transient')
    expect(wrapper.classes()).toContain('pb-mobile-overlay-visible')
    // Pointer ownership is class-driven: the fullscreen wrapper never becomes the map gesture target.
    expect(wrapper.attributes('style')).toBeUndefined()
    expect(wrapper.find('.pb-mobile-overlay-content').attributes('style')).toBeUndefined()

    vi.advanceTimersByTime(2500)
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).not.toContain('pb-mobile-overlay-visible')
  })

  it('reveals transient controls on a normal fullscreen tap and hides them again', async () => {
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.body,
    })
    const wrapper = mount(PlaybackMobileOverlay, { slots: { default: '<button>Controls</button>' } })
    expect(wrapper.classes()).not.toContain('pb-mobile-overlay-visible')

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).toContain('pb-mobile-overlay-visible')
    expect(wrapper.classes()).toContain('pb-mobile-overlay-transient')

    vi.advanceTimersByTime(2500)
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).not.toContain('pb-mobile-overlay-visible')
  })

  it('tracks mobile breakpoint changes during fullscreen and clears stale overlay state', async () => {
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.body,
    })
    const wrapper = mount(PlaybackMobileOverlay, { slots: { default: '<button>Controls</button>' } })
    wrapper.vm.reveal()
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).toContain('pb-mobile-overlay-transient')
    expect(wrapper.classes()).toContain('pb-mobile-overlay-visible')

    mql.matches = false
    mqlChange?.({ matches: false })
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).not.toContain('pb-mobile-overlay-transient')
    expect(wrapper.classes()).not.toContain('pb-mobile-overlay-visible')

    mql.matches = true
    mqlChange?.({ matches: true })
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).toContain('pb-mobile-overlay-transient')
    expect(wrapper.classes()).not.toContain('pb-mobile-overlay-visible')
  })

  it('cleans the responsive MQL listener on unmount', () => {
    const wrapper = mount(PlaybackMobileOverlay, { slots: { default: '<button>Controls</button>' } })
    expect(mql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    const handler = mqlChange
    wrapper.unmount()
    expect(mql.removeEventListener).toHaveBeenCalledWith('change', handler)
  })
})
