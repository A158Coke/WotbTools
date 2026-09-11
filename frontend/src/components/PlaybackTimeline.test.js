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

  // duration<=0 时拖动进度条是 silent no-op：必须显式禁用，而不是留一个看起来能拖的控件。
  it('disables the range input when the timeline is unavailable', () => {
    const wrapper = mount(PlaybackTimeline, {
      props: { currentTime: 0, duration: 0, disabled: true },
      global: { mocks: { $t: key => key } },
    })
    expect(wrapper.find('input[type="range"]').attributes('disabled')).toBeDefined()
  })

  // §overflow：UA 的 input[type=range] 自带 2px margin，与 width:100% 相加会造成页面级横向
  // 溢出（真浏览器上实测 1024 视口 scrollWidth=1026，越界元素就是这个 input）。样式建在
  // SFC scoped 块里，因此按源码断言（与 src/styles/*.test.js 同一套做法）。
  it('keeps the range input free of the UA margin so it cannot overflow its container', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/PlaybackTimeline.vue'), 'utf8')
    const rule = source.match(/\.pb-range\s*\{([^}]*)\}/)
    expect(rule).not.toBeNull()
    expect(rule[1]).toMatch(/margin:\s*0(\s|;|$)/)
    expect(rule[1]).toContain('width: 100%')
  })
})
