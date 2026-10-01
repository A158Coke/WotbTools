// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PlaybackTransport from './PlaybackTransport.vue'

const mountTransport = (props) => mount(PlaybackTransport, { props, global: { mocks: { $t: (k) => k } } })

describe('PlaybackTransport', () => {
  it('时钟从 00:00 起算：绝对时间轴起点 t_start 不计入', () => {
    const wrapper = mountTransport({ currentTime: 75, startTime: 15, duration: 195 })
    expect(wrapper.get('[data-test="pb-time"]').text()).toBe('01:00 / 03:00')
  })

  it('默认渲染统一档位与 ±5s', () => {
    const wrapper = mountTransport({ currentTime: 0, duration: 60 })
    expect(wrapper.findAll('[data-test^="pb-speed-"]').map((b) => b.text())).toEqual(['0.5×', '1×', '2×', '4×', '8×'])
    expect(wrapper.get('[data-test="pb-back5"]').text()).toBe('−5')
    expect(wrapper.get('[data-test="pb-fwd5"]').text()).toBe('+5')
  })

  it('时间轴不可用时禁用播放、跳秒与进度条，速度档位仍可用', () => {
    const wrapper = mountTransport({ currentTime: 0, startTime: 10, duration: 10 })
    expect(wrapper.get('[data-test="pb-play"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-test="pb-fwd5"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('input[type="range"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-test="pb-speed-2"]').attributes('disabled')).toBeUndefined()
  })

  it('拖动进度条：发出 scrub-start / seek / scrub-end，拖动期间不被外部时间拽回', async () => {
    const wrapper = mountTransport({ currentTime: 5, duration: 60 })
    const range = wrapper.get('input[type="range"]')
    await range.trigger('pointerdown')
    await range.setValue('30')
    await wrapper.setProps({ currentTime: 6 })
    expect(range.element.value).toBe('30')
    window.dispatchEvent(new Event('pointerup'))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('scrub-start')).toHaveLength(1)
    expect(wrapper.emitted('seek')).toEqual([[30]])
    expect(wrapper.emitted('scrub-end')).toHaveLength(1)
  })
})
