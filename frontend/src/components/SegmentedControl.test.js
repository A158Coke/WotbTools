// @vitest-environment happy-dom
/**
 * canonical SegmentedControl 的契约。
 *
 * 它是 6 个消费方共用的 canonical primitive（回放能力切换、数据视图、播放相机、更多面板、
 * 更多页、数据工具栏），所以键盘模型与滚动行为在这里锁死：
 * ARIA 单选组 + 方向键循环 + Home / End 跳首尾；选项多时横向滚动且不换行。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SegmentedControl from './SegmentedControl.vue'

const OPTIONS = [
  { value: 'data', label: '数据', testid: 'ws-tab', data: { 'data-cap': 'data' } },
  { value: 'playback', label: '2D 回放', testid: 'ws-tab', data: { 'data-cap': 'playback' } },
  { value: '3d', label: '3D 回放', testid: 'ws-tab', data: { 'data-cap': '3d' } },
  { value: 'shots', label: '射击分析', testid: 'ws-tab', data: { 'data-cap': 'shots' } },
  { value: 'ai', label: 'AI 复盘', testid: 'ws-tab', data: { 'data-cap': 'ai' } },
]

function mountControl(props = {}) {
  return mount(SegmentedControl, {
    props: { modelValue: 'data', options: OPTIONS, ariaLabel: 'capability', ...props },
  })
}

const option = (wrapper, value) => wrapper.get(`[data-value="${value}"]`)

describe('SegmentedControl', () => {
  it('ARIA 单选组语义：只有选中项 aria-checked=true 且进 Tab 顺序', () => {
    const wrapper = mountControl()
    expect(wrapper.get('[role="radiogroup"]').attributes('aria-label')).toBe('capability')
    expect(option(wrapper, 'data').attributes('role')).toBe('radio')
    expect(option(wrapper, 'data').attributes('aria-checked')).toBe('true')
    expect(option(wrapper, 'data').attributes('tabindex')).toBe('0')
    expect(option(wrapper, 'ai').attributes('aria-checked')).toBe('false')
    expect(option(wrapper, 'ai').attributes('tabindex')).toBe('-1')
  })

  it('点击选中项 emit update:modelValue（点当前项不重复 emit）', async () => {
    const wrapper = mountControl()
    await option(wrapper, 'shots').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['shots'])
    await option(wrapper, 'data').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
  })

  it('方向键循环移动并选中', async () => {
    const wrapper = mountControl({ modelValue: 'ai' })
    const group = wrapper.get('[role="radiogroup"]')
    await group.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['data'])
    await group.trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['shots'])
  })

  it('Home / End 跳首尾', async () => {
    const wrapper = mountControl({ modelValue: '3d' })
    const group = wrapper.get('[role="radiogroup"]')
    await group.trigger('keydown', { key: 'Home' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['data'])
    await group.trigger('keydown', { key: 'End' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['ai'])
  })

  it('未处理的按键不拦截也不 emit', async () => {
    const wrapper = mountControl()
    await wrapper.get('[role="radiogroup"]').trigger('keydown', { key: 'Tab' })
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('选项透传 testid 与附加 data-*（工作台契约：ws-tab + data-cap）', () => {
    const wrapper = mountControl()
    expect(wrapper.findAll('[data-testid="ws-tab"]')).toHaveLength(5)
    expect(option(wrapper, 'shots').attributes('data-cap')).toBe('shots')
  })

  it('scrollable：容器占满宽度、横向滚动、选项不换行', () => {
    const plain = mountControl()
    expect(plain.get('.segmented').classes()).not.toContain('is-scrollable')

    const scrollable = mountControl({ scrollable: true })
    expect(scrollable.get('.segmented').classes()).toContain('is-scrollable')
  })
})
