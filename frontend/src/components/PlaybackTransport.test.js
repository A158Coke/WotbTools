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

  /**
   * 紧凑档（手机竖屏）：速度档位改成渐进披露——五个档位常驻会独占一整行，
   * 把 2D 地图 / 3D 战场挤掉。这只改呈现，不改语义：同一个 speed prop、同一条 set-speed 事件。
   */
  describe('紧凑档速度选择器（手机）', () => {
    it('不再永久渲染五个档位按钮，只常驻当前值', () => {
      const wrapper = mountTransport({ currentTime: 0, duration: 60, speed: 2, compact: true })
      expect(wrapper.find('[data-test="pb-speed-menu"]').exists()).toBe(false)
      expect(wrapper.get('[data-test="pb-speed-current"]').text()).toBe('2×')
      // 档位按钮在菜单打开前不存在（不是「渲染了但被藏起来」）
      expect(wrapper.findAll('[data-test^="pb-speed-"]')).toHaveLength(1)   // 只有 current 自己
    })

    it('点开当前值 → 列出既有全部档位；选中后收起并发出 set-speed', async () => {
      const wrapper = mountTransport({ currentTime: 0, duration: 60, speed: 1, compact: true })
      await wrapper.get('[data-test="pb-speed-current"]').trigger('click')
      expect(wrapper.get('[data-test="pb-speed-current"]').attributes('aria-expanded')).toBe('true')
      const menu = wrapper.get('[data-test="pb-speed-menu"]')
      expect(menu.findAll('.pb-speed-item').map((b) => b.text()))
        .toEqual(['0.5×', '1×', '2×', '4×', '8×'])
      await menu.get('[data-test="pb-speed-4"]').trigger('click')
      expect(wrapper.emitted('set-speed')).toEqual([[4]])
      expect(wrapper.find('[data-test="pb-speed-menu"]').exists()).toBe(false)  // 选完即收起
      expect(wrapper.get('[data-test="pb-speed-current"]').attributes('aria-expanded')).toBe('false')
    })

    it('当前档位在菜单里被标记为选中（aria-checked），语义不变', async () => {
      const wrapper = mountTransport({ currentTime: 0, duration: 60, speed: 4, compact: true })
      await wrapper.get('[data-test="pb-speed-current"]').trigger('click')
      const menu = wrapper.get('[data-test="pb-speed-menu"]')
      expect(menu.get('[data-test="pb-speed-4"]').attributes('aria-checked')).toBe('true')
      expect(menu.get('[data-test="pb-speed-2"]').attributes('aria-checked')).toBe('false')
    })

    it('宽档（桌面）保持原样：五个档位常驻一行，没有紧凑选择器', () => {
      const wrapper = mountTransport({ currentTime: 0, duration: 60, speed: 1 })
      expect(wrapper.find('[data-test="pb-speed-current"]').exists()).toBe(false)
      expect(wrapper.findAll('[data-test^="pb-speed-"]').map((b) => b.text()))
        .toEqual(['0.5×', '1×', '2×', '4×', '8×'])
    })
  })
})
