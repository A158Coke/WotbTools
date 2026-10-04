// @vitest-environment happy-dom

import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PLAYBACK_PHONE_QUERY } from '../composables/usePlaybackPhoneForm.js'
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

afterEach(() => vi.unstubAllGlobals())

describe('PlaybackControls', () => {
  it('keeps compact speed and semantic phone CSS after 390×844 rotates to 844×390', async () => {
    let width = 390
    let height = 844
    const listeners = new Set()
    const query = {
      get matches() { return width < 768 || height <= 500 },
      addEventListener(_event, listener) { listeners.add(listener) },
      removeEventListener(_event, listener) { listeners.delete(listener) },
    }
    const media = vi.fn((requested) => requested === PLAYBACK_PHONE_QUERY ? query : { matches: false })
    vi.stubGlobal('matchMedia', media)
    const wrapper = mountControls()
    expect(media).toHaveBeenCalledWith(PLAYBACK_PHONE_QUERY)
    expect(wrapper.get('[data-test="pb-controls"]').classes()).toContain('phone-form')
    expect(wrapper.find('[data-test="pb-speed-current"]').exists()).toBe(true)
    expect(wrapper.find('.pb-speed').exists()).toBe(false)

    width = 844
    height = 390
    listeners.forEach(listener => listener())
    await nextTick()
    expect(wrapper.get('[data-test="pb-controls"]').classes()).toContain('phone-form')
    expect(wrapper.find('[data-test="pb-speed-current"]').exists()).toBe(true)
    expect(wrapper.find('.pb-speed').exists()).toBe(false)
    await wrapper.get('[data-test="pb-speed-current"]').trigger('click')
    await wrapper.get('[data-test="pb-speed-2"]').trigger('click')
    expect(wrapper.emitted('set-speed')).toEqual([[2]])
    wrapper.unmount()
    expect(listeners.size).toBe(0)
  })

  it.each([[1024, 768], [1600, 900]])('keeps tablet/desktop %i×%i transport expanded', (width, height) => {
    vi.stubGlobal('matchMedia', () => ({
      matches: width < 768 || height <= 500,
      addEventListener() {}, removeEventListener() {},
    }))
    const wrapper = mountControls()
    expect(wrapper.get('[data-test="pb-controls"]').classes()).not.toContain('phone-form')
    expect(wrapper.find('.pb-speed').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-speed-current"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('emits playback controls, stepping, speed, and fullscreen actions', async () => {
    const wrapper = mountControls()

    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await wrapper.find('[data-test="pb-back5"]').trigger('click')
    await wrapper.find('[data-test="pb-fwd5"]').trigger('click')
    await wrapper.find('[data-test="pb-speed-current"]').trigger('click')
    await wrapper.find('[data-test="pb-speed-2"]').trigger('click')
    await wrapper.find('[data-test="pb-fullscreen"]').trigger('click')

    expect(wrapper.emitted('toggle-play')).toHaveLength(1)
    expect(wrapper.emitted('step')).toEqual([[-5], [5]])
    expect(wrapper.emitted('set-speed')).toEqual([[2]])
    expect(wrapper.emitted('toggle-fullscreen')).toHaveLength(1)
  })

  it('keeps panels and annotations as compact secondary actions and forwards timeline events', async () => {
    const wrapper = mountControls()

    await wrapper.find('[data-test="pb-secondary-entry"]').trigger('click')
    await wrapper.find('[data-test="timeline-drag"]').trigger('click')
    await wrapper.find('[data-test="timeline-seek"]').trigger('click')

    expect(wrapper.emitted('toggle-panels')).toHaveLength(1)
    expect(wrapper.emitted('drag-start')).toHaveLength(1)
    expect(wrapper.emitted('seek')).toEqual([[17]])
    // 控件条只有 primary 六项：既没有速度筛选，也没有上一段 / 下一段
    expect(wrapper.findAll('.pb-controls > button, .pb-controls > .pb-speed-picker > button')).toHaveLength(6)
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
    await wrapper.find('[data-test="pb-speed-current"]').trigger('click')
    await wrapper.find('[data-test="pb-speed-2"]').trigger('click')
    await wrapper.find('[data-test="pb-secondary-entry"]').trigger('click')
    expect(wrapper.emitted('set-speed')).toEqual([[2]])
    expect(wrapper.emitted('toggle-panels')).toHaveLength(1)
  })
})
