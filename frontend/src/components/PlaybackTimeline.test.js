// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

  it('disables the range input when the timeline is unavailable', () => {
    const wrapper = mount(PlaybackTimeline, {
      props: { currentTime: 0, duration: 0, disabled: true },
      global: { mocks: { $t: key => key } },
    })
    expect(wrapper.find('input[type="range"]').attributes('disabled')).toBeDefined()
  })

  it('keeps the range input free of the UA margin so it cannot overflow its container', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/PlaybackTimeline.vue'), 'utf8')
    const rule = source.match(/\.pb-range\s*\{([^}]*)\}/)
    expect(rule).not.toBeNull()
    expect(rule[1]).toMatch(/margin:\s*0(\s|;|$)/)
    expect(rule[1]).toContain('width: 100%')
  })

  it('renders shot and kill ticks only when tick data is provided and event markers are enabled', () => {
    const bare = mount(PlaybackTimeline, {
      props: { currentTime: 5, duration: 20 },
      global: { mocks: { $t: key => key } },
    })
    expect(bare.find('.pb-tick-layer').exists()).toBe(false)

    const wrapper = mount(PlaybackTimeline, {
      props: {
        currentTime: 5,
        startTime: 0,
        duration: 20,
        showEventMarkers: true,
        shotTicks: [
          { t: 4, pct: 20, highlight: false },
          { t: 12, pct: 60, highlight: true },
        ],
        killTicks: [{ t: 10, pct: 50 }],
      },
      global: { mocks: { $t: key => key } },
    })
    const layer = wrapper.find('[data-test="pb-ticks"]')
    expect(layer.exists()).toBe(true)
    expect(layer.attributes('aria-hidden')).toBe('true')
    const shotTicks = wrapper.findAll('.pb-tick-shot')
    expect(shotTicks).toHaveLength(2)
    expect(shotTicks[1].classes()).toContain('pb-tick-shot-highlight')
    expect(shotTicks[0].attributes('style')).toContain('left: 20%')
    expect(wrapper.findAll('.pb-tick-kill')).toHaveLength(1)
  })

  it('hides tick decorations while keeping native seek usable when event markers are off', async () => {
    const wrapper = mount(PlaybackTimeline, {
      props: {
        currentTime: 5,
        duration: 20,
        showEventMarkers: false,
        shotTicks: [{ t: 4, pct: 20, highlight: false }],
        killTicks: [{ t: 10, pct: 50 }],
      },
      global: { mocks: { $t: key => key } },
    })
    expect(wrapper.find('[data-test="pb-ticks"]').exists()).toBe(false)
    const range = wrapper.find('input[type="range"]')
    expect(range.attributes('disabled')).toBeUndefined()
    await range.setValue('9.5')
    expect(wrapper.emitted('seek')).toEqual([[9.5]])

    await wrapper.setProps({ showEventMarkers: true })
    expect(wrapper.find('[data-test="pb-ticks"]').exists()).toBe(true)
  })

  it('clicking the tick strip snaps to the nearest event, else seeks proportionally', async () => {
    const wrapper = mount(PlaybackTimeline, {
      props: {
        currentTime: 5,
        duration: 20,
        showEventMarkers: true,
        shotTicks: [{ t: 12, pct: 60, highlight: false }],
        killTicks: [{ t: 8, pct: 40 }],
      },
      global: { mocks: { $t: key => key } },
    })
    const strip = wrapper.find('.pb-tick-hit')
    strip.element.getBoundingClientRect = () => ({ left: 0, width: 200, height: 40, top: 0, right: 200, bottom: 40, x: 0, y: 0, toJSON: () => {} })
    await strip.trigger('click', { clientX: 120 })
    expect(wrapper.emitted('seek')).toEqual([[12]])
    await strip.trigger('click', { clientX: 80 })
    expect(wrapper.emitted('seek')).toEqual([[12], [8]])
    await strip.trigger('click', { clientX: 190 })
    expect(wrapper.emitted('seek')).toEqual([[12], [8], [19]])

    const degenerate = mount(PlaybackTimeline, {
      props: { currentTime: 7, duration: 7, disabled: true, showEventMarkers: true, shotTicks: [{ t: 7, pct: 0, highlight: false }] },
      global: { mocks: { $t: key => key } },
    })
    expect(degenerate.find('[data-test="pb-ticks"]').exists()).toBe(false)
  })

  it('shows the host-provided shortcuts hint as a tooltip', () => {
    const withHint = mount(PlaybackTimeline, {
      props: { currentTime: 5, duration: 20, hint: '快捷键：空格 暂停' },
      global: { mocks: { $t: key => key } },
    })
    expect(withHint.find('.pb-progress').attributes('title')).toBe('快捷键：空格 暂停')
    const withoutHint = mount(PlaybackTimeline, {
      props: { currentTime: 5, duration: 20 },
      global: { mocks: { $t: key => key } },
    })
    expect(withoutHint.find('.pb-progress').attributes('title')).toBeUndefined()
  })
})
