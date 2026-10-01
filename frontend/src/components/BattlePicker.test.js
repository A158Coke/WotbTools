// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import BattlePicker from './BattlePicker.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: key => key, locale: { value: 'en' } }) }))

function options(count) {
  return Array.from({ length: count }, (_, i) => ({
    value: `r${i}`,
    label: `Battle ${i + 1} · Map ${i}`,
    meta: i % 2 ? 'CHRD won' : 'TOP won',
    search: `file${i}.wotbreplay`,
  }))
}

let wrapper
function mountPicker(props) {
  wrapper = mount(BattlePicker, { props: { ariaLabel: 'Choose battle', ...props }, attachTo: document.body })
  return wrapper
}
afterEach(() => wrapper?.unmount())

async function open() {
  await wrapper.get('button[aria-haspopup="listbox"]').trigger('click')
  await flushPromises()
}

const optionValues = () => wrapper.findAll('[data-testid="battle-picker-option"]').map(o => o.attributes('data-value'))

describe('BattlePicker', () => {
  it('触发按钮显示当前场次；打开后标记选中项', async () => {
    mountPicker({ options: options(3), modelValue: 'r1' })
    const trigger = wrapper.get('button[aria-haspopup="listbox"]')
    expect(trigger.text()).toContain('Battle 2 · Map 1')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    await open()
    expect(trigger.attributes('aria-expanded')).toBe('true')
    const selected = wrapper.findAll('[role="option"][aria-selected="true"]')
    expect(selected.map(o => o.attributes('data-value'))).toEqual(['r1'])
  })

  it('不超过 6 场不显示搜索框，焦点进入列表；超过 6 场显示搜索框并获得焦点', async () => {
    mountPicker({ options: options(6), modelValue: 'r0' })
    await open()
    expect(wrapper.find('[data-testid="battle-picker-search"]').exists()).toBe(false)
    expect(document.activeElement?.getAttribute('role')).toBe('listbox')
    wrapper.unmount()

    mountPicker({ options: options(7), modelValue: 'r0' })
    await open()
    expect(document.activeElement).toBe(wrapper.get('[data-testid="battle-picker-search"]').element)
  })

  it('搜索按标签、meta 与文件名过滤；无结果时说明', async () => {
    mountPicker({ options: options(10), modelValue: 'r0' })
    await open()
    const search = wrapper.get('[data-testid="battle-picker-search"]')
    await search.setValue('file7')
    expect(optionValues()).toEqual(['r7'])
    await search.setValue('chrd')
    expect(optionValues()).toEqual(['r1', 'r3', 'r5', 'r7', 'r9'])
    await search.setValue('nothing')
    expect(optionValues()).toEqual([])
    expect(wrapper.text()).toContain('workspace.battle_search_empty')
  })

  it('键盘：方向键移动高亮，Enter 选中并关闭、焦点回到触发按钮', async () => {
    mountPicker({ options: options(8), modelValue: 'r2' })
    await open()
    const search = wrapper.get('[data-testid="battle-picker-search"]')
    // 打开时高亮当前项
    expect(search.attributes('aria-activedescendant')).toMatch(/-2$/)
    await search.trigger('keydown', { key: 'ArrowDown' })
    await search.trigger('keydown', { key: 'ArrowDown' })
    await search.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['r4']])
    expect(wrapper.find('[data-testid="battle-picker-panel"]').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('button[aria-haspopup="listbox"]').element)
  })

  it('Esc 关闭不改变选择；点击当前项不重复发出事件', async () => {
    mountPicker({ options: options(3), modelValue: 'r0' })
    await open()
    await wrapper.get('[role="listbox"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[data-testid="battle-picker-panel"]').exists()).toBe(false)
    await open()
    await wrapper.findAll('[data-testid="battle-picker-option"]')[0].trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('点击组件外部关闭', async () => {
    mountPicker({ options: options(3), modelValue: 'r0' })
    await open()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(wrapper.find('[data-testid="battle-picker-panel"]').exists()).toBe(false)
  })
})
