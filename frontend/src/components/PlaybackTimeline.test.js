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
  // 溢出（真浏览器上实测 1024 视口 scrollWidth=1026，越界元素正是这个 input）。样式建在
  // SFC scoped 块里，因此按源码断言（与 src/styles/*.test.js 同一套做法）。
  it('keeps the range input free of the UA margin so it cannot overflow its container', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/PlaybackTimeline.vue'), 'utf8')
    const rule = source.match(/\.pb-range\s*\{([^}]*)\}/)
    expect(rule).not.toBeNull()
    expect(rule[1]).toMatch(/margin:\s*0(\s|;|$)/)
    expect(rule[1]).toContain('width: 100%')
  })

  // 事件刻度层（blitzinfo 式）：无刻度数据时整层不渲染（2D 未接线保持原样，上面的
  // 「clean progress track」用例锁的就是缺省形态）；有数据时炮击线 + 击毁点、点击 seek。
  it('renders shot and kill ticks only when tick data is provided', () => {
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

  // 命中条 = 单一底部元素（不逐刻度布命中区，密集炮击也不挡滑块拖动）：
  // 点击 → 5px 半径内就近吸附刻度；无近邻 → 与原生轨道点击同语义的按比例 seek。
  it('clicking the tick strip snaps to the nearest event, else seeks proportionally', async () => {
    const wrapper = mount(PlaybackTimeline, {
      props: {
        currentTime: 5,
        duration: 20,
        shotTicks: [{ t: 12, pct: 60, highlight: false }],
        killTicks: [{ t: 8, pct: 40 }],
      },
      global: { mocks: { $t: key => key } },
    })
    const strip = wrapper.find('.pb-tick-hit')
    strip.element.getBoundingClientRect = () => ({ left: 0, width: 200, height: 40, top: 0, right: 200, bottom: 40, x: 0, y: 0, toJSON: () => {} })
    // 炮击刻度在 60%（120px）→ 吸附到 t=12
    await strip.trigger('click', { clientX: 120 })
    expect(wrapper.emitted('seek')).toEqual([[12]])
    // 击毁点在 40%（80px）→ 吸附到 t=8
    await strip.trigger('click', { clientX: 80 })
    expect(wrapper.emitted('seek')).toEqual([[12], [8]])
    // 无近邻刻度（95% 处 10px 外无刻度）→ 按比例：0 + 0.95 × 20 = 19
    await strip.trigger('click', { clientX: 190 })
    expect(wrapper.emitted('seek')).toEqual([[12], [8], [19]])

    // duration <= start：滑块本身禁用，刻度层一并隐藏（刻度挤在 0% 纯属误导）
    const degenerate = mount(PlaybackTimeline, {
      props: { currentTime: 7, duration: 7, disabled: true, shotTicks: [{ t: 7, pct: 0, highlight: false }] },
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
